/**
 * Protocol storage-rent claims. A box was collected only when its spend has an
 * empty proof and context extension 127 (the recreated output index, zigzag).
 * The rent is input value minus that output. The collector is the P2PK that
 * took the box or kept the rent, not the block miner and not the fee script.
 */
import type pg from "pg";
import {
  RENT_SERIES_DAY_MS,
  claimsFromTx,
  fillRentWeekGaps,
  parseRentSeries,
  rollupRentSeries,
  type RentClaim,
  type RentNodeTx as NodeTx,
} from "@ergoscan/shared";

// The claim parser lives in shared: the gateway reads the same rule for the live block moment.
export { claimsFromTx, claimerAddress, decodeRentOutIndex, splitRentGap } from "@ergoscan/shared";
export type { RentClaim } from "@ergoscan/shared";

const NODE = (process.env.ERGO_NODE_URL || "http://127.0.0.1:9053").replace(/\/$/, "");
const VERIFY_KEY = "rent_claim_verify_height";
const DONE_KEY = "rent_claim_verify_done";
const TIP_BATCH = 8;
const PERIOD_FLOOR = 1_051_200;

function envInt(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}

/** History batch. The writer is off the indexer tick, so this can be wider. */
const VERIFY_BATCH = envInt("RENT_VERIFY_BATCH", 32, 64);
const FETCH_CONCURRENCY = envInt("RENT_FETCH_CONCURRENCY", 16, 16);

type Queryable = { query: pg.Pool["query"] };

/**
 * Once per process (12 Nov 2026 audit): ALTER TABLE … IF NOT EXISTS still takes an ACCESS EXCLUSIVE
 * lock on rent_collected, and CREATE INDEX IF NOT EXISTS a SHARE lock, before they find the column
 * and indexes already there. Every write paid for both and queued behind the rent page's reads.
 */
let collectorColumnReady = false;

async function ensureCollectorColumn(db: Queryable): Promise<void> {
  if (collectorColumnReady) return;
  await ensureCollectorColumnOnce(db);
  collectorColumnReady = true;
}

async function ensureCollectorColumnOnce(db: Queryable): Promise<void> {
  await db.query(`ALTER TABLE rent_collected ADD COLUMN IF NOT EXISTS collector TEXT`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS rent_collected_protocol_height_idx
      ON rent_collected (spent_height DESC, box_id DESC)
      WHERE kind = 'protocol'
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS rent_collected_guess_height_idx
      ON rent_collected (spent_height, spent_tx_id)
      WHERE kind IN ('recreate', 'taken')
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS rent_collected_spent_tx_id_idx
      ON rent_collected (spent_tx_id)
      WHERE kind = 'protocol'
  `);
}

export async function writeRentClaims(db: Queryable, rows: RentClaim[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureCollectorColumn(db);
  const r = await db.query(
    `INSERT INTO rent_collected (
       box_id, spent_tx_id, spent_height, creation_height,
       address, value_nano, rent_nano, kind, collector
     )
     SELECT u.box_id, u.spent_tx_id, u.spent_height, 0,
            NULL, u.value_nano, u.rent_nano, 'protocol', NULLIF(u.collector, '')
     FROM unnest($1::text[], $2::text[], $3::bigint[], $4::numeric[], $5::numeric[], $6::text[])
       AS u(box_id, spent_tx_id, spent_height, value_nano, rent_nano, collector)
     ON CONFLICT (box_id) DO UPDATE SET
       spent_tx_id = EXCLUDED.spent_tx_id,
       spent_height = EXCLUDED.spent_height,
       rent_nano = EXCLUDED.rent_nano,
       kind = 'protocol',
       collector = EXCLUDED.collector
     WHERE rent_collected.kind IS DISTINCT FROM 'protocol'
        OR rent_collected.rent_nano IS DISTINCT FROM EXCLUDED.rent_nano
        OR rent_collected.collector IS DISTINCT FROM EXCLUDED.collector`,
    [
      rows.map((r) => r.boxId),
      rows.map((r) => r.spentTxId),
      rows.map((r) => r.spentHeight),
      rows.map((r) => r.valueNano),
      rows.map((r) => r.rentNano),
      rows.map((r) => r.collector ?? ""),
    ]
  );
  return r.rowCount ?? 0;
}

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

async function fetchTx(id: string): Promise<NodeTx | null> {
  const res = await fetch(`${NODE}/blockchain/transaction/byId/${id}`, {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as NodeTx;
}

/** byId sometimes 404s a tx that is still in the block body. */
async function fetchTxFromBlock(height: number, id: string): Promise<NodeTx | null> {
  const at = await fetch(`${NODE}/blocks/at/${height}`, {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!at.ok) return null;
  const headers = (await at.json()) as string[];
  const headerId = headers?.[0];
  if (!headerId) return null;
  const blk = await fetch(`${NODE}/blocks/${headerId}`, {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!blk.ok) return null;
  const body = (await blk.json()) as {
    blockTransactions?: { transactions?: NodeTx[] };
  };
  const txs = body.blockTransactions?.transactions ?? [];
  return txs.find((tx) => tx.id === id) ?? null;
}

let verifying = false;
let sweptMiners = false;

async function mapPool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(n, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    })
  );
  return out;
}

/**
 * Re-check heuristic rent_collected rows against the node tx.
 * A few local GETs per tick. Drops rows that are not real claims.
 */
export async function maybeVerifyRentClaims(pool: pg.Pool): Promise<boolean> {
  if (verifying) return false;
  if (await getState(pool, DONE_KEY)) return false;
  verifying = true;
  const client = await pool.connect();
  try {
    await ensureCollectorColumn(client);
    if (!sweptMiners) {
      await client.query(
        `UPDATE rent_collected SET kind = 'recreate'
         WHERE kind = 'protocol' AND collector LIKE '88%'`
      );
      sweptMiners = true;
    }
    const lastH = Number((await getState(client, "last_height")) || 0);
    const tipSeen = Number((await getState(client, "tip_seen")) || lastH);
    if (!lastH || tipSeen - lastH > 2) return false;

    let height = Number((await getState(client, VERIFY_KEY)) || PERIOD_FLOOR);
    if (!Number.isFinite(height) || height < PERIOD_FLOOR) height = PERIOD_FLOOR;

    const pending = await client.query<{ spent_tx_id: string; spent_height: string }>(
      `SELECT spent_tx_id, MIN(spent_height)::text AS spent_height
       FROM rent_collected
       WHERE kind IN ('recreate', 'taken')
         AND spent_height >= $1
       GROUP BY spent_tx_id
       ORDER BY MIN(spent_height), spent_tx_id
       LIMIT $2`,
      [height, VERIFY_BATCH]
    );
    if (!pending.rows.length) {
      const tot = await client.query<{ n: string; nano: string; h: string | null }>(
        `SELECT COUNT(*)::text AS n,
                COALESCE(SUM(rent_nano), 0)::text AS nano,
                MAX(spent_height)::text AS h
         FROM rent_collected WHERE kind = 'protocol'`
      );
      const bins = await client.query<{ t: string; boxes: number; rent_nano: string }>(
        `SELECT ((bl.timestamp_ms / $1) * $1)::bigint::text AS t,
                COUNT(*)::int AS boxes,
                SUM(rc.rent_nano)::text AS rent_nano
         FROM rent_collected rc
         JOIN packed.blocks bl ON bl.height = rc.spent_height
         WHERE rc.kind = 'protocol'
         GROUP BY 1
         ORDER BY 1`,
        [RENT_SERIES_DAY_MS]
      );
      const daily = parseRentSeries(
        bins.rows.map((bin) => ({
          t: Number(bin.t),
          boxes: bin.boxes,
          rentNano: bin.rent_nano,
        }))
      );
      const row = tot.rows[0];
      const lastHeight = Number(row?.h || 0);
      await client.query(
        `INSERT INTO snapshot_kv (key, payload, height, updated_at)
         VALUES ('rent_history', $1::jsonb, $2, now())
         ON CONFLICT (key) DO UPDATE SET
           payload = EXCLUDED.payload,
           height = EXCLUDED.height,
           updated_at = now()`,
        [
          JSON.stringify({
            boxCount: Number(row?.n || 0),
            rentNano: row?.nano || "0",
            lastHeight,
            daily,
            series: fillRentWeekGaps(rollupRentSeries(daily, "week")),
            hourly: [],
          }),
          lastHeight,
        ]
      );
      await setState(client, DONE_KEY, String(Date.now()));
      console.log(`[indexer] rent claims verified n=${row?.n || 0}`);
      return false;
    }

    let kept = 0;
    let dropped = 0;
    const fetched = await mapPool(pending.rows, FETCH_CONCURRENCY, async (row) => ({
      row,
      tx: await fetchTx(row.spent_tx_id),
    }));
    await client.query("BEGIN");
    for (const { row, tx } of fetched) {
      const spentHeight = Number(row.spent_height);
      if (!tx) {
        await client.query(
          `UPDATE rent_collected SET kind = 'miss'
           WHERE spent_tx_id = $1 AND kind IN ('recreate', 'taken')`,
          [row.spent_tx_id]
        );
        continue;
      }
      const claims = claimsFromTx(tx, spentHeight);
      const claimIds = new Set(claims.map((c) => c.boxId));
      if (claims.length) kept += await writeRentClaims(client, claims);
      const del = await client.query(
        `DELETE FROM rent_collected
         WHERE spent_tx_id = $1
           AND kind IS DISTINCT FROM 'protocol'
           AND NOT (box_id = ANY($2::text[]))`,
        [row.spent_tx_id, [...claimIds]]
      );
      dropped += del.rowCount ?? 0;
    }
    const nextH = Number(pending.rows[pending.rows.length - 1]?.spent_height);
    if (Number.isFinite(nextH)) await setState(client, VERIFY_KEY, String(nextH));
    await client.query("COMMIT");
    if (kept || dropped) {
      console.log(`[indexer] rent claims h>=${height} kept=${kept} drop=${dropped}`);
    }
    return true;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] rent claims", String(e));
    return false;
  } finally {
    client.release();
    verifying = false;
  }
}

/** Tip collections the height writer did not store. Own cursor, does not move the history one. */
export const RENT_LIVE_KEY = "rent_claim_live_height";
const LIVE_WINDOW = 720;

let following = false;

export async function maybeFollowRentTip(pool: pg.Pool): Promise<boolean> {
  if (following) return false;
  following = true;
  const client = await pool.connect();
  try {
    const lastH = Number((await getState(client, "last_height")) || 0);
    const tipSeen = Number((await getState(client, "tip_seen")) || lastH);
    if (!lastH || tipSeen - lastH > 2) return false;
    const stop = lastH - 1;
    let cursor = Number((await getState(client, RENT_LIVE_KEY)) || "");
    if (!Number.isFinite(cursor) || cursor <= 0) {
      const seed = await client.query<{ h: string }>(
        `SELECT COALESCE(MAX(spent_height), 0)::text AS h
         FROM rent_collected
         WHERE kind IN ('recreate', 'taken')`
      );
      cursor = Number(seed.rows[0]?.h || 0);
      if (!Number.isFinite(cursor) || cursor <= 0) cursor = PERIOD_FLOOR;
    }
    if (cursor >= stop) return false;
    const hi = Math.min(stop, cursor + LIVE_WINDOW);
    const found = await client.query<{ spent_tx_id: string; spent_height: string }>(
      `SELECT encode(b.spent_tx_id, 'hex') AS spent_tx_id,
              MIN(b.spent_height)::text AS spent_height
       FROM packed.boxes b
       WHERE b.spent_tx_id IS NOT NULL
         AND b.creation_height IS NOT NULL
         AND b.spent_height > $1
         AND b.spent_height <= $2
         AND b.spent_height - b.creation_height >= $3
       GROUP BY b.spent_tx_id
       ORDER BY MIN(b.spent_height), encode(b.spent_tx_id, 'hex')
       LIMIT $4`,
      [cursor, hi, PERIOD_FLOOR, TIP_BATCH]
    );
    if (!found.rows.length) {
      await setState(client, RENT_LIVE_KEY, String(hi));
      return hi < stop;
    }
    const ids = found.rows.map((r) => r.spent_tx_id);
    const have = await client.query<{ spent_tx_id: string }>(
      `SELECT DISTINCT spent_tx_id
       FROM rent_collected
       WHERE kind = 'protocol' AND spent_tx_id = ANY($1::text[])`,
      [ids]
    );
    const seen = new Set(have.rows.map((r) => r.spent_tx_id));
    let kept = 0;
    for (const row of found.rows) {
      if (seen.has(row.spent_tx_id)) continue;
      const tx = await fetchTx(row.spent_tx_id);
      if (!tx) continue;
      const claims = claimsFromTx(tx, Number(row.spent_height));
      if (claims.length) kept += await writeRentClaims(client, claims);
    }
    const nextH = Number(found.rows[found.rows.length - 1]?.spent_height);
    if (Number.isFinite(nextH)) await setState(client, RENT_LIVE_KEY, String(nextH));
    if (kept) console.log(`[rent-writer] tip h>=${cursor} kept=${kept}`);
    return true;
  } catch (e) {
    console.warn("[rent-writer] tip", String(e));
    return false;
  } finally {
    client.release();
    following = false;
  }
}

/**
 * Aged spends the guess pass never stored. Own cursor. Does not move
 * rent_claim_verify_height or rent_claim_live_height.
 * One height window per call: list from the spent-height index, skip txs
 * already protocol, then 16 local GETs. Cursor moves only after the window commits.
 */
export const RENT_FULL_HEIGHT_KEY = "rent_claim_full_height";
export const RENT_FULL_TX_KEY = "rent_claim_full_tx";
const FULL_WINDOW = 7200;

let scanning = false;

export async function maybeScanRentFull(pool: pg.Pool): Promise<boolean> {
  if (scanning) return false;
  if (!(await getState(pool, DONE_KEY))) return false;
  scanning = true;
  const client = await pool.connect();
  let held = true;
  const drop = () => {
    if (!held) return;
    held = false;
    client.release();
  };
  try {
    const lastH = Number((await getState(client, "last_height")) || 0);
    const tipSeen = Number((await getState(client, "tip_seen")) || lastH);
    if (!lastH || tipSeen - lastH > 2) return false;
    const stop = lastH - 1;
    let cursorH = Number((await getState(client, RENT_FULL_HEIGHT_KEY)) || "");
    if (!Number.isFinite(cursorH) || cursorH <= 0) cursorH = PERIOD_FLOOR - 1;
    if (cursorH >= stop) return false;
    const hi = Math.min(stop, cursorH + FULL_WINDOW);

    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query("SET LOCAL jit = off");
    await client.query("SET LOCAL max_parallel_workers_per_gather = 0");
    const found = await client.query<{ spent_tx_id: string; spent_height: string }>(
      `SELECT encode(b.spent_tx_id, 'hex') AS spent_tx_id,
              MIN(b.spent_height)::text AS spent_height
       FROM packed.boxes b
       WHERE b.spent_tx_id IS NOT NULL
         AND b.creation_height IS NOT NULL
         AND b.spent_height > $1
         AND b.spent_height <= $2
         AND b.spent_height - b.creation_height >= $3
       GROUP BY b.spent_tx_id
       ORDER BY MIN(b.spent_height), encode(b.spent_tx_id, 'hex')`,
      [cursorH, hi, PERIOD_FLOOR]
    );
    await client.query("COMMIT");

    if (!found.rows.length) {
      await setState(client, RENT_FULL_HEIGHT_KEY, String(hi));
      await setState(client, RENT_FULL_TX_KEY, "");
      console.log(`[rent-writer] full jump ${hi}`);
      return hi < stop;
    }

    const ids = found.rows.map((row) => row.spent_tx_id);
    const open = await client.query<{ spent_tx_id: string }>(
      `SELECT encode(b.spent_tx_id, 'hex') AS spent_tx_id
       FROM packed.boxes b
       WHERE b.spent_tx_id IN (
               SELECT decode(lower(x), 'hex')
               FROM unnest($1::text[]) AS x
               WHERE x ~ '^[0-9a-fA-F]{64}$'
             )
         AND b.creation_height IS NOT NULL
         AND b.spent_height - b.creation_height >= $2
         AND NOT EXISTS (
           SELECT 1 FROM rent_collected r
           WHERE r.kind = 'protocol' AND r.box_id = encode(b.box_id, 'hex')
         )
       GROUP BY b.spent_tx_id`,
      [ids, PERIOD_FLOOR]
    );
    const todoIds = new Set(open.rows.map((row) => row.spent_tx_id));
    const todo = found.rows.filter((row) => todoIds.has(row.spent_tx_id));
    const skipped = ids.length - todo.length;
    drop();

    const fetched = await mapPool(todo, FETCH_CONCURRENCY, async (row) => {
      const id = row.spent_tx_id;
      const height = Number(row.spent_height);
      let tx: NodeTx | null = null;
      try {
        tx = await fetchTx(id);
      } catch {
        tx = null;
      }
      if (!tx) {
        try {
          tx = await fetchTxFromBlock(height, id);
        } catch {
          tx = null;
        }
      }
      return { row, tx };
    });
    const missed = fetched.filter((item) => !item.tx);
    if (missed.length) {
      console.warn(
        `[rent-writer] full skip ${missed.map((item) => item.row.spent_tx_id).join(",")}`
      );
    }

    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      let kept = 0;
      for (const { row, tx } of fetched) {
        if (!tx) continue;
        const claims = claimsFromTx(tx, Number(row.spent_height));
        if (claims.length) kept += await writeRentClaims(writer, claims);
      }
      await setState(writer, RENT_FULL_HEIGHT_KEY, String(hi));
      await setState(writer, RENT_FULL_TX_KEY, "");
      await writer.query("COMMIT");
      console.log(
        `[rent-writer] full h>${cursorH}..${hi} txs=${ids.length} skip=${skipped} kept=${kept}`
      );
      return hi < stop;
    } catch (e) {
      try {
        await writer.query("ROLLBACK");
      } catch {
        /* */
      }
      throw e;
    } finally {
      writer.release();
    }
  } catch (e) {
    if (held) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* */
      }
    }
    console.warn("[rent-writer] full", String(e));
    return false;
  } finally {
    scanning = false;
    drop();
  }
}
