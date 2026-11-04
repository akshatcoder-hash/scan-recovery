import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const env = { HELIUS_API_KEY: "test", WALLET: "11111111111111111111111111111111", REWIND_SLOT: "100" };

test("accepts a 32-byte base58 wallet and the default port", () => {
  const { cfg, defaults } = loadConfig(env);
  expect(cfg.wallet).toBe(env.WALLET);
  expect(defaults.port).toBe(3002);
});

test.each(["0", "65536", "-1", "1.5", "nope"])("rejects unusable HTTP port %s", (port) => {
  expect(() => loadConfig({ ...env, PORT: port })).toThrow("PORT");
});

test.each(["0OIl", "111", "1".repeat(33)])("rejects invalid wallet %s", (wallet) => {
  expect(() => loadConfig({ ...env, WALLET: wallet })).toThrow();
});

test.each(["-1", "1.5", "nope"])("rejects invalid slot %s", (slot) => {
  expect(() => loadConfig({ ...env, REWIND_SLOT: slot })).toThrow("REWIND_SLOT");
});

test("requires the API key and wallet without including key values in errors", () => {
  expect(() => loadConfig({ ...env, HELIUS_API_KEY: "" })).toThrow("Missing HELIUS_API_KEY");
  expect(() => loadConfig({ ...env, WALLET: "" })).toThrow("Missing WALLET");
});
