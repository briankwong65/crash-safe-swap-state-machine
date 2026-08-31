export function AmountField({
  value,
  symbol,
  balanceLabel,
  error,
  disabled,
  onChange,
  onMax,
}: {
  value: string
  symbol: string
  balanceLabel: string | null
  error: string | null
  disabled: boolean
  onChange: (next: string) => void
  onMax: () => void
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor="amount">
        Amount to sell
      </label>
      <div className="field__control">
        <input
          id="amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          className="field__input"
          value={value}
          disabled={disabled}
          aria-describedby={error ? 'amount-error' : 'amount-balance'}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="field__suffix">{symbol}</span>
        <button type="button" className="button button--ghost" onClick={onMax} disabled={disabled}>
          Max
        </button>
      </div>
      <p id="amount-balance" className="field__hint">
        {balanceLabel ?? 'Balance unavailable'}
      </p>
      {error && (
        <p id="amount-error" className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
