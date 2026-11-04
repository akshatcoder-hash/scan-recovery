import type { RawTransaction } from "../src/history.ts";

export const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WALLET = "11111111111111111111111111111111";
export const ACCOUNT = "So11111111111111111111111111111111111111112";
const SENDER = "Vote111111111111111111111111111111111111111";
const SENDER_ACCOUNT = "Stake11111111111111111111111111111111111111";

let counter = 0;
const signature = () => `sig${String(++counter).padStart(6, "0")}`;

// A Scan-shaped raw transaction: WALLET's token account goes from 0 to `amount`.
export function deposit(slot: number, amount = 10_000n, id = signature()): RawTransaction {
  const balance = (accountIndex: number, owner: string, value: bigint) => ({ accountIndex, mint: MINT, owner, uiTokenAmount: { amount: String(value) } });
  return {
    slot, blockTime: 1_700_000_000,
    transaction: { signatures: [id], message: { accountKeys: [SENDER, SENDER_ACCOUNT, ACCOUNT] } },
    meta: {
      err: null,
      preTokenBalances: [balance(1, SENDER, 5_000_000n), balance(2, WALLET, 0n)],
      postTokenBalances: [balance(1, SENDER, 5_000_000n - amount), balance(2, WALLET, amount)],
    },
  };
}
