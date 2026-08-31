import { SwapOutputNotFinalizedError, deriveSwapId } from '@provablehq/shield-swap-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TransactionRejectedError,
  claimWithRetry,
  recoverSwapIdentity,
  submitSwapRequest,
  waitForTransaction,
} from './execute'

vi.mock('@provablehq/shield-swap-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/shield-swap-sdk')>()
  return { ...actual, deriveSwapId: vi.fn() }
})

const noSleep = async () => {}

const handle = {
  tokenInId: 'aleo-id',
  tokenOutId: 'eth-id',
  poolKey: 'pool-field',
  amountIn: 100_000n,
  transactionId: 'at1req',
  program: 'shield_swap.aleo',
}

describe('submitSwapRequest', () => {
  it('passes a wallet record request rather than a token program', async () => {
    const swap = vi.fn(async (_params: Record<string, unknown>) => handle)
    const resolveDexImports = vi.fn(async () => ({ 'credits.aleo': 'src' }))
    const client = { swap, resolveDexImports } as never

    await submitSwapRequest(
      { client, api: {} as never, sleep: noSleep },
      {
        direction: 'aleoToEth',
        amountInRaw: 100_000n,
        tokenInId: 'aleo-id',
        tokenInProgram: 'credits.aleo',
        tokenOutProgram: 'test_arc20_eth.aleo',
        expectedOut: 5_000n,
        slippageBps: 50,
      },
    )

    const args = swap.mock.calls[0]![0] as Record<string, unknown>
    expect(args.tokenInProgram).toBeUndefined()
    expect(args.tokenRecord).toEqual({
      type: 'record',
      program: 'credits.aleo',
      recordname: 'credits',
      filters: { microcredits: { gte: '100000u64' } },
    })
    expect(args.poolKey).toBe(
      '5905392528088736716502352327676815883959790811081903315511484137973858480171field',
    )
    expect(args.expectedOut).toBe(5_000n)
    expect(args.slippageBps).toBe(50)
  })

  it('resolves imports for both token programs before the write', async () => {
    const resolveDexImports = vi.fn(async () => ({}))
    const client = { swap: vi.fn(async () => handle), resolveDexImports } as never

    await submitSwapRequest(
      { client, api: {} as never, sleep: noSleep },
      {
        direction: 'ethToAleo',
        amountInRaw: 10n ** 17n,
        tokenInId: 'eth-id',
        tokenInProgram: 'test_arc20_eth.aleo',
        tokenOutProgram: 'credits.aleo',
        expectedOut: 5_000n,
        slippageBps: 50,
      },
    )

    expect(resolveDexImports).toHaveBeenCalledWith({
      tokenPrograms: ['test_arc20_eth.aleo', 'credits.aleo'],
    })
  })

  it('uses the ETH record filter when selling ETH', async () => {
    const swap = vi.fn(async (_params: Record<string, unknown>) => handle)
    const client = { swap, resolveDexImports: vi.fn(async () => ({})) } as never

    await submitSwapRequest(
      { client, api: {} as never, sleep: noSleep },
      {
        direction: 'ethToAleo',
        amountInRaw: 250_000_000_000_000_000n,
        tokenInId: 'eth-id',
        tokenInProgram: 'test_arc20_eth.aleo',
        tokenOutProgram: 'credits.aleo',
        expectedOut: 5_000n,
        slippageBps: 50,
      },
    )

    expect((swap.mock.calls[0]![0] as Record<string, unknown>).tokenRecord).toEqual({
      type: 'record',
      program: 'test_arc20_eth.aleo',
      recordname: 'Token',
      filters: { amount: { gte: '250000000000000000u128' } },
    })
  })
})

describe('waitForTransaction', () => {
  const confirmedResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  it('reads the /transaction/confirmed/{id} endpoint, not the plain one', async () => {
    const fetchImpl = vi.fn(async () =>
      confirmedResponse({
        status: 'accepted',
        transaction: { execution: { transitions: [{ program: 'shield_swap.aleo' }] } },
      }),
    )

    await waitForTransaction(
      { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
      'at1req',
    )

    expect(fetchImpl).toHaveBeenCalledWith('https://api.provable.com/v2/testnet/transaction/confirmed/at1req')
  })

  it('resolves once the transaction is confirmed accepted with transitions (Fix 4: accepted, not merely readable)', async () => {
    const fetchImpl = vi.fn(async () =>
      confirmedResponse({
        status: 'accepted',
        transaction: { execution: { transitions: [{ program: 'shield_swap.aleo' }] } },
      }),
    )

    await expect(
      waitForTransaction(
        { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
        'at1req',
      ),
    ).resolves.toBeUndefined()
  })

  it('keeps polling while the transaction has not landed yet (404, then accepted)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        confirmedResponse({
          status: 'accepted',
          transaction: { execution: { transitions: [{ program: 'shield_swap.aleo' }] } },
        }),
      )

    await waitForTransaction(
      { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
      'at1req',
      { attempts: 5, intervalMs: 0 },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws TransactionRejectedError immediately on a rejected finalize, without exhausting the retry budget (Fix 4, CRITICAL)', async () => {
    const fetchImpl = vi.fn(async () =>
      confirmedResponse({
        status: 'rejected',
        transaction: { execution: { transitions: [{ program: 'shield_swap.aleo' }] } },
      }),
    )

    await expect(
      waitForTransaction(
        { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
        'at1req',
        { attempts: 60 },
      ),
    ).rejects.toBeInstanceOf(TransactionRejectedError)

    // A rejected finalize can never become accepted by waiting longer — the
    // whole point of the fix is to stop treating "readable" as "confirmed",
    // so this must not spend the full 60-attempt budget re-checking it.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not treat a rejected transaction with real transitions as success (Fix 4, CRITICAL: readable is not accepted)', async () => {
    // Before the fix, `transitions.length` alone was the confirmation
    // signal — a REJECTED execution is still fully readable with real
    // transitions, so this exact shape used to be declared a success.
    const fetchImpl = vi.fn(async () =>
      confirmedResponse({
        status: 'rejected',
        transaction: {
          execution: {
            transitions: [{ program: 'shield_swap.aleo', function: 'swap', outputs: [{ type: 'public', value: '1field' }] }],
          },
        },
      }),
    )

    await expect(
      waitForTransaction(
        { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
        'at1req',
      ),
    ).rejects.toBeInstanceOf(TransactionRejectedError)
  })
})

describe('recoverSwapIdentity', () => {
  const swapTransition = {
    program: 'shield_swap.aleo',
    function: 'swap',
    inputs: [
      { type: 'public', value: '1field' },
      { type: 'public', value: 'aleo1blindedrecipient' },
    ],
    outputs: [{ type: 'public', value: '777field' }],
  }

  const derivableHandle = {
    ...handle,
    zeroForOne: true,
    sqrtPriceLimit: 0n,
    nonce: 5n,
  }

  beforeEach(() => {
    vi.mocked(deriveSwapId).mockReset()
  })

  it('reads the swap id and blinded recipient from the confirmed transaction', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ execution: { transitions: [swapTransition] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const identity = await recoverSwapIdentity(
      { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
      'at1req',
      handle as never,
    )

    expect(identity.swapId).toBe('777field')
    expect(identity.blindedAddress).toBe('aleo1blindedrecipient')
    expect(deriveSwapId).not.toHaveBeenCalled()
  })

  it('falls back to the indexer when the chain read has no address input', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          execution: {
            transitions: [{ ...swapTransition, inputs: [{ type: 'public', value: '1field' }] }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const getSwap = vi.fn(async () => ({ data: { recipient: 'aleo1fromindexer' } }))

    const identity = await recoverSwapIdentity(
      { client: {} as never, api: { getSwap } as never, fetchImpl, sleep: noSleep },
      'at1req',
      handle as never,
    )

    expect(getSwap).toHaveBeenCalledWith('777field')
    expect(identity.blindedAddress).toBe('aleo1fromindexer')
  })

  it('retries the lagging indexer before giving up', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          execution: {
            transitions: [{ ...swapTransition, inputs: [{ type: 'public', value: '1field' }] }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const getSwap = vi
      .fn()
      .mockRejectedValueOnce(new Error('404 not found'))
      .mockResolvedValueOnce({ data: { recipient: 'aleo1eventually' } })

    const identity = await recoverSwapIdentity(
      { client: {} as never, api: { getSwap } as never, fetchImpl, sleep: noSleep },
      'at1req',
      handle as never,
    )

    expect(getSwap).toHaveBeenCalledTimes(2)
    expect(identity.blindedAddress).toBe('aleo1eventually')
  })

  it('derives the swap id from the handle rather than the transaction when zeroForOne, sqrtPriceLimit, and nonce are present', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ execution: { transitions: [swapTransition] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.mocked(deriveSwapId).mockResolvedValueOnce('777field')

    const identity = await recoverSwapIdentity(
      { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
      'at1req',
      derivableHandle as never,
    )

    expect(deriveSwapId).toHaveBeenCalledWith({
      poolKey: 'pool-field',
      zeroForOne: true,
      amountIn: 100_000n,
      sqrtPriceLimit: 0n,
      blindedAddress: 'aleo1blindedrecipient',
      nonce: 5n,
    })
    expect(identity.swapId).toBe('777field')
    expect(identity.blindedAddress).toBe('aleo1blindedrecipient')
  })

  it('falls back to the transaction heuristic when deriveSwapId fails', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ execution: { transitions: [swapTransition] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.mocked(deriveSwapId).mockRejectedValueOnce(new Error('optional peer not installed'))

    const identity = await recoverSwapIdentity(
      { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
      'at1req',
      derivableHandle as never,
    )

    expect(identity.swapId).toBe('777field')
  })

  it('throws when the derived swap id disagrees with the transaction heuristic, rather than picking one', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ execution: { transitions: [swapTransition] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.mocked(deriveSwapId).mockResolvedValueOnce('888field')

    await expect(
      recoverSwapIdentity(
        { client: {} as never, api: {} as never, fetchImpl, sleep: noSleep },
        'at1req',
        derivableHandle as never,
      ),
    ).rejects.toThrow(/does not match/)
  })
})

describe('claimWithRetry', () => {
  it('retries a not-finalized output without resubmitting the swap', async () => {
    const claimSwapOutput = vi
      .fn()
      .mockRejectedValueOnce(new SwapOutputNotFinalizedError('not finalized'))
      .mockRejectedValueOnce(new SwapOutputNotFinalizedError('not finalized'))
      .mockResolvedValueOnce({ transactionId: 'at1claim', amountOut: 4_990n, amountRemaining: 0n })

    const swap = vi.fn()
    const client = { claimSwapOutput, swap, resolveDexImports: vi.fn(async () => ({})) } as never

    const onRetry = vi.fn()
    const result = await claimWithRetry(
      { client, api: {} as never, sleep: noSleep },
      handle as never,
      { onRetry },
    )

    expect(result.transactionId).toBe('at1claim')
    expect(claimSwapOutput).toHaveBeenCalledTimes(3)
    expect(swap).not.toHaveBeenCalled()
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('gives up after the ceiling without ever calling swap', async () => {
    const claimSwapOutput = vi
      .fn()
      .mockRejectedValue(new SwapOutputNotFinalizedError('not finalized'))
    const swap = vi.fn()
    const client = { claimSwapOutput, swap, resolveDexImports: vi.fn(async () => ({})) } as never

    await expect(
      claimWithRetry({ client, api: {} as never, sleep: noSleep }, handle as never, {
        attempts: 3,
      }),
    ).rejects.toBeInstanceOf(SwapOutputNotFinalizedError)

    expect(claimSwapOutput).toHaveBeenCalledTimes(3)
    expect(swap).not.toHaveBeenCalled()
  })

  it('surfaces a non-finalization error immediately', async () => {
    const claimSwapOutput = vi.fn().mockRejectedValue(new Error('wallet rejected'))
    const client = { claimSwapOutput, resolveDexImports: vi.fn(async () => ({})) } as never

    await expect(
      claimWithRetry({ client, api: {} as never, sleep: noSleep }, handle as never),
    ).rejects.toThrow('wallet rejected')

    expect(claimSwapOutput).toHaveBeenCalledTimes(1)
  })

  it('rejects with a real Error rather than throwing undefined when attempts is 0', async () => {
    const claimSwapOutput = vi.fn()
    const swap = vi.fn()
    const client = { claimSwapOutput, swap, resolveDexImports: vi.fn(async () => ({})) } as never

    await expect(
      claimWithRetry({ client, api: {} as never, sleep: noSleep }, handle as never, {
        attempts: 0,
      }),
    ).rejects.toBeInstanceOf(Error)

    expect(claimSwapOutput).not.toHaveBeenCalled()
    expect(swap).not.toHaveBeenCalled()
  })
})
