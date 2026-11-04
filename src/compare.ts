import type { Config } from "./config.ts";
import type { Request, Window } from "./history.ts";
import { scanHistory } from "./scan.ts";

export interface Tally { count: number; raw: bigint }
export interface Comparison { default: Tally; balanceChanged: Tally; missed: Tally }

async function deposits(cfg: Config, window: Window, includeOwnedAccounts: boolean, options: { request?: Request; signal?: AbortSignal }) {
  const found = new Map<string, bigint>();
  await scanHistory(cfg, window, {
    ...options, includeOwnedAccounts, collect: false,
    onDeposit(d) { found.set(`${d.signature}:${d.account}`, d.amount); },
  });
  return found;
}

const tally = (m: Map<string, bigint>): Tally => ({ count: m.size, raw: [...m.values()].reduce((a, b) => a + b, 0n) });

export async function compareScans(cfg: Config, window: Window, options: { request?: Request; signal?: AbortSignal } = {}): Promise<Comparison> {
  const standard = await deposits(cfg, window, false, options);
  const full = await deposits(cfg, window, true, options);
  const missed = new Map([...full].filter(([key]) => !standard.has(key)));
  return { default: tally(standard), balanceChanged: tally(full), missed: tally(missed) };
}

export const usdc = (raw: bigint) => `${raw / 1_000_000n}.${String(raw % 1_000_000n).padStart(6, "0")}`;
