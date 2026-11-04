import bs58 from "bs58";

export const REPLAY_WINDOW_SLOTS = 691_200; // LaserStream replays about 48 hours

export interface Config {
  network: "mainnet";
  rpcUrl: string;
  usdcMint: string;
  apiKey: string;
  wallet: string;
}

export interface Defaults {
  rewindSlot: number;
  toSlot?: number;
  port: number;
}

const need = (env: Record<string, string | undefined>, key: string) => {
  const value = env[key];
  if (!value) throw new Error(`Missing ${key}. Copy .env.example to .env and fill it in.`);
  return value;
};
const slot = (value: string, key: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${key} must be a slot number`);
  return n;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): { cfg: Config; defaults: Defaults } {
  const wallet = need(env, "WALLET");
  if (bs58.decode(wallet).length !== 32) throw new Error("WALLET must be a 32-byte base58 public key");
  const port = env.PORT ? slot(env.PORT, "PORT") : 3002;
  if (port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  return {
    cfg: {
      network: "mainnet",
      rpcUrl: "https://mainnet.helius-rpc.com",
      usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      apiKey: need(env, "HELIUS_API_KEY"),
      wallet,
    },
    defaults: {
      rewindSlot: slot(need(env, "REWIND_SLOT"), "REWIND_SLOT"),
      toSlot: env.TO_SLOT ? slot(env.TO_SLOT, "TO_SLOT") : undefined,
      port,
    },
  };
}
