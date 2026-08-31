import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SwapPanel } from './SwapPanel'
import type { Quote, SwapFlowState } from './swap/types'

const tokens = {
  aleo: { id: 'aleo-field', symbol: 'ALEO', decimals: 6 },
  eth: { id: 'eth-field', symbol: 'ETH', decimals: 18 },
}

const balances = { aleo: 5_000_000n, eth: 250_000_000_000_000_000n }

const quote: Quote = {
  inputs: { direction: 'aleoToEth', amountRaw: 100_000n, slippageBps: 50 },
  expectedOut: 12_300_000_000_000_000n,
  minOut: 12_238_500_000_000_000n,
  poolKey: '5905392528088736716502352327676815883959790811081903315511484137973858480171field',
  tokenOutDecimals: 18,
  tokenOutSymbol: 'ETH',
}

function makeFlow(state: SwapFlowState, overrides: Record<string, unknown> = {}) {
  return {
    state,
    busy: false,
    blockedByOtherWallet: null,
    requestQuote: vi.fn(),
    invalidateQuote: vi.fn(),
    submit: vi.fn(),
    resumeClaim: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function renderPanel(flow: ReturnType<typeof makeFlow>) {
  return render(
    <SwapPanel
      tokens={tokens}
      balances={balances}
      balancesLoading={false}
      onRefreshBalances={vi.fn()}
      flow={flow as never}
    />,
  )
}

describe('swap interface', () => {
  it('shows private balances for both tokens', () => {
    renderPanel(makeFlow({ tag: 'idle' }))
    expect(screen.getByText('Private ALEO')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('0.25')).toBeInTheDocument()
  })

  it('requests a quote with the typed amount converted to raw units', async () => {
    const flow = makeFlow({ tag: 'idle' })
    renderPanel(flow)

    await userEvent.type(screen.getByLabelText('Amount to sell'), '0.1')
    await userEvent.click(screen.getByRole('button', { name: 'Get quote' }))

    expect(flow.requestQuote).toHaveBeenCalledWith({
      direction: 'aleoToEth',
      amountRaw: 100_000n,
      slippageBps: 50,
    })
  })

  it('shows expected output, minimum output, slippage, and the pool id', () => {
    renderPanel(makeFlow({ tag: 'quoted', quote }))

    expect(screen.getByText('Expected output')).toBeInTheDocument()
    expect(screen.getByText('0.0123 ETH')).toBeInTheDocument()
    expect(screen.getByText('Minimum output')).toBeInTheDocument()
    expect(screen.getByText('0.012238 ETH')).toBeInTheDocument()
    expect(screen.getByText('0.50%')).toBeInTheDocument()
    expect(screen.getByTitle(quote.poolKey)).toBeInTheDocument()
  })

  it('blocks the amount when it exceeds the private balance and explains records', async () => {
    const flow = makeFlow({ tag: 'idle' })
    renderPanel(flow)

    await userEvent.type(screen.getByLabelText('Amount to sell'), '99')

    expect(screen.getByRole('alert')).toHaveTextContent(/more than your private ALEO balance/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/records are not combined/i)
    expect(screen.getByRole('button', { name: 'Get quote' })).toBeDisabled()
  })

  it('disables the primary button while a request is pending', () => {
    renderPanel(
      makeFlow({ tag: 'requestPending', quote, requestTxId: 'at1req' }, { busy: true }),
    )
    expect(screen.getByRole('button', { name: /swap request submitted/i })).toBeDisabled()
  })

  it('tells the user not to resubmit and links the request transaction', () => {
    renderPanel(makeFlow({ tag: 'requestPending', quote, requestTxId: 'at1req' }, { busy: true }))

    expect(screen.getByText(/do not submit again/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /at1req/ })).toHaveAttribute(
      'href',
      'https://testnet.explorer.provable.com/transaction/at1req',
    )
  })

  it('explains why a claim follows the swap while finalizing', () => {
    renderPanel(
      makeFlow({ tag: 'outputFinalizing', quote, requestTxId: 'at1req', attempt: 1 }, { busy: true }),
    )
    expect(screen.getByText(/second transaction that collects the output/i)).toBeInTheDocument()
  })

  it('announces transaction-state changes in a live region', () => {
    const { container } = renderPanel(makeFlow({ tag: 'requestPending', quote, requestTxId: 'a' }))
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live).toHaveTextContent(/swap request submitted/i)
  })

  it('warns when a pending claim belongs to another wallet', () => {
    renderPanel(makeFlow({ tag: 'idle' }, { blockedByOtherWallet: 'aleo1someoneelse' }))
    expect(screen.getByText(/belongs to a different wallet/i)).toBeInTheDocument()
  })

  it('shows both transaction links when the swap completes', () => {
    renderPanel(
      makeFlow({
        tag: 'complete',
        requestTxId: 'at1req',
        claimTxId: 'at1claim',
        amountOut: 12_300_000_000_000_000n,
        tokenOutDecimals: 18,
        tokenOutSymbol: 'ETH',
      }),
    )

    expect(screen.getByRole('link', { name: /at1req/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /at1claim/ })).toBeInTheDocument()
  })
})
