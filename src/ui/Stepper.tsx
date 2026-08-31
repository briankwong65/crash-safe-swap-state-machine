const STEPS = ['Request', 'Finalize', 'Claim', 'Done'] as const

export function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" aria-label="Swap progress">
      {STEPS.map((label, index) => {
        const position = index + 1
        const status = step > position ? 'done' : step === position ? 'current' : 'todo'
        return (
          <li key={label} className={`stepper__item stepper__item--${status}`}>
            <span className="stepper__dot" aria-hidden="true" />
            <span className="stepper__label">{label}</span>
            {status === 'current' && <span className="sr-only">(current step)</span>}
          </li>
        )
      })}
    </ol>
  )
}
