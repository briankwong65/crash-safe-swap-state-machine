const PRESETS = [10, 50, 100] as const
const MIN_SLIPPAGE_BPS = 1
const MAX_SLIPPAGE_BPS = 5000

/**
 * Clamps free-typed input to the same [1, 5000] range the `min`/`max`
 * attributes only hint at — this field is not inside a `<form>`, and even a
 * native number input's `min`/`max` never block a manually typed value or a
 * paste, so nothing was actually enforcing it. A negative value would push
 * `minOut` above `expectedOut` (the contract's slippage floor becomes
 * unsatisfiable), so the swap reverts on-chain after the user already paid a
 * fee and approved it in the wallet.
 */
function clampSlippageBps(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_SLIPPAGE_BPS
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(raw)))
}

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
          onChange={(event) => onChange(clampSlippageBps(Number(event.target.value)))}
        />
        <span className="field__suffix">bps</span>
      </div>
    </div>
  )
}
