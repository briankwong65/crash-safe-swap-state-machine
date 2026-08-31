import {
  type ApiClient,
  type SwapPlan,
  type TokenInfo,
  planSwap as sdkPlanSwap,
} from '@provablehq/shield-swap-sdk'
import type { Client } from '@provablehq/veil-core'
import { POOL_KEY } from '../config'
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
  if (plan.multiHop || plan.poolKeys.length !== 1) {
    throw new WrongRouteError(
      'multi-hop',
      `Route returned ${plan.poolKeys.length} hops; only a direct swap through the pinned pool is allowed.`,
    )
  }

  const [only] = plan.poolKeys
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

const LIQUIDITY_HINTS = [
  'insufficient liquidity',
  'no route',
  'not tradeable',
  'exceeds',
  'liquidity',
]

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

  const message = error instanceof Error ? error.message : String(error)

  if (LIQUIDITY_HINTS.some((hint) => message.toLowerCase().includes(hint))) {
    return {
      kind: 'recoverable',
      message:
        'The direct ALEO/ETH pool cannot fill an amount this large right now. Reduce the amount and quote again.',
    }
  }

  if (message.includes('401') || message.includes('403')) {
    return {
      kind: 'recoverable',
      message: 'The DEX API rejected the request. Check that the API key is a valid testnet ss_ key.',
    }
  }

  return { kind: 'recoverable', message }
}
