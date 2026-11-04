import type { Database } from "bun:sqlite";
import { compareScans, usdc } from "./compare.ts";
import { REPLAY_WINDOW_SLOTS, type Config, type Defaults } from "./config.ts";
import { resetLedger, setCursor } from "./ledger.ts";
import { rpc, type Request } from "./history.ts";
import { backfill } from "./scan.ts";

export class Busy extends Error {}

export function createActions(cfg: Config, db: Database, defaults: Pick<Defaults, "rewindSlot" | "toSlot">, request?: Request) {
  let running = false;
  const head = (signal?: AbortSignal) => rpc<number>(cfg, "getSlot", [{ commitment: "finalized" }], request, signal);
  const toSlotOf = async (signal?: AbortSignal) => {
    const latest = await head(signal);
    if (!Number.isSafeInteger(latest) || latest < 0) throw new Error("getSlot returned an invalid finalized slot");
    const toSlot = defaults.toSlot ?? latest;
    if (!Number.isSafeInteger(toSlot) || toSlot > latest) throw new Error("TO_SLOT must be a finalized slot");
    return { latest, toSlot };
  };
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running) throw new Busy("Backfill already running");
    running = true;
    try { return await work(); } finally { running = false; }
  };
  return {
    async compare(signal?: AbortSignal) {
      const { toSlot } = await toSlotOf(signal);
      const result = await compareScans(cfg, { fromSlot: defaults.rewindSlot, toSlot }, { request, signal });
      const wire = (t: { count: number; raw: bigint }) => ({ count: t.count, usdc: usdc(t.raw) });
      return { fromSlot: defaults.rewindSlot, toSlot, default: wire(result.default), balanceChanged: wire(result.balanceChanged), missed: wire(result.missed) };
    },
    backfill: (signal?: AbortSignal) => guard(async () => {
      const { latest, toSlot } = await toSlotOf(signal);
      const from = defaults.rewindSlot;
      if (from < 0 || latest - from <= REPLAY_WINDOW_SLOTS || from > toSlot)
        throw new Error("REWIND_SLOT must be older than the replay window and at or before TO_SLOT");
      setCursor(db, from);
      return backfill(cfg, db, { fromSlot: from, toSlot }, { signal, request });
    }),
    reset: () => guard(async () => resetLedger(db)),
  };
}
