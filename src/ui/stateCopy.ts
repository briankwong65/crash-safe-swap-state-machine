import type { SwapFlowState } from '../swap/types'

export type StateCopy = {
  headline: string
  detail: string
  needsApproval: boolean
  waiting: boolean
  canRetry: boolean
  step: 0 | 1 | 2 | 3 | 4
}

export function describeState(state: SwapFlowState): StateCopy {
  switch (state.tag) {
    case 'idle':
      return {
        headline: 'Enter an amount',
        detail: 'Choose a direction and amount, then get a quote from the direct ALEO/ETH pool.',
        needsApproval: false,
        waiting: false,
        canRetry: false,
        step: 0,
      }

    case 'quoting':
      return {
        headline: 'Getting a quote',
        detail: 'Asking the pinned pool what this trade would return.',
        needsApproval: false,
        waiting: true,
        canRetry: false,
        step: 0,
      }

    case 'quoted':
      return {
        headline: 'Quote ready',
        detail:
          'Review the expected and minimum output, then submit. Changing the amount, direction, or slippage will require a new quote.',
        needsApproval: false,
        waiting: false,
        canRetry: false,
        step: 0,
      }

    case 'quoteError':
      return {
        headline: 'Could not get a quote',
        detail: state.error.message,
        needsApproval: false,
        waiting: false,
        canRetry: true,
        step: 0,
      }

    case 'awaitingRequestApproval':
      return {
        headline: 'Approve in Shield Wallet',
        detail:
          'Shield Wallet is asking you to approve the swap. It selects your private record, signs, and proves inside the extension — nothing private reaches this page.',
        needsApproval: true,
        waiting: false,
        canRetry: false,
        step: 1,
      }

    case 'requestPending':
      return {
        headline: 'Swap request submitted',
        detail:
          'Waiting for the request transaction to confirm. This usually takes one to two minutes. Do not submit again — your place is saved and the claim can resume even if you reload.',
        needsApproval: false,
        waiting: true,
        canRetry: false,
        step: 1,
      }

    case 'outputFinalizing':
      return {
        headline: 'Waiting for the output to finalize',
        detail:
          'A private swap settles in two parts: the request you just approved, and a second transaction that collects the output into your wallet as a private record. The chain is still computing the exact amount. Checking again automatically.',
        needsApproval: false,
        waiting: true,
        canRetry: false,
        step: 2,
      }

    case 'awaitingClaimApproval':
      return {
        headline: 'Approve the claim in Shield Wallet',
        detail:
          'The output is ready. Approve the second transaction to collect it. This does not place another trade.',
        needsApproval: true,
        waiting: false,
        canRetry: false,
        step: 3,
      }

    case 'claimPending':
      return {
        headline: 'Collecting your output',
        detail: 'Waiting for the claim transaction to confirm. Do not submit again.',
        needsApproval: false,
        waiting: true,
        canRetry: false,
        step: 3,
      }

    case 'complete':
      return {
        headline: 'Swap complete',
        detail: 'Your output has landed in Shield Wallet as a private record.',
        needsApproval: false,
        waiting: false,
        canRetry: false,
        step: 4,
      }

    case 'recoverableError':
      return {
        headline: 'Something went wrong — you can retry',
        detail: state.claimTxId
          ? `${state.error.message} Your claim transaction was already submitted, so retrying checks on it rather than placing a second trade.`
          : state.requestTxId
            ? `${state.error.message} Your swap request was already submitted, so retrying resumes the claim rather than placing a second trade.`
            : state.error.message,
        needsApproval: false,
        waiting: false,
        canRetry: true,
        step: state.claimTxId ? 3 : state.requestTxId ? 2 : 0,
      }

    case 'terminalError':
      return {
        headline: 'Stopped',
        detail: state.claimTxId
          ? `${state.error.message} Your claim transaction was already submitted before this happened — your funds are not lost. Check its status using the link below; this is not retried automatically.`
          : state.requestTxId
            ? `${state.error.message} Your swap request was already submitted before this happened — your funds are not lost. Check its status using the link below; this is not retried automatically.`
            : `${state.error.message} This is not retried automatically.`,
        needsApproval: false,
        waiting: false,
        canRetry: false,
        step: state.claimTxId ? 3 : state.requestTxId ? 2 : 0,
      }
  }
}
