import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { Network } from '@provablehq/aleo-types'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { createWalletClient, fallback, http } from '@provablehq/veil-core'
import { useMemo } from 'react'
import { ALEO_NODE_URL } from '../config'
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
  const { wallet, connected, transactionStatus } = useWallet()
  const { apiKey } = useApiKey()

  return useMemo(() => {
    if (!connected || !wallet?.adapter || !apiKey) {
      return { client: null, api: null, transactionStatus }
    }

    const api = new PinnedApiClient({
      apiToken: apiKey,
      fetch: globalThis.fetch.bind(globalThis),
    })

    const { account, transport: walletTransport } = fromWalletAdapter(wallet.adapter)

    // The wallet transport handles writes, signing and record access, but not
    // chain READS — it rejects methods like `getMappingValue` outright, which
    // `planSwap` needs to check each hop's live pool state and trade controls.
    // Falling back to the node over HTTP keeps every write on the wallet while
    // letting reads through, which is the arrangement the transport's own error
    // message prescribes.
    // The HTTP transport maps each method to a path under `{url}/{network}`,
    // so the network must be stated explicitly — left to its default it reads a
    // different chain and reports the pinned pool as nonexistent.
    const transport = fallback([
      walletTransport,
      http(ALEO_NODE_URL, {
        network: Network.TESTNET,
        fetchFn: globalThis.fetch.bind(globalThis),
      }),
    ])

    const client = createWalletClient({ account, transport }).extend(
      shieldSwapActions({ api }),
    )

    return { client, api, transactionStatus }
  }, [connected, wallet?.adapter, apiKey, transactionStatus])
}

export type VeilClient = NonNullable<ReturnType<typeof useVeilClient>['client']>
