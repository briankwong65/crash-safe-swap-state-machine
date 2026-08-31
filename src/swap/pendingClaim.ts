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

function read(storage: Storage | null): PendingClaim | null {
  if (!storage) return null
  const raw = storage.getItem(PENDING_CLAIM_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as PendingClaim
    return parsed.version === CURRENT_VERSION ? parsed : null
  } catch {
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
