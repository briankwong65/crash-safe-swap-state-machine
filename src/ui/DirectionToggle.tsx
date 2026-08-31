import type { Direction } from '../swap/types'

export function DirectionToggle({
  direction,
  disabled,
  onChange,
}: {
  direction: Direction
  disabled: boolean
  onChange: (next: Direction) => void
}) {
  return (
    <fieldset className="direction" disabled={disabled}>
      <legend className="field__label">Direction</legend>
      {(['aleoToEth', 'ethToAleo'] as const).map((option) => (
        <label key={option} className="direction__option">
          <input
            type="radio"
            name="direction"
            value={option}
            checked={direction === option}
            onChange={() => onChange(option)}
          />
          <span>{option === 'aleoToEth' ? 'ALEO → ETH' : 'ETH → ALEO'}</span>
        </label>
      ))}
    </fieldset>
  )
}
