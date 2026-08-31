import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { createWalletClient } from '@provablehq/veil-core'
import { useMemo } from 'react'
import { PinnedApiClient } from '../api/pinnedApiClient'
import { useApiKey } from '../api/apiKeyContext'

/**
 * The composed Veil client, with the pinned API client installed as `client.api`
 * so that every route quote is pinned, not just the one call site.
 *
 * `PinnedApiClient` is constructed WITHOUT `poolKey` here — that option exists
 * solely so tests can pin a different key. Production always trades through
 * the single pool baked into `src/config.ts`.
 */
export function useVeilClient() {
  const { wallet, connected } = useWallet()
  const { apiKey } = useApiKey()

  return useMemo(() => {
    if (!connected || !wallet?.adapter || !apiKey) return { client: null, api: null }

    const api = new PinnedApiClient({
      apiToken: apiKey,
      fetch: globalThis.fetch.bind(globalThis),
    })

    const { account, transport } = fromWalletAdapter(wallet.adapter)
    const client = createWalletClient({ account, transport }).extend(
      shieldSwapActions({ api }),
    )

    return { client, api }
  }, [connected, wallet?.adapter, apiKey])
}

export type VeilClient = NonNullable<ReturnType<typeof useVeilClient>['client']>
