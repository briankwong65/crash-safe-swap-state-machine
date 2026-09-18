# Decisions

## Component and state boundaries

Two layers. `useWalletSession` collapses adapter readiness and API-key
presence into `unavailable | disconnected | connecting | needsApiKey |
ready`; `App` gates on this alone.

`swapMachine.ts` is a pure `(state, event) => state` reducer over the trade
lifecycle, importing nothing from React or the SDK, so its tests need no
mocks. `useSwapFlow` runs the side effects; `SwapPanel` renders what the
reducer returns.

Guards live in the reducer, not components: an illegal event (a second
`SUBMIT` while busy) returns the state unchanged, so a component that
forgets a `disabled` attribute cannot double-spend. The button's `disabled`
reads the same `isBusy` predicate, so the two cannot drift.

## Quote invalidation

Each quote is stored with the exact `{direction, amountRaw, slippageBps}`
it was fetched for. Enforced twice: any input change clears the quote, and
`SUBMIT` re-compares stored inputs against current ones. The second check
is redundant by construction, but means a future UI bug cannot submit
against a stale quote.

## Pending-claim persistence

`localStorage`, key `shieldswap.pendingClaim.v1`, written before awaiting
confirmation: the serialized handle (bigints as decimal strings, enumerated
by name — never spread, so no unexpected field rides along), wallet
address, request tx id, direction, amount, timestamp. Never the blinding
factor or API key.

Chosen over `sessionStorage` because recovery must survive a closed tab;
over IndexedDB because the payload is one small JSON object. The `v1`
suffix lets the shape change without stranding an old claim.

A claim resumes only if its stored address matches the connected wallet.
One left by another wallet is neither resumed nor deleted: only that wallet
can derive the blinding factor, so resuming elsewhere fails and deleting
destroys its owner's recovery path.

## The ApiClient subclass, not a Proxy

`ApiClient` is a class with private fields, so a structurally-identical
object cannot be passed to `planSwap`. `PinnedApiClient` subclasses it,
overriding only `getRoute` to add `pool_key`; every other method inherits
unchanged — delegation without a single rebinding to
get wrong. A `Proxy` would still need explicit rebinding, hiding the one
method that differs.

## UX decisions

One primary button labelled with the current state, so it never says
something different from what it does. A four-step stepper and an
`aria-live="polite"` region narrate long waits without stealing focus.
Plain-language copy explains why a private swap is two transactions, and
says not to resubmit while waiting.

## Known limitations

- Duplicate-claim protection is per tab; two tabs are separate JS heaps.
- `swapId` recovery reads the confirmed transaction, which is authoritative
  and verified live. `deriveSwapId`'s cross-check is INACTIVE — its optional
  `@provablehq/sdk` peer isn't installed — so it is a second source of
  truth left unenabled, not a missing fix.
- One private record must cover the whole input; the UI explains this
  rather than combining records.
- Only the pinned pool is used; a wrong or multi-hop route is terminal,
  never a fallback.
- The thin-liquidity hint may miss one DEX API phrasing, showing raw
  server text.
- `waitForTransaction` treats a confirmed transaction as rejected on
  `status: "rejected"`. Only accepted transactions were available to test
  against, so the literal string is unverified.
- `faucet.aleo.org` issues PUBLIC credits while every swap spends a
  PRIVATE record, and nothing in the required flow bridges that. A
  dev-only console helper (`src/dev/shieldCredits.ts`) converts them for
  testing; the app ships no such feature, faucets being out of scope.

## Next improvement

Contract tests at the integration boundaries. Both directions completed on
testnet (links in `README.md`), and that live run exposed seven defects the
232 mocked tests, a clean typecheck and a working build had all passed over
— every one at a boundary with the SDK, the wallet or the node
(`NOTES.md` lists them). The mocks encoded my assumptions rather than
those systems' real behaviour, so they agreed with the code and proved
nothing about the integration. A fake adapter returning Shield's actual
shapes — `recordView`, a `shield_…` request handle — plus assertions that
constructed URLs are absolute and network-qualified would have caught them
before a live run.
