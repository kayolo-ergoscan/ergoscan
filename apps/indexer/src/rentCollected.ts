/**
 * Historical storage-rent collections. Writer only.
 *
 * We do not have input context-extension 127. Heuristic:
 *   spent age >= 1_051_200 AND
 *     (same-tree box recreated in the spend tx with lower value
 *      OR value <= estimated rent — miner took the box).
 * Ordinary owner spends of old boxes are skipped.
 *
 * GET never scans boxes. Totals + daily/weekly series live in snapshot_kv.rent_history.
 */
import type pg from "pg";
import {
  RENT_SERIES_DAY_MS,
  RENT_SERIES_HOUR_MS,
  fillRentWeekGaps,
  keepRecentRentHours,
  parseRentSeries,
  rollupRentSeries,
  type RentSeriesPoint,
} from "@ergoscan/shared";

const PERIOD = 1_051_200;
const FEE = 1_250_000;
const HEIGHT_KEY = "rent_collected_height";
const N_KEY = "rent_collected_n";
const NANO_KEY = "rent_collected_nano";
const SNAP_KEY = "rent_history";
const FIRST_SPEND = PERIOD;
const TIP_UNWIND = 32;
const LAG_SKIP = 8;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const ENABLED =
  process.env.RENT_COLLECTED === "1" || process.env.RENT_COLLECTED === "true";
const SPAN = Math.max(50, Math.min(2000, envInt("RENT_COLLECTED_SPAN", 400)));
const TIMEOUT_MS = Math.max(
  4000,
  Math.min(30_000, envInt("RENT_COLLECTED_TIMEOUT_MS", 20_000))
);

type Queryable = { query: pg.Pool["query"] };

let running = false;
let schemaReady = false;

async function getState(db: Queryable, key: string): Promise<string | null> {
  const r = await db.query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = $1`,
    [key]
  );
  return r.rows[0]?.value ?? null;
}

async function setState(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO indexer_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

async function ensureSchema(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS rent_collected (
      box_id          TEXT PRIMARY KEY,
      spent_tx_id     TEXT NOT NULL,
      spent_height    BIGINT NOT NULL,
      creation_height BIGINT NOT NULL,
      address         TEXT,
      value_nano      NUMERIC NOT NULL,
      rent_nano       NUMERIC NOT NULL,
      kind            TEXT NOT NULL
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS rent_collected_spent_height_idx
      ON rent_collected (spent_height DESC)
  `);
}

async function readHistoryBins(db: Queryable): Promise<{
  series: RentSeriesPoint[];
  daily: RentSeriesPoint[];
  hourly: RentSeriesPoint[];
}> {
  const r = await db.query<{
    payload: { series?: unknown; daily?: unknown; hourly?: unknown };
  }>(`SELECT payload FROM snapshot_kv WHERE key = $1`, [SNAP_KEY]);
  return {
    series: parseRentSeries(r.rows[0]?.payload?.series),
    daily: parseRentSeries(r.rows[0]?.payload?.daily),
    hourly: parseRentSeries(r.rows[0]?.payload?.hourly),
  };
}

async function loadFullSeries(db: Queryable, binMs: number): Promise<RentSeriesPoint[]> {
  const r = await db.query<{ t: string; boxes: number; rent_nano: string }>(
    `SELECT ((bl.timestamp_ms / $1) * $1)::bigint::text AS t,
            COUNT(*)::int AS boxes,
            SUM(rc.rent_nano)::text AS rent_nano
     FROM rent_collected rc
     JOIN packed.blocks bl ON bl.height = rc.spent_height
       AND rc.kind = 'protocol'
     GROUP BY 1
     ORDER BY 1`,
    [binMs]
  );
  return parseRentSeries(
    r.rows.map((row) => ({
      t: Number(row.t),
      boxes: row.boxes,
      rentNano: row.rent_nano,
    }))
  );
}

async function loadHourlySeries(db: Queryable): Promise<RentSeriesPoint[]> {
  const since = Date.now() - 7 * RENT_SERIES_DAY_MS;
  const r = await db.query<{ t: string; boxes: number; rent_nano: string }>(
    `SELECT ((bl.timestamp_ms / $1) * $1)::bigint::text AS t,
            COUNT(*)::int AS boxes,
            SUM(rc.rent_nano)::text AS rent_nano
     FROM rent_collected rc
     JOIN packed.blocks bl ON bl.height = rc.spent_height
       AND rc.kind = 'protocol'
     WHERE bl.timestamp_ms >= $2
     GROUP BY 1
     ORDER BY 1`,
    [RENT_SERIES_HOUR_MS, since]
  );
  return keepRecentRentHours(
    parseRentSeries(
      r.rows.map((row) => ({
        t: Number(row.t),
        boxes: row.boxes,
        rentNano: row.rent_nano,
      }))
    )
  );
}

async function writeHistorySnap(
  db: Queryable,
  lastHeight: number,
  series: RentSeriesPoint[],
  daily: RentSeriesPoint[],
  hourly: RentSeriesPoint[]
): Promise<void> {
  const n = Number((await getState(db, N_KEY)) || 0) || 0;
  const nano = (await getState(db, NANO_KEY)) || "0";
  await db.query(
    `INSERT INTO snapshot_kv (key, payload, height, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET
       payload = EXCLUDED.payload,
       height = EXCLUDED.height,
       updated_at = now()`,
    [
      SNAP_KEY,
      JSON.stringify({
        boxCount: n,
        rentNano: nano,
        lastHeight,
        series,
        daily,
        hourly,
      }),
      lastHeight,
    ]
  );
}

/**
 * The seed above and the claim verify pass each write the series once. New protocol claims
 * keep landing in rent_collected (rent writer, tip and full scan), so the rent writer rebuilds
 * the series from them every few minutes: one daily and one 7-day hourly aggregate, the same
 * snapshot row updated in place. `lastHeight` is the height both claim scans have passed.
 */
export const RENT_SERIES_REFRESH_MS = 10 * 60_000;
let refreshedAt = 0;
let refreshing = false;

export async function maybeRefreshRentHistory(pool: pg.Pool, now = Date.now()): Promise<boolean> {
  if (refreshing || now - refreshedAt < RENT_SERIES_REFRESH_MS) return false;
  refreshing = true;
  // A failed run waits for the next window too: no tight retry loop against the database.
  refreshedAt = now;
  const client = await pool.connect();
  try {
    const live = Number((await getState(client, "rent_claim_live_height")) || 0);
    const full = Number((await getState(client, "rent_claim_full_height")) || 0);
    const scanned = live && full ? Math.min(live, full) : live || full;
    if (!scanned) return false;
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    const daily = await loadFullSeries(client, RENT_SERIES_DAY_MS);
    const series = fillRentWeekGaps(rollupRentSeries(daily, "week"));
    const hourly = await loadHourlySeries(client);
    if (daily.length < 2 || series.length < 2) {
      await client.query("ROLLBACK");
      return false;
    }
    await writeHistorySnap(client, scanned, series, daily, hourly);
    await client.query("COMMIT");
    console.log(
      `[rent-writer] rent series h=${scanned} days=${daily.length} weeks=${series.length} hours=${hourly.length}`
    );
    return true;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[rent-writer] rent series", String(e));
    return false;
  } finally {
    client.release();
    refreshing = false;
  }
}

export async function maybeBackfillRentCollected(pool: pg.Pool): Promise<boolean> {
  if (!ENABLED || running) return false;
  running = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    if (!schemaReady) {
      await ensureSchema(client);
      schemaReady = true;
    }
    const lastH = Number((await getState(client, "last_height")) || 0);
    const tipSeen = Number((await getState(client, "tip_seen")) || lastH);
    if (!lastH) return false;
    if (tipSeen - lastH > LAG_SKIP) return false;
    const stopAt = lastH - TIP_UNWIND;
    if (stopAt < FIRST_SPEND) return false;

    const prev = Number((await getState(client, HEIGHT_KEY)) || FIRST_SPEND - 1);
    const lo = Math.max(FIRST_SPEND, prev + 1);
    if (lo > stopAt) {
      const have = await readHistoryBins(client);
      if (have.series.length >= 2 && have.daily.length >= 2 && have.hourly.length >= 2) {
        return false;
      }
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
        const daily =
          have.daily.length >= 2 ? have.daily : await loadFullSeries(client, RENT_SERIES_DAY_MS);
        const series =
          have.series.length >= 2
            ? have.series
            : fillRentWeekGaps(rollupRentSeries(daily, "week"));
        const hourly =
          have.hourly.length >= 2 ? have.hourly : await loadHourlySeries(client);
        if (series.length >= 2) {
          await writeHistorySnap(client, prev, series, daily, hourly);
          await client.query("COMMIT");
          console.log(
            `[indexer] rent series seed weeks=${series.length} days=${daily.length} hours=${hourly.length}`
          );
        } else {
          await client.query("ROLLBACK");
        }
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* */
        }
        console.warn("[indexer] rent series seed", String(e));
      }
      return false;
    }
    const hi = Math.min(lo + SPAN - 1, stopAt);
    // Protocol claims are written in rentClaim.ts. Do not insert the guess.
    await setState(client, HEIGHT_KEY, String(hi));
    return false;

  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] rent collected", String(e));
    return false;
  } finally {
    client.release();
    running = false;
  }
}
