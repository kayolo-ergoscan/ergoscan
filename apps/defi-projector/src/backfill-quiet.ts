import type { Db } from "./db.js";
import { detectSwaps } from "./detect.js";
import { persistSwaps } from "./project.js";
import { listRegistryNfts } from "./registry.js";
import { detectT2tSwaps } from "./t2t-detect.js";
import { persistT2tSwaps } from "./t2t-project.js";
import { listT2tRegistry } from "./t2t-registry.js";

const FROM = 452_000;
const STEP = 20_000;

/**
 * Swaps and liquidity for pools that have never been scanned.
 * Does not read or write the DeFi cursors. A restart continues with whatever
 * still has no rows.
 */
export async function backfillQuietPools(db: Db): Promise<void> {
  const tipRow = await db.query<{ h: string }>(
    `SELECT value::text AS h FROM indexer_state WHERE key = 'last_height'`
  );
  const tip = Number(tipRow.rows[0]?.h || 0);
  if (!(tip > FROM)) return;
  const have = await db.query<{ pool_id: string }>(
    `SELECT DISTINCT pool_id
     FROM defi.swaps
     WHERE venue IN ('spectrum_cfmm', 'spectrum_n2n')
     UNION
     SELECT pool_id FROM defi.pool_scanned`
  );
  const seen = new Set(have.rows.map((r) => String(r.pool_id || "").toLowerCase()));
  const cfmm = (await listRegistryNfts(db)).filter((r) => !seen.has(r.poolId));
  const n2n = (await listT2tRegistry(db)).filter((r) => !seen.has(r.poolId));
  console.log(
    JSON.stringify({
      type: "quiet_backfill_start",
      cfmm: cfmm.length,
      n2n: n2n.length,
      from: FROM,
      tip,
    })
  );
  if (!cfmm.length && !n2n.length) return;
  let swaps = 0;
  for (let h = FROM; h <= tip; h += STEP) {
    const to = Math.min(tip, h + STEP - 1);
    if (cfmm.length) {
      const det = await detectSwaps(db, h, to, cfmm);
      if (det.ok && det.swaps.length) {
        const saved = await persistSwaps(db, det.swaps);
        if (saved.ok) swaps += saved.n;
      }
    }
    if (n2n.length) {
      const det = await detectT2tSwaps(db, h, to, n2n);
      if (det.ok && det.swaps.length) {
        const saved = await persistT2tSwaps(db, det.swaps);
        if (saved.ok) swaps += saved.n;
      }
    }
    if (((h - FROM) / STEP) % 5 === 0) {
      console.log(JSON.stringify({ type: "quiet_backfill", at: to, tip, swaps }));
    }
  }
  const ids = [...cfmm.map((r) => r.poolId), ...n2n.map((r) => r.poolId)];
  await db.query(
    `INSERT INTO defi.pool_scanned (pool_id, height)
     SELECT x, $2 FROM unnest($1::text[]) AS x
     ON CONFLICT (pool_id) DO UPDATE SET height = GREATEST(defi.pool_scanned.height, EXCLUDED.height)`,
    [ids, tip]
  );
  console.log(JSON.stringify({ type: "quiet_backfill_done", swaps, tip, pools: ids.length }));
}
