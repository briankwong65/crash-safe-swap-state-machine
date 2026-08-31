/** The one pool this application is allowed to trade through. */
export const POOL_KEY =
  '5905392528088736716502352327676815883959790811081903315511484137973858480171field'

export const ALEO_NODE_URL = 'https://api.provable.com/v2'

/**
 * Dev requests go through the Vite proxy to avoid browser CORS; a production
 * build talks to the service directly.
 */
export const DEX_API_BASE_URL = import.meta.env.DEV
  ? '/shield-api'
  : 'https://api.testnet.swap.shield.fi'

export const EXPLORER_BASE_URL = 'https://testnet.explorer.provable.com'

/** Programs the wallet must grant this application access to. */
export const PROGRAMS = {
  credits: 'credits.aleo',
  aleoWrapper: 'shield_swap_arc20_credits.aleo',
  eth: 'test_arc20_eth.aleo',
  ethMultisig: 'test_arc20_multisig_core.aleo',
} as const

export const TOKEN_SYMBOLS = { aleo: 'ALEO', eth: 'ETH' } as const
