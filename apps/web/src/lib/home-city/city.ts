/**
 * «Живые блоки» — «Ночной город».
 *
 * Each recent block is a tower on one street. One storey = one transaction of that block, in block
 * order from the ground up: the lobby is the coinbase (the miner's own, it comes with the block), each
 * storey above is lit in that tx's kind colour. Tower width is the block's size in bytes (log), the
 * street gap before it is the real interval to the block before, a lamp stands in a gap of twice the
 * average. The roof flag is the pool's slice ink from the «Mining pools» donut (grey for a solo
 * miner); a Lithos block has a gold roof. One storey height serves the whole street, so towers compare
 * honestly; a tower taller than the card goes past the top edge with an «N tx» tag. An empty block is
 * a kiosk: the lobby and a flag. At the right end the crane stands over the lot of the forming block.
 * On a seal the crates that leave the yard land as storeys one by one, the roof closes, Kayolo hops
 * onto it and the street moves one lot left.
 */
import type { CityCue } from "./beats";
import { lookInk } from "@/lib/look";
import { R, alpha, clamp, easeInOut, easeOut, noise, builtAt, sealPlan, shade, type CityBlock, type Frame, type Inks, type Scene } from "./common";
import { BUSY_TX } from "@/lib/kayolo/thresholds";
import type { KayoloPose } from "./kayolo";

type Wall = { front: string; line: string; side: string; top: string; topHi: string };
const NIGHT: Wall = { front: "#5d4d3c", line: "#4c3f31", side: "#3f342a", top: "#8f7b60", topHi: "#a99271" };
const GOLD = "#ebcb71";
const GOLD_HI = "#fff2c4";
const GOLD_DEEP = "#c9a24e";

export type Tower = {
  b: CityBlock;
  /** Left edge of the front face. */
  x: number;
  fw: number;
  d: number;
  floors: number;
  fh: number;
  /** Gap on its left, ms (to the block before it). */
  gapMs: number;
  gapPx: number;
};

export type CityGeo = {
  w: number;
  h: number;
  small: boolean;
  ground: number;
  /** Highest a tower body goes; above it the tower is cut with its «N tx» tag. */
  ceil: number;
  siteX: number;
  siteW: number;
  mastX: number;
  jibY: number;
  towers: Tower[];
  fh: number;
};

export function frontW(size: number, small: boolean): number {
  const lg = clamp(Math.log2(Math.max(300, Number.isFinite(size) ? size : 0) / 300), 0, 6);
  return small ? 12 + 3 * Math.round(lg) : 18 + 5 * Math.round(lg);
}

export function gapPx(ms: number, small: boolean): number {
  const s = ms / 1000;
  return small ? clamp(Math.round(s / 12), 3, 22) : clamp(Math.round(s / 5), 4, 44);
}

export function floorsOf(b: CityBlock): number {
  return Math.max(1, b.txCount || (b.txs?.length ?? 1));
}

const MAX_BODY = 84;

/** One storey height for the whole street, so towers compare honestly: the tallest on screen sets it. */
export function floorH(peak: number, small: boolean): number {
  return clamp(Math.floor(MAX_BODY / Math.max(1, peak)), 3, small ? 6 : 7);
}

/** The lobby (the coinbase storey) is never thinner than 5 px, so a one-storey block still reads. */
export function lobbyH(fh: number): number {
  return Math.max(5, fh);
}

/** Height from the street to the top of storey k-1 (k storeys stand). */
export function storeysUp(k: number, fh: number): number {
  return k <= 0 ? 0 : lobbyH(fh) + (k - 1) * fh;
}

/** Street layout for a list of blocks (newest first). The newest stands just left of the site. */
export function cityGeo(w: number, h: number, blocks: readonly CityBlock[], extraPeak = 0): CityGeo {
  const small = w < 420;
  const ground = h - 12;
  const siteW = small ? 44 : 64;
  const mastX = w - (small ? 8 : 11);
  const siteX = mastX - siteW - (small ? 2 : 4);
  const jibY = 8;
  const towers: Tower[] = [];
  const d = small ? 5 : 8;
  const peak = Math.max(extraPeak, ...blocks.slice(0, 12).map(floorsOf));
  const fh = floorH(peak, small);
  let right = siteX - (small ? 8 : 12);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const prev = blocks[i + 1];
    const fw = frontW(b.size, small);
    const floors = floorsOf(b);
    const gapMs = prev && Number.isFinite(b.ts - prev.ts) ? Math.max(0, b.ts - prev.ts) : 0;
    const gp = gapPx(gapMs, small);
    const x = right - d - fw;
    towers.push({ b, x, fw, d, floors, fh, gapMs, gapPx: gp });
    right = x - gp;
    if (right < -60) break;
  }
  return { w, h, small, ground, ceil: 14, siteX, siteW, mastX, jibY, towers, fh };
}

/** Body height of a tower with `shown` storeys, as drawn (cut at the ceiling). */
export function bodyHeight(g: CityGeo, t: Tower, shown: number): { h: number; cut: boolean } {
  const full = storeysUp(Math.min(shown, t.floors), t.fh) + 1;
  const room = g.ground - g.ceil;
  return full > room ? { h: room, cut: true } : { h: full, cut: false };
}

/** Where the k-th storey (0 = the lobby) of a tower building on the site sits, centre point. */
export function cityFloorAt(g: CityGeo, b: CityBlock, k: number): { x: number; y: number } {
  const fw = frontW(b.size, g.small);
  const d = g.small ? 5 : 8;
  const x = Math.round(g.siteX + (g.siteW - fw - d) / 2);
  const y = g.ground - storeysUp(k, g.fh) - (k === 0 ? lobbyH(g.fh) : g.fh) / 2;
  return { x: x + fw / 2, y: Math.max(g.ceil + 2, y) };
}

function siteTower(g: CityGeo, b: CityBlock, prev: CityBlock | undefined): Tower {
  const fw = frontW(b.size, g.small);
  const d = g.small ? 5 : 8;
  const gapMs = prev && Number.isFinite(b.ts - prev.ts) ? Math.max(0, b.ts - prev.ts) : 0;
  return { b, x: Math.round(g.siteX + (g.siteW - fw - d) / 2), fw, d, floors: floorsOf(b), fh: g.fh, gapMs, gapPx: gapPx(gapMs, g.small) };
}

function txInk(b: CityBlock, k: number, inks: Inks): string {
  const t = b.txs?.[k];
  if (t?.color) return lookInk(t.color);
  return k === 0 ? lookInk("#34D399") : inks.muted2;
}

function shadeMix(c: string, white: number): string {
  return shade(c, 1 + clamp(white, 0, 1) * 0.75);
}

type TowerOpt = {
  built?: number;
  flash?: number;
  roof?: number;
  dim?: number;
  lithosMark?: CanvasImageSource | null;
  scaffold?: boolean;
  /** «N tx» on a tower cut by the ceiling. */
  tag?: (n: number) => string;
};

function drawTower(ctx: CanvasRenderingContext2D, g: CityGeo, t: Tower, inks: Inks, opt: TowerOpt) {
  const built = opt.built ?? t.floors;
  const shown = Math.min(built, t.floors);
  if (shown <= 0) return;
  const W = NIGHT;
  const ground = g.ground;
  const { h: bodyH, cut } = bodyHeight(g, t, shown);
  const x0 = Math.round(t.x);
  const top = ground - bodyH;
  const { fw, d } = t;
  ctx.save();
  if (opt.dim) ctx.globalAlpha = 1 - opt.dim;
  // Right side in shade, one pixel column at a time, each higher every second column.
  for (let c = 0; c < d; c++) {
    const lift = cut ? 0 : Math.floor((c + 1) / 2);
    R(ctx, x0 + fw + c, top - lift, 1, bodyH + lift, W.side);
  }
  R(ctx, x0, top, fw, bodyH, W.front);
  // Storeys: a darker course under each (on tall storeys), the windows lit in the tx's colour.
  const ww = t.fh >= 6 ? 3 : 2;
  const gx = fw >= 30 ? 2 : 1;
  const course = t.fh >= 5;
  const wh = course ? t.fh - 2 : Math.max(1, t.fh - 1);
  const cols = Math.max(1, Math.floor((fw - 2 + gx) / (ww + gx)));
  const pad = Math.floor((fw - cols * (ww + gx) + gx) / 2);
  for (let k = 0; k < shown; k++) {
    const yb = ground - storeysUp(k, t.fh);
    if (yb - t.fh < top) break;
    if (course) R(ctx, x0, yb - 1, fw, 1, W.line);
    const ink = txInk(t.b, k, inks);
    const fresh = opt.flash != null && k === shown - 1 ? opt.flash : 0;
    const lit = fresh > 0 ? shadeMix(ink, fresh) : ink;
    const whK = k === 0 ? Math.max(wh, lobbyH(t.fh) - 2) : wh;
    const wy = yb - (course ? 1 : 0) - whK;
    if (k === 0) {
      // Lobby: the coinbase. A door in the middle, windows either side.
      const dw = Math.max(2, Math.round(fw / 6));
      const dx = x0 + Math.round((fw - dw) / 2);
      for (let c = 0; c < cols; c++) {
        const wx = x0 + pad + c * (ww + gx);
        if (wx + ww > dx - 1 && wx < dx + dw + 1) continue;
        R(ctx, wx, wy, ww, whK, lit);
      }
      R(ctx, dx, yb - lobbyH(t.fh), dw, lobbyH(t.fh), lit);
    } else {
      for (let c = 0; c < cols; c++) R(ctx, x0 + pad + c * (ww + gx), wy, ww, wh, lit);
    }
    const sideInk = alpha(lit, 0.5);
    for (let c = 2; c < d - 1; c += 2) {
      const lift = Math.floor((c + 1) / 2);
      R(ctx, x0 + fw + c, wy - lift, 1, whK, sideInk);
    }
    // Wet street: the storey's light, mirrored and faint, under the tower (night only).
    const my = ground + 1 + k * 2;
    if (my < ground + 11) R(ctx, x0 + pad, my, fw - 2 * pad, 1, alpha(ink, 0.16 - k * 0.012));
  }
  if (cut) {
    // Past the top edge: a soft fade and the tag with the whole count.
    for (let i = 0; i < 4; i++) R(ctx, x0, top + i, fw + d, 1, alpha("#000000", 0.4 - i * 0.1));
    if (opt.tag) drawTag(ctx, x0 + (fw + d) / 2, top + 1, opt.tag(t.b.txCount || shown), inks, g.small);
  }
  // Roof: top face going back, a lit parapet line.
  const roofU = cut ? 0 : (opt.roof ?? (shown >= t.floors ? 1 : 0));
  const dy = Math.ceil(d / 2);
  const lithos = t.b.lithos;
  if (roofU > 0) {
    for (let r = 0; r < dy; r++) R(ctx, x0 + 1 + 2 * r, top - 1 - r, fw, 1, lithos ? GOLD_DEEP : W.top);
    R(ctx, x0, top, fw, 1, lithos ? GOLD_HI : W.topHi);
    for (let i = 1; i < fw; i += 4) {
      const n = noise(t.b.height, i);
      if (n > 0.6) R(ctx, x0 + i, top - 1 - Math.floor(n * dy), 1, 1, lithos ? GOLD_HI : W.topHi);
    }
    // Pool flag: pole, then the cloth in the pool's donut ink.
    const pole = Math.round(8 * easeOut(roofU));
    if (pole > 0) {
      const px = x0 + fw - 3;
      const cloth = t.b.flag ?? "#8a8a8a";
      R(ctx, px, top - 1 - dy - pole, 1, pole, "#c8c2b6");
      if (pole >= 6) {
        R(ctx, px - 5, top - 1 - dy - pole, 5, 3, cloth);
        R(ctx, px - 5, top - 1 - dy - pole, 5, 1, shadeMix(cloth, 0.25));
      }
    }
    if (lithos) {
      // A Lithos block: gold cornice and corners, the mark on the roof.
      R(ctx, x0, top, fw, 2, GOLD);
      R(ctx, x0, top, 2, Math.min(bodyH, 12), GOLD);
      R(ctx, x0 + fw - 2, top, 2, Math.min(bodyH, 12), GOLD_DEEP);
      if (opt.lithosMark && top - dy - 17 >= 0) ctx.drawImage(opt.lithosMark, x0 + fw - 22, top - dy - 17, 16, 16);
    }
  } else if (cut && lithos) {
    R(ctx, x0, top + 4, 2, Math.min(bodyH - 4, 12), GOLD);
    R(ctx, x0 + fw - 2, top + 4, 2, Math.min(bodyH - 4, 12), GOLD_DEEP);
  }
  if (opt.scaffold) {
    const sc = alpha(GOLD, 0.55);
    R(ctx, x0 - 2, top - 4, 1, bodyH + 4, sc);
    R(ctx, x0 + fw + d + 1, top - 4 - Math.floor(d / 2), 1, bodyH + 4 + Math.floor(d / 2), sc);
    for (let y = ground - 6; y > top - 4; y -= 8) R(ctx, x0 - 3, y, fw + d + 5, 1, sc);
  }
  ctx.restore();
}

function drawTag(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, inks: Inks, small: boolean) {
  ctx.font = `600 ${small ? 8 : 9}px ${inks.mono}`;
  const tw = Math.ceil(ctx.measureText(text).width) + 6;
  const x = Math.round(cx - tw / 2);
  R(ctx, x, y, tw, small ? 10 : 11, "rgba(14,14,14,0.88)");
  R(ctx, x, y, tw, 1, alpha(GOLD, 0.7));
  ctx.fillStyle = inks.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + tw / 2, y + (small ? 5.5 : 6));
}

function drawStreet(ctx: CanvasRenderingContext2D, g: CityGeo, inks: Inks) {
  const { w, h, ground } = g;
  for (let i = 0; i < 6; i++) R(ctx, 0, ground - 6 - i * 3, w, 3, `rgba(255,190,120,${0.012 * (6 - i)})`);
  R(ctx, 0, ground, w, 1, inks.washStrong);
  R(ctx, 0, ground + 1, w, 2, inks.wash);
  R(ctx, 0, ground + 3, w, h - ground - 3, "rgba(0,0,0,0.22)");
  for (let x = 2; x < w; x += 12) R(ctx, x, ground + 7, 5, 1, inks.washMid);
}

function drawLamp(ctx: CanvasRenderingContext2D, x: number, ground: number, inks: Inks) {
  R(ctx, x, ground - 13, 1, 13, "#7a746a");
  R(ctx, x - 1, ground - 14, 3, 1, "#ffd98a");
  for (let i = 0; i < 6; i++) R(ctx, x - i, ground - 1, 2 * i + 1, 1, `rgba(255,217,138,${0.05 + 0.02 * (6 - i)})`);
}

function drawCrane(ctx: CanvasRenderingContext2D, g: CityGeo, inks: Inks, hookX: number, hookY: number) {
  const steel = inks.kayolo;
  const dark = shade(steel, 0.55);
  const { mastX, jibY, ground, siteX } = g;
  R(ctx, mastX, jibY, 1, ground - jibY, steel);
  R(ctx, mastX + 3, jibY, 1, ground - jibY, dark);
  for (let y = jibY + 2; y < ground; y += 4) {
    R(ctx, mastX + 1, y, 1, 1, steel);
    R(ctx, mastX + 2, y + 2, 1, 1, dark);
  }
  const a = siteX - 6;
  R(ctx, a, jibY, mastX + 10 - a, 1, steel);
  R(ctx, a, jibY + 3, mastX - a, 1, dark);
  for (let x = a + 1; x < mastX; x += 4) R(ctx, x, jibY + 1 + ((x >> 2) & 1), 1, 1, steel);
  R(ctx, mastX + 5, jibY + 1, 5, 4, "#4a4a4a");
  R(ctx, mastX - 4, jibY + 4, 5, 5, dark);
  R(ctx, mastX - 3, jibY + 5, 3, 2, alpha("#bfe3ff", 0.6));
  const rope = "#c8c2b6";
  R(ctx, hookX - 2, jibY + 1, 5, 2, rope);
  R(ctx, hookX, jibY + 3, 1, Math.max(0, hookY - jibY - 3), alpha(rope, 0.7));
  R(ctx, hookX - 1, hookY, 3, 2, rope);
  R(ctx, hookX + 1, hookY + 2, 1, 2, rope);
}

function drawSite(ctx: CanvasRenderingContext2D, g: CityGeo, inks: Inks) {
  const { siteX, siteW, ground } = g;
  R(ctx, siteX - 2, ground - 2, siteW + 4, 2, "#55524c");
  R(ctx, siteX - 2, ground - 2, siteW + 4, 1, "#77736b");
  for (let x = siteX - 2; x <= siteX + siteW + 2; x += 6) R(ctx, x, ground - 7, 1, 5, inks.washStrong);
  for (let x = siteX - 2; x < siteX + siteW + 2; x += 4)
    R(ctx, x, ground - 6, 2, 1, x % 8 < 4 ? alpha(inks.kayolo, 0.7) : "rgba(20,20,20,0.6)");
}

/** A tower on screen: where it can be pointed at. */
export type CityHit = { id: string; x0: number; x1: number; top: number; bottom: number };

/**
 * What Kayolo does when no seal is playing: the component's choice (rest, a hover, sleep, a rare
 * height, an Э4 beat or background — lib/home-city/beats.ts). `at`: a tower to look at (its id), or
 * ahead when null; `gaze` wins over it; `hop`: 0…1 of a hop in place.
 */
export type KayoloCue = CityCue;

export type CityOut = { hits: CityHit[]; kayolo: KayoloPose | null; built: number | null };

/**
 * Draws the street at one moment. With a seal: the site builds, the roof closes, Kayolo hops to the
 * new roof and the street slides one lot left; `scene.blocks` is the street before the new block.
 */
export function drawCity(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: Scene,
  frame: Frame,
  inks: Inks,
  opt: { lithosMark?: CanvasImageSource | null; tag?: (n: number) => string; cue?: KayoloCue; kinds?: readonly string[] } = {}
): CityOut {
  const seal = frame.seal;
  const before = cityGeo(w, h, scene.blocks, seal ? floorsOf(seal.block) : 0);
  drawStreet(ctx, before, inks);

  let slide = 0;
  let after: CityGeo | null = null;
  let site: Tower | null = null;
  const plan = seal ? sealPlan(seal.ids.length) : null;
  if (seal && plan) {
    site = siteTower(before, seal.block, scene.blocks[0]);
    after = cityGeo(w, h, [seal.block, ...scene.blocks], floorsOf(seal.block));
    slide = easeInOut((seal.ms - plan.slideFrom) / (plan.slideTo - plan.slideFrom));
  }
  const tag = opt.tag;
  const hits: CityHit[] = [];

  // Towers, oldest first so the newer ones overlap the older sides.
  for (const t of [...before.towers].reverse()) {
    let x = t.x;
    if (after) {
      const to = after.towers.find((a) => a.b.id === t.b.id);
      x = to ? t.x + (to.x - t.x) * slide : t.x - (t.x + 200) * slide;
    }
    if (x + t.fw + t.d < -2) continue;
    const moved = { ...t, x };
    if (t.gapMs >= 2 * scene.avgBlockMs && t.gapPx >= 10) drawLamp(ctx, Math.round(x - t.gapPx / 2), before.ground, inks);
    drawTower(ctx, before, moved, inks, { dim: frame.hover && frame.hover !== t.b.id ? 0.55 : 0, lithosMark: opt.lithosMark, tag });
    const bh = bodyHeight(before, moved, t.floors);
    hits.push({ id: t.b.id, x0: x - 2, x1: x + t.fw + t.d + 2, top: before.ground - bh.h - 12, bottom: before.ground + 4 });
  }

  drawSite(ctx, before, inks);
  let hookX = before.siteX + before.siteW / 2;
  let hookY = before.jibY + 22;
  let kayolo: KayoloPose | null = null;
  let built: number | null = null;
  const newest = before.towers[0];
  const small = before.small;
  const roofOf = (t: Tower, n = t.floors) => {
    const bh = bodyHeight(before, t, n);
    return { x: t.x + Math.max(8, t.fw * 0.36), y: before.ground - bh.h - 1 - Math.ceil(t.d / 2) + 1, cut: bh.cut };
  };
  const street = { x: before.siteX - 6, y: before.ground };
  const sc = small ? 0.62 : 0.8;
  const room = (p: { x: number; y: number; cut: boolean }) => !p.cut && p.y - 26 * sc >= 2;
  if (site && seal && plan && after) {
    const kinds = opt.kinds ?? [];
    const got = builtAt(kinds, seal.block.txCount, seal.ms, seal.ids.length);
    built = got.built;
    const flash = got.lastAt >= 0 ? clamp(1 - (seal.ms - got.lastAt) / 220, 0, 1) : 0;
    const roof = clamp((seal.ms - plan.closed) / 260, 0, 1);
    const to = after.towers.find((a) => a.b.id === seal.block.id);
    const x = to ? site.x + (to.x - site.x) * slide : site.x;
    const t = { ...site, x };
    if (built > 0) drawTower(ctx, before, t, inks, { built, flash, roof, lithosMark: opt.lithosMark, scaffold: roof < 1, tag });
    const bh = bodyHeight(before, t, built);
    hits.push({ id: seal.block.id, x0: x - 2, x1: x + t.fw + t.d + 2, top: before.ground - bh.h - 12, bottom: before.ground + 4 });
    const next = Math.min(built, t.floors);
    hookX = site.x + site.fw / 2;
    hookY = clamp(before.ground - storeysUp(next, site.fh) - 14, before.jibY + 8, before.ground - 12);
    if (roof >= 1) hookY = before.jibY + 22;
    // Kayolo: on the old roof, watching the site; when the roof closes he hops over and rides the slide.
    const hopFrom = plan.closed + 80;
    const hopU = clamp((seal.ms - hopFrom) / 460, 0, 1);
    const fromR = newest ? roofOf(newest) : { ...street, cut: true };
    const from = room(fromR) ? fromR : street;
    const toR = roofOf(t);
    const onNew = room(toR) ? toR : street;
    // His hop keeps his rule: ≤ 9 px on a desktop, ≤ 6 px on a phone.
    const lim = small ? 6 : 9;
    const big = seal.block.txCount >= BUSY_TX;
    const empty = seal.block.txCount <= 1;
    const cheer = big ? "surprised" : empty ? "curious" : "pleased";
    if (hopU <= 0) {
      kayolo = { x: from.x, y: from.y, mood: "look", face: 1, gaze: { x: 1, y: -0.3 } };
    } else if (Math.abs(onNew.y - from.y) <= lim) {
      // Roofs close in height: one hop across, its arc within the rule.
      const hx = from.x + (onNew.x - from.x) * easeInOut(hopU);
      const arc = Math.sin(hopU * Math.PI) * lim;
      kayolo = { x: hx, y: from.y + (onNew.y - from.y) * hopU - arc, mood: cheer, face: 1, gaze: null };
    } else if (hopU < 0.4) {
      // Too high or too low for a hop: he fades out on the old roof and in on the new one (never two
      // bodies at once), then a hop in place.
      kayolo = { x: from.x, y: from.y, mood: cheer, face: 1, gaze: null, alpha: 1 - hopU / 0.4 };
    } else {
      const arc = hopU > 0.62 ? Math.sin(((hopU - 0.62) / 0.38) * Math.PI) * lim : 0;
      kayolo = { x: onNew.x, y: onNew.y - arc, mood: cheer, face: 1, gaze: null, alpha: clamp((hopU - 0.4) / 0.2, 0, 1) };
    }
  } else if (newest) {
    const r = roofOf(newest);
    const at = room(r) ? r : street;
    const cue: KayoloCue = opt.cue ?? { mood: "idle", at: null, hop: 0 };
    let gaze: { x: number; y: number } | null = { x: 0.9, y: -0.2 };
    if (cue.gaze !== undefined) gaze = cue.gaze;
    else if (cue.at) {
      const tw = before.towers.find((x) => x.b.id === cue.at);
      if (tw) gaze = { x: clamp((tw.x + tw.fw / 2 - at.x) / 40, -1.3, 1.3), y: 0.15 };
    }
    if (cue.mood === "sleepy") gaze = null;
    kayolo = { x: at.x, y: at.y - Math.sin(clamp(cue.hop, 0, 1) * Math.PI) * (small ? 6 : 9), mood: cue.mood, face: 1, gaze, ...(cue.px ? { px: cue.px } : {}) };
  }
  drawCrane(ctx, before, inks, hookX, hookY);
  return { hits, kayolo, built };
}

/** Landing point of the k-th crate that rides in from the yard (storey index in the block). */
export function cityTarget(w: number, h: number, scene: Scene, b: CityBlock, storey: number): { x: number; y: number } {
  return cityFloorAt(cityGeo(w, h, scene.blocks, floorsOf(b)), b, storey);
}

/** Rests at the site when there is no block to stand on yet (no data). */
export function citySiteRest(w: number, h: number): { x: number; y: number } {
  const small = w < 420;
  const mastX = w - (small ? 8 : 11);
  const siteW = small ? 44 : 64;
  return { x: mastX - siteW / 2 - (small ? 2 : 4), y: h - 12 };
}
