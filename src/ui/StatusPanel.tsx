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

      {/*
       * Fix 3: `onRetry` is `flow.resumeClaim`, which returns immediately
       * when there is nothing to resume (no handle). `copy.canRetry` is true
       * for `quoteError` and for a `recoverableError` with no `requestTxId`
       * (e.g. the wallet rejected the swap request before it ever reached
       * chain) — both cases a button wired to `resumeClaim` would be a
       * silent no-op. Rendering only once a `requestTxId` exists means every
       * rendered button here does something real; in the cases where it's
       * hidden, the primary "Get quote"/"Swap" button on the panel above
       * already gives the user a working way forward.
       */}
      {copy.canRetry && requestTxId && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          {claimTxId ? 'Check claim' : 'Resume claim'}
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
