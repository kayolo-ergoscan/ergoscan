/**
 * /transactions with machine rows folded: a pack of 25 can be 22 oracle posts and block
 * rewards, so one pack looks empty. The page keeps pulling the next pack (the same cursor
 * paging as «Показать ещё») until enough rows people made are on screen, or it has read
 * FILL_MAX_PACKS packs. Pure helpers; the view drives them one request at a time.
 */
import { isFoldedAction, type MeaningActionId } from "@ergoscan/shared";

/** Rows a page should show while machine rows are folded. */
export const FILL_ROWS = 20;
/** Packs (of TX_PACK) one page may read before it stops filling: 6 × 25 = 150 txs. */
export const FILL_MAX_PACKS = 6;

type Row = {
  id: string;
  inclusionHeight: number | null;
  index: number | null;
  meaning?: { action: MeaningActionId } | null;
};

/** A row a person made: anything that does not fold (rows without a meaning count too). */
export function isHumanRow(row: Row): boolean {
  const a = row.meaning?.action;
  return !a || !isFoldedAction(a);
}

/** Pull one more pack? Only while too few rows show, more exist, and the page has packs left. */
export function shouldFill(p: {
  visible: number;
  packs: number;
  hasMore: boolean;
  busy: boolean;
  failed: boolean;
  want?: number;
  maxPacks?: number;
}): boolean {
  if (p.busy || p.failed || !p.hasMore) return false;
  if (p.packs >= (p.maxPacks ?? FILL_MAX_PACKS)) return false;
  return p.visible < (p.want ?? FILL_ROWS);
}

/** The gateway's keyset cursor for the rows after `row`: «height:index:id». */
export function keysetAfter(row: Row): string {
  return `${row.inclusionHeight ?? -1}:${row.index ?? -1}:${row.id}`;
}

/** A pack under the page: rows already shown stay where they are, no id twice. */
export function appendPack<T extends Row>(prev: readonly T[], pack: readonly T[]): T[] {
  const seen = new Set(prev.map((r) => r.id));
  const extra = pack.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  return extra.length ? [...prev, ...extra] : [...prev];
}

/**
 * A fresh first pack on top of a filled page (a new block came): the new head, then the old
 * rows that are older than the head's last row. Null when the head does not reach the old rows
 * (more than a pack of new txs): the page then fills again from the top.
 */
export function mergeHead<T extends Row>(prev: readonly T[], head: readonly T[]): T[] | null {
  if (!head.length) return null;
  const last = head[head.length - 1]!;
  const at = prev.findIndex((r) => r.id === last.id);
  if (at < 0) return null;
  return appendPack(head, prev.slice(at + 1));
}

/**
 * Keep a page from growing block after block: the shortest head with `want` rows people made,
 * never shorter than `min` rows. Returns the rows kept and whether any were cut.
 */
export function trimToFill<T extends Row>(items: readonly T[], want = FILL_ROWS, min = 25): { rows: T[]; cut: boolean } {
  let human = 0;
  let end = items.length;
  for (let i = 0; i < items.length; i++) {
    if (isHumanRow(items[i]!)) human++;
    if (human >= want && i + 1 >= min) {
      end = i + 1;
      break;
    }
  }
  return { rows: items.slice(0, end), cut: end < items.length };
}
