import type { SwapHandle } from '@provablehq/shield-swap-sdk'
import type { PendingClaim, SerializedHandle } from './types'

export const PENDING_CLAIM_KEY = 'shieldswap.pendingClaim.v1'

const CURRENT_VERSION = 1

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Private windows and blocked site data throw on access.
    return null
  }
}

/**
 * Drops the handle's bigints to decimal strings so it survives JSON, and drops
 * `blindingFactor` entirely — a wallet-path handle never carries one, and
 * persisting a secret is not something to leave to chance.
 */
export function serializeHandle(handle: SwapHandle): SerializedHandle {
  const serialized: SerializedHandle = {
    tokenInId: handle.tokenInId,
    tokenOutId: handle.tokenOutId,
    poolKey: handle.poolKey,
    amountIn: handle.amountIn.toString(),
    transactionId: handle.transactionId,
    program: handle.program,
  }

  if (handle.swapId !== undefined) serialized.swapId = handle.swapId
  if (handle.blindedAddress !== undefined) serialized.blindedAddress = handle.blindedAddress
  if (handle.tokenInWrapped !== undefined) serialized.tokenInWrapped = handle.tokenInWrapped
  if (handle.tokenOutWrapped !== undefined) serialized.tokenOutWrapped = handle.tokenOutWrapped
  if (handle.zeroForOne !== undefined) serialized.zeroForOne = handle.zeroForOne
  if (handle.sqrtPriceLimit !== undefined) {
    serialized.sqrtPriceLimit = handle.sqrtPriceLimit.toString()
  }
  if (handle.nonce !== undefined) serialized.nonce = handle.nonce.toString()

  return serialized
}

export function deserializeHandle(serialized: SerializedHandle): SwapHandle {
  const handle: SwapHandle = {
    tokenInId: serialized.tokenInId,
    tokenOutId: serialized.tokenOutId,
    poolKey: serialized.poolKey,
    amountIn: BigInt(serialized.amountIn),
    transactionId: serialized.transactionId,
    program: serialized.program,
  }

  if (serialized.swapId !== undefined) handle.swapId = serialized.swapId
  if (serialized.blindedAddress !== undefined) handle.blindedAddress = serialized.blindedAddress
  if (serialized.tokenInWrapped !== undefined) handle.tokenInWrapped = serialized.tokenInWrapped
  if (serialized.tokenOutWrapped !== undefined) handle.tokenOutWrapped = serialized.tokenOutWrapped
  if (serialized.zeroForOne !== undefined) handle.zeroForOne = serialized.zeroForOne
  if (serialized.sqrtPriceLimit !== undefined) {
    handle.sqrtPriceLimit = BigInt(serialized.sqrtPriceLimit)
  }
  if (serialized.nonce !== undefined) handle.nonce = BigInt(serialized.nonce)

  return handle
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * A same-version record can still be malformed — truncated by a quota-limited
 * write, hand-edited, or left over from a shape this module no longer
 * produces. Every field the rest of the module relies on (`deserializeHandle`
 * on `handle`, the address comparison in `loadPendingClaim`) is checked here
 * so a partial record is rejected up front instead of surfacing as a crash
 * deeper in a caller that trusted it.
 */
function isValidSerializedHandle(value: unknown): value is SerializedHandle {
  if (typeof value !== 'object' || value === null) return false
  const handle = value as Record<string, unknown>
  return (
    isNonEmptyString(handle.tokenInId) &&
    isNonEmptyString(handle.tokenOutId) &&
    isNonEmptyString(handle.poolKey) &&
    isNonEmptyString(handle.amountIn) &&
    isNonEmptyString(handle.transactionId) &&
    isNonEmptyString(handle.program)
  )
}

function isValidPendingClaim(value: unknown): value is PendingClaim {
  if (typeof value !== 'object' || value === null) return false
  const claim = value as Record<string, unknown>
  return (
    claim.version === CURRENT_VERSION &&
    isNonEmptyString(claim.address) &&
    isNonEmptyString(claim.requestTxId) &&
    (claim.direction === 'aleoToEth' || claim.direction === 'ethToAleo') &&
    isNonEmptyString(claim.amountInRaw) &&
    isValidSerializedHandle(claim.handle) &&
    typeof claim.createdAt === 'number'
  )
}

function read(storage: Storage | null): PendingClaim | null {
  if (!storage) return null

  try {
    const raw = storage.getItem(PENDING_CLAIM_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    return isValidPendingClaim(parsed) ? parsed : null
  } catch {
    // Covers a getItem that throws (blocked site data, restrictive
    // extensions, a post-access SecurityError) as well as malformed JSON.
    return null
  }
}

export function savePendingClaim(
  claim: PendingClaim,
  storage: Storage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PENDING_CLAIM_KEY, JSON.stringify(claim))
  } catch {
    // A full or blocked store must not take down a swap already submitted.
  }
}

/**
 * Returns the saved claim only when it belongs to the connected wallet.
 *
 * A claim recorded by a different address is left untouched: only the wallet
 * that made the swap can derive the blinding factor, so resuming it elsewhere
 * would fail, and deleting it would destroy the real owner's resume path.
 */
export function loadPendingClaim(
  address: string,
  storage: Storage | null = defaultStorage(),
): PendingClaim | null {
  // Guards against an empty-string caller matching an equally-empty address
  // on a corrupted record — `isValidPendingClaim` already requires a
  // non-empty `address`, but this keeps the two checks independent.
  if (!address) return null
  const claim = read(storage)
  if (!claim) return null
  return claim.address === address ? claim : null
}

/** The address a stored claim belongs to, so the UI can explain a mismatch. */
export function peekPendingClaimAddress(
  storage: Storage | null = defaultStorage(),
): string | null {
  return read(storage)?.address ?? null
}

export function clearPendingClaim(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(PENDING_CLAIM_KEY)
  } catch {
    // Nothing useful to do if the store refuses.
  }
}
