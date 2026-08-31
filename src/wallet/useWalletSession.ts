import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { WalletReadyState } from '@provablehq/aleo-wallet-standard'
import { Network } from '@provablehq/aleo-types'
import { useCallback } from 'react'
import { useApiKey } from '../api/apiKeyContext'

export type SessionStatus =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'needsApiKey'
  | 'ready'

/**
 * Collapses adapter readiness and API-key presence into the five states the
 * interface gates on, so no component reasons about the adapter directly.
 *
 * `WalletReadyState` is a real enum exported from `@provablehq/aleo-wallet-standard`,
 * but its members are `INSTALLED` / `NOT_DETECTED` / `LOADABLE` / `UNSUPPORTED`
 * (values `"Installed"`, `"NotDetected"`, `"Loadable"`, `"Unsupported"`) — not
 * the `Installed` / `Loadable` member names a first read of the brief suggests.
 */
export function useWalletSession() {
  const { wallets, wallet, connected, connecting, address, selectWallet, connect, disconnect } =
    useWallet()
  const { apiKey } = useApiKey()

  const shield = wallet ?? wallets[0]
  const installed =
    shield?.readyState === WalletReadyState.INSTALLED ||
    shield?.readyState === WalletReadyState.LOADABLE

  let status: SessionStatus
  if (!shield || !installed) status = 'unavailable'
  else if (connecting) status = 'connecting'
  else if (!connected) status = 'disconnected'
  else if (!apiKey) status = 'needsApiKey'
  else status = 'ready'

  const doConnect = useCallback(async () => {
    if (shield) selectWallet(shield.adapter.name)
    await connect(Network.TESTNET)
  }, [shield, selectWallet, connect])

  return { status, address: address ?? null, connect: doConnect, disconnect }
}
