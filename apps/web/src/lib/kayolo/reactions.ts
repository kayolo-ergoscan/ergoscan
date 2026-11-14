/**
 * The reaction matrix (design/brand/kayolo-life.md §8.3, §8.4, §6.4–6.7): what a chain or page
 * event offers him, by page type. Pure: the layer plays it, the replay test counts it. Every
 * reaction is a scheduler offer with a ladder (loudest first) and the anchors its act looks at; the
 * budget walks the ladder down. Faces that last (the waits, the feed, the site behind) are the
 * layer's backgrounds, not offers.
 *
 * No reaction is about money: the price gets a neutral look (§1.2.9), amounts never change an act.
 */

import { step, type ActName } from "./acts";
import { pageKind } from "./anchors";
import type { KayoloEvent } from "./events";
import type { Offer, Prio } from "./scheduler";
import * as K from "./thresholds";

/** Where an act looks (§9.5 `data-kayolo` names; «el» is the event's own element). */
export type Aim =
  | "tip"
  | "confirmations"
  | "pending"
  | "balance"
  | "rent-beacon"
  | "pool-count"
  | "fee"
  | "oracle-price"
  | "price"
  | "title"
  | "row"
  | "tail"
  | "next"
  | "reward"
  | "block-link"
  | "indexer"
  | "search"
  | "el";

export type ReactCtx = {
  path: string;
  /** He waits at the door of a slow page: a block is only a glance (13.11 №9, §12.22). */
  door?: boolean;
  /** The site is behind: a block comes one tier lower (§8.4). */
  behind?: boolean;
  /** The last block was < 20 s ago: the second one is a nod (§8.4). */
  quick?: boolean;
};

export type Reaction = {
  offer: Offer;
  aim?: Aim;
  aim2?: Aim;
  /** count(k). */
  n?: number;
  /** The row to look at (E10: `data-kayolo-id`). */
  id?: string;
  /** The height this is about: a page:* of it takes E1–E4 of the same height (§2.8). */
  height?: number;
};

const ladder = (names: ActName[], n?: number) => names.map((a) => step(a, n));

/**
 * In A4 (§2.2): a block is a stir; what is on screen (P3) and the feed coming back wake him first
 * (`wakes`); anything else is not shown to a sleeper.
 */
const offer = (key: string, prio: Prio, ttlMs: number, names: ActName[], extra: Partial<Offer> & { n?: number } = {}): Offer => {
  const { n, ...rest } = extra;
  return { key, prio, ttlMs, ladder: ladder(names, n), ...rest };
};
const STIR = { stir: step("stir") };
const WAKES = { wakes: true };

/** Oracle pages (E15). */
export const oraclePage = (path: string) => /^\/oracles(\/|$)/.test(path.split("?")[0]);

/** The page's own block steps (§8.3, Э1b), one tier lower when the site is behind. */
function blockLadder(ev: Extract<KayoloEvent, { k: "chain:block" }>, ctx: ReactCtx): { names: ActName[]; prio: Prio; ttl: number; wakes: boolean } {
  const page = pageKind(ctx.path);
  if (ev.after) {
    // The first block after a long wait or a stall: a breath out and a happy hop (P4, T2, once).
    return { names: ["reliefHop", "relief", "glance"], prio: 4, ttl: K.TTL_E1, wakes: false };
  }
  if (ev.kind === "empty") return { names: ["shrug"], prio: 5, ttl: K.TTL_E2, wakes: false };
  if (ev.kind === "big") {
    return { names: page === "d" ? ["hopSurprised", "nod", "glance"] : ["bigBlock", "hopSurprised", "nod", "glance"], prio: 4, ttl: K.TTL_E3, wakes: true };
  }
  const names: ActName[] = page === "b" ? ["hopGlance", "nodGlance", "glance"] : page === "n" ? ["nodGlance", "glance"] : ["glance"];
  return { names, prio: 5, ttl: K.TTL_E1, wakes: false };
}

const lower = (names: ActName[]) => (names.length > 1 ? names.slice(1) : names);

export function react(ev: KayoloEvent, ctx: ReactCtx): Reaction | null {
  const page = pageKind(ctx.path);
  switch (ev.k) {
    case "chain:block": {
      const b = blockLadder(ev, ctx);
      let names = ctx.behind ? lower(b.names) : b.names;
      if (ctx.quick && !ev.after && ev.kind === "normal" && names[0] !== "glance") names = ["nodGlance", "glance"];
      let wakes = b.wakes;
      if (ctx.door) {
        names = ["glance"];
        wakes = false;
      }
      return { offer: offer(`h${ev.height}`, b.prio, b.ttl, names, { wakes, ...STIR }), aim: "tip", height: ev.height };
    }
    case "chain:catchup": {
      // E4: one act for N blocks; the eyes count them (≤ 3).
      const n = Math.min(K.COUNT_MAX, Math.max(1, ev.to - ev.from));
      let names: ActName[] = page === "b" ? ["catchUp", "countNod", "count"] : ["countNod", "count"];
      if (ctx.behind) names = lower(names);
      if (ctx.door) names = ["count"];
      return { offer: offer(`h${ev.to}`, 5, K.TTL_E4, names, { n, ...STIR }), aim: "tip", n, height: ev.to };
    }
    case "chain:tip-wait":
      // E5: one glance at the tip. E6: a tilt «где же он» and a look at the page's tail, once.
      if (ev.level === 1) return { offer: offer("wait1", 5, 4_000, ["glance"]), aim: "tip" };
      if (ev.level === 2) return { offer: offer("wait2", 5, K.TTL_E1, ["tilt", "glance"]), aim: "tail" };
      return null;
    case "chain:tx-topic":
      return {
        offer: offer("topic", 4, K.TTL_E10, ev.rare ? ["glanceTilt", "glance"] : ["glance"], { rank: 4 }),
        aim: "row",
        id: ev.txId,
      };
    case "chain:pool":
      if (ev.state !== "surge") return null;
      return { offer: offer("pool", 4, K.TTL_E11, page === "d" ? ["glance"] : ["readFast", "glance"], { rank: 2 }), aim: "pool-count" };
    case "chain:fee": {
      if (ev.state === "calm") {
        return ctx.path.split("?")[0] === "/fees" ? { offer: offer("fee-calm", 5, 8_000, ["nodGlance", "glance"]), aim: "fee" } : null;
      }
      const p = ctx.path.split("?")[0];
      const names: ActName[] = p === "/fees" || p === "/mempool" ? ["hopSurprised", "eyePop", "glance"] : page === "d" ? ["glance"] : ["eyePop", "glance"];
      return { offer: offer("fee", 4, K.TTL_E13, names, { rank: 1 }), aim: "fee" };
    }
    case "price:move":
      // Always neutral: a look and the eyes along the ticker. A block in the same moment wins.
      return { offer: offer("price", 4, K.TTL_E14, ["priceLook"], { rank: 3, yieldTo: /^h\d/ }), aim: "price" };
    case "net:state": {
      if (ev.state !== "live" || !ev.cheer) return null;
      let names: ActName[];
      if (ev.flapping || ev.downMs <= K.REJOIN_MS) names = ["nodGlance", "glance"];
      else if (page === "d") names = ["wakeNod", "nodGlance", "glance"];
      else names = ["rejoin", "countNod", "nodGlance"];
      const n = Math.min(K.COUNT_MAX, ev.missed ?? 0);
      return { offer: offer("net", 4, K.TTL_E17, names, { n, ...WAKES }), aim: names[0] === "rejoin" ? "tip" : "title", n };
    }
    case "page:tx-confirmed":
      // The person's tx is in a block: past the T2 interval, once per tx; louder for a favourite.
      return {
        offer: offer(`tx:${ev.txId}`, 3, K.TTL_TX_CONFIRMED, ev.fav ? ["txConfirmedBig", "txConfirmed", "nodGlance"] : ["txConfirmed", "nodGlance"], { firm: true, ...WAKES }),
        aim: "confirmations",
        aim2: "block-link",
        height: ev.height,
      };
    case "page:confirmations": {
      // Milestones (§6.4): the block is no longer the tip (a hop at «›»), nods up to 10, 720 on /block.
      if (ev.of === "block" && ev.n === 1) {
        return { offer: offer(`conf:${ev.height}`, 3, K.TTL_PAGE, ["hopGlance", "nodGlance", "glance"], WAKES), aim: "next", height: ev.height };
      }
      if (ev.of === "block" && ev.n === K.CONF_REWARD) {
        return { offer: offer(`conf:${ev.height}`, 3, K.TTL_PAGE, ["nodKnock", "nodGlance"], WAKES), aim: "confirmations", aim2: "reward", height: ev.height };
      }
      if (ev.n < 2 || ev.n > K.CONF_NODS) return null;
      // A routine nod: it takes the block's E1, so asleep it is that block's stir (§12.23).
      return { offer: offer(`conf:${ev.height}`, 3, K.TTL_PAGE, ["nodGlance", "glance"], STIR), aim: "confirmations", height: ev.height };
    }
    case "page:addr-pending": {
      // A pending tx on this address (± the balance blinks): eyes pop at it; it went in: a nod.
      // Its sign and size change nothing (§1.2.9). A favourite gets a hop.
      if (ev.count > 0) {
        return { offer: offer(`pend:${ev.address}`, 3, K.TTL_PAGE, ev.fav ? ["hopSurprised", "eyePop", "glance"] : ["eyePop", "glance"], WAKES), aim: "pending" };
      }
      return {
        offer: offer(`pend:${ev.address}`, 3, K.TTL_PAGE, ev.fav ? ["hopGlance", "nodGlance", "glance"] : ["nodGlance", "glance"], WAKES),
        aim: "balance",
        height: ev.height,
      };
    }
    case "page:rent":
      // E23: due or soon — two knocks by the beacon; later and ≤ 90 days — a glance.
      if (ev.tone === "later" && ev.blocks > K.RENT_LATER_BLOCKS) return null;
      return { offer: offer(`rent:${ev.address}`, 3, K.TTL_PAGE, ev.tone === "later" ? ["glance"] : ["knock2", "glance"], WAKES), aim: "rent-beacon" };
    case "page:data":
      // E15: the page shows the new oracle price after a seal: one knock at it.
      if (ev.what !== "oracle" || !oraclePage(ctx.path)) return null;
      return { offer: offer("oracle", 3, K.TTL_PAGE, ["knock", "glance"], WAKES), aim: "oracle-price", height: ev.height };
    case "page:empty":
      return { offer: offer("empty", 3, 3_000, ["glance"]), aim: "el" };
    case "page:miss":
      return { offer: offer("miss", 3, 3_000, ["shrugBig", "glance"]), aim: "search" };
    default:
      return null;
  }
}
