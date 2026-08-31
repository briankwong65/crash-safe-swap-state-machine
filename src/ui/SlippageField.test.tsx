import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SlippageField } from './SlippageField'

/**
 * Fix 5 (final review): `onChange(Number(event.target.value))` had no
 * clamp. `min`/`max` on the `<input>` are HTML hints only — this field is
 * not inside a `<form>`, so nothing actually stopped a negative or
 * out-of-range value reaching the flow. A negative slippage pushes `minOut`
 * above `expectedOut`, making the contract's floor unsatisfiable, so the
 * swap reverts on-chain after the user already paid a fee and approved it
 * in the wallet.
 */
describe('SlippageField', () => {
  it('clamps a negative typed value up to the minimum (1 bps)', () => {
    const onChange = vi.fn()
    render(<SlippageField slippageBps={50} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Max slippage'), { target: { value: '-25' } })

    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('clamps a value above the maximum down to 5000 bps', () => {
    const onChange = vi.fn()
    render(<SlippageField slippageBps={50} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Max slippage'), { target: { value: '999999' } })

    expect(onChange).toHaveBeenCalledWith(5000)
  })

  it('treats an emptied input as the minimum rather than NaN', () => {
    const onChange = vi.fn()
    render(<SlippageField slippageBps={50} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Max slippage'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(1)
    expect(onChange.mock.calls[0]![0]).not.toBeNaN()
  })

  it('passes an in-range value through unchanged', () => {
    const onChange = vi.fn()
    render(<SlippageField slippageBps={50} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Max slippage'), { target: { value: '250' } })

    expect(onChange).toHaveBeenCalledWith(250)
  })
})
