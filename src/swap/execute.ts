import {
  type ApiClient,
  type ClaimSwapOutputReturnType,
  type SwapHandle,
  SwapOutputNotFinalizedError,
  deriveSwapId,
} from '@provablehq/shield-swap-sdk'
import { ALEO_NODE_URL, POOL_KEY, PROGRAMS } from '../config'
import { aleoRecordRequest, ethRecordRequest } from '../wallet/walletConfig'
import { TIMING } from './timing'
import type { Direction } from './types'

export type ExecuteDeps = {
  client: any
  api: ApiClient
  nodeUrl?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function depsSleep(deps: ExecuteDeps) {
  return deps.sleep ?? defaultSleep
}

function depsFetch(deps: ExecuteDeps) {
  return deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
}

export type SubmitSwapParams = {
  direction: Direction
  amountInRaw: bigint
  tokenInId: string
  tokenInProgram: string
  tokenOutProgram: string
  expectedOut: bigint
  slippageBps: number
}

/**
 * Submits the swap request through the wallet.
 *
 * `tokenInProgram` is deliberately not passed to `swap`: a wallet never exposes
 * its records, so the input arrives as a record InputRequest the wallet resolves
 * itself, and it fills the blinding slots. The returned handle therefore has no
 * `swapId` or `blindedAddress` — see `recoverSwapIdentity`.
 */
export async function submitSwapRequest(
  deps: ExecuteDeps,
  params: SubmitSwapParams,
): Promise<SwapHandle> {
  const imports = await deps.client.resolveDexImports({
    tokenPrograms: [params.tokenInProgram, params.tokenOutProgram],
  })

  const tokenRecord =
    params.direction === 'aleoToEth'
      ? aleoRecordRequest(params.amountInRaw)
      : ethRecordRequest(params.amountInRaw)

  return (await deps.client.swap({
    poolKey: POOL_KEY,
    tokenInId: params.tokenInId,
    amountIn: params.amountInRaw,
    expectedOut: params.expectedOut,
    slippageBps: params.slippageBps,
    imports,
    tokenRecord,
  })) as SwapHandle
}

type TransitionLike = {
  program?: string
  function?: string
  inputs?: { type?: string; value?: string }[]
  outputs?: { type?: string; value?: string }[]
}

async function readTransaction(
  deps: ExecuteDeps,
  txId: string,
): Promise<{ execution?: { transitions?: TransitionLike[] } } | null> {
  const base = deps.nodeUrl ?? ALEO_NODE_URL
  const response = await depsFetch(deps)(`${base}/testnet/transaction/${txId}`)
  if (!response.ok) return null
  return (await response.json()) as { execution?: { transitions?: TransitionLike[] } }
}

type ConfirmedTransactionLike = {
  /**
   * Confirmed live against the pinned node (`GET
   * {ALEO_NODE_URL}/testnet/transaction/confirmed/{id}` on
   * `api.provable.com/v2`, 2026-08-31): the two real transactions cited in
   * the spec (an accepted swap request and its accepted claim) both
   * came back `{ type, index, status: "accepted", finalize, transaction }`.
   * `@provablehq/aleo-types`' `TransactionStatus` enum names the sibling
   * values `"pending" | "accepted" | "failed" | "rejected"`, which lines up
   * with the "accepted" seen live — but no genuinely REJECTED transaction
   * was available to confirm the literal string on this endpoint. Treat
   * anything other than exactly `"accepted"` as not-yet-confirmed, and
   * `"rejected"` specifically as a hard stop (see README's live-integration
   * checklist for the item asking this be confirmed against a real
   * rejected transaction before relying on it further).
   */
  status?: string
  transaction?: { execution?: { transitions?: TransitionLike[] } }
}

/**
 * Unlike `readTransaction`'s plain `/transaction/{id}`, this reads the
 * block-inclusion verdict: an Aleo execution that fails at finalize (e.g. a
 * slippage floor the pool can no longer meet) still broadcasts and is still
 * fully readable, with real transitions, on the plain endpoint — nothing
 * there distinguishes it from genuine success. Only this `status` field
 * does, which is why `waitForTransaction` reads this endpoint instead of
 * `readTransaction`.
 */
async function readConfirmedTransaction(
  deps: ExecuteDeps,
  txId: string,
): Promise<ConfirmedTransactionLike | null> {
  const base = deps.nodeUrl ?? ALEO_NODE_URL
  const response = await depsFetch(deps)(`${base}/testnet/transaction/confirmed/${txId}`)
  if (!response.ok) return null
  return (await response.json()) as ConfirmedTransactionLike
}

/**
 * A transaction that broadcast and was included in a block, but whose
 * execution was rejected at finalize. Distinct from every other failure in
 * this module: nothing was claimed, there is no output to collect, and
 * retrying the wait or resuming a claim can never succeed — see
 * `classifyQuoteError`, which maps this to a terminal (non-retried) error
 * rather than the generic recoverable fallback.
 */
export class TransactionRejectedError extends Error {
  constructor(readonly txId: string) {
    super(
      `Transaction ${txId} was rejected on-chain at finalize — the execution did not take effect. This is not a delay; do not resume a claim for this request.`,
    )
    this.name = 'TransactionRejectedError'
  }
}

/**
 * Polls until the transaction is confirmed ACCEPTED on chain (lifecycle rule
 * 6 — accepted or finalized, never merely "readable").
 *
 * A write can take one or two minutes, so slowness is never treated as failure
 * before the ceiling, and this function never resubmits anything. A REJECTED
 * transaction is reported immediately, without waiting out the remaining
 * attempts, since no amount of further polling will change a finalize
 * rejection into an acceptance.
 */
export async function waitForTransaction(
  deps: ExecuteDeps,
  txId: string,
  options: { attempts?: number; intervalMs?: number; onAttempt?: (n: number) => void } = {},
): Promise<void> {
  const attempts = options.attempts ?? TIMING.confirmationAttempts
  const intervalMs = options.intervalMs ?? TIMING.confirmationIntervalMs
  const sleep = depsSleep(deps)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.onAttempt?.(attempt)
    const confirmed = await readConfirmedTransaction(deps, txId).catch(() => null)

    if (confirmed?.status === 'rejected') {
      throw new TransactionRejectedError(txId)
    }

    if (confirmed?.status === 'accepted' && confirmed.transaction?.execution?.transitions?.length) {
      return
    }

    if (attempt < attempts) await sleep(intervalMs)
  }

  throw new Error(
    `Transaction ${txId} was not confirmed within ${(attempts * intervalMs) / 1000}s. It may still land — reload and resume the claim rather than swapping again.`,
  )
}

/**
 * Recovers the blinded recipient from the indexer as a bounded-retry fallback
 * for when the confirmed transaction's public inputs don't carry it yet — the
 * indexer can lag the chain by a few seconds.
 */
async function recoverBlindedAddressFromIndexer(
  deps: ExecuteDeps,
  swapId: string,
): Promise<string> {
  const sleep = depsSleep(deps)
  let lastError: unknown
  for (let attempt = 1; attempt <= TIMING.indexerAttempts; attempt += 1) {
    try {
      const swap = (await deps.api.getSwap(swapId)) as { data?: { recipient?: string } }
      const recipient = swap.data?.recipient
      if (recipient) return recipient
    } catch (error) {
      lastError = error
    }
    if (attempt < TIMING.indexerAttempts) await sleep(TIMING.indexerIntervalMs)
  }

  throw new Error(
    `Could not recover the blinded recipient for swap ${swapId}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }. The claim can be resumed later; do not submit another swap.`,
  )
}

/**
 * Recovers the wallet-generated swap id and blinded recipient.
 *
 * Blinded address first: the public address input on the confirmed
 * `shield_swap.aleo/swap` transition, falling back to the API indexer under a
 * bounded retry when that input isn't there yet.
 *
 * Swap id: `deriveSwapId` reproduces the contract's own hash byte-for-byte
 * from the handle's `poolKey`/`zeroForOne`/`amountIn`/`sqrtPriceLimit`/`nonce`
 * plus the blinded address just recovered — every field but the address is
 * already on the handle for every new swap, wallet path included. That is
 * preferred whenever the handle carries those fields. The transaction's first
 * public field-typed output is read as a heuristic fallback for handles
 * persisted before those fields existed, and doubles as the indexer lookup
 * key. When both a derived id and the heuristic are available they must
 * agree; a mismatch means one of our assumptions about the chain is wrong,
 * and this throws rather than picking one to act on.
 */
export async function recoverSwapIdentity(
  deps: ExecuteDeps,
  txId: string,
  handle: SwapHandle,
): Promise<{ swapId: string; blindedAddress: string }> {
  const transaction = await readTransaction(deps, txId)
  const transitions = transaction?.execution?.transitions ?? []

  const swapTransition =
    transitions.find((t) => t.program === 'shield_swap.aleo' && t.function === 'swap') ??
    transitions.find((t) => t.program === 'shield_swap.aleo')

  const heuristicSwapId = swapTransition?.outputs?.find(
    (output) => output.type === 'public' && output.value?.endsWith('field'),
  )?.value

  if (!heuristicSwapId) {
    throw new Error(
      `Could not read the swap id from transaction ${txId}. The claim can be resumed once the transaction is readable.`,
    )
  }

  const fromChain = swapTransition?.inputs?.find(
    (input) => input.type === 'public' && input.value?.startsWith('aleo1'),
  )?.value

  const blindedAddress =
    fromChain ?? (await recoverBlindedAddressFromIndexer(deps, heuristicSwapId))

  let swapId = heuristicSwapId

  if (
    handle.zeroForOne !== undefined &&
    handle.sqrtPriceLimit !== undefined &&
    handle.nonce !== undefined
  ) {
    let derivedSwapId: string | undefined
    try {
      derivedSwapId = await deriveSwapId({
        poolKey: handle.poolKey,
        zeroForOne: handle.zeroForOne,
        amountIn: handle.amountIn,
        sqrtPriceLimit: handle.sqrtPriceLimit,
        blindedAddress,
        nonce: handle.nonce,
      })
    } catch {
      // The optional local-hashing peer may not be installed, or the handle's
      // fields may not parse as their Aleo types. Either way, fall back to
      // the transaction heuristic rather than taking down recovery.
      derivedSwapId = undefined
    }

    if (derivedSwapId !== undefined) {
      if (derivedSwapId !== heuristicSwapId) {
        throw new Error(
          `Derived swap id ${derivedSwapId} does not match the swap id read from transaction ${txId} (${heuristicSwapId}). Refusing to guess which is correct — do not submit another swap.`,
        )
      }
      swapId = derivedSwapId
    }
  }

  return { swapId, blindedAddress }
}

/**
 * Claims the output, treating `SwapOutputNotFinalizedError` as "not yet" rather
 * than as failure. It never calls `swap` — a second swap would spend more funds
 * to solve a problem that is only a wait.
 */
export async function claimWithRetry(
  deps: ExecuteDeps,
  handle: SwapHandle,
  options: {
    attempts?: number
    intervalMs?: number
    onRetry?: (attempt: number) => void
  } = {},
): Promise<ClaimSwapOutputReturnType> {
  const attempts = options.attempts ?? TIMING.claimRetryAttempts
  const intervalMs = options.intervalMs ?? TIMING.claimRetryIntervalMs
  const sleep = depsSleep(deps)

  if (attempts < 1) {
    throw new Error(`claimWithRetry requires attempts >= 1, got ${attempts}`)
  }

  const imports = await deps.client.resolveDexImports({
    tokenPrograms: [PROGRAMS.credits, PROGRAMS.eth],
  })

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return (await deps.client.claimSwapOutput({
        handle,
        imports,
      })) as ClaimSwapOutputReturnType
    } catch (error) {
      if (!(error instanceof SwapOutputNotFinalizedError)) throw error
      lastError = error
      if (attempt < attempts) {
        options.onRetry?.(attempt)
        await sleep(intervalMs)
      }
    }
  }

  throw lastError
}
