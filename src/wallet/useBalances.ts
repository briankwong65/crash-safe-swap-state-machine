import { parseRecord } from '@provablehq/veil-core'
import { useCallback, useEffect, useState } from 'react'
import { PROGRAMS } from '../config'
import { type VeilClient, useVeilClient } from './useVeilClient'

type Balances = { aleo: bigint; eth: bigint }

/**
 * Private, spendable balances — the tokens live as records, so a public balance
 * read shows zero on a funded account.
 *
 * `getPrivateBalances` DOES cover native `credits.aleo` records: reading the
 * SDK's compiled source (`parseTokenRecordInfo` / `getPrivateBalances` in
 * `@provablehq/shield-swap-sdk`'s `chunk-BRTZZVRZ.js`) shows it reads either
 * an ARC-20 `amount` field or a native `microcredits` field off each parsed
 * record, and keys a record with no `token_id` (which is what every
 * `credits.aleo` record is) under the bare program name — exactly the key
 * this hook reads. The fallback below is defensive insurance only, in case a
 * future SDK version stops handling native records this way; it is triggered
 * by the `credits.aleo` key being ABSENT from the result, not by the balance
 * being zero, so a wallet that genuinely holds no ALEO never pays for a full
 * record re-scan on every refresh.
 */
export function useBalances(address: string | null) {
  const { client } = useVeilClient()
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client || !address) {
      setBalances(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const byProgram = await client.getPrivateBalances({
          programs: [PROGRAMS.credits, PROGRAMS.eth],
        })

        // Temporary live-integration diagnostic, opt-in from the console with
        // `window.__debugBalances = true` then Refresh. Logs SHAPE only — never
        // a record's plaintext, which carries the user's amounts.
        if (import.meta.env.DEV && (globalThis as { __debugBalances?: boolean }).__debugBalances) {
          try {
            const raw = await client.requestRecords({
              program: PROGRAMS.credits,
              statusFilter: 'unspent',
            })
            console.info('[balances] getPrivateBalances keys:', Object.keys(byProgram))
            console.info('[balances] getPrivateBalances values:', byProgram)
            console.info('[balances] credits records returned:', Array.isArray(raw) ? raw.length : typeof raw)
            const first = Array.isArray(raw) ? raw[0] : undefined
            console.info('[balances] first record keys:', first ? Object.keys(first) : 'none')
            console.info(
              '[balances] first record has plaintext:',
              Boolean(first && 'recordPlaintext' in first && first.recordPlaintext),
            )
          } catch (diagError) {
            console.warn('[balances] requestRecords threw:', diagError)
          }
        }

        const hasNativeAleo = PROGRAMS.credits in byProgram
        let aleo = byProgram[PROGRAMS.credits] ?? 0n
        const eth = byProgram[PROGRAMS.eth] ?? 0n

        if (!hasNativeAleo) {
          aleo = await sumCreditsRecords(client)
        }

        if (!cancelled) setBalances({ aleo, eth })
      } catch {
        if (!cancelled) setBalances(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [client, address, nonce])

  return { balances, loading, refresh }
}

/**
 * Sums the `microcredits` field of parsed record plaintexts.
 *
 * Uses the SDK's own depth-aware `parseRecord` (from `@provablehq/veil-core`,
 * the same parser `getPrivateBalances` uses internally) instead of a flat
 * regex — a regex over raw plaintext has no notion of structure and would
 * match a `microcredits` key nested inside a composite field before the real
 * top-level one. `parseRecord(...).fields` holds only top-level record
 * entries, so `fields.microcredits` is unambiguous.
 *
 * A record whose plaintext is missing or fails to parse (not valid record
 * plaintext, or has no `microcredits` field at all) is skipped rather than
 * thrown — exported for direct unit testing of this parsing path.
 */
export function sumMicrocredits(records: Array<{ recordPlaintext?: string }>): bigint {
  return records.reduce<bigint>((total, record) => {
    const plaintext = record.recordPlaintext
    if (!plaintext) return total

    let parsed
    try {
      parsed = parseRecord(plaintext)
    } catch {
      return total
    }

    const amount = parsed.fields.microcredits?.value
    if (typeof amount !== 'bigint') return total

    return total + amount
  }, 0n)
}

/** Fallback: sum `microcredits` across the wallet's unspent `credits.aleo` records. */
async function sumCreditsRecords(client: VeilClient): Promise<bigint> {
  try {
    const records = await client.requestRecords({
      program: PROGRAMS.credits,
      statusFilter: 'unspent',
    })
    // `OwnedRecordEncrypted` (no plaintext, e.g. when the wallet withholds it)
    // has no `recordPlaintext` property at all, so the union needs a cast to
    // the narrower shape `sumMicrocredits` actually reads.
    return sumMicrocredits(records as Array<{ recordPlaintext?: string }>)
  } catch {
    return 0n
  }
}
