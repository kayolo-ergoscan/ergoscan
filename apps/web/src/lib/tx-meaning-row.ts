/**
 * Tx list rows from the gateway's `meaning` (list form). The words come from the shared module
 * (meaningRow, sayMeaning, MEANING_VOCAB); this file only maps an action to a tile and folds
 * machine rows on a busy list.
 */
import {
  MEANING_VOCAB,
  compactMeaning,
  isFoldedAction,
  type CompactMeaning,
  type MeaningActionId,
  type TxMeaning,
} from "@ergoscan/shared";
import type { FeedKind } from "@/components/feed/Feed";
import type { FeedGlyphId } from "@/components/feed/FeedGlyph";

function isAction(x: unknown): x is MeaningActionId {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(MEANING_VOCAB, x);
}

/**
 * The gateway's `meaning`: the list form on lists, the full form on a tx endpoint (favorites
 * read those). Anything else is dropped and the row keeps today's look.
 */
export function parseMeaning(raw: unknown): CompactMeaning | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  if (!isAction(m.action) || typeof m.v !== "number") return undefined;
  const full = m.say != null && typeof m.fee === "object" && Array.isArray(m.why);
  if (full) {
    try {
      return compactMeaning(m as unknown as TxMeaning);
    } catch {
      return undefined;
    }
  }
  return m as unknown as CompactMeaning;
}

const TILE: Record<MeaningActionId, [FeedKind, FeedGlyphId]> = {
  send: ["transfer", "transfer"],
  multisend: ["transfer", "out"],
  self: ["quiet", "self"],
  consolidate: ["quiet", "merge"],
  "block-reward": ["reward", "reward"],
  "fee-collect": ["reward", "fee"],
  "miner-payout": ["reward", "reward"],
  rent: ["rent", "rent"],
  "token-issue": ["token", "mint"],
  "nft-mint": ["nft", "nft"],
  burn: ["token", "burn"],
  "name-register": ["nft", "name"],
  swap: ["defi", "swap"],
  "order-place": ["defi", "order"],
  "order-cancel": ["defi", "cancel"],
  "lp-add": ["defi", "pool"],
  "lp-remove": ["defi", "pool"],
  "pool-create": ["defi", "pool"],
  "stable-mint": ["defi", "stable"],
  "stable-redeem": ["defi", "stable"],
  loan: ["defi", "defi"],
  "loan-repay": ["defi", "defi"],
  stake: ["defi", "in"],
  unstake: ["defi", "out"],
  payout: ["defi", "in"],
  auction: ["defi", "hammer"],
  "bridge-out": ["bridge", "bridge"],
  "bridge-in": ["bridge", "bridge"],
  mix: ["mixer", "mixer"],
  "oracle-post": ["oracle", "oracle"],
  "oracle-update": ["oracle", "oracle"],
  service: ["quiet", "protocol"],
  "contract-call": ["contract", "contract"],
  "to-contract": ["contract", "contract"],
};

/** Tile colour from the action's family (look-C tokens), glyph from the action. */
export function meaningTile(m: Pick<CompactMeaning, "action" | "protocol" | "conf">): [FeedKind, FeedGlyphId] {
  if (m.conf === "unknown") return ["contract", "contract"];
  if (m.action === "service" && m.protocol === "oracle") return ["oracle", "oracle"];
  return TILE[m.action] ?? ["quiet", "none"];
}

/** One summary row standing for a day's machine rows: «Служебные: 23 · Цена от оракула ×14 …». */
export type TxFold<T> = {
  fold: true;
  key: string;
  day: string;
  rows: T[];
  /** Actions by count, most first; ties keep the vocabulary order. */
  counts: Array<[MeaningActionId, number]>;
  open: boolean;
};

export function isTxFold<T>(x: T | TxFold<T>): x is TxFold<T> {
  return typeof x === "object" && x != null && (x as { fold?: unknown }).fold === true && "rows" in (x as object);
}

/**
 * Per day group: when `min` or more rows fold, they give way to one summary row placed where
 * the newest of them was. Open, the summary stays (with «скрыть») and every row is back in place.
 */
export function foldServiceRows<T>(
  items: readonly T[],
  o: {
    dayOf: (item: T) => string;
    actionOf: (item: T) => MeaningActionId | null | undefined;
    isOpen: (day: string) => boolean;
    min?: number;
  }
): Array<T | TxFold<T>> {
  const min = o.min ?? 2;
  const byDay = new Map<string, T[]>();
  for (const it of items) {
    const a = o.actionOf(it);
    if (!a || !isFoldedAction(a)) continue;
    const d = o.dayOf(it);
    const list = byDay.get(d) ?? [];
    list.push(it);
    byDay.set(d, list);
  }
  const folds = new Map<string, TxFold<T>>();
  for (const [day, rows] of byDay) {
    if (rows.length < min) continue;
    const tally = new Map<MeaningActionId, number>();
    for (const r of rows) {
      const a = o.actionOf(r)!;
      tally.set(a, (tally.get(a) ?? 0) + 1);
    }
    const order = Object.keys(MEANING_VOCAB) as MeaningActionId[];
    const counts = [...tally].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
    folds.set(day, { fold: true, key: `fold:${day}`, day, rows, counts, open: o.isOpen(day) });
  }
  const out: Array<T | TxFold<T>> = [];
  const placed = new Set<string>();
  for (const it of items) {
    const a = o.actionOf(it);
    const day = a && isFoldedAction(a) ? o.dayOf(it) : null;
    const f = day != null ? folds.get(day) : undefined;
    if (!f) {
      out.push(it);
      continue;
    }
    if (!placed.has(f.day)) {
      placed.add(f.day);
      out.push(f);
    }
    if (f.open) out.push(it);
  }
  return out;
}
