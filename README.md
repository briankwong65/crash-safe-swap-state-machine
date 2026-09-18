# crash-safe-swap-state-machine

A React and TypeScript interface for private ALEO ⇄ ETH swaps on Aleo testnet,
built around the problem that makes these trades awkward: a private swap settles
in **two** on-chain transactions, and between them the user's funds are committed
but uncollected. Close the tab in that window and the only key to the output is a
handle that must already be on disk.

So the lifecycle is a pure state machine with every guard below the UI, the claim
handle is persisted before the first wait, and a reload resumes the claim without
ever submitting a second swap. Every signature, proof, private record selection,
and blinded-address derivation happens inside the Shield Wallet browser extension;
this application never sees a private key, a view key, or a blinding factor.

## Requirements

- Google Chrome
- The [Shield Wallet extension](https://chromewebstore.google.com/detail/shield/hhddpjpacfjaakjioinajgmhlbhfchao)
- Node.js 18 or newer

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open the printed URL (typically `http://localhost:5173`) in Chrome.

## Test

```bash
npm test           # vitest run, 232 tests
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build
```

All four commands are mocked at the wallet and network boundary — none of them
drive a real wallet or hit the live testnet API. There is no automated end-to-end
test against a live Shield Wallet.

## Get a Shield Swap API key

1. Open [testnet.swap.shield.fi](https://testnet.swap.shield.fi/).
2. Select **API Keys** and create an `ss_...` key.
3. Paste it into the application when it asks (the `needsApiKey` screen, shown
   once Shield Wallet is connected).

The key is held in memory only, in a React context that lives for the tab's
lifetime. It is never written to `localStorage`, `sessionStorage`, or any other
disk-backed store, and it is never logged. Closing or reloading the tab clears
it and the application asks for it again.

## Fund the wallet

1. Connect Shield Wallet in the application (top-right button).
2. Copy the connected address.
3. Open [faucet.aleo.org](https://faucet.aleo.org/) and request testnet ALEO to
   that address.

Testnet ALEO arrives as private records, not a public account balance. A public
balance read on a freshly funded address still shows zero — that is expected,
not a bug. The application reads private balances directly (`getPrivateBalances`,
falling back to summing unspent `credits.aleo` records if a future SDK version
stops covering native credits by default).

## Do a swap

1. Open the app in Chrome and click **Connect Shield Wallet**; approve the
   connection in the extension.
2. Paste your `ss_...` API key.
3. Wait for the private ALEO and ETH balances to appear.
4. Pick a direction (ALEO → ETH or ETH → ALEO) and enter an amount.
   **Do not enter more than 0.1 ALEO for an ALEO → ETH test** — this is the
   deliberate cap, because the pool has limited depth. For an
   ETH → ALEO test, use no more than the ETH you received from the ALEO → ETH
   trade.
5. Click **Get quote**. The application shows the expected output, the minimum
   output, the slippage, and the pool identifier from the one pinned pool.
6. Click **Swap** and approve the request transaction in Shield Wallet. Shield
   Wallet selects the private input record, signs, and proves; nothing private
   reaches this page.
7. Wait for the request transaction to confirm (usually one to two minutes).
   **If you reload the page during this wait, the application resumes waiting
   for the same request and, once it confirms, resumes the claim automatically
   — it does not submit a second swap.** The resume path depends on a
   per-wallet record kept in
   `localStorage` (see `DECISIONS.md`).
8. Once the output finalizes, approve the claim transaction in Shield Wallet.
   This second transaction collects the output into your wallet as a private
   record; it is not a second trade.
9. On completion, the application shows both transaction IDs with explorer
   links.

## Successful testnet swaps

Both directions were completed on testnet in Chrome with the Shield Wallet
extension. All four transactions are confirmed `accepted` on chain.

| Direction  | Transaction  | Explorer link                                                                                                   |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| ALEO → ETH | Swap request | https://testnet.explorer.provable.com/transaction/at1pvfl4c6ec848kxftce2zg7vsuhtxlku0jf9xk9jndshr3vk8hgzqyfk8ef |
| ALEO → ETH | Output claim | https://testnet.explorer.provable.com/transaction/at1a99rkm5uuntnm5rhtsz2ghyuwsypkef54587xhqk9mkjdxc6j5xsx8hsdu |
| ETH → ALEO | Swap request | https://testnet.explorer.provable.com/transaction/at1dqprmxqv9h442hg45ws3kugnq7dx9mc6q02fvmwyhycnlpvn45rqc8qnv3 |
| ETH → ALEO | Output claim | https://testnet.explorer.provable.com/transaction/at1v67gu54syx0u6dzxxd0ltt00pvlguwt5c4nxssyfzxa0xeyulugqkccj4g |

## Live-integration checklist

Both directions have since been run live, so most of this list is now
settled. What remains unconfirmed is called out inline; the rest is kept as
a record of what the mocked suite could not establish on its own:

- The Aleo node's transaction endpoint paths and response shapes used by
  `execute.ts`. Both were confirmed live against
  `https://api.provable.com/v2` using known-good example
  transactions: `GET .../testnet/transaction/{txId}` (used by
  `recoverSwapIdentity`) returns `{ type, id, execution, fee }`, and `GET
.../testnet/transaction/confirmed/{txId}` (used by `waitForTransaction`,
  Fix 4) returns `{ type, index, status, finalize, transaction }` where
  `transaction` has the same shape as the plain endpoint. **Still needs
  confirming**: both example transactions were `status: "accepted"` — no
  genuinely REJECTED transaction was available to verify that the literal
  value is exactly `"rejected"` on this endpoint (it matches
  `@provablehq/aleo-types`'s `TransactionStatus` enum, but that enum may
  belong to a different layer than this raw node response). Confirm this
  against a real rejected transaction during the first live run before
  trusting `waitForTransaction`'s rejection handling in production.
- Whether the transition heuristics find the right `swapId` (the first
  public, field-typed output on the `shield_swap.aleo/swap` transition) and
  blinded recipient (the public address-typed input on that same transition).
  The optional `@provablehq/sdk` peer `deriveSwapId` needs is not installed
  in this project, so `deriveSwapId` currently always throws and the
  derive/compare/throw-on-mismatch branch in `recoverSwapIdentity` is dead
  code in the shipped configuration — reading the confirmed transaction (the
  heuristic above) is the live path today, not a fallback from something
  that runs first. Installing the peer would activate the cross-check
  (derive, compare against the heuristic, throw on mismatch rather than
  guessing) as a second source of truth. Both heuristics were confirmed
  against known-good example transactions, and have since run
  correctly on both live swaps recorded above. Confirmed against the live
  testnet
  node (`https://api.provable.com/v2/testnet/transaction/{id}`) and land on
  the correct values, which is why the peer was deliberately not installed.
- The exact wording the DEX API uses for a thin-liquidity failure, so the
  "reduce the amount" hint actually matches it — one phrasing variant is
  currently not covered by the recognized hints (see `LIQUIDITY_HINTS` in
  `src/swap/quote.ts`).
- Whether `getPrivateBalances` covers native `credits.aleo` records in
  practice. Reading the SDK's compiled source says it does; the
  `requestRecords` fallback in `src/wallet/useBalances.ts` only fires if the
  `credits.aleo` key is absent from the result.
