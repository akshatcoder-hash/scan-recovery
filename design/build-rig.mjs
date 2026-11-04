// Draws the Scan rig: a history rail, a read head that sweeps it, a trough, and the creditDeposit gate.
// Output goes to public/rig.svg and public/rig.json. Run: bun design/build-rig.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./anatomy-kit.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const W = 1000, H = 440;

const PLATE = { x: -250, y: -90, w: 590, d: 180, r: 8 };
const PLATE_H = 12, FOOT_H = 5;
const Z0 = 6;
const COIN_R = 7.4, COIN_H = 3.6;

// history rail: x runs from the saved checkpoint slot (left) to the finalized head slot (right)
const RX0 = -216, RX1 = 54, LEN = RX1 - RX0;
const BED = { x: RX0, y: -49, w: LEN, d: 20, r: 1 };
const HX0 = RX0 + 12; // rest x of the read head and the checkpoint carriage
const SWEEP = LEN - 24;
const HEAD_TOP = 58;
const SPOUT = [0, -13, 40]; // coin leaves here, relative to the head

// trough and gate (same machine as the dashboard's: tokens pass one gate, one punch, one ledger)
const GATE_X = 120;
const TROUGH = { from: -222, to: GATE_X + 79 };
const FLAP_X = GATE_X + 31;
const DUP = { x: GATE_X + 31, y: 26, w: 36, d: 30 };
const BIN = { x: GATE_X + 75, y: -34, w: 62, d: 68, r: 0 };
const COUNTER = { x: GATE_X + 143, y: -34, w: 44, d: 36, r: 0 };
const DIAL = [GATE_X + 165, -16], DIAL_R = 14, DIAL_Z = 30, DIAL_TOP = DIAL_Z + 6;
const PUNCH_UP = 24, PUNCH_DOWN = Z0 + COIN_H + 0.6;
const POST_Y = [-30, 22];

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [HX0, -39, 80], [GATE_X, 0, 86], [DIAL[0], DIAL[1], DIAL_TOP + 4]],
  W, H, { pad: 8, azimuth: 68, elevation: 34 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const box = (plan, z, h, tone = "mid", opts = {}) => S(k.slabOf(plan, z, h, P, 4, opts.bevel ?? 0.5), { tone, ...opts.style });
const dots = (pts, z, size = 0.45) => D(pts.map(([x, y]) => at([x, y, z])), { size });
const label = (x, y, z, text, size = 7.2) => k.faceTextSvg(k.topMatrix([x, y], z, P, "x"), text, { size, tone: "mid", anchor: "start" });
const plateAt = (x, y, w, text) => {
  const plan = { x, y, w, d: 16, r: 2 };
  return [
    S(k.slabOf(plan, 0, 0.8, P, 3), { tone: "lo", crease: "none" }),
    L(k.planOutline(k.insetPlan(plan, 1.6), 0.8, P, 3), { tone: "faint" }),
    label(x + 6, y + 11.4, 0.8, text, 7.4),
    dots([[x + 2.6, y + 2.6], [x + w - 2.6, y + 2.6], [x + 2.6, y + 13.4], [x + w - 2.6, y + 13.4]], 0.8, 0.4),
  ].join("");
};

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

function plates() {
  return [
    plateAt(RX0 + 40, -84, 74, "Checkpoint"),
    plateAt(RX1 - 82, -84, 82, "48h replay"),
    plateAt(RX0, 60, 62, "Scan"),
    plateAt(GATE_X - 50, 60, 98, "creditDeposit()"),
    plateAt(GATE_X + 66, 60, 112, "Ledger (SQLite)"),
  ].join("");
}

function historyRail() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(BED, 0, 14, P)}" style="filter:blur(6px)"/>`);
  out.push(box({ x: RX0 - 8, y: -53, w: 8, d: 28, r: 1.5 }, 0, 14, "mid", { bevel: 0.6 }));
  out.push(box({ x: RX1, y: -53, w: 8, d: 28, r: 1.5 }, 0, 14, "mid", { bevel: 0.6 }));
  out.push(dots([[RX0 - 4, -50], [RX0 - 4, -28], [RX1 + 4, -50], [RX1 + 4, -28]], 14, 0.45));
  out.push(box(BED, 0, Z0, "mid", { bevel: 0.5 }));
  const t = k.topTicks(RX0 + 4, RX1 - 4, 4, 5, -31.4, Z0, [1.8, 3.2], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(L(k.lineOnTop([RX0, -39], [RX1, -39], Z0, P), { tone: "faint", dashed: true }));
  for (let x = RX0 + 24; x < RX1 - 8; x += 45) out.push(dots([[x, -46.4]], Z0, 0.45));
  out.push(box({ x: RX0, y: -52.4, w: LEN, d: 2.4, r: 0.6 }, 0, 10, "mid", { bevel: 0.3 }));
  out.push(box({ x: RX0, y: -28.2, w: LEN, d: 2.4, r: 0.6 }, 0, 10, "mid", { bevel: 0.3 }));
  return out.join("");
}

// The 48-hour replay window is a sliver of the whole history; it is drawn at its true share, widened to be visible.
function windowClamp() {
  const out = [];
  const w = 9;
  out.push(box({ x: RX1 - w, y: -49, w, d: 20, r: 0.6 }, Z0, 2, "hi", { bevel: 0.3 }));
  out.push(box({ x: RX1 - w, y: -50.4, w: 1.8, d: 23, r: 0.5 }, Z0, 9, "mid", { bevel: 0.3 }));
  out.push(box({ x: RX1 - 1.8, y: -50.4, w: 1.8, d: 23, r: 0.5 }, Z0, 9, "mid", { bevel: 0.3 }));

  return out.join("");
}

function checkpoint() {
  const out = [];
  const blk = { x: HX0 - 6.5, y: -47.6, w: 13, d: 17.2, r: 2 };
  out.push(box(blk, Z0, 8, "hi", { bevel: 0.6, style: { crease: "lo" } }));
  out.push(box(k.insetPlan(blk, 2), Z0 + 8, 2, "mid", { bevel: 0.4 }));
  out.push(S(k.cylinder(HX0, -39, 1.4, Z0 + 10, 14, P, 14), { tone: "mid", crease: "none" }));
  out.push(box({ x: HX0 - 0.8, y: -48, w: 1.6, d: 18, r: 0.2 }, Z0 + 18, 6, "mid", { bevel: 0.2 }));
  out.push(S(k.cylinder(HX0, -39, 3.2, Z0 + 24, 2.4, P, 24, 0.3), { tone: "hi" }));
  out.push(L(k.ring(HX0, -39, 2, Z0 + 26.4, P, 16), { tone: "lo" }));
  out.push(dots([[HX0 - 4, -45.6], [HX0 + 4, -45.6], [HX0 - 4, -32.4], [HX0 + 4, -32.4]], Z0 + 10, 0.4));
  return out.join("");
}

function headBack() {
  const out = [];
  out.push(box({ x: HX0 - 9, y: -62, w: 18, d: 12, r: 2 }, 0, 6, "lo", { bevel: 0.5 }));
  out.push(box({ x: HX0 - 6, y: -60, w: 12, d: 6, r: 1.2 }, 6, HEAD_TOP - 6, "mid", { bevel: 0.6 }));
  out.push(L(k.rise([HX0 - 1, -54], 10, HEAD_TOP - 4, P), { tone: "faint" }));
  out.push(dots([[HX0 - 4.5, -60.2], [HX0 + 4.5, -60.2]], 4, 0.4));
  return out.join("");
}
function headFrontLower() {
  const out = [];
  out.push(box({ x: HX0 - 9, y: -26, w: 18, d: 12, r: 2 }, 0, 6, "lo", { bevel: 0.5 }));
  out.push(box({ x: HX0 - 6, y: -24, w: 12, d: 6, r: 1.2 }, 6, HEAD_TOP - 6, "mid", { bevel: 0.6 }));
  out.push(L(k.rise([HX0 - 1, -18], 10, HEAD_TOP - 4, P), { tone: "faint" }));
  out.push(dots([[HX0 - 4.5, -14.4], [HX0 + 4.5, -14.4]], 4, 0.4));
  return out.join("");
}
function headTop() {
  const out = [];
  out.push(box({ x: HX0 - 8, y: -60, w: 16, d: 42, r: 2 }, HEAD_TOP, 10, "hi", { bevel: 0.8, style: { crease: "lo" } }));
  out.push(L(k.lineOnTop([HX0 - 5, -57], [HX0 - 5, -21], HEAD_TOP + 10, P), { tone: "faint" }));
  out.push(L(k.lineOnTop([HX0 + 5, -57], [HX0 + 5, -21], HEAD_TOP + 10, P), { tone: "faint" }));
  out.push(dots([[HX0 - 6, -58], [HX0 + 6, -58], [HX0 - 6, -20], [HX0 + 6, -20]], HEAD_TOP + 10, 0.5));
  // lens barrel hanging over the rail, the part to watch
  out.push(S(k.cylinder(HX0, -39, 6.4, 30, 3, P, 28, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(HX0, -39, 4.6, 33, HEAD_TOP - 33, P, 24), { tone: "lit", lit: true, crease: "none" }));
  out.push(L(k.ring(HX0, -39, 3.2, 30, P, 20), { tone: "lo" }));
  out.push(L(k.ring(HX0, -39, 5.4, 50, P, 20), { tone: "faint" }));
  // pagination ticket slot on top
  const slot = { x: HX0 - 5, y: -43, w: 10, d: 8, r: 1 };
  out.push(S(k.slabOf(slot, HEAD_TOP + 10, 0.6, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.lineOnTop([HX0 - 3, -39], [HX0 + 3, -39], HEAD_TOP + 10.6, P), { tone: "mid" }));
  // outlet chute on the front side, over the trough
  out.push(box({ x: HX0 - 3.5, y: -19, w: 7, d: 8.4, r: 1 }, 36, 14, "mid", { bevel: 0.4 }));
  out.push(L(k.lineOnTop([HX0, -18], [HX0, -11.4], 50, P), { tone: "faint" }));
  out.push(box({ x: HX0 - 2.6, y: -13.6, w: 5.2, d: 4, r: 0.6 }, 34, 4, "lo", { bevel: 0.3 }));
  return out.join("");
}

function trough() {
  const out = [];
  const bed = { x: TROUGH.from, y: -12, w: TROUGH.to - TROUGH.from, d: 24, r: 1 };
  out.push(S(k.slabOf(bed, 0, Z0, P, 3, 0.5), { tone: "mid" }));
  for (let x = TROUGH.from + 14; x < TROUGH.to - 8; x += 24) out.push(L(k.lineOnTop([x, -12], [x, 12], Z0, P), { tone: "faint" }));
  out.push(L(k.lineOnTop([TROUGH.from, 0], [TROUGH.to, 0], Z0, P), { tone: "faint", dashed: true }));
  return out.join("");
}
const guide = (x0, x1, y) => box({ x: x0, y, w: x1 - x0, d: 2.4, r: 0.6 }, Z0, 4, "mid", { bevel: 0.3 });

function gateBack() {
  return box({ x: GATE_X - 5, y: POST_Y[0], w: 10, d: 8, r: 1.5 }, 0, 60, "mid", { bevel: 0.6 }) +
    box({ x: GATE_X - 7, y: POST_Y[0] - 2, w: 14, d: 12, r: 2 }, 0, 4, "lo", { bevel: 0.4 });
}
function gateFront() {
  const out = [];
  out.push(box({ x: GATE_X - 5, y: POST_Y[1], w: 10, d: 8, r: 1.5 }, 0, 60, "mid", { bevel: 0.6 }));
  out.push(box({ x: GATE_X - 7, y: POST_Y[1] - 2, w: 14, d: 12, r: 2 }, 0, 4, "lo", { bevel: 0.4 }));
  out.push(dots([[GATE_X - 4, POST_Y[1] + 9.5], [GATE_X + 4, POST_Y[1] + 9.5]], 4, 0.4));
  return out.join("");
}
function gateBeam() {
  const out = [];
  out.push(box({ x: GATE_X - 6, y: -34, w: 12, d: 68, r: 2 }, 54, 10, "mid", { bevel: 0.7 }));
  out.push(L(k.lineOnTop([GATE_X, -30], [GATE_X, 30], 64, P), { tone: "faint" }));
  out.push(dots([[GATE_X, -29], [GATE_X, 29]], 64, 0.5));
  const sol = { x: GATE_X - 9, y: -12, w: 18, d: 24, r: 3 };
  out.push(box(sol, 64, 18, "hi", { bevel: 0.8, style: { crease: "lo" } }));
  for (let i = 0; i < 4; i++) out.push(L(k.lineOnTop([sol.x + 2, sol.y + 5 + i * 4.6], [sol.x + sol.w - 2, sol.y + 5 + i * 4.6], 82, P), { tone: "faint" }));
  out.push(S(k.cylinder(GATE_X, 0, 3.4, 82, 3, P, 20), { tone: "mid" }));
  out.push(D([at([GATE_X, 8.5, 82]), at([GATE_X, -8.5, 82])], { size: 0.5, tone: "hi" }));
  return out.join("");
}
function punch() {
  const out = [];
  out.push(S(k.cylinder(GATE_X, 0, 2, PUNCH_UP + 3, 54 - PUNCH_UP - 3, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(GATE_X, 0, 6.8, PUNCH_UP, 3, P, 28, 0.5), { tone: "mid", crease: "none" }));
  out.push(L(k.ring(GATE_X, 0, 4.2, PUNCH_UP + 3, P, 20), { tone: "lo" }));
  return out.join("");
}
function trayOf(t) {
  const back = [], front = [];
  back.push(box({ x: t.x, y: t.y, w: t.w, d: t.d, r: 2 }, 0, 2.4, "lo", { bevel: 0.4 }));
  back.push(box({ x: t.x, y: t.y, w: 2.6, d: t.d, r: 0.8 }, 2.4, 8, "mid", { bevel: 0.3 }));
  back.push(box({ x: t.x + t.w - 2.6, y: t.y, w: 2.6, d: t.d, r: 0.8 }, 2.4, 8, "mid", { bevel: 0.3 }));
  front.push(box({ x: t.x, y: t.y + t.d - 2.6, w: t.w, d: 2.6, r: 0.8 }, 2.4, 8, "mid", { bevel: 0.3 }));
  front.push(dots([[t.x + 5, t.y + t.d - 1.3], [t.x + t.w - 5, t.y + t.d - 1.3]], 8, 0.4));
  return { back: back.join(""), front: front.join("") };
}
function bin() {
  const back = [], front = [];
  back.push(`<path class="iso-halo" d="${k.haloOf(BIN, 0, 20, P)}" style="filter:blur(6px)"/>`);
  back.push(box(BIN, 0, 3, "lo", { bevel: 0.4 }));
  back.push(box({ x: BIN.x, y: BIN.y, w: BIN.w, d: 4, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  back.push(box({ x: BIN.x + BIN.w - 4, y: BIN.y, w: 4, d: BIN.d, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  back.push(box({ x: BIN.x, y: BIN.y, w: 4, d: 22, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  front.push(box({ x: BIN.x, y: 12, w: 4, d: BIN.y + BIN.d - 12, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  front.push(box({ x: BIN.x, y: BIN.y + BIN.d - 4, w: BIN.w, d: 4, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  front.push(L(k.planOutline(k.insetPlan({ x: BIN.x + 4, y: BIN.y + BIN.d - 4, w: BIN.w - 8, d: 4, r: 0.5 }, 0.8), 33, P, 3), { tone: "faint" }));
  front.push(dots([[BIN.x + 8, BIN.y + BIN.d - 2], [BIN.x + BIN.w - 8, BIN.y + BIN.d - 2]], 33, 0.4));
  return { back: back.join(""), front: front.join("") };
}
function counter() {
  const out = [];
  out.push(box(COUNTER, 0, DIAL_Z, "mid", { bevel: 0.8 }));
  out.push(box(k.insetPlan(COUNTER, 2), DIAL_Z, 6, "hi", { bevel: 0.6, style: { crease: "lo" } }));
  const [x, y] = DIAL;
  out.push(S(k.cylinder(x, y, DIAL_R - 2, DIAL_TOP, 0.8, P, 48), { tone: "mid", crease: "none" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP + 0.8, P, 48), { tone: "lo" }));
  const t = k.radialTicks(x, y, DIAL_R - 3.4, 50, 5, DIAL_TOP + 0.8, [1.2, 2.6], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(dots([[COUNTER.x + 4, COUNTER.y + 4], [COUNTER.x + COUNTER.w - 4, COUNTER.y + 4], [COUNTER.x + 4, COUNTER.y + COUNTER.d - 4], [COUNTER.x + COUNTER.w - 4, COUNTER.y + COUNTER.d - 4]], DIAL_TOP, 0.45));
  return out.join("");
}
function flap(open) {
  const hinge = [FLAP_X, -11], len = 26, ang = open ? 0 : 1.05;
  const ring = [[0, 0], [len, 0], [len, 2.2], [0, 2.2]].map(([a, b]) => [hinge[0] + a * Math.cos(ang) - b * Math.sin(ang), hinge[1] + a * Math.sin(ang) + b * Math.cos(ang)]);
  return `<g class="flap" data-open="${open ? 1 : 0}">${S(k.extrude(ring, Z0, 9, P, { convex: true, bevel: 0.3 }), { tone: "hi", lit: !open })}${S(k.cylinder(hinge[0], hinge[1] + 1, 2.6, Z0, 10, P, 14), { tone: "mid" })}</g>`;
}
const coin = `<g class="coin">${S(k.cylinder(0, 0, COIN_R, 0, COIN_H, P, 28, 0.4), { tone: "lit", lit: true, crease: "none" })}${L(k.ring(0, 0, COIN_R - 1.8, COIN_H, P, 24), { tone: "faint" })}</g>`;
const dialNeedle = (turn) => {
  const a = turn * Math.PI * 2, [x, y] = DIAL;
  return k.lineOnTop([x - Math.sin(a) * 2.6, y + Math.cos(a) * 2.6], [x + Math.sin(a) * (DIAL_R - 4), y - Math.cos(a) * (DIAL_R - 4)], DIAL_TOP + 1, P);
};

const dup = trayOf(DUP);
const binParts = bin();

const svg = k.figureSvg({
  width: W, height: H,
  label: "A scan rig. A carriage on a long history rail marks the saved checkpoint slot. A read head sweeps the rail from the checkpoint towards the head slot and drops each matching USDC deposit into a trough. The trough carries the deposits to the creditDeposit gate: new ones fall into the ledger bin and are counted on a dial, repeats are swung into a skipped tray. The checkpoint carriage moves to the head slot only after the sweep is complete.",
  body: [
    base(), plates(),
    `<g class="head" id="head-back">${headBack()}</g>`,
    historyRail(), windowClamp(),
    `<g id="checkpoint">${checkpoint()}</g>`,
    `<g class="head" id="head-front">${headFrontLower()}</g>`,
    trough(), guide(TROUGH.from, TROUGH.to, -13.4),
    gateBack(), dup.back, binParts.back, counter(),
    `<path id="needle" class="iso-line" data-tone="lit" d="${dialNeedle(0)}" style="stroke-width:1.1"/>`,
    `<g class="head" id="head-top">${headTop()}</g>`,
    `<g id="coins"></g>`,
    `<g id="punch">${punch()}</g>`,
    gateBeam(), gateFront(),
    guide(TROUGH.from, GATE_X + 13, 11), guide(GATE_X + 57, TROUGH.to, 11),
    `<g id="flaps">${flap(true)}${flap(false)}</g>`,
    dup.front, binParts.front,
  ],
});

const meta = {
  P, W, H, Z0, COIN_R, COIN_H, GATE_X, FLAP_X, PUNCH_UP, PUNCH_DOWN,
  rail: { x0: RX0, x1: RX1, from: HX0, span: SWEEP }, trough: TROUGH,
  dup: DUP, bin: BIN, dial: DIAL, dialR: DIAL_R, dialTop: DIAL_TOP, spout: SPOUT, coin,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "rig.svg"), svg);
writeFileSync(join(OUT, "rig.json"), JSON.stringify(meta));
console.log("wrote public/rig.svg", (svg.length / 1024).toFixed(0) + " KB,", (svg.match(/class="iso-solid/g) || []).length, "solids");
