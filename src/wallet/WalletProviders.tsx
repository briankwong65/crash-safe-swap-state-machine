import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react'
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core'
import { Network } from '@provablehq/aleo-types'
import { type ReactNode, useMemo } from 'react'
import { ALGORITHM_GRANTS, RECORD_ACCESS, SWAP_PROGRAMS } from './walletConfig'

export function WalletProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new ShieldWalletAdapter()], [])

  return (
    <AleoWalletProvider
      wallets={wallets}
      network={Network.TESTNET}
      decryptPermission={DecryptPermission.OnChainHistory}
      programs={SWAP_PROGRAMS}
      recordAccess={RECORD_ACCESS}
      algorithmsAllowed={ALGORITHM_GRANTS}
      autoConnect={false}
    >
      {children}
    </AleoWalletProvider>
  )
}
