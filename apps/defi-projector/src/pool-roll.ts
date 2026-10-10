import type { PoolClient } from "pg";
import type { Db } from "./db.js";
import { getState, setState } from "./db.js";

/** One-shot fold of existing swaps. Not a chain cursor. */
export const POOL_ROLL_KEY = "pool_roll_v1";
const POOL_ROLL_LOCK = 736202;
const ERG_ZERO = "0".repeat(64);

/**
 * Whole tokens. A raw amount written when decimals were unknown is at least 10^decimals.
 * Already-scaled amounts stay as they are.
 */
export function wholeTokenQty(amount: number, decimals: number | null | undefined): number {
  if (!(amount > 0) || !Number.isFinite(amount)) return 0;
  const dec = Math.max(0, Math.min(18, Math.trunc(Number(decimals) || 0)));
  if (dec > 0 && amount >= 10 ** dec) return amount / 10 ** dec;
  return amount;
}

function isWholeInteger(amount: number): boolean {
  return amount >= 1 && Math.abs(amount - Math.round(amount)) < 1e-6;
}

/** Stored as a human amount, plus the raw reading when an integer sits below 10^decimals. */
export function n2nQtyChoices(amount: number, decimals: number | null | undefined): number[] {
  const human = wholeTokenQty(amount, decimals);
  const dec = Math.max(0, Math.min(18, Math.trunc(Number(decimals) || 0)));
  if (!(dec > 0) || !isWholeInteger(amount) || !(amount < 10 ** dec)) return [human];
  const raw = amount / 10 ** dec;
  if (!(raw > 0) || !Number.isFinite(raw) || Math.abs(raw - human) < 1e-18) return [human];
  return [human, raw];
}

/**
 * Pick the scaling of each leg that makes the two ERG values agree.
 * A raw integer below 10^decimals is not a whole token: 25249041 of an
 * 8-decimal token is 0.252, and treating it as 25 million blows the volume up.
 * An exact whole amount such as 2 SigUSD stays human, because that matches the other leg.
 */
export function n2nLegs(
  qAmount: number,
  qDecimals: number | null | undefined,
  qPrice: number,
  bAmount: number,
  bDecimals: number | null | undefined,
  bPrice: number
): { q: number; b: number } {
  const qs = n2nQtyChoices(qAmount, qDecimals);
  const bs = n2nQtyChoices(bAmount, bDecimals);
  let bestQ = qs[0] ?? 0;
  let bestB = bs[0] ?? 0;
  let best = Number.POSITIVE_INFINITY;
  for (const q of qs) {
    for (const b of bs) {
      const qe = n2nQuoteErg(q, qPrice);
      const be = n2nQuoteErg(b, bPrice);
      let score = 1;
      if (qe > 0 && be > 0) score = Math.abs(qe - be) / Math.max(qe, be);
      else if (qe > 25_000 || be > 25_000) score = 1;
      else score = 0;
      if (score < best) {
        best = score;
        bestQ = q;
        bestB = b;
      }
    }
  }
  return { q: bestQ, b: bestB };
}

/** Quote leg in ERG. 0 when the price or the amount is unusable. */
export function n2nQuoteErg(qtyWhole: number, priceErg: number): number {
  if (!(qtyWhole > 0) || !(priceErg > 0) || priceErg >= 1e12 || !Number.isFinite(priceErg)) {
    return 0;
  }
  const v = qtyWhole * priceErg;
  return Number.isFinite(v) && v > 0 && v < 1e9 ? v : 0;
}

/**
 * One cap for the tape and the volume tiles.
 * Detector stores a swap up to this size (`MAX_TRADE_ERG`). The tile uses the same number.
 */
export const POOL_VOL_MAX_ERG_DEFAULT = 25_000;

export function poolVolMaxErg(
  raw: string | undefined = process.env.MAX_TRADE_ERG || process.env.RANKS_MAX_TRADE_ERG
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : POOL_VOL_MAX_ERG_DEFAULT;
}

/**
 * ERG to add to the pool's all-time volume.
 * null = not an N2T pool (do not touch vol_erg).
 * 0 = N2T fill that the Spectrum volume tile also drops.
 */
export function n2tErgVolume(
  venue: string,
  baseId: string | null | undefined,
  baseAmount: number,
  tokenAmount: number,
  maxErg: number
): number | null {
  if (String(venue || "").trim().toLowerCase() !== "spectrum_cfmm") return null;
  const base = String(baseId || "").trim().toLowerCase();
  if (base && base !== ERG_ZERO) return null;
  void maxErg;
  if (!(baseAmount > 0) || !Number.isFinite(baseAmount)) return 0;
  if (!(tokenAmount > 0)) return 0;
  return baseAmount;
}

export type PoolRollInput = {
  poolId: string;
  tokenId: string;
  venue: string;
  baseId: string;
  baseAmount: number;
  tokenAmount: number;
  tsMs: number;
};

/** Call only after a new `defi.swaps` insert. A rescan update must not call this. */
export async function applyPoolRoll(
  client: PoolClient,
  row: PoolRollInput,
  maxErg: number
): Promise<void> {
  const poolId = String(row.poolId || "").trim().toLowerCase();
  const tokenId = String(row.tokenId || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(poolId)) return;
  const vol = n2tErgVolume(row.venue, row.baseId, row.baseAmount, row.tokenAmount, maxErg);
  const ts = Number(row.tsMs);
  const tsMs = Number.isFinite(ts) && ts > 0 ? Math.trunc(ts) : null;
  const now = Date.now();
  await client.query(
    `INSERT INTO defi.pool_snap
       (pool_id, token_id, tvl_erg, volume_erg_24h, updated_at_ms,
        trades_n, vol_erg, first_ts_ms, last_ts_ms)
     VALUES ($1, $2, 0, 0, $3, 1, $4, $5, $5)
     ON CONFLICT (pool_id) DO UPDATE SET
       trades_n = COALESCE(defi.pool_snap.trades_n, 0) + 1,
       vol_erg = CASE
         WHEN $4::float8 IS NULL THEN defi.pool_snap.vol_erg
         ELSE COALESCE(defi.pool_snap.vol_erg, 0) + $4::float8
       END,
       first_ts_ms = CASE
         WHEN $5::bigint IS NULL THEN defi.pool_snap.first_ts_ms
         WHEN defi.pool_snap.first_ts_ms IS NULL THEN $5::bigint
         ELSE LEAST(defi.pool_snap.first_ts_ms, $5::bigint)
       END,
       last_ts_ms = CASE
         WHEN $5::bigint IS NULL THEN defi.pool_snap.last_ts_ms
         WHEN defi.pool_snap.last_ts_ms IS NULL THEN $5::bigint
         ELSE GREATEST(defi.pool_snap.last_ts_ms, $5::bigint)
       END`,
    [poolId, /^[0-9a-f]{64}$/.test(tokenId) ? tokenId : ERG_ZERO, now, vol, tsMs]
  );
}

/**
 * Fold swaps already in `defi.swaps` into the snap columns.
 * Runs once. Does not move scan cursors. Later fills only increment.
 */
export async function seedPoolRoll(db: Db, maxErg = poolVolMaxErg()): Promise<{ pools: number } | null> {
  const client = await db.connect();
  let locked = false;
  try {
    const lock = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS ok`,
      [POOL_ROLL_LOCK]
    );
    locked = lock.rows[0]?.ok === true;
    if (!locked) return null;
    const done = await getState(db, POOL_ROLL_KEY);
    if (done === "1") return null;

    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = 20000`);
    const wrote = await client.query(
      `WITH agg AS (
         SELECT pool_id,
                count(*)::bigint AS trades_n,
                min(ts_ms) FILTER (WHERE ts_ms > 0) AS first_ts,
                max(ts_ms) FILTER (WHERE ts_ms > 0) AS last_ts,
                min(token_id) FILTER (WHERE length(token_id) = 64) AS token_id,
                coalesce(sum(base_amount) FILTER (
                  WHERE venue = 'spectrum_cfmm'
                    AND (base_id IS NULL OR base_id = repeat('0', 64))
                    AND base_amount > 0
                    AND coalesce(token_amount, 0) > 0
                ), 0)::float8 AS vol_erg
         FROM defi.swaps
         WHERE venue IN ('spectrum_cfmm', 'spectrum_n2n')
           AND event_kind = 'swap'
         GROUP BY pool_id
       )
       INSERT INTO defi.pool_snap
         (pool_id, token_id, tvl_erg, volume_erg_24h, updated_at_ms,
          trades_n, vol_erg, first_ts_ms, last_ts_ms)
       SELECT a.pool_id,
              COALESCE(r.quote_token, a.token_id, repeat('0', 64)),
              0,
              0,
              (extract(epoch FROM now()) * 1000)::bigint,
              a.trades_n,
              CASE WHEN r.venue = 'spectrum_n2n' THEN NULL ELSE a.vol_erg END,
              a.first_ts,
              a.last_ts
       FROM agg a
       LEFT JOIN defi.pool_registry r ON r.pool_id = a.pool_id
       ON CONFLICT (pool_id) DO UPDATE SET
         trades_n = EXCLUDED.trades_n,
         vol_erg = EXCLUDED.vol_erg,
         first_ts_ms = EXCLUDED.first_ts_ms,
         last_ts_ms = EXCLUDED.last_ts_ms`
    );
    await client.query("COMMIT");
    await setState(db, POOL_ROLL_KEY, "1");
    return { pools: wrote.rowCount ?? 0 };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    if (locked) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [POOL_ROLL_LOCK]);
      } catch {
        /* ignore */
      }
    }
    client.release();
  }
}
