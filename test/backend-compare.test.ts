import { expect, test } from "bun:test";
import { compareScans } from "../src/compare.ts";
import { loadConfig } from "../src/config.ts";
import type { RawTransaction, Request } from "../src/history.ts";
import { WALLET, deposit } from "./fixtures.ts";

const { cfg } = loadConfig({ HELIUS_API_KEY: "fixture-secret", WALLET, REWIND_SLOT: "100" });
const window = { fromSlot: 100, toSlot: 110 };
const page = (transactions: RawTransaction[], paginationToken?: string, stoppedOn = paginationToken ? "limit" : "windowEnd") => ({
  data: transactions.map(rawTransaction => ({
    signature: rawTransaction.transaction.signatures[0], parserStatus: "OK", rawTransaction,
  })),
  paginationToken,
  scan: { stoppedOn, creditsCharged: 1 },
});
const replies = (...values: unknown[]): Request => async () => {
  if (!values.length) throw new Error("Unexpected extra request");
  return Response.json(values.shift());
};

test("Compare counts a repeated transaction only once across pages", async () => {
  const tx = deposit(101, 1_234_567n);
  const result = await compareScans(cfg, window, {
    request: replies(page([tx], "next"), page([tx]), page([tx])),
  });
  expect(result.default).toEqual({ count: 1, raw: 1_234_567n });
  expect(result.balanceChanged).toEqual(result.default);
  expect(result.missed).toEqual({ count: 0, raw: 0n });
});

test("Compare rejects an incomplete scan without a continuation", async () => {
  await expect(compareScans(cfg, window, {
    request: replies(page([], undefined, "deadline"), page([])),
  })).rejects.toThrow("Incomplete Scan");
});

test("Compare rejects a parser failure instead of reporting a partial total", async () => {
  const broken = page([deposit(101)]);
  broken.data[0]!.parserStatus = "ERROR";
  await expect(compareScans(cfg, window, { request: replies(broken, page([])) })).rejects.toThrow("could not parse");
});

test("Compare rejects transactions outside the requested window", async () => {
  await expect(compareScans(cfg, window, {
    request: replies(page([deposit(111)]), page([])),
  })).rejects.toThrow("outside");
});

test("Compare rejects a signature mismatch", async () => {
  const broken = page([deposit(101)]);
  broken.data[0]!.signature = "different-signature";
  await expect(compareScans(cfg, window, { request: replies(broken, page([])) })).rejects.toThrow("signature");
});

test("Compare sanitizes transport errors before the server can log them", async () => {
  const request: Request = async url => { throw new Error(`Failed to fetch ${url}`); };
  await expect(compareScans(cfg, window, { request })).rejects.toThrow("Scan request failed; checkpoint unchanged");
  try {
    await compareScans(cfg, window, { request });
  } catch (error) {
    expect(String(error)).not.toContain(cfg.apiKey);
  }
});

test("Compare reports actual missing deposit identities rather than subtracting unrelated counts", async () => {
  const defaultOnly = deposit(101, 10_000n), fullOnly = deposit(102, 20_000n);
  const result = await compareScans(cfg, window, { request: replies(page([defaultOnly]), page([fullOnly])) });
  expect(result.missed).toEqual({ count: 1, raw: 20_000n });
});

test("Compare follows empty continuation pages for both queries", async () => {
  const tx = deposit(101);
  const result = await compareScans(cfg, window, {
    request: replies(page([], "a", "budget"), page([tx]), page([], "b", "deadline"), page([tx])),
  });
  expect(result.default).toEqual({ count: 1, raw: 10_000n });
  expect(result.balanceChanged).toEqual(result.default);
  expect(result.missed.count).toBe(0);
});
