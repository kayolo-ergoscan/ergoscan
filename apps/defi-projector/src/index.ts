/**
 * ErgoScan DeFi projector — one Spectrum tip writer (N2T + T2T).
 *
 * Separate process from the chain indexer. Reads explorer PG only (no node GET).
 * Writes defi.pool_registry, defi.swaps, projects into defi.trades (source=projector),
 * refreshes ranks_cache / pool_snap / price_tick / pool_tick. AgeUSD bank is denylisted.
 *
 * Env:
 *   DATABASE_URL
 *   PROJECTOR_ENABLED=1
 *   DEFI_HISTORY=0              1 = walk from DEFI_FROM_HEIGHT, no tip clamp
 *   DEFI_FROM_HEIGHT=452000
 *   DEFI_INDEXER_PAUSE_LAG=2
 *   POLL_MS=4000
 *   BATCH_HEIGHTS=40
 *   TRAIL_RESCAN=24
 *   TIP_LAG_SAFE=2
 *   RANKS_MS=90000
 *   RANKS_HISTORY_MS=1800000    while scan lag > 500
 *   REGISTRY_REFRESH_MS=1800000
 *   HEALTH_PORT=8793
 *   HEALTH_ALIAS_PORT=8795      leftover T2T health port
 *   DETECT_TIMEOUT_MS=4000
 *   REWIND_BLOCKS=2000          tip-mode only
 *   DEFI_AGEUSD_UNIFIED=0       1 = bank detect in this tick (only after AgeUSD tip)
 *   LITHOS_ENABLED=1            0 = skip LithosDex sidecar
 *   LITHOS_POOL_NFT=            real genesis singleton (never 1111…)
 *   LITHOS_TOKEN_Y=             override LIT id (default mainnet LIT)
 *   LITHOS_HUNT_MS=60000        unspent LIT hunt while registry empty
 *   Lithos cursor               scan_height_lithos (own; never stalls Spectrum)
 */
import { createPool, getState, setState } from "./db.js";
import { ensureProjectorSchema } from "./schema.js";
import { listRegistryNfts, registryForWindow } from "./registry.js";
import { syncLiveSpectrumPools } from "./spectrum-pools.js";
import { backfillQuietPools } from "./backfill-quiet.js";
import { listT2tRegistry, seedT2tFromUnspent } from "./t2t-registry.js";
import { materializeRanks } from "./ranks.js";
import { seedPoolRoll } from "./pool-roll.js";
import { startHealthServer, type HealthSnap } from "./health.js";
import {
  AGEUSD_CURSOR_KEY,
  ageusdUnifiedFromEnv,
  clampCursorIfNeeded,
  fromHeightFromEnv,
  historyFromEnv,
  HISTORY_NEAR_TIP,
  initCursor,
  initLithosCursor,
  lithosBornHeight,
  LITHOS_CURSOR_KEY,
  liveIndexerLag,
  mergeTipCursors,
  nextBatch,
  N2T_CURSOR_KEY,
  persistCursorValue,
  planDefiTick,
  shouldMaterializeRanks,
  T2T_CURSOR_KEY,
} from "./policy.js";
import { canAdvanceCursor, canAdvanceLithosCursor, detectBoth, persistBoth } from "./unified.js";
import { detectLithosSwaps } from "./lithos-detect.js";
import { persistLithosSwaps } from "./lithos-project.js";
import { listLithosRegistry, lithosUnspentHuntDue, seedLithosFromScript, seedLithosRegistry } from "./lithos-registry.js";
import { lithosEnabledFromEnv } from "@ergoscan/shared";

const ENABLED =
  process.env.PROJECTOR_ENABLED === "1" ||
  process.env.PROJECTOR_ENABLED === "true";
const HISTORY = historyFromEnv(process.env.DEFI_HISTORY);
const FROM_HEIGHT = fromHeightFromEnv(process.env.DEFI_FROM_HEIGHT);
const PAUSE_AT = Number(process.env.DEFI_INDEXER_PAUSE_LAG || 2);
const POLL_MS = Number(process.env.POLL_MS || 4_000);
const BATCH = Number(process.env.BATCH_HEIGHTS || 40);
const TRAIL = Number(process.env.TRAIL_RESCAN || 24);
const TIP_LAG_SAFE = Number(process.env.TIP_LAG_SAFE || 2);
const RANKS_MS = Number(process.env.RANKS_MS || 90_000);
const RANKS_HISTORY_MS = Number(process.env.RANKS_HISTORY_MS || 1_800_000);
const REGISTRY_MS = Number(process.env.REGISTRY_REFRESH_MS || 1_800_000);
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 8793);
const HEALTH_ALIAS = Number(process.env.HEALTH_ALIAS_PORT || 8795);
const REWIND_ON_START = Number(process.env.REWIND_BLOCKS || 2_000);
const AGEUSD_UNIFIED = ageusdUnifiedFromEnv(process.env.DEFI_AGEUSD_UNIFIED);
const LITHOS_ON = lithosEnabledFromEnv(process.env.LITHOS_ENABLED);
const LITHOS_HUNT_MS = Number(process.env.LITHOS_HUNT_MS || 60_000);
const LITHOS_HUNT_HEIGHT_KEY = "lithos_pool_hunt_h";

const health: HealthSnap = {
  kind: "unified",
  ok: true,
  enabled: ENABLED,
  mode: "idle",
  scanHeight: null,
  tipHeight: null,
  lag: null,
  indexerLag: null,
  registryN: 0,
  n2tRegistry: 0,
  t2tRegistry: 0,
  insertedSession: 0,
  insertedN2t: 0,
  insertedT2t: 0,
  insertedAgeusd: 0,
  lithosRegistry: 0,
  insertedLithos: 0,
  lithosScanHeight: null,
  lithosLag: null,
  lithosEnabled: LITHOS_ON,
  ageusdUnified: AGEUSD_UNIFIED,
  lastScanAt: null,
  lastRanksAt: null,
  lastError: null,
};

async function chainSnap(db: ReturnType<typeof createPool>): Promise<{
  tip: number;
  indexerLag: number | null;
}> {
  const r = await db.query<{ tip: number | null; last_h: number | null }>(
    `SELECT
       (SELECT max(height)::int FROM packed.blocks) AS tip,
       (SELECT value FROM indexer_state WHERE key = 'last_height')::int AS last_h`
  );
  const tip = Number(r.rows[0]?.tip) || 0;
  return { tip, indexerLag: liveIndexerLag(tip, r.rows[0]?.last_h ?? null) };
}

async function saveCursors(
  db: ReturnType<typeof createPool>,
  next: number,
  floorN2t: number,
  floorT2t: number,
  floorAgeusd = 0
): Promise<void> {
  await setState(db, N2T_CURSOR_KEY, String(persistCursorValue(floorN2t, next)));
  await setState(db, T2T_CURSOR_KEY, String(persistCursorValue(floorT2t, next)));
  if (AGEUSD_UNIFIED) {
    await setState(db, AGEUSD_CURSOR_KEY, String(persistCursorValue(floorAgeusd, next)));
  }
}

async function lithosScriptFloor(
  db: ReturnType<typeof createPool>,
  tip: number
): Promise<number> {
  const stored = Number((await getState(db, LITHOS_HUNT_HEIGHT_KEY)) || 0);
  if (stored > 0) return Math.max(0, stored - 64);
  return Math.max(0, tip - 8_000);
}

/** Fills for a pool that joined after the cursor passed its birth. Does not move the cursor. */
async function catchUpLithosPools(
  db: ReturnType<typeof createPool>,
  pools: Awaited<ReturnType<typeof listLithosRegistry>>,
  cursor: number
): Promise<number> {
  if (!(cursor > 0)) return 0;
  let n = 0;
  for (const pool of pools) {
    const key = `lithos_catchup_${pool.poolId}`;
    if ((await getState(db, key)) === "1") continue;
    const seen = await db.query(`SELECT 1 FROM defi.swaps WHERE pool_id = $1 AND venue = 'lithos_dex' LIMIT 1`, [
      pool.poolId,
    ]);
    if ((seen.rowCount ?? 0) > 0) {
      await setState(db, key, "1");
      continue;
    }
    const born =
      pool.existedFrom != null && pool.existedFrom > 0 ? Math.max(0, pool.existedFrom - 1) : cursor;
    if (born >= cursor) {
      await setState(db, key, "1");
      continue;
    }
    const det = await detectLithosSwaps(db, born, cursor, [pool]);
    if (!det.ok) continue;
    if (det.swaps.length) {
      const saved = await persistLithosSwaps(db, det.swaps);
      if (!saved.ok) continue;
      n += saved.n;
    }
    await setState(db, key, "1");
  }
  return n;
}

async function loop(): Promise<void> {
  if (!ENABLED) {
    console.log(JSON.stringify({ type: "disabled", hint: "PROJECTOR_ENABLED=1" }));
    return;
  }

  const db = createPool();
  startHealthServer(HEALTH_PORT, () => ({ ...health }), [HEALTH_ALIAS]);

  await ensureProjectorSchema(db);
  try {
    const rolled = await seedPoolRoll(db);
    if (rolled) console.log(JSON.stringify({ type: "pool_roll_seed", pools: rolled.pools }));
  } catch (e) {
    console.warn(JSON.stringify({ type: "pool_roll_seed_skip", err: String(e) }));
  }
  let { tip, indexerLag } = await chainSnap(db);
  let n2tReg = await listRegistryNfts(db);
  let t2tReg = await listT2tRegistry(db);
  let lithosReg = LITHOS_ON ? await listLithosRegistry(db) : [];
  let seededN2t = 0;
  let seededT2t = 0;
  let seededLithos = 0;
  if (!t2tReg.length) {
    try {
      seededT2t = await seedT2tFromUnspent(db);
    } catch (e) {
      console.warn(JSON.stringify({ type: "registry_seed_skip", pair: "t2t", err: String(e) }));
    }
    console.log(JSON.stringify({ type: "registry_seed", pair: "t2t", upserts: seededT2t }));
    t2tReg = await listT2tRegistry(db);
  } else {
    console.log(
      JSON.stringify({
        type: "registry_keep",
        pair: "unified",
        n2t: n2tReg.length,
        t2t: t2tReg.length,
      })
    );
  }
  try {
    const synced = await syncLiveSpectrumPools(db);
    seededN2t = synced.cfmm;
    console.log(JSON.stringify({ type: "spectrum_sync", ...synced }));
    n2tReg = await listRegistryNfts(db);
    t2tReg = await listT2tRegistry(db);
  } catch (e) {
    console.warn(JSON.stringify({ type: "spectrum_sync_skip", err: String(e) }));
  }
  void backfillQuietPools(db).catch((e) =>
    console.warn(JSON.stringify({ type: "quiet_backfill_skip", err: String(e) }))
  );
  if (LITHOS_ON && !lithosReg.length) {
    try {
      seededLithos = await seedLithosRegistry(db);
    } catch (e) {
      console.warn(JSON.stringify({ type: "registry_seed_skip", pair: "lithos", err: String(e) }));
    }
    lithosReg = await listLithosRegistry(db);
    if (lithosReg.length) n2tReg = await listRegistryNfts(db);
    console.log(
      JSON.stringify({
        type: "registry_seed",
        pair: "lithos",
        upserts: seededLithos,
        n: lithosReg.length,
      })
    );
  }

  const storedN2t = Number((await getState(db, N2T_CURSOR_KEY)) || 0);
  const storedT2t = Number((await getState(db, T2T_CURSOR_KEY)) || 0);
  const storedAgeusd = AGEUSD_UNIFIED
    ? Number((await getState(db, AGEUSD_CURSOR_KEY)) || 0)
    : 0;
  let floorN2t = storedN2t;
  let floorT2t = storedT2t;
  let floorAgeusd = storedAgeusd;
  let cursor = initCursor(
    AGEUSD_UNIFIED
      ? mergeTipCursors(storedN2t, storedT2t, storedAgeusd)
      : mergeTipCursors(storedN2t, storedT2t),
    tip,
    REWIND_ON_START,
    HISTORY,
    FROM_HEIGHT
  );
  const clamped = clampCursorIfNeeded(cursor, tip, REWIND_ON_START, HISTORY);
  if (clamped.clamped) {
    console.log(
      JSON.stringify({ type: "cursor_clamp", from: cursor, to: clamped.cursor, tip })
    );
  }
  cursor = clamped.cursor;
  if (storedN2t <= 0 && storedT2t <= 0) {
    await saveCursors(db, cursor, floorN2t, floorT2t, floorAgeusd);
    console.log(
      JSON.stringify({
        type: "cursor_init",
        pair: "unified",
        cursor,
        tip,
        history: HISTORY,
        ageusd: AGEUSD_UNIFIED,
      })
    );
  } else {
    console.log(
      JSON.stringify({
        type: "cursor_keep",
        pair: "unified",
        cursor,
        n2t: storedN2t,
        t2t: storedT2t,
        ageusd: storedAgeusd,
        tip,
        history: HISTORY,
        ageusdUnified: AGEUSD_UNIFIED,
      })
    );
  }

  const storedLithos = LITHOS_ON
    ? Number((await getState(db, LITHOS_CURSOR_KEY)) || 0)
    : 0;
  let lithosCursor = 0;
  let lithosBatch = BATCH;
  if (LITHOS_ON && lithosReg.length) {
    lithosCursor = initLithosCursor(
      storedLithos,
      tip,
      REWIND_ON_START,
      HISTORY,
      lithosBornHeight(lithosReg),
      FROM_HEIGHT
    );
    const lithosClamped = clampCursorIfNeeded(
      lithosCursor,
      tip,
      REWIND_ON_START,
      HISTORY
    );
    lithosCursor = lithosClamped.cursor;
    if (storedLithos <= 0 || lithosCursor !== storedLithos) {
      await setState(db, LITHOS_CURSOR_KEY, String(persistCursorValue(storedLithos, lithosCursor)));
    }
    console.log(
      JSON.stringify({
        type: storedLithos > 0 ? "cursor_keep" : "cursor_init",
        pair: "lithos",
        cursor: lithosCursor,
        stored: storedLithos,
        born: lithosBornHeight(lithosReg),
        tip,
        history: HISTORY,
      })
    );
  }

  if (LITHOS_ON && lithosCursor > 0) {
    try {
      const floor = await lithosScriptFloor(db, tip);
      const ids = await seedLithosFromScript(db, floor);
      lithosReg = await listLithosRegistry(db);
      await setState(db, LITHOS_HUNT_HEIGHT_KEY, String(tip));
      const caught = await catchUpLithosPools(db, lithosReg, lithosCursor);
      console.log(
        JSON.stringify({
          type: "lithos_script_seed",
          found: ids.length,
          pools: lithosReg.length,
          caught,
          floor,
        })
      );
    } catch (e) {
      console.warn(JSON.stringify({ type: "lithos_script_seed_skip", err: String(e) }));
    }
  }

  let lastRanks = 0;
  let lastRegistry = Date.now();
  let lastLithosHunt = Date.now();
  let batch = BATCH;
  health.n2tRegistry = n2tReg.length;
  health.t2tRegistry = t2tReg.length;
  health.lithosRegistry = lithosReg.length;
  health.registryN = n2tReg.length + t2tReg.length + lithosReg.length;
  health.scanHeight = cursor;
  health.lithosScanHeight = LITHOS_ON ? lithosCursor : null;
  health.tipHeight = tip;
  health.indexerLag = indexerLag;

  console.log(
    JSON.stringify({
      type: "start",
      pair: "unified",
      cursor,
      tip,
      history: HISTORY,
      from: FROM_HEIGHT,
      batch: BATCH,
      n2t: n2tReg.length,
      t2t: t2tReg.length,
      lithos: lithosReg.length,
      lithosCursor,
      lithosEnabled: LITHOS_ON,
      healthPort: HEALTH_PORT,
      healthAlias: HEALTH_ALIAS,
      ageusdUnified: AGEUSD_UNIFIED,
    })
  );

  for (;;) {
    let hold = false;
    try {
      ({ tip, indexerLag } = await chainSnap(db));
      health.tipHeight = tip;
      health.indexerLag = indexerLag;
      const safeTip = Math.max(0, tip - TIP_LAG_SAFE);
      const floor = HISTORY ? FROM_HEIGHT : 0;
      const plan = planDefiTick({
        cursor,
        safeTip,
        batch,
        trail: TRAIL,
        floor,
        indexerLag,
        pauseAt: PAUSE_AT,
      });
      if (plan.nextCursor !== cursor && plan.from == null) {
        cursor = plan.nextCursor;
        await saveCursors(db, cursor, floorN2t, floorT2t, floorAgeusd);
        floorN2t = persistCursorValue(floorN2t, cursor);
        floorT2t = persistCursorValue(floorT2t, cursor);
        if (AGEUSD_UNIFIED) floorAgeusd = persistCursorValue(floorAgeusd, cursor);
      }
      health.mode = plan.mode;
      health.scanHeight = cursor;
      health.lag = Math.max(0, safeTip - cursor);

      if (Date.now() - lastRegistry > REGISTRY_MS) {
        try {
          try {
            seededT2t = await seedT2tFromUnspent(db);
          } catch (e) {
            console.warn(
              JSON.stringify({ type: "registry_refresh_skip", pair: "t2t", err: String(e) })
            );
          }
          const synced = await syncLiveSpectrumPools(db);
          seededN2t = synced.cfmm;
          console.log(JSON.stringify({ type: "spectrum_sync", ...synced }));
          n2tReg = await listRegistryNfts(db);
          t2tReg = await listT2tRegistry(db);
          if (LITHOS_ON) {
            try {
              seededLithos = await seedLithosRegistry(db);
            } catch (e) {
              console.warn(
                JSON.stringify({ type: "registry_refresh_skip", pair: "lithos", err: String(e) })
              );
            }
            lithosReg = await listLithosRegistry(db);
            lastLithosHunt = Date.now();
            if (lithosReg.length && lithosCursor <= 0) {
              lithosCursor = initLithosCursor(
                0,
                tip,
                REWIND_ON_START,
                HISTORY,
                lithosBornHeight(lithosReg),
                FROM_HEIGHT
              );
              await setState(db, LITHOS_CURSOR_KEY, String(lithosCursor));
              health.lithosScanHeight = lithosCursor;
            }
          }
          health.n2tRegistry = n2tReg.length;
          health.t2tRegistry = t2tReg.length;
          health.lithosRegistry = lithosReg.length;
          health.registryN = n2tReg.length + t2tReg.length + lithosReg.length;
          lastRegistry = Date.now();
          console.log(
            JSON.stringify({
              type: "registry_refresh",
              pair: "unified",
              n2t: n2tReg.length,
              t2t: t2tReg.length,
              lithos: lithosReg.length,
              seedN2t: seededN2t,
              seedT2t: seededT2t,
              seedLithos: seededLithos,
            })
          );
        } catch (e) {
          lastRegistry = Date.now();
          console.warn(JSON.stringify({ type: "registry_refresh_skip", err: String(e) }));
        }
      }

      if (plan.mode === "tip_hold") {
        hold = true;
        health.lastError = "indexer_lag";
      } else if (plan.from != null && plan.to != null) {
        const windowN2t = registryForWindow(n2tReg, plan.to);
        const detected = await detectBoth(
          db,
          plan.from,
          plan.to,
          windowN2t,
          t2tReg,
          AGEUSD_UNIFIED
        );
        if (!detected.n2t.ok || !detected.t2t.ok || !detected.ageusd.ok) {
          batch = nextBatch(batch, BATCH, true);
          health.lastError = "detect_timeout";
          console.warn(
            JSON.stringify({
              type: "detect_timeout",
              pair: "unified",
              from: plan.from,
              to: plan.to,
              batch,
              n2t: detected.n2t.ok,
              t2t: detected.t2t.ok,
              ageusd: detected.ageusd.ok,
            })
          );
        } else {
          batch = nextBatch(batch, BATCH, false);
          const persisted = await persistBoth(
            db,
            detected.n2t.swaps,
            detected.t2t.swaps,
            detected.ageusd.swaps
          );
          if (!canAdvanceCursor(detected.n2t, detected.t2t, persisted.ok, detected.ageusd)) {
            health.lastError = "persist_skip";
          } else {
            cursor = plan.nextCursor;
            await saveCursors(db, cursor, floorN2t, floorT2t, floorAgeusd);
            floorN2t = persistCursorValue(floorN2t, cursor);
            floorT2t = persistCursorValue(floorT2t, cursor);
            if (AGEUSD_UNIFIED) floorAgeusd = persistCursorValue(floorAgeusd, cursor);
            health.scanHeight = cursor;
            health.insertedSession += persisted.n2t + persisted.t2t + persisted.ageusd;
            health.insertedN2t = (health.insertedN2t ?? 0) + persisted.n2t;
            health.insertedT2t = (health.insertedT2t ?? 0) + persisted.t2t;
            health.insertedAgeusd = (health.insertedAgeusd ?? 0) + persisted.ageusd;
            health.lastScanAt = Date.now();
            health.lag = Math.max(0, safeTip - cursor);
            health.lastError = null;
            console.log(
              JSON.stringify({
                type: "scan",
                pair: "unified",
                mode: plan.mode,
                from: plan.from,
                to: plan.to,
                n2tPairs: detected.n2t.swaps.length,
                t2tPairs: detected.t2t.swaps.length,
                ageusdPairs: detected.ageusd.swaps.length,
                insertedN2t: persisted.n2t,
                insertedT2t: persisted.t2t,
                insertedAgeusd: persisted.ageusd,
                cursor,
                tip,
                n2t: n2tReg.length,
                t2t: t2tReg.length,
                lithos: lithosReg.length,
                window: windowN2t.length,
                ageusdUnified: AGEUSD_UNIFIED,
              })
            );
          }
        }
      }

      if (
        LITHOS_ON &&
        plan.mode !== "tip_hold" &&
        lithosUnspentHuntDue(lithosReg.length, Date.now(), lastLithosHunt, LITHOS_HUNT_MS)
      ) {
        lastLithosHunt = Date.now();
        try {
          seededLithos = await seedLithosRegistry(db);
          const floor = await lithosScriptFloor(db, tip);
          const ids = await seedLithosFromScript(db, floor);
          if (ids.length) lithosReg = await listLithosRegistry(db);
          await setState(db, LITHOS_HUNT_HEIGHT_KEY, String(tip));
          const caught = await catchUpLithosPools(db, lithosReg, lithosCursor);
          if (ids.length || caught) {
            console.log(
              JSON.stringify({ type: "lithos_script_seed", found: ids.length, caught, floor })
            );
          }
          lithosReg = await listLithosRegistry(db);
          health.lithosRegistry = lithosReg.length;
          health.registryN = n2tReg.length + t2tReg.length + lithosReg.length;
          if (lithosReg.length) n2tReg = await listRegistryNfts(db);
          if (lithosReg.length && lithosCursor <= 0) {
            lithosCursor = initLithosCursor(
              0,
              tip,
              REWIND_ON_START,
              HISTORY,
              lithosBornHeight(lithosReg),
              FROM_HEIGHT
            );
            await setState(db, LITHOS_CURSOR_KEY, String(lithosCursor));
            health.lithosScanHeight = lithosCursor;
          }
          if (seededLithos || lithosReg.length) {
            console.log(
              JSON.stringify({
                type: "registry_seed",
                pair: "lithos",
                upserts: seededLithos,
                n: lithosReg.length,
              })
            );
          }
        } catch (e) {
          console.warn(JSON.stringify({ type: "registry_seed_skip", pair: "lithos", err: String(e) }));
        }
      }

      if (LITHOS_ON && lithosReg.length && lithosCursor > 0 && plan.mode !== "tip_hold") {
        const lithosPlan = planDefiTick({
          cursor: lithosCursor,
          safeTip,
          batch: lithosBatch,
          trail: TRAIL,
          floor: HISTORY ? FROM_HEIGHT : 0,
          indexerLag,
          pauseAt: PAUSE_AT,
        });
        if (lithosPlan.from != null && lithosPlan.to != null) {
          const lithosDetected = await detectLithosSwaps(
            db,
            lithosPlan.from,
            lithosPlan.to,
            lithosReg
          );
          lithosBatch = nextBatch(lithosBatch, BATCH, !lithosDetected.ok);
          let lithosPersistOk = true;
          let lithosN = 0;
          if (lithosDetected.ok && lithosDetected.swaps.length) {
            const saved = await persistLithosSwaps(db, lithosDetected.swaps);
            lithosPersistOk = saved.ok;
            lithosN = saved.ok ? saved.n : 0;
          }
          if (!canAdvanceLithosCursor(lithosDetected, lithosPersistOk)) {
            console.warn(
              JSON.stringify({
                type: lithosDetected.ok ? "persist_skip" : "detect_timeout",
                pair: "lithos",
                from: lithosPlan.from,
                to: lithosPlan.to,
                batch: lithosBatch,
              })
            );
          } else {
            lithosCursor = lithosPlan.nextCursor;
            await setState(db, LITHOS_CURSOR_KEY, String(persistCursorValue(lithosCursor, lithosCursor)));
            health.lithosScanHeight = lithosCursor;
            health.lithosLag = Math.max(0, safeTip - lithosCursor);
            health.insertedLithos = (health.insertedLithos ?? 0) + lithosN;
            health.insertedSession = (health.insertedSession ?? 0) + lithosN;
            console.log(
              JSON.stringify({
                type: "scan",
                pair: "lithos",
                mode: lithosPlan.mode,
                from: lithosPlan.from,
                to: lithosPlan.to,
                lithosPairs: lithosDetected.swaps.length,
                insertedLithos: lithosN,
                cursor: lithosCursor,
                tip,
              })
            );
          }
        }
      }

      if (
        shouldMaterializeRanks({
          now: Date.now(),
          lastRanksAt: lastRanks,
          ranksMs: RANKS_MS,
          historyRanksMs: RANKS_HISTORY_MS,
          scanLag: health.lag ?? 0,
          nearTip: HISTORY_NEAR_TIP,
        })
      ) {
        const r = await materializeRanks(db);
        lastRanks = Date.now();
        health.lastRanksAt = lastRanks;
        console.log(
          JSON.stringify({
            type: "ranks",
            heat: r.heat,
            pools: r.pools,
            at: lastRanks,
          })
        );
      }

      if (!health.lastError || hold) health.ok = true;
    } catch (e) {
      health.ok = false;
      health.lastError = String(e);
      console.warn(JSON.stringify({ type: "tick_err", pair: "unified", err: String(e) }));
    }

    await sleep(
      hold || health.lastError === "detect_timeout" ? POLL_MS * 2 : POLL_MS
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});
