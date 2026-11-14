/**
 * Chain sensors (design/brand/kayolo-life.md §8.1–8.2). Э1b: E1 normal block, E2 empty, E3 big (by
 * txCount; `maxBlockSize` waits for its gateway line), one per height. Э4 adds the rest of the chain:
 *
 * - E4 a catch-up (the height went up by ≥ 2 at once: one act instead of N);
 * - E5–E7 the wait for a block (2× and 3× the average, 8 min), one timer, counted from when the
 *   gateway saw the block (the seal's `seenAt`, shifted by the server's clock from snapshot `ts`;
 *   without it, when this browser got it), never from the miner's header time (§4.8); right after a
 *   connect the stream's `eta.lastBlockTs` (also `seenAt`) stands in;
 * - E10 a tx of the page's protocol (the ball's `platform`; its shape when it has none); E11 a pool
 *   surge; E12 a drain after a seal; E13 a fee spike (p50 against its own hour, never p90); E14 the
 *   price (neutral; the shell's poll feeds it); E15 the oracle txs a seal carried (the oracle page
 *   decides by their action and tokens); E16–E18 the live feed and the browser being offline; E19 the
 *   site behind (index lag, node headers, peers); E21 an epoch; E22 a mock stream silences everything.
 *
 * block.sealed is the trigger; chain.tip stands in when no seal came within 3 s. The first height
 * after (re)connecting is only a baseline. A hidden tab counts quietly. No requests, no React state:
 * the stream PageSync already reads is fed in here, plus the two polls the shell already makes.
 *
 * Pages hear every seal (`chainListen`): a new block, a late seal (after its tip stood in), a block
 * that replaced the one shown at its height (a fork: no Kayolo reaction, only the pages re-check),
 * and a tx leaving or entering the pool. Their E1 test (`chainAwait`) is a pure question asked of every page.
 *
 * It also keeps what his status line needs: the height, when this browser got it, the mempool
 * count, the average, the wait, the feed and whether the site is behind.
 */

import { say as busSay, type KayoloEvent } from "./events";
import * as K from "./thresholds";
import { BUSY_TX, KAYOLO_CHAIN, SEAL_WAIT_MS } from "./thresholds";

export type NetState = "live" | "down" | "lost" | "offline";

export type ChainNow = {
  height: number | null;
  /** performance.now() when this browser learned of the block (estimated from the stream right after a connect). */
  at: number | null;
  mempool: number | null;
  live: boolean;
  /** performance.now() since the feed has been down (null while live or before the first open). */
  downSince: number | null;
  /** The stream's average block interval, ms. */
  avgMs: number;
  /** E5–E7: 0 none, 1 ≥ 2× the average, 2 ≥ 3×, 3 ≥ 8 min. */
  wait: 0 | 1 | 2 | 3;
  net: NetState;
  behind: { on: boolean; lag: number | null; node: boolean; peers: boolean };
  mock: boolean;
};

/** An oracle tx a seal carried (E15): what the ball said of it in the pool. */
export type OracleTx = { id: string; action: string | null; tokens: readonly string[] };

/** A block as the pages hear it. */
export type Seal = {
  height: number;
  /** null when a tip stood in for the block. */
  blockId: string | null;
  /** null: the block was not read (a partial seal, or a tip without its seal) — any tx may be in it. */
  txIds: readonly string[] | null;
  /** The oracle txs this block took from the pool (E15). */
  oracle: readonly OracleTx[];
  /** Rent boxes the block spent (the gateway's count, no addresses). */
  rentBoxes?: number;
  /** A fork: this block replaced `replaces`, shown at this height before. The pages re-check; Kayolo says nothing. */
  replaced?: boolean;
  replaces?: string;
};

/** What a page hears: a seal (see Seal), a tx that left the pool (sealed, evicted or double-spent) or came into it. */
export type ChainNote = ({ k: "seal" } & Seal) | { k: "gone"; id: string } | { k: "added"; id: string };

/**
 * A page's test for a new block: true when the page will say a page:* about it, so its E1 waits for
 * that (§2.8). Pure: every page is asked, and none acts here — acting is `chainListen`'s.
 */
export type Awaiter = (s: Seal) => boolean;

/**
 * His status line in the Tip (§4.8), the first that fits: the feed lost ≥ 2 min → the feed down
 * (≥ 6 s) or the browser offline → the chain stalled (≥ 8 min) → waiting (≥ 2× the average) → the
 * index behind → the usual «Block {h} · {age} ago».
 */
export type StatusLine =
  | { k: "noStream" }
  | { k: "offline" }
  | { k: "stall"; min: number }
  | { k: "wait"; ageS: number }
  | { k: "behind"; lag: number }
  | { k: "status"; height: number; ageS: number; mempool: number | null }
  | null;

export function statusOf(c: ChainNow, now: number): StatusLine {
  if (c.net === "lost") return { k: "noStream" };
  if (c.net === "offline" || (!c.live && c.downSince != null && now - c.downSince >= K.OFFLINE_MS)) return { k: "offline" };
  if (c.height == null || c.at == null) return null;
  const ageS = Math.max(0, Math.round((now - c.at) / 1000));
  if (!c.mock && c.wait >= 3) return { k: "stall", min: Math.floor(ageS / 60) };
  if (!c.mock && c.wait >= 1) return { k: "wait", ageS };
  if (c.behind.on && c.behind.lag != null && c.behind.lag > K.BEHIND_LAG) return { k: "behind", lag: c.behind.lag };
  return { k: "status", height: c.height, ageS, mempool: c.mempool };
}

export type ChainDeps = {
  say?: (ev: KayoloEvent) => void;
  now: () => number;
  visible: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Wall clock (Date.now), for the server's clock offset. */
  wall?: () => number;
  /** The page's path (E10 topics, E15). */
  path?: () => string;
};

export function blockKind(txCount: number | null): "empty" | "normal" | "big" {
  if (txCount == null) return "normal";
  if (txCount <= 1) return "empty";
  if (txCount >= BUSY_TX) return "big";
  return "normal";
}

/** The level of a wait this long (E5–E7), with the average `avg`. */
export function waitLevel(elapsed: number, avg: number): 0 | 1 | 2 | 3 {
  if (elapsed >= K.STALL_MS) return 3;
  if (elapsed >= K.WAIT2_X * avg) return 2;
  if (elapsed >= K.WAIT1_X * avg) return 1;
  return 0;
}

/** The next wait edge after `elapsed` (ms since the block), or Infinity. */
export function nextWaitEdge(elapsed: number, avg: number): number {
  let due = Infinity;
  for (const e of [K.WAIT1_X * avg, K.WAIT2_X * avg, K.STALL_MS]) if (e > elapsed) due = Math.min(due, e);
  return due;
}

/**
 * E10: the protocols a page is about (§8.2), as the live ball names them in `platform` (its
 * `category` is the tx's shape: transfer, contract…). No page is about a shape: there is no NFT shape.
 */
export function pageTopics(path: string): readonly string[] {
  const p = path.split("?")[0];
  if (/^\/rosen(\/|$)/.test(p)) return ["rosen"];
  if (/^\/defi\/spectrum(\/|$)/.test(p)) return ["spectrum"];
  if (/^\/defi\/lithos(\/|$)/.test(p)) return ["lithos"];
  if (/^\/defi\/pool(\/|$)/.test(p)) return ["spectrum", "lithos"];
  if (/^\/defi\/stable(\/|$)/.test(p)) return ["sigmausd"];
  if (/^\/oracles(\/|$)/.test(p)) return ["oracle"];
  return [];
}

/** A ball's topic key (E10): its protocol, else its shape. The old recording's `category: "oracle"` is a protocol too. */
export function ballTopic(b: { platform?: unknown; category?: unknown } | null | undefined): string {
  const pl = typeof b?.platform === "string" && b.platform ? b.platform : null;
  if (pl) return pl;
  return typeof b?.category === "string" && b.category ? b.category : "unknown";
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The last value seen in each minute, for the last `keep` minutes. */
function minutes(keep: number) {
  const rows: { min: number; v: number }[] = [];
  return {
    add(t: number, v: number) {
      const min = Math.floor(t / 60_000);
      const last = rows[rows.length - 1];
      if (last && last.min === min) last.v = v;
      else rows.push({ min, v });
      while (rows.length && rows[0].min <= min - keep) rows.shift();
    },
    values: () => rows.map((r) => r.v),
    size: () => rows.length,
  };
}

export function createChainSense(deps: ChainDeps) {
  const say = deps.say ?? busSay;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const wall = deps.wall ?? (() => Date.now());
  let mock = false;
  /** Highest height seen (baseline or block). */
  let top: number | null = null;
  /** Highest height a reaction was said for (or quietly passed while hidden). */
  let told: number | null = null;
  let tipWait: { height: number; timer: unknown } | null = null;
  const now: ChainNow = {
    height: null,
    at: null,
    mempool: null,
    live: false,
    downSince: null,
    avgMs: K.AVG_BLOCK_MS,
    wait: 0,
    net: "live",
    behind: { on: false, lag: null, node: false, peers: false },
    mock: false,
  };
  const awaiters = new Set<Awaiter>();
  const listeners = new Set<(n: ChainNote) => void>();
  /** Every page hears every seal and every tx that left the pool, whatever the tab; a mock stream is not the chain. */
  const notify = (n: ChainNote) => {
    if (mock) return;
    for (const fn of [...listeners]) {
      try {
        fn(n);
      } catch {
        /* a page's listener failed: the others still hear */
      }
    }
  };
  /** The block ids seen at recent heights (a fork shows as another id at one of them). */
  const blocks = new Map<number, string>();
  const remember = (h: number, id: string) => {
    blocks.set(h, id);
    for (const k of blocks.keys()) if (k < h - K.BLOCK_IDS_KEPT || k > h + K.BLOCK_IDS_KEPT) blocks.delete(k);
  };
  /** Spoken only when the tab is seen and the stream is real. */
  const speak = (ev: KayoloEvent) => {
    if (mock || !KAYOLO_CHAIN) return;
    say(ev);
  };
  const visible = () => deps.visible();

  /* ---- the server's clock (§4.8) ---- */
  let offset: number | null = null;
  let lastBlockTs: number | null = null;

  /* ---- E5–E7 ---- */
  let waitTimer: unknown = null;
  const armWait = () => {
    if (waitTimer != null) clearTimer(waitTimer);
    waitTimer = null;
    if (now.at == null || !now.live) return;
    const elapsed = deps.now() - now.at;
    const lv = waitLevel(elapsed, now.avgMs);
    if (lv !== now.wait) {
      now.wait = lv;
      speak({ k: "chain:tip-wait", level: lv, sinceMs: Math.round(elapsed) });
    }
    // A hidden tab keeps no timer (§9.10); visibility(true) catches the level up when it shows.
    const edge = nextWaitEdge(elapsed, now.avgMs);
    if (Number.isFinite(edge) && visible()) waitTimer = setTimer(() => {
      waitTimer = null;
      armWait();
    }, Math.max(0, edge - elapsed + 5));
  };

  const learn = (h: number, at: number) => {
    if (now.height == null || h > now.height) {
      now.height = h;
      now.at = at;
    }
  };

  /** Every page is asked (a pure test each): one page's yes never hides the block from another. */
  const holdFor = (s: Seal) => {
    let hold = false;
    for (const fn of [...awaiters]) {
      try {
        if (fn(s)) hold = true;
      } catch {
        /* a page's test failed: the block reacts as usual */
      }
    }
    return hold;
  };

  /* ---- E15: oracle txs waiting in the pool (the ball's platform "oracle", its action and tokens) ---- */
  const oracleTx = new Map<string, { action: string | null; tokens: readonly string[] }>();
  const noteOracle = (id: string, action: string | null, tokens: readonly string[]) => {
    oracleTx.set(id, { action, tokens });
    if (oracleTx.size > 200) oracleTx.delete(oracleTx.keys().next().value as string);
  };
  const noteBall = (b: Record<string, unknown> | null | undefined, id: string) => {
    if (!id || !b) return;
    if (b.platform !== "oracle" && !(b.platform == null && b.category === "oracle")) return;
    const tokens = Array.isArray(b.tokenIds) ? (b.tokenIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    noteOracle(id, typeof b.action === "string" ? b.action : null, tokens);
  };
  /** The oracle txs of a block; the pool forgets them now. */
  const sealedOracle = (txIds: readonly string[] | null): OracleTx[] => {
    if (!txIds?.length || !oracleTx.size) return [];
    const out: OracleTx[] = [];
    for (const id of txIds) {
      const o = oracleTx.get(id);
      if (!o) continue;
      oracleTx.delete(id);
      out.push({ id, ...o });
    }
    return out;
  };

  /* ---- E12 ---- */
  let drain: { height: number; prev: number; until: number } | null = null;
  let quietUntil = -Infinity;
  const checkDrain = () => {
    if (!drain || now.mempool == null) return;
    if (deps.now() > drain.until) {
      drain = null;
      return;
    }
    if (now.mempool <= K.DRAIN_RATIO * drain.prev) {
      const h = drain.height;
      drain = null;
      if (visible()) speak({ k: "chain:drain", height: h });
    }
  };

  /** Kayolo's reaction to a new height (false: an old one, nothing said). */
  const tell = (height: number, txCount: number | null, size: number | null, seal: Seal) => {
    if (told != null && height <= told) return false;
    const from = told;
    told = height;
    if (tipWait && tipWait.height <= height) {
      clearTimer(tipWait.timer);
      tipWait = null;
    }
    // A block ends the wait; the first one after a long wait (E6) or a stall (E7) is a relief.
    const waited = now.wait;
    if (waited) {
      now.wait = 0;
      speak({ k: "chain:tip-wait", level: 0, sinceMs: 0 });
    }
    armWait();
    if (mock || !KAYOLO_CHAIN || !visible()) return true;
    const hold = holdFor(seal);
    if (from != null && height - from >= K.CATCHUP_MIN) {
      say({ k: "chain:catchup", from, to: height, ...(hold ? { hold } : {}) });
    } else {
      const after = waited >= 3 ? "stall" : waited >= 2 ? "wait" : undefined;
      say({ k: "chain:block", height, txCount, size, kind: blockKind(txCount), ...(after ? { after } : {}), ...(hold ? { hold } : {}) });
    }
    if (from != null && Math.floor(height / K.EPOCH_LEN) > Math.floor(from / K.EPOCH_LEN)) {
      say({ k: "chain:epoch", height: Math.floor(height / K.EPOCH_LEN) * K.EPOCH_LEN });
    }
    return true;
  };

  /* ---- E16–E18 ---- */
  let downTimer: unknown = null;
  let offline = false;
  const closes: number[] = [];
  let heightBefore: number | null = null;
  let rejoin: { downMs: number; flapping: boolean; timer: unknown } | null = null;
  const netSay = (state: NetState, extra: Partial<{ cheer: boolean; missed: number; downMs: number; flapping: boolean }> = {}) => {
    now.net = state;
    speak({ k: "net:state", state, downMs: extra.downMs ?? (now.downSince != null ? Math.round(deps.now() - now.downSince) : 0), flapping: extra.flapping ?? false, ...extra });
  };
  const finishRejoin = (h: number | null) => {
    if (!rejoin) return;
    clearTimer(rejoin.timer);
    const r = rejoin;
    rejoin = null;
    const k = h != null && heightBefore != null ? Math.max(0, h - heightBefore) : 0;
    heightBefore = null;
    netSay(offline ? "offline" : "live", { cheer: visible() && !offline, missed: k, downMs: r.downMs, flapping: r.flapping });
  };

  /** A gateway-clock moment (`seenAt`, `eta.lastBlockTs`) on this tab's clock, never in the future. */
  const fromGateway = (ts: number) => {
    const t = deps.now();
    return offset != null ? t - Math.max(0, wall() + offset - ts) : t;
  };

  const onHeight = (
    h: number,
    sealed: {
      txCount: number | null;
      size: number | null;
      txIds: readonly string[] | null;
      seenAt: number | null;
      blockId: string | null;
      rentBoxes: number | null;
    } | null
  ) => {
    if (!Number.isInteger(h) || h <= 0) return;
    if (sealed?.blockId != null && blocks.get(h) === sealed.blockId) return; // this block again
    if (top == null) {
      // The first message after connecting: a baseline, unless it is a seal (a real new block).
      top = h;
      if (!sealed) {
        // When did the chain get it? The stream's last block time on the server's clock (§4.8).
        const t = deps.now();
        const est = lastBlockTs != null ? fromGateway(lastBlockTs) : t;
        if (now.height == null || h > now.height) {
          now.height = h;
          now.at = Math.min(t, est);
        }
        told = Math.max(told ?? 0, h);
        finishRejoin(h);
        armWait();
        return;
      }
      finishRejoin(h);
    }
    learn(h, sealed?.seenAt != null ? fromGateway(sealed.seenAt) : deps.now());
    if (sealed) {
      top = Math.max(top, h);
      const fresh = told == null || h > told;
      const was = blocks.get(h);
      if (sealed.blockId != null) remember(h, sealed.blockId);
      const seal: Seal = {
        height: h,
        blockId: sealed.blockId,
        txIds: sealed.txIds,
        oracle: sealedOracle(sealed.txIds),
        ...(sealed.rentBoxes ? { rentBoxes: sealed.rentBoxes } : {}),
        // Another block where one was shown: a fork. A seal for a height a tip stood in for is only late.
        ...(!fresh && was != null && sealed.blockId != null ? { replaced: true, replaces: was } : {}),
      };
      if (fresh) {
        if (now.mempool != null && now.mempool >= K.DRAIN_MIN && deps.now() >= quietUntil) {
          drain = { height: h, prev: now.mempool, until: deps.now() + K.DRAIN_MS };
        }
        tell(h, sealed.txCount, sealed.size, seal);
      }
      notify({ k: "seal", ...seal });
      return;
    }
    if (h <= top) return;
    top = h;
    if (told != null && h <= told) return;
    // The tip came first: give the seal a moment, then the tip stands for the block.
    if (tipWait) clearTimer(tipWait.timer);
    const height = h;
    tipWait = {
      height,
      timer: setTimer(() => {
        if (tipWait?.height === height) tipWait = null;
        const seal: Seal = { height, blockId: null, txIds: null, oracle: [] };
        if (tell(height, null, null, seal)) notify({ k: "seal", ...seal });
      }, SEAL_WAIT_MS),
    };
  };

  /* ---- E10 ---- */
  const seenIds = new Set<string>();
  const seenCat = new Map<string, number>();
  let seenAll = 0;
  let topicAt = -Infinity;
  /** `key`: the ball's topic (ballTopic: its protocol, else its shape). */
  const seeTx = (id: string, key: string) => {
    if (!id || seenIds.has(id)) return false;
    if (seenIds.size > 5000) seenIds.clear();
    seenIds.add(id);
    seenCat.set(key, (seenCat.get(key) ?? 0) + 1);
    seenAll += 1;
    return true;
  };
  const topic = (id: string, key: string) => {
    if (!visible() || deps.now() - topicAt < K.TOPIC_GAP_MS) return;
    const path = deps.path?.() ?? "";
    let rare = false;
    if (!pageTopics(path).includes(key)) {
      if (path.split("?")[0] !== "/mempool" || seenAll < K.TOPIC_MIN_SEEN) return;
      if ((seenCat.get(key) ?? 0) / seenAll >= K.TOPIC_RARE) return;
      rare = true;
    }
    topicAt = deps.now();
    speak({ k: "chain:tx-topic", category: key, txId: id, rare });
  };

  /* ---- E11 ---- */
  const poolMin = minutes(K.SURGE_WINDOW_MIN);
  let surge: { on: boolean; first: number | null; base: number; calmSince: number | null; said: boolean } = { on: false, first: null, base: 0, calmSince: null, said: false };
  let surgeAt = -Infinity;
  const onCount = (c: number) => {
    const t = deps.now();
    const base = poolMin.size() ? median(poolMin.values()) : c;
    poolMin.add(t, c);
    if (t < quietUntil) return;
    if (!surge.on) {
      if (c >= Math.max(K.SURGE_FLOOR, K.SURGE_X * base)) {
        if (surge.first == null) surge.first = t;
        else if (t - surge.first >= K.TWICE_MS) {
          const said = t - surgeAt >= K.SURGE_GAP_MS && visible();
          surge = { on: true, first: null, base, calmSince: null, said };
          if (said) {
            surgeAt = t;
            speak({ k: "chain:pool", state: "surge", count: c, base: Math.round(base) });
          }
        }
      } else surge.first = null;
      return;
    }
    if (c <= K.SURGE_CALM_X * surge.base) {
      surge.calmSince ??= t;
      if (t - surge.calmSince >= K.SURGE_CALM_MS) {
        const was = surge;
        surge = { on: false, first: null, base: 0, calmSince: null, said: false };
        if (was.said && visible()) speak({ k: "chain:pool", state: "calm", count: c, base: Math.round(was.base) });
      }
    } else surge.calmSince = null;
  };

  /* ---- E13 ---- */
  const feeMin = minutes(K.FEE_WINDOW_MIN);
  let fee: { on: boolean; first: number | null; base: number; calmSince: number | null; said: boolean } = { on: false, first: null, base: 0, calmSince: null, said: false };
  let feeAt = -Infinity;
  const onP50 = (p50: number) => {
    const t = deps.now();
    // A small pool's p50 is a handful of txs: on the live stream (14.11, 6–10 tx) it went
    // 1 746 → 96 948 → 1 052 632 within a minute. That is not a fee market: no judging (§12.23).
    const small = now.mempool == null || now.mempool < K.FEE_MIN_POOL;
    if (small && !fee.on) {
      fee.first = null;
      return;
    }
    const warm = feeMin.size() >= K.FEE_WARM_MIN;
    const base = warm ? median(feeMin.values()) : 0;
    feeMin.add(t, p50);
    if (!warm || base <= 0) return;
    if (!fee.on) {
      if (p50 >= K.FEE_X * base) {
        if (fee.first == null) fee.first = t;
        else if (t - fee.first >= K.TWICE_MS) {
          const said = t - feeAt >= K.FEE_GAP_MS && visible();
          fee = { on: true, first: null, base, calmSince: null, said };
          if (said) {
            feeAt = t;
            speak({ k: "chain:fee", state: "spike", p50, base: Math.round(base) });
          }
        }
      } else fee.first = null;
      return;
    }
    if (p50 <= K.FEE_CALM_X * fee.base) {
      fee.calmSince ??= t;
      if (t - fee.calmSince >= K.FEE_CALM_MS) {
        const was = fee;
        fee = { on: false, first: null, base: 0, calmSince: null, said: false };
        if (was.said && visible()) speak({ k: "chain:fee", state: "calm", p50, base: Math.round(was.base) });
      }
    } else fee.calmSince = null;
  };

  /* ---- E14 ---- */
  const polls: number[] = [];
  let priceAt = -Infinity;

  /* ---- E19 ---- */
  let lagHigh = 0;
  let lagOn = false;
  let lag: number | null = null;
  let nodeSince: number | null = null;
  let nodeOn = false;
  let nodeTimer: unknown = null;
  let peers0 = false;
  const behindNow = () => {
    const b = { on: lagOn || nodeOn || peers0, lag, node: nodeOn, peers: peers0 };
    const was = now.behind;
    if (b.on === was.on && b.node === was.node && b.peers === was.peers && (b.lag === was.lag || !b.on)) {
      now.behind = b;
      return;
    }
    now.behind = b;
    speak({ k: "site:behind", ...b });
  };

  return {
    feed(msg: unknown) {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: unknown; data?: Record<string, unknown> | null };
      const data = m.data && typeof m.data === "object" ? m.data : null;
      if (m.type === "hello") {
        mock = data?.mock === true;
        now.mock = mock;
        return;
      }
      if (m.type === "chain.tip") return onHeight(Number(data?.height), null);
      if (m.type === "block.sealed") {
        // A partial seal (the gateway could not read the block) carries `txIds: []`: its txs are
        // unknown (null), never «none of yours»; and it has no count: not an empty block.
        const partial = data?.partial === true;
        const ids = partial ? null : Array.isArray(data?.txIds) ? (data.txIds as unknown[]).filter((x): x is string => typeof x === "string") : null;
        const count = partial ? null : Number.isFinite(Number(data?.txCount)) ? Number(data?.txCount) : (ids?.length ?? 0);
        const size = Number.isFinite(Number(data?.size)) ? Number(data?.size) : null;
        // When the gateway saw it (its clock): the waits count from there, not from the header time.
        const seen = Number(data?.seenAt);
        const blockId = typeof data?.blockId === "string" && data.blockId ? data.blockId : null;
        const rent = Number(data?.rentBoxes);
        return onHeight(Number(data?.height), {
          txCount: count,
          size,
          txIds: ids,
          seenAt: Number.isFinite(seen) && seen > 1e12 ? seen : null,
          blockId,
          rentBoxes: Number.isFinite(rent) && rent > 0 ? rent : null,
        });
      }
      if (m.type === "mempool.snapshot") {
        const ts = Number(data?.ts);
        if (Number.isFinite(ts) && ts > 0) offset = ts - wall();
        const balls = Array.isArray(data?.balls) ? (data.balls as Record<string, unknown>[]) : null;
        for (const b of balls ?? []) {
          const id = String(b?.txId ?? b?.id ?? "");
          seeTx(id, ballTopic(b));
          noteBall(b, id);
        }
        // The first recorded stream keeps the oracle ids only (no action, no tokens).
        if (Array.isArray(data?.oracle)) for (const id of data.oracle as unknown[]) if (typeof id === "string") noteOracle(id, null, []);
        const c = Number(data?.count);
        if (Number.isFinite(c)) now.mempool = c;
        else if (balls) now.mempool = balls.length;
        if (now.mempool != null) onCount(now.mempool);
        checkDrain();
        return;
      }
      if (m.type === "mempool.add") {
        now.mempool = (now.mempool ?? 0) + 1;
        const id = String(data?.txId ?? data?.id ?? "");
        const key = ballTopic(data);
        noteBall(data, id);
        if (seeTx(id, key)) topic(id, key);
        if (id) notify({ k: "added", id });
        return;
      }
      if (m.type === "mempool.remove") {
        now.mempool = Math.max(0, (now.mempool ?? 0) - 1);
        checkDrain();
        const id = typeof data?.id === "string" ? data.id : typeof data?.txId === "string" ? data.txId : "";
        if (id) notify({ k: "gone", id });
        return;
      }
      if (m.type === "fees.histogram") {
        const eta = data?.eta && typeof data.eta === "object" ? (data.eta as Record<string, unknown>) : null;
        const avg = Number(eta?.avgIntervalMs);
        if (Number.isFinite(avg) && avg >= 10_000 && avg <= 30 * 60_000 && Math.abs(avg - now.avgMs) >= 1) {
          now.avgMs = avg;
          armWait();
        }
        const last = Number(eta?.lastBlockTs);
        if (Number.isFinite(last) && last > 0) lastBlockTs = last;
        const p50 = Number(data?.p50);
        if (Number.isFinite(p50) && p50 > 0) onP50(p50);
        return;
      }
      if (m.type === "node.info") {
        const hh = Number(data?.headersHeight);
        const fh = Number(data?.fullHeight);
        const t = deps.now();
        if (Number.isFinite(hh) && Number.isFinite(fh) && hh - fh >= K.NODE_BEHIND) {
          if (nodeSince == null) {
            nodeSince = t;
            if (nodeTimer != null) clearTimer(nodeTimer);
            nodeTimer = setTimer(() => {
              nodeTimer = null;
              if (nodeSince != null && deps.now() - nodeSince >= K.NODE_BEHIND_MS) {
                nodeOn = true;
                behindNow();
              }
            }, K.NODE_BEHIND_MS + 5);
          }
        } else if (Number.isFinite(hh) && Number.isFinite(fh)) {
          nodeSince = null;
          if (nodeTimer != null) clearTimer(nodeTimer);
          nodeTimer = null;
          nodeOn = false;
        }
        const peers = Number(data?.peersCount);
        if (Number.isFinite(peers)) peers0 = peers === 0;
        behindNow();
      }
    },
    /** ws onopen / onclose. A new connection starts a new baseline. */
    socket(open: boolean) {
      const t = deps.now();
      if (!open) {
        if (now.live || now.downSince == null) {
          closes.push(t);
          while (closes.length && t - closes[0] > K.FLAP_WINDOW_MS) closes.shift();
        }
        now.live = false;
        if (rejoin) {
          clearTimer(rejoin.timer);
          rejoin = null;
        }
        if (now.downSince == null) {
          now.downSince = t;
          heightBefore ??= now.height;
          if (downTimer != null) clearTimer(downTimer);
          downTimer = setTimer(() => {
            downTimer = null;
            if (now.live || now.downSince == null) return;
            if (!offline) netSay("down");
            downTimer = setTimer(() => {
              downTimer = null;
              if (now.live || now.downSince == null) return;
              if (!offline) netSay("lost");
            }, K.LOST_MS - K.DOWN_MS);
          }, K.DOWN_MS);
        }
        // The chain is not «late» while the feed is away.
        if (waitTimer != null) clearTimer(waitTimer);
        waitTimer = null;
        return;
      }
      const downMs = now.downSince != null ? t - now.downSince : 0;
      now.live = true;
      now.downSince = null;
      if (downTimer != null) clearTimer(downTimer);
      downTimer = null;
      top = null;
      quietUntil = t + K.RECONNECT_QUIET_MS;
      surge.first = null;
      offline = false;
      if (downMs >= K.DOWN_MS) {
        const flapping = closes.filter((x) => t - x <= K.FLAP_WINDOW_MS).length > K.FLAP_CYCLES;
        rejoin = { downMs: Math.round(downMs), flapping, timer: setTimer(() => finishRejoin(null), K.REJOIN_WAIT_MS) };
        // The background goes now; the act follows when the tip tells how far it moved.
        now.net = "live";
      } else {
        heightBefore = null;
        if (now.net !== "live" && now.net !== "offline") netSay("live", { downMs: Math.round(downMs) });
      }
    },
    /** window online / offline (§2.4: «ждёт»). Back online is not a celebration: onopen is. */
    online(on: boolean) {
      offline = !on;
      if (!on) {
        netSay("offline");
        return;
      }
      const t = deps.now();
      const down = now.live || now.downSince == null ? 0 : t - now.downSince;
      netSay(down >= K.LOST_MS ? "lost" : down >= K.DOWN_MS ? "down" : "live");
    },
    /** document visibilitychange: hidden drops the wait timer, visible re-reads the wait level once. */
    visibility(shown: boolean) {
      if (shown) {
        armWait();
        return;
      }
      if (waitTimer != null) clearTimer(waitTimer);
      waitTimer = null;
    },
    /** /v1/indexer/status lag, every 30 s (IndexerStatus already polls it). */
    indexer(l: number | null) {
      if (l == null || !Number.isFinite(l)) return;
      lag = l;
      if (l > K.BEHIND_LAG) lagHigh += 1;
      else lagHigh = 0;
      if (lagHigh >= 2) lagOn = true;
      if (l <= K.BEHIND_CLEAR) lagOn = false;
      behindNow();
    },
    /** The ERG price from the shell's own poll (90 s, visible tab). Only ever a neutral look. */
    price(usd: number) {
      if (!Number.isFinite(usd) || usd <= 0) return;
      const t = deps.now();
      const prev = polls[polls.length - 1];
      const lo = polls.length ? Math.min(...polls) : usd;
      const hi = polls.length ? Math.max(...polls) : usd;
      polls.push(usd);
      while (polls.length > K.PRICE_POLLS + 1) polls.shift();
      if (prev == null || !visible() || t - priceAt < K.PRICE_GAP_MS) return;
      const step = (usd - prev) / prev;
      let pct = 0;
      let windowMin: 1.5 | 15 = 1.5;
      if (Math.abs(step) >= K.PRICE_STEP) pct = step;
      else {
        const up = (usd - lo) / lo;
        const down = (usd - hi) / hi;
        const swing = Math.abs(up) >= Math.abs(down) ? up : down;
        if (Math.abs(swing) < K.PRICE_SWING) return;
        pct = swing;
        windowMin = 15;
      }
      priceAt = t;
      speak({ k: "price:move", usd, pct: Math.round(pct * 10_000) / 100, windowMin });
    },
    /** A page that re-reads its data for a block (§2.8): while registered, such a block holds its reaction. */
    await(fn: Awaiter): () => void {
      awaiters.add(fn);
      return () => awaiters.delete(fn);
    },
    /** A page hears seals (new, late, replacing) and txs leaving the pool, on any tab; it acts on its own. */
    listen(fn: (n: ChainNote) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    state(): ChainNow {
      return { ...now, behind: { ...now.behind } };
    },
  };
}

export type ChainSense = ReturnType<typeof createChainSense>;

let page: ChainSense | null = null;

function pageSense() {
  if (!page) {
    page = createChainSense({
      now: () => performance.now(),
      visible: () => document.visibilityState === "visible",
      path: () => window.location.pathname,
    });
    const s = page;
    window.addEventListener("online", () => s.online(true));
    window.addEventListener("offline", () => s.online(false));
    document.addEventListener("visibilitychange", () => s.visibility(document.visibilityState === "visible"));
    if (navigator.onLine === false) s.online(false);
  }
  return page;
}

/** Runs a call on the page's sensors in the browser; a reaction is never worth a broken page. */
function guarded(fn: (s: ChainSense) => void) {
  if (typeof window === "undefined") return;
  try {
    fn(pageSense());
  } catch {
    /* */
  }
}

/** PageSync hands every stream message here. Browser only; never throws. */
export function feedChain(msg: unknown) {
  guarded((s) => s.feed(msg));
}

/** PageSync tells when the stream opens and closes. */
export function chainSocket(open: boolean) {
  guarded((s) => s.socket(open));
}

/** IndexerStatus tells its lag after every poll. */
export function chainIndexer(lag: number | null) {
  guarded((s) => s.indexer(lag));
}

/** The shell's price poll tells the price. */
export function chainPrice(usd: number) {
  guarded((s) => s.price(usd));
}

/** A page re-reads its data for some blocks (it says a page:* about them): register while that holds. */
export function chainAwait(fn: Awaiter): () => void {
  if (typeof window === "undefined") return () => {};
  try {
    return pageSense().await(fn);
  } catch {
    return () => {};
  }
}

/** A page hears every seal and every tx leaving the pool (see ChainNote); it decides itself what to re-read. */
export function chainListen(fn: (n: ChainNote) => void): () => void {
  if (typeof window === "undefined") return () => {};
  try {
    return pageSense().listen(fn);
  } catch {
    return () => {};
  }
}

/** What the status line shows. */
export function chainNow(): ChainNow {
  if (typeof window === "undefined") {
    return {
      height: null,
      at: null,
      mempool: null,
      live: false,
      downSince: null,
      avgMs: K.AVG_BLOCK_MS,
      wait: 0,
      net: "live",
      behind: { on: false, lag: null, node: false, peers: false },
      mock: false,
    };
  }
  return pageSense().state();
}
