import { describe, expect, it } from 'vitest'
import { POOL_KEY, PROGRAMS } from './config'

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
