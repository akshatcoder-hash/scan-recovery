import { beforeEach, expect, spyOn, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import type { Request, RawTransaction } from "../src/history.ts";
import { advanceCursor, countDeposits, getBalance, getCursor, openLedger } from "../src/ledger.ts";
import { backfill, scanHistory } from "../src/scan.ts";
import { ACCOUNT, MINT, WALLET, deposit } from "./fixtures.ts";

const { cfg } = loadConfig({ HELIUS_API_KEY: "test", WALLET, REWIND_SLOT: "100" });

function page(data: RawTransaction[], token?: string, stoppedOn = token ? "limit" : "windowEnd") {
  return { data: data.map(r => ({ signature: r.transaction.signatures[0], parserStatus: "OK", rawTransaction: r })),
    paginationToken: token, scan: { stoppedOn, creditsCharged: 11, scannedTransactions: data.length, matchedTransactions: data.length } };
}
function pages(...responses: unknown[]) {
  const bodies: { match: unknown; paginationToken?: string }[] = [];
  const request: Request = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Unexpected extra request");
    return Response.json(next);
  };
  return { request, bodies };
}

beforeEach(() => { spyOn(console, "log").mockImplementation(() => {}); });

test("Scan asks for the USDC mint with balanceChanged, over the inclusive window", async () => {
  const api = pages(page([deposit(101)]));
  await scanHistory(cfg, { fromSlot: 100, toSlot: 110 }, api);
  expect(api.bodies[0]).toMatchObject({ address: WALLET, tokenAccounts: "balanceChanged", slot: { gte: 100, lte: 110 }, status: "succeeded", commitment: "finalized" });
  expect(api.bodies[0]!.match).toEqual({ mints: [{ mint: MINT, scope: "address" }] });
});

test("budget and deadline pages continue, including an empty page with a token", async () => {
  const db = openLedger(); advanceCursor(db, 100);
  const api = pages(page([deposit(101)], "a", "budget"), page([], "b", "deadline"), page([deposit(105)]));
  const result = await backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, api);
  expect(api.bodies.map(b => b.paginationToken)).toEqual([undefined, "a", "b"]);
  expect(result).toMatchObject({ pages: 3, credited: 2, credits: 33 });
  expect(getBalance(db, ACCOUNT)).toBe(20_000n); expect(getCursor(db)).toBe(110); db.close();
});

test("a failed page keeps earlier credits but not the checkpoint; the rerun skips them", async () => {
  const db = openLedger(); advanceCursor(db, 100);
  const a = deposit(101), b = deposit(105);
  await expect(backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, pages(page([a], "next"), new Error("crash")))).rejects.toThrow();
  expect(getCursor(db)).toBe(100); expect(countDeposits(db)).toBe(1);
  const result = await backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, pages(page([a], "next"), page([b])));
  expect(result).toMatchObject({ credited: 1, duplicate: 1 });
  expect(getBalance(db, ACCOUNT)).toBe(20_000n); expect(getCursor(db)).toBe(110); db.close();
});

test("outgoing USDC, failed transactions, other mints and other owners never credit", async () => {
  const db = openLedger(); advanceCursor(db, 100);
  const outgoing = deposit(101); [outgoing.meta.preTokenBalances, outgoing.meta.postTokenBalances] = [outgoing.meta.postTokenBalances, outgoing.meta.preTokenBalances];
  const failed = deposit(102); failed.meta.err = { InstructionError: [] };
  const otherMint = deposit(103); otherMint.meta.postTokenBalances.forEach(b => b.mint = "other");
  const otherOwner = deposit(104); otherOwner.meta.postTokenBalances.forEach(b => b.owner = "someoneElse");
  await backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, pages(page([outgoing, failed, otherMint, otherOwner])));
  expect(countDeposits(db)).toBe(0); expect(getBalance(db, ACCOUNT)).toBe(0n); expect(getCursor(db)).toBe(110); db.close();
});

test("parser errors, a missing continuation and repeated tokens leave the checkpoint unchanged", async () => {
  for (const api of [
    pages({ ...page([]), data: [{ signature: "bad", parserStatus: "ERROR" }] }),
    pages(page([], undefined, "deadline")),
    pages(page([], "same"), page([], "same")),
  ]) {
    const db = openLedger(); advanceCursor(db, 100);
    await expect(backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, api)).rejects.toThrow();
    expect(getCursor(db)).toBe(100); db.close();
  }
});

test("a result outside the requested window is rejected", async () => {
  const db = openLedger(); advanceCursor(db, 100);
  await expect(backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, pages(page([deposit(500)])))).rejects.toThrow("outside");
  expect(countDeposits(db)).toBe(0); expect(getCursor(db)).toBe(100); db.close();
});

test("abort cannot advance the checkpoint even after the final response arrives", async () => {
  const db = openLedger(); advanceCursor(db, 100); const abort = new AbortController();
  await expect(backfill(cfg, db, { fromSlot: 100, toSlot: 110 }, {
    signal: abort.signal, request: async () => { abort.abort(); return Response.json(page([])); },
  })).rejects.toThrow();
  expect(getCursor(db)).toBe(100); db.close();
});

test("versioned transactions include loaded account addresses and keep exact integer amounts", async () => {
  const tx = deposit(101, 1_234_567n);
  const account = tx.transaction.message.accountKeys.pop()!;
  tx.meta.loadedAddresses = { writable: [account], readonly: [] };
  const result = await scanHistory(cfg, { fromSlot: 100, toSlot: 110 }, pages(page([tx])));
  expect(result.deposits[0]).toMatchObject({ account: ACCOUNT, amount: 1_234_567n, blockTime: 1_700_000_000 });
});
