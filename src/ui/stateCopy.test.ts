import { describe, expect, it } from 'vitest'
import type { Quote, SwapFlowState } from '../swap/types'
import { describeState } from './stateCopy'

const quote: Quote = {
  inputs: { direction: 'aleoToEth', amountRaw: 100_000n, slippageBps: 50 },
  expectedOut: 5_000n,
  minOut: 4_975n,
  poolKey: 'pool-field',
  tokenOutDecimals: 18,
  tokenOutSymbol: 'ETH',
}

const states: SwapFlowState[] = [
  { tag: 'idle' },
  { tag: 'quoting', inputs: quote.inputs },
  { tag: 'quoted', quote },
  { tag: 'quoteError', error: { message: 'x', kind: 'recoverable' } },
  { tag: 'awaitingRequestApproval', quote },
  { tag: 'requestPending', quote, requestTxId: 'at1req' },
  { tag: 'outputFinalizing', quote, requestTxId: 'at1req', attempt: 2 },
  { tag: 'awaitingClaimApproval', quote, requestTxId: 'at1req' },
  { tag: 'claimPending', quote, requestTxId: 'at1req' },
  {
    tag: 'complete',
    requestTxId: 'at1req',
    claimTxId: 'at1claim',
    amountOut: 4_990n,
    tokenOutDecimals: 18,
    tokenOutSymbol: 'ETH',
  },
  { tag: 'recoverableError', error: { message: 'x', kind: 'recoverable' } },
  { tag: 'terminalError', error: { message: 'x', kind: 'terminal' } },
]

describe('describeState', () => {
  it('gives every state a non-empty headline and detail', () => {
    for (const state of states) {
      const copy = describeState(state)
      expect(copy.headline.length).toBeGreaterThan(0)
      expect(copy.detail.length).toBeGreaterThan(0)
    }
  })

  it('flags exactly the two states that need wallet approval', () => {
    const needing = states.filter((s) => describeState(s).needsApproval).map((s) => s.tag)
    expect(needing).toEqual(['awaitingRequestApproval', 'awaitingClaimApproval'])
  })

  it('flags the waiting states', () => {
    const waiting = states.filter((s) => describeState(s).waiting).map((s) => s.tag)
    expect(waiting).toEqual(['quoting', 'requestPending', 'outputFinalizing', 'claimPending'])
  })

  it('offers retry on recoverable errors but never on terminal ones', () => {
    expect(describeState({ tag: 'recoverableError', error: { message: 'x', kind: 'recoverable' } }).canRetry).toBe(true)
    expect(describeState({ tag: 'terminalError', error: { message: 'x', kind: 'terminal' } }).canRetry).toBe(false)
  })

  it('explains why a claim follows the swap while the output finalizes', () => {
    const copy = describeState({ tag: 'outputFinalizing', quote, requestTxId: 'at1req', attempt: 1 })
    expect(copy.detail.toLowerCase()).toContain('second transaction')
  })

  it('tells the user not to resubmit while a request is pending', () => {
    const copy = describeState({ tag: 'requestPending', quote, requestTxId: 'at1req' })
    expect(copy.detail.toLowerCase()).toMatch(/do not|don't/)
  })

  it('advances the stepper monotonically through the lifecycle', () => {
    expect(describeState({ tag: 'quoted', quote }).step).toBe(0)
    expect(describeState({ tag: 'requestPending', quote, requestTxId: 'a' }).step).toBe(1)
    expect(describeState({ tag: 'outputFinalizing', quote, requestTxId: 'a', attempt: 0 }).step).toBe(2)
    expect(describeState({ tag: 'claimPending', quote, requestTxId: 'a' }).step).toBe(3)
    expect(
      describeState({
        tag: 'complete',
        requestTxId: 'a',
        claimTxId: 'b',
        amountOut: 1n,
        tokenOutDecimals: 18,
        tokenOutSymbol: 'ETH',
      }).step,
    ).toBe(4)
  })
})
