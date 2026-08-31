import { type TokenInfo, listTokens } from '@provablehq/shield-swap-sdk'
import { useEffect, useState } from 'react'
import { TOKEN_SYMBOLS } from '../config'
import { useVeilClient } from './useVeilClient'

export type PairTokens = { aleo: TokenInfo; eth: TokenInfo }

function findBySymbol(tokens: TokenInfo[], symbol: string): TokenInfo {
  const found = tokens.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase())
  if (!found) {
    throw new Error(
      `Token ${symbol} is not in the testnet registry (found: ${tokens.map((t) => t.symbol).join(', ')}).`,
    )
  }
  return found
}

/** Resolves the pair from the registry — decimals are never hard-coded. */
export function pickPairTokens(tokens: TokenInfo[]): PairTokens {
  return {
    aleo: findBySymbol(tokens, TOKEN_SYMBOLS.aleo),
    eth: findBySymbol(tokens, TOKEN_SYMBOLS.eth),
  }
}

export function useTokens() {
  const { api } = useVeilClient()
  const [tokens, setTokens] = useState<PairTokens | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!api) {
      setTokens(null)
      return
    }

    let cancelled = false
    listTokens(api)
      .then((registry) => {
        if (!cancelled) {
          setTokens(pickPairTokens(registry))
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setTokens(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })

    return () => {
      cancelled = true
    }
  }, [api])

  return { tokens, error }
}
