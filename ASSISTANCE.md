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

I delegated implementation to the agent: the reducer (`swapMachine.ts`), the effect-running hook
(`useSwapFlow.ts`), the wallet-session hook, the pinned API client, the
pending-claim persistence module, all UI components, and the test suite
(232 tests across 14 files). The plan itself — component boundaries, the
state machine's members, the persistence approach — was drafted by the agent
from the spec brief to my direction, and revised throughout as real
API shapes turned up.

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
exactly, and the code now prefers it, falling back to the shape heuristic —
and throwing on disagreement — otherwise. In the shipped configuration that
preference is dormant: `deriveSwapId` needs the optional `@provablehq/sdk`
peer, which is not installed, so the heuristic is the live path. It was
checked against the project's example transaction and then against both
live swaps.

## Verification

- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm test` (`vitest run`) — 232/232 passing, mocking the wallet adapter,
  the SDK's `planSwap`/`swap`/`claimSwapOutput`, and `fetch` at the module
  boundary; no test drives a real wallet or network call.
- `npm run build` — production build succeeds.
- Manual reading of the relevant SDK source (`node_modules/@provablehq/...`)
  whenever a plan assumption about a type or method needed confirming, as
  described above.
- The live testnet flow was run separately in Chrome with the Shield Wallet
  extension: both directions completed, and all four transactions in
  `README.md` are confirmed `accepted` on chain. It could not be run from
  the development environment, which has no browser extension, API key, or
  faucet-funded address.

## What the mocked tests did not catch

The live run is where most of the real defects surfaced. 232 passing tests,
a clean typecheck and a working production build coexisted with seven bugs,
each at a boundary between this code and something external:

1. The dev API base URL was relative; the SDK builds requests with
   single-argument `new URL()`, which rejects a relative string.
2. Shield returns records as `recordView.fields`; the SDK's
   `getPrivateBalances` reads only `recordPlaintext`, so balances read zero
   against a real wallet holding real records.
3. The wallet adapter transport refuses chain reads, so every quote failed
   until an HTTP transport was added as a fallback.
4. That HTTP transport defaults to mainnet, where the pinned pool does not
   exist.
5. The Aleo node needed a dev proxy for the same CORS reason as the DEX API.
6. `swap()` returns Shield's own request handle, not an Aleo transaction id;
   the on-chain id has to be resolved through the adapter afterwards.
7. A write's `imports` map needs each token's AMM program, not the program
   its records live in.

None was reachable by the test suite, because the mocks encoded assumptions
about the SDK and the wallet rather than their real behaviour — so the tests
agreed with the code and proved nothing about the integration. Contract tests against those boundaries are
named as the next improvement in `DECISIONS.md`, which does not repeat this
list.

## Judgement calls I made

**How the work was executed.** I had the agent plan the build up front,
then execute it task by task with a separate review of every task's diff
before moving on. That loop caught around twenty defects during
implementation — several of them, including an unguarded state transition
that allowed a second claim and a resume path that could never complete,
sat in the agent's own plan rather than its code.

**What I did not accept.** I rejected shipping the `@provablehq/sdk` peer
to activate `deriveSwapId`: it adds an unexercised WASM dependency outside
the project's pinned set, to cross-check a value already read
authoritatively from chain and confirmed on both live swaps. I also
rejected a `localStorage` lease to extend duplicate-claim protection across
browser tabs — a stale lease would block crash recovery, which is worse
than the race it prevents, on the one path whose purpose is not stranding
funds. Both are recorded as known limitations instead.

**Where I overruled the agent.** Its draft of `DECISIONS.md` named
installing that peer as the single next improvement. I pushed back: it sat
oddly beside a section documenting seven defects a passing test suite had
missed, and proposed a package install as the answer to a testing problem.
The document now names contract tests at the integration boundaries, which
is what would actually have caught them.

**What I would do differently.** The architecture survived contact with the
real system — the state split, the reducer, the persistence model and the
pool pinning all held. What did not was the plan's reference code, written
against an SDK that had never been run: its API-shape assumptions
propagated into every task that copied them, and only a live wallet exposed
them. Next time I would specify interfaces and test cases at plan time, and
let each task discover the real API surface itself.
