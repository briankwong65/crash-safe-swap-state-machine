# Decisions

## Component and state boundaries

Two layers, deliberately separate. `useWalletSession` collapses
wallet-adapter readiness and API-key presence into five values:
`unavailable | disconnected | connecting | needsApiKey | ready`; `App`
gates on this alone.

`swapMachine.ts` is a pure `(state, event) => state` reducer over a
discriminated union spanning the trade lifecycle (idle through complete,
plus recoverable/terminal error). It imports nothing from React or the SDK,
so its 51 tests need no mocks. `useSwapFlow` runs the side effects between
the two, dispatching results back as events; `SwapPanel` only renders what
the reducer returns.

Guards live in the reducer, not the components: an illegal event (e.g. a
second `SUBMIT` while busy) returns the state unchanged, so a component
that forgets a `disabled` attribute still cannot double-spend. The primary
button's `disabled` reads the same `isBusy` predicate the reducer guards
on, so UI and reducer cannot drift apart.

## Quote invalidation

Each quote is stored with the exact `{direction, amountRaw, slippageBps}`
it was fetched for. Invalidation is enforced twice: any input change
dispatches `INPUT_CHANGED`, clearing the quote, and `SUBMIT` separately
re-compares stored inputs against current ones, refusing on mismatch. That
second check is redundant by construction — three lines — but means a
future UI bug cannot submit against a stale quote.

## Pending-claim persistence

`localStorage`, key `shieldswap.pendingClaim.v1`, written before awaiting
confirmation: the serialized swap handle (bigints as decimal strings,
enumerated by name — never spread, so no unexpected field rides along),
the wallet address, request tx id, direction, raw amount, timestamp. Never
the blinding factor or the API key.

Chosen over `sessionStorage` because recovery must survive a closed tab,
not just a reload; over IndexedDB because the payload is one small JSON
object and an async store buys nothing here. The `v1` suffix lets the
shape change later without stranding an old claim — a parse or shape
mismatch reads as "no pending claim," not a crash.

A claim resumes only if its stored address matches the connected wallet;
one left by a different wallet is neither resumed nor deleted — only that
wallet can derive the blinding factor needed to claim it, so resuming
elsewhere would fail and deleting it would destroy its owner's recovery
path.

## The ApiClient subclass, not a Proxy

The plan specified a hand-written facade delegating every method except
`getRoute`. `ApiClient` is a class with private fields, so a
structurally-identical object cannot be passed to `planSwap`.
`PinnedApiClient` subclasses `ApiClient` instead, overriding only
`getRoute` to add `pool_key`; every other method inherits unchanged — the
delegation the spec asks for, with no rebinding to get wrong. A
`Proxy` was rejected: delegated methods would still need
explicit rebinding to the original `this`, hiding the one method that
differs.

## UX decisions

One primary button labeled with the current state (`Get quote`, `Swap`, or
its own headline while busy), so it never says something different from
what it does. A four-step stepper (Request, Finalize,
Claim, Done) plus an `aria-live="polite"` region narrate long waits
without stealing focus. Plain-language copy explains why a private swap is
two transactions, and tells the user not to resubmit while waiting.

## Known limitations

- Duplicate-claim protection is per tab; two tabs are separate JS heaps,
  uncovered.
- `swapId` recovery prefers `deriveSwapId` when the handle has the needed
  fields, throwing on mismatch with the heuristic rather than guessing;
  the optional `@provablehq/sdk` peer isn't installed.
- One private record must cover the whole input amount; the UI explains
  this rather than combining records.
- Only the one pinned pool is used, by requirement; a wrong or multi-hop
  route is a terminal error, never a fallback.
- The thin-liquidity hint may miss one real DEX API phrasing, showing raw
  server text instead (README's live-integration checklist).
- The live testnet flow has not run from the development environment;
  verification here is typecheck, a production build, and 190 mocked
  tests.

## Next improvement

Install `@provablehq/sdk` so `deriveSwapId` runs unconditionally,
replacing the transaction-shape heuristic as the primary source of truth.
