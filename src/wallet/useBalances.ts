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

        // `getPrivateBalances` reads only `recordPlaintext`, so a Shield
        // connection scoped by a `recordAccess` grant — which returns
        // `recordView` instead — yields no key for either program. Fall back to
        // reading the wallet's records directly for whichever it omitted.
        const aleo =
          PROGRAMS.credits in byProgram
            ? (byProgram[PROGRAMS.credits] ?? 0n)
            : await sumProgramRecords(client, PROGRAMS.credits, 'microcredits')

        const eth =
          PROGRAMS.eth in byProgram
            ? (byProgram[PROGRAMS.eth] ?? 0n)
            : await sumProgramRecords(client, PROGRAMS.eth, 'amount')

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
export type RecordLike = {
  recordPlaintext?: string
  recordView?: { fields?: Record<string, string> }
}

/**
 * Reads an unsigned integer out of an Aleo field literal.
 *
 * A `recordView` field arrives as a literal such as `"1000000u64.private"`.
 * Parsed off the leading digits as a string so the value stays exact — routing
 * a u128 through `Number` would silently lose precision.
 */
function literalToBigInt(literal: string | undefined): bigint | null {
  if (!literal) return null
  const digits = /^\s*(\d+)/.exec(literal)
  if (!digits?.[1]) return null
  try {
    return BigInt(digits[1])
  } catch {
    return null
  }
}

/**
 * Sums one numeric field across the wallet's records, accepting BOTH record
 * shapes a wallet may return.
 *
 * Shield emits the privacy-extension envelope — `recordView.fields`, a flat map
 * of the fields the connect-time `recordAccess` grant permitted — and omits
 * `recordPlaintext` entirely. The SDK's own `getPrivateBalances` reads only
 * `recordPlaintext`, so against a grant-scoped Shield connection it parses
 * nothing and reports no balance at all. That is not a hypothetical: it is what
 * this application hit on a real wallet holding a real record.
 *
 * `recordView` is preferred when present, since it is already structured. The
 * `recordPlaintext` path stays for wallets that emit the legacy shape, and uses
 * the SDK's depth-aware `parseRecord` rather than a regex — a regex over raw
 * plaintext has no notion of structure and would match a field name nested
 * inside a composite value before the real top-level one.
 *
 * A record that carries neither shape, or lacks the field, is skipped rather
 * than thrown.
 */
export function sumRecordField(records: RecordLike[], field: string): bigint {
  return records.reduce<bigint>((total, record) => {
    const fromView = literalToBigInt(record.recordView?.fields?.[field])
    if (fromView !== null) return total + fromView

    const plaintext = record.recordPlaintext
    if (!plaintext) return total

    let parsed
    try {
      parsed = parseRecord(plaintext)
    } catch {
      return total
    }

    const amount = parsed.fields[field]?.value
    if (typeof amount !== 'bigint') return total

    return total + amount
  }, 0n)
}

/** Back-compatible alias: the credits case of {@link sumRecordField}. */
export function sumMicrocredits(records: RecordLike[]): bigint {
  return sumRecordField(records, 'microcredits')
}

/** Sums one field across a program's unspent records, via the wallet directly. */
async function sumProgramRecords(
  client: VeilClient,
  program: string,
  field: string,
): Promise<bigint> {
  try {
    const records = await client.requestRecords({ program, statusFilter: 'unspent' })
    // The return type is a union whose encrypted variant declares neither
    // `recordPlaintext` nor `recordView`, so it needs a cast to the shape
    // `sumRecordField` actually reads.
    return sumRecordField(records as RecordLike[], field)
  } catch {
    return 0n
  }
}
