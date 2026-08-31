import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'
import { describe, expect, it, vi } from 'vitest'
import { claimWithRetry, recoverSwapIdentity, submitSwapRequest } from './execute'

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
})
