import { beforeEach, describe, expect, it } from 'vitest'
import {
  PENDING_CLAIM_KEY,
  clearPendingClaim,
  deserializeHandle,
  loadPendingClaim,
  peekPendingClaimAddress,
  savePendingClaim,
  serializeHandle,
} from './pendingClaim'
import type { PendingClaim } from './types'

const OWNER = 'aleo1owner'
const OTHER = 'aleo1someoneelse'

const handle = {
  tokenInId: 'aleo-id-field',
  tokenOutId: 'eth-id-field',
  poolKey: 'pool-field',
  amountIn: 100_000n,
  zeroForOne: true,
  sqrtPriceLimit: 340_282_366_920_938_463_463_374_607_431_768_211_455n,
  nonce: 42n,
  transactionId: 'at1req',
  program: 'shield_swap.aleo',
}

const claim: PendingClaim = {
  version: 1,
  address: OWNER,
  requestTxId: 'at1req',
  direction: 'aleoToEth',
  amountInRaw: '100000',
  handle: serializeHandle(handle as never),
  createdAt: 1_700_000_000_000,
}

describe('handle serialization', () => {
  it('round-trips bigint fields through JSON without loss', () => {
    const json = JSON.stringify(serializeHandle(handle as never))
    const restored = deserializeHandle(JSON.parse(json))

    expect(restored.amountIn).toBe(100_000n)
    expect(restored.sqrtPriceLimit).toBe(
      340_282_366_920_938_463_463_374_607_431_768_211_455n,
    )
    expect(restored.nonce).toBe(42n)
    expect(restored.zeroForOne).toBe(true)
    expect(restored.transactionId).toBe('at1req')
  })

  it('leaves absent optional bigints undefined rather than zero', () => {
    const restored = deserializeHandle(
      serializeHandle({ ...handle, nonce: undefined, sqrtPriceLimit: undefined } as never),
    )
    expect(restored.nonce).toBeUndefined()
    expect(restored.sqrtPriceLimit).toBeUndefined()
  })

  it('never carries a blinding factor', () => {
    const serialized = serializeHandle({ ...handle, blindingFactor: 'secret' } as never)
    expect(JSON.stringify(serialized)).not.toContain('secret')
    expect('blindingFactor' in serialized).toBe(false)
  })
})

describe('pending claim storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('resumes a saved claim for the same wallet after a reload', () => {
    savePendingClaim(claim)

    // Simulates a fresh page load reading the same storage.
    const resumed = loadPendingClaim(OWNER)

    expect(resumed).not.toBeNull()
    expect(resumed!.requestTxId).toBe('at1req')
    expect(deserializeHandle(resumed!.handle).amountIn).toBe(100_000n)
  })

  it('refuses to resume another wallet claim and leaves it in place', () => {
    savePendingClaim(claim)

    expect(loadPendingClaim(OTHER)).toBeNull()
    expect(peekPendingClaimAddress()).toBe(OWNER)
    expect(loadPendingClaim(OWNER)).not.toBeNull()
  })

  it('reports the owning address so the UI can explain the block', () => {
    expect(peekPendingClaimAddress()).toBeNull()
    savePendingClaim(claim)
    expect(peekPendingClaimAddress()).toBe(OWNER)
  })

  it('clears the claim once it is done', () => {
    savePendingClaim(claim)
    clearPendingClaim()
    expect(loadPendingClaim(OWNER)).toBeNull()
    expect(localStorage.getItem(PENDING_CLAIM_KEY)).toBeNull()
  })

  it('ignores an unreadable or wrong-version record instead of throwing', () => {
    localStorage.setItem(PENDING_CLAIM_KEY, 'not json')
    expect(loadPendingClaim(OWNER)).toBeNull()

    localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ ...claim, version: 99 }))
    expect(loadPendingClaim(OWNER)).toBeNull()
  })

  it('never stores the API key or a blinding factor', () => {
    savePendingClaim(claim)
    const raw = localStorage.getItem(PENDING_CLAIM_KEY)!
    expect(raw).not.toContain('ss_')
    expect(raw).not.toContain('blindingFactor')
  })

  it('returns null instead of throwing when getItem itself throws', () => {
    const throwingStorage: Storage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }

    expect(loadPendingClaim(OWNER, throwingStorage)).toBeNull()
    expect(peekPendingClaimAddress(throwingStorage)).toBeNull()
  })

  it('ignores a same-version record missing the handle', () => {
    localStorage.setItem(
      PENDING_CLAIM_KEY,
      JSON.stringify({
        version: 1,
        address: OWNER,
        requestTxId: 'at1req',
        direction: 'aleoToEth',
        amountInRaw: '100000',
        createdAt: 1_700_000_000_000,
      }),
    )
    expect(loadPendingClaim(OWNER)).toBeNull()
  })

  it('ignores a record missing the address', () => {
    localStorage.setItem(
      PENDING_CLAIM_KEY,
      JSON.stringify({
        version: 1,
        requestTxId: 'at1req',
        direction: 'aleoToEth',
        amountInRaw: '100000',
        handle: claim.handle,
        createdAt: 1_700_000_000_000,
      }),
    )
    expect(loadPendingClaim(OWNER)).toBeNull()
    expect(peekPendingClaimAddress()).toBeNull()
  })

  it('ignores a record whose handle is present but missing required fields', () => {
    const brokenHandle = { ...claim.handle } as Record<string, unknown>
    delete brokenHandle.tokenInId
    localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ ...claim, handle: brokenHandle }))
    expect(loadPendingClaim(OWNER)).toBeNull()
  })

  it('refuses to resume with an empty-string address even when a record exists', () => {
    savePendingClaim(claim)
    expect(loadPendingClaim('')).toBeNull()
  })
})
