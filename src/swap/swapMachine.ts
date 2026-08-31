import type { QuoteInputs, SwapFlowEvent, SwapFlowState } from './types'

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
      return initialState

    case 'INPUT_CHANGED':
      // A quote is only ever valid for the inputs it was fetched with.
      return isBusy(state) ? state : initialState

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
      const requestTxId = requestIdOf(state)
      return event.error.kind === 'terminal'
        ? { tag: 'terminalError', error: event.error, requestTxId }
        : { tag: 'recoverableError', error: event.error, requestTxId }
    }
  }
}
