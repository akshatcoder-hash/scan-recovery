import { beforeEach, expect, spyOn, test } from "bun:test";
import { Busy, createActions } from "../src/actions.ts";
import { loadConfig } from "../src/config.ts";
import type { RawTransaction, Request } from "../src/history.ts";
import { countDeposits, getBalance, getCursor, openLedger } from "../src/ledger.ts";
import { ACCOUNT, WALLET, deposit } from "./fixtures.ts";

const { cfg } = loadConfig({ HELIUS_API_KEY: "test", WALLET, REWIND_SLOT: "100" });
const HEAD = 2_000_000;
const deposits = Array.from({ length: 46 }, (_, i) => deposit(1000 + i, BigInt(1_000_000 + i)));
const scanPage = (data: RawTransaction[]) => ({
  data: data.map(r => ({ signature: r.transaction.signatures[0], parserStatus: "OK", rawTransaction: r })),
  scan: { stoppedOn: "windowEnd", creditsCharged: 12, scannedTransactions: data.length, matchedTransactions: data.length },
});

function api(options: { gate?: Promise<void>; byTokenAccounts?: boolean } = {}) {
  const bodies: { tokenAccounts?: string; slot: { gte: number; lte: number } }[] = [];
  const request: Request = async (url, init) => {
    if (!url.includes("/v1/parsed-events/scan")) return Response.json({ result: HEAD });
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    await options.gate;
    // Without balanceChanged the default scan misses the last 14, like the real wallet did.
    return Response.json(scanPage(options.byTokenAccounts && !body.tokenAccounts ? deposits.slice(0, 32) : deposits));
  };
  return { request, bodies };
}
const defaults = { rewindSlot: 100, toSlot: HEAD };

beforeEach(() => { spyOn(console, "log").mockImplementation(() => {}); });

test("two Run backfill clicks credit 46, then 0 and skip 46", async () => {
  const db = openLedger();
  const actions = createActions(cfg, db, defaults, api().request);
  expect(await actions.backfill()).toMatchObject({ credited: 46, duplicate: 0, fromSlot: 100, toSlot: HEAD });
  const balance = getBalance(db, ACCOUNT);
  expect(countDeposits(db)).toBe(46);
  expect(await actions.backfill()).toMatchObject({ credited: 0, duplicate: 46 });
  expect(countDeposits(db)).toBe(46);
  expect(getBalance(db, ACCOUNT)).toBe(balance);
  expect(getCursor(db)).toBe(HEAD);
  db.close();
});

test("Reset empties the ledger, so the next Run backfill credits 46 again", async () => {
  const db = openLedger();
  const actions = createActions(cfg, db, defaults, api().request);
  await actions.backfill();
  await actions.reset();
  expect(countDeposits(db)).toBe(0); expect(getBalance(db, ACCOUNT)).toBe(0n); expect(getCursor(db)).toBeNull();
  expect(await actions.backfill()).toMatchObject({ credited: 46, duplicate: 0 });
  db.close();
});

test("a new ledger always starts empty", () => {
  const first = openLedger(); const second = openLedger();
  expect(countDeposits(first)).toBe(0); expect(countDeposits(second)).toBe(0);
  first.close(); second.close();
});

test("a click while a backfill is running is refused, for Run backfill and Reset, then works again", async () => {
  const db = openLedger();
  let open!: () => void;
  const gate = new Promise<void>(r => (open = r));
  const actions = createActions(cfg, db, defaults, api({ gate }).request);
  const running = actions.backfill();
  await expect(actions.backfill()).rejects.toBeInstanceOf(Busy);
  await expect(actions.reset()).rejects.toBeInstanceOf(Busy);
  open();
  expect((await running).credited).toBe(46);
  expect((await actions.backfill()).duplicate).toBe(46);
  db.close();
});

test("Compare reports default vs balanceChanged and never touches the ledger", async () => {
  const db = openLedger();
  const snapshot = () => ({ rows: countDeposits(db), balance: getBalance(db, ACCOUNT), cursor: getCursor(db), all: db.query("SELECT * FROM deposits").all() });
  const before = snapshot();
  const scan = api({ byTokenAccounts: true });
  const result = await createActions(cfg, db, defaults, scan.request).compare();
  expect(result.default.count).toBe(32);
  expect(result.balanceChanged.count).toBe(46);
  expect(result.missed.count).toBe(14);
  expect(scan.bodies.map(b => b.tokenAccounts)).toEqual([undefined, "balanceChanged"]);
  expect(scan.bodies.every(b => b.slot.gte === 100 && b.slot.lte === HEAD)).toBe(true);
  expect(snapshot()).toEqual(before);
  db.close();
});

test("a rewind slot inside the replay window is refused", async () => {
  const db = openLedger();
  const actions = createActions(cfg, db, { rewindSlot: HEAD - 10, toSlot: HEAD }, api().request);
  await expect(actions.backfill()).rejects.toThrow("REWIND_SLOT");
  expect(countDeposits(db)).toBe(0); db.close();
});

test.each(["invalid", -1, 1.5, null])("rejects an invalid finalized head %p before scanning", async (head) => {
  const db = openLedger();
  const request: Request = async (url) => {
    if (url.includes("/v1/parsed-events/scan")) throw new Error("Scan must not run with an invalid head");
    return Response.json({ result: head });
  };
  const actions = createActions(cfg, db, defaults, request);
  try {
    await expect(actions.compare()).rejects.toThrow("getSlot");
    expect(countDeposits(db)).toBe(0);
  } finally {
    db.close();
  }
});
