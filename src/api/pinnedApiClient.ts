import { ApiClient, type ApiClientOptions } from '@provablehq/shield-swap-sdk'
import { DEX_API_BASE_URL, POOL_KEY } from '../config'

export type PinnedApiClientOptions = ApiClientOptions & {
  /** Overridable only so tests can pin a different key. */
  poolKey?: string
}

/**
 * An `ApiClient` that quotes one pool and nothing else.
 *
 * SDK 0.7.0 does not expose `pool_key` on `getRoute`, though the endpoint
 * accepts it. Extending the client means every other method is inherited
 * unchanged — delegation with no rebinding to get wrong — while the single
 * overridden method pins the pool. A subclass also
 * stays assignable to `ApiClient`, so `planSwap(client, api, params)` takes it
 * directly.
 */
export class PinnedApiClient extends ApiClient {
  readonly poolKey: string
  private readonly bearerToken?: string
  private readonly fetchImplementation: typeof fetch

  constructor(options: PinnedApiClientOptions = {}) {
    const {
      poolKey = POOL_KEY,
      baseUrl = DEX_API_BASE_URL,
      fetch: fetchImpl = globalThis.fetch.bind(globalThis),
      ...rest
    } = options

    super({ ...rest, baseUrl, fetch: fetchImpl })

    this.poolKey = poolKey
    this.bearerToken = options.apiToken
    this.fetchImplementation = fetchImpl
  }

  /**
   * Overridden solely to add `pool_key`. Issued directly rather than through
   * the base class's private request helper, which has no way to carry an
   * extra query parameter.
   */
  override async getRoute(query: {
    token_in: string
    token_out: string
    amount_in?: string
  }): Promise<Awaited<ReturnType<ApiClient['getRoute']>>> {
    const params = new URLSearchParams({
      token_in: query.token_in,
      token_out: query.token_out,
      pool_key: this.poolKey,
    })
    if (query.amount_in !== undefined) params.set('amount_in', query.amount_in)

    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.bearerToken) headers.authorization = `Bearer ${this.bearerToken}`

    const response = await this.fetchImplementation(
      `${this.baseUrl}/route?${params.toString()}`,
      { headers },
    )

    if (!response.ok) {
      // The server's body explains thin liquidity and bad pairs; the API key
      // is deliberately not included in anything thrown from here.
      const body = await response.text().catch(() => '')
      throw new Error(`Route request failed (${response.status}): ${body}`)
    }

    const body = (await response.json()) as Awaited<ReturnType<ApiClient['getRoute']>>

    return body
  }
}
