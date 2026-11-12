/**
 * ErgoScan oracle projector.
 *
 * Separate process. Reads public.* only. Writes oracle.*.
 * Default tip: current unspent pool + operator boxes. No history walk.
 * ORACLE_HISTORY=1 is a bounded lookback of spent pool boxes, not genesis.
 *
 * Env:
 *   DATABASE_URL
 *   ORACLE_ENABLED=0
 *   ORACLE_HISTORY=0
 *   ORACLE_HISTORY_BLOCKS=21600
 *   ORACLE_INDEXER_PAUSE_LAG=2
 *   POLL_MS=4000
 *   HEALTH_PORT=8796
 */
import { ORACLE_FEEDS, type OracleFeedSlug } from "@ergoscan/shared";
import { resolveAndWriteMarket, upsertMarketSnap } from "./cgMarket.js";
import { ADVISORY_LOCK, createPool, getState, setState, type Queryable } from "./db.js";
import { detectFeed, readMarket } from "./detect.js";
import { startHealthServer, type HealthSnap } from "./health.js";
import { advanceLastPosts } from "./last-post.js";
import { advanceLeaders } from "./leader.js";
import { persistFeed } from "./persist.js";
import {
  enabledFromEnv,
  historyEnabled,
  liveIndexerLag,
  planOracleTick,
  sameTipSkip,
  tickSleepMs,
} from "./policy.js";
import { ensureOracleSchema } from "./schema.js";

const ENABLED = enabledFromEnv(process.env.ORACLE_ENABLED);
const HISTORY = historyEnabled(process.env.ORACLE_HISTORY);
const HISTORY_BLOCKS = Number(process.env.ORACLE_HISTORY_BLOCKS || 21_600);
const PAUSE_AT = Number(process.env.ORACLE_INDEXER_PAUSE_LAG || 2);
const POLL_MS = Number(process.env.POLL_MS || 4_000);
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 8796);
const SLUGS = Object.keys(ORACLE_FEEDS) as OracleFeedSlug[];

const health: HealthSnap = {
  ok: true,
  enabled: ENABLED,
  history: HISTORY,
  mode: "idle",
  scanHeight: null,
  tipHeight: null,
  minHeight: null,
  lag: null,
  indexerLag: null,
  ticksSession: 0,
  lastScanAt: null,
  lastError: null,
};

async function chainSnap(db: Queryable): Promise<{
  tip: number;
  tipId: string;
  minH: number;
  indexerLag: number | null;
}> {
  const r = await db.query<{
    tip: number | null;
    tip_id: string | null;
    min_h: number | null;
    last_h: number | null;
    snap_lag: number | null;
  }>(
    `SELECT
       (SELECT max(height)::int FROM packed.blocks) AS tip,
       (SELECT encode(id, 'hex') FROM packed.blocks ORDER BY height DESC LIMIT 1) AS tip_id,
       COALESCE(
         (SELECT value::int FROM indexer_state WHERE key = 'min_height' LIMIT 1),
         (SELECT (payload->>'minHeight')::int FROM snapshot_kv WHERE key = 'indexer_status' LIMIT 1),
         (SELECT min(height)::int FROM packed.blocks)
       ) AS min_h,
       (SELECT value::int FROM indexer_state WHERE key = 'last_height' LIMIT 1) AS last_h,
       (SELECT (payload->>'lag')::int FROM snapshot_kv WHERE key = 'indexer_status' LIMIT 1) AS snap_lag`
  );
  const tip = Number(r.rows[0]?.tip) || 0;
  const tipId = String(r.rows[0]?.tip_id ?? "");
  const minH = Number(r.rows[0]?.min_h) || 0;
  const lastRaw = r.rows[0]?.last_h;
  const lastH = lastRaw == null ? null : Number(lastRaw);
  const snapRaw = r.rows[0]?.snap_lag;
  const snapLag = snapRaw == null ? null : Number(snapRaw);
  return { tip, tipId, minH, indexerLag: liveIndexerLag(tip, lastH, snapLag) };
}

async function loop(): Promise<void> {
  const db = createPool();
  startHealthServer(HEALTH_PORT, () => ({ ...health }));

  if (!ENABLED) {
    console.log(
      JSON.stringify({
        type: "disabled",
        hint: "ORACLE_ENABLED=1 to write oracle.*. Health on 8796. History stays off unless ORACLE_HISTORY=1.",
      })
    );
    for (;;) await new Promise((r) => setTimeout(r, 60_000));
  }

  await ensureOracleSchema(db);

  let { tip, tipId, minH, indexerLag } = await chainSnap(db);
  let lastRunKey: string | null = null;
  let lastRunAt = 0;
  let lastMode: string | null = null;
  health.tipHeight = tip;
  health.minHeight = minH;
  health.indexerLag = indexerLag;

  let cursor = Number((await getState(db, "scan_height")) || 0);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  console.log(
    JSON.stringify({
      type: "start",
      cursor,
      tip,
      history: HISTORY,
      historyBlocks: HISTORY ? HISTORY_BLOCKS : 0,
      pauseAt: PAUSE_AT,
      healthPort: HEALTH_PORT,
      feeds: SLUGS,
    })
  );

  for (;;) {
    const client = await db.connect();
    try {
      const locked = await client.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock($1) AS ok`,
        [ADVISORY_LOCK]
      );
      if (!locked.rows[0]?.ok) {
        health.mode = "tip_hold";
        health.lastError = "lock_busy";
        await new Promise((r) => setTimeout(r, POLL_MS * 2));
        continue;
      }

      ({ tip, tipId, minH, indexerLag } = await chainSnap(client));
      health.tipHeight = tip;
      health.minHeight = minH;
      health.indexerLag = indexerLag;

      const historyDone = (await getState(client, "history_done")) === "1";
      const plan = planOracleTick({
        enabled: ENABLED,
        history: HISTORY && !historyDone,
        historyBlocks: HISTORY_BLOCKS,
        cursor,
        tip,
        indexerLag,
        pauseAt: PAUSE_AT,
      });
      health.mode = plan.mode;
      health.scanHeight = cursor;
      health.lag = tip > 0 ? Math.max(0, tip - cursor) : null;
      if (plan.mode !== lastMode) {
        await setState(client, "mode", plan.mode);
        lastMode = plan.mode;
      }
      const tipKey = `${tip}:${tipId}`;
      const skip = sameTipSkip({ mode: plan.mode, tipKey, lastRunKey, lastRunAt, now: Date.now() });

      if (plan.run && !skip) {
        await resolveAndWriteMarket(client, tip);
        const market = await readMarket(client);
        let ticks = 0;
        let official: Awaited<ReturnType<typeof detectFeed>> | null = null;
        for (const slug of SLUGS) {
          const found = await detectFeed(
            client,
            slug,
            plan.includeSpent,
            plan.fromHeight,
            tip
          );
          if (slug === "ergusd") official = found;
          const persisted = await persistFeed(client, found, market, plan.nextCursor);
          ticks += persisted.ticks;
        }
        if (official?.pool) {
          await upsertMarketSnap(client, tip, {
            oracleErgUsd: official.pool.quote,
            oracleErgUsdNano: official.pool.r4Nano != null ? Number(official.pool.r4Nano) : null,
            oracleErgUsdBoxId: official.pool.boxId,
            oracleErgUsdHeight: official.pool.height,
          });
        }
        if (HISTORY && plan.includeSpent) {
          await setState(client, "history_done", "1");
        }
        try {
          const leaders = await advanceLeaders(client, tip);
          if (leaders) console.log(JSON.stringify({ type: "leader", wrote: leaders }));
        } catch (e) {
          console.error(JSON.stringify({ type: "leader_err", err: String(e).slice(0, 240) }));
        }
        try {
          const posts = await advanceLastPosts(client, tip);
          if (posts) console.log(JSON.stringify({ type: "last_post", wrote: posts }));
        } catch (e) {
          console.error(JSON.stringify({ type: "last_post_err", err: String(e).slice(0, 240) }));
        }
        cursor = plan.nextCursor;
        lastRunKey = tipKey;
        lastRunAt = Date.now();
        health.scanHeight = cursor;
        health.ticksSession += ticks;
        health.lastScanAt = Date.now();
        health.lastError = null;
        if (ticks) {
          console.log(
            JSON.stringify({
              type: "scan",
              ticks,
              cursor,
              mode: plan.mode,
              history: HISTORY,
            })
          );
        }
      }

      await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK]);
      await new Promise((r) => setTimeout(r, tickSleepMs(POLL_MS, plan.mode)));
    } catch (e) {
      health.lastError = String(e);
      health.ok = true;
      console.error(JSON.stringify({ type: "tick_err", err: String(e) }));
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK]);
      } catch {
        /* */
      }
      await new Promise((r) => setTimeout(r, POLL_MS * 2));
    } finally {
      client.release();
    }
  }
}

void loop().catch((e) => {
  console.error(JSON.stringify({ type: "fatal", err: String(e) }));
  process.exit(1);
});
