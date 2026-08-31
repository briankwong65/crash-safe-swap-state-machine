import { EXPLORER_BASE_URL } from './config'

export function explorerTxUrl(txId: string): string {
  return `${EXPLORER_BASE_URL}/transaction/${txId}`
}

/** Shortens a long field literal or address for display without hiding identity. */
export function truncateId(value: string, lead = 10, tail = 6): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`
}
