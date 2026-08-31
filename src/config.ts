/** The one pool this application is allowed to trade through. */
export const POOL_KEY =
  '5905392528088736716502352327676815883959790811081903315511484137973858480171field'

export const ALEO_NODE_ORIGIN = 'https://api.provable.com/v2'

/**
 * Chain reads go through the Vite proxy in dev for the same reason the DEX API
 * does — the browser blocks the cross-origin request, and a failed read takes
 * down quoting and transaction confirmation alike. Absolute, because the SDK's
 * HTTP transport and our own transaction reads both build URLs from it.
 */
function devAleoNodeUrl(): string {
  const origin = globalThis.location?.origin
  return origin ? `${origin}/aleo-api` : ALEO_NODE_ORIGIN
}

export const ALEO_NODE_URL = import.meta.env.DEV ? devAleoNodeUrl() : ALEO_NODE_ORIGIN

export const DEX_API_ORIGIN = 'https://api.testnet.swap.shield.fi'

/**
 * Dev requests go through the Vite proxy to avoid browser CORS; a production
 * build talks to the service directly.
 *
 * The dev value must be ABSOLUTE, not the bare `/shield-api` path. The SDK
 * builds every request as `new URL(this.baseUrl + path)`, and single-argument
 * `URL()` rejects a relative string with "Failed to construct 'URL': Invalid
 * URL" — which took down every inherited ApiClient method (getTokens, getPools,
 * getSwap) while our own getRoute override, which hands a relative path
 * straight to fetch, kept working. Prefixing the current origin keeps the Vite
 * proxy in the path, so CORS is still avoided.
 */
function devApiBaseUrl(): string {
  const origin = globalThis.location?.origin
  return origin ? `${origin}/shield-api` : DEX_API_ORIGIN
}

export const DEX_API_BASE_URL = import.meta.env.DEV ? devApiBaseUrl() : DEX_API_ORIGIN

export const EXPLORER_BASE_URL = 'https://testnet.explorer.provable.com'

/** Programs the wallet must grant this application access to. */
export const PROGRAMS = {
  credits: 'credits.aleo',
  aleoWrapper: 'shield_swap_arc20_credits.aleo',
  eth: 'test_arc20_eth.aleo',
  ethMultisig: 'test_arc20_multisig_core.aleo',
} as const

export const TOKEN_SYMBOLS = { aleo: 'ALEO', eth: 'ETH' } as const
