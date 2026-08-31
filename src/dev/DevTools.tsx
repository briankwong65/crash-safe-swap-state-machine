import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { useEffect } from 'react'
import { installShieldCreditsHelper } from './shieldCredits'

/**
 * DEV-ONLY. Renders nothing; installs console helpers for live testing.
 *
 * Mounted by `App` inside the wallet provider, deliberately NOT by `Shell`, so
 * the application's own render tree — and the tests that exercise it — stay
 * free of test tooling.
 */
export function DevTools() {
  const { executeTransaction, address } = useWallet()

  useEffect(() => {
    installShieldCreditsHelper(executeTransaction, address ?? null)
  }, [executeTransaction, address])

  return null
}
