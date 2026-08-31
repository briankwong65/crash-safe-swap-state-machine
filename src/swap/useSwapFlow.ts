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
  effects?: Partial<SwapFlowEffects>
}

function tokensFor(
  tokens: { aleo: TokenInfo; eth: TokenInfo },
  direction: QuoteInputs['direction'],
) {
  return direction === 'aleoToEth'
    ? { tokenIn: tokens.aleo, tokenOut: tokens.eth, inProgram: PROGRAMS.credits, outProgram: PROGRAMS.eth }
    : { tokenIn: tokens.eth, tokenOut: tokens.aleo, inProgram: PROGRAMS.eth, outProgram: PROGRAMS.credits }
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
    () => ({ client: args.client as never, api: args.api as ApiClient }),
    [args.client, args.api],
  )

  const fail = useCallback((error: unknown) => {
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
        tokenOutDecimals: tokenOut?.decimals ?? 18,
        tokenOutSymbol: tokenOut?.symbol ?? '',
      })

      clearPendingClaim()
      args.onClaimed?.()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, args.tokens, args.onClaimed],
  )

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
    // `autoResumeAttempted` bounds this to exactly one attempt per mounted
    // instance regardless of how many times this effect re-runs (tokens
    // resolving later, an unrelated client/api reconnect); `inFlight` is the
    // same guard every other entry point (`submit`, `resumeClaim`) uses, so
    // this can never overlap a manual call or start twice concurrently. If
    // the automatic attempt fails, `fail` lands the machine in an error
    // state with `requestTxId` set, and the user finishes it from there via
    // the manual "Resume claim" button — this does not retry silently
    // forever.
    if (!autoResumeAttempted.current && !inFlight.current) {
      autoResumeAttempted.current = true
      inFlight.current = true
      void runClaim(handle, own.direction)
        .catch(fail)
        .finally(() => {
          inFlight.current = false
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.address, args.tokens, runClaim, fail])

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

          // Persisted BEFORE the wait: a reload during confirmation must still
          // be able to resume the claim.
          savePendingClaim({
            version: 1,
            address: args.address!,
            requestTxId: handle.transactionId,
            direction: inputs.direction,
            amountInRaw: inputs.amountRaw.toString(),
            handle: serializeHandle(handle),
            createdAt: Date.now(),
          })

          dispatch({ type: 'REQUEST_SUBMITTED', requestTxId: handle.transactionId })

          await effects.waitForTransaction(deps, handle.transactionId)
          dispatch({ type: 'REQUEST_CONFIRMED' })

          const identity = await effects.recoverIdentity(deps, handle.transactionId, handle)
          handle.swapId = identity.swapId
          handle.blindedAddress = identity.blindedAddress

          await runClaim(handle, inputs.direction)
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
   * Every branch is guarded by `inFlight` (checked here, not just left to
   * the reducer) so this function never starts the claim effect while
   * nothing has actually changed — which would reopen the exact "effect
   * running under a frozen display" gap this exists to close, and would
   * risk a second, overlapping claim call racing the automatic one.
   */
  const resumeClaim = useCallback(() => {
    const handle = handleRef.current
    const direction = directionRef.current
    if (!handle || !direction || inFlight.current) return

    if (state.tag === 'outputFinalizing') {
      // CLAIM is already legal here; no RETRY_CLAIM needed.
      inFlight.current = true
      void runClaim(handle, direction)
        .catch(fail)
        .finally(() => {
          inFlight.current = false
        })
      return
    }

    const canRetryFromError =
      (state.tag === 'recoverableError' || state.tag === 'terminalError') &&
      state.requestTxId !== undefined
    if (!canRetryFromError) return

    dispatch({ type: 'RETRY_CLAIM' })
    inFlight.current = true
    void runClaim(handle, direction)
      .catch(fail)
      .finally(() => {
        inFlight.current = false
      })
  }, [runClaim, fail, state])

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
