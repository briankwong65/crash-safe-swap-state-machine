import { formatUnits, parseUnits } from '@provablehq/shield-swap-sdk'

export type ParseResult =
  | { ok: true; raw: bigint }
  | { ok: false; reason: 'empty' | 'invalid' | 'negative' | 'too-many-decimals' }

const DECIMAL_PATTERN = /^\d*(\.\d*)?$/

/**
 * Converts what a person typed into raw base units.
 *
 * Parsing is delegated to the SDK's string-based `parseUnits` — a double
 * cannot hold 18 significant decimals, so no step here may touch `Number`.
 */
export function parseAmountInput(input: string, decimals: number): ParseResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, reason: 'empty' }
  if (trimmed.startsWith('-')) return { ok: false, reason: 'negative' }
  if (!DECIMAL_PATTERN.test(trimmed)) return { ok: false, reason: 'invalid' }

  const [, fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) return { ok: false, reason: 'too-many-decimals' }

  try {
    return { ok: true, raw: parseUnits(trimmed, decimals) }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

/**
 * Renders raw base units for display. Truncates at `maxFractionDigits` rather
 * than rounding, so a displayed balance never overstates what is spendable.
 */
export function formatRawAmount(
  raw: bigint,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const full = formatUnits(raw, decimals)
  const [whole = '0', fraction = ''] = full.split('.')
  const clipped = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')
  return clipped === '' ? whole : `${whole}.${clipped}`
}

export function formatWithSymbol(
  raw: bigint,
  decimals: number,
  symbol: string,
  maxFractionDigits = 6,
): string {
  return `${formatRawAmount(raw, decimals, maxFractionDigits)} ${symbol}`
}
