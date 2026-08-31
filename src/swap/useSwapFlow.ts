import type { ApiClient, SwapHandle, TokenInfo } from '@provablehq/shield-swap-sdk'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PROGRAMS } from '../config'
import {
  claimWithRetry,
  recoverSwapIdentity,
  submitSwapRequest,
  waitForTransaction,
} from './execute'
import {
  clearPendingClaim,
  deserializeHandle,
  loadPendingClaim,
  peekPendingClaimAddress,
  savePendingClaim,
  serializeHandle,
} from './pendingClaim'
import { classifyQuoteError, fetchPinnedQuote } from './quote'
import { initialState, isBusy, swapReducer } from './swapMachine'
import type { Quote, QuoteInputs, SwapFlowState } from './types'

export type SwapFlowEffects = {
  fetchQuote: typeof fetchPinnedQuote
  submitSwap: typeof submitSwapRequest
  waitForTransaction: typeof waitForTransaction
  recoverIdentity: typeof recoverSwapIdentity
  claim: typeof claimWithRetry
}

const defaultEffects: SwapFlowEffects = {
  fetchQuote: fetchPinnedQuote,
  submitSwap: submitSwapRequest,
  waitForTransaction,
  recoverIdentity: recoverSwapIdentity,
  claim: claimWithRetry,
}

export type UseSwapFlowArgs = {
  address: string | null
  client: unknown
  api: ApiClient | null
  tokens: { aleo: TokenInfo; eth: TokenInfo } | null
  onClaimed?: () => void
  /** Wallet adapter status lookup, used to resolve its request handle to an on-chain id. */
  transactionStatus?: (id: string) => Promise<{ status: string; transactionId?: string; error?: string }>
  effects?: Partial<SwapFlowEffects>
}

/**
 * The program a write's `imports` map must carry for a token.
 *
 * This is the token's AMM program, NOT the program its records live in. ALEO's
 * records are native `credits.aleo`, but inside the AMM it is represented by
 * `shield_swap_arc20_credits.aleo` — pass the record program and the prover
 * rejects the swap with "External stack for 'shield_swap_arc20_credits.aleo'
 * does not exist". Read from the registry rather than hard-coded, per the
 * requirement to discover AMM token programs through the API.
 */
function ammProgramOf(token: TokenInfo, fallback: string): string {
  return token.ammTokenProgram ?? fallback
}

function tokensFor(
  tokens: { aleo: TokenInfo; eth: TokenInfo },
  direction: QuoteInputs['direction'],
) {
  const aleoProgram = ammProgramOf(tokens.aleo, PROGRAMS.aleoWrapper)
  const ethProgram = ammProgramOf(tokens.eth, PROGRAMS.eth)

  return direction === 'aleoToEth'
    ? { tokenIn: tokens.aleo, tokenOut: tokens.eth, inProgram: aleoProgram, outProgram: ethProgram }
    : { tokenIn: tokens.eth, tokenOut: tokens.aleo, inProgram: ethProgram, outProgram: aleoProgram }
}

/**
 * Claims in flight, keyed by `requestTxId`, at MODULE scope rather than a
 * ref.
 *
 * A plain React unmount does not cancel an in-progress `runClaim` promise —
 * nothing aborts it, so it keeps running orphaned in the background. A
 * per-instance `inFlight` ref cannot see that: a fresh instance (e.g. the
 * user navigates away and back, remounting this hook for the same wallet)
 * starts with `inFlight.current === false` even though an earlier
 * instance's claim for the very same `requestTxId` — a real, signed
 * on-chain `claimSwapOutput` call — is still outstanding. This set is what
 * makes that visible across instances within the same JS heap.
 *
 * Module scope is deliberately the right level and no more: it survives an
 * unmount/remount within one live session (the failing case), and a real
 * browser reload clears it for free, because the reload destroys the heap
 * — the orphaned promise died with it, so there is nothing left to guard
 * against there. This is NOT a cross-tab lock: two tabs are separate heaps,
 * and a `localStorage`-based lease would need an expiry, and a stale lease
 * would block genuine crash recovery on exactly the path whose purpose is
 * to avoid stranding funds — strictly worse than the race it would prevent.
 * That limitation is intentional and out of scope here.
 */
const claimsInFlight = new Set<string>()

/**
 * Test-only escape hatch: clears the module-level registry above.
 *
 * Real usage never needs this — the registry is deliberately keyed by
 * `requestTxId` and cleaned up in `finally` on every real claim attempt.
 * Tests need it because this module (and therefore `claimsInFlight`) is
 * loaded once per test FILE, not once per test CASE, and several tests
 * deliberately use a claim effect that never resolves (to freeze the
 * machine at a specific state for assertions) — which means its `finally`
 * never runs and the id would otherwise leak into later tests that reuse
 * the same fixture `requestTxId`.
 */
export function __resetClaimsInFlightForTests(): void {
  claimsInFlight.clear()
}

/**
 * Drives the machine: every side effect runs here and reports back as an event.
 *
 * The reducer decides what is legal; this hook only asks. That is why a double
 * click cannot double-spend — the second `SUBMIT` is a no-op in the reducer and
 * the guard below never starts a second effect.
 */
export function useSwapFlow(args: UseSwapFlowArgs) {
  const effects = { ...defaultEffects, ...args.effects }
  const [state, dispatch] = useReducer(swapReducer, initialState)
  const [blockedByOtherWallet, setBlockedByOtherWallet] = useState<string | null>(null)
  const inFlight = useRef(false)
  const handleRef = useRef<SwapHandle | null>(null)
  /** The direction of the trade in flight, so a resumed claim knows its output token. */
  const directionRef = useRef<QuoteInputs['direction'] | null>(null)
  /**
   * Set once the mount-time resume effect has made its single automatic claim
   * attempt, so a later re-run of that effect (e.g. `args.tokens` resolving
   * after `args.address`, or an unrelated client/api reconnect) can never
   * fire a second unsolicited claim. A failed automatic attempt still leaves
   * the machine in an error state with `requestTxId` set, which is exactly
   * what surfaces the manual "Resume claim" button (`resumeClaim`) — this
   * ref only bounds the *automatic* attempt to at most one.
   */
  const autoResumeAttempted = useRef(false)

  // Stable across renders unless the underlying client/api actually change,
  // so callbacks that depend on it don't silently go stale when some
  // unrelated prop (e.g. `state`) triggers a re-render.
  const deps = useMemo(
    () => ({
      client: args.client as never,
      api: args.api as ApiClient,
      ...(args.transactionStatus ? { transactionStatus: args.transactionStatus } : {}),
    }),
    [args.client, args.api, args.transactionStatus],
  )

  const fail = useCallback((error: unknown) => {
    if (import.meta.env.DEV) {
      // A fallback transport reports only its first transport's message, so
      // the reason a chain read actually failed lives in cause/errors.
      const chain = error as { cause?: unknown; errors?: unknown[] }
      console.error('[flow] failure:', error, chain?.cause ?? '', chain?.errors ?? '')
    }

    dispatch({ type: 'FAILED', error: classifyQuoteError(error) })
    inFlight.current = false
  }, [])

  const runClaim = useCallback(
    async (handle: SwapHandle, direction: QuoteInputs['direction']) => {
      dispatch({ type: 'CLAIM' })
      const result = await effects.claim(deps, handle, {
        onRetry: (attempt) => dispatch({ type: 'FINALIZE_RETRY', attempt }),
      })

      dispatch({ type: 'CLAIM_SUBMITTED', claimTxId: result.transactionId })
      await effects.waitForTransaction(deps, result.transactionId)

      // The output token is whichever side of the pair the trade was buying.
      const tokenOut =
        direction === 'aleoToEth' ? args.tokens?.eth : args.tokens?.aleo

      dispatch({
        type: 'CLAIM_CONFIRMED',
        claimTxId: result.transactionId,
        amountOut: result.amountOut,
        // Fix 8: per-direction fallback, matching the resume path below —
        // aleoToEth buys ETH (18 decimals), ethToAleo buys ALEO (6). Reached
        // only if the claim confirms while `args.tokens` is still null; the
        // old flat `?? 18` fallback misreported an ethToAleo receipt by
        // 10^12.
        tokenOutDecimals: tokenOut?.decimals ?? (direction === 'aleoToEth' ? 18 : 6),
        tokenOutSymbol: tokenOut?.symbol ?? '',
      })

      clearPendingClaim()
      args.onClaimed?.()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, args.tokens, args.onClaimed],
  )

  /**
   * A wallet-path handle returned by `submitSwapRequest` carries no `swapId`
   * or `blindedAddress` — the wallet resolves the input record itself, so
   * nothing here ever sees the blinding factor. Those two fields are
   * recovered from the confirmed request transaction (see
   * `recoverSwapIdentity`); `claimSwapOutput` throws `handle.swapId is not
   * set` without them. `startClaim`'s optional `prepare` step exists solely
   * to run that recovery, under the same in-flight lock as the claim itself,
   * for every path that can reach `startClaim` holding an identity-less
   * handle: a page reload during `requestPending` (the resume effect below)
   * and a manual "Resume claim" after an in-session failure that happened
   * before `submit` ever ran its own recovery (the `resumeClaim` branches
   * further down). `submit`'s own first-time path already recovers identity
   * inline before calling `startClaim`, so `needsRecovery` is false there
   * and `prepare` is never passed.
   */
  const recoverAndPersist = useCallback(
    async (handle: SwapHandle, requestTxId: string, direction: QuoteInputs['direction']) => {
      // Required, not optional: `recoverSwapIdentity`'s `readTransaction`
      // returns null for a transaction that isn't confirmed yet and throws
      // "Could not read the swap id" — exactly what a reload during
      // `requestPending` (request submitted, not yet confirmed) would hit
      // without this wait.
      const onChainId = await effects.waitForTransaction(deps, requestTxId)
      if (onChainId !== requestTxId) {
        handle.transactionId = onChainId
        dispatch({ type: 'REQUEST_ID_RESOLVED', requestTxId: onChainId })
      }
      const identity = await effects.recoverIdentity(deps, onChainId, handle)
      handle.swapId = identity.swapId
      handle.blindedAddress = identity.blindedAddress

      if (args.address) {
        // Re-persist so a SECOND reload — one that lands after recovery but
        // before the claim confirms — skips this recovery entirely and goes
        // straight to the claim. Carries forward whatever was already on
        // disk for this claim (amount, createdAt) rather than guessing at
        // it here.
        const existing = loadPendingClaim(args.address)
        savePendingClaim({
          version: 1,
          address: args.address,
          requestTxId,
          direction,
          amountInRaw: existing?.amountInRaw ?? handle.amountIn.toString(),
          handle: serializeHandle(handle),
          createdAt: existing?.createdAt ?? Date.now(),
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, args.address],
  )

  /**
   * The single entry point that actually starts a claim, used by both the
   * automatic mount-time trigger and the manual `resumeClaim`. Guarded
   * twice: `inFlight` (this hook instance) and `claimsInFlight` (module
   * scope, every instance in this JS heap) — the two are complementary,
   * not redundant. `inFlight` alone would miss the orphaned-promise case
   * above; `claimsInFlight` alone would miss nothing extra here, but
   * keeping `inFlight` is what lets every other call site (`submit`,
   * `busy`) keep asking a single, cheap, per-instance ref rather than
   * reaching into module state.
   *
   * Registers before anything (including the optional `prepare` recovery
   * step) starts — not after — and always cleans up in `finally`,
   * including on failure, so a genuine retry later is never permanently
   * blocked by its own earlier, failed attempt.
   */
  const startClaim = useCallback(
    (
      handle: SwapHandle,
      direction: QuoteInputs['direction'],
      requestTxId: string,
      prepare?: () => Promise<void>,
    ) => {
      if (inFlight.current || claimsInFlight.has(requestTxId)) return
      inFlight.current = true
      claimsInFlight.add(requestTxId)
      void (async () => {
        try {
          await prepare?.()
          await runClaim(handle, direction)
        } catch (error) {
          fail(error)
        } finally {
          inFlight.current = false
          claimsInFlight.delete(requestTxId)
        }
      })()
    },
    [runClaim, fail],
  )

  /** Whether `handle` still needs its identity recovered before it can claim. */
  function needsIdentityRecovery(handle: SwapHandle): boolean {
    return handle.swapId === undefined || handle.blindedAddress === undefined
  }

  // Resume a persisted claim, but only for the wallet that made it.
  useEffect(() => {
    if (!args.address) {
      // Nothing connected to be blocked on anymore — don't leave a stale
      // owner address displayed from a wallet that has since disconnected.
      setBlockedByOtherWallet(null)
      return
    }

    const own = loadPendingClaim(args.address)
    if (!own) {
      const otherOwner = peekPendingClaimAddress()
      setBlockedByOtherWallet(otherOwner && otherOwner !== args.address ? otherOwner : null)
      return
    }

    setBlockedByOtherWallet(null)
    const handle = deserializeHandle(own.handle)
    handleRef.current = handle
    directionRef.current = own.direction

    const tokens = args.tokens
    const resumedQuote: Quote = {
      inputs: {
        direction: own.direction,
        amountRaw: BigInt(own.amountInRaw),
        slippageBps: 0,
      },
      expectedOut: 0n,
      minOut: 0n,
      poolKey: own.handle.poolKey,
      tokenOutDecimals:
        own.direction === 'aleoToEth' ? (tokens?.eth.decimals ?? 18) : (tokens?.aleo.decimals ?? 6),
      tokenOutSymbol: own.direction === 'aleoToEth' ? 'ETH' : 'ALEO',
    }

    dispatch({ type: 'RESUME', quote: resumedQuote, requestTxId: own.requestTxId })

    // The primary crash-recovery path: a reload while a request is pending
    // restores `outputFinalizing` above, but there is no "Resume claim"
    // button for that tag — only the error states get one (see
    // `resumeClaim`) — so nothing else would ever drive it forward. The
    // claim must start itself here.
    //
    // `autoResumeAttempted` bounds THIS INSTANCE to at most one automatic
    // attempt, regardless of how many times this effect re-runs (tokens
    // resolving later, an unrelated client/api reconnect). It does not by
    // itself prevent a second instance (e.g. the user navigates away and
    // back, remounting this hook for the same wallet while an earlier
    // instance's claim promise is still orphaned in the background) from
    // also attempting one — `startClaim`'s `claimsInFlight` registry is
    // what catches that, across instances. If the automatic attempt fails,
    // `fail` lands the machine in an error state with `requestTxId` set,
    // and the user finishes it from there via the manual "Resume claim"
    // button — this does not retry silently forever.
    if (!autoResumeAttempted.current) {
      autoResumeAttempted.current = true
      // Fix 1 (CRITICAL): a wallet-path handle deserialized from storage
      // never carries `swapId`/`blindedAddress` unless `submit` already
      // recovered and re-persisted them (see `recoverAndPersist`) before the
      // reload happened. Without this, `claimSwapOutput` throws
      // unconditionally — the previous version called `startClaim` directly
      // here with no recovery step at all.
      startClaim(
        handle,
        own.direction,
        own.requestTxId,
        needsIdentityRecovery(handle)
          ? () => recoverAndPersist(handle, own.requestTxId, own.direction)
          : undefined,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.address, args.tokens, startClaim, recoverAndPersist])

  const requestQuote = useCallback(
    (inputs: QuoteInputs) => {
      if (!args.api || !args.tokens || isBusy(state)) return
      dispatch({ type: 'QUOTE_REQUESTED', inputs })

      const { tokenIn, tokenOut } = tokensFor(args.tokens, inputs.direction)
      effects
        .fetchQuote(deps, { inputs, tokenIn, tokenOut })
        .then((quote) => dispatch({ type: 'QUOTE_RECEIVED', quote }))
        .catch((error: unknown) =>
          dispatch({ type: 'QUOTE_FAILED', error: classifyQuoteError(error) }),
        )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, args.api, args.tokens, state],
  )

  const invalidateQuote = useCallback(() => dispatch({ type: 'INPUT_CHANGED' }), [])

  const submit = useCallback(
    (inputs: QuoteInputs) => {
      if (inFlight.current || isBusy(state) || !args.tokens || !args.address) return
      // SUBMIT is only legal from 'quoted' (Task 3's reducer) — expectedOut
      // below comes from that quote, and a stale/absent quote must never be
      // silently defaulted, since a zero expectedOut disables the SDK's
      // slippage protection entirely.
      if (state.tag !== 'quoted') return

      inFlight.current = true
      const quote = state.quote
      dispatch({ type: 'SUBMIT', inputs })

      const { tokenIn, inProgram, outProgram } = tokensFor(args.tokens, inputs.direction)

      void (async () => {
        try {
          const handle = await effects.submitSwap(deps, {
            direction: inputs.direction,
            amountInRaw: inputs.amountRaw,
            tokenInId: tokenIn.id,
            tokenInProgram: inProgram,
            tokenOutProgram: outProgram,
            expectedOut: quote.expectedOut,
            slippageBps: inputs.slippageBps,
          })

          handleRef.current = handle
          directionRef.current = inputs.direction
          const createdAt = Date.now()

          // Persisted BEFORE the wait: a reload during confirmation must still
          // be able to resume the claim.
          savePendingClaim({
            version: 1,
            address: args.address!,
            requestTxId: handle.transactionId,
            direction: inputs.direction,
            amountInRaw: inputs.amountRaw.toString(),
            handle: serializeHandle(handle),
            createdAt,
          })

          dispatch({ type: 'REQUEST_SUBMITTED', requestTxId: handle.transactionId })

          // Shield returns its own request handle, not an Aleo transaction id;
          // waitForTransaction resolves it and hands back the on-chain id.
          const onChainId = await effects.waitForTransaction(deps, handle.transactionId)
          if (onChainId !== handle.transactionId) {
            handle.transactionId = onChainId
            dispatch({ type: 'REQUEST_ID_RESOLVED', requestTxId: onChainId })
          }
          dispatch({ type: 'REQUEST_CONFIRMED' })

          const identity = await effects.recoverIdentity(deps, handle.transactionId, handle)
          handle.swapId = identity.swapId
          handle.blindedAddress = identity.blindedAddress

          // Fix 1(a): re-persist now that the handle carries a real
          // identity, so a reload after this point resumes straight into
          // the claim instead of repeating recovery.
          savePendingClaim({
            version: 1,
            address: args.address!,
            requestTxId: handle.transactionId,
            direction: inputs.direction,
            amountInRaw: inputs.amountRaw.toString(),
            handle: serializeHandle(handle),
            createdAt,
          })

          // Fix 2: register this requestTxId in the module-level registry
          // for the duration of the claim, the same registry `startClaim`
          // checks. `submit` calls `runClaim` directly rather than through
          // `startClaim` (its own `inFlight` guard is already held above,
          // so routing through `startClaim` would just self-decline), but
          // without this the registry never learns about a claim that
          // started on the normal first-time path — a remount mid-claim
          // would see nothing registered and let the resume effect start a
          // second, concurrent `claimSwapOutput` for the same handle.
          claimsInFlight.add(handle.transactionId)
          try {
            await runClaim(handle, inputs.direction)
          } finally {
            claimsInFlight.delete(handle.transactionId)
          }
        } catch (error) {
          fail(error)
        } finally {
          inFlight.current = false
        }
      })()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, args.tokens, args.address, state, runClaim, fail],
  )

  /**
   * Resumes a claim left over from a swap already submitted, either in this
   * session (an error state) or recovered from storage on a prior render
   * (`outputFinalizing` — normally finished automatically by the mount
   * effect above, but this remains a valid, safe entry point in case that
   * automatic attempt hasn't run yet or was never applicable).
   *
   * `CLAIM` is legal directly from `outputFinalizing`, so that path runs the
   * claim without touching the reducer first. `recoverableError` /
   * `terminalError` are different: `CLAIM` is NOT legal there (only
   * `outputFinalizing` accepts it), but a trade that failed after the
   * request went through lands in one of those tags, still carrying
   * `requestTxId`. Dispatching `CLAIM` straight from there used to be
   * silently ignored by the reducer while this hook went ahead and ran the
   * claim effect anyway — the displayed state would sit frozen on the error
   * while a claim was actually in flight underneath it. `RETRY_CLAIM` is the
   * additive event that moves the machine back to `outputFinalizing` first,
   * so `runClaim`'s own `CLAIM` dispatch lands somewhere it is legal and the
   * UI reflects what is actually happening.
   *
   * Guarded by `inFlight` up front (this instance) so the function never
   * starts the claim effect while nothing has actually changed — which
   * would reopen the exact "effect running under a frozen display" gap
   * this exists to close. The error-state branch additionally checks
   * `claimsInFlight` (module scope) BEFORE dispatching `RETRY_CLAIM`: if
   * some other instance's orphaned claim for this same `requestTxId` is
   * still outstanding, `startClaim` would decline to start a second one
   * anyway, and dispatching the machine into `outputFinalizing` right
   * before that happens would leave the display sitting on a state nothing
   * is actually driving forward — the very bug this whole mechanism exists
   * to prevent. `outputFinalizing` itself needs no such pre-check: it
   * dispatches nothing before calling `startClaim`, so a decline there is
   * silently, safely a no-op.
   */
  const resumeClaim = useCallback(() => {
    const handle = handleRef.current
    const direction = directionRef.current
    if (!handle || !direction || inFlight.current) return

    if (state.tag === 'outputFinalizing') {
      // CLAIM is already legal here; no RETRY_CLAIM needed. The handle can
      // still be identity-less here too — e.g. the automatic mount-time
      // attempt's own `prepare` step failed partway (say the confirmation
      // wait timed out) before assigning `swapId`/`blindedAddress` — so this
      // needs the same recovery fallback `startClaim` offers on the
      // automatic path (Fix 1).
      startClaim(
        handle,
        direction,
        state.requestTxId,
        needsIdentityRecovery(handle)
          ? () => recoverAndPersist(handle, state.requestTxId, direction)
          : undefined,
      )
      return
    }

    if (state.tag !== 'recoverableError' && state.tag !== 'terminalError') return
    const requestTxId = state.requestTxId
    if (requestTxId === undefined) return
    if (claimsInFlight.has(requestTxId)) return

    dispatch({ type: 'RETRY_CLAIM' })
    // Same reasoning as the `outputFinalizing` branch above: a failure that
    // happened before `submit` reached its own identity recovery (e.g. the
    // request confirmation wait failed) leaves `handle` without
    // `swapId`/`blindedAddress`, and this is the manual retry for exactly
    // that case (Fix 1).
    startClaim(
      handle,
      direction,
      requestTxId,
      needsIdentityRecovery(handle)
        ? () => recoverAndPersist(handle, requestTxId, direction)
        : undefined,
    )
  }, [state, startClaim, recoverAndPersist])

  const reset = useCallback(() => {
    // Only ever clear a claim the connected wallet itself owns.
    // `loadPendingClaim` returns null for one saved by a different address,
    // so an unowned claim in storage is left completely untouched here —
    // only its own wallet can ever derive the blinding factor needed to
    // resume it, so deleting it would permanently strand those funds.
    if (args.address && loadPendingClaim(args.address)) {
      clearPendingClaim()
    }
    handleRef.current = null
    directionRef.current = null
    dispatch({ type: 'RESET' })
  }, [args.address])

  return {
    state: state as SwapFlowState,
    busy: isBusy(state) || inFlight.current,
    blockedByOtherWallet,
    requestQuote,
    invalidateQuote,
    submit,
    resumeClaim,
    reset,
  }
}
