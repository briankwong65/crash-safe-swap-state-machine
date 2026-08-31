import {
  SHIELD_SWAP,
  SHIELD_SWAP_ALGORITHM_GRANTS,
  SHIELD_SWAP_FREEZELIST,
  SHIELD_SWAP_MULTISIG,
  SHIELD_SWAP_ROUTER,
} from '@provablehq/shield-swap-sdk'
import type { AlgorithmGrant, RecordAccessGrant } from '@provablehq/aleo-wallet-standard'
import { PROGRAMS } from '../config'

/** Every program the wallet must expose for an ALEO/ETH trade through the router. */
export const SWAP_PROGRAMS: string[] = [
  SHIELD_SWAP,
  SHIELD_SWAP_ROUTER,
  SHIELD_SWAP_FREEZELIST,
  SHIELD_SWAP_MULTISIG,
  PROGRAMS.credits,
  PROGRAMS.aleoWrapper,
  PROGRAMS.eth,
  PROGRAMS.ethMultisig,
].filter((program, index, all) => all.indexOf(program) === index)

/**
 * Narrows what the wallet may resolve: a `credits` record by its
 * `microcredits` field, and a `Token` record by its `amount` field. Nothing
 * else is requested.
 *
 * `RecordAccessGrant` (from `@provablehq/aleo-wallet-standard`) is a
 * discriminated union of `{ level: 'none' }` or
 * `{ level: 'byProgram', programs: ProgramGrant[] }` — not the flat
 * program-keyed map a first read of the brief might suggest. Each
 * `ProgramGrant` names a program and its `RecordGrant`s; each `RecordGrant`
 * names a record and its `FieldGrant`s (`{ name: string }`).
 */
export const RECORD_ACCESS: RecordAccessGrant = {
  level: 'byProgram',
  programs: [
    {
      program: PROGRAMS.credits,
      records: [{ recordname: 'credits', fields: [{ name: 'microcredits' }] }],
    },
    {
      program: PROGRAMS.eth,
      records: [{ recordname: 'Token', fields: [{ name: 'amount' }] }],
    },
  ],
}

/**
 * Wallet adapter 1.0.1 needs the router's grants scoped to the core AMM so the
 * router can derive against `shield_swap.aleo`'s membership mapping.
 */
export const ALGORITHM_GRANTS: AlgorithmGrant[] = SHIELD_SWAP_ALGORITHM_GRANTS.map(
  (grant) =>
    grant.program === SHIELD_SWAP_ROUTER ? { ...grant, scopeProgram: SHIELD_SWAP } : grant,
)

/**
 * One private record must cover the whole input amount — record selection does
 * not combine several small records.
 */
export function aleoRecordRequest(amountIn: bigint) {
  return {
    type: 'record',
    program: PROGRAMS.credits,
    recordname: 'credits',
    filters: { microcredits: { gte: `${amountIn}u64` } },
  } as const
}

export function ethRecordRequest(amountIn: bigint) {
  return {
    type: 'record',
    program: PROGRAMS.eth,
    recordname: 'Token',
    filters: { amount: { gte: `${amountIn}u128` } },
  } as const
}
