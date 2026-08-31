const PRESETS = [10, 50, 100] as const

export function SlippageField({
  slippageBps,
  disabled,
  onChange,
}: {
  slippageBps: number
  disabled: boolean
  onChange: (next: number) => void
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor="slippage">
        Max slippage
      </label>
      <div className="field__control">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`button button--chip${slippageBps === preset ? ' is-selected' : ''}`}
            disabled={disabled}
            aria-pressed={slippageBps === preset}
            onClick={() => onChange(preset)}
          >
            {preset / 100}%
          </button>
        ))}
        <input
          id="slippage"
          type="number"
          min={1}
          max={5000}
          step={1}
          className="field__input field__input--narrow"
          value={slippageBps}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="field__suffix">bps</span>
      </div>
    </div>
  )
}
