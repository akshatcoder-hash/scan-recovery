(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const GAP = 200; // one token every 200 ms, in arrival order
  let state = null, connected = false, working = false, comparing = false, stream = null, events = [];
  let reconnectTimer, M = null, svg = null, run = null;
  let pending = 0, shown = 0, active = 0, flaps = 0, punching = false, lastLaunch = 0, pumping = false, headX = 0, cpX = 0;
  const queue = [];

  const announce = (m) => ($("announcer").textContent = m);
  const notice = (m) => { $("notice").textContent = m; $("notice").hidden = !m; };
  const money = (v) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const usd = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const short = (v) => v.slice(0, 6) + "…" + v.slice(-5);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  let theme = "light";
  try { theme = localStorage.getItem("deposit-watcher-theme") === "dark" ? "dark" : "light"; } catch {}
  function setTheme() {
    document.documentElement.dataset.theme = theme;
    $("theme").textContent = theme === "dark" ? "Light mode" : "Dark mode";
    try { localStorage.setItem("deposit-watcher-theme", theme); } catch {}
  }
  setTheme();
  $("theme").addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; setTheme(); });

  /* ---- camera, same formula as the drawing ---- */
  const cam = () => {
    const a = (M.P.azimuth * Math.PI) / 180, e = (M.P.elevation * Math.PI) / 180, k = M.P.scale * Math.sqrt(1.6);
    return { sa: Math.sin(a), ca: Math.cos(a), se: Math.sin(e), ce: Math.cos(e), k };
  };
  const iso = ([x, y, z]) => {
    const c = cam();
    return [M.P.origin[0] + (x * c.sa - y * c.ca) * c.k, M.P.origin[1] + ((x * c.ca + y * c.sa) * c.se - z * c.ce) * c.k];
  };
  const shift = (p) => { const a = iso(p), o = iso([0, 0, 0]); return `translate(${(a[0] - o[0]).toFixed(2)} ${(a[1] - o[1]).toFixed(2)})`; };

  /* ---- easing and one animation loop ---- */
  const bez = (x1, y1, x2, y2) => (x) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
      const d = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
      if (Math.abs(d) < 1e-6) break;
      t -= cx / d;
    }
    return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  };
  const EASE = { out: bez(0.23, 1, 0.32, 1), inOut: bez(0.77, 0, 0.175, 1), lin: (t) => t };
  const actors = new Set();
  let raf = 0;
  function loop(now) {
    for (const a of [...actors]) if (a(now) === false) actors.delete(a);
    raf = actors.size ? requestAnimationFrame(loop) : 0;
  }
  const act = (fn) => { actors.add(fn); if (!raf) raf = requestAnimationFrame(loop); };
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  function timeline(keys, apply, done) {
    const t0 = performance.now();
    act((now) => {
      const t = now - t0;
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i], b = keys[i + 1];
      const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
      const f = EASE[b.ease || "inOut"](k);
      apply({ p: a.p.map((v, j) => v + (b.p[j] - v) * f), o: a.o + (b.o - a.o) * f });
      if (t >= keys[keys.length - 1].t) { done && done(); return false; }
    });
  }
  const tween = (from, to, ms, apply, done) => {
    const t0 = performance.now();
    act((now) => {
      const k = Math.min(1, (now - t0) / ms);
      apply(from + (to - from) * EASE.inOut(k));
      if (k >= 1) { done && done(); return false; }
    });
  };

  /* ---- where a slot sits on the history rail ---- */
  const slotX = (slot) => {
    const w = run;
    if (!w || w.toSlot === w.fromSlot) return M.rail.from;
    const f = Math.min(1, Math.max(0, (slot - w.fromSlot) / (w.toSlot - w.fromSlot)));
    return M.rail.from + f * M.rail.span;
  };
  const setHead = (x) => {
    headX = x;
    const t = shift([x - M.rail.from, 0, 0]);
    for (const id of ["head-back", "head-front", "head-top"]) $(id).setAttribute("transform", t);
  };
  const setCheckpoint = (x) => { cpX = x; $("checkpoint").setAttribute("transform", shift([x - M.rail.from, 0, 0])); };
  const moveHead = (x, ms) => tween(headX, x, ms, setHead);
  const moveCheckpoint = (x, ms) => tween(cpX, x, ms, setCheckpoint);

  function flapState(closed) { closed ? $("flaps").setAttribute("data-closed", "") : $("flaps").removeAttribute("data-closed"); }
  function punchCycle(reject) {
    if (punching) return;
    punching = true;
    const g = svg.querySelector("#punch"), up = M.PUNCH_UP, dn = M.PUNCH_DOWN;
    const keys = reject
      ? [{ t: 0, p: [0, 0, up], o: 1 }, { t: 110, p: [0, 0, dn + 3], o: 1, ease: "out" }, { t: 170, p: [0, 0, dn + 3], o: 1 }, { t: 330, p: [0, 0, up], o: 1, ease: "out" }]
      : [{ t: 0, p: [0, 0, up], o: 1 }, { t: 140, p: [0, 0, dn], o: 1, ease: "out" }, { t: 260, p: [0, 0, dn], o: 1 }, { t: 480, p: [0, 0, up], o: 1, ease: "out" }];
    timeline(keys, ({ p }) => g.setAttribute("transform", shift([0, 0, p[2] - up])), () => (punching = false));
  }

  function drawNeedle(turn) {
    const a = turn * Math.PI * 2, [x, y] = M.dial, r = M.dialR, z = M.dialTop + 1;
    const p = (px, py) => iso([px, py, z]).map((v) => v.toFixed(1)).join(" ");
    $("needle").setAttribute("d", `M${p(x - Math.sin(a) * 2.6, y + Math.cos(a) * 2.6)}L${p(x + Math.sin(a) * (r - 4), y - Math.cos(a) * (r - 4))}`);
  }
  const needle = (n) => drawNeedle(n / 50);

  /* ---- one token: head stops at its slot, token drops into the trough, rides to the gate ---- */
  function launchCoin(e) {
    const g = document.createElementNS(NS, "g");
    g.innerHTML = M.coin;
    const coin = g.firstChild;
    $("coins").appendChild(coin);
    const hx = slotX(e.slot), z = M.Z0, gx = M.GATE_X;
    const [, sy, sz] = M.spout;
    const set = ({ p, o }) => { coin.setAttribute("transform", shift(p)); coin.style.opacity = o; };
    const ground = (kind) => coin.setAttribute("data-kind", kind);
    active++;
    const fin = () => { coin.remove(); if (--active === 0 && !queue.length) settle(); };
    const g0 = 1500; // every token reaches the gate 1.5 s after it drops, so order never changes
    const head = [
      { t: 0, p: [hx, sy, sz], o: 0 },
      { t: 70, p: [hx, sy, sz - 2], o: 1, ease: "out" },
      { t: 330, p: [hx, -1, z + 2], o: 1, ease: "inOut" },
      { t: 400, p: [hx + 2, 0, z], o: 1, ease: "out" },
      { t: g0, p: [gx, 0, z], o: 1 },
    ];
    if (e.action === "credited") {
      later(() => ground("credited"), g0 + 60);
      later(() => punchCycle(false), g0 - 40);
      timeline([...head, { t: g0 + 480, p: [gx, 0, z], o: 1 }, { t: g0 + 1160, p: [M.bin.x + 2, 0, z], o: 1 }, { t: g0 + 1440, p: [M.bin.x + 16, 0, z], o: 1, ease: "out" }, { t: g0 + 1820, p: [M.bin.x + 18, 0, 3.4], o: 0, ease: "out" }], set, () => { shown++; needle(shown); fin(); });
    } else {
      later(() => ground("duplicate"), g0 + 60);
      later(() => punchCycle(true), g0 - 40);
      later(() => { flaps++; flapState(true); }, g0 + 330);
      later(() => { if (--flaps <= 0) { flaps = 0; flapState(false); } }, g0 + 2180);
      timeline([...head, { t: g0 + 60, p: [gx - 1.4, 0, z], o: 1, ease: "out" }, { t: g0 + 120, p: [gx + 1, 0, z], o: 1, ease: "out" }, { t: g0 + 480, p: [gx, 0, z], o: 1 },
        { t: g0 + 940, p: [M.FLAP_X + 4, 0, z], o: 1 }, { t: g0 + 1440, p: [M.dup.x + 14, M.dup.y + 6, z], o: 1, ease: "out" }, { t: g0 + 1740, p: [M.dup.x + 14, M.dup.y + 14, 2.4], o: 1, ease: "out" },
        { t: g0 + 2280, p: [M.dup.x + 14, M.dup.y + 14, 2.4], o: 0 }], set, fin);
    }
  }
  const busy = () => queue.length > 0 || active > 0 || pending > 0;

  function launch(e) {
    lastLaunch = performance.now();
    const x = slotX(e.slot);
    moveHead(x, GAP * 0.8);
    pending++;
    later(() => { pending--; launchCoin(e); }, GAP * 0.8); // the head arrives first, then it drops the token
  }
  function drain() {
    if (!queue.length || pumping) return;
    pumping = true;
    later(() => { pumping = false; if (queue.length) launch(queue.shift()); drain(); }, Math.max(0, lastLaunch + GAP - performance.now()));
  }
  function play(e) {
    if (!M) return;
    if (still.matches) { if (e.action === "credited") needle(++shown); return; }
    queue.push(e);
    drain();
  }

  /* when every token has landed: read the head home, and move the checkpoint only if the scan completed */
  function settle() {
    if (!M || busy()) return;
    const b = state?.backfill;
    if (b?.state === "complete") {
      const to = M.rail.from + M.rail.span;
      still.matches ? setCheckpoint(to) : moveCheckpoint(to, 900);
      moveHead(M.rail.from, 700);
    } else if (b?.state === "failed") {
      moveHead(M.rail.from, 500);
    }
    needle(state?.stats?.credited ?? shown);
    shown = state?.stats?.credited ?? shown;
  }
  function onBackfill(b) {
    const starting = b.state === "running" && (!run || run.fromSlot !== b.fromSlot || run.toSlot !== b.toSlot || !state?.backfill || state.backfill.state !== "running");
    run = { fromSlot: b.fromSlot, toSlot: b.toSlot };
    if (starting && M) {
      queue.length = 0;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      pumping = false;
      pending = 0;
      moveCheckpoint(M.rail.from, still.matches ? 1 : 500);
      shown = state?.stats?.credited ?? 0;
    }
  }

  /* ---- reset: stop everything in flight and go back to the empty rig ---- */
  function cancelAll() {
    queue.length = 0;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    actors.clear();
    cancelAnimationFrame(raf);
    raf = 0;
    pending = active = flaps = 0;
    pumping = punching = false;
    if (!M) return;
    $("coins").replaceChildren();
    $("punch").removeAttribute("transform");
    flapState(false);
    run = null;
  }

  /* ---- page ---- */
  function renderStatus() {
    const b = state?.backfill;
    const mode = !connected ? "offline" : b?.state === "running" ? "backfilling" : "readonly";
    const labels = { backfilling: "Backfilling", readonly: "Read-only", offline: "Dashboard reconnecting" };
    $("connection").dataset.state = mode;
    $("connection-label").textContent = labels[mode];
    $("backfill-status").hidden = !b;
    $("backfill-status").textContent = !b ? "" : b.state === "running"
      ? `Backfilling · ${b.credited} credited`
      : b.state === "failed" ? "Backfill incomplete · checkpoint saved"
      : `Backfill complete · ${b.credited} credited · ${b.duplicate} skipped${b.ms === undefined ? "" : ` · ${(b.ms / 1000).toFixed(1)}s`}`;
    const ready = connected && state;
    $("backfill-run").disabled = !ready || working || mode === "backfilling";
    $("compare-run").disabled = !ready || comparing;
    $("reset-run").disabled = !ready || working || mode === "backfilling";
    $("backfill-run").textContent = working || mode === "backfilling" ? "Running…" : "Run backfill";
    $("compare-run").textContent = comparing ? "Comparing…" : "Compare";
  }
  function renderRows() {
    const body = $("transactions");
    body.replaceChildren();
    if (!events.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 3; cell.className = "empty"; cell.textContent = "No transactions yet.";
      return;
    }
    events.slice(0, 10).forEach((event) => {
      const row = body.insertRow();
      const first = row.insertCell();
      const link = document.createElement("a");
      link.className = "transaction-link";
      link.textContent = short(event.signature) + " ↗";
      link.href = `https://explorer.solana.com/tx/${encodeURIComponent(event.signature)}${state?.explorerSuffix ?? ""}`;
      link.target = "_blank"; link.rel = "noopener noreferrer"; link.title = event.signature;
      link.setAttribute("aria-label", `View transaction ${event.signature} in Solana Explorer`);
      first.append(link);
      const meta = document.createElement("div");
      meta.className = "tx-meta";
      meta.textContent = `${time.format(event.t)} · ${event.source}`;
      first.append(meta);
      const amount = row.insertCell();
      amount.className = "numeric";
      amount.textContent = event.amount ? `${event.action === "credited" ? "+" : ""}${money(event.amount)}` : "—";
      const badge = document.createElement("span");
      badge.className = `result ${event.action}`;
      badge.textContent = { credited: "Credited", duplicate: "Skipped", ignored: "Ignored" }[event.action] ?? event.action;
      row.insertCell().append(badge);
    });
  }
  function render() {
    if (!state) return;
    renderStatus();
    $("network").textContent = state.network;
    renderRows();
  }
  function snapshot(data) {
    state = data;
    events = [...data.recent].reverse();
    run = data.backfill ? { fromSlot: data.backfill.fromSlot, toSlot: data.backfill.toSlot } : null;
    render();
    if (M && !busy()) {
      shown = data.stats.credited;
      needle(shown);
      const done = data.backfill?.state === "complete";
      setCheckpoint(done ? M.rail.from + M.rail.span : M.rail.from);
      setHead(M.rail.from);
    }
  }

  async function boot() {
    try {
      const [meta, markup] = await Promise.all([
        fetch("/rig.json", { signal: AbortSignal.timeout(5000) }).then((r) => { if (!r.ok) throw Error("metadata"); return r.json(); }),
        fetch("/rig.svg", { signal: AbortSignal.timeout(5000) }).then((r) => { if (!r.ok) throw Error("drawing"); return r.text(); }),
      ]);
      M = meta;
      $("machine").insertAdjacentHTML("beforeend", markup);
      svg = $("machine").querySelector("svg");
      $("machine-loading").remove();
      if (state) snapshot(state);
    } catch {
      const note = $("machine-loading");
      note.textContent = "The machine could not load. ";
      const retry = document.createElement("button");
      retry.textContent = "Retry drawing";
      retry.addEventListener("click", boot);
      note.append(retry);
    }
  }

  async function refresh() {
    try {
      const r = await fetch("/api/state", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error("state");
      if (!connected) snapshot(await r.json());
    } catch {
      if (!state) notice("Server unavailable. Run bun run dev; this page retries automatically.");
    }
  }
  function connect() {
    if (!("EventSource" in window)) { notice("Live streaming is unavailable in this browser."); return; }
    clearTimeout(reconnectTimer);
    stream?.close();
    stream = new EventSource("/events");
    stream.addEventListener("reset", () => {
      cancelAll();
      $("compare-result").hidden = true;
      announce("Ledger reset.");
    });
    stream.addEventListener("snapshot", (e) => { connected = true; notice(""); snapshot(JSON.parse(e.data)); });
    stream.addEventListener("backfill", (e) => {
      const b = JSON.parse(e.data);
      onBackfill(b);
      if (state) { state.backfill = b; renderStatus(); }
      if (b.state !== "running" && !busy()) settle();
    });
    stream.addEventListener("stats", (e) => { if (state) state.stats = JSON.parse(e.data); });
    stream.addEventListener("tx", (e) => {
      const event = JSON.parse(e.data);
      events.unshift(event);
      events.length = Math.min(events.length, 10);
      if (state) state.recent = [...events].reverse();
      renderRows();
      announce(event.action === "credited" ? `Credited ${money(event.amount)} USDC` : "Duplicate skipped.");
      play(event);
    });
    stream.onerror = () => {
      stream.close();
      connected = false;
      renderStatus();
      notice("Connection lost. Reconnecting…");
      void refresh();
      reconnectTimer = setTimeout(connect, 2000);
    };
  }

  async function post(path) {
    const r = await fetch(path, { method: "POST", signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(path);
    return r.json();
  }
  async function runLedgerAction(path, failure) {
    if (working || !connected || !state) return;
    working = true; renderStatus();
    try { await post(path); notice(""); } catch { notice(failure); }
    finally { working = false; renderStatus(); }
  }
  $("backfill-run").addEventListener("click", () => runLedgerAction("/backfill", "Backfill did not finish. Try again."));
  $("reset-run").addEventListener("click", () => runLedgerAction("/reset", "Reset did not finish. Try again."));
  $("compare-run").addEventListener("click", async () => {
    if (comparing || !connected || !state) return;
    comparing = true; renderStatus();
    try {
      const r = await post("/compare");
      for (const [key, id] of [["default", "default"], ["balanceChanged", "full"], ["missed", "missed"]]) {
        $(`cmp-${id}-n`).textContent = `${r[key].count} deposits`;
        $(`cmp-${id}-usdc`).textContent = `${usd(r[key].usdc)} USDC`;
      }
      $("compare-result").hidden = false;
      notice("");
    } catch { notice("Comparison did not finish. Try again."); }
    finally { comparing = false; renderStatus(); }
  });

  void refresh();
  connect();
  void boot();
  setInterval(() => { if (!connected) void refresh(); }, 10000);
})();
