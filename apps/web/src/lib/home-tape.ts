/**
 * The home block tape: the newest blocks, from the snapshot, the chain tip and the live seals.
 * One row per height; a row for the same block fills in what it lacks, a row for another block at
 * that height (a fork switch) replaces it whole.
 */

export type BlockRow = {
  id: string;
  height: number;
  timestamp: number;
  txCount: number | null;
  size: number;
  color?: string | null;
  /** True when this block was mined with Lithos. Omitted until the snapshot says so. */
  lithos?: boolean;
  /** Snapshot extras, read by the tower tip and its flag. A live seal has none. */
  minerName?: string | null;
  minerAddress?: string | null;
  feeNano?: string | number | null;
  /** When the gateway saw this block (its clock, ms): a live seal has it, the snapshot does not. */
  seenAt?: number | null;
};

/** A real block id (a seal without one stands in as `seal-<height>`, shorter). */
function realId(id: string): boolean {
  return id.length >= 16;
}

/** `row` into the tape, newest first, at most `keep` rows. */
export function mergeBlockRow(prev: BlockRow[], row: BlockRow, keep: number): BlockRow[] {
  if (!row.id || !Number.isFinite(row.height)) return prev;
  const i = prev.findIndex((b) => b.id === row.id || b.height === row.height);
  const stub = !(row.size > 0) && row.txCount == null;
  const done = (next: BlockRow[]) => next.sort((a, b) => b.height - a.height).slice(0, keep);
  if (i < 0) return done([row, ...prev]);
  const old = prev[i]!;
  // Another block at this height: its miner, fees, colour, Lithos mark and counts are not the old one's.
  const other = realId(row.id) && realId(old.id) && row.id !== old.id;
  if (other) {
    const next = prev.slice();
    next[i] = {
      id: row.id,
      height: row.height,
      timestamp: row.timestamp > 0 ? row.timestamp : old.timestamp,
      txCount: row.txCount,
      size: row.size > 0 ? row.size : 0,
      color: row.color ?? null,
      lithos: row.lithos,
      minerName: row.minerName ?? null,
      minerAddress: row.minerAddress ?? null,
      feeNano: row.feeNano ?? null,
      seenAt: row.seenAt ?? null,
    };
    return done(next);
  }
  if (stub) {
    if (realId(row.id) && row.id !== old.id) {
      // The real id for a row that had none (`seal-<height>`).
      const next = prev.slice();
      next[i] = { ...old, id: row.id, seenAt: row.seenAt ?? old.seenAt };
      return done(next);
    }
    return prev;
  }
  const next = prev.slice();
  next[i] = {
    id: realId(row.id) ? row.id : old.id,
    height: row.height,
    timestamp: row.timestamp > 0 ? row.timestamp : old.timestamp,
    txCount: row.txCount != null ? row.txCount : old.txCount,
    size: row.size > 0 ? row.size : old.size,
    color: row.color || old.color,
    lithos: row.lithos === true || (row.lithos == null && old.lithos === true),
    minerName: row.minerName || old.minerName,
    minerAddress: row.minerAddress || old.minerAddress,
    feeNano: row.feeNano || old.feeNano,
    seenAt: row.seenAt ?? old.seenAt,
  };
  return done(next);
}

export function mergeBlockRows(prev: BlockRow[], incoming: readonly BlockRow[], keep: number): BlockRow[] {
  let next = prev;
  for (const row of incoming) next = mergeBlockRow(next, row, keep);
  return next;
}

/**
 * «Forming since» after a seal the page sees, or null to leave it as it is.
 *
 * A seal restarts it when it brings a new height: above the tape's top (as it was before the seal),
 * or the top's own block (the snapshot had it first). Another block at the top's height is a fork
 * switch, also when it is the first seal the page sees: «forming since» keeps what it showed (`shown`).
 * `seenMs`: the seal's sighting on this browser's clock.
 */
export function formingAfterSeal(
  s: { height: number; blockId: string },
  top: Pick<BlockRow, "id" | "height"> | undefined,
  seenMs: number,
  shown: number | null
): { height: number; at: number } | null {
  if (!top || s.height > top.height || (s.height === top.height && s.blockId === top.id)) {
    return { height: s.height, at: seenMs };
  }
  if (s.height === top.height && shown != null) return { height: s.height, at: shown };
  return null;
}
