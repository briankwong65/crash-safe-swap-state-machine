import { ApiKeyProvider, useApiKey } from './api/apiKeyContext'
import { DevTools } from './dev/DevTools'
import { SwapPanel } from './SwapPanel'
import { useSwapFlow } from './swap/useSwapFlow'
import { ApiKeyField } from './ui/ApiKeyField'
import { truncateId } from './explorer'
import { WalletProviders } from './wallet/WalletProviders'
import { useBalances } from './wallet/useBalances'
import { useTokens } from './wallet/useTokens'
import { useVeilClient } from './wallet/useVeilClient'
import { useWalletSession } from './wallet/useWalletSession'

export function Shell() {
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

  // `useSwapFlow` derives this from `session.address` alone — it does not
  // wait on an API key or the token registry — so a claim left by another
  // wallet on this browser is known well before `SwapPanel` ever mounts.
  // `SwapPanel` renders its own copy of this notice once it is visible (see
  // below); this one covers every screen the user sees before that,
  // guarded so the two are never shown at once.
  const swapPanelVisible = session.status === 'ready' && !!tokens
  const showLiftedNotice = !!flow.blockedByOtherWallet && !swapPanelVisible

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

      {showLiftedNotice && (
        <p className="notice notice--danger">
          A pending claim on this browser belongs to a different wallet. Connect that wallet to
          finish it — this one cannot.
        </p>
      )}

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

      {session.status === 'ready' && !tokens && !tokenError && (
        <p className="notice">Loading the token registry…</p>
      )}

      {swapPanelVisible && tokens && (
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
        {/* DEV-ONLY console helpers for live testing; stripped from production. */}
        {import.meta.env.DEV && <DevTools />}
        <Shell />
      </ApiKeyProvider>
    </WalletProviders>
  )
}
