import { useEffect, useMemo, useState } from 'react'
import { AmountField } from './ui/AmountField'
import { BalancePanel } from './ui/BalancePanel'
import { DirectionToggle } from './ui/DirectionToggle'
import { QuotePanel } from './ui/QuotePanel'
import { SlippageField } from './ui/SlippageField'
import { StatusPanel } from './ui/StatusPanel'
import { describeState } from './ui/stateCopy'
import { formatRawAmount, formatWithSymbol, parseAmountInput } from './units'
import type { Direction, QuoteInputs, SwapFlowState } from './swap/types'
import type { PairTokens } from './wallet/useTokens'

const PARSE_MESSAGES: Record<string, string> = {
  empty: '',
  invalid: 'Enter a number, for example 0.05.',
  negative: 'Enter a positive amount.',
  'too-many-decimals': 'That is more decimal places than this token supports.',
}

export type SwapPanelProps = {
  tokens: PairTokens
  balances: { aleo: bigint; eth: bigint } | null
  balancesLoading: boolean
  onRefreshBalances: () => void
  flow: {
    state: SwapFlowState
    busy: boolean
    blockedByOtherWallet: string | null
    requestQuote: (inputs: QuoteInputs) => void
    invalidateQuote: () => void
    submit: (inputs: QuoteInputs) => void
    resumeClaim: () => void
    reset: () => void
  }
}

export function SwapPanel({
  tokens,
  balances,
  balancesLoading,
  onRefreshBalances,
  flow,
}: SwapPanelProps) {
  const [direction, setDirection] = useState<Direction>('aleoToEth')
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(50)

  const tokenIn = direction === 'aleoToEth' ? tokens.aleo : tokens.eth
  const balanceIn = balances ? (direction === 'aleoToEth' ? balances.aleo : balances.eth) : null

  const parsed = useMemo(
    () => parseAmountInput(amount, tokenIn.decimals),
    [amount, tokenIn.decimals],
  )

  const overBalance = parsed.ok && balanceIn !== null && parsed.raw > balanceIn
  // A parsed zero is a legitimate ParseResult (parseAmountInput must stay
  // agnostic to trade rules), but a zero-amount trade is never valid here —
  // this is where that rule belongs, not in the parser.
  const isZero = parsed.ok && parsed.raw === 0n
  const amountError = !parsed.ok
    ? (PARSE_MESSAGES[parsed.reason] ?? null) || null
    : isZero
      ? 'Enter an amount greater than zero.'
      : overBalance
        ? `That is more than your private ${tokenIn.symbol} balance. One private record must cover the whole amount — records are not combined.`
        : null

  const inputs: QuoteInputs | null =
    parsed.ok && !overBalance && !isZero
      ? { direction, amountRaw: parsed.raw, slippageBps }
      : null

  // Any change to the trade retires the current quote.
  useEffect(() => {
    flow.invalidateQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, amount, slippageBps])

  const copy = describeState(flow.state)
  const quote = flow.state.tag === 'quoted' ? flow.state.quote : null
  const disabled = flow.busy

  const primary = (() => {
    if (flow.state.tag === 'quoted') {
      return { label: 'Swap', action: () => inputs && flow.submit(inputs), enabled: !!inputs }
    }
    if (copy.waiting || copy.needsApproval) {
      return { label: copy.headline, action: () => {}, enabled: false }
    }
    return {
      label: 'Get quote',
      action: () => inputs && flow.requestQuote(inputs),
      enabled: !!inputs,
    }
  })()

  return (
    <>
      {flow.blockedByOtherWallet && (
        <p className="notice notice--danger">
          A pending claim on this browser belongs to a different wallet. Connect that wallet to
          finish it — this one cannot.
        </p>
      )}

      <div className="card">
        <BalancePanel
          balances={balances}
          decimals={{ aleo: tokens.aleo.decimals, eth: tokens.eth.decimals }}
          loading={balancesLoading}
          onRefresh={onRefreshBalances}
        />

        <DirectionToggle direction={direction} disabled={disabled} onChange={setDirection} />

        <AmountField
          value={amount}
          symbol={tokenIn.symbol}
          disabled={disabled}
          error={amountError}
          balanceLabel={
            balanceIn === null
              ? null
              : `Private balance: ${formatWithSymbol(balanceIn, tokenIn.decimals, tokenIn.symbol)}`
          }
          onChange={setAmount}
          onMax={() =>
            balanceIn !== null &&
            setAmount(formatRawAmount(balanceIn, tokenIn.decimals, tokenIn.decimals))
          }
        />

        <SlippageField slippageBps={slippageBps} disabled={disabled} onChange={setSlippageBps} />

        {quote && <QuotePanel quote={quote} />}

        <button
          type="button"
          className="button button--primary-full"
          disabled={disabled || !primary.enabled}
          onClick={primary.action}
        >
          {primary.label}
        </button>
      </div>

      <div className="card">
        <StatusPanel state={flow.state} onRetry={flow.resumeClaim} onReset={flow.reset} />
      </div>
    </>
  )
}
