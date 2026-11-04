export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner: string;
  amount: bigint; // raw base units (USDC has 6 decimals)
}

export interface NormalizedTx {
  signature: string;
  slot: number;
  failed: boolean;
  blockTime?: number | null;
  accountKeys: string[]; // static keys followed by loaded address-table keys
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
}

export interface Deposit {
  signature: string;
  account: string; // the token account that received USDC
  amount: bigint;
  sender: string | null;
  slot: number;
  blockTime: number | null;
}

export type CreditResult = "credited" | "duplicate";
export type Action = CreditResult;
