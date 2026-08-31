/**
 * DEV-ONLY helper: converts PUBLIC ALEO into a PRIVATE credits record.
 *
 * Why this exists: the spec funds testing via faucet.aleo.org, which
 * issues PUBLIC credits, but every swap here spends a PRIVATE record and one
 * record must cover the whole input amount. Nothing in the required user flow
 * bridges that gap, and the spec scopes faucet/bridge features out of the
 * application itself — so this is a console tool for setting up a test wallet,
 * deliberately not a UI feature, and it is excluded from production builds.
 *
 * The connected wallet signs and proves. No key material is read or handled
 * here; the amount and recipient are the only inputs.
 *
 * Usage, from the browser console once the wallet is connected:
 *   await window.__shieldCredits(1)      // convert 1 ALEO to a private record
 *   await window.__shieldCredits(1, 0.5) // ...with an explicit 0.5 ALEO fee
 */
import { parseAmountInput } from '../units'

const ALEO_DECIMALS = 6

type ExecuteTransaction = (options: {
  program: string
  function: string
  inputs: string[]
  fee?: number
}) => Promise<{ transactionId: string } | undefined>

export function installShieldCreditsHelper(
  executeTransaction: ExecuteTransaction,
  address: string | null,
): void {
  ;(globalThis as { __shieldCredits?: unknown }).__shieldCredits = async (
    amountAleo: number | string,
    feeAleo: number | string = 0.5,
  ) => {
    if (!address) throw new Error('Connect the wallet first.')

    const amount = parseAmountInput(String(amountAleo), ALEO_DECIMALS)
    if (!amount.ok) throw new Error(`Invalid amount: ${amount.reason}`)
    if (amount.raw === 0n) throw new Error('Amount must be greater than zero.')

    const fee = parseAmountInput(String(feeAleo), ALEO_DECIMALS)
    if (!fee.ok) throw new Error(`Invalid fee: ${fee.reason}`)

    console.info(
      `[shieldCredits] converting ${amountAleo} ALEO to a private record for ${address} …`,
    )
    console.info('[shieldCredits] approve the prompt in Shield Wallet; this takes a minute or two.')

    const result = await executeTransaction({
      program: 'credits.aleo',
      function: 'transfer_public_to_private',
      inputs: [address, `${amount.raw}u64`],
      fee: Number(fee.raw),
    })

    console.info('[shieldCredits] submitted:', result?.transactionId ?? result)
    console.info('[shieldCredits] once it confirms, click Refresh to see the private balance.')
    return result
  }
}
