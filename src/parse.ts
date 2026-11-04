import type { Deposit, NormalizedTx, TokenBalance } from "./types.ts";

// A deposit is a successful transaction in which the watched token account's
// balance for the USDC mint went up. Pre/post token balances are the truth.
// Instructions are never inspected, so CPI transfers and Transfer/TransferChecked all look the same.
export function parseDeposit(tx: NormalizedTx, watchedAccount: string, mint: string): Deposit | null {
  if (tx.failed) return null;

  const index = tx.accountKeys.indexOf(watchedAccount);
  if (index === -1) return null;

  const pre = tx.preTokenBalances.find((b) => b.accountIndex === index && b.mint === mint);
  const post = tx.postTokenBalances.find((b) => b.accountIndex === index && b.mint === mint);
  if (!post) return null;

  const delta = post.amount - (pre?.amount ?? 0n);
  if (delta <= 0n) return null;

  return {
    signature: tx.signature,
    account: watchedAccount,
    amount: delta,
    sender: findSender(tx, mint, index),
    slot: tx.slot,
    blockTime: null,
  };
}

// The sender is the owner of the USDC account whose balance dropped the most.
function findSender(tx: NormalizedTx, mint: string, watchedIndex: number): string | null {
  let best: { owner: string; drop: bigint } | null = null;
  for (const pre of tx.preTokenBalances) {
    if (pre.mint !== mint || pre.accountIndex === watchedIndex) continue;
    const post = tx.postTokenBalances.find((b) => b.accountIndex === pre.accountIndex && b.mint === mint);
    const drop = pre.amount - (post?.amount ?? 0n);
    if (drop > 0n && (!best || drop > best.drop)) best = { owner: pre.owner, drop };
  }
  return best?.owner ?? null;
}
