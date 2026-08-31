import { describe, expect, it } from 'vitest'
import { pickPairTokens } from './useTokens'

const registry = [
  { id: 'usdc-field', symbol: 'USDCx', decimals: 6 },
  { id: 'aleo-field', symbol: 'ALEO', decimals: 6, ammTokenProgram: 'shield_swap_arc20_credits.aleo' },
  { id: 'eth-field', symbol: 'ETH', decimals: 18, ammTokenProgram: 'test_arc20_eth.aleo' },
]

describe('pickPairTokens', () => {
  it('selects ALEO and ETH from the registry', () => {
    const pair = pickPairTokens(registry)
    expect(pair.aleo.id).toBe('aleo-field')
    expect(pair.eth.id).toBe('eth-field')
  })

  it('takes decimals from the registry rather than assuming them', () => {
    const pair = pickPairTokens(registry)
    expect(pair.aleo.decimals).toBe(6)
    expect(pair.eth.decimals).toBe(18)
  })

  it('matches symbols case-insensitively', () => {
    const pair = pickPairTokens([
      { id: 'a', symbol: 'aleo', decimals: 6 },
      { id: 'e', symbol: 'eth', decimals: 18 },
    ])
    expect(pair.aleo.id).toBe('a')
    expect(pair.eth.id).toBe('e')
  })

  it('throws naming the symbol it could not find', () => {
    expect(() => pickPairTokens([{ id: 'a', symbol: 'ALEO', decimals: 6 }])).toThrow(/ETH/)
  })
})
