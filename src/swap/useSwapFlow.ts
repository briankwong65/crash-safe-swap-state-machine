import type { ApiClient, SwapHandle, TokenInfo } from '@provablehq/shield-swap-sdk'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
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

  const deps = { client: args.client as never, api: args.api as ApiClient }

  const fail = useCallback((error: unknown) => {
    dispatch({ type: 'FAILED', error: classifyQuoteError(error) })
    inFlight.current = false
  }, [])

  // Resume a persisted claim, but only for the wallet that made it.
  useEffect(() => {
    if (!args.address) return

    const own = loadPendingClaim(args.address)
    if (!own) {
      const otherOwner = peekPendingClaimAddress()
      setBlockedByOtherWallet(otherOwner && otherOwner !== args.address ? otherOwner : null)
      return
    }

    setBlockedByOtherWallet(null)
    handleRef.current = deserializeHandle(own.handle)
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
  }, [args.address, args.tokens])

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
    [args.api, args.tokens, state],
  )

  const invalidateQuote = useCallback(() => dispatch({ type: 'INPUT_CHANGED' }), [])

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
    [args.tokens, args.onClaimed],
  )

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
    [args.tokens, args.address, state, runClaim, fail],
  )

  /**
   * Resumes a claim left over from a swap already submitted in this session.
   *
   * `CLAIM` is legal only from `outputFinalizing`, but a trade that failed
   * after the request went through lands in `recoverableError` /
   * `terminalError` (still carrying `requestTxId`). Dispatching `CLAIM`
   * straight from there used to be silently ignored by the reducer while this
   * hook went ahead and ran the claim effect anyway — the displayed state
   * would sit frozen on the error while a claim was actually in flight
   * underneath it. `RETRY_CLAIM` is the additive event that moves the machine
   * back to `outputFinalizing` first, so `runClaim`'s own `CLAIM` dispatch
   * lands somewhere it is legal and the UI reflects what is actually
   * happening.
   *
   * The dispatch is a no-op unless `state` is genuinely one of those error
   * states with a `requestTxId` — checked here too (not just left to the
   * reducer) so this function never starts the claim effect while the machine
   * itself stayed put, which would reopen the exact "effect running under a
   * frozen display" gap this exists to close.
   */
  const resumeClaim = useCallback(() => {
    const handle = handleRef.current
    const direction = directionRef.current
    const canRetry =
      (state.tag === 'recoverableError' || state.tag === 'terminalError') &&
      state.requestTxId !== undefined

    if (!handle || !direction || !canRetry || inFlight.current) return

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
