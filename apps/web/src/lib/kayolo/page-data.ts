/**
 * What a page says about its own data to Kayolo (design/brand/kayolo-life.md §6.4, §6.6, §8.3).
 * Pure: the pages call these and say the page:* they return; the tests read them. Nothing here
 * asks the network: the live numbers come from the stream tip the page already has.
 */

import type { OracleTx, Seal } from "./chain-sense";
import type { KayoloEvent } from "./events";
import * as K from "./thresholds";

/** A tx's confirmations by the live tip: tip − inclusion + 1, never below the snapshot's. */
export function confirmationsLive(snap: number | null, height: number | null, tip: number | null): number | null {
  if (height == null) return snap;
  const live = tip != null && tip >= height ? tip - height + 1 : null;
  if (live == null) return snap;
  return snap == null ? live : Math.max(snap, live);
}

/** A block's confirmations as /block shows them: tip − height (0 at the tip). */
export function blockConfirmations(height: number | null, tip: number | null): number | null {
  if (height == null || tip == null) return null;
  return Math.max(0, tip - height);
}

/**
 * The page:confirmations a page says when its count moved from `prev` to `n` (by data, §6.4):
 * /tx nods for 2…10 (1 is page:tx-confirmed); /block says 1 (the «›» opens), 2…10 and 720 (the
 * reward matured). Nothing on the first read, nothing when the count did not grow.
 */
export function confirmationsEvent(of: "tx" | "block", prev: number | null, n: number | null, height: number | null): KayoloEvent | null {
  if (prev == null || n == null || height == null || n <= prev) return null;
  if (of === "block" && prev < K.CONF_REWARD && n >= K.CONF_REWARD) return { k: "page:confirmations", n: K.CONF_REWARD, of, height };
  const min = of === "tx" ? 2 : 1;
  if (n < min || n > K.CONF_NODS) return null;
  return { k: "page:confirmations", n, of, height };
}

/** Will this page say a page:confirmations for the next block? (it then holds that block's E1, §2.8) */
export function confirmationsAwait(of: "tx" | "block", n: number | null): boolean {
  if (n == null) return false;
  const next = n + 1;
  if (of === "block" && next === K.CONF_REWARD) return true;
  return next >= (of === "tx" ? 2 : 1) && next <= K.CONF_NODS;
}

/**
 * Did this seal carry the tx? "maybe" when the block was not read (a partial seal, a tip standing
 * in): the page re-reads as for "yes", but the block's E1 does not wait for it.
 */
export function sealCarries(s: Pick<Seal, "txIds">, txId: string): "yes" | "maybe" | "no" {
  if (s.txIds == null) return "maybe";
  return s.txIds.includes(txId) ? "yes" : "no";
}

/**
 * /address: the pending list went from `prevIds` to `nowIds`. A nod «в блок» (§6.4) only when it is
 * empty now and every tx that left it was carried by a seal (`sealed`: tx id → its height); a tx
 * evicted or double-spent leaves the list too, and then he says nothing. The height is the newest seal's.
 */
export function pendingNod(prevIds: readonly string[], nowIds: readonly string[], sealed: ReadonlyMap<string, number>): { height: number } | null {
  if (nowIds.length || !prevIds.length) return null;
  let height = -1;
  for (const id of prevIds) {
    const h = sealed.get(id);
    if (h == null) return null;
    height = Math.max(height, h);
  }
  return { height };
}

/**
 * /tx shows the tx in block `blockId` at `height`: does this seal say that block is gone (a fork)?
 * Another real id at that height, or a replacing block below it. A partial seal without an id
 * (`height-N`) says nothing.
 */
export function sealDoubts(s: Pick<Seal, "height" | "blockId" | "replaced">, height: number, blockId: string): boolean {
  if (s.height === height) return s.blockId != null && !s.blockId.startsWith("height-") && s.blockId !== blockId;
  return s.replaced === true && s.height < height;
}

/** The tokens that name an oracle feed (`refreshNft` only on v2 pools). */
export type OracleFeedTokens = { poolNft: string; oracleToken: string; refreshNft?: string };

/**
 * E15: may the oracle txs of a seal have moved this feed's quote? "steps": a refresh of this feed
 * (it spends the pool box) — re-read with pauses. "once": an oracle tx we cannot read (no action,
 * no tokens) that may be this feed's — at most one re-read. null: datapoint posts (the quote moves
 * only on a refresh) or another feed's txs — no request.
 */
export function oracleReread(txs: readonly OracleTx[], feed: OracleFeedTokens): "steps" | "once" | null {
  const pool = [feed.poolNft, feed.refreshNft].filter((x): x is string => !!x);
  let once = false;
  for (const tx of txs) {
    const known = tx.action === "oracle-refresh" || tx.action === "oracle-datapoint";
    const tokens = tx.tokens;
    if (tx.action === "oracle-refresh") {
      if (!tokens.length || tokens.some((t) => pool.includes(t))) return "steps";
      continue;
    }
    if (known) continue;
    if (!tokens.length || tokens.some((t) => pool.includes(t) || t === feed.oracleToken)) once = true;
  }
  return once ? "once" : null;
}

const DAY_BLOCKS = 720;

/** The /address rent line (E23): due now, or minutes / hours below a day, else whole days (rounded up). */
export function rentNoteParts(blocks: number): { unit: "now" | "min" | "h" | "d"; n: number } {
  if (blocks <= 0) return { unit: "now", n: 0 };
  const min = (blocks * K.AVG_BLOCK_MS) / 60_000;
  if (min < 60) return { unit: "min", n: Math.max(1, Math.round(min)) };
  if (blocks < DAY_BLOCKS) return { unit: "h", n: Math.max(1, Math.floor(min / 60)) };
  return { unit: "d", n: Math.ceil(blocks / DAY_BLOCKS) };
}

export type RereadDeps = {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  shown: () => boolean;
  jitter: () => number;
};

const browserReread: () => RereadDeps = () => ({
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id as number),
  shown: () => document.visibilityState === "visible",
  jitter: () => Math.random() * K.REREAD_JITTER_MS,
});

/**
 * A page's re-reads after a seal (§2.8, §9.10): one chain of pauses at a time, each with 0–400 ms of
 * jitter. A hidden tab ends the chain (no request): the page's own re-read on showing (useKeepFresh)
 * reads once then.
 */
export function rereads(read: () => void, deps: RereadDeps = browserReread()) {
  let gen = 0;
  let timer: unknown = null;
  let busy = false;
  const stop = () => {
    gen += 1;
    if (timer != null) deps.clearTimer(timer);
    timer = null;
    busy = false;
  };
  const run = (k: number, my: number, pauses: readonly number[]) => {
    timer = deps.setTimer(() => {
      timer = null;
      if (my !== gen) return;
      if (!deps.shown()) {
        busy = false;
        return;
      }
      read();
      if (k + 1 < pauses.length) run(k + 1, my, pauses);
      else busy = false;
    }, pauses[k] + deps.jitter());
  };
  return {
    start(pauses: readonly number[]) {
      stop();
      if (!pauses.length) return;
      busy = true;
      run(0, gen, pauses);
    },
    stop,
    busy: () => busy,
  };
}
