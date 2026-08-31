import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPendingClaim, savePendingClaim, serializeHandle } from './pendingClaim'
import type { PendingClaim, Quote } from './types'
import { useSwapFlow } from './useSwapFlow'

const OWNER = 'aleo1owner'
const OTHER = 'aleo1other'

const tokens = {
  aleo: { id: 'aleo-field', symbol: 'ALEO', decimals: 6 },
  eth: { id: 'eth-field', symbol: 'ETH', decimals: 18 },
}

const handle = {
  tokenInId: 'aleo-field',
  tokenOutId: 'eth-field',
  poolKey: 'pool',
  amountIn: 100_000n,
  transactionId: 'at1req',
  program: 'shield_swap.aleo',
}

const inputs = { direction: 'aleoToEth' as const, amountRaw: 100_000n, slippageBps: 50 }

// Matches `inputs` above, so `swapReducer`'s SUBMIT guard (Task 3, must not be
// weakened) accepts it: SUBMIT is legal only from 'quoted', and only when the
// quote's own `inputs` are the same ones being submitted.
const quote: Quote = {
  inputs,
  expectedOut: 5_000n,
  minOut: 4_975n,
  poolKey: 'pool',
  tokenOutDecimals: 18,
  tokenOutSymbol: 'ETH',
}

const pending: PendingClaim = {
  version: 1,
  address: OWNER,
  requestTxId: 'at1req',
  direction: 'aleoToEth',
  amountInRaw: '100000',
  handle: serializeHandle(handle as never),
  createdAt: 1_700_000_000_000,
}

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    address: OWNER,
    client: {} as never,
    api: {} as never,
    tokens,
    onClaimed: vi.fn(),
    effects: {
      fetchQuote: vi.fn(),
      submitSwap: vi.fn(),
      waitForTransaction: vi.fn(async () => {}),
      recoverIdentity: vi.fn(async () => ({ swapId: 's', blindedAddress: 'aleo1b' })),
      claim: vi.fn(),
    },
    ...overrides,
  }
}

describe('useSwapFlow resume', () => {
  beforeEach(() => localStorage.clear())

  it('resumes a pending claim belonging to the connected wallet', async () => {
    savePendingClaim(pending)
    const args = makeArgs()

    const { result } = renderHook(() => useSwapFlow(args as never))

    await waitFor(() => expect(result.current.state.tag).toBe('outputFinalizing'))
    expect(result.current.state).toMatchObject({ requestTxId: 'at1req' })
  })

  it('does not resume a claim saved by a different wallet', async () => {
    savePendingClaim(pending)
    const args = makeArgs({ address: OTHER })

    const { result } = renderHook(() => useSwapFlow(args as never))

    await waitFor(() => expect(result.current.blockedByOtherWallet).toBe(OWNER))
    expect(result.current.state.tag).toBe('idle')
  })

  it('reports no block when storage is empty', async () => {
    const { result } = renderHook(() => useSwapFlow(makeArgs() as never))
    await waitFor(() => expect(result.current.state.tag).toBe('idle'))
    expect(result.current.blockedByOtherWallet).toBeNull()
  })
})

/**
 * `submit` only takes effect from `'quoted'` (Task 3's reducer guard, which
 * must not be weakened here): dispatching SUBMIT from anywhere else is a
 * no-op that returns the very same state object, and — since these tests
 * assert through `result.current` from `renderHook` — a same-reference
 * reducer return means React bails out of re-rendering entirely, so nothing
 * downstream would ever be observable. Every submission test below therefore
 * drives the hook through `requestQuote` first to reach a real `'quoted'`
 * state, exactly as the real UI (Task 11) does before enabling its Submit
 * button.
 */
async function toQuoted(result: { current: ReturnType<typeof useSwapFlow> }) {
  act(() => {
    result.current.requestQuote(inputs)
  })
  await waitFor(() => expect(result.current.state.tag).toBe('quoted'))
}

describe('useSwapFlow submission', () => {
  beforeEach(() => localStorage.clear())

  it('persists the pending claim before waiting for confirmation', async () => {
    let waitCalls = 0
    let persistedBeforeFirstWait = false

    const args = makeArgs({
      effects: {
        fetchQuote: vi.fn(async () => quote),
        submitSwap: vi.fn(async () => handle),
        waitForTransaction: vi.fn(async () => {
          waitCalls += 1
          if (waitCalls === 1) {
            // The assertion that matters: by the moment the request
            // confirmation wait begins, the claim handle must already be on
            // disk. A reload one instant later must still be able to resume
            // it — that ordering is the entire point of crash recovery.
            persistedBeforeFirstWait = loadPendingClaim(OWNER) !== null
          }
        }),
        recoverIdentity: vi.fn(async () => ({ swapId: 's', blindedAddress: 'aleo1b' })),
        claim: vi.fn(async () => ({
          transactionId: 'at1claim',
          amountOut: 4_990n,
          amountRemaining: 0n,
        })),
      },
    })

    const { result } = renderHook(() => useSwapFlow(args as never))
    await toQuoted(result)

    expect(loadPendingClaim(OWNER)).toBeNull()

    act(() => {
      result.current.submit(inputs)
    })

    await waitFor(() => expect(waitCalls).toBeGreaterThan(0))
    expect(persistedBeforeFirstWait).toBe(true)
  })

  it('ignores a second submit while one is already in flight', async () => {
    const submitSwap = vi.fn(
      async () => new Promise(() => {}) as unknown as typeof handle,
    )
    const args = makeArgs({
      effects: {
        fetchQuote: vi.fn(async () => quote),
        submitSwap,
        waitForTransaction: vi.fn(async () => {}),
        recoverIdentity: vi.fn(),
        claim: vi.fn(),
      },
    })

    const { result } = renderHook(() => useSwapFlow(args as never))
    await toQuoted(result)

    act(() => {
      result.current.submit(inputs)
      result.current.submit(inputs)
      result.current.submit(inputs)
    })

    await waitFor(() => expect(result.current.busy).toBe(true))
    expect(submitSwap).toHaveBeenCalledTimes(1)
  })
})

describe('useSwapFlow resumeClaim (RETRY_CLAIM)', () => {
  beforeEach(() => localStorage.clear())

  it('resumes the claim from a recoverableError left by a failed confirmation wait, without a second submit', async () => {
    // The first waitForTransaction call (request confirmation) fails, landing
    // the machine in `recoverableError` with a `requestTxId`. This is exactly
    // the state Task 11's "Resume claim" button appears in, wired to
    // `resumeClaim`. Before the Task 3 review's fix, dispatching CLAIM
    // directly from that error state was a no-op the reducer correctly
    // ignored, while the hook ran the claim effect anyway — the button looked
    // dead. `resumeClaim` must dispatch RETRY_CLAIM first so the two stay in
    // step, and the flow must complete without ever calling submitSwap again.
    let waitCalls = 0
    const submitSwap = vi.fn(async () => handle)
    const claim = vi.fn(async () => ({
      transactionId: 'at1claim',
      amountOut: 4_990n,
      amountRemaining: 0n,
    }))
    const args = makeArgs({
      effects: {
        fetchQuote: vi.fn(async () => quote),
        submitSwap,
        waitForTransaction: vi.fn(async () => {
          waitCalls += 1
          if (waitCalls === 1) throw new Error('node unreachable')
        }),
        recoverIdentity: vi.fn(async () => ({ swapId: 's', blindedAddress: 'aleo1b' })),
        claim,
      },
    })

    const { result } = renderHook(() => useSwapFlow(args as never))
    await toQuoted(result)

    act(() => {
      result.current.submit(inputs)
    })

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        tag: 'recoverableError',
        requestTxId: 'at1req',
      }),
    )

    act(() => {
      result.current.resumeClaim()
    })

    await waitFor(() => expect(result.current.state.tag).toBe('complete'))
    expect(submitSwap).toHaveBeenCalledTimes(1)
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('resumeClaim is a no-op when there is nothing to resume', async () => {
    const claim = vi.fn()
    const args = makeArgs({ effects: { fetchQuote: vi.fn(), submitSwap: vi.fn(), waitForTransaction: vi.fn(), recoverIdentity: vi.fn(), claim } })

    const { result } = renderHook(() => useSwapFlow(args as never))
    await waitFor(() => expect(result.current.state.tag).toBe('idle'))

    act(() => {
      result.current.resumeClaim()
    })

    expect(result.current.state.tag).toBe('idle')
    expect(claim).not.toHaveBeenCalled()
  })
})

describe('useSwapFlow reset', () => {
  beforeEach(() => localStorage.clear())

  it('never deletes a pending claim left by a different wallet', async () => {
    savePendingClaim(pending)
    const args = makeArgs({ address: OTHER })

    const { result } = renderHook(() => useSwapFlow(args as never))
    await waitFor(() => expect(result.current.blockedByOtherWallet).toBe(OWNER))

    act(() => {
      result.current.reset()
    })

    // Only OWNER's wallet can ever derive the blinding factor for this claim;
    // OTHER calling reset() must never be able to destroy OWNER's only
    // recovery path.
    expect(loadPendingClaim(OWNER)).not.toBeNull()
  })

  it('does clear its own pending claim on reset, once the flow has settled', async () => {
    // RESET is only legal (reducer, Task 3) once the flow is non-busy, so
    // this drives a real submit through to a settled recoverableError first
    // — the same state a "Start over" action would fire from — rather than
    // asserting RESET from a busy state, which the reducer correctly ignores.
    const args = makeArgs({
      effects: {
        fetchQuote: vi.fn(async () => quote),
        submitSwap: vi.fn(async () => handle),
        waitForTransaction: vi.fn(async () => {
          throw new Error('node unreachable')
        }),
        recoverIdentity: vi.fn(),
        claim: vi.fn(),
      },
    })

    const { result } = renderHook(() => useSwapFlow(args as never))
    await toQuoted(result)

    act(() => {
      result.current.submit(inputs)
    })

    await waitFor(() =>
      expect(result.current.state).toMatchObject({ tag: 'recoverableError', requestTxId: 'at1req' }),
    )
    expect(loadPendingClaim(OWNER)).not.toBeNull()

    act(() => {
      result.current.reset()
    })

    expect(loadPendingClaim(OWNER)).toBeNull()
    expect(result.current.state.tag).toBe('idle')
  })
})
