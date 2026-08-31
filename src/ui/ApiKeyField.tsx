import { useState } from 'react'

export function ApiKeyField({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <form
      className="field"
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim()) onSubmit(value.trim())
      }}
    >
      <label className="field__label" htmlFor="api-key">
        Shield Swap testnet API key
      </label>
      <div className="field__control">
        <input
          id="api-key"
          type="password"
          className="field__input"
          autoComplete="off"
          spellCheck={false}
          placeholder="ss_…"
          value={value}
          aria-describedby="api-key-hint"
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="button" disabled={!value.trim()}>
          Use key
        </button>
      </div>
      <p id="api-key-hint" className="field__hint">
        Kept in memory for this tab only. It is never stored or logged.
      </p>
    </form>
  )
}
