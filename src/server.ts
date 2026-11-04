import { createActions, Busy } from "./actions.ts";
import { loadConfig } from "./config.ts";
import { onBackfill, onTx, publishBackfill, type BackfillEvent, type TxEvent } from "./events.ts";
import { countDeposits, openLedger } from "./ledger.ts";
import { logInfo } from "./log.ts";

const HOST = "127.0.0.1";
const { cfg, defaults } = loadConfig();
const PORT = defaults.port;
const db = openLedger();
const actions = createActions(cfg, db, defaults);

let backfillState: BackfillEvent | null = null;
let recent: TxEvent[] = [];
const clients = new Set<ReadableStreamDefaultController<string>>();

function send(event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.enqueue(frame); } catch { clients.delete(c); }
  }
}
const snapshot = () => ({
  network: cfg.network,
  backfill: backfillState,
  recent: [...recent].reverse(),
  stats: { credited: countDeposits(db) },
  explorerSuffix: "",
});

onTx((e) => {
  recent.unshift(e);
  recent.length = Math.min(recent.length, 10);
  send("tx", e);
  send("stats", snapshot().stats);
});
onBackfill((event) => {
  backfillState = event;
  send("backfill", event);
});

// The page is only ever served to this machine. These checks stop another website open in
// your browser from calling the local API (DNS rebinding and cross-site POSTs).
const hostOk = (req: Request) => [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.get("host") ?? "");
const originOk = (req: Request) => {
  const o = req.headers.get("origin");
  return o === null || o === `http://${HOST}:${PORT}` || o === `http://localhost:${PORT}`;
};
const PAGE = new Map([
  ["/", "index.html"], ["/app.js", "app.js"], ["/app.css", "app.css"], ["/base.css", "base.css"],
  ["/machine.css", "machine.css"], ["/tokens.css", "tokens.css"], ["/rig.svg", "rig.svg"], ["/rig.json", "rig.json"],
]);
const abort = new AbortController();

function eventStream(): Response {
  let ctl!: ReadableStreamDefaultController<string>;
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<string>({
    start(c) {
      ctl = c;
      clients.add(c);
      c.enqueue(`retry: 1000\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      ping = setInterval(() => c.enqueue(": ping\n\n"), 15_000);
    },
    cancel() { clearInterval(ping); clients.delete(ctl); },
  });
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

async function runAction(name: keyof typeof actions): Promise<Response> {
  try {
    const result = await actions[name](abort.signal);
    if (name === "reset") {
      recent = [];
      backfillState = null;
      send("reset", {});
      send("snapshot", snapshot());
    }
    return Response.json(result ?? {});
  } catch (error) {
    if (error instanceof Busy) return Response.json({ error: "busy" }, { status: 409 });
    logInfo(`${name} failed`, { error: error instanceof Error ? error.message : "unknown" });
    if (name === "backfill" && backfillState?.state !== "failed")
      publishBackfill({ state: "failed", fromSlot: 0, toSlot: 0, credited: 0, duplicate: 0 });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (!hostOk(req)) return new Response("bad host", { status: 403 });
    const file = PAGE.get(url.pathname);
    if (req.method === "GET" && file) return new Response(Bun.file(`public/${file}`), { headers: { "cache-control": "no-store" } });
    if (req.method === "GET" && url.pathname === "/api/state") return Response.json(snapshot(), { headers: { "cache-control": "no-store" } });
    if (req.method === "GET" && url.pathname === "/events") return eventStream();
    if (req.method === "POST" && ["/compare", "/backfill", "/reset"].includes(url.pathname)) {
      if (!originOk(req)) return new Response("bad origin", { status: 403 });
      const name = url.pathname.slice(1) as "compare" | "backfill" | "reset";
      return runAction(name);
    }
    return new Response("not found", { status: 404 });
  },
});

logInfo("scan-recovery", { url: `http://${HOST}:${PORT}`, wallet: cfg.wallet, rewindSlot: defaults.rewindSlot, toSlot: defaults.toSlot ?? "finalized head" });
process.on("SIGINT", () => { abort.abort(); process.exit(0); });
