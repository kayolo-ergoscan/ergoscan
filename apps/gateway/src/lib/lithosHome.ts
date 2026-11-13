/**
 * Home card «Lithos». A cut of `snapshot_kv.lithos_protocol` (stats + the find list), read by
 * primary key and held in memory for a few seconds, so a burst of home views reads the row once.
 * Null until the indexer writes `payload.stats`; the card then shows its quiet state.
 */
import { lithosHomeFromSnapshot, type LithosHome } from "@ergoscan/shared";

const TTL_MS = 15_000;

type Read = () => Promise<{ stats: unknown; finds: unknown } | null>;

export function lithosHomeCache(read: Read, now: () => number = Date.now) {
  let value: LithosHome | null = null;
  let at = -Infinity;
  let pending: Promise<LithosHome | null> | null = null;
  return {
    /** Fresh value, or the read in flight. A failed read keeps the last good value. */
    get(): Promise<LithosHome | null> {
      if (now() - at < TTL_MS) return Promise.resolve(value);
      pending ??= read()
        .then((row) => {
          const next = row ? lithosHomeFromSnapshot(row.stats, row.finds) : null;
          // A missing row or stats (indexer not restarted yet) is a real answer; an error is not.
          value = next;
          at = now();
          return value;
        })
        .catch(() => value)
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

/** SQL for the cut: one primary-key row, only `stats` and `[height, ts]` of each listed find. */
export const LITHOS_HOME_SQL = `SELECT payload->'stats' AS stats,
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(e->'height', e->'ts')), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) e) AS finds
  FROM snapshot_kv
 WHERE key = 'lithos_protocol'`;
