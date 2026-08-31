import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { Quote, SwapFlowState } from '../swap/types'
import { describeState } from './stateCopy'
import { StatusPanel } from './StatusPanel'

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

  it('reports step 3 for an error state whose claim was already submitted', () => {
    expect(
      describeState({
        tag: 'recoverableError',
        error: { message: 'x', kind: 'recoverable' },
        requestTxId: 'at1req',
        claimTxId: 'at1claim',
      }).step,
    ).toBe(3)
    expect(
      describeState({
        tag: 'terminalError',
        error: { message: 'x', kind: 'terminal' },
        requestTxId: 'at1req',
        claimTxId: 'at1claim',
      }).step,
    ).toBe(3)
  })

  it('reports step 2 for an error state with only a request submitted', () => {
    expect(
      describeState({
        tag: 'recoverableError',
        error: { message: 'x', kind: 'recoverable' },
        requestTxId: 'at1req',
      }).step,
    ).toBe(2)
    expect(
      describeState({
        tag: 'terminalError',
        error: { message: 'x', kind: 'terminal' },
        requestTxId: 'at1req',
      }).step,
    ).toBe(2)
  })

  it('reports step 0 for an error state where nothing was submitted', () => {
    expect(describeState({ tag: 'recoverableError', error: { message: 'x', kind: 'recoverable' } }).step).toBe(0)
    expect(describeState({ tag: 'terminalError', error: { message: 'x', kind: 'terminal' } }).step).toBe(0)
  })

  it('tells a user whose transaction already went out that a terminal error is different from a clean failure', () => {
    const nothingSubmitted = describeState({ tag: 'terminalError', error: { message: 'x', kind: 'terminal' } }).detail
    const requestSubmitted = describeState({
      tag: 'terminalError',
      error: { message: 'x', kind: 'terminal' },
      requestTxId: 'at1req',
    }).detail
    const claimSubmitted = describeState({
      tag: 'terminalError',
      error: { message: 'x', kind: 'terminal' },
      requestTxId: 'at1req',
      claimTxId: 'at1claim',
    }).detail

    expect(requestSubmitted).not.toBe(nothingSubmitted)
    expect(claimSubmitted).not.toBe(nothingSubmitted)
    expect(requestSubmitted.toLowerCase()).toContain('not lost')
    expect(claimSubmitted.toLowerCase()).toContain('not lost')
  })
})

describe('StatusPanel', () => {
  it('shows the claim link for a recoverableError whose claim was already submitted', () => {
    render(
      createElement(StatusPanel, {
        state: {
          tag: 'recoverableError',
          error: { message: 'x', kind: 'recoverable' },
          requestTxId: 'at1req',
          claimTxId: 'at1claim',
        },
        onRetry: () => {},
        onReset: () => {},
      }),
    )
    expect(screen.getByText('Output claim')).toBeInTheDocument()
  })

  it('shows the claim link for a terminalError whose claim was already submitted', () => {
    render(
      createElement(StatusPanel, {
        state: {
          tag: 'terminalError',
          error: { message: 'x', kind: 'terminal' },
          requestTxId: 'at1req',
          claimTxId: 'at1claim',
        },
        onRetry: () => {},
        onReset: () => {},
      }),
    )
    expect(screen.getByText('Output claim')).toBeInTheDocument()
  })
})
