# Decisions

## Component and state boundaries

Two layers, deliberately separate. `useWalletSession` collapses adapter
readiness and API-key presence into `unavailable | disconnected |
connecting | needsApiKey | ready`; `App` gates on this alone.

`swapMachine.ts` is a pure `(state, event) => state` reducer over the trade
lifecycle. It imports nothing from React or the SDK, so its tests need no
mocks. `useSwapFlow` runs the side effects between the two; `SwapPanel`
renders what the reducer returns.

Guards live in the reducer, not components: an illegal event (a second
`SUBMIT` while busy) returns the state unchanged, so a component that
forgets a `disabled` attribute still cannot double-spend. The button's
`disabled` reads the same `isBusy` predicate the reducer guards on, so the
two cannot drift.

## Quote invalidation

Each quote is stored with the exact `{direction, amountRaw, slippageBps}`
it was fetched for. Enforced twice: any input change clears the quote, and
`SUBMIT` re-compares stored inputs against current ones, refusing on
mismatch. The second check is redundant by construction, but means a future
UI bug cannot submit against a stale quote.

## Pending-claim persistence

`localStorage`, key `shieldswap.pendingClaim.v1`, written before awaiting
confirmation: the serialized handle (bigints as decimal strings, enumerated
by name — never spread, so no unexpected field rides along), wallet
address, request tx id, direction, raw amount, timestamp. Never the
blinding factor or API key.

Chosen over `sessionStorage` because recovery must survive a closed tab;
over IndexedDB because the payload is one small JSON object. The `v1`
suffix lets the shape change without stranding an old claim — a mismatch
reads as "no pending claim", not a crash.

A claim resumes only if its stored address matches the connected wallet.
One left by another wallet is neither resumed nor deleted: only that wallet
can derive the blinding factor, so resuming elsewhere would fail and
deleting would destroy its owner's recovery path.

## The ApiClient subclass, not a Proxy

`ApiClient` is a class with private fields, so a structurally-identical
object cannot be passed to `planSwap`. `PinnedApiClient` subclasses it,
overriding only `getRoute` to add `pool_key`; every other method inherits
unchanged — the delegation the spec asks for, with no rebinding to
get wrong. A `Proxy` was rejected: delegated methods would still need
explicit rebinding, hiding the one method that differs.

## UX decisions

One primary button labelled with the current state, so it never says
something different from what it does. A four-step stepper (Request,
Finalize, Claim, Done) and an `aria-live="polite"` region narrate long
waits without stealing focus. Plain-language copy explains why a private
swap is two transactions, and says not to resubmit while waiting.

## Known limitations

- Duplicate-claim protection is per tab; two tabs are separate JS heaps.
- `swapId` recovery reads the confirmed transaction; `deriveSwapId`'s
  cross-check is INACTIVE, since the optional `@provablehq/sdk` peer it
  needs isn't installed. Installing it activates a second source of truth
  that throws on mismatch rather than guessing.
- One private record must cover the whole input; the UI explains this
  rather than combining records.
- Only the pinned pool is used; a wrong or multi-hop route is terminal,
  never a fallback.
- The thin-liquidity hint may miss one DEX API phrasing, showing raw
  server text.
- `faucet.aleo.org` issues PUBLIC credits while every swap spends a
  PRIVATE record, and nothing in the required flow bridges that. A
  dev-only console helper (`src/dev/shieldCredits.ts`) converts them for
  testing; the app ships no such feature, faucets being out of scope.

## What the tests could not catch

Both directions completed on testnet (links in `README.md`). 232 mocked
tests, a clean typecheck and a production build all passed while seven
defects sat in the code, each at a boundary with something external: a
relative base URL the SDK's `new URL()` rejected; Shield returning
`recordView` where the SDK reads `recordPlaintext`; a wallet transport
refusing chain reads; an HTTP transport defaulting to mainnet; the node
needing a CORS proxy; `swap()` returning a wallet handle, not a
transaction id; and imports needing AMM programs, not record programs.
The mocks encoded my assumptions, so they agreed with the code and proved
nothing about the integration.

## Next improvement

Install `@provablehq/sdk` so `deriveSwapId` runs unconditionally and
cross-checks the transaction-shape heuristic instead of standing dormant.
