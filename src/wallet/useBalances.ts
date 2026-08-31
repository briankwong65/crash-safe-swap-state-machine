import { useCallback, useEffect, useState } from 'react'
import { PROGRAMS } from '../config'
import { type VeilClient, useVeilClient } from './useVeilClient'

type Balances = { aleo: bigint; eth: bigint }

/** Matches `microcredits: 1234u64.private` (or `.public`) in a record's plaintext. */
const MICROCREDITS_PATTERN = /microcredits:\s*(\d+)u64/

/**
 * Private, spendable balances — the tokens live as records, so a public balance
 * read shows zero on a funded account.
 *
 * `getPrivateBalances` sums unspent records per program, but its keys are
 * documented as `program` for wrapper-token records and `program/token_id`
 * for registry records — `credits.aleo` native records (which carry
 * `microcredits`, not an ARC-20 `amount`/`token_id`) fit neither shape
 * cleanly, so the helper may not report anything under the bare
 * `credits.aleo` key. When it does not, `credits.aleo`'s own unspent records
 * are fetched directly and their `microcredits` fields summed. Which path is
 * live is confirmed against a real wallet during integration.
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
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const byProgram = await client.getPrivateBalances({
          programs: [PROGRAMS.credits, PROGRAMS.eth],
        })

        let aleo = byProgram[PROGRAMS.credits] ?? 0n
        const eth = byProgram[PROGRAMS.eth] ?? 0n

        if (aleo === 0n) {
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
 * Fallback: sum `microcredits` across the wallet's unspent `credits.aleo`
 * records.
 *
 * The brief called this via `client.transport.requestRecords(...)`, but the
 * SDK's `Transport` type is only `{ config, request }` — it carries no
 * `requestRecords` method. The real method lives directly on the wallet
 * client (`WalletActions.requestRecords`, part of the composed client
 * returned by `useVeilClient`), so this calls `client.requestRecords(...)`
 * instead. Its records are `OwnedRecord[]`, whose plaintext is the raw Aleo
 * string on `recordPlaintext` — there is no parsed `.data.microcredits`
 * field — so `microcredits` is pulled out with a regex instead of a
 * property read.
 */
async function sumCreditsRecords(client: VeilClient): Promise<bigint> {
  try {
    const records = await client.requestRecords({
      program: PROGRAMS.credits,
      statusFilter: 'unspent',
    })

    return records.reduce<bigint>((total, record) => {
      const plaintext = (record as { recordPlaintext?: string }).recordPlaintext
      if (!plaintext) return total
      const match = MICROCREDITS_PATTERN.exec(plaintext)
      const amount = match?.[1]
      if (amount === undefined) return total
      return total + BigInt(amount)
    }, 0n)
  } catch {
    return 0n
  }
}
