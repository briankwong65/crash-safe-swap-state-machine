import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from './App'
import { SwapPanel } from './SwapPanel'
import type { Quote, SwapFlowState } from './swap/types'
import { useBalances } from './wallet/useBalances'
import { useTokens } from './wallet/useTokens'
import { useVeilClient } from './wallet/useVeilClient'
import { useWalletSession } from './wallet/useWalletSession'
import { useSwapFlow } from './swap/useSwapFlow'

// `Shell` (the un-exported-by-default body of `App`) is tested directly
// against mocked hooks so these tests never need a real wallet adapter or
// network — only `SwapPanel`'s composition and the notice/loading branching
// around it are under test here.
vi.mock('./wallet/useWalletSession', () => ({ useWalletSession: vi.fn() }))
vi.mock('./wallet/useTokens', () => ({ useTokens: vi.fn() }))
vi.mock('./wallet/useBalances', () => ({ useBalances: vi.fn() }))
vi.mock('./wallet/useVeilClient', () => ({ useVeilClient: vi.fn() }))
vi.mock('./swap/useSwapFlow', () => ({ useSwapFlow: vi.fn() }))
vi.mock('./api/apiKeyContext', () => ({
  useApiKey: vi.fn(() => ({ apiKey: null, setApiKey: vi.fn() })),
  ApiKeyProvider: ({ children }: { children: unknown }) => children,
}))

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

  it('rejects a zero amount with a validation message and disables the primary control', async () => {
    const flow = makeFlow({ tag: 'idle' })
    renderPanel(flow)

    await userEvent.type(screen.getByLabelText('Amount to sell'), '0')

    expect(screen.getByRole('alert')).toHaveTextContent(/enter an amount greater than zero/i)
    expect(screen.getByRole('button', { name: 'Get quote' })).toBeDisabled()
  })

  it('does not produce a submittable state when MAX is clicked with a zero balance', async () => {
    const flow = makeFlow({ tag: 'idle' })
    const zeroBalances = { aleo: 0n, eth: 250_000_000_000_000_000n }
    render(
      <SwapPanel
        tokens={tokens}
        balances={zeroBalances}
        balancesLoading={false}
        onRefreshBalances={vi.fn()}
        flow={flow as never}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Max' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/enter an amount greater than zero/i)
    expect(screen.getByRole('button', { name: 'Get quote' })).toBeDisabled()
    expect(flow.requestQuote).not.toHaveBeenCalled()
  })
})

describe('app shell', () => {
  beforeEach(() => {
    vi.mocked(useVeilClient).mockReturnValue({ client: null, api: null } as never)
    vi.mocked(useBalances).mockReturnValue({ balances: null, loading: false, refresh: vi.fn() })
  })

  it('shows the blocked-by-other-wallet notice before the API key is supplied', () => {
    vi.mocked(useWalletSession).mockReturnValue({
      status: 'needsApiKey',
      address: 'aleo1self',
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as never)
    vi.mocked(useTokens).mockReturnValue({ tokens: null, error: null })
    vi.mocked(useSwapFlow).mockReturnValue(
      makeFlow({ tag: 'idle' }, { blockedByOtherWallet: 'aleo1someoneelse' }) as never,
    )

    render(<Shell />)

    // The API-key gate is still up — SwapPanel (and its own copy of this
    // notice) is nowhere near mounting — yet the warning must already be
    // visible here, which is exactly what this fix restores.
    expect(screen.getByLabelText('Shield Swap testnet API key')).toBeInTheDocument()
    expect(screen.getByText(/belongs to a different wallet/i)).toBeInTheDocument()
  })

  it('shows the notice only once when the swap panel is also visible', () => {
    vi.mocked(useWalletSession).mockReturnValue({
      status: 'ready',
      address: 'aleo1self',
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as never)
    vi.mocked(useTokens).mockReturnValue({ tokens, error: null })
    vi.mocked(useSwapFlow).mockReturnValue(
      makeFlow({ tag: 'idle' }, { blockedByOtherWallet: 'aleo1someoneelse' }) as never,
    )

    render(<Shell />)

    expect(screen.getAllByText(/belongs to a different wallet/i)).toHaveLength(1)
  })

  it('shows a loading indication while the token registry resolves', () => {
    vi.mocked(useWalletSession).mockReturnValue({
      status: 'ready',
      address: 'aleo1self',
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as never)
    vi.mocked(useTokens).mockReturnValue({ tokens: null, error: null })
    vi.mocked(useSwapFlow).mockReturnValue(makeFlow({ tag: 'idle' }) as never)

    render(<Shell />)

    expect(screen.getByText(/loading the token registry/i)).toBeInTheDocument()
  })
})
