import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROGRAMS } from '../config'
import { sumMicrocredits, sumRecordField, useBalances } from './useBalances'

const OWNER = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp57xk'

function record(recordPlaintext: string) {
  return { recordPlaintext }
}

function creditsRecord(microcredits: bigint, nonce = '123group') {
  return record(
    `{ owner: ${OWNER}.private, microcredits: ${microcredits}u64.private, _nonce: ${nonce}.public }`,
  )
}

describe('sumMicrocredits', () => {
  it('reads a normal record', () => {
    expect(sumMicrocredits([creditsRecord(5000000n)])).toBe(5000000n)
  })

  it('accepts a zero-balance record', () => {
    expect(sumMicrocredits([creditsRecord(0n)])).toBe(0n)
  })

  it('skips a record with no plaintext instead of throwing', () => {
    expect(() => sumMicrocredits([{}, creditsRecord(1000n)])).not.toThrow()
    expect(sumMicrocredits([{}, creditsRecord(1000n)])).toBe(1000n)
  })

  it('skips a record whose plaintext fails to parse instead of throwing', () => {
    expect(sumMicrocredits([record('not a record plaintext'), creditsRecord(2000n)])).toBe(2000n)
  })

  it('takes the TOP-LEVEL microcredits value when one is also nested inside a composite field', () => {
    const plaintext = `{ owner: ${OWNER}.private, wrapped: { microcredits: 42u64.private }.private, microcredits: 7000000u64.private, _nonce: 123group.public }`
    expect(sumMicrocredits([record(plaintext)])).toBe(7000000n)
  })

  it('sums multiple records', () => {
    const total = sumMicrocredits([creditsRecord(1000000n), creditsRecord(2000000n), creditsRecord(3000000n)])
    expect(total).toBe(6000000n)
  })

  it('round-trips a u64-max value exactly as bigint', () => {
    const u64Max = 18446744073709551615n
    expect(sumMicrocredits([creditsRecord(u64Max)])).toBe(u64Max)
  })
})

const mockUseVeilClient = vi.fn()
vi.mock('./useVeilClient', () => ({
  useVeilClient: () => mockUseVeilClient(),
}))

afterEach(() => {
  mockUseVeilClient.mockReset()
})

describe('useBalances', () => {
  it('sums credits.aleo records via the fallback path, end to end, from a stubbed client.requestRecords', async () => {
    const requestRecords = vi.fn().mockResolvedValue([creditsRecord(5000000n), creditsRecord(2000000n)])
    const getPrivateBalances = vi.fn().mockResolvedValue({ [PROGRAMS.eth]: 250n })
    mockUseVeilClient.mockReturnValue({ client: { getPrivateBalances, requestRecords }, api: {} })

    const { result } = renderHook(() => useBalances('aleo1address'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.balances).toEqual({ aleo: 7000000n, eth: 250n })
    expect(requestRecords).toHaveBeenCalledWith({ program: PROGRAMS.credits, statusFilter: 'unspent' })
  })

  it('trusts a present-but-zero credits.aleo key and does not invoke the fallback', async () => {
    const requestRecords = vi.fn().mockResolvedValue([creditsRecord(999n)])
    const getPrivateBalances = vi.fn().mockResolvedValue({ [PROGRAMS.credits]: 0n, [PROGRAMS.eth]: 10n })
    mockUseVeilClient.mockReturnValue({ client: { getPrivateBalances, requestRecords }, api: {} })

    const { result } = renderHook(() => useBalances('aleo1address'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.balances).toEqual({ aleo: 0n, eth: 10n })
    expect(requestRecords).not.toHaveBeenCalled()
  })

  it('returns loading to false, with null balances, when address goes null mid-fetch', async () => {
    let resolveBalances: ((value: Record<string, bigint>) => void) | undefined
    const pending = new Promise<Record<string, bigint>>((resolve) => {
      resolveBalances = resolve
    })
    const getPrivateBalances = vi.fn().mockReturnValue(pending)
    mockUseVeilClient.mockReturnValue({
      client: { getPrivateBalances, requestRecords: vi.fn() },
      api: {},
    })

    const { result, rerender } = renderHook(({ address }: { address: string | null }) => useBalances(address), {
      initialProps: { address: 'aleo1address' as string | null },
    })

    await waitFor(() => expect(result.current.loading).toBe(true))

    rerender({ address: null })

    expect(result.current.loading).toBe(false)
    expect(result.current.balances).toBeNull()

    // The stale in-flight fetch resolving afterwards must not resurrect loading/balances.
    await act(async () => {
      resolveBalances?.({ [PROGRAMS.credits]: 1n })
      await pending
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.balances).toBeNull()
  })
})

describe('sumRecordField — recordView (Shield privacy-extension shape)', () => {
  it('reads a value from recordView.fields when there is no plaintext', () => {
    expect(
      sumRecordField([{ recordView: { fields: { microcredits: '1000000u64.private' } } }], 'microcredits'),
    ).toBe(1_000_000n)
  })

  it('reads an ETH amount as u128 exactly', () => {
    expect(
      sumRecordField(
        [{ recordView: { fields: { amount: '250000000000000000u128.private' } } }],
        'amount',
      ),
    ).toBe(250_000_000_000_000_000n)
  })

  it('sums across several recordView records', () => {
    expect(
      sumRecordField(
        [
          { recordView: { fields: { microcredits: '1000000u64.private' } } },
          { recordView: { fields: { microcredits: '2500000u64.private' } } },
        ],
        'microcredits',
      ),
    ).toBe(3_500_000n)
  })

  it('handles a literal with no visibility suffix', () => {
    expect(sumRecordField([{ recordView: { fields: { microcredits: '42u64' } } }], 'microcredits')).toBe(42n)
  })

  it('prefers recordView when both shapes are present', () => {
    expect(
      sumRecordField(
        [
          {
            recordView: { fields: { microcredits: '7u64.private' } },
            recordPlaintext: '{ owner: aleo1x.private, microcredits: 999u64.private, _nonce: 0group.public }',
          },
        ],
        'microcredits',
      ),
    ).toBe(7n)
  })

  it('still reads legacy recordPlaintext when recordView is absent', () => {
    expect(
      sumRecordField(
        [{ recordPlaintext: '{ owner: aleo1x.private, microcredits: 5000000u64.private, _nonce: 0group.public }' }],
        'microcredits',
      ),
    ).toBe(5_000_000n)
  })

  it('skips a record carrying neither shape, and one missing the field', () => {
    expect(sumRecordField([{}, { recordView: { fields: {} } }], 'microcredits')).toBe(0n)
  })

  it('skips a malformed literal rather than throwing', () => {
    expect(
      sumRecordField([{ recordView: { fields: { microcredits: 'not-a-number' } } }], 'microcredits'),
    ).toBe(0n)
  })
})
