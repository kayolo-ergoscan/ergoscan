/**
 * Box page: what the tx that made the box did, and what the tx that spent it did,
 * in the list form (the same meaning a tx list row carries). Additive: a meaning we
 * do not have is left out; the page then shows the tx id alone.
 */
import type { CompactMeaning } from "@ergoscan/shared";

export type BoxMeaningFields = {
  creationMeaning?: CompactMeaning;
  spentMeaning?: CompactMeaning;
};

/** The box page waits for its own data, not for a slow meaning; a late one still lands in the LRU. */
export const BOX_MEANING_WAIT_MS = 1500;

type Loader = (ids: string[]) => Promise<ReadonlyMap<string, CompactMeaning>>;

const EMPTY: ReadonlyMap<string, CompactMeaning> = new Map();

/** One list-cost read for both txs; a failure or a slow read gives no meanings. */
export async function loadBoxMeanings(
  creationTxId: string | null | undefined,
  spentTxId: string | null | undefined,
  load: Loader,
  waitMs = BOX_MEANING_WAIT_MS
): Promise<ReadonlyMap<string, CompactMeaning>> {
  const ids = [...new Set([creationTxId, spentTxId].filter((x): x is string => !!x))];
  if (!ids.length) return EMPTY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ReadonlyMap<string, CompactMeaning>>((resolve) => {
    timer = setTimeout(() => resolve(EMPTY), waitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([load(ids).catch(() => EMPTY), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function boxMeaningFields(
  meanings: ReadonlyMap<string, CompactMeaning>,
  creationTxId: string | null | undefined,
  spentTxId: string | null | undefined
): BoxMeaningFields {
  const pick = (id: string | null | undefined) =>
    id ? (meanings.get(id) ?? meanings.get(id.toLowerCase())) : undefined;
  const made = pick(creationTxId);
  const spent = pick(spentTxId);
  return {
    ...(made ? { creationMeaning: made } : {}),
    ...(spent ? { spentMeaning: spent } : {}),
  };
}
