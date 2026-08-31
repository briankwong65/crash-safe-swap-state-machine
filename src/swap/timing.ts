/**
 * Every wait in the flow, in one place, so tests can shrink them.
 *
 * A write can take one or two minutes, so nothing is treated as failed before
 * its ceiling — and no wait ever resubmits.
 */
export const TIMING = {
  confirmationIntervalMs: 5_000,
  confirmationAttempts: 60,
  claimRetryIntervalMs: 5_000,
  claimRetryAttempts: 60,
  indexerIntervalMs: 2_000,
  indexerAttempts: 10,
}
