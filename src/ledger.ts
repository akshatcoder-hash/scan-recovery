import { Database } from "bun:sqlite";
import type { CreditResult, Deposit } from "./types.ts";

// The ledger lives in memory: every server start begins empty, and nothing is written to disk.
export function openLedger(): Database {
  const db = new Database(":memory:", { safeIntegers: true });
  db.exec(`
    CREATE TABLE deposits (
      signature  TEXT    NOT NULL,
      account    TEXT    NOT NULL,
      amount     INTEGER NOT NULL,
      sender     TEXT,
      slot       INTEGER NOT NULL,
      block_time INTEGER,
      source     TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (signature, account)
    );
    CREATE TABLE balances (
      account TEXT PRIMARY KEY,
      amount  INTEGER NOT NULL
    );
    CREATE TABLE cursor (
      id        INTEGER PRIMARY KEY CHECK (id = 1),
      last_slot INTEGER NOT NULL
    );
  `);
  return db;
}

export function resetLedger(db: Database): void {
  db.exec("DELETE FROM deposits; DELETE FROM balances; DELETE FROM cursor;");
}

// The only writer of balances. The UNIQUE key makes the insert the idempotency check, and the
// insert and balance update share one transaction. Backfill defers its checkpoint until every page is done.
export function creditDeposit(db: Database, d: Deposit, source: string, options: { advanceCheckpoint?: boolean } = {}): CreditResult {
  const run = db.transaction((): CreditResult => {
    const inserted = db
      .query(
        `INSERT OR IGNORE INTO deposits (signature, account, amount, sender, slot, block_time, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.signature, d.account, d.amount, d.sender, d.slot, d.blockTime, source);
    if (inserted.changes === 0) return "duplicate";
    db.query(
      `INSERT INTO balances (account, amount) VALUES (?, ?)
       ON CONFLICT (account) DO UPDATE SET amount = amount + excluded.amount`,
    ).run(d.account, d.amount);
    if (options.advanceCheckpoint !== false) advanceCursor(db, d.slot);
    return "credited";
  });
  return run();
}

// Moves forward only.
export function advanceCursor(db: Database, slot: number): void {
  db.query(
    `INSERT INTO cursor (id, last_slot) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET last_slot = max(last_slot, excluded.last_slot)`,
  ).run(slot);
}

export function setCursor(db: Database, slot: number): void {
  db.query("INSERT INTO cursor VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_slot=excluded.last_slot").run(slot);
}

export function getCursor(db: Database): number | null {
  const row = db.query("SELECT last_slot FROM cursor WHERE id = 1").get() as { last_slot: bigint } | null;
  return row ? Number(row.last_slot) : null;
}

export function getBalance(db: Database, account: string): bigint {
  const row = db.query("SELECT amount FROM balances WHERE account = ?").get(account) as { amount: bigint } | null;
  return row?.amount ?? 0n;
}

export function countDeposits(db: Database): number {
  return Number((db.query("SELECT count(*) AS n FROM deposits").get() as { n: bigint }).n);
}
