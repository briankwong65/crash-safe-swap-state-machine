import {
  SHIELD_SWAP,
  SHIELD_SWAP_ALGORITHM_GRANTS,
  SHIELD_SWAP_ROUTER,
} from '@provablehq/shield-swap-sdk'
import { describe, expect, it } from 'vitest'
import {
  ALGORITHM_GRANTS,
  RECORD_ACCESS,
  SWAP_PROGRAMS,
  aleoRecordRequest,
  ethRecordRequest,
} from './walletConfig'

describe('program list', () => {
  it('includes both DEX programs and every token program the pair needs', () => {
    for (const program of [
      SHIELD_SWAP,
      SHIELD_SWAP_ROUTER,
      'credits.aleo',
      'shield_swap_arc20_credits.aleo',
      'test_arc20_eth.aleo',
      'test_arc20_multisig_core.aleo',
    ]) {
      expect(SWAP_PROGRAMS).toContain(program)
    }
  })

  it('lists each program once', () => {
    expect(new Set(SWAP_PROGRAMS).size).toBe(SWAP_PROGRAMS.length)
  })
})

describe('algorithm grants', () => {
  it('scopes the router grants to the core AMM program', () => {
    const routerGrants = ALGORITHM_GRANTS.filter((g) => g.program === SHIELD_SWAP_ROUTER)
    expect(routerGrants.length).toBeGreaterThan(0)
    for (const grant of routerGrants) {
      expect(grant.scopeProgram).toBe(SHIELD_SWAP)
    }
  })

  it('leaves non-router grants exactly as the SDK provides them', () => {
    const others = ALGORITHM_GRANTS.filter((g) => g.program !== SHIELD_SWAP_ROUTER)
    const sdkOthers = SHIELD_SWAP_ALGORITHM_GRANTS.filter(
      (g) => g.program !== SHIELD_SWAP_ROUTER,
    )
    expect(others).toEqual(sdkOthers)
  })

  it('grants one entry per SDK grant, adding none', () => {
    expect(ALGORITHM_GRANTS).toHaveLength(SHIELD_SWAP_ALGORITHM_GRANTS.length)
  })
})

describe('record requests', () => {
  it('asks for one credits record covering the full ALEO amount', () => {
    expect(aleoRecordRequest(1_500_000n)).toEqual({
      type: 'record',
      program: 'credits.aleo',
      recordname: 'credits',
      filters: { microcredits: { gte: '1500000u64' } },
    })
  })

  it('asks for one Token record covering the full ETH amount', () => {
    expect(ethRecordRequest(250_000_000_000_000_000n)).toEqual({
      type: 'record',
      program: 'test_arc20_eth.aleo',
      recordname: 'Token',
      filters: { amount: { gte: '250000000000000000u128' } },
    })
  })
})

describe('record access', () => {
  // Fix 6 (final review): substring-matching the serialized grant passes
  // even on a STRUCTURALLY INVERTED grant (e.g. credits.aleo granting
  // 'amount' and test_arc20_eth.aleo granting 'microcredits') — the string
  // `JSON.stringify(RECORD_ACCESS)` still contains both words regardless of
  // which program they're attached to. A wrong grant here only fails
  // against a live wallet, so this exact object shape is the only static
  // guard on a security-relevant config; `toEqual` on the whole object
  // pins the program each field is scoped to, not just the words' presence.
  it('permits resolving credits by microcredits and Token by amount, scoped to the right program each', () => {
    expect(RECORD_ACCESS).toEqual({
      level: 'byProgram',
      programs: [
        {
          program: 'credits.aleo',
          records: [{ recordname: 'credits', fields: [{ name: 'microcredits' }] }],
        },
        {
          program: 'test_arc20_eth.aleo',
          records: [{ recordname: 'Token', fields: [{ name: 'amount' }] }],
        },
      ],
    })
  })
})
