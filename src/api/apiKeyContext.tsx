import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type ApiKeyContextValue = {
  apiKey: string | null
  setApiKey: (key: string | null) => void
}

const ApiKeyContext = createContext<ApiKeyContextValue | undefined>(undefined)

/**
 * Holds the `ss_...` key in memory for the lifetime of the tab and nowhere else.
 *
 * Deliberately not persisted: a testnet trading key in `localStorage` outlives
 * the session and survives into any later visitor of the same browser profile.
 */
export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const value = useMemo(() => ({ apiKey, setApiKey }), [apiKey])
  return <ApiKeyContext.Provider value={value}>{children}</ApiKeyContext.Provider>
}

export function useApiKey(): ApiKeyContextValue {
  const context = useContext(ApiKeyContext)
  if (!context) throw new Error('useApiKey must be used inside ApiKeyProvider')
  return context
}
