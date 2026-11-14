/**
 * What a page says about its own data to Kayolo (design/brand/kayolo-life.md §6.4, §6.6, §8.3).
 * Pure: the pages call these and say the page:* they return; the tests read them. Nothing here
 * asks the network: the live numbers come from the stream tip the page already has.
 */

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
