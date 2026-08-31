import { describe, expect, it } from 'vitest'
import { formatRawAmount, formatWithSymbol, parseAmountInput } from './units'

describe('parseAmountInput', () => {
  it('converts a decimal string to raw base units exactly', () => {
    expect(parseAmountInput('0.1', 6)).toEqual({ ok: true, raw: 100_000n })
    expect(parseAmountInput('1', 18)).toEqual({ ok: true, raw: 10n ** 18n })
  })

  it('keeps 18-decimal precision a double would destroy', () => {
    const result = parseAmountInput('1.030419082712717843', 18)
    expect(result).toEqual({ ok: true, raw: 1_030_419_082_712_717_843n })
  })

  it('round-trips raw units back to the same decimal string', () => {
    const raw = 1_030_419_082_712_717_843n
    expect(formatRawAmount(raw, 18, 18)).toBe('1.030419082712717843')
  })

  it('rejects empty, malformed, and negative input', () => {
    expect(parseAmountInput('', 6)).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmountInput('   ', 6)).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmountInput('abc', 6)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmountInput('1.2.3', 6)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmountInput('-1', 6)).toEqual({ ok: false, reason: 'negative' })
  })

  it('rejects more fraction digits than the token has decimals', () => {
    expect(parseAmountInput('0.1234567', 6)).toEqual({
      ok: false,
      reason: 'too-many-decimals',
    })
  })
})

describe('formatRawAmount', () => {
  it('trims trailing zeros but keeps a whole number bare', () => {
    expect(formatRawAmount(100_000n, 6)).toBe('0.1')
    expect(formatRawAmount(1_000_000n, 6)).toBe('1')
    expect(formatRawAmount(0n, 6)).toBe('0')
  })

  it('truncates rather than rounds at the display limit', () => {
    expect(formatRawAmount(1_999_999_999_999_999_999n, 18, 6)).toBe('1.999999')
  })

  it('appends the symbol when asked', () => {
    expect(formatWithSymbol(100_000n, 6, 'ETH')).toBe('0.1 ETH')
  })
})

describe('formatRawAmount — small amounts on high-decimal tokens', () => {
  it('never renders a non-zero amount as zero', () => {
    // A real quote from the live pool: 0.09 ALEO -> this much ETH.
    expect(formatRawAmount(811_633_973_158n, 18)).toBe('0.0000008116')
  })

  it('keeps four significant digits past the leading zeros', () => {
    expect(formatRawAmount(1_234_567_890n, 18)).toBe('0.000000001234')
  })

  it('still truncates rather than rounding at the extended precision', () => {
    expect(formatRawAmount(999_999_999_999n, 18)).toBe('0.0000009999')
  })

  it('renders the smallest representable unit rather than zero', () => {
    expect(formatRawAmount(1n, 18)).toBe('0.000000000000000001')
  })

  it('leaves ordinary amounts on the six-digit default', () => {
    expect(formatRawAmount(1_500_000n, 6)).toBe('1.5')
    expect(formatRawAmount(1_999_999_999_999_999_999n, 18, 6)).toBe('1.999999')
  })

  it('still renders a true zero as zero', () => {
    expect(formatRawAmount(0n, 18)).toBe('0')
  })
})
