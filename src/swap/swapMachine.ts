import type { Quote, QuoteInputs, SwapFlowEvent, SwapFlowState } from './types'

export const initialState: SwapFlowState = { tag: 'idle' }

/** States in which a second submission or claim must not be accepted. */
const BUSY_TAGS = new Set<SwapFlowState['tag']>([
  'awaitingRequestApproval',
  'requestPending',
  'outputFinalizing',
  'awaitingClaimApproval',
  'claimPending',
])

export function isBusy(state: SwapFlowState): boolean {
  return BUSY_TAGS.has(state.tag)
}

function sameInputs(a: QuoteInputs, b: QuoteInputs): boolean {
  return (
    a.direction === b.direction &&
    a.amountRaw === b.amountRaw &&
    a.slippageBps === b.slippageBps
  )
}

/** The request id, where the current state carries one. */
function requestIdOf(state: SwapFlowState): string | undefined {
  return 'requestTxId' in state ? state.requestTxId : undefined
}

/** The claim id, where the current state carries one. */
function claimIdOf(state: SwapFlowState): string | undefined {
  return 'claimTxId' in state ? state.claimTxId : undefined
}

/** The quote in force, where the current state carries one. */
function quoteOf(state: SwapFlowState): Quote | undefined {
  return 'quote' in state ? state.quote : undefined
}

/**
 * The whole trade lifecycle as one pure transition function.
 *
 * Guards live here rather than in the view so that a component which forgets
 * to disable a button still cannot double-spend: an event that is not legal
 * for the current state returns that state unchanged.
 */
export function swapReducer(
  state: SwapFlowState,
  event: SwapFlowEvent,
): SwapFlowState {
  switch (event.type) {
    case 'RESET':
      // Never discard a trade in flight: RESET only applies once the flow
      // has settled (idle, quoted, an error, or complete).
      return isBusy(state) ? state : initialState

    case 'INPUT_CHANGED':
      // A quote is only ever valid for the inputs it was fetched with.
      if (isBusy(state)) return state
      if (
        (state.tag === 'recoverableError' || state.tag === 'terminalError') &&
        state.requestTxId !== undefined
      ) {
        // A swap was submitted and its output has not been claimed yet.
        // Wiping the state here would strand the user's funds behind a
        // handle nothing else references.
        return state
      }
      return initialState

    case 'QUOTE_REQUESTED':
      return isBusy(state) ? state : { tag: 'quoting', inputs: event.inputs }

    case 'QUOTE_RECEIVED':
      return state.tag === 'quoting' ? { tag: 'quoted', quote: event.quote } : state

    case 'QUOTE_FAILED':
      return state.tag === 'quoting' ? { tag: 'quoteError', error: event.error } : state

    case 'SUBMIT':
      if (isBusy(state) || state.tag !== 'quoted') return state
      // Second guard: refuse a quote fetched for different inputs.
      if (!sameInputs(state.quote.inputs, event.inputs)) return state
      return { tag: 'awaitingRequestApproval', quote: state.quote }

    case 'REQUEST_SUBMITTED':
      return state.tag === 'awaitingRequestApproval'
        ? { tag: 'requestPending', quote: state.quote, requestTxId: event.requestTxId }
        : state

    case 'REQUEST_ID_RESOLVED':
      // Shield returns its own request handle from a write; the on-chain id
      // only exists once the wallet has broadcast. Swap it in so the explorer
      // link and every later chain read use the real transaction.
      return state.tag === 'requestPending'
        ? { ...state, requestTxId: event.requestTxId }
        : state

    case 'REQUEST_CONFIRMED':
      return state.tag === 'requestPending'
        ? {
            tag: 'outputFinalizing',
            quote: state.quote,
            requestTxId: state.requestTxId,
            attempt: 0,
          }
        : state

    case 'FINALIZE_RETRY':
      return state.tag === 'outputFinalizing'
        ? { ...state, attempt: event.attempt }
        : state

    case 'CLAIM':
      return state.tag === 'outputFinalizing'
        ? {
            tag: 'awaitingClaimApproval',
            quote: state.quote,
            requestTxId: state.requestTxId,
          }
        : state

    case 'CLAIM_SUBMITTED':
      return state.tag === 'awaitingClaimApproval'
        ? {
            tag: 'claimPending',
            quote: state.quote,
            requestTxId: state.requestTxId,
            claimTxId: event.claimTxId,
          }
        : state

    case 'CLAIM_CONFIRMED':
      return state.tag === 'claimPending'
        ? {
            tag: 'complete',
            requestTxId: state.requestTxId,
            claimTxId: event.claimTxId,
            amountOut: event.amountOut,
            tokenOutDecimals: event.tokenOutDecimals,
            tokenOutSymbol: event.tokenOutSymbol,
          }
        : state

    case 'RESUME':
      // Only from a clean slate — never interrupt a trade already in flight.
      return state.tag === 'idle'
        ? {
            tag: 'outputFinalizing',
            quote: event.quote,
            requestTxId: event.requestTxId,
            attempt: 0,
          }
        : state

    case 'FAILED': {
      // A finished trade cannot subsequently fail.
      if (state.tag === 'complete') return state
      const requestTxId = requestIdOf(state)
      const claimTxId = claimIdOf(state)
      // Carried so a later RETRY_CLAIM can rebuild outputFinalizing without
      // this reducer reaching outside itself for a quote.
      const quote = quoteOf(state)
      return event.error.kind === 'terminal'
        ? { tag: 'terminalError', error: event.error, requestTxId, claimTxId, quote }
        : { tag: 'recoverableError', error: event.error, requestTxId, claimTxId, quote }
    }

    case 'RETRY_CLAIM': {
      // Only an error state that was already past the request — i.e. still
      // holding both the requestTxId and the quote it failed with — can be
      // retried. A quoteless error (nothing submitted yet) or one missing a
      // requestTxId (nothing to resume) is left exactly where it is; this is
      // never a route into a busy state from anywhere but that specific spot,
      // and it never leads to `awaitingRequestApproval`/`requestPending`, so
      // it can never trigger a second `submitSwapRequest`.
      if (state.tag !== 'recoverableError' && state.tag !== 'terminalError') return state
      if (state.requestTxId === undefined || state.quote === undefined) return state
      return {
        tag: 'outputFinalizing',
        quote: state.quote,
        requestTxId: state.requestTxId,
        attempt: 0,
      }
    }
  }
}
