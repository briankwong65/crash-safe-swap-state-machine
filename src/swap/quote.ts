import {
  type ApiClient,
  type SwapPlan,
  type TokenInfo,
  planSwap as sdkPlanSwap,
} from '@provablehq/shield-swap-sdk'
import type { Client } from '@provablehq/veil-core'
import { POOL_KEY } from '../config'
import { TransactionRejectedError } from './execute'
import type { FlowError, Quote, QuoteInputs } from './types'

export class WrongRouteError extends Error {
  constructor(
    readonly reason: 'multi-hop' | 'wrong-pool',
    message: string,
  ) {
    super(message)
    this.name = 'WrongRouteError'
  }
}

/**
 * Rejects anything but one hop through the pinned pool.
 *
 * Both conditions are checked independently: the plan's own `multiHop` flag is
 * not trusted on its own, because a route with two hops must be refused however
 * it is labelled.
 */
export function assertPinnedPlan(
  plan: Pick<SwapPlan, 'multiHop' | 'poolKeys'>,
  poolKey: string = POOL_KEY,
): void {
  // Defensive: a malformed plan (e.g. a bad API response) should still fail
  // closed as a route rejection, not as a raw TypeError that skips the
  // user-facing message in classifyQuoteError.
  const poolKeys = plan.poolKeys ?? []

  if (plan.multiHop || poolKeys.length !== 1) {
    throw new WrongRouteError(
      'multi-hop',
      `Route returned ${poolKeys.length} hops; only a direct swap through the pinned pool is allowed.`,
    )
  }

  const [only] = poolKeys
  if (only !== poolKey) {
    throw new WrongRouteError(
      'wrong-pool',
      `Route returned pool ${only}, not the pinned pool ${poolKey}.`,
    )
  }
}

export type QuoteDeps = { client: Client; api: ApiClient }

export type FetchQuoteParams = {
  inputs: QuoteInputs
  tokenIn: TokenInfo
  tokenOut: TokenInfo
}

/**
 * Fetches a quote pinned to the single permitted pool.
 *
 * `planSwap` is injected so tests exercise the validation without mocking the
 * SDK module.
 */
export async function fetchPinnedQuote(
  deps: QuoteDeps,
  { inputs, tokenIn, tokenOut }: FetchQuoteParams,
  planSwap: typeof sdkPlanSwap = sdkPlanSwap,
): Promise<Quote> {
  const plan = await planSwap(deps.client, deps.api, {
    from: tokenIn.id,
    to: tokenOut.id,
    amountIn: inputs.amountRaw,
    slippageBps: inputs.slippageBps,
  })

  assertPinnedPlan(plan)

  return {
    inputs,
    expectedOut: plan.expectedOut,
    minOut: plan.minOut,
    poolKey: plan.poolKeys[0]!,
    tokenOutDecimals: tokenOut.decimals,
    tokenOutSymbol: tokenOut.symbol,
  }
}

// Bare 'exceeds' used to be a hint on its own, which misfired on things like
// "Request exceeds rate limit" that have nothing to do with trade size. Only
// phrasing that names pool depth belongs here; 'liquidity' alone still covers
// most real messages, so the multi-word entries are there to be specific
// about size-related "exceeds" wording without matching every use of the verb.
const LIQUIDITY_HINTS = [
  'insufficient liquidity',
  'no route',
  'not tradeable',
  'exceeds available liquidity',
  'exceeds pool depth',
  'liquidity',
]

// Matches an HTTP 401/403 only as a standalone status-like token — e.g. the
// "(401)" in PinnedApiClient's `Route request failed (401): <body>` — and not
// as a substring of an unrelated number such as an amount, fee, or gas limit
// ("4033000000", "5403", "40312", "403000" must all miss this).
const AUTH_STATUS_PATTERN = /\b(?:401|403)\b/

// The user's `ss_...` API key must never reach a user-facing message. This is
// a last-resort scrub for the generic fallback below, which otherwise echoes
// whatever an upstream error/response says verbatim.
const API_KEY_PATTERN = /ss_[A-Za-z0-9_-]+/g

function redactApiKey(message: string): string {
  return message.replace(API_KEY_PATTERN, 'ss_[redacted]')
}

/** Maps a quote failure onto something a non-Aleo user can act on. */
export function classifyQuoteError(error: unknown): FlowError {
  if (error instanceof WrongRouteError) {
    return {
      kind: 'terminal',
      message:
        error.reason === 'multi-hop'
          ? 'The quote came back as a multi-hop route. This app only trades the one direct ALEO/ETH pool, so the quote was rejected.'
          : 'The quote came back for a different pool. This app only trades the one direct ALEO/ETH pool, so the quote was rejected.',
    }
  }

  if (error instanceof TransactionRejectedError) {
    return {
      kind: 'terminal',
      message:
        'The swap request was rejected on-chain at finalize — the trade did not go through and nothing was claimed. Get a fresh quote if you want to try again.',
    }
  }

  const message = error instanceof Error ? error.message : String(error)

  if (LIQUIDITY_HINTS.some((hint) => message.toLowerCase().includes(hint))) {
    return {
      kind: 'recoverable',
      message:
        'The direct ALEO/ETH pool cannot fill an amount this large right now. Reduce the amount and quote again.',
    }
  }

  if (AUTH_STATUS_PATTERN.test(message)) {
    return {
      kind: 'recoverable',
      message: 'The DEX API rejected the request. Check that the API key is a valid testnet ss_ key.',
    }
  }

  return { kind: 'recoverable', message: redactApiKey(message) }
}
