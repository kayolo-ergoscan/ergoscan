/**
 * Kayolo's bus (design/brand/kayolo-life.md §9.2): a window event `kayolo` whose detail is a
 * KayoloEvent. Only what is live today is in the union; later stages add to it. Sources only tell;
 * none of them waits for him, and nothing on the page changes when nobody listens.
 */

/** E20 kinds (§8.2). Э0 celebrates only "10k". */
export type RareKind = "10k" | "100k" | "emission-step" | "emission-end";

/**
 * Where the body is when Kayolo holds it: his niche, the phone park, the address door, a note, the
 * palette edge (§3.3; the layer only, never handed to the scout).
 */
export type BodyWhere = "nook" | "park" | "door" | "note" | "edge";

export type KayoloEvent =
  | { k: "chain:rare"; height: number; what: RareKind }
  /**
   * E1–E3: one per height (seal and tip merged). txCount is null when only the tip came. `after`:
   * the first block after a long wait (E6) or a stall (E7). `hold`: the page on screen re-reads its
   * data for this block and will say a page:* about it (§2.8, §8.4); the reaction waits ≤ 5 s for it.
   */
  | {
      k: "chain:block";
      height: number;
      txCount: number | null;
      size: number | null;
      kind: "empty" | "normal" | "big";
      after?: "wait" | "stall";
      hold?: boolean;
    }
  /* ---- Э4: the whole chain (§8.2) ---- */
  /** E4: the height went up by two or more at once; one act instead of N. */
  | { k: "chain:catchup"; from: number; to: number; hold?: boolean }
  /** E12: the pool drained right after a seal (≤ 0.4 of what waited, ≥ 100 before). */
  | { k: "chain:drain"; height: number }
  /** E5–E7: no block for 2× (1), 3× (2) the average, or 8 min (3); 0 when a block came. */
  | { k: "chain:tip-wait"; level: 0 | 1 | 2 | 3; sinceMs: number }
  /** E10: a tx of this page's topic came to the pool (`rare`: on /mempool, a category under 2 %). */
  | { k: "chain:tx-topic"; category: string; txId: string; rare: boolean }
  /** E11: the pool surges (and calms down again). */
  | { k: "chain:pool"; state: "surge" | "calm"; count: number; base: number }
  /** E13: fees spike (p50 against its hour) and calm down again. */
  | { k: "chain:fee"; state: "spike" | "calm"; p50: number; base: number }
  /** E15: a sealed block carried oracle txs. */
  | { k: "chain:oracle"; txIds: string[]; height: number }
  /** E21: an epoch of 1024 blocks began. */
  | { k: "chain:epoch"; height: number }
  /**
   * E16–E18: the live feed. «down»: closed ≥ 6 s; «lost»: down ≥ 2 min (he stops waiting for it);
   * «offline»: the browser is offline; «live»: open again (`cheer`: after ≥ 6 s down, on onopen;
   * `missed`: blocks the tip moved meanwhile; `flapping`: more than 3 cycles in 2 min).
   */
  | { k: "net:state"; state: "live" | "down" | "lost" | "offline"; downMs: number; flapping: boolean; cheer?: boolean; missed?: number }
  /** E19: the site is behind (the index lags, the node trails its headers, no peers). */
  | { k: "site:behind"; on: boolean; lag: number | null; node: boolean; peers: boolean }
  /** E14: the ERG price moved (≥ 1 % since the last poll, or ≥ 2.5 % in 15 min). Never a mood. */
  | { k: "price:move"; usd: number; pct: number; windowMin: 1.5 | 15 }
  /* ---- Э4: what the page on screen learned, by its data (§6, §8.3) ---- */
  /** /tx: the open tx is in a block now (the page re-read and shows it). `height`: the seal's. */
  | { k: "page:tx-confirmed"; txId: string; height: number; fav?: boolean }
  /** /tx and /block: the confirmations the page shows went up to `n` with the block `height`. */
  | { k: "page:confirmations"; n: number; of: "tx" | "block"; height: number }
  /** /address: unconfirmed txs of this address (`count` 0: they went into a block). */
  | { k: "page:addr-pending"; address: string; count: number; fav?: boolean; height?: number }
  /** /address: the storage rent of this address (E23). */
  | { k: "page:rent"; address: string; tone: "due" | "soon" | "later"; blocks: number }
  /** The page re-read its data and something changed (an oracle price after a seal). */
  | { k: "page:data"; what: "oracle" | "list" | "rent"; height?: number }
  /** The page waits on the chain (a tx still in the mempool): a still think face while it lasts. */
  | { k: "page:think"; on: boolean; el?: Element | null }
  /** An empty list (FeedEmpty), «not found», an inline error (§6.1 defaults). */
  | { k: "page:empty"; el?: Element | null }
  | { k: "page:miss"; el?: Element | null }
  /** The header scout gave him the body (M1, §9.8). */
  | { k: "kayolo:took"; where: BodyWhere }
  /** He gave the body back to the header scout, from this point. */
  | { k: "kayolo:release"; x: number; y: number; face: 1 | -1; where: BodyWhere }
  /** His window while he is away: call him home. */
  | { k: "kayolo:call-home" }
  /** A click, a tap or Enter on his window. */
  | { k: "ui:poke" }
  /** The pointer rests on his window (250 ms), or it has focus. */
  | { k: "ui:notice"; on: boolean }
  /** «Погладить» in his panel. */
  | { k: "ui:pet" }
  /** The introduction is over; `tour`: it ran to the end, so the tour follows. */
  | { k: "kayolo:intro-done"; tour: boolean }
  /* ---- Э3: what the person does on the page (§6.2, §9.2). `el` is the control, read once. ---- */
  /** Text went to the clipboard (a copy button, Ctrl+C) / the clipboard refused it. */
  | { k: "ui:copy"; el?: Element | null }
  | { k: "ui:copy-fail"; el?: Element | null }
  /** A heart: saved / taken off. */
  | { k: "ui:fav-on"; el?: Element | null }
  | { k: "ui:fav-off"; el?: Element | null }
  /** A tab, a sort chip, a filter chip. */
  | { k: "ui:tab"; el?: Element | null }
  | { k: "ui:sort"; el?: Element | null; dir?: "asc" | "desc" }
  | { k: "ui:filter"; el?: Element | null }
  /** RankWindow: «Показать ещё» (more) or a step ‹ ›. */
  | { k: "ui:page"; el?: Element | null; step: "more" | "prev" | "next" }
  /** A list row opened or closed (desktop). */
  | { k: "ui:expand"; el?: Element | null; open: boolean }
  /** The search: open, typing (the field), hits (the list), no matches, a paste (found or not), closed. */
  | { k: "ui:search-open"; el?: Element | null }
  | { k: "ui:search-type"; el?: Element | null }
  | { k: "ui:search-hits"; el?: Element | null }
  | { k: "ui:search-miss"; el?: Element | null; q: string }
  | { k: "ui:search-paste"; ok: boolean; el?: Element | null }
  | { k: "ui:search-close" }
  /** A phone sheet (MoreSheet, PriceSheet, …). */
  | { k: "ui:sheet-open"; el?: Element | null }
  | { k: "ui:sheet-close" }
  /** The site's one Tip: shown over `el` (or a rect), or gone. */
  | { k: "ui:tip-open"; el?: Element | null; rect?: { left: number; top: number; width: number; height: number } }
  | { k: "ui:tip-close" }
  /** An in-page wait (the first pack of an address tab). */
  | { k: "ui:wait"; on: boolean }
  /* ---- Э3: transitions (§7.1, §7.2) ---- */
  /** A route navigation is pending (the old page stays until the new one is ready). */
  | { k: "nav:start"; to: string }
  /** The pending navigation ended: arrived, or given up after 15 s (`ok` false). */
  | { k: "nav:end"; ok: boolean }
  /** A click on a link: `go` leaves, `here` is the same URL, `aside` opens elsewhere (Ctrl/Cmd/middle). */
  | { k: "nav:click"; kind: "go" | "here" | "aside"; el?: Element | null; hop?: -1 | 1 }
  /**
   * Back (−1) or Forward (+1) to another URL (`to`, a locKey); `seen`: that page was already shown
   * in this session. The arrival counts it only when it lands on `to` (a sheet's own history entry
   * pops too, and a query the router replaced is not on the trail).
   */
  | { k: "nav:pop"; dir: -1 | 1; seen: boolean; to: string };

export const KAYOLO_EVENT = "kayolo";

/**
 * The engine loads after the page settles (§9.4, ≤ 2 s plus its chunk): what a page says about
 * itself before that (a rent beacon, a pending tx, a miss) waits here, ≤ 6 events, and the engine
 * takes them once as it starts. Nothing is kept after that.
 */
type Early = { at: number; path: string; ev: KayoloEvent };
let early: Early[] | null = [];

/** Tells whoever draws him. Does nothing on the server and never throws. */
export function say(ev: KayoloEvent): void {
  if (typeof window === "undefined") return;
  if (early && ev.k.startsWith("page:")) {
    early.push({ at: performance.now(), path: window.location.pathname, ev });
    if (early.length > 6) early.shift();
  }
  try {
    window.dispatchEvent(new CustomEvent(KAYOLO_EVENT, { detail: ev }));
  } catch {
    /* a listener failed or CustomEvent is missing: the page goes on */
  }
}

/** The page:* said before the engine listened (this path only); from now on nothing is kept. */
export function takeEarly(): { at: number; ev: KayoloEvent }[] {
  const list = early ?? [];
  early = null;
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  return list.filter((e) => e.path === path).map(({ at, ev }) => ({ at, ev }));
}

/** Listens to the bus. Returns the cleanup. */
export function onKayolo(fn: (ev: KayoloEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (e: Event) => {
    const d = (e as CustomEvent<unknown>).detail as Partial<KayoloEvent> | null;
    if (d && typeof d === "object" && typeof d.k === "string") fn(d as KayoloEvent);
  };
  window.addEventListener(KAYOLO_EVENT, handle);
  return () => window.removeEventListener(KAYOLO_EVENT, handle);
}
