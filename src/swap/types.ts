export type Direction = 'aleoToEth' | 'ethToAleo'

export type QuoteInputs = {
  direction: Direction
  amountRaw: bigint
  slippageBps: number
}

export type Quote = {
  /** The exact inputs this quote was fetched for. Any change invalidates it. */
  inputs: QuoteInputs
  expectedOut: bigint
  minOut: bigint
  poolKey: string
  tokenOutDecimals: number
  tokenOutSymbol: string
}

/** A serializable handle plus the context needed to resume and describe a claim. */
export type PendingClaim = {
  version: 1
  address: string
  requestTxId: string
  direction: Direction
  amountInRaw: string
  handle: SerializedHandle
  createdAt: number
}

/** `SwapHandle` with its bigint fields as decimal strings, so it survives JSON. */
export type SerializedHandle = {
  swapId?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  tokenInWrapped?: boolean
  tokenOutWrapped?: boolean
  poolKey: string
  amountIn: string
  zeroForOne?: boolean
  sqrtPriceLimit?: string
  nonce?: string
  transactionId: string
  program: string
}

export type FlowError = {
  message: string
  /** Recoverable errors offer a retry; terminal ones do not. */
  kind: 'recoverable' | 'terminal'
}

export type SwapFlowState =
  | { tag: 'idle' }
  | { tag: 'quoting'; inputs: QuoteInputs }
  | { tag: 'quoted'; quote: Quote }
  | { tag: 'quoteError'; error: FlowError }
  | { tag: 'awaitingRequestApproval'; quote: Quote }
  | { tag: 'requestPending'; quote: Quote; requestTxId: string }
  | { tag: 'outputFinalizing'; quote: Quote; requestTxId: string; attempt: number }
  | { tag: 'awaitingClaimApproval'; quote: Quote; requestTxId: string }
  | { tag: 'claimPending'; quote: Quote; requestTxId: string; claimTxId?: string }
  | {
      tag: 'complete'
      requestTxId: string
      claimTxId: string
      amountOut: bigint
      tokenOutDecimals: number
      tokenOutSymbol: string
    }
  | {
      tag: 'recoverableError'
      error: FlowError
      requestTxId?: string
      claimTxId?: string
      /**
       * The quote in force when the trade failed, carried along so `RETRY_CLAIM`
       * can rebuild `outputFinalizing` without the reducer reaching outside
       * itself for one. Present whenever `requestTxId` is, because every state
       * that can fail with a `requestTxId` also carries a `quote`.
       */
      quote?: Quote
    }
  | {
      tag: 'terminalError'
      error: FlowError
      requestTxId?: string
      claimTxId?: string
      quote?: Quote
    }

export type SwapFlowEvent =
  | { type: 'INPUT_CHANGED' }
  | { type: 'QUOTE_REQUESTED'; inputs: QuoteInputs }
  | { type: 'QUOTE_RECEIVED'; quote: Quote }
  | { type: 'QUOTE_FAILED'; error: FlowError }
  | { type: 'SUBMIT'; inputs: QuoteInputs }
  | { type: 'REQUEST_SUBMITTED'; requestTxId: string }
  | { type: 'REQUEST_CONFIRMED' }
  | { type: 'FINALIZE_RETRY'; attempt: number }
  | { type: 'CLAIM' }
  | { type: 'CLAIM_SUBMITTED'; claimTxId: string }
  | {
      type: 'CLAIM_CONFIRMED'
      claimTxId: string
      amountOut: bigint
      tokenOutDecimals: number
      tokenOutSymbol: string
    }
  | { type: 'FAILED'; error: FlowError }
  | { type: 'RESUME'; quote: Quote; requestTxId: string }
  | { type: 'RETRY_CLAIM' }
  | { type: 'RESET' }
