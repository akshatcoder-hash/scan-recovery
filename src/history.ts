import type { Config } from "./config.ts";
import { parseDeposit } from "./parse.ts";
import type { Deposit, NormalizedTx, TokenBalance } from "./types.ts";

export type Request = (url: string, init: RequestInit) => Promise<Response>;
export interface RawTransaction {
  slot: number;
  blockTime?: number | null;
  transaction: { signatures: string[]; message: { accountKeys: string[] } };
  meta: {
    err: unknown;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    preTokenBalances: RawBalance[];
    postTokenBalances: RawBalance[];
  };
}
interface RawBalance {
  accountIndex: number; mint: string; owner?: string;
  uiTokenAmount: { amount: string };
}

function tokenBalances(list: RawBalance[]): TokenBalance[] {
  return list.map(b => {
    if (!/^\d+$/.test(b.uiTokenAmount?.amount)) throw new Error("Invalid raw token amount");
    return { accountIndex: b.accountIndex, mint: b.mint, owner: b.owner ?? "", amount: BigInt(b.uiTokenAmount.amount) };
  });
}

// Raw JSON keeps loaded address-table keys separate from static account keys.
export function fromRawTransaction(raw: RawTransaction): NormalizedTx {
  if (!Number.isSafeInteger(raw?.slot) || !raw.transaction?.signatures?.[0] ||
      !Array.isArray(raw.transaction.message?.accountKeys) || !raw.meta ||
      !Array.isArray(raw.meta.preTokenBalances) || !Array.isArray(raw.meta.postTokenBalances)) {
    throw new Error("Incomplete history transaction; checkpoint unchanged");
  }
  return {
    signature: raw.transaction.signatures[0], slot: raw.slot, blockTime: raw.blockTime ?? null,
    failed: raw.meta.err != null,
    accountKeys: [...raw.transaction.message.accountKeys, ...(raw.meta.loadedAddresses?.writable ?? []), ...(raw.meta.loadedAddresses?.readonly ?? [])],
    preTokenBalances: tokenBalances(raw.meta.preTokenBalances), postTokenBalances: tokenBalances(raw.meta.postTokenBalances),
  };
}

export function walletDeposits(tx: NormalizedTx, wallet: string, mint: string): Deposit[] {
  // Owner filtering prevents a counterparty's balance increase from crediting an outgoing transfer.
  return tx.postTokenBalances.filter(b => b.owner === wallet && b.mint === mint).flatMap(b => {
    const account = tx.accountKeys[b.accountIndex];
    if (!account) throw new Error("Missing token account in history transaction");
    const d = parseDeposit(tx, account, mint);
    return d ? [{ ...d, blockTime: tx.blockTime ?? null }] : [];
  });
}

export async function rpc<T>(cfg: Config, method: string, params: unknown[], request: Request = fetch, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await request(`${cfg.rpcUrl}/?api-key=${encodeURIComponent(cfg.apiKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
  } catch { throw new Error(`${method} request failed`); }
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const data = await response.json() as { result?: T; error?: { code: number } };
  if (data.error || data.result === undefined) throw new Error(`${method} RPC error ${data.error?.code ?? "missing result"}`);
  return data.result;
}

export interface Window { fromSlot: number; toSlot: number }
export function validateWindow(window: Window): void {
  if (!Number.isSafeInteger(window.fromSlot) || !Number.isSafeInteger(window.toSlot) || window.fromSlot < 0 || window.toSlot < window.fromSlot)
    throw new Error("Expected a nonnegative, inclusive slot window");
}

export interface HistoryResult {
  deposits: Deposit[]; pages: number; credits: number; creditSource: string; matchedTransactions: number;
}
