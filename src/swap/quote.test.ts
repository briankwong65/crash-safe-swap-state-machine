import { describe, expect, it, vi } from 'vitest'
import { POOL_KEY } from '../config'
import {
  WrongRouteError,
  assertPinnedPlan,
  classifyQuoteError,
  fetchPinnedQuote,
} from './quote'
import type { QuoteInputs } from './types'

const OTHER_POOL = '999999field'

const tokenIn = { id: 'aleo-id-field', symbol: 'ALEO', decimals: 6 }
const tokenOut = { id: 'eth-id-field', symbol: 'ETH', decimals: 18 }

const inputs: QuoteInputs = {
  direction: 'aleoToEth',
  amountRaw: 100_000n,
  slippageBps: 50,
}

describe('assertPinnedPlan', () => {
  it('accepts a single hop through the pinned pool', () => {
    expect(() =>
      assertPinnedPlan({ multiHop: false, poolKeys: [POOL_KEY] }),
    ).not.toThrow()
  })

  it('rejects a multi-hop route', () => {
    expect(() =>
      assertPinnedPlan({ multiHop: true, poolKeys: [POOL_KEY, OTHER_POOL] }),
    ).toThrow(WrongRouteError)
  })

  it('rejects two hops even when the flag says otherwise', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: [POOL_KEY, OTHER_POOL] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('multi-hop')
    }
  })

  it('rejects a single hop through a different pool', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: [OTHER_POOL] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('wrong-pool')
    }
  })

  it('rejects an empty route', () => {
    expect(() => assertPinnedPlan({ multiHop: false, poolKeys: [] })).toThrow(
      WrongRouteError,
    )
  })

  it('rejects a malformed plan with undefined poolKeys as a route rejection, not a TypeError', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: undefined } as never)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('multi-hop')
    }
  })

  it('rejects a case-shifted pool key', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: [POOL_KEY.toUpperCase()] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('wrong-pool')
    }
  })

  it('rejects a whitespace-padded pool key', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: [` ${POOL_KEY} `] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('wrong-pool')
    }
  })

  it('rejects a pool key that is a prefix of the pinned key', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: [POOL_KEY.slice(0, -5)] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('wrong-pool')
    }
  })

  it('rejects a pool key that is a superstring of the pinned key', () => {
    try {
      assertPinnedPlan({ multiHop: false, poolKeys: [`${POOL_KEY}9`] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WrongRouteError)
      expect((error as WrongRouteError).reason).toBe('wrong-pool')
    }
  })
})

describe('fetchPinnedQuote', () => {
  const deps = { client: {} as never, api: {} as never }

  it('returns a quote carrying the inputs it was fetched for', async () => {
    const planSwap = vi.fn(async () => ({
      multiHop: false,
      poolKeys: [POOL_KEY],
      expectedOut: 5_000n,
      minOut: 4_975n,
      imports: { 'credits.aleo': 'program' },
    }))

    const quote = await fetchPinnedQuote(deps, { inputs, tokenIn, tokenOut }, planSwap as never)

    expect(quote.inputs).toEqual(inputs)
    expect(quote.expectedOut).toBe(5_000n)
    expect(quote.minOut).toBe(4_975n)
    expect(quote.poolKey).toBe(POOL_KEY)
    expect(quote.tokenOutSymbol).toBe('ETH')
    expect(quote.tokenOutDecimals).toBe(18)
  })

  it('passes raw base units and the slippage to planSwap', async () => {
    const planSwap = vi.fn(async () => ({
      multiHop: false,
      poolKeys: [POOL_KEY],
      expectedOut: 5_000n,
      minOut: 4_975n,
      imports: {},
    }))

    await fetchPinnedQuote(deps, { inputs, tokenIn, tokenOut }, planSwap as never)

    expect(planSwap).toHaveBeenCalledWith(deps.client, deps.api, {
      from: tokenIn.id,
      to: tokenOut.id,
      amountIn: 100_000n,
      slippageBps: 50,
    })
  })

  it('never returns a quote for a multi-hop plan', async () => {
    const planSwap = vi.fn(async () => ({
      multiHop: true,
      poolKeys: [POOL_KEY, OTHER_POOL],
      expectedOut: 5_000n,
      minOut: 4_975n,
      imports: {},
    }))

    await expect(
      fetchPinnedQuote(deps, { inputs, tokenIn, tokenOut }, planSwap as never),
    ).rejects.toBeInstanceOf(WrongRouteError)
  })
})

describe('classifyQuoteError', () => {
  it('treats a wrong route as terminal, never a fallback', () => {
    const error = classifyQuoteError(new WrongRouteError('wrong-pool', 'nope'))
    expect(error.kind).toBe('terminal')
    expect(error.message).toMatch(/pool/i)
  })

  it('treats thin liquidity as recoverable and asks for a smaller amount', () => {
    const error = classifyQuoteError(new Error('pool has insufficient liquidity'))
    expect(error.kind).toBe('recoverable')
    expect(error.message).toMatch(/reduce/i)
  })

  it('treats an unauthorised key as recoverable', () => {
    const error = classifyQuoteError(new Error('Route request failed (401): unauthorized'))
    expect(error.kind).toBe('recoverable')
    expect(error.message).toMatch(/API key/i)
  })

  it('treats a forbidden response as recoverable, matching only the standalone status', () => {
    const error = classifyQuoteError(new Error('Route request failed (403): forbidden'))
    expect(error.kind).toBe('recoverable')
    expect(error.message).toMatch(/API key/i)
  })

  it('treats a tightened liquidity-exceeded message as recoverable and asks for a smaller amount', () => {
    const error = classifyQuoteError(new Error('Trade amount exceeds available liquidity for this pool'))
    expect(error.kind).toBe('recoverable')
    expect(error.message).toMatch(/reduce/i)
  })

  it('falls back to a recoverable generic message', () => {
    const error = classifyQuoteError(new Error('socket hang up'))
    expect(error.kind).toBe('recoverable')
    expect(error.message).toContain('socket hang up')
  })

  describe('does not misfire on incidental digits or the bare word "exceeds"', () => {
    const cases: Array<[string, string]> = [
      ['an invalid-amount message with digits that contain 403', 'Amount 4033000000 is invalid'],
      ['a 5xx message with digits that contain 403', 'Server error 5403: internal failure'],
      ['a fee-too-low message with digits that contain 403', 'Transaction fee 40312 too low'],
      ['a gas-limit message with digits that contain 403', 'Gas limit 403000 exceeded for this call'],
      ['a rate-limit message using the bare word "exceeds"', 'Request exceeds rate limit, try again later'],
    ]

    it.each(cases)('%s is not reported as an API-key or liquidity problem', (_label, rawMessage) => {
      const error = classifyQuoteError(new Error(rawMessage))
      expect(error.kind).toBe('recoverable')
      expect(error.message).not.toMatch(/API key/i)
      expect(error.message).not.toMatch(/reduce/i)
      // Unrecognised shapes fall back to the original message verbatim.
      expect(error.message).toBe(rawMessage)
    })
  })

  it('redacts an ss_ API key from a fallback message rather than echoing it', () => {
    const error = classifyQuoteError(
      new Error('Route request failed (500): saw header Authorization: Bearer ss_abcDEF123-secret_value'),
    )
    expect(error.kind).toBe('recoverable')
    expect(error.message).not.toContain('ss_abcDEF123-secret_value')
    expect(error.message).not.toMatch(/ss_[A-Za-z0-9_-]*secret/i)
  })
})
