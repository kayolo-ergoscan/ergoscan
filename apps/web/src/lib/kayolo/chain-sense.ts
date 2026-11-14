/**
 * Chain sensors for Э1b (design/brand/kayolo-life.md §8.1–8.2): E1 normal block, E2 empty, E3 big
 * (by txCount; `maxBlockSize` is a later stage), one per height. block.sealed is the trigger;
 * chain.tip stands in when no seal came within 3 s. The first height after (re)connecting is only a
 * baseline. A hidden tab counts quietly. Mock streams stay quiet. No requests, no React state: the
 * stream PageSync already reads is fed in here.
 *
 * It also keeps what his status line needs: the height, when this browser got it (performance.now,
 * not the miner's clock, §4.8), the mempool count and whether the live feed is up.
 */

import { say as busSay, type KayoloEvent } from "./events";
import { BUSY_TX, KAYOLO_CHAIN, SEAL_WAIT_MS } from "./thresholds";

export type ChainNow = {
  height: number | null;
  /** performance.now() when this browser learned of the height. */
  at: number | null;
  mempool: number | null;
  live: boolean;
  /** performance.now() since the feed has been down (null while live or before the first open). */
  downSince: number | null;
};

export type ChainDeps = {
  say?: (ev: KayoloEvent) => void;
  now: () => number;
  visible: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

export function blockKind(txCount: number | null): "empty" | "normal" | "big" {
  if (txCount == null) return "normal";
  if (txCount <= 1) return "empty";
  if (txCount >= BUSY_TX) return "big";
  return "normal";
}

export function createChainSense(deps: ChainDeps) {
  const say = deps.say ?? busSay;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let mock = false;
  /** Highest height seen (baseline or block). */
  let top: number | null = null;
  /** Highest height a reaction was said for (or quietly passed while hidden). */
  let told: number | null = null;
  let tipWait: { height: number; timer: unknown } | null = null;
  const now: ChainNow = { height: null, at: null, mempool: null, live: false, downSince: null };

  const learn = (h: number) => {
    if (now.height == null || h > now.height) {
      now.height = h;
      now.at = deps.now();
    }
  };

  const tell = (height: number, txCount: number | null, size: number | null) => {
    if (told != null && height <= told) return;
    told = height;
    if (tipWait && tipWait.height <= height) {
      clearTimer(tipWait.timer);
      tipWait = null;
    }
    if (mock || !KAYOLO_CHAIN || !deps.visible()) return;
    say({ k: "chain:block", height, txCount, size, kind: blockKind(txCount) });
  };

  const onHeight = (h: number, sealed: { txCount: number | null; size: number | null } | null) => {
    if (!Number.isInteger(h) || h <= 0) return;
    learn(h);
    if (top == null) {
      // The first message after connecting: a baseline, unless it is a seal (a real new block).
      top = h;
      if (!sealed) {
        told = Math.max(told ?? 0, h);
        return;
      }
    }
    if (sealed) {
      top = Math.max(top, h);
      tell(h, sealed.txCount, sealed.size);
      return;
    }
    if (h <= top) return;
    top = h;
    if (told != null && h <= told) return;
    // The tip came first: give the seal a moment, then the tip stands for the block.
    if (tipWait) clearTimer(tipWait.timer);
    const height = h;
    tipWait = { height, timer: setTimer(() => {
      if (tipWait?.height === height) tipWait = null;
      tell(height, null, null);
    }, SEAL_WAIT_MS) };
  };

  return {
    feed(msg: unknown) {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: unknown; data?: Record<string, unknown> | null };
      const data = m.data && typeof m.data === "object" ? m.data : null;
      if (m.type === "hello") {
        mock = data?.mock === true;
        return;
      }
      if (m.type === "chain.tip") return onHeight(Number(data?.height), null);
      if (m.type === "block.sealed") {
        const txIds = Array.isArray(data?.txIds) ? data.txIds.length : null;
        // A partial seal (the gateway could not read the block) has no count: not an empty block.
        const count = data?.partial === true ? null : Number.isFinite(Number(data?.txCount)) ? Number(data?.txCount) : (txIds ?? 0);
        const size = Number.isFinite(Number(data?.size)) ? Number(data?.size) : null;
        return onHeight(Number(data?.height), { txCount: count, size });
      }
      if (m.type === "mempool.snapshot") {
        const c = Number(data?.count);
        if (Number.isFinite(c)) now.mempool = c;
        else if (Array.isArray(data?.balls)) now.mempool = data.balls.length;
        return;
      }
      if (m.type === "mempool.add") now.mempool = (now.mempool ?? 0) + 1;
      else if (m.type === "mempool.remove") now.mempool = Math.max(0, (now.mempool ?? 0) - 1);
    },
    /** ws onopen / onclose. A new connection starts a new baseline. */
    socket(open: boolean) {
      now.live = open;
      now.downSince = open ? null : (now.downSince ?? deps.now());
      if (open) top = null;
    },
    state(): ChainNow {
      return { ...now };
    },
  };
}

let page: ReturnType<typeof createChainSense> | null = null;

function pageSense() {
  if (!page) {
    page = createChainSense({
      now: () => performance.now(),
      visible: () => document.visibilityState === "visible",
    });
  }
  return page;
}

/** PageSync hands every stream message here. Browser only; never throws. */
export function feedChain(msg: unknown) {
  if (typeof window === "undefined") return;
  try {
    pageSense().feed(msg);
  } catch {
    /* a reaction is never worth a broken stream */
  }
}

/** PageSync tells when the stream opens and closes. */
export function chainSocket(open: boolean) {
  if (typeof window === "undefined") return;
  try {
    pageSense().socket(open);
  } catch {
    /* */
  }
}

/** What the status line shows. */
export function chainNow(): ChainNow {
  if (typeof window === "undefined") return { height: null, at: null, mempool: null, live: false, downSince: null };
  return pageSense().state();
}
