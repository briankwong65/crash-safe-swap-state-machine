import {
  type ApiClient,
  type ClaimSwapOutputReturnType,
  type SwapHandle,
  SwapOutputNotFinalizedError,
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

/**
 * Polls until the transaction is readable on chain.
 *
 * A write can take one or two minutes, so slowness is never treated as failure
 * before the ceiling, and this function never resubmits anything.
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
    const transaction = await readTransaction(deps, txId).catch(() => null)
    if (transaction?.execution?.transitions?.length) return
    if (attempt < attempts) await sleep(intervalMs)
  }

  throw new Error(
    `Transaction ${txId} was not confirmed within ${(attempts * intervalMs) / 1000}s. It may still land — reload and resume the claim rather than swapping again.`,
  )
}

/**
 * Recovers the wallet-generated swap id and blinded recipient.
 *
 * Chain first: the swap id is the `shield_swap.aleo/swap` transition's first
 * public field output, and the blinded recipient is its public address input.
 * The API indexer is the fallback, under a bounded retry, because it can lag the
 * chain.
 */
export async function recoverSwapIdentity(
  deps: ExecuteDeps,
  txId: string,
  _handle: SwapHandle,
): Promise<{ swapId: string; blindedAddress: string }> {
  const transaction = await readTransaction(deps, txId)
  const transitions = transaction?.execution?.transitions ?? []

  const swapTransition =
    transitions.find((t) => t.program === 'shield_swap.aleo' && t.function === 'swap') ??
    transitions.find((t) => t.program === 'shield_swap.aleo')

  const swapId = swapTransition?.outputs?.find(
    (output) => output.type === 'public' && output.value?.endsWith('field'),
  )?.value

  if (!swapId) {
    throw new Error(
      `Could not read the swap id from transaction ${txId}. The claim can be resumed once the transaction is readable.`,
    )
  }

  const fromChain = swapTransition?.inputs?.find(
    (input) => input.type === 'public' && input.value?.startsWith('aleo1'),
  )?.value

  if (fromChain) return { swapId, blindedAddress: fromChain }

  const sleep = depsSleep(deps)
  let lastError: unknown
  for (let attempt = 1; attempt <= TIMING.indexerAttempts; attempt += 1) {
    try {
      const swap = (await deps.api.getSwap(swapId)) as { data?: { recipient?: string } }
      const recipient = swap.data?.recipient
      if (recipient) return { swapId, blindedAddress: recipient }
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
