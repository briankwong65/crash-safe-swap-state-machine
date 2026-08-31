import { describe, expect, it } from 'vitest'
import { initialState, isBusy, swapReducer } from './swapMachine'
import type { Quote, QuoteInputs, SwapFlowState } from './types'

const inputs: QuoteInputs = {
  direction: 'aleoToEth',
  amountRaw: 100_000n,
  slippageBps: 50,
}

const quote: Quote = {
  inputs,
  expectedOut: 5_000n,
  minOut: 4_975n,
  poolKey: 'pool-key-field',
  tokenOutDecimals: 18,
  tokenOutSymbol: 'ETH',
}

const quoted: SwapFlowState = { tag: 'quoted', quote }

describe('quote invalidation', () => {
  it('drops the quote when any input changes', () => {
    expect(swapReducer(quoted, { type: 'INPUT_CHANGED' })).toEqual({ tag: 'idle' })
  })

  it.each([
    ['amount', { ...inputs, amountRaw: 200_000n }],
    ['direction', { ...inputs, direction: 'ethToAleo' as const }],
    ['slippage', { ...inputs, slippageBps: 100 }],
  ])('refuses to submit a quote fetched for different %s', (_label, changed) => {
    const next = swapReducer(quoted, { type: 'SUBMIT', inputs: changed })
    expect(next).toEqual(quoted)
  })

  it('submits when the inputs still match the quote', () => {
    const next = swapReducer(quoted, { type: 'SUBMIT', inputs })
    expect(next).toEqual({ tag: 'awaitingRequestApproval', quote })
  })
})

describe('duplicate submission', () => {
  const busyStates: SwapFlowState[] = [
    { tag: 'awaitingRequestApproval', quote },
    { tag: 'requestPending', quote, requestTxId: 'at1req' },
    { tag: 'outputFinalizing', quote, requestTxId: 'at1req', attempt: 1 },
    { tag: 'awaitingClaimApproval', quote, requestTxId: 'at1req' },
    { tag: 'claimPending', quote, requestTxId: 'at1req' },
  ]

  it.each(busyStates)('reports $tag as busy', (state) => {
    expect(isBusy(state)).toBe(true)
  })

  it.each(busyStates)('ignores SUBMIT while in $tag', (state) => {
    expect(swapReducer(state, { type: 'SUBMIT', inputs })).toEqual(state)
  })

  // 'outputFinalizing' is deliberately excluded here: CLAIM is the
  // legitimate advancing transition out of it (asserted by the happy path
  // below), not a no-op, so it belongs in that test, not this one. Every
  // state actually iterated here must produce a genuine no-op assertion —
  // no early returns — including 'awaitingClaimApproval', the double-click-
  // the-Claim-button case this guard exists for.
  const claimNoOpStates = busyStates.filter((state) => state.tag !== 'outputFinalizing')

  it.each(claimNoOpStates)('ignores CLAIM while in $tag', (state) => {
    expect(swapReducer(state, { type: 'CLAIM' })).toEqual(state)
  })

  it.each(busyStates)('ignores RESET while in $tag', (state) => {
    expect(swapReducer(state, { type: 'RESET' })).toEqual(state)
  })

  it('treats idle and quoted as not busy', () => {
    expect(isBusy(initialState)).toBe(false)
    expect(isBusy(quoted)).toBe(false)
  })
})

describe('happy path', () => {
  it('walks request through claim to complete', () => {
    let state = swapReducer(quoted, { type: 'SUBMIT', inputs })
    expect(state.tag).toBe('awaitingRequestApproval')

    state = swapReducer(state, { type: 'REQUEST_SUBMITTED', requestTxId: 'at1req' })
    expect(state).toEqual({ tag: 'requestPending', quote, requestTxId: 'at1req' })

    state = swapReducer(state, { type: 'REQUEST_CONFIRMED' })
    expect(state).toEqual({
      tag: 'outputFinalizing',
      quote,
      requestTxId: 'at1req',
      attempt: 0,
    })

    state = swapReducer(state, { type: 'FINALIZE_RETRY', attempt: 3 })
    expect(state).toEqual({
      tag: 'outputFinalizing',
      quote,
      requestTxId: 'at1req',
      attempt: 3,
    })

    state = swapReducer(state, { type: 'CLAIM' })
    expect(state).toEqual({
      tag: 'awaitingClaimApproval',
      quote,
      requestTxId: 'at1req',
    })

    state = swapReducer(state, { type: 'CLAIM_SUBMITTED', claimTxId: 'at1claim' })
    expect(state).toEqual({
      tag: 'claimPending',
      quote,
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
    })

    state = swapReducer(state, {
      type: 'CLAIM_CONFIRMED',
      claimTxId: 'at1claim',
      amountOut: 4_990n,
      tokenOutDecimals: 18,
      tokenOutSymbol: 'ETH',
    })
    expect(state).toEqual({
      tag: 'complete',
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
      amountOut: 4_990n,
      tokenOutDecimals: 18,
      tokenOutSymbol: 'ETH',
    })
  })
})

describe('resume and failure', () => {
  it('resumes a persisted claim straight into finalizing', () => {
    const state = swapReducer(initialState, {
      type: 'RESUME',
      quote,
      requestTxId: 'at1req',
    })
    expect(state).toEqual({
      tag: 'outputFinalizing',
      quote,
      requestTxId: 'at1req',
      attempt: 0,
    })
  })

  it('keeps the request id on a failure after submission so a claim can resume', () => {
    const pending: SwapFlowState = { tag: 'requestPending', quote, requestTxId: 'at1req' }
    const state = swapReducer(pending, {
      type: 'FAILED',
      error: { message: 'node unreachable', kind: 'recoverable' },
    })
    expect(state).toEqual({
      tag: 'recoverableError',
      error: { message: 'node unreachable', kind: 'recoverable' },
      requestTxId: 'at1req',
    })
  })

  it('routes a terminal failure to terminalError', () => {
    const state = swapReducer(quoted, {
      type: 'FAILED',
      error: { message: 'route used the wrong pool', kind: 'terminal' },
    })
    expect(state.tag).toBe('terminalError')
  })

  it('ignores FAILED once the trade is complete', () => {
    const complete: SwapFlowState = {
      tag: 'complete',
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
      amountOut: 4_990n,
      tokenOutDecimals: 18,
      tokenOutSymbol: 'ETH',
    }
    const state = swapReducer(complete, {
      type: 'FAILED',
      error: { message: 'too late', kind: 'terminal' },
    })
    expect(state).toEqual(complete)
  })

  it('preserves an in-flight claimTxId when FAILED fires from claimPending', () => {
    const pending: SwapFlowState = {
      tag: 'claimPending',
      quote,
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
    }
    const state = swapReducer(pending, {
      type: 'FAILED',
      error: { message: 'claim indexer timeout', kind: 'recoverable' },
    })
    expect(state).toEqual({
      tag: 'recoverableError',
      error: { message: 'claim indexer timeout', kind: 'recoverable' },
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
    })
  })

  it.each(['recoverableError', 'terminalError'] as const)(
    'keeps a %s state with an outstanding requestTxId on INPUT_CHANGED',
    (tag) => {
      const errorState: SwapFlowState = {
        tag,
        error: { message: 'node unreachable', kind: 'recoverable' },
        requestTxId: 'at1req',
      }
      expect(swapReducer(errorState, { type: 'INPUT_CHANGED' })).toEqual(errorState)
    },
  )

  it('drops an error state with no requestTxId back to idle on INPUT_CHANGED', () => {
    const errorState: SwapFlowState = {
      tag: 'terminalError',
      error: { message: 'route used the wrong pool', kind: 'terminal' },
    }
    expect(swapReducer(errorState, { type: 'INPUT_CHANGED' })).toEqual({ tag: 'idle' })
  })

  it('RESET returns to idle from a non-busy state', () => {
    expect(swapReducer(quoted, { type: 'RESET' })).toEqual({ tag: 'idle' })
  })

  it('RESET still returns to idle from complete', () => {
    const complete: SwapFlowState = {
      tag: 'complete',
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
      amountOut: 4_990n,
      tokenOutDecimals: 18,
      tokenOutSymbol: 'ETH',
    }
    expect(swapReducer(complete, { type: 'RESET' })).toEqual({ tag: 'idle' })
  })

  it('breaks the reviewer-found double-claim escape sequence', () => {
    // claimPending{claimTxId: 'claim1'} -> FAILED -> INPUT_CHANGED -> idle
    // -> RESUME(same requestTxId) -> CLAIM -> CLAIM_SUBMITTED('claim2')
    // used to land in a second, independent claimPending with claim1's id
    // gone. It must now be blocked at the very first step: FAILED preserves
    // claimTxId, and INPUT_CHANGED refuses to clear a state that still
    // carries a requestTxId, so none of the later events ever find a state
    // they're legal from.
    const pending: SwapFlowState = {
      tag: 'claimPending',
      quote,
      requestTxId: 'at1req',
      claimTxId: 'claim1',
    }

    let state = swapReducer(pending, {
      type: 'FAILED',
      error: { message: 'claim broadcast failed', kind: 'recoverable' },
    })
    expect(state).toEqual({
      tag: 'recoverableError',
      error: { message: 'claim broadcast failed', kind: 'recoverable' },
      requestTxId: 'at1req',
      claimTxId: 'claim1',
    })

    state = swapReducer(state, { type: 'INPUT_CHANGED' })
    expect(state.tag).toBe('recoverableError')

    state = swapReducer(state, { type: 'RESUME', quote, requestTxId: 'at1req' })
    expect(state.tag).toBe('recoverableError')

    state = swapReducer(state, { type: 'CLAIM' })
    expect(state.tag).toBe('recoverableError')

    state = swapReducer(state, { type: 'CLAIM_SUBMITTED', claimTxId: 'claim2' })
    expect(state.tag).toBe('recoverableError')
    if (state.tag === 'recoverableError') {
      expect(state.claimTxId).toBe('claim1')
    }
  })
})
