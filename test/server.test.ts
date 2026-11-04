import { afterAll, beforeAll, expect, test } from "bun:test";
import { WALLET } from "./fixtures.ts";

let serverProcess: ReturnType<typeof Bun.spawn>;
let origin: string;

beforeAll(async () => {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  origin = `http://127.0.0.1:${port}`;
  serverProcess = Bun.spawn([Bun.which("bun")!, "src/server.ts"], {
    env: { HELIUS_API_KEY: "fixture-api-key", WALLET, REWIND_SLOT: "100", PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = serverProcess.stdout as ReadableStream<Uint8Array>;
  const reader = output.getReader();
  const first = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(first.value)).toContain("scan-recovery");
});

afterAll(async () => {
  serverProcess?.kill("SIGINT");
  await serverProcess?.exited;
});

test("serves the page and state without credentials or source files", async () => {
  const page = await fetch(origin);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Scan backfill");
  const state = await fetch(`${origin}/api/state`);
  expect(await state.json()).toEqual({ network: "mainnet", backfill: null, recent: [], stats: { credited: 0 }, explorerSuffix: "" });
  for (const path of ["/.env", "/src/config.ts"]) {
    expect((await fetch(`${origin}${path}`)).status).toBe(404);
  }
});

test("rejects foreign hosts and cross-origin actions", async () => {
  expect((await fetch(`${origin}/api/state`, { headers: { host: "attacker.example" } })).status).toBe(403);
  expect((await fetch(`${origin}/reset`, { method: "POST", headers: { origin: "https://attacker.example" } })).status).toBe(403);
  expect((await fetch(`${origin}/reset`, { method: "POST", headers: { origin } })).status).toBe(200);
});

test("streams an initial snapshot and survives client disconnection", async () => {
  const response = await fetch(`${origin}/events`);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain("event: snapshot");
  await reader.cancel();
  expect((await fetch(`${origin}/reset`, { method: "POST" })).status).toBe(200);
  expect((await fetch(`${origin}/api/state`)).status).toBe(200);
});
