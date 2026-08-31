# Decisions

## Component and state boundaries

Two layers, deliberately separate. `useWalletSession` collapses the wallet
adapter's ready state and whether an API key is in memory into five values:
`unavailable | disconnected | connecting | needsApiKey | ready`. `App` gates
on this alone.

`swapMachine.ts` is a pure `(state, event) => state` reducer over a
discriminated union covering the trade lifecycle (idle through complete,
plus recoverable/terminal error). It imports nothing from React or the SDK,
so its 51 tests need no mocks. `useSwapFlow` runs the side effects between
the two: it calls the SDK, the wallet, and storage, and reports results back
as events; `SwapPanel` only renders what the reducer returns.

Guards live in the reducer, not the components: a component that forgets a
`disabled` attribute still cannot double-spend, because an illegal event
(e.g. a second `SUBMIT` while busy) returns the state unchanged. The primary
button's `disabled` reads the same `isBusy` predicate the reducer guards on,
so the UI and the reducer cannot drift apart.

## Quote invalidation

Each quote is stored with the exact `{direction, amountRaw, slippageBps}` it
was fetched for. Invalidation happens twice: any input change dispatches
`INPUT_CHANGED`, clearing the quote; `SUBMIT` separately re-compares stored
inputs against current ones and refuses on any mismatch. The second check is
redundant by construction — three lines — but means a future UI bug cannot
submit against a stale quote.

## Pending-claim persistence

`localStorage`, key `shieldswap.pendingClaim.v1`, written before awaiting
confirmation. It stores the serialized swap handle (bigints as decimal
strings, enumerated by name — never spread — so no unexpected field can ride
along), the connected wallet address, the request transaction id, direction,
raw amount, and a timestamp. It never stores the blinding factor or the API
key.

`localStorage` over `sessionStorage`: recovery must survive a closed tab, not
just a reload. Over IndexedDB: the payload is one small JSON object, and an
async store buys nothing here. The `v1` suffix lets the shape change later
without stranding an old claim — a parse or shape mismatch reads as "no
pending claim," not a crash.

A claim's address is checked before it is resumed. A record left by a
different wallet is neither resumed nor deleted: only that wallet can derive
the blinding factor needed to claim it, so resuming elsewhere would fail,
and deleting it would destroy its owner's recovery path.

## The ApiClient subclass, not a Proxy

The plan called for a hand-written facade delegating every method except
`getRoute`. The SDK's `ApiClient` is a class with private fields, so an
object that merely implements the same method names is not assignable to
it and cannot be passed to `planSwap`. `PinnedApiClient` subclasses
`ApiClient` and overrides only `getRoute` to add `pool_key`; every other
method is inherited unchanged — the delegation the spec asks for, with
no method-by-method rebinding to get wrong. A `Proxy` was rejected: delegated
methods would still need explicit rebinding to the original `this`, and the
indirection would hide the one method that actually differs.

## UX decisions

One primary button whose label is the current state (`Get quote`, `Swap`, or
the state's own headline while busy), so the button never says something
different from what it will do. A four-step stepper (Request, Finalize,
Claim, Done) plus an `aria-live="polite"` region narrate long waits without
stealing focus. Plain-language copy explains why a private swap is two
transactions, and tells the user not to resubmit while waiting.

## Known limitations

- Duplicate-claim protection is per tab (a module-level registry); two tabs
  are separate JS heaps and are uncovered.
- `swapId` recovery prefers `deriveSwapId` when the handle carries the needed
  fields, and throws on a mismatch with the on-chain heuristic instead of
  guessing; the optional `@provablehq/sdk` peer it needs is not installed.
- One private record must cover the whole input amount; the UI explains this
  rather than combining records.
- Only the one pinned pool is used, by requirement; a wrong or multi-hop
  route is a terminal error, never a fallback.
- The live testnet flow has not run from the development environment.
  Verification here is typecheck, a production build, and 190 mocked tests.

## Next improvement

Install `@provablehq/sdk` so `deriveSwapId` runs unconditionally, replacing
the transaction-shape heuristic as the primary source of truth.
