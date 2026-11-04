import { expect, test } from "bun:test";
import { fromRawTransaction, walletDeposits } from "../src/history.ts";
import { advanceCursor, countDeposits, creditDeposit, getBalance, getCursor, openLedger } from "../src/ledger.ts";
import { parseDeposit } from "../src/parse.ts";
import { ACCOUNT, MINT, WALLET, deposit } from "./fixtures.ts";

const incoming = () => walletDeposits(fromRawTransaction(deposit(101)), WALLET, MINT)[0]!;

test("credit identity includes the token account and duplicate credits cannot change the balance", () => {
  const db = openLedger();
  try {
    const first = incoming();
    expect(creditDeposit(db, first, "backfill")).toBe("credited");
    expect(creditDeposit(db, { ...first, amount: 50_000n }, "backfill")).toBe("duplicate");
    expect(creditDeposit(db, { ...first, account: "second-token-account" }, "backfill")).toBe("credited");
    expect(countDeposits(db)).toBe(2);
    expect(getBalance(db, ACCOUNT)).toBe(first.amount);
    expect(getBalance(db, "second-token-account")).toBe(first.amount);
  } finally { db.close(); }
});

test("a balance update failure rolls back its deposit insert", () => {
  const db = openLedger();
  try {
    db.exec("CREATE TRIGGER reject_balance BEFORE INSERT ON balances BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect(() => creditDeposit(db, incoming(), "backfill")).toThrow("fixture failure");
    expect(countDeposits(db)).toBe(0);
    expect(getBalance(db, ACCOUNT)).toBe(0n);
    expect(getCursor(db)).toBeNull();
  } finally { db.close(); }
});

test("credits can defer the checkpoint and cursor advancement never rewinds it", () => {
  const db = openLedger();
  try {
    const d = incoming();
    expect(creditDeposit(db, d, "backfill", { advanceCheckpoint: false })).toBe("credited");
    expect(getCursor(db)).toBeNull();
    advanceCursor(db, 110);
    advanceCursor(db, 100);
    expect(getCursor(db)).toBe(110);
  } finally { db.close(); }
});

test("deposit detection rejects unchanged balances and missing destination accounts", () => {
  const tx = fromRawTransaction(deposit(101, 0n));
  expect(parseDeposit(tx, ACCOUNT, MINT)).toBeNull();
  expect(parseDeposit(tx, "absent", MINT)).toBeNull();
  expect(parseDeposit({ ...tx, postTokenBalances: [] }, ACCOUNT, MINT)).toBeNull();
});

test("a newly created token account starts from zero without losing integer precision", () => {
  const tx = fromRawTransaction(deposit(101, 4_000_001n));
  tx.preTokenBalances = tx.preTokenBalances.filter(b => b.owner !== WALLET);
  expect(parseDeposit(tx, ACCOUNT, MINT)?.amount).toBe(4_000_001n);
});

test("malformed raw transaction balances and missing signatures fail before crediting", () => {
  const tx = deposit(101);
  tx.meta.postTokenBalances[1]!.uiTokenAmount.amount = "1.25";
  expect(() => fromRawTransaction(tx)).toThrow("Invalid raw token amount");
  const unsigned = deposit(102);
  unsigned.transaction.signatures = [];
  expect(() => fromRawTransaction(unsigned)).toThrow("Incomplete history transaction");
});

test("the deposit parser rejects an increase in a different mint", () => {
  const raw = deposit(101);
  for (const balance of [...raw.meta.preTokenBalances, ...raw.meta.postTokenBalances]) balance.mint = "different-mint";
  expect(parseDeposit(fromRawTransaction(raw), ACCOUNT, MINT)).toBeNull();
});
