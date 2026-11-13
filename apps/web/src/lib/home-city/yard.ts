/**
 * «Мемпул» — «Склад», the building yard by the city's crane.
 *
 * The city builds its towers out of transactions; the mempool is the yard where the material waits.
 * Each waiting tx is a crate in its kind colour, its width by its bytes, a gold strap at or above the
 * «Turbo» fee level. Crates stand on pallets in fee order — the best payers nearest the crane (left),
 * the cheapest at the far end — and a pallet never mixes fee zones, so the ground marks «Турбо» and
 * «Норма» stay true at any load. A crate that has waited more than two average blocks is dusty.
 *
 * Load: with more txs the stacks grow (2 to 8 high) and the crates get smaller; when even the
 * tallest stacks of the smallest crates cannot hold the pool, the rest goes onto one wrapped pallet
 * with its exact count (it also holds the txs the page does not keep one by one). On a seal the crane
 * lifts exactly the block's crates, in block order, along its cable into the new tower; the rest
 * close up. A new tx is lowered onto its place.
 */
import { lookInk } from "@/lib/look";
import { R, clamp, easeIn, easeOut, hash01, sealPlan, shade, type Frame, type Inks, type Scene, type YardTx } from "./common";
import { drawPlusPallet, drawZoneMarks, feeZone, zoneSpans, type FeeZone, type ZoneSpan, type ZoneWords } from "./load";

type Sizes = readonly [number, number, number, number];
type Level = { sizes: Sizes; H: number };

// Crate widths by bytes, biggest first. The yard takes the biggest crates and the lowest stacks that
// still hold the whole pool inside the lot.
const DESK: readonly Sizes[] = [
  [14, 17, 20, 24],
  [11, 13, 16, 19],
  [9, 11, 13, 15],
  [7, 8, 10, 12],
  [6, 7, 8, 10],
  [5, 6, 7, 8],
];
const PHONE: readonly Sizes[] = [
  [10, 12, 14, 17],
  [8, 10, 12, 14],
  [7, 8, 10, 12],
  [6, 7, 8, 10],
  [5, 6, 7, 8],
  [4, 5, 6, 7],
];
export const H_MAX = 8;

export function sizeIdx(bytes: number): 0 | 1 | 2 | 3 {
  if (bytes < 300) return 0;
  if (bytes < 800) return 1;
  if (bytes < 2500) return 2;
  return 3;
}

export function crateH(w: number): number {
  return w >= 8 ? w - 2 : Math.max(3, w - 1);
}

/** Iso depth of a crate (its lit top and shaded side), as the city draws its towers. */
function depthOf(w: number): number {
  return Math.max(2, Math.round(w * 0.22));
}

const pitchOf = (sizes: Sizes) => sizes[3] + depthOf(sizes[3]) + 4;

export type Crate = { tx: YardTx; x: number; y: number; w: number; h: number; zone: FeeZone; pallet: number };
export type Pallet = { x: number; w: number; zone: FeeZone };
export type YardLayout = {
  crates: Crate[];
  pallets: Pallet[];
  plus: { x: number; w: number; h: number; n: number } | null;
  spans: ZoneSpan[];
  /** Index of the crate sizes × 16 + stack height. */
  level: number;
  ground: number;
  /** Rightmost pixel anything may use (the floodlight mast stands beyond it). */
  right: number;
  small: boolean;
};

type YGeo = { small: boolean; ground: number; left: number; right: number; stack: number };

function ygeo(w: number, h: number): YGeo {
  const small = w < 420;
  // The ground sits on the city's street line, so the yard reads as the next lot along the street;
  // a stack stays well under the floodlight's head.
  return { small, ground: h - 12, left: small ? 4 : 6, right: w - (small ? 12 : 16), stack: small ? 56 : 64 };
}

/** Fee order: the best payers first; equal rates by arrival, then id, so the order never flickers. */
export function feeOrder(a: YardTx, b: YardTx): number {
  return b.feeRate - a.feeRate || a.firstSeen - b.firstSeen || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// One layout per scene, size and seal: the flight path asks for rests every frame of a seal.
const memo = new WeakMap<Scene, Map<string, YardLayout>>();

export function yardLayout(w: number, h: number, scene: Scene, without?: ReadonlySet<string>): YardLayout {
  const key = `${w}x${h}:${without ? [...without].join(",") : ""}`;
  let m = memo.get(scene);
  if (!m) memo.set(scene, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const out = layoutYard(w, h, scene, without);
  if (m.size > 8) m.clear();
  m.set(key, out);
  return out;
}

function layoutYard(w: number, h: number, scene: Scene, without?: ReadonlySet<string>): YardLayout {
  const g = ygeo(w, h);
  const fees = scene.fees;
  const txs = scene.mem.txs.filter((t) => !without?.has(t.id)).sort(feeOrder);
  const zones = txs.map((t) => feeZone(t.feeRate, fees));
  const palletsAt = (H: number) => {
    let n = 0;
    let run = 0;
    let z: FeeZone | -1 = -1;
    for (const zz of zones) {
      if (zz !== z || run >= H) {
        n++;
        run = 0;
        z = zz;
      }
      run++;
    }
    return n;
  };
  const avail = g.right - g.left;
  // Tallest stack a level could build: its H biggest crates on one pallet.
  const heights = (sizes: Sizes) => txs.map((t) => crateH(sizes[sizeIdx(t.size)])).sort((a, b) => b - a);
  const tallest = (hs: number[], H: number) => hs.slice(0, H).reduce((a, b) => a + b, 0) + 2;
  const sets = g.small ? PHONE : DESK;
  let L: Level | null = null;
  let li = sets.length - 1;
  for (let i = 0; L == null && i < sets.length; i++) {
    const hs = heights(sets[i]!);
    for (let H = 2; H <= H_MAX; H++) {
      if (tallest(hs, H) > g.stack) break;
      if (palletsAt(H) * pitchOf(sets[i]!) <= avail) {
        L = { sizes: sets[i]!, H };
        li = i;
        break;
      }
    }
  }
  if (L == null) {
    // Even the smallest crates in the tallest stacks cannot hold the pool: the rest goes on the wrap.
    const sizes = sets[sets.length - 1]!;
    const hs = heights(sizes);
    let H = 2;
    while (H < H_MAX && tallest(hs, H + 1) <= g.stack) H++;
    L = { sizes, H };
  }
  const pitch = pitchOf(L.sizes);
  const pw = L.sizes[3] + depthOf(L.sizes[3]) + 2;
  // Txs the page does not hold one by one (the stream keeps the newest 80): they are on the wrap.
  const extra = Math.max(0, scene.mem.count - scene.mem.txs.length);
  const need = palletsAt(L.H);
  let fit = Math.floor(avail / pitch);
  let plusW = 0;
  if (need > fit || extra > 0) {
    const chars = String(txs.length + extra).length + 1;
    plusW = Math.max(g.small ? 24 : 30, chars * (g.small ? 6 : 7) + 8);
    fit = Math.max(0, Math.floor((avail - plusW - 2) / pitch));
  }
  const groups: { zone: FeeZone; txs: YardTx[] }[] = [];
  let shown = 0;
  for (let i = 0; i < txs.length; i++) {
    const z = zones[i]!;
    const cur = groups[groups.length - 1];
    if (!cur || cur.zone !== z || cur.txs.length >= L.H) {
      if (groups.length >= fit) break;
      groups.push({ zone: z, txs: [] });
    }
    groups[groups.length - 1]!.txs.push(txs[i]!);
    shown++;
  }
  const crates: Crate[] = [];
  const pallets: Pallet[] = [];
  groups.forEach((p, i) => {
    const px = g.left + i * pitch;
    pallets.push({ x: px, w: pw, zone: p.zone });
    // Bigger crates at the bottom of a stack; the stack as a whole keeps its place in fee order.
    const stack = [...p.txs].sort((a, b) => b.size - a.size || feeOrder(a, b));
    let y = g.ground - 2;
    for (const tx of stack) {
      const cw = L!.sizes[sizeIdx(tx.size)];
      const ch = crateH(cw);
      y -= ch;
      crates.push({ tx, x: px + 1 + Math.floor((L!.sizes[3] - cw) / 2), y, w: cw, h: ch, zone: p.zone, pallet: i });
    }
  });
  const n = txs.length - shown + extra;
  const plus = n > 0 ? { x: g.left + groups.length * pitch + 2, w: plusW || (g.small ? 24 : 30), h: Math.min(L.H, 6) * crateH(L.sizes[2]), n } : null;
  const spans = fees ? zoneSpans(pallets, (p) => p.zone, (p) => p.x, (p) => p.x + p.w) : [];
  return { crates, pallets, plus, spans, level: li * 16 + L.H, ground: g.ground, right: g.right, small: g.small };
}

/** Where a tx rests in the yard (a crate's centre, or the wrapped pallet if it is not drawn alone). */
export function yardRest(w: number, h: number, scene: Scene, id: string): { x: number; y: number } | null {
  const lay = yardLayout(w, h, scene);
  const c = lay.crates.find((x) => x.tx.id === id);
  if (c) return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  if (lay.plus && scene.mem.txs.some((t) => t.id === id)) return { x: lay.plus.x + lay.plus.w / 2, y: lay.ground - 2 - lay.plus.h / 2 };
  return null;
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tx: YardTx, scene: Scene, flash: number, inks: Inks) {
  let ink = lookInk(tx.color);
  const dusty = tx.firstSeen > 0 && scene.now - tx.firstSeen > 2 * scene.avgBlockMs;
  if (dusty) ink = shade(ink, inks.day ? 0.82 : 0.72);
  const c = flash > 0 ? shade(ink, 1 + flash * 0.7) : ink;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const d = depthOf(w);
  for (let i = 0; i < d; i++) R(ctx, x0 + w + i, y0 - Math.floor((i + 1) / 2), 1, h, shade(c, 0.56));
  for (let r = 0; r < Math.ceil(d / 2); r++) R(ctx, x0 + 1 + 2 * r, y0 - 1 - r, w, 1, shade(c, 1.22));
  R(ctx, x0, y0, w, h, c);
  R(ctx, x0, y0, w, 1, shade(c, 1.32));
  R(ctx, x0 + w - 1, y0 + 1, 1, h - 1, shade(c, 0.6));
  R(ctx, x0, y0 + h - 1, w - 1, 1, shade(c, 0.7));
  if (w >= 9) {
    R(ctx, x0 + Math.floor(w / 3), y0 + 1, 1, h - 2, shade(c, 0.84));
    R(ctx, x0 + Math.floor((2 * w) / 3), y0 + 1, 1, h - 2, shade(c, 0.84));
  } else if (w >= 6) R(ctx, x0 + Math.floor(w / 2), y0 + 1, 1, h - 2, shade(c, 0.84));
  // Gold strap: at or above «Turbo».
  if (scene.fees && tx.feeRate >= scene.fees.turbo) {
    const sy = y0 + Math.floor(h / 2);
    R(ctx, x0, sy, w - 1, 1, inks.day ? "#a77f1f" : "#ebcb71");
    R(ctx, x0 + 1, sy, 1, 1, "#fff2c4");
  }
  if (dusty) {
    R(ctx, x0 + 1 + Math.floor(hash01(tx.id, 3) * (w - 3)), y0, 1, 1, "rgba(220,214,200,0.6)");
    if (w >= 7) R(ctx, x0 + 1 + Math.floor(hash01(tx.id, 4) * (w - 3)), y0, 1, 1, "rgba(220,214,200,0.45)");
  }
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, g: YGeo, inks: Inks) {
  const earth = inks.day ? "#d9ccb4" : "#2a241e";
  R(ctx, 0, g.ground, w, h - g.ground, earth);
  R(ctx, 0, g.ground, w, 1, inks.day ? "#bfae8f" : "#4a3f33");
  for (let x = 0; x < w; x += 3) {
    const n = hash01(`g${x}`, 1);
    if (n > 0.6) R(ctx, x, g.ground + 2 + Math.floor(n * (h - g.ground - 3)), 1, 1, inks.day ? "#c3b495" : "#3d342a");
  }
  // A low site fence along the back of the lot: posts and two wires, dim, so the stacks read first.
  const fy = g.ground - (g.small ? 22 : 30);
  const fence = inks.day ? "#c9c2b5" : "#34302b";
  for (let x = 2; x < w - 4; x += g.small ? 18 : 24) R(ctx, x, fy, 1, g.ground - fy, fence);
  R(ctx, 0, fy + 2, w, 1, inks.day ? "#d2ccc0" : "#2f2b27");
  R(ctx, 0, fy + Math.round((g.ground - fy) / 2), w, 1, inks.day ? "#d6d0c4" : "#2b2824");
  // Floodlight mast at the far end of the lot.
  const mx = w - (g.small ? 6 : 8);
  const top = g.small ? 14 : 16;
  if (!inks.day) {
    R(ctx, mx - 6, top - 3, 13, 9, "rgba(255,206,130,0.06)");
    R(ctx, mx - 4, top - 2, 9, 7, "rgba(255,206,130,0.08)");
  }
  const steel = inks.day ? "#9a948a" : "#5b564e";
  R(ctx, mx, top + 2, 1, g.ground - top - 2, steel);
  R(ctx, mx - 3, top, 5, 2, inks.day ? "#8a8478" : "#6b665d");
  R(ctx, mx - 3, top + 2, 5, 1, inks.day ? "#c9a24e" : "#ffd37a");
  R(ctx, mx - 1, g.ground - 3, 3, 3, steel);
}

/** A crate (its tx id) or the wrap (`id` null, `n` = the txs it holds). */
export type YardHit = { id: string | null; x: number; y: number; w: number; h: number; n?: number };

export type YardText = ZoneWords & { more: (n: number) => string };

export function drawYard(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, frame: Frame, inks: Inks, text: YardText): YardHit[] {
  const g = ygeo(w, h);
  const seal = frame.seal;
  const plan = seal ? sealPlan(seal.ids.length) : null;
  const leaving = new Map<string, number>();
  if (seal) seal.ids.forEach((id, k) => leaving.set(id, k));
  const lay = yardLayout(w, h, scene);
  let after: YardLayout | null = null;
  let move = 0;
  if (seal && plan && seal.ids.length > 0) {
    after = yardLayout(w, h, scene, new Set(seal.ids));
    move = easeOut(clamp((seal.ms - plan.built) / 600, 0, 1));
  }
  const now = after && move > 0.5 ? after : lay;
  drawGround(ctx, w, h, g, inks);
  drawZoneMarks(ctx, now.spans, g.ground + 1, inks, text, g.small);
  for (const p of now.pallets) {
    R(ctx, p.x, g.ground - 2, p.w, 2, inks.day ? "#a8865a" : "#7a5f3f");
    for (let i = p.x + 2; i < p.x + p.w - 1; i += 3) R(ctx, i, g.ground - 1, 1, 1, inks.day ? "#7a5f3f" : "#3a2c1d");
  }
  const hits: YardHit[] = [];
  const afterById = after ? new Map(after.crates.map((c) => [c.tx.id, c])) : null;
  const drawn = new Set<string>();
  for (const c of lay.crates) {
    const k = leaving.get(c.tx.id);
    let { x, y, w: cw, h: ch } = c;
    let flash = 0;
    let a = 1;
    if (seal && plan && k != null) {
      if (seal.ms >= plan.depart(k)) continue;
      // Picked: lit, and the hook takes the slack (a 2 px lift) before the crane pulls.
      flash = clamp(seal.ms / 140, 0, 1) * 0.8;
      y -= Math.round(clamp((seal.ms - 60) / 200, 0, 1) * 2);
    } else if (afterById && move > 0) {
      const to = afterById.get(c.tx.id);
      if (to) {
        x += (to.x - x) * move;
        y += (to.y - y) * move;
        cw = Math.round(cw + (to.w - cw) * move);
        ch = Math.round(ch + (to.h - ch) * move);
      } else a = 1 - move;
    } else if (seal && plan && seal.ids.length > 0) {
      a = 1 - 0.45 * clamp(seal.ms / 140, 0, 1) * clamp((plan.closed + 250 - seal.ms) / 250, 0, 1);
    }
    const addMs = frame.add?.get(c.tx.id);
    if (addMs != null) {
      const u = clamp(addMs / 420, 0, 1);
      y -= Math.round((1 - easeIn(u)) * 24);
      a *= clamp(addMs / 120, 0, 1);
    }
    if (frame.hover && frame.hover !== c.tx.id) a *= 0.5;
    ctx.save();
    ctx.globalAlpha = a;
    drawCrate(ctx, x, y, cw, ch, c.tx, scene, flash, inks);
    ctx.restore();
    drawn.add(c.tx.id);
    hits.push({ id: c.tx.id, x, y: y - 2, w: cw + 3, h: ch + 2 });
  }
  // Crates that come out of the wrap as the yard frees up.
  if (after && move > 0) {
    for (const c of after.crates) {
      if (drawn.has(c.tx.id) || leaving.has(c.tx.id)) continue;
      ctx.save();
      ctx.globalAlpha = move;
      drawCrate(ctx, c.x, c.y, c.w, c.h, c.tx, scene, 0, inks);
      ctx.restore();
    }
  }
  const plus = now.plus;
  if (plus) {
    drawPlusPallet(ctx, plus.x, g.ground, plus.w, plus.h, text.more(plus.n), inks, g.small);
    hits.push({ id: null, x: plus.x, y: g.ground - 2 - plus.h, w: plus.w, h: plus.h + 2, n: plus.n });
  }
  return hits;
}

/** A crate on the crane's hook, on its way to its storey. */
export function drawCrateFlight(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, ropeTop: number, small: boolean, day: boolean) {
  const s = small ? 6 : 8;
  const ink = lookInk(color);
  const x0 = Math.round(x - s / 2);
  const y0 = Math.round(y - s / 2);
  const rope = day ? "rgba(110,104,94,0.8)" : "rgba(200,194,182,0.75)";
  if (ropeTop < y0 - 1) R(ctx, Math.round(x), Math.round(ropeTop), 1, y0 - Math.round(ropeTop), rope);
  R(ctx, Math.round(x) - 1, y0 - 2, 3, 2, day ? "#8a8478" : "#c8c2b6");
  R(ctx, x0, y0, s, s - 1, ink);
  R(ctx, x0, y0, s, 1, shade(ink, 1.32));
  R(ctx, x0 + s - 1, y0 + 1, 1, s - 2, shade(ink, 0.6));
  R(ctx, x0 + Math.floor(s / 2), y0 + 1, 1, s - 3, shade(ink, 0.84));
}

type Box = { left: number; top: number; bottom: number };
type Pt = { x: number; y: number };
type Line = { x0: number; y0: number; x1: number; y1: number };

/**
 * The cable from the yard to the crane, in the overlay's px. It lives only while crates ride it on a
 * seal. Side by side (desktop) it runs from the counter-jib straight over the yard to the floodlight
 * mast; stacked (phone) it runs over the yard, up the card's edge beside the crane's mast and onto
 * the jib.
 */
export type YardCable = { lines: Line[]; pulleys: Pt[]; route: (a: Pt, b: Pt) => { pts: Pt[]; ropes: (number | null)[] } };

export function yardCable(blocks: Box, blocksW: number, yard: Box, yardW: number, small: boolean): YardCable {
  const jib = blocks.top + 8;
  const counter = blocks.left + blocksW - (small ? 8 : 11) + 10;
  const post = yard.left + yardW - (small ? 6 : 8);
  const ride = 8;
  if (yard.top < blocks.bottom - 1) {
    return {
      lines: [
        { x0: counter, y0: jib, x1: post, y1: jib },
        { x0: post, y0: jib, x1: post, y1: yard.top + 16 },
      ],
      pulleys: [{ x: post, y: jib }],
      route: (a, b) => ({ pts: [a, { x: a.x, y: jib + ride }, { x: b.x, y: jib + ride }, b], ropes: [jib, jib, jib] }),
    };
  }
  // Stacked: the riser runs in the card's side padding, clear of the header's «All» link.
  const over = yard.top + 10;
  const riser = yard.left + yardW + 5;
  const side = riser + 5;
  return {
    lines: [
      { x0: yard.left + 2, y0: over, x1: riser, y1: over },
      { x0: riser, y0: jib, x1: riser, y1: over },
      { x0: Math.min(riser, counter), y0: jib, x1: Math.max(riser, counter), y1: jib },
    ],
    pulleys: [
      { x: riser, y: over },
      { x: riser, y: jib },
    ],
    route: (a, b) => ({
      pts: [a, { x: a.x, y: over + ride }, { x: side, y: over + ride }, { x: side, y: jib + ride }, { x: b.x, y: jib + ride }, b],
      ropes: [over, over, null, jib, jib],
    }),
  };
}

const RIDE = 7;

/** Where a crate is along its route at u in [0, 1] (even speed, eased ends), and its rope's top. */
export function cableAt(r: { pts: Pt[]; ropes: (number | null)[] }, u: number): { x: number; y: number; rope: number } {
  const lens = r.pts.slice(1).map((p, i) => Math.hypot(p.x - r.pts[i]!.x, p.y - r.pts[i]!.y));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  let s = clamp(e, 0, 1) * total;
  for (let i = 0; i < lens.length; i++) {
    const L = lens[i]!;
    if (s <= L || i === lens.length - 1) {
      const t = L > 0 ? clamp(s / L, 0, 1) : 1;
      const p = r.pts[i]!;
      const q = r.pts[i + 1]!;
      const x = p.x + (q.x - p.x) * t;
      const y = p.y + (q.y - p.y) * t;
      return { x, y, rope: r.ropes[i] ?? y - RIDE };
    }
    s -= L;
  }
  const last = r.pts[r.pts.length - 1]!;
  return { x: last.x, y: last.y, rope: last.y - RIDE };
}

export function drawYardCable(ctx: CanvasRenderingContext2D, cable: YardCable, a: number, day: boolean) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  for (const l of cable.lines) {
    const x = Math.round(Math.min(l.x0, l.x1));
    const y = Math.round(Math.min(l.y0, l.y1));
    R(ctx, x, y, Math.max(1, Math.round(Math.abs(l.x1 - l.x0))), Math.max(1, Math.round(Math.abs(l.y1 - l.y0))), day ? "rgba(110,104,94,0.7)" : "rgba(200,194,182,0.6)");
  }
  for (const p of cable.pulleys) {
    R(ctx, Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3, "#8a8478");
    R(ctx, Math.round(p.x), Math.round(p.y), 1, 1, "#2a2724");
  }
  ctx.restore();
}
