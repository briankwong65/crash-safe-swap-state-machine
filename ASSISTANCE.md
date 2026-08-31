# Assistance

## Tools used

- Claude Code (Anthropic's CLI agent) for the bulk of implementation, test
  writing, and these three documents.
- `npm`, `tsc`, `vitest`, and `vite` for dependency management, type
  checking, testing, and the production build — run directly, not through
  the agent's judgment.
- Reading the installed SDK's compiled source and `.d.ts` files directly
  (`node_modules/@provablehq/shield-swap-sdk`) whenever the plan's assumption
  about an API shape needed checking against the real package rather than
  its documentation.

## Work delegated to AI

The agent wrote the reducer (`swapMachine.ts`), the effect-running hook
(`useSwapFlow.ts`), the wallet-session hook, the pinned API client, the
pending-claim persistence module, all UI components, and the test suite
(190 tests across 13 files). The task plan itself — component boundaries,
the state machine's members, the persistence approach — was drafted by the
agent from the spec brief and revised across the implementation as
real API shapes turned up.

## One AI output that was changed

The task plan specified a hand-written `ApiClient` facade: a plain object
implementing the same methods as the SDK's `ApiClient`, delegating every
method except `getRoute` (which needed an added `pool_key` parameter), and
passing that object to `planSwap`. This does not work. `ApiClient` in
`@provablehq/shield-swap-sdk@0.7.0` is a class with private fields (checked
directly in its `.d.ts` and compiled output), and TypeScript's structural
typing does not consider an object assignable to a class type unless it
actually descends from that class — a plain object with the same public
method signatures is rejected at the call site where `planSwap` expects an
`ApiClient`. The fix was to make `PinnedApiClient` a subclass of `ApiClient`
that overrides only `getRoute`, inheriting every other method unchanged
(`src/api/pinnedApiClient.ts`). This was caught by running `tsc` against the
facade-object version before writing any code around it, not by inspection.

Two smaller instances of the same pattern — checking the real package
instead of trusting the plan's assumption — also occurred: the plan's
private-balance fallback called `client.transport.requestRecords` and read
`record.data.microcredits`, neither of which exists on the actual SDK; the
working fallback (`src/wallet/useBalances.ts`) calls `client.requestRecords`
directly and parses each record's plaintext with `@provablehq/veil-core`'s
`parseRecord`. Separately, the plan proposed recovering `swapId` by guessing
it from transaction output shape; the SDK ships `deriveSwapId` to compute it
exactly, which the code now prefers when the swap handle carries the fields
`deriveSwapId` needs, falling back to the shape heuristic (and throwing on
disagreement) only when it doesn't.

## Verification

- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm test` (`vitest run`) — 190/190 passing, mocking the wallet adapter,
  the SDK's `planSwap`/`swap`/`claimSwapOutput`, and `fetch` at the module
  boundary; no test drives a real wallet or network call.
- `npm run build` — production build succeeds.
- Manual reading of the relevant SDK source (`node_modules/@provablehq/...`)
  whenever a plan assumption about a type or method needed confirming, as
  described above.
- The live testnet flow — connecting Shield Wallet, funding from the
  faucet, completing an ALEO → ETH and an ETH → ALEO swap and claim — was
  **not** performed from this development environment. There was no Chrome
  browser with the Shield Wallet extension, no `ss_...` API key, and no
  faucet-funded address available here. Everything above is the extent of
  what was verified; the live flow is unverified beyond code review and the
  mocked test suite.

---

**Note to the submitter:** review and edit this file before submitting it —
it describes what happened during agent-assisted development but you are
the one accountable for every line. The live testnet runs and the four
explorer links in `README.md` are yours to complete: connect Shield Wallet
in Chrome, fund the wallet from the faucet, run one ALEO → ETH and one
ETH → ALEO swap and claim, and paste the four resulting transaction links
into `README.md` in place of the placeholders.
