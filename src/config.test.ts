import { describe, expect, it } from 'vitest'
import { DEX_API_BASE_URL, POOL_KEY, PROGRAMS } from './config'

describe('config', () => {
  it('pins the single permitted pool key', () => {
    expect(POOL_KEY).toBe(
      '5905392528088736716502352327676815883959790811081903315511484137973858480171field',
    )
  })

  it('lists every program the ALEO/ETH pair needs', () => {
    expect(Object.values(PROGRAMS)).toEqual([
      'credits.aleo',
      'shield_swap_arc20_credits.aleo',
      'test_arc20_eth.aleo',
      'test_arc20_multisig_core.aleo',
    ])
  })
})

describe('DEX_API_BASE_URL', () => {
  it('is absolute, because the SDK builds requests with single-argument new URL()', () => {
    expect(() => new URL(`${DEX_API_BASE_URL}/tokens`)).not.toThrow()
  })

  it('keeps the /shield-api proxy path in dev so CORS is still avoided', () => {
    if (import.meta.env.DEV) {
      expect(DEX_API_BASE_URL).toContain('/shield-api')
    } else {
      expect(DEX_API_BASE_URL).toBe('https://api.testnet.swap.shield.fi')
    }
  })
})
