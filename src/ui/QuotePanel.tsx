import { truncateId } from '../explorer'
import type { Quote } from '../swap/types'
import { formatWithSymbol } from '../units'

export function QuotePanel({ quote }: { quote: Quote }) {
  return (
    <dl className="quote">
      <div className="quote__row">
        <dt>Expected output</dt>
        <dd>{formatWithSymbol(quote.expectedOut, quote.tokenOutDecimals, quote.tokenOutSymbol)}</dd>
      </div>
      <div className="quote__row">
        <dt>Minimum output</dt>
        <dd>{formatWithSymbol(quote.minOut, quote.tokenOutDecimals, quote.tokenOutSymbol)}</dd>
      </div>
      <div className="quote__row">
        <dt>Max slippage</dt>
        <dd>{(quote.inputs.slippageBps / 100).toFixed(2)}%</dd>
      </div>
      <div className="quote__row">
        <dt>Pool</dt>
        <dd>
          <code title={quote.poolKey}>{truncateId(quote.poolKey, 12, 8)}</code>
        </dd>
      </div>
    </dl>
  )
}
