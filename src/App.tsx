import { ApiKeyProvider, useApiKey } from './api/apiKeyContext'
import { SwapPanel } from './SwapPanel'
import { useSwapFlow } from './swap/useSwapFlow'
import { ApiKeyField } from './ui/ApiKeyField'
import { truncateId } from './explorer'
import { WalletProviders } from './wallet/WalletProviders'
import { useBalances } from './wallet/useBalances'
import { useTokens } from './wallet/useTokens'
import { useVeilClient } from './wallet/useVeilClient'
import { useWalletSession } from './wallet/useWalletSession'

function Shell() {
  const session = useWalletSession()
  const { setApiKey } = useApiKey()
  const { client, api } = useVeilClient()
  const { tokens, error: tokenError } = useTokens()
  const { balances, loading: balancesLoading, refresh } = useBalances(session.address)

  const flow = useSwapFlow({
    address: session.address,
    client,
    api,
    tokens,
    onClaimed: refresh,
  })

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Private ALEO ⇄ ETH</h1>
        {session.status === 'ready' || session.status === 'needsApiKey' ? (
          <button type="button" className="button button--secondary" onClick={session.disconnect}>
            {session.address ? truncateId(session.address, 8, 4) : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            className="button"
            disabled={session.status === 'unavailable' || session.status === 'connecting'}
            onClick={session.connect}
          >
            {session.status === 'connecting' ? 'Connecting…' : 'Connect Shield Wallet'}
          </button>
        )}
      </header>

      {session.status === 'unavailable' && (
        <p className="notice notice--danger">
          Shield Wallet was not detected. Install the Shield extension in Chrome, then reload this
          page.
        </p>
      )}

      {session.status === 'disconnected' && (
        <p className="notice">
          Connect Shield Wallet to see your private balances and trade the direct ALEO/ETH pool on
          Aleo testnet.
        </p>
      )}

      {session.status === 'needsApiKey' && (
        <div className="card">
          <ApiKeyField onSubmit={setApiKey} />
        </div>
      )}

      {session.status === 'ready' && tokenError && (
        <p className="notice notice--danger">Could not load the token registry: {tokenError}</p>
      )}

      {session.status === 'ready' && tokens && (
        <SwapPanel
          tokens={tokens}
          balances={balances}
          balancesLoading={balancesLoading}
          onRefreshBalances={refresh}
          flow={flow}
        />
      )}
    </main>
  )
}

export default function App() {
  return (
    <WalletProviders>
      <ApiKeyProvider>
        <Shell />
      </ApiKeyProvider>
    </WalletProviders>
  )
}
