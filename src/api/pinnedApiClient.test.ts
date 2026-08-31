import { ApiClient } from '@provablehq/shield-swap-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POOL_KEY } from '../config'
import { PinnedApiClient } from './pinnedApiClient'

function fetchStub(body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const routeBody = {
  data: {
    estimated_amount_out: '0.5',
    hops: [{ pool_key: POOL_KEY, token_in: 'a', token_out: 'b', zero_for_one: true }],
    protocol_revision: 1,
    token_in: 'a',
    token_out: 'b',
  },
}

describe('PinnedApiClient', () => {
  let fetchMock: ReturnType<typeof fetchStub>

  beforeEach(() => {
    fetchMock = fetchStub(routeBody)
  })

  it('is an ApiClient, so every other method is inherited', () => {
    const api = new PinnedApiClient({ apiToken: 'ss_test', fetch: fetchMock })
    expect(api).toBeInstanceOf(ApiClient)
    expect(typeof api.getPools).toBe('function')
    expect(typeof api.getTokens).toBe('function')
    expect(typeof api.getSwap).toBe('function')
  })

  it('adds pool_key to the route request', async () => {
    const api = new PinnedApiClient({
      apiToken: 'ss_test',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
    })

    await api.getRoute({ token_in: 'a', token_out: 'b', amount_in: '0.1' })

    const [url] = fetchMock.mock.calls[0]!
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/route')
    expect(parsed.searchParams.get('token_in')).toBe('a')
    expect(parsed.searchParams.get('token_out')).toBe('b')
    expect(parsed.searchParams.get('amount_in')).toBe('0.1')
    expect(parsed.searchParams.get('pool_key')).toBe(POOL_KEY)
  })

  it('sends the API key as a bearer token', async () => {
    const api = new PinnedApiClient({
      apiToken: 'ss_test',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
    })

    await api.getRoute({ token_in: 'a', token_out: 'b' })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer ss_test')
  })

  it('omits amount_in when no amount is given', async () => {
    const api = new PinnedApiClient({
      apiToken: 'ss_test',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
    })

    await api.getRoute({ token_in: 'a', token_out: 'b' })

    const parsed = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(parsed.searchParams.has('amount_in')).toBe(false)
  })

  it('returns the parsed route body', async () => {
    const api = new PinnedApiClient({
      apiToken: 'ss_test',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
    })

    const route = await api.getRoute({ token_in: 'a', token_out: 'b' })
    expect(route.data.hops[0]!.pool_key).toBe(POOL_KEY)
  })

  it('throws with the server body when the route request fails', async () => {
    const failing = vi.fn(async () => new Response('pool has insufficient liquidity', { status: 400 }))
    const api = new PinnedApiClient({
      apiToken: 'ss_test',
      baseUrl: 'https://example.test',
      fetch: failing,
    })

    await expect(api.getRoute({ token_in: 'a', token_out: 'b' })).rejects.toThrow(
      /insufficient liquidity/,
    )
  })

  it('never puts the API key in the thrown message', async () => {
    const failing = vi.fn(async () => new Response('bad request', { status: 400 }))
    const api = new PinnedApiClient({
      apiToken: 'ss_secret_value',
      baseUrl: 'https://example.test',
      fetch: failing,
    })

    let thrown: unknown
    try {
      await api.getRoute({ token_in: 'a', token_out: 'b' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(String(thrown)).not.toContain('ss_secret_value')
  })
})
