import { EventEmitter } from "node:events";
import { logEvent } from "./log.ts";
import type { Action } from "./types.ts";

export interface TxEvent {
  t: number;
  source: string;
  signature: string;
  slot: number;
  action: Action;
  amount?: string;
}

export interface BackfillEvent {
  state: "running" | "complete" | "failed";
  fromSlot: number; toSlot: number;
  pages?: number; credits?: number; credited: number; duplicate: number; ms?: number;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

// Logs the event as one JSON line and lets the server hear about it.
export function publishTx(e: Omit<TxEvent, "t">): void {
  logEvent(e);
  bus.emit("tx", { t: Date.now(), ...e } satisfies TxEvent);
}
export const onTx = (fn: (e: TxEvent) => void): void => void bus.on("tx", fn);
export const publishBackfill = (event: BackfillEvent): void => void bus.emit("backfill", event);
export const onBackfill = (fn: (event: BackfillEvent) => void): void => void bus.on("backfill", fn);
