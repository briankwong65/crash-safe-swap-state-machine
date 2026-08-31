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
/** Significant digits to keep for a value smaller than `maxFractionDigits` can show. */
const MIN_SIGNIFICANT_DIGITS = 4

export function formatRawAmount(
  raw: bigint,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const full = formatUnits(raw, decimals)
  const [whole = '0', fraction = ''] = full.split('.')

  // An 18-decimal token can hold a real amount whose first significant digit
  // falls past `maxFractionDigits` — a genuine ETH quote of
  // 0.000000811633973158 truncates to "0.000000" and then trims to "0", which
  // reads as "no quote" for an amount that is merely small. Extend precision
  // past the leading zeros so a non-zero amount never displays as zero.
  let digits = maxFractionDigits
  if (raw !== 0n && whole === '0' && fraction) {
    const leadingZeros = fraction.length - fraction.replace(/^0+/, '').length
    digits = Math.min(fraction.length, Math.max(maxFractionDigits, leadingZeros + MIN_SIGNIFICANT_DIGITS))
  }

  const clipped = fraction.slice(0, digits).replace(/0+$/, '')
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
