import type { Database } from "bun:sqlite";
import type { Config } from "./config.ts";
import { advanceCursor, creditDeposit } from "./ledger.ts";
import { publishBackfill, publishTx } from "./events.ts";
import { fromRawTransaction, validateWindow, walletDeposits, type HistoryResult, type RawTransaction, type Request, type Window } from "./history.ts";
import type { Deposit } from "./types.ts";

interface ScanPage {
  data: { signature: string; parserStatus: "OK" | "ERROR"; rawTransaction?: RawTransaction }[];
  paginationToken?: string | null;
  scan: { stoppedOn: string; creditsCharged: number; scannedTransactions: number; matchedTransactions: number };
}
export interface ScanProgress { pages: number; credits: number; matched: number }

interface ScanOptions {
  request?: Request;
  signal?: AbortSignal;
  onDeposit?: (deposit: Deposit) => void;
  onProgress?: (progress: ScanProgress) => void;
  collect?: boolean;
  includeOwnedAccounts?: boolean;
}

async function requestPage(cfg: Config, window: Window, options: ScanOptions, paginationToken?: string): Promise<ScanPage> {
  let response: Response;
  try {
    response = await (options.request ?? fetch)(`${cfg.rpcUrl}/v1/parsed-events/scan?api-key=${encodeURIComponent(cfg.apiKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: cfg.wallet, match: { mints: [{ mint: cfg.usdcMint, scope: "address" }] },
        ...(options.includeOwnedAccounts === false ? {} : { tokenAccounts: "balanceChanged" }),
        slot: { gte: window.fromSlot, lte: window.toSlot },
        commitment: "finalized", status: "succeeded", sortOrder: "asc", returnShape: "transactions",
        rawTransaction: "json", limit: 100, budget: { maxScannedTransactions: 10_000 },
        ...(paginationToken ? { paginationToken } : {}),
      }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
  } catch { throw new Error("Scan request failed; checkpoint unchanged"); }
  if (!response.ok) throw new Error(`Scan HTTP ${response.status} on ${cfg.network}; checkpoint unchanged`);
  const page = await response.json() as ScanPage;
  if (!Array.isArray(page.data) || !Number.isFinite(page.scan?.creditsCharged)) throw new Error("Invalid Scan response; checkpoint unchanged");
  return page;
}

function itemDeposits(item: ScanPage["data"][number], cfg: Config, window: Window): Deposit[] {
  if (item.parserStatus !== "OK" || !item.rawTransaction) throw new Error(`Scan could not parse ${item.signature}; checkpoint unchanged`);
  const tx = fromRawTransaction(item.rawTransaction);
  if (tx.signature !== item.signature || tx.slot < window.fromSlot || tx.slot > window.toSlot)
    throw new Error("Scan result outside requested signature/window; checkpoint unchanged");
  return walletDeposits(tx, cfg.wallet, cfg.usdcMint);
}

function continuation(page: ScanPage, seen: Set<string>): string | undefined {
  const token = page.paginationToken ?? undefined;
  if (token && seen.has(token)) throw new Error("Scan pagination did not advance; checkpoint unchanged");
  if (token) seen.add(token);
  // Empty pages and budget/deadline stops are continuations, not completion.
  if (!token && page.scan.stoppedOn !== "windowEnd") throw new Error("Incomplete Scan without continuation; checkpoint unchanged");
  return token;
}

export async function scanHistory(cfg: Config, window: Window, options: ScanOptions = {}): Promise<HistoryResult> {
  validateWindow(window);
  const result: HistoryResult = { deposits: [], pages: 0, credits: 0, creditSource: "scan.creditsCharged", matchedTransactions: 0 };
  let paginationToken: string | undefined;
  const seen = new Set<string>();
  let matched = 0;
  do {
    options.signal?.throwIfAborted();
    const page = await requestPage(cfg, window, options, paginationToken);
    result.pages++;
    result.credits += page.scan.creditsCharged;
    result.matchedTransactions += page.data.length;
    for (const item of page.data) {
      for (const deposit of itemDeposits(item, cfg, window)) {
        options.signal?.throwIfAborted();
        options.onDeposit?.(deposit);
        if (options.collect !== false) result.deposits.push(deposit);
        matched++;
      }
    }
    options.onProgress?.({ pages: result.pages, credits: result.credits, matched });
    paginationToken = continuation(page, seen);
  } while (paginationToken);
  return result;
}

export async function backfill(cfg: Config, db: Database, window: Window, options: { request?: Request; signal?: AbortSignal } = {}) {
  let credited = 0, duplicate = 0;
  const started = performance.now();
  publishBackfill({ state: "running", ...window, pages: 0, credited, duplicate, credits: 0 });
  try {
    const result = await scanHistory(cfg, window, {
      ...options, collect: false,
      onDeposit(d) {
        const action = creditDeposit(db, d, "backfill", { advanceCheckpoint: false });
        if (action === "credited") credited++; else duplicate++;
        publishTx({ source: "backfill", signature: d.signature, slot: d.slot, action, amount: `${d.amount / 1_000_000n}.${String(d.amount % 1_000_000n).padStart(6, "0")}` });
      },
      onProgress(p) { publishBackfill({ state: "running", ...window, ...p, credited, duplicate }); },
    });
    options.signal?.throwIfAborted();
    // Earlier credits remain after a failed request, but only a complete scan moves the checkpoint.
    advanceCursor(db, window.toSlot);
    const summary = { ...window, pages: result.pages, credits: result.credits, credited, duplicate, ms: Math.round(performance.now() - started) };
    publishBackfill({ state: "complete", ...summary });
    return summary;
  } catch (error) {
    publishBackfill({ state: "failed", ...window, credited, duplicate });
    throw error;
  }
}
