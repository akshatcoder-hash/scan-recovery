# Scan recovery

A local demo of USDC deposit recovery with [Helius Scan](https://www.helius.dev/docs/api-reference/parsed-events/scan.md). It compares wallet-only history with `tokenAccounts: "balanceChanged"`, then backfills an in-memory SQLite ledger over a simulated outage.

It reads mainnet history for a public wallet. It needs a Helius API key, but no wallet private key, and it never signs or sends a transaction.

## Run it

Install [Bun](https://bun.sh/) 1.4.2 or newer, then:

```sh
git clone https://github.com/akshatcoder-hash/scan-recovery.git
cd scan-recovery
bun install --frozen-lockfile
cp .env.example .env
```

Set `HELIUS_API_KEY` in `.env`, then run:

```sh
bun run dev
```

Open http://127.0.0.1:3002. The server binds to loopback, and the API key stays on the server. Each Compare or Run backfill uses API credits; nothing calls Helius until you press a button.

The example uses wallet `Ey85NUDkZQkZRPP48TihWp5CdrnL6rvG2fdpLF8cK2wB` and inclusive slots `420000000` through `465262929`. Change `WALLET`, `REWIND_SLOT` and `TO_SLOT` to inspect another wallet or range. An empty `TO_SLOT` uses the finalized head at click time.

- **Compare** scans the same range with the default setting and with `balanceChanged`, then reports positive net USDC balance changes in the wallet's token accounts. It does not write to the ledger.
- **Run backfill** rewinds the checkpoint to `REWIND_SLOT` and scans through `TO_SLOT`. It credits each `(signature, token account)` once, so running it again skips previously credited deposits.
- **Reset** clears the in-memory ledger, checkpoint and activity. Restarting the server also clears them.

## How recovery works

[`src/scan.ts`](src/scan.ts) follows continuation tokens, including empty pages, and refuses to finish an incomplete scan. [`src/history.ts`](src/history.ts) resolves loaded addresses and wallet-owned token accounts. [`src/parse.ts`](src/parse.ts) checks successful transactions for a positive USDC balance delta using integer base units.

[`creditDeposit`](src/ledger.ts) inserts the deposit and updates its balance in one SQLite transaction. A unique `(signature, account)` key rejects duplicates, and backfill advances the checkpoint only after every page succeeds. If a request fails, earlier credits remain in memory and a retry skips them. They do not survive a server restart.

The rig illustrates the recovery path around LaserStream's approximate 48-hour replay window. This demo makes Scan requests only; it does not connect to LaserStream or test the live handoff. A deposit here means a positive net token-account balance change, which is not necessarily a payment. The sender field is a balance-change heuristic, and owner metadata can be missing from older history.

## Check the code

```sh
bun test
bun run typecheck
bun run build:rig
bun run build:tokens
```

Tests use fixtures and spend no API credits. The design scripts regenerate the committed rig and color assets. The vendored Anatomy kit retains its [MIT notice](design/LICENSE-anatomy); the rest of the project is under [MIT](LICENSE).
