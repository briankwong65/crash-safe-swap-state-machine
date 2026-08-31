import type { SwapFlowState } from '../swap/types'
import { Stepper } from './Stepper'
import { TxLink } from './TxLink'
import { describeState } from './stateCopy'

export function StatusPanel({
  state,
  onRetry,
  onReset,
}: {
  state: SwapFlowState
  onRetry: () => void
  onReset: () => void
}) {
  const copy = describeState(state)
  const requestTxId = 'requestTxId' in state ? state.requestTxId : undefined
  const claimTxId = 'claimTxId' in state ? state.claimTxId : undefined

  return (
    <section className="status" aria-labelledby="status-heading">
      <Stepper step={copy.step} />

      {/* Long transaction-state changes are announced without stealing focus. */}
      <div aria-live="polite" className="status__live">
        <h2 id="status-heading" className="status__headline">
          {copy.headline}
        </h2>
        <p className="status__detail">{copy.detail}</p>
      </div>

      {copy.needsApproval && (
        <p className="status__hint status__hint--action">Check the Shield Wallet extension.</p>
      )}

      {requestTxId && <TxLink label="Swap request" txId={requestTxId} />}
      {claimTxId && <TxLink label="Output claim" txId={claimTxId} />}

      {copy.canRetry && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          {requestTxId ? 'Resume claim' : 'Try again'}
        </button>
      )}

      {state.tag === 'complete' && (
        <button type="button" className="button button--secondary" onClick={onReset}>
          Start another swap
        </button>
      )}
    </section>
  )
}
