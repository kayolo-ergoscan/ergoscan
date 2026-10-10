/**
 * After a tip tick, freeze list JSON so gateway GETs never fan out to the node.
 */
import type pg from "pg";
import {
  ERGO_HEADER_EPOCH_LEN,
  estimateBoxSizeBytes,
  HOME_RENT_PROBE,
  ERG_USD_ORACLE_NFTS,
  KNOWN_TOKENS,
  LITHOS_COLLAT_ADDRESS,
  LITHOS_COLLAT_TOKEN_ID,
  LITHOS_MINED_HEIGHTS_SQL,
  ORACLE_FEEDS,
  pickRentTapeAddresses,
  registerPayloadBytes,
  type RentTapeRow,
} from "@ergoscan/shared";
import { knownKindLists } from "./knownKinds.js";
import { minerName } from "./knownMiners.js";
import { classifyTxShape, txTapeFields, TX_SHAPE_RULES_VERSION, type ShapeBox } from "./txShape.js";
import { writeTokenKpis } from "./tokenStats.js";
import {
  ERG_USD_SOURCE_CG,
  readCgPriceSpark,
  resolveCgMarketExtras,
} from "./cgMarket.js";
import { resolveOracleErgUsd } from "./oracleErgUsd.js";
import { textChainHeadersEnabled } from "./packed/flags.js";

type Pool = pg.Pool;

const BLOCKS_N = 50;
const TXS_N = 50;
const SKIP_RENT_SNAP =
  process.env.SKIP_RENT_SNAP === "1" || process.env.SKIP_RENT_SNAP === "true";
const ADDRESSES_N = 25;
const SHAPE_FILL_N = 64;
/** Tape window only — do not walk genesis NULLs on the snapshot path. */
const SHAPE_FILL_WINDOW = 500;
const SHAPE_FILL_TIMEOUT_MS = 1200;

function n(v: unknown): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function nNull(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

type BlockRow = {
  id: string;
  height: unknown;
  timestamp: unknown;
  size: unknown;
  txCount: unknown;
  parentId: string | null;
  minerAddress: string | null;
  feeNano: string | null;
  valueNano: string | null;
};

export type BlockListItem = {
  id: string;
  height: number;
  timestamp: number;
  size: number;
  txCount: number | null;
  parentId: string | null;
  minerAddress: string | null;
  minerName: string | null;
  feeNano: string;
  valueNano: string;
  /** True when this block was mined with Lithos. Written with the list snapshot. */
  lithos?: boolean;
};

export type AddressListItem = {
  rank: number;
  address: string;
  nanoerg: string;
  boxCount: number;
  txCount: number;
  tokenCount: number;
  firstHeight: number | null;
  lastHeight: number | null;
  firstTs: number | null;
  lastTs: number | null;
  isContract: boolean;
};

/** Holder vs leftover script. Same rule as web `isP2pkAddress`. */
function isP2pk(address: string): boolean {
  return address.startsWith("9") && address.length < 70;
}

const HOLDER_BAND_IDS = ["dust", "stacker", "believer", "guardian", "overlord"] as const;

type HolderBandRow = { id: string; n: number; nanoerg: string };

async function queryHolderBands(pool: Pool, p2pkOnly: boolean): Promise<HolderBandRow[]> {
  const r = await pool.query<{ id: string; n: string; nanoerg: string }>(
    `SELECT
       CASE
         WHEN nanoerg < 100000000000 THEN 'dust'
         WHEN nanoerg < 1000000000000 THEN 'stacker'
         WHEN nanoerg < 10000000000000 THEN 'believer'
         WHEN nanoerg < 100000000000000 THEN 'guardian'
         ELSE 'overlord'
       END AS id,
       COUNT(*)::text AS n,
       SUM(nanoerg)::text AS nanoerg
     FROM address_summary
     WHERE nanoerg > 0
       AND (
         $1::boolean = false
         OR (address LIKE '9%' AND length(address) < 70)
       )
     GROUP BY 1`,
    [p2pkOnly]
  );
  const byId = new Map(r.rows.map((row) => [row.id, row]));
  return HOLDER_BAND_IDS.map((id) => {
    const hit = byId.get(id);
    return { id, n: n(hit?.n), nanoerg: hit?.nanoerg || "0" };
  });
}

const HOLDER_KIND_IDS = ["protocol", "exchange", "pool", "contract"] as const;

/** Non-wallet scripts with ERG. Exchange rows are wallets, so they stay out. */
const SCRIPT_KIND_IDS = new Set(["protocol", "pool", "contract"]);

export function scriptCountFromKinds(
  kinds: { id: string; n: number }[] | null | undefined
): number | null {
  if (!Array.isArray(kinds)) return null;
  let sum = 0;
  let seen = false;
  for (const row of kinds) {
    if (!row || !SCRIPT_KIND_IDS.has(row.id)) continue;
    if (!Number.isFinite(row.n) || row.n < 0) continue;
    seen = true;
    sum += Math.round(row.n);
  }
  return seen ? sum : null;
}

async function queryHolderKinds(pool: Pool): Promise<HolderBandRow[]> {
  const lists = knownKindLists();
  const r = await pool.query<{ id: string; n: string; nanoerg: string }>(
    `SELECT
       CASE
         WHEN address = ANY($1::text[]) THEN 'protocol'
         WHEN address = ANY($2::text[]) THEN 'exchange'
         WHEN address LIKE '88%' OR address = ANY($3::text[]) THEN 'pool'
         WHEN NOT (address LIKE '9%' AND length(address) < 70) THEN 'contract'
         ELSE 'holder'
       END AS id,
       COUNT(*)::text AS n,
       SUM(nanoerg)::text AS nanoerg
     FROM address_summary
     WHERE nanoerg > 0
     GROUP BY 1`,
    [lists.protocol, lists.exchange, lists.pool]
  );
  const byId = new Map(r.rows.map((row) => [row.id, row]));
  return HOLDER_KIND_IDS.map((id) => {
    const hit = byId.get(id);
    return { id, n: n(hit?.n), nanoerg: hit?.nanoerg || "0" };
  });
}

async function buildHolderBands(pool: Pool): Promise<{
  p2pk: HolderBandRow[];
  all: HolderBandRow[];
  kinds: HolderBandRow[];
}> {
  const [p2pk, all, kinds] = await Promise.all([
    queryHolderBands(pool, true),
    queryHolderBands(pool, false),
    queryHolderKinds(pool),
  ]);
  return { p2pk, all, kinds };
}

export type TxListItem = {
  id: string;
  index: number | null;
  inclusionHeight: number | null;
  timestamp: number | null;
  size: number;
  fee: number;
  feeRate: number;
  category: string;
  color: string;
  platform: string | null;
  inputs: number;
  outputs: number;
  value: number;
  confirmed: true;
};

function nanoDigits(raw: unknown): string {
  const s = String(raw ?? "0").trim();
  return /^\d+$/.test(s) ? s : "0";
}

/** One lookup for the 50-row list. A failure leaves the flag off so GET can still look it up. */
async function paintLithosBlocks(pool: Pool, blocks: BlockListItem[]): Promise<BlockListItem[]> {
  const heights = blocks.map((b) => b.height).filter((h) => Number.isInteger(h) && h >= 0);
  if (!heights.length) return blocks;
  const marked = await pool.query<{ height: string }>(LITHOS_MINED_HEIGHTS_SQL, [
    heights,
    LITHOS_COLLAT_TOKEN_ID,
    LITHOS_COLLAT_ADDRESS,
  ]);
  const hit = new Set<number>();
  for (const row of marked.rows) {
    const h = Number(row.height);
    if (Number.isInteger(h)) hit.add(h);
  }
  return blocks.map((b) => ({ ...b, lithos: hit.has(b.height) }));
}

function mapBlock(r: BlockRow): BlockListItem {
  const minerAddress = r.minerAddress && r.minerAddress.length ? r.minerAddress : null;
  return {
    id: r.id,
    height: n(r.height),
    timestamp: n(r.timestamp),
    size: n(r.size),
    txCount: nNull(r.txCount),
    parentId: r.parentId,
    minerAddress,
    minerName: minerAddress ? minerName(minerAddress) : null,
    feeNano: nanoDigits(r.feeNano),
    valueNano: nanoDigits(r.valueNano),
  };
}

function mapTx(r: {
  id: string;
  index_in_block: unknown;
  height: unknown;
  timestamp_ms: unknown;
  size: unknown;
  fee: unknown;
  input_count: unknown;
  output_count: unknown;
  value_nano: unknown;
  shape?: string | null;
  protocol?: string | null;
}): TxListItem {
  const size = n(r.size);
  const fee = n(r.fee);
  const shape = r.shape && r.shape.length ? r.shape : null;
  const protocol = r.protocol && r.protocol.length ? r.protocol : null;
  const paint = txTapeFields(shape, protocol);
  return {
    id: r.id,
    index: nNull(r.index_in_block),
    inclusionHeight: nNull(r.height),
    timestamp: nNull(r.timestamp_ms),
    size,
    fee,
    feeRate: size > 0 ? fee / size : 0,
    category: paint.category,
    color: paint.color,
    platform: paint.platform,
    inputs: n(r.input_count),
    outputs: n(r.output_count),
    value: n(r.value_nano),
    confirmed: true,
  };
}

/** Ergo target interval. H/s ≈ difficulty / 120. Difficulty stays numeric in SQL. */
const ERGO_BLOCK_S = 120;
const SPARK_HOUR_MS = 3_600_000;
const SPARK_DAY_MS = 24 * SPARK_HOUR_MS;
const SPARK_WINDOW_MS = 7 * SPARK_DAY_MS;

function hsFromNumericText(raw: string): number | null {
  const s = raw.trim();
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const whole = s.split(".")[0] ?? s;
  try {
    const n = BigInt(whole);
    if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(n);
  } catch {
    return null;
  }
}

async function buildHashRateSpark(pool: Pool): Promise<{
  hashRate: number | null;
  hashRateSeries: { t: number; v: number }[];
}> {
  const since = Date.now() - SPARK_WINDOW_MS;
  const seriesRes = await pool.query<{ t: string | number; hs: string }>(
    `SELECT ((timestamp_ms / $2) * $2)::bigint AS t,
            (AVG(difficulty::numeric) / $3)::text AS hs
     FROM packed.blocks
     WHERE timestamp_ms >= $1
       AND difficulty IS NOT NULL
       AND btrim(difficulty) ~ '^[0-9]+$'
     GROUP BY 1
     ORDER BY 1`,
    [since, SPARK_HOUR_MS, ERGO_BLOCK_S]
  );
  const hashRateSeries: { t: number; v: number }[] = [];
  for (const row of seriesRes.rows) {
    const t = typeof row.t === "number" ? row.t : Number(row.t);
    const v = hsFromNumericText(row.hs);
    if (!Number.isFinite(t) || v == null) continue;
    hashRateSeries.push({ t, v });
  }
  const lastRes = await pool.query<{ difficulty: string }>(
    `SELECT difficulty
     FROM packed.blocks
     WHERE difficulty IS NOT NULL AND btrim(difficulty) ~ '^[0-9]+$'
     ORDER BY height DESC
     LIMIT 1`
  );
  const lastDiff = lastRes.rows[0]?.difficulty;
  let hashRate: number | null = null;
  if (lastDiff && /^[0-9]+$/.test(lastDiff.trim())) {
    try {
      const hs = BigInt(lastDiff.trim()) / BigInt(ERGO_BLOCK_S);
      if (hs > 0n && hs <= BigInt(Number.MAX_SAFE_INTEGER)) hashRate = Number(hs);
    } catch {
      hashRate = null;
    }
  }
  if (hashRate == null && hashRateSeries.length) {
    hashRate = hashRateSeries[hashRateSeries.length - 1]!.v;
  }
  return { hashRate, hashRateSeries };
}

function countFromNumericText(raw: string): number | null {
  const s = raw.trim();
  if (!s || !/^\d+$/.test(s)) return null;
  try {
    const n = BigInt(s);
    if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(n);
  } catch {
    return null;
  }
}

const NANOERG = 1_000_000_000n;

/** Display ERG only — nano stays bigint until split. */
function nanoTextToErg(raw: string): number | null {
  const s = raw.trim();
  if (!s || !/^\d+$/.test(s)) return null;
  try {
    const n = BigInt(s);
    const whole = n / NANOERG;
    const frac = n % NANOERG;
    if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const v = Number(whole) + Number(frac) / 1e9;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export type TxActivityPoint = { t: number; txs: number; feesErg: number; feesKnown?: boolean };

/** Last 24h SUM(tx_count). Hourly activity + rolling 24h over the indexed 7d window. */
async function buildTxPerDaySpark(pool: Pool): Promise<{
  txPerDay: number | null;
  txPerDaySeries: { t: number; v: number }[];
  txActivity: TxActivityPoint[];
}> {
  const since = Date.now() - SPARK_WINDOW_MS - SPARK_DAY_MS;
  const seriesRes = await pool.query<{ t: string | number; txs: string; fee_nano: string | null }>(
    `WITH hours AS (
       SELECT ((timestamp_ms / $2) * $2)::bigint AS t,
              COALESCE(SUM(tx_count), 0)::bigint::text AS txs
       FROM packed.blocks
       WHERE timestamp_ms >= $1 AND tx_count IS NOT NULL
       GROUP BY 1
     ),
     fees AS (
       SELECT ((timestamp_ms / $2) * $2)::bigint AS t,
              COALESCE(SUM(fee), 0)::bigint::text AS fee_nano
       FROM packed.transactions
       WHERE timestamp_ms >= $1 AND fee IS NOT NULL
       GROUP BY 1
     )
     SELECT h.t, h.txs, f.fee_nano
     FROM hours h
     LEFT JOIN fees f ON f.t = h.t
     ORDER BY h.t`,
    [since, SPARK_HOUR_MS]
  );
  const hourly: { t: number; txs: number; feesErg: number; feesKnown: boolean }[] = [];
  for (const row of seriesRes.rows) {
    const t = typeof row.t === "number" ? row.t : Number(row.t);
    const txs = countFromNumericText(String(row.txs));
    const feeRaw = row.fee_nano;
    const known = feeRaw != null && String(feeRaw).trim() !== "";
    const parsed = known ? nanoTextToErg(String(feeRaw)) : null;
    const feesKnown = known && parsed != null;
    const feesErg = feesKnown ? parsed : 0;
    if (!Number.isFinite(t) || txs == null) continue;
    hourly.push({ t, txs, feesErg, feesKnown });
  }
  const cut = Date.now() - SPARK_WINDOW_MS;
  const txPerDaySeries: { t: number; v: number }[] = [];
  const txActivity: TxActivityPoint[] = [];
  let i0 = 0;
  let run = 0;
  for (let i = 0; i < hourly.length; i++) {
    const h = hourly[i]!;
    run += h.txs;
    while (i0 <= i && hourly[i0]!.t <= h.t - SPARK_DAY_MS) {
      run -= hourly[i0]!.txs;
      i0++;
    }
    if (h.t < cut) continue;
    if (run > 0) txPerDaySeries.push({ t: h.t, v: run });
    txActivity.push({ t: h.t, txs: h.txs, feesErg: h.feesErg, feesKnown: h.feesKnown });
  }
  const lastRes = await pool.query<{ n: string; blocks: string }>(
    `SELECT COALESCE(SUM(tx_count), 0)::bigint::text AS n, COUNT(*)::text AS blocks
     FROM packed.blocks
     WHERE timestamp_ms >= $1 AND tx_count IS NOT NULL`,
    [Date.now() - SPARK_DAY_MS]
  );
  const blockN = countFromNumericText(lastRes.rows[0]?.blocks ?? "0");
  let txPerDay: number | null =
    blockN != null && blockN > 0 ? countFromNumericText(lastRes.rows[0]?.n ?? "0") : null;
  if (txPerDay == null && txPerDaySeries.length) {
    txPerDay = txPerDaySeries[txPerDaySeries.length - 1]!.v;
  }
  return { txPerDay, txPerDaySeries, txActivity };
}

/** Mainnet emission (nanoERG). Same constants as `apps/web/src/lib/ergo-emission.ts`. Writer only. */
const EMISSION_FIXED_PERIOD = 525_600;
const EMISSION_EPOCH = 64_800;
const EMISSION_FIXED = 75_000_000_000n;
const EMISSION_STEP = 3_000_000_000n;
const MAX_SUPPLY_ERG = 97_739_924;
const EIP27_ACTIVATION = 777_217;
const REEMISSION_START = 2_080_800;
const MINER_FLOOR = 3_000_000_000n;
const REEMISSION_HIGH_CUT = 12_000_000_000n;
const REEMISSION_HIGH_FROM = 15_000_000_000n;

function nanoToErgWhole(n: bigint): number | null {
  if (n <= 0n) return null;
  const erg = n / NANOERG;
  if (erg > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(erg);
}

function emissionAtHeight(height: number): bigint {
  if (!Number.isFinite(height) || height < 1) return 0n;
  if (height <= EMISSION_FIXED_PERIOD) return EMISSION_FIXED;
  const epoch = Math.floor((height - EMISSION_FIXED_PERIOD) / EMISSION_EPOCH);
  const rate = EMISSION_FIXED - EMISSION_STEP * BigInt(epoch + 1);
  return rate > 0n ? rate : 0n;
}

function minerEmissionAtHeight(height: number): bigint {
  if (!Number.isFinite(height) || height < 1) return 0n;
  if (height >= REEMISSION_START) return MINER_FLOOR;
  const r = emissionAtHeight(height);
  if (height < EIP27_ACTIVATION) return r;
  if (r >= REEMISSION_HIGH_FROM) return r - REEMISSION_HIGH_CUT;
  return r > MINER_FLOOR ? MINER_FLOOR : r;
}

/** EIP-27 circulating: miner-keep from the schedule. Keep in sync with `ergo-emission.ts`. */
function circulatingNanoAtHeight(height: number): bigint {
  if (!Number.isFinite(height) || height < 1) return 0n;
  const H = Math.floor(height);
  let nano = 0n;
  let h = 1;
  while (h <= H) {
    const keep = minerEmissionAtHeight(h);
    if (keep <= 0n) break;
    let runEnd: number;
    if (h <= EMISSION_FIXED_PERIOD) runEnd = EMISSION_FIXED_PERIOD;
    else if (h >= REEMISSION_START) runEnd = H;
    else {
      const epoch = Math.floor((h - EMISSION_FIXED_PERIOD) / EMISSION_EPOCH);
      runEnd = EMISSION_FIXED_PERIOD + (epoch + 1) * EMISSION_EPOCH - 1;
    }
    if (h < EIP27_ACTIVATION && runEnd >= EIP27_ACTIVATION) runEnd = EIP27_ACTIVATION - 1;
    if (h < REEMISSION_START && runEnd >= REEMISSION_START) runEnd = REEMISSION_START - 1;
    runEnd = Math.min(runEnd, H);
    nano += keep * BigInt(runEnd - h + 1);
    h = runEnd + 1;
  }
  return nano;
}

function circulatingErgAtHeight(height: number): number | null {
  return nanoToErgWhole(circulatingNanoAtHeight(height));
}

/** Confirmed txs in the indexed window. GET never COUNT(*) / SUM the tape. */
const TX_TOTAL_KEY = "tx_total";
const TX_TOTAL_H_KEY = "tx_total_height";

async function upsertIndexerState(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

/**
 * Running SUM(blocks.tx_count). First call (or tip unwind) does the full SUM;
 * after that only the new heights. Watermark is MAX(blocks.height), not node tip.
 */
async function resolveTxTotal(pool: Pool): Promise<number | null> {
  const maxRes = await pool.query<{ h: string }>(`SELECT MAX(height)::text AS h FROM packed.blocks`);
  const maxH = countFromNumericText(maxRes.rows[0]?.h ?? "");
  if (maxH == null) return null;
  const st = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM indexer_state WHERE key = ANY($1::text[])`,
    [[TX_TOTAL_KEY, TX_TOTAL_H_KEY]]
  );
  const map = Object.fromEntries(st.rows.map((r) => [r.key, r.value]));
  const prevN = countFromNumericText(map[TX_TOTAL_KEY] ?? "");
  const prevH = countFromNumericText(map[TX_TOTAL_H_KEY] ?? "");
  let n: number | null = null;
  if (prevN == null || prevH == null) {
    const r = await pool.query<{ n: string }>(
      `SELECT COALESCE(SUM(tx_count), 0)::bigint::text AS n
       FROM packed.blocks WHERE tx_count IS NOT NULL`
    );
    n = countFromNumericText(r.rows[0]?.n ?? "0");
  } else if (maxH === prevH) {
    n = prevN;
  } else if (maxH > prevH) {
    const r = await pool.query<{ n: string }>(
      `SELECT COALESCE(SUM(tx_count), 0)::bigint::text AS n
       FROM packed.blocks
       WHERE height > $1 AND height <= $2 AND tx_count IS NOT NULL`,
      [prevH, maxH]
    );
    n = prevN + (countFromNumericText(r.rows[0]?.n ?? "0") ?? 0);
  } else {
    const r = await pool.query<{ n: string }>(
      `SELECT COALESCE(SUM(tx_count), 0)::bigint::text AS n
       FROM packed.blocks WHERE tx_count IS NOT NULL`
    );
    n = countFromNumericText(r.rows[0]?.n ?? "0");
  }
  if (n == null) return null;
  if (n !== prevN || maxH !== prevH) {
    await upsertIndexerState(pool, TX_TOTAL_KEY, String(n));
    await upsertIndexerState(pool, TX_TOTAL_H_KEY, String(maxH));
  }
  return n;
}

async function buildDayWindow(
  pool: Pool,
  txPerDay: number | null,
  height: number
): Promise<{
  circulating: number | null;
  maxSupply: number;
  avgBlockMs: number | null;
  stats24h: {
    blocks: number | null;
    avgBlockMs: number | null;
    coinsMined: number | null;
    txs: number | null;
    feesErg: number | null;
    outputErg: number | null;
    minerRevenueErg: number | null;
    feeSharePct: number | null;
  };
}> {
  const since = Date.now() - SPARK_DAY_MS;
  const day = await pool.query<{
    blocks: string;
    t0: string | null;
    t1: string | null;
    txs: string;
    fee_nano: string;
  }>(
    `SELECT COUNT(*)::text AS blocks,
            MIN(timestamp_ms)::text AS t0,
            MAX(timestamp_ms)::text AS t1,
            COALESCE(SUM(tx_count), 0)::bigint::text AS txs,
            (SELECT COALESCE(SUM(fee), 0)::bigint::text
             FROM packed.transactions
             WHERE timestamp_ms >= $1 AND fee IS NOT NULL) AS fee_nano
     FROM packed.blocks
     WHERE timestamp_ms >= $1`,
    [since]
  );
  const row = day.rows[0];
  const blocks = countFromNumericText(row?.blocks ?? "0");
  const t0 = countFromNumericText(row?.t0 ?? "");
  const t1 = countFromNumericText(row?.t1 ?? "");
  const txs = countFromNumericText(row?.txs ?? "0");
  const feesErg = nanoTextToErg(row?.fee_nano ?? "0");
  let avgBlockMs: number | null = null;
  if (t0 != null && t1 != null && blocks != null && blocks > 1 && t1 > t0) {
    avgBlockMs = Math.round((t1 - t0) / (blocks - 1));
  }
  const heights = await pool.query<{ height: string }>(
    `SELECT height::text AS height FROM packed.blocks WHERE timestamp_ms >= $1`,
    [since]
  );
  let coinsNano = 0n;
  for (const r of heights.rows) {
    const h = countFromNumericText(r.height);
    if (h != null) coinsNano += emissionAtHeight(h);
  }
  const coinsMined = nanoToErgWhole(coinsNano);
  const feesNano = (() => {
    const s = String(row?.fee_nano ?? "0").trim();
    return /^\d+$/.test(s) ? BigInt(s) : 0n;
  })();
  const minerRevenueErg = nanoToErgWhole(coinsNano + feesNano);
  let feeSharePct: number | null = null;
  if (coinsNano + feesNano > 0n) {
    feeSharePct = Number((feesNano * 10000n) / (coinsNano + feesNano)) / 100;
  }
  return {
    circulating: circulatingErgAtHeight(height),
    maxSupply: MAX_SUPPLY_ERG,
    avgBlockMs,
    stats24h: {
      blocks,
      avgBlockMs,
      coinsMined,
      txs: txs ?? txPerDay,
      feesErg,
      outputErg: null,
      minerRevenueErg,
      feeSharePct,
    },
  };
}

async function upsert(
  pool: Pool,
  key: string,
  payload: unknown,
  height: number
): Promise<void> {
  await pool.query(
    `INSERT INTO snapshot_kv (key, payload, height, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET
       payload = EXCLUDED.payload,
       height = EXCLUDED.height,
       updated_at = now()`,
    [key, JSON.stringify(payload), height]
  );
}

let snapshotSchemaReady: Promise<void> | null = null;

/** Once per process. ADD COLUMN IF NOT EXISTS takes AccessExclusive even when the column exists. */
export async function ensureSnapshotSchema(pool: Pool): Promise<void> {
  if (!snapshotSchemaReady) {
    snapshotSchemaReady = applySnapshotSchema(pool).catch((err: unknown) => {
      snapshotSchemaReady = null;
      throw err;
    });
  }
  await snapshotSchemaReady;
}

async function applySnapshotSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshot_kv (
      key         TEXT PRIMARY KEY,
      payload     JSONB NOT NULL,
      height      BIGINT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  if (textChainHeadersEnabled()) {
    await pool.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS input_count INT,
        ADD COLUMN IF NOT EXISTS output_count INT,
        ADD COLUMN IF NOT EXISTS value_nano NUMERIC,
        ADD COLUMN IF NOT EXISTS shape TEXT,
        ADD COLUMN IF NOT EXISTS protocol TEXT,
        ADD COLUMN IF NOT EXISTS rule_id TEXT,
        ADD COLUMN IF NOT EXISTS rules_version INT
    `);
    await pool.query(`
      ALTER TABLE blocks
        ADD COLUMN IF NOT EXISTS miner_pk TEXT,
        ADD COLUMN IF NOT EXISTS miner_address TEXT,
        ADD COLUMN IF NOT EXISTS fee_nano NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS value_nano NUMERIC NOT NULL DEFAULT 0
    `);
  }
  await pool.query(`
    ALTER TABLE tokens
      ADD COLUMN IF NOT EXISTS last_height BIGINT,
      ADD COLUMN IF NOT EXISTS holders INT,
      ADD COLUMN IF NOT EXISTS tx_count INT,
      ADD COLUMN IF NOT EXISTS unspent_boxes INT,
      ADD COLUMN IF NOT EXISTS stats_height BIGINT
  `);
}

export type HomePoolShare = {
  name: string;
  blocks: number;
  share: number;
  address?: string;
};

const SHARE_TOP = 8;

/** Fill miner_address for the 24h window from the Autolykos `88…` output of tx 0. */
async function backfillMinerAddresses(pool: Pool, sinceMs: number): Promise<void> {
  await pool.query(
    `UPDATE packed.blocks b
     SET miner_address = sub.address
     FROM (
       SELECT DISTINCT ON (t.height)
         t.height,
         ad.address
       FROM packed.transactions t
       JOIN packed.boxes bx ON bx.creation_tx_id = t.id
       JOIN packed.addr ad ON ad.id = bx.addr_id
       WHERE t.index_in_block = 0
         AND t.timestamp_ms >= $1
         AND ad.address LIKE '88%'
       ORDER BY t.height, bx.value_nano DESC NULLS LAST
     ) sub
     WHERE b.height = sub.height
       AND b.timestamp_ms >= $1
       AND b.miner_address IS DISTINCT FROM sub.address`,
    [sinceMs]
  );
}

async function countP2pkHolders(pool: Pool): Promise<number | null> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM address_summary
     WHERE nanoerg > 0
       AND address LIKE '9%'
       AND length(address) < 70`
  );
  return countFromNumericText(r.rows[0]?.n ?? "");
}

/** P2PK with ERG whose first indexed height falls in the last ~30 days. */
async function countP2pkHoldersMonth(
  pool: Pool,
  tip: number,
  avgBlockMs: number | null
): Promise<number | null> {
  const blockMs = avgBlockMs != null && avgBlockMs > 0 ? avgBlockMs : 120_000;
  const back = Math.max(1, Math.round((30 * 24 * 60 * 60 * 1000) / blockMs));
  const since = Math.max(0, tip - back);
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM address_summary
     WHERE first_height >= $1
       AND nanoerg > 0
       AND address LIKE '9%'
       AND length(address) < 70`,
    [since]
  );
  return countFromNumericText(r.rows[0]?.n ?? "");
}

async function buildMinerShares(
  pool: Pool
): Promise<{ pools: HomePoolShare[]; minerCount: number }> {
  const since = Date.now() - SPARK_DAY_MS;
  try {
    await backfillMinerAddresses(pool, since);
  } catch (e) {
    console.warn("[indexer] miner address backfill", String(e));
  }
  const r = await pool.query<{ address: string; n: string }>(
    `SELECT miner_address AS address, COUNT(*)::text AS n
     FROM packed.blocks
     WHERE timestamp_ms >= $1 AND miner_address IS NOT NULL AND miner_address <> ''
     GROUP BY miner_address
     ORDER BY COUNT(*) DESC`,
    [since]
  );
  const rows: { address: string; blocks: number }[] = [];
  let total = 0;
  for (const row of r.rows) {
    const blocks = countFromNumericText(row.n);
    if (blocks == null || blocks <= 0 || !row.address) continue;
    rows.push({ address: row.address, blocks });
    total += blocks;
  }
  if (!total) return { pools: [], minerCount: 0 };
  const out: HomePoolShare[] = [];
  let rest = 0;
  rows.forEach((row, i) => {
    if (i < SHARE_TOP) {
      out.push({
        name: minerName(row.address),
        blocks: row.blocks,
        share: row.blocks / total,
        address: row.address,
      });
    } else {
      rest += row.blocks;
    }
  });
  if (rest > 0) {
    out.push({ name: "other", blocks: rest, share: rest / total });
  }
  return { pools: out, minerCount: rows.length };
}

async function buildIndexerStatus(pool: Pool, tip: number) {
  const rows = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM indexer_state"
  );
  const map = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
  const lastHeight = map.last_height ? Number(map.last_height) : null;
  const minHeight = map.min_height ? Number(map.min_height) : null;
  const tipSeen = map.tip_seen ? Number(map.tip_seen) : tip;
  const maxH = lastHeight;
  const span =
    minHeight != null && maxH != null && maxH >= minHeight
      ? maxH - minHeight + 1
      : null;
  const backfillTarget = map.backfill_target != null ? Number(map.backfill_target) : 0;
  let backfillPct: number | null = null;
  if (tip > 0 && minHeight != null) {
    const denom = Math.max(1, tip - backfillTarget);
    const done = Math.max(0, tip - minHeight);
    backfillPct = Math.min(99.99, Math.round((done / denom) * 10000) / 100);
    if (minHeight <= backfillTarget) backfillPct = 100;
  }
  return {
    enabled: true,
    ok: lastHeight != null && lastHeight > 0,
    lastHeight,
    minHeight,
    tipSeen,
    tipHeight: tip,
    mode: map.mode ?? null,
    lag: lastHeight != null ? tip - lastHeight : null,
    span,
    boxCount: map.box_count ? Number(map.box_count) : null,
    unspentCount: map.unspent_count ? Number(map.unspent_count) : null,
    tokenCount: map.token_count ? Number(map.token_count) : null,
    diskFreeGb: map.disk_free_gb ? Number(map.disk_free_gb) : null,
    backfillTarget,
    backfillPct,
    utxoIndexed: true,
    addressIndex: true,
    mempoolOk: true,
    ts: Date.now(),
  };
}

/**
 * Backfill NULL / stale-version shapes on the recent tape. Must not sit on
 * the snapshot write path: a slow boxes UNION would freeze home/blocks/txs.
 * Short statement_timeout; skip on error/timeout; caller skips backfill ticks.
 */
export async function maybeFillRecentTxShapes(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${SHAPE_FILL_TIMEOUT_MS}`);
    const heads = await client.query<{ id: string; index_in_block: number | null }>(
      `SELECT encode(id, 'hex') AS id, index_in_block
       FROM packed.transactions
       WHERE height IS NOT NULL
         AND height >= (SELECT COALESCE(MAX(height), 0) FROM packed.blocks) - $2
         AND (
           shape IS NULL
           OR rules_version IS NULL
           OR rules_version < $3
         )
       ORDER BY height DESC, index_in_block DESC NULLS LAST
       LIMIT $1`,
      [SHAPE_FILL_N, SHAPE_FILL_WINDOW, TX_SHAPE_RULES_VERSION]
    );
    if (!heads.rows.length) {
      await client.query("COMMIT");
      return;
    }
    const ids = heads.rows.map((r) => r.id);
    const coinbase = new Set(
      heads.rows.filter((r) => r.index_in_block === 0).map((r) => r.id)
    );
    const boxRows = await client.query<{
      tx_id: string;
      io: string;
      ergo_tree: string | null;
      address: string | null;
      box_id: string;
    }>(
      `
      SELECT encode(b.creation_tx_id, 'hex') AS tx_id, 'out' AS io,
             sc.ergo_tree, ad.address, encode(b.box_id, 'hex') AS box_id
        FROM packed.boxes b
        LEFT JOIN packed.addr ad ON ad.id = b.addr_id
        LEFT JOIN packed.script sc ON sc.id = b.script_id
       WHERE b.creation_tx_id IN (
               SELECT decode(lower(x), 'hex')
                 FROM unnest($1::text[]) AS x
                WHERE x ~ '^[0-9a-fA-F]{64}$'
             )
      UNION ALL
      SELECT encode(b.spent_tx_id, 'hex'), 'in', sc.ergo_tree, ad.address,
             encode(b.box_id, 'hex')
        FROM packed.boxes b
        LEFT JOIN packed.addr ad ON ad.id = b.addr_id
        LEFT JOIN packed.script sc ON sc.id = b.script_id
       WHERE b.spent_tx_id IN (
               SELECT decode(lower(x), 'hex')
                 FROM unnest($1::text[]) AS x
                WHERE x ~ '^[0-9a-fA-F]{64}$'
             )
      `,
      [ids]
    );
    const boxIds = [...new Set(boxRows.rows.map((r) => r.box_id))];
    const assetRows = boxIds.length
      ? await client.query<{ box_id: string; token_id: string; amount: string }>(
          `SELECT encode(box_id, 'hex') AS box_id,
                  encode(token_id, 'hex') AS token_id,
                  amount::text AS amount
             FROM packed.box_assets
            WHERE box_id IN (
                    SELECT decode(lower(x), 'hex')
                      FROM unnest($1::text[]) AS x
                     WHERE x ~ '^[0-9a-fA-F]{64}$'
                  )`,
          [boxIds]
        )
      : { rows: [] as { box_id: string; token_id: string; amount: string }[] };
    const assetsByBox = new Map<string, NonNullable<ShapeBox["assets"]>>();
    for (const a of assetRows.rows) {
      const list = assetsByBox.get(a.box_id) ?? [];
      list.push({ tokenId: a.token_id, amount: a.amount });
      assetsByBox.set(a.box_id, list);
    }
    const ins = new Map<string, ShapeBox[]>();
    const outs = new Map<string, ShapeBox[]>();
    for (const r of boxRows.rows) {
      const box: ShapeBox = {
        ergoTree: r.ergo_tree,
        address: r.address,
        assets: assetsByBox.get(r.box_id) ?? [],
      };
      const m = r.io === "in" ? ins : outs;
      const list = m.get(r.tx_id) ?? [];
      list.push(box);
      m.set(r.tx_id, list);
    }
    const shapedIds: string[] = [];
    const shapes: string[] = [];
    const protocols: string[] = [];
    const ruleIds: string[] = [];
    const vers: number[] = [];
    for (const row of heads.rows) {
      const shaped = classifyTxShape({
        coinbase: coinbase.has(row.id),
        inputs: ins.get(row.id) ?? [],
        outputs: outs.get(row.id) ?? [],
      });
      shapedIds.push(row.id);
      shapes.push(shaped.shape);
      protocols.push(shaped.protocol ?? "");
      ruleIds.push(shaped.ruleId);
      vers.push(TX_SHAPE_RULES_VERSION);
    }
    if (textChainHeadersEnabled()) {
      await client.query(
        `UPDATE transactions t SET
           shape = v.shape,
           protocol = NULLIF(v.protocol, ''),
           rule_id = v.rule_id,
           rules_version = v.ver
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[])
           AS v(id, shape, protocol, rule_id, ver)
         WHERE t.id = v.id`,
        [shapedIds, shapes, protocols, ruleIds, vers]
      );
    }
    await client.query(
      `UPDATE packed.transactions t SET
         shape = v.shape,
         protocol = NULLIF(v.protocol, ''),
         rule_id = v.rule_id,
         rules_version = v.ver
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[])
         AS v(id, shape, protocol, rule_id, ver)
       WHERE t.id = packed.hex32(v.id)`,
      [shapedIds, shapes, protocols, ruleIds, vers]
    );
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn("[indexer] tx shape fill", String(e));
  } finally {
    client.release();
  }
  const ms = Date.now() - t0;
  if (ms > 400) console.warn(`[indexer] tx shape fill ${ms}ms`);
}

/** Same windows as SigmaSpace. Constants match packages/shared rent.ts — indexer has no shared dep. */
const RENT_PERIOD = 1_051_200;
const RENT_FEE = 1_250_000;
const RENT_24H = 720;
const RENT_7D = 5040;
const RENT_30D = 21600;

async function rentWindowAgg(
  client: pg.PoolClient,
  tip: number,
  lo: number,
  hi: number,
  blocks: number
): Promise<{
  blocks: number;
  boxCount: number;
  rentNano: string;
  valueNano: string;
  inIndex: boolean;
}> {
  const r = await client.query<{ n: string; rent_nano: string; value_nano: string }>(
    `SELECT COUNT(*)::text AS n,
            COALESCE(SUM(value_nano), 0)::text AS value_nano,
            COALESCE(SUM(
              GREATEST(1, FLOOR(($1::numeric - creation_height) / $2))
              * $3
              * GREATEST(40, COALESCE(tree_bytes, 0) + 16)
            ), 0)::text AS rent_nano
     FROM packed.boxes
     WHERE spent_tx_id IS NULL
       AND creation_height IS NOT NULL
       AND creation_height > $4
       AND creation_height <= $5`,
    [tip, RENT_PERIOD, RENT_FEE, lo, hi]
  );
  const row = r.rows[0];
  return {
    blocks,
    boxCount: n(row?.n),
    rentNano: row?.rent_nano ?? "0",
    valueNano: row?.value_nano ?? "0",
    inIndex: true,
  };
}

function coverRentWindow<T extends { inIndex: boolean }>(
  w: T,
  windowHi: number,
  minHeight: number | null
): T {
  return { ...w, inIndex: minHeight == null || windowHi >= minHeight };
}

/**
 * Oldest-first probe (LIMIT HOME_RENT_PROBE), unique addresses until HOME_RENT_TAPE (15), then aggregate those.
 * Own timeout — not inside the KPI 2500ms transaction. Failure → undefined (omit key).
 */
async function readRentTape(pool: Pool, tip: number, dueHeight: number): Promise<RentTapeRow[] | undefined> {
  const epochLeft = ERGO_HEADER_EPOCH_LEN - (tip % ERGO_HEADER_EPOCH_LEN);
  const windowLo = dueHeight;
  const windowHi = dueHeight + epochLeft;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 1800");
    const probe = await c.query<{ address: string }>(
      `SELECT ad.address
       FROM packed.boxes b
       JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.spent_tx_id IS NULL
         AND b.creation_height IS NOT NULL
         AND b.creation_height > $1
         AND b.creation_height <= $2
         AND ad.address IS NOT NULL
       ORDER BY b.creation_height ASC
       LIMIT $3`,
      [windowLo, windowHi, HOME_RENT_PROBE]
    );
    const addrs = pickRentTapeAddresses(probe.rows);
    if (!addrs.length) {
      await c.query("COMMIT");
      return [];
    }
    const agg = await c.query<{
      address: string;
      box_count: string;
      oldest_creation_height: string;
      value_nano: string;
      rent_nano: string;
    }>(
      `SELECT ad.address,
              COUNT(*)::text AS box_count,
              MIN(b.creation_height)::text AS oldest_creation_height,
              COALESCE(SUM(b.value_nano), 0)::text AS value_nano,
              COALESCE(SUM(
                GREATEST(1, FLOOR(($1::numeric - b.creation_height) / $2))
                * $3
                * GREATEST(40, COALESCE(b.tree_bytes, 0) + 16)
              ), 0)::text AS rent_nano
       FROM packed.boxes b
       JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.spent_tx_id IS NULL
         AND b.creation_height IS NOT NULL
         AND b.creation_height > $4
         AND b.creation_height <= $5
         AND ad.address = ANY($6::text[])
       GROUP BY ad.address`,
      [tip, RENT_PERIOD, RENT_FEE, windowLo, windowHi, addrs]
    );
    await c.query("COMMIT");
    const byAddr = new Map(agg.rows.map((r) => [r.address, r]));
    const out: RentTapeRow[] = [];
    for (const address of addrs) {
      const r = byAddr.get(address);
      if (!r) continue;
      const oldestCreationHeight = n(r.oldest_creation_height);
      const boxCount = Math.max(1, n(r.box_count));
      out.push({
        address,
        boxCount,
        oldestCreationHeight,
        blocksUntilRent: Math.max(0, oldestCreationHeight + RENT_PERIOD - tip),
        rentNano: r.rent_nano ?? "0",
        valueNano: r.value_nano ?? "0",
      });
    }
    return out;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] rent tape", String(e));
    return undefined;
  } finally {
    c.release();
  }
}

async function readRentKpis(pool: Pool, tip: number, dueHeight: number): Promise<Record<string, unknown>> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 2500");
    const due = await rentWindowAgg(c, tip, -1, dueHeight, 0);
    const epochLeft = ERGO_HEADER_EPOCH_LEN - (tip % ERGO_HEADER_EPOCH_LEN);
    const epochHi = dueHeight + epochLeft;
    // This header epoch only — not the years-overdue pile (lo=-1).
    const thisEpoch = await rentWindowAgg(c, tip, dueHeight, epochHi, epochLeft);
    const next24h = await rentWindowAgg(c, tip, dueHeight, dueHeight + RENT_24H, RENT_24H);
    const next7d = await rentWindowAgg(c, tip, dueHeight, dueHeight + RENT_7D, RENT_7D);
    const next30d = await rentWindowAgg(c, tip, dueHeight, dueHeight + RENT_30D, RENT_30D);
    const oldest = await c.query<{ h: string | null }>(
      `SELECT creation_height::text AS h
       FROM packed.boxes
       WHERE spent_tx_id IS NULL AND creation_height IS NOT NULL
       ORDER BY creation_height ASC
       LIMIT 1`
    );
    const minR = await c.query<{ v: string }>(
      `SELECT value FROM indexer_state WHERE key = 'min_height'`
    );
    await c.query("COMMIT");
    const oldestCreationHeight = oldest.rows[0]?.h != null ? n(oldest.rows[0].h) : null;
    // "0" is genesis. n() is fine; do not treat 0 as missing (?? is ok, || is not).
    const minRaw = minR.rows[0]?.v;
    const minParsed = minRaw == null || minRaw === "" ? NaN : Number(minRaw);
    const minHeight = Number.isFinite(minParsed) ? minParsed : oldestCreationHeight;
    const blocksUntilFirst =
      oldestCreationHeight != null
        ? Math.max(0, oldestCreationHeight + RENT_PERIOD - tip)
        : null;
    return {
      tipHeight: tip,
      minHeight,
      dueHeight,
      periodBlocks: RENT_PERIOD,
      storageFeeFactor: RENT_FEE,
      due: coverRentWindow(due, dueHeight, minHeight),
      thisEpoch: coverRentWindow(thisEpoch, epochHi, minHeight),
      next24h: coverRentWindow(next24h, dueHeight + RENT_24H, minHeight),
      next7d: coverRentWindow(next7d, dueHeight + RENT_7D, minHeight),
      next30d: coverRentWindow(next30d, dueHeight + RENT_30D, minHeight),
      oldestCreationHeight,
      blocksUntilFirst,
    };
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* */
    }
    throw e;
  } finally {
    c.release();
  }
}

/** null means the read failed, so the caller keeps the last forecast. */
async function readRentForecast(
  pool: Pool,
  tip: number,
  dueHeight: number
): Promise<{ t: number; boxes: number; rentNano: string }[] | null> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 2000");
    const tipRow = await c.query<{ t: string }>(
      `SELECT timestamp_ms::text AS t FROM packed.blocks WHERE height = $1`,
      [tip]
    );
    const tipMs = Number(tipRow.rows[0]?.t);
    if (!Number.isFinite(tipMs) || tipMs <= 0) {
      await c.query("ROLLBACK");
      return null;
    }
    const r = await c.query<{ t: string; boxes: number; rent_nano: string }>(
      `SELECT ((($1::bigint + (creation_height + $2 - $3) * 120000) / 86400000) * 86400000)::bigint::text AS t,
              COUNT(*)::int AS boxes,
              COALESCE(SUM(
                GREATEST(1, FLOOR(($3::numeric - creation_height) / $2))
                * $4
                * GREATEST(40, COALESCE(tree_bytes, 0) + 16)
              ), 0)::text AS rent_nano
       FROM packed.boxes
       WHERE spent_tx_id IS NULL
         AND creation_height IS NOT NULL
         AND creation_height > $5
         AND creation_height <= $6
       GROUP BY 1
       ORDER BY 1`,
      [tipMs, RENT_PERIOD, tip, RENT_FEE, dueHeight, dueHeight + RENT_30D]
    );
    await c.query("COMMIT");
    return r.rows
      .map((row) => ({
        t: Number(row.t),
        boxes: row.boxes,
        rentNano: row.rent_nano,
      }))
      .filter((p) => Number.isFinite(p.t) && p.t > 0);
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] rent forecast", String(e));
    return null;
  } finally {
    c.release();
  }
}

/** Oracle pool NFTs, oracle tokens, and the known protocol set. */
function protocolTokenIds(): string[] {
  const ids = new Set<string>(Object.keys(KNOWN_TOKENS).map((id) => id.toLowerCase()));
  for (const feed of Object.values(ORACLE_FEEDS)) {
    ids.add(feed.poolNft.toLowerCase());
    ids.add(feed.oracleToken.toLowerCase());
  }
  for (const id of ERG_USD_ORACLE_NFTS) ids.add(id.toLowerCase());
  return [...ids].filter((id) => /^[0-9a-f]{64}$/.test(id));
}

/**
 * Tokens short on rent in the next 7 days.
 * A 30-day window is about four times the unspent boxes, and a fresh price
 * scan walks the whole tick table. Prices stay cached for 10 minutes.
 * The box list refreshes at most every two minutes, then the page reads it
 * from the snapshot.
 */
const DANGER_EVERY_MS = 120_000;
const PRICE_EVERY_MS = 600_000;
/** A thinner pool cannot price a rent box. Elehmental Book sat at $32M off an 11 ERG pool. Flux is ~64. */
const DANGER_MIN_POOL_TVL_ERG = 50;
let dangerCache: { at: number; rows: Record<string, unknown>[] } | null = null;
let priceCache: { at: number; usd: Map<string, number> } | null = null;

async function pricedTokenUsd(pool: Pool): Promise<Map<string, number>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_EVERY_MS) return priceCache.usd;
  // Latest priced tick per token, skipping along the (token_id, ts_ms) key. DISTINCT ON sorted the
  // whole 14-day table on disk (1.3M rows, 136 MB temp) to keep about 120 rows.
  const r = await pool.query<{ token_id: string; price_usd: string }>(
    `WITH RECURSIVE t AS (
       (SELECT token_id FROM defi.price_tick ORDER BY token_id LIMIT 1)
       UNION ALL
       SELECT (SELECT p.token_id FROM defi.price_tick p
                WHERE p.token_id > t.token_id ORDER BY p.token_id LIMIT 1)
         FROM t WHERE t.token_id IS NOT NULL
     )
     SELECT lower(t.token_id) AS token_id, l.price_usd::text AS price_usd
       FROM t
       CROSS JOIN LATERAL (
         SELECT p.price_usd FROM defi.price_tick p
          WHERE p.token_id = t.token_id
            AND p.price_usd IS NOT NULL AND p.price_usd > 0
            AND p.tvl_erg >= ${DANGER_MIN_POOL_TVL_ERG}
          ORDER BY p.ts_ms DESC LIMIT 1
       ) l
      WHERE t.token_id IS NOT NULL AND t.token_id ~ '^[0-9a-fA-F]{64}$'`
  );
  const usd = new Map<string, number>();
  for (const row of r.rows) {
    const n = Number(row.price_usd);
    if (Number.isFinite(n) && n > 0) usd.set(row.token_id, n);
  }
  priceCache = { at: Date.now(), usd };
  return usd;
}

async function readRentDanger(
  pool: Pool,
  tip: number,
  dueHeight: number
): Promise<Record<string, unknown>[] | null> {
  if (dangerCache && Date.now() - dangerCache.at < DANGER_EVERY_MS) return dangerCache.rows;
  const prices = await pricedTokenUsd(pool);
  const protocol = new Set(protocolTokenIds());
  const ids = [...new Set([...prices.keys(), ...protocol])];
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 25000");
    await c.query("SET LOCAL jit = off");
    await c.query("SET LOCAL max_parallel_workers_per_gather = 0");
    const r = await c.query<{
      box_id: string;
      value_nano: string;
      creation_height: string;
      tree_bytes: string | null;
      addr_id: string | null;
      token_id: string;
      amount: string;
    }>(
      `SELECT encode(b.box_id, 'hex') AS box_id,
              b.value_nano::text AS value_nano,
              b.creation_height::text AS creation_height,
              COALESCE(b.tree_bytes, 0)::text AS tree_bytes,
              b.addr_id::text AS addr_id,
              encode(a.token_id, 'hex') AS token_id,
              a.amount::text AS amount
         FROM packed.boxes b
         -- Per window box by box_id. OFFSET 0 and the token test outside keep the planner from
         -- reading every box_assets row of 100+ priced tokens (14M rows, 15 s) or probing per token.
         CROSS JOIN LATERAL (
           SELECT x.token_id, x.amount FROM packed.box_assets x WHERE x.box_id = b.box_id OFFSET 0
         ) a
        WHERE b.spent_tx_id IS NULL
          AND b.creation_height IS NOT NULL
          AND b.creation_height > $1
          AND b.creation_height <= $2
          AND a.token_id = ANY($3::bytea[])
        ORDER BY b.creation_height, b.box_id, a.token_id`,
      [dueHeight, dueHeight + RENT_7D, ids.map((id) => Buffer.from(id, "hex"))]
    );
    await c.query("COMMIT");
    const tokenIds = [...new Set(r.rows.map((row) => row.token_id.toLowerCase()))];
    const meta = new Map<string, { name: string | null; decimals: number | null }>();
    if (tokenIds.length) {
      const names = await c.query<{ token_id: string; name: string | null; decimals: string | null }>(
        `SELECT lower(token_id) AS token_id, name, decimals::text AS decimals
           FROM tokens
          WHERE lower(token_id) = ANY($1::text[])`,
        [tokenIds]
      );
      for (const row of names.rows) {
        meta.set(row.token_id, {
          name: row.name,
          decimals: row.decimals != null ? n(row.decimals) : null,
        });
      }
    }
    type Ranked = { usd: number; short: bigint; addrId: string | null; row: Record<string, unknown> };
    const priced: Ranked[] = [];
    const plain: Ranked[] = [];
    for (const row of r.rows) {
      const creationHeight = n(row.creation_height);
      const size = Math.max(40, n(row.tree_bytes) + 16);
      const periods = Math.max(1, Math.floor(Math.max(0, tip - creationHeight) / RENT_PERIOD));
      const rent = BigInt(periods) * BigInt(RENT_FEE) * BigInt(size);
      let value = 0n;
      try {
        value = BigInt(row.value_nano || "0");
      } catch {
        continue;
      }
      if (value >= rent) continue;
      const tokenId = row.token_id.toLowerCase();
      const priceUsd = prices.get(tokenId) ?? 0;
      const pricedOk = priceUsd > 0;
      const known = meta.get(tokenId);
      const dec = known?.decimals ?? 0;
      let usd = 0;
      if (pricedOk) {
        try {
          const raw = BigInt(row.amount || "0");
          const base = 10n ** BigInt(Math.max(0, dec));
          usd = (Number(raw / base) + Number(raw % base) / Number(base || 1n)) * priceUsd;
        } catch {
          usd = 0;
        }
      }
      const item: Ranked = {
        usd,
        short: rent - value,
        addrId: row.addr_id,
        row: {
          boxId: row.box_id,
          address: null,
          tokenId,
          name: known?.name ?? null,
          amount: row.amount,
          decimals: known?.decimals ?? null,
          priceUsd: pricedOk ? priceUsd : 0,
          valueNano: row.value_nano,
          rentNano: rent.toString(),
          shortfallNano: (rent - value).toString(),
          blocksUntilRent: Math.max(0, creationHeight + RENT_PERIOD - tip),
        },
      };
      if (pricedOk && usd > 0) priced.push(item);
      else if (protocol.has(tokenId)) plain.push(item);
    }
    const byRank = (a: Ranked, b: Ranked) => {
      if (b.usd !== a.usd) return b.usd - a.usd;
      if (a.short !== b.short) return a.short > b.short ? -1 : 1;
      const ab = String(a.row.boxId);
      const bb = String(b.row.boxId);
      if (ab !== bb) return ab < bb ? -1 : 1;
      const at = String(a.row.tokenId);
      const bt = String(b.row.tokenId);
      return at < bt ? -1 : at > bt ? 1 : 0;
    };
    priced.sort(byRank);
    plain.sort(byRank);
    const shown = [...priced.slice(0, 30), ...plain.slice(0, 10)];
    const addrIds = [...new Set(shown.map((item) => item.addrId).filter((id): id is string => id != null))];
    if (addrIds.length) {
      const owners = await c.query<{ id: string; address: string }>(
        `SELECT id::text AS id, address FROM packed.addr WHERE id = ANY($1::bigint[])`,
        [addrIds]
      );
      const byId = new Map(owners.rows.map((o) => [o.id, o.address]));
      for (const item of shown) item.row.address = byId.get(item.addrId ?? "") ?? null;
    }
    const rows = shown.map((item) => item.row);
    dangerCache = { at: Date.now(), rows };
    console.log(`[indexer] rent danger 7d priced=${priced.length} protocol=${plain.length} shown=${rows.length}`);
    return rows;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] rent danger", String(e));
    dangerCache = { at: Date.now(), rows: dangerCache?.rows ?? [] };
    return dangerCache.rows.length ? dangerCache.rows : null;
  } finally {
    c.release();
  }
}

const RENT_PAGE_N = 25;

function minerLabel(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 2)}…${address.slice(-8)}`;
}

function packClaimers(input: {
  boxCount: number;
  rentNano: string;
  coveredBoxes: number;
  coveredRentNano: string;
  claimerCount: number;
  pools: { address: string; boxCount: number; rentNano: string }[];
}): Record<string, unknown> {
  let total = 0n;
  try {
    total = BigInt(input.rentNano || "0");
  } catch {
    total = 0n;
  }
  const pools = [...input.pools]
    .filter((p) => p.address)
    .sort((a, b) => {
      try {
        const d = BigInt(b.rentNano || "0") - BigInt(a.rentNano || "0");
        return d > 0n ? 1 : d < 0n ? -1 : 0;
      } catch {
        return 0;
      }
    })
    .slice(0, 24)
    .map((p) => {
      let share = 0;
      try {
        share = total > 0n ? Number((BigInt(p.rentNano || "0") * 100_000n) / total) / 100_000 : 0;
      } catch {
        share = 0;
      }
      return {
        address: p.address,
        name: minerLabel(p.address),
        boxCount: p.boxCount,
        rentNano: p.rentNano,
        share,
      };
    });
  let uncoveredNano = "0";
  try {
    const left = total - BigInt(input.coveredRentNano || "0");
    uncoveredNano = left > 0n ? left.toString() : "0";
  } catch {
    uncoveredNano = "0";
  }
  return {
    boxCount: input.boxCount,
    rentNano: input.rentNano,
    coveredBoxes: input.coveredBoxes,
    coveredRentNano: input.coveredRentNano,
    uncoveredBoxes: Math.max(0, input.boxCount - input.coveredBoxes),
    uncoveredRentNano: uncoveredNano,
    claimerCount: input.claimerCount,
    pools,
  };
}

/** First page of due or ahead boxes. GET slices this instead of scanning. */
async function readRentBoxPage(
  pool: Pool,
  tip: number,
  dueHeight: number,
  mode: "due" | "ahead"
): Promise<Record<string, unknown>[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 8000");
    const where =
      mode === "due"
        ? `b.spent_tx_id IS NULL AND b.creation_height IS NOT NULL AND b.creation_height <= $1`
        : `b.spent_tx_id IS NULL AND b.creation_height IS NOT NULL
           AND b.creation_height > $1 AND b.creation_height <= $2`;
    const params =
      mode === "due" ? [dueHeight, RENT_PAGE_N] : [dueHeight, dueHeight + RENT_30D, RENT_PAGE_N];
    const lim = mode === "due" ? "$2" : "$3";
    const rows = await c.query<{
      box_id: string;
      address: string | null;
      value_nano: string;
      creation_height: string;
      creation_ts: string | null;
      ergo_tree: string | null;
      additional_registers: unknown;
    }>(
      `SELECT encode(b.box_id, 'hex') AS box_id, ad.address,
              b.value_nano::text AS value_nano,
              b.creation_height::text AS creation_height,
              bl.timestamp_ms::text AS creation_ts,
              sc.ergo_tree, b.additional_registers
       FROM packed.boxes b
       LEFT JOIN packed.addr ad ON ad.id = b.addr_id
       LEFT JOIN packed.script sc ON sc.id = b.script_id
       LEFT JOIN packed.blocks bl ON bl.height = b.creation_height
       WHERE ${where}
       ORDER BY b.creation_height ASC, b.box_id ASC
       LIMIT ${lim}`,
      params
    );
    const ids = rows.rows.map((r) => r.box_id);
    const tokensByBox = new Map<string, { tokenId: string; name: string | null }[]>();
    if (ids.length) {
      const tok = await c.query<{ box_id: string; token_id: string; name: string | null }>(
        `SELECT encode(a.box_id, 'hex') AS box_id,
                encode(a.token_id, 'hex') AS token_id, t.name
         FROM packed.box_assets a
         LEFT JOIN tokens t ON t.token_id = encode(a.token_id, 'hex')
         WHERE a.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
        [ids]
      );
      for (const r of tok.rows) {
        const list = tokensByBox.get(r.box_id) ?? [];
        list.push({ tokenId: r.token_id, name: r.name });
        tokensByBox.set(r.box_id, list);
      }
    }
    await c.query("COMMIT");
    return rows.rows.map((r) => {
      const creationHeight = n(r.creation_height);
      const tokens = tokensByBox.get(r.box_id) ?? [];
      const sizeBytes = estimateBoxSizeBytes({
        ergoTree: r.ergo_tree ?? "",
        assetsCount: tokens.length,
        registerBytes: registerPayloadBytes(r.additional_registers),
      });
      const blocksUntilRent = Math.max(0, creationHeight + RENT_PERIOD - tip);
      const periods = Math.max(1, Math.floor(Math.max(0, tip - creationHeight) / RENT_PERIOD));
      return {
        boxId: r.box_id,
        address: r.address,
        valueNano: r.value_nano,
        creationHeight,
        creationTs: r.creation_ts != null ? n(r.creation_ts) : null,
        tokenCount: tokens.length,
        tokens,
        sizeBytes: Math.max(40, sizeBytes),
        rentNano: (BigInt(periods) * BigInt(RENT_FEE) * BigInt(Math.max(40, sizeBytes))).toString(),
        blocksUntilRent,
        rentDue: blocksUntilRent === 0,
      };
    });
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn(`[indexer] rent ${mode} page`, String(e));
    return [];
  } finally {
    c.release();
  }
}

/** First history page plus collector shares. Not the block miner. */
async function readRentClaimsPack(pool: Pool, tip: number): Promise<Record<string, unknown> | null> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 8000");
    const dayLo = Math.max(0, tip - RENT_24H);
    const monthLo = Math.max(0, tip - RENT_30D);
    // Claimer counts come from the grouped pools query below. COUNT(DISTINCT) here would sort every claim on disk.
    const tot = await c.query<{
      n: number;
      nano: string;
      covered_n: number;
      covered_nano: string;
      day_n: number;
      day_nano: string;
      day_covered_n: number;
      day_covered_nano: string;
      month_n: number;
      month_nano: string;
      month_covered_n: number;
      month_covered_nano: string;
    }>(
      `SELECT
         COUNT(*)::int AS n,
         COALESCE(SUM(rent_nano), 0)::text AS nano,
         COUNT(*) FILTER (WHERE collector IS NOT NULL AND collector <> '')::int AS covered_n,
         COALESCE(SUM(rent_nano) FILTER (WHERE collector IS NOT NULL AND collector <> ''), 0)::text AS covered_nano,
         COUNT(*) FILTER (WHERE spent_height > $1)::int AS day_n,
         COALESCE(SUM(rent_nano) FILTER (WHERE spent_height > $1), 0)::text AS day_nano,
         COUNT(*) FILTER (WHERE spent_height > $1 AND collector IS NOT NULL AND collector <> '')::int AS day_covered_n,
         COALESCE(SUM(rent_nano) FILTER (WHERE spent_height > $1 AND collector IS NOT NULL AND collector <> ''), 0)::text AS day_covered_nano,
         COUNT(*) FILTER (WHERE spent_height > $2)::int AS month_n,
         COALESCE(SUM(rent_nano) FILTER (WHERE spent_height > $2), 0)::text AS month_nano,
         COUNT(*) FILTER (WHERE spent_height > $2 AND collector IS NOT NULL AND collector <> '')::int AS month_covered_n,
         COALESCE(SUM(rent_nano) FILTER (WHERE spent_height > $2 AND collector IS NOT NULL AND collector <> ''), 0)::text AS month_covered_nano
       FROM rent_collected
       WHERE kind = 'protocol'`,
      [dayLo, monthLo]
    );
    const pools = await c.query<{
      address: string;
      n: number;
      nano: string;
      day_n: number;
      day_nano: string;
      month_n: number;
      month_nano: string;
    }>(
      `SELECT collector AS address,
              COUNT(*)::int AS n,
              SUM(rent_nano)::text AS nano,
              COUNT(*) FILTER (WHERE spent_height > $1)::int AS day_n,
              COALESCE(SUM(rent_nano) FILTER (WHERE spent_height > $1), 0)::text AS day_nano,
              COUNT(*) FILTER (WHERE spent_height > $2)::int AS month_n,
              COALESCE(SUM(rent_nano) FILTER (WHERE spent_height > $2), 0)::text AS month_nano
       FROM rent_collected
       WHERE kind = 'protocol' AND collector IS NOT NULL AND collector <> ''
       GROUP BY collector`,
      [dayLo, monthLo]
    );
    const recent = await c.query<{
      box_id: string;
      collector: string | null;
      owner: string | null;
      rent_nano: string;
      spent_height: string;
      spent_ts: string | null;
    }>(
      `SELECT rc.box_id, rc.collector,
              ad.address AS owner,
              rc.rent_nano::text AS rent_nano,
              rc.spent_height::text AS spent_height,
              bl.timestamp_ms::text AS spent_ts
       FROM rent_collected rc
       LEFT JOIN packed.boxes b
         ON length(rc.box_id) = 64
        AND b.box_id = decode(rc.box_id, 'hex')
       LEFT JOIN packed.addr ad ON ad.id = b.addr_id
       LEFT JOIN packed.blocks bl ON bl.height = rc.spent_height
       WHERE rc.kind = 'protocol'
       ORDER BY rc.spent_height DESC, rc.box_id DESC
       LIMIT $1`,
      [RENT_PAGE_N]
    );
    const ids = recent.rows.map((r) => r.box_id).filter((id) => /^[0-9a-fA-F]{64}$/.test(id));
    const tokensByBox = new Map<string, { tokenId: string; amount: string; name: string | null; decimals: number | null }[]>();
    if (ids.length) {
      const tok = await c.query<{
        box_id: string;
        token_id: string;
        amount: string;
        name: string | null;
        decimals: number | null;
      }>(
        `SELECT encode(ba.box_id, 'hex') AS box_id,
                encode(ba.token_id, 'hex') AS token_id,
                ba.amount::text AS amount,
                t.name, t.decimals
         FROM packed.box_assets ba
         LEFT JOIN tokens t ON t.token_id = encode(ba.token_id, 'hex')
         WHERE ba.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
        [ids]
      );
      for (const r of tok.rows) {
        const list = tokensByBox.get(r.box_id) ?? [];
        list.push({
          tokenId: r.token_id,
          amount: r.amount,
          name: r.name,
          decimals: r.decimals == null || !Number.isFinite(Number(r.decimals)) ? null : Number(r.decimals),
        });
        tokensByBox.set(r.box_id, list);
      }
    }
    await c.query("COMMIT");
    const row = tot.rows[0];
    if (!row) return null;
    const allPools = pools.rows.map((p) => ({
      address: p.address,
      boxCount: n(p.n),
      rentNano: p.nano || "0",
    }));
    return {
      recentTotal: n(row.n),
      recent: recent.rows.map((r) => ({
        boxId: r.box_id,
        collector: r.collector,
        owner: r.owner,
        rentNano: r.rent_nano,
        spentHeight: n(r.spent_height),
        spentTs: r.spent_ts != null && Number.isFinite(Number(r.spent_ts)) ? Number(r.spent_ts) : null,
        tokens: tokensByBox.get(r.box_id) ?? [],
      })),
      miners: packClaimers({
        boxCount: n(row.n),
        rentNano: row.nano || "0",
        coveredBoxes: n(row.covered_n),
        coveredRentNano: row.covered_nano || "0",
        claimerCount: pools.rows.length,
        pools: allPools,
      }),
      minersDay: packClaimers({
        boxCount: n(row.day_n),
        rentNano: row.day_nano || "0",
        coveredBoxes: n(row.day_covered_n),
        coveredRentNano: row.day_covered_nano || "0",
        claimerCount: pools.rows.filter((p) => n(p.day_n) > 0).length,
        pools: pools.rows
          .filter((p) => {
            try {
              return BigInt(p.day_nano || "0") > 0n;
            } catch {
              return false;
            }
          })
          .map((p) => ({ address: p.address, boxCount: n(p.day_n), rentNano: p.day_nano || "0" })),
      }),
      minersMonth: packClaimers({
        boxCount: n(row.month_n),
        rentNano: row.month_nano || "0",
        coveredBoxes: n(row.month_covered_n),
        coveredRentNano: row.month_covered_nano || "0",
        claimerCount: pools.rows.filter((p) => n(p.month_n) > 0).length,
        pools: pools.rows
          .filter((p) => {
            try {
              return BigInt(p.month_nano || "0") > 0n;
            } catch {
              return false;
            }
          })
          .map((p) => ({ address: p.address, boxCount: n(p.month_n), rentNano: p.month_nano || "0" })),
      }),
    };
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] rent claims page", String(e));
    return null;
  } finally {
    c.release();
  }
}

async function writeRentSnapshot(pool: Pool, tip: number): Promise<void> {
  const dueHeight = tip - RENT_PERIOD;
  const [payload, addresses, forecast, duePage, aheadPage, claims] = await Promise.all([
    readRentKpis(pool, tip, dueHeight),
    readRentTape(pool, tip, dueHeight),
    readRentForecast(pool, tip, dueHeight),
    readRentBoxPage(pool, tip, dueHeight, "due"),
    readRentBoxPage(pool, tip, dueHeight, "ahead"),
    readRentClaimsPack(pool, tip),
  ]);
  const danger = await readRentDanger(pool, tip, dueHeight);
  if (addresses) payload.addresses = addresses;
  if (forecast) {
    if (forecast.length >= 2) payload.forecast = forecast;
  } else {
    const prev = await pool.query<{ forecast: unknown }>(
      `SELECT payload->'forecast' AS forecast FROM snapshot_kv WHERE key = 'rent'`
    );
    const kept = prev.rows[0]?.forecast;
    if (Array.isArray(kept)) payload.forecast = kept as typeof payload.forecast;
  }
  if (danger) payload.danger = danger;
  else {
    const prev = await pool.query<{ danger: unknown }>(
      `SELECT payload->'danger' AS danger FROM snapshot_kv WHERE key = 'rent'`
    );
    const kept = prev.rows[0]?.danger;
    if (Array.isArray(kept)) payload.danger = kept;
  }
  payload.duePage = duePage;
  payload.aheadPage = aheadPage;
  if (claims) payload.claims = claims;
  await upsert(pool, "rent", payload, tip);
}

/**
 * Same tip and same block: heavy lists at most this often. The status snapshot still goes
 * out every call, because /status marks the indexer stale after 60 s.
 */
const SAME_TIP_LIST_MS = Math.max(0, Number(process.env.SAME_TIP_LIST_MS ?? 30_000) || 0);
let lastListSnap: { key: string; at: number } | null = null;
const BLOCK_VALUE_FILL_REST_MS = 24 * 3600 * 1000;
let blockValueFillIdleAt = 0;

export async function writeListSnapshots(
  pool: Pool,
  tip: number,
  opts: { force?: boolean } = {}
): Promise<void> {
  const head = await pool.query<{ id: string }>(
    `SELECT encode(id, 'hex') AS id FROM packed.blocks WHERE height = $1`,
    [tip]
  );
  const key = `${tip}:${head.rows[0]?.id ?? ""}`;
  if (
    !opts.force &&
    lastListSnap?.key === key &&
    Date.now() - lastListSnap.at < SAME_TIP_LIST_MS
  ) {
    await writeIndexerStatusSnapshot(pool, tip);
    return;
  }
  const startedAt = Date.now();
  await ensureSnapshotSchema(pool);
  const extrasP = resolveCgMarketExtras(pool, tip);

  // One-shot fill for heights indexed before fee_nano/value_nano existed. After that, indexHeight writes the row.
  // An empty probe still walks every block (0.7 s), so it rests a day after finding nothing.
  if (Date.now() - blockValueFillIdleAt >= BLOCK_VALUE_FILL_REST_MS) {
    const filled = await pool.query(
      `UPDATE packed.blocks b
       SET fee_nano = COALESCE(s.fee, 0),
           value_nano = COALESCE(s.val, 0)
       FROM (
         SELECT t.height,
                SUM(t.fee) AS fee,
                SUM(t.value_nano) AS val
         FROM packed.transactions t
         WHERE t.height IN (
           SELECT height FROM packed.blocks WHERE value_nano = 0 ORDER BY height DESC LIMIT $1
         )
         GROUP BY t.height
       ) s
       WHERE b.height = s.height`,
      [BLOCKS_N]
    );
    blockValueFillIdleAt = filled.rowCount ? 0 : Date.now();
  }

  const blocksRes = await pool.query<BlockRow>(
    `SELECT encode(id, 'hex') AS id, height, timestamp_ms AS timestamp, COALESCE(size, 0) AS size,
            tx_count AS "txCount", encode(parent_id, 'hex') AS "parentId",
            miner_address AS "minerAddress",
            COALESCE(fee_nano, 0)::text AS "feeNano",
            COALESCE(value_nano, 0)::text AS "valueNano"
     FROM packed.blocks
     ORDER BY height DESC
     LIMIT $1`,
    [BLOCKS_N]
  );
  let blocks = blocksRes.rows.map(mapBlock);
  try {
    blocks = await paintLithosBlocks(pool, blocks);
  } catch (e) {
    console.warn("[indexer] lithos block snapshot", String(e));
  }

  const txsRes = await pool.query<{
    id: string;
    index_in_block: unknown;
    height: unknown;
    timestamp_ms: unknown;
    size: unknown;
    fee: unknown;
    input_count: unknown;
    output_count: unknown;
    value_nano: unknown;
    shape: string | null;
    protocol: string | null;
  }>(
    `SELECT encode(id, 'hex') AS id, index_in_block, height, timestamp_ms, size, fee,
            input_count, output_count, value_nano, shape, protocol
     FROM packed.transactions
     WHERE height IS NOT NULL
     ORDER BY height DESC, index_in_block DESC NULLS LAST
     LIMIT $1`,
    [TXS_N]
  );
  const txs = txsRes.rows.map(mapTx);

  const indexer = await buildIndexerStatus(pool, tip);
  const ts = Date.now();
  const listHeight = blocks[0]?.height ?? tip;

  await upsert(pool, "blocks_latest", blocks, listHeight);
  await upsert(
    pool,
    "txs_recent",
    { items: txs, maxIndex: null, ts, source: "snapshot" },
    listHeight
  );
  await upsert(pool, "indexer_status", indexer, listHeight);

  try {
    const addrRes = await pool.query<{
      address: string;
      nanoerg: string;
      box_count: unknown;
      tx_count: unknown;
      token_count: unknown;
      first_height: unknown;
      last_height: unknown;
      first_ts: unknown;
      last_ts: unknown;
    }>(
      `SELECT s.address, s.nanoerg::text AS nanoerg, s.box_count, s.tx_count, s.token_count,
              s.first_height, s.last_height,
              bf.timestamp_ms AS first_ts, bl.timestamp_ms AS last_ts
       FROM address_summary s
       LEFT JOIN packed.blocks bf ON bf.height = s.first_height
       LEFT JOIN packed.blocks bl ON bl.height = s.last_height
       WHERE s.nanoerg > 0
       ORDER BY s.nanoerg DESC, s.address DESC
       LIMIT $1`,
      [ADDRESSES_N]
    );
    const addresses: AddressListItem[] = addrRes.rows.map((r, i) => ({
      rank: i + 1,
      address: r.address,
      nanoerg: r.nanoerg || "0",
      boxCount: n(r.box_count),
      txCount: n(r.tx_count),
      tokenCount: n(r.token_count),
      firstHeight: nNull(r.first_height),
      lastHeight: nNull(r.last_height),
      firstTs: nNull(r.first_ts),
      lastTs: nNull(r.last_ts),
      isContract: !isP2pk(r.address),
    }));
    await upsert(pool, "addresses_top", addresses, listHeight);
  } catch (e) {
    console.warn("[indexer] addresses snapshot", String(e));
  }
  let scriptCount: number | null = null;
  try {
    const bands = await buildHolderBands(pool);
    scriptCount = scriptCountFromKinds(bands.kinds);
    await upsert(pool, "holder_bands", bands, listHeight);
  } catch (e) {
    console.warn("[indexer] holder bands snapshot", String(e));
  }
  let hashRate: number | null = null;
  let hashRateSeries: { t: number; v: number }[] = [];
  let txPerDay: number | null = null;
  let txPerDaySeries: { t: number; v: number }[] = [];
  let txActivity: TxActivityPoint[] = [];
  try {
    const spark = await buildHashRateSpark(pool);
    hashRate = spark.hashRate;
    hashRateSeries = spark.hashRateSeries;
  } catch (e) {
    console.warn("[indexer] hashrate snapshot", String(e));
  }
  try {
    const spark = await buildTxPerDaySpark(pool);
    txPerDay = spark.txPerDay;
    txPerDaySeries = spark.txPerDaySeries;
    txActivity = spark.txActivity;
  } catch (e) {
    console.warn("[indexer] tx/day snapshot", String(e));
  }
  let circulating: number | null = null;
  let maxSupply: number | null = null;
  let avgBlockMs: number | null = null;
  let stats24h: Awaited<ReturnType<typeof buildDayWindow>>["stats24h"] | undefined;
  try {
    const day = await buildDayWindow(pool, txPerDay, listHeight);
    circulating = day.circulating;
    maxSupply = day.maxSupply;
    avgBlockMs = day.avgBlockMs;
    stats24h = day.stats24h;
  } catch (e) {
    console.warn("[indexer] home 24h snapshot", String(e));
  }
  let oracleSnap: Awaited<ReturnType<typeof resolveOracleErgUsd>> = null;
  try {
    oracleSnap = await resolveOracleErgUsd(pool);
  } catch (e) {
    console.warn("[indexer] oracle erg/usd snapshot", String(e));
  }
  let ergUsd: number | null = null;
  let priceSeries: { t: number; v: number }[] = [];
  let rank: number | null = null;
  let volume24h: number | null = null;
  let change24h: number | null = null;
  try {
    const { extras } = await extrasP;
    ergUsd = extras.ergUsd;
    rank = extras.rank;
    volume24h = extras.volume24h;
    change24h = extras.change24h;
    try {
      priceSeries = await readCgPriceSpark(
        pool,
        ergUsd,
        SPARK_WINDOW_MS,
        SPARK_HOUR_MS
      );
    } catch (e) {
      console.warn("[indexer] cg price spark", String(e));
    }
  } catch (e) {
    console.warn("[indexer] market extras snapshot", String(e));
  }
  let pools: HomePoolShare[] = [];
  let minerCount: number | null = null;
  try {
    const share = await buildMinerShares(pool);
    pools = share.pools;
    minerCount = share.minerCount;
  } catch (e) {
    console.warn("[indexer] miner share snapshot", String(e));
  }
  let holderCount: number | null = null;
  let holdersMonth: number | null = null;
  try {
    holderCount = await countP2pkHolders(pool);
  } catch (e) {
    console.warn("[indexer] holder count snapshot", String(e));
  }
  try {
    holdersMonth = await countP2pkHoldersMonth(pool, listHeight, avgBlockMs);
  } catch (e) {
    console.warn("[indexer] holder month snapshot", String(e));
  }
  let txTotal: number | null = null;
  try {
    txTotal = await resolveTxTotal(pool);
  } catch (e) {
    console.warn("[indexer] tx total snapshot", String(e));
  }
  await upsert(
    pool,
    "home",
    {
      height: listHeight,
      blocks: blocks.slice(0, 10),
      txs: txs.slice(0, 16),
      indexer,
      ts,
      hashRate,
      hashRateSeries,
      txPerDay,
      txPerDaySeries,
      txActivity,
      txTotal,
      circulating,
      maxSupply,
      avgBlockMs,
      stats24h,
      ergUsd,
      ergUsdSource: ergUsd != null ? ERG_USD_SOURCE_CG : null,
      ergUsdOracle: oracleSnap?.ergUsd ?? null,
      ergUsdOracleNano: oracleSnap?.nanoPerUsd ?? null,
      ergUsdOracleBoxId: oracleSnap?.boxId ?? null,
      ergUsdOracleHeight: oracleSnap?.height ?? null,
      priceSeries,
      rank,
      volume24h,
      change24h,
      pools,
      minerCount,
      holderCount,
      scriptCount,
      holdersMonth,
    },
    listHeight
  );
  try {
    await writeTokenKpis(pool, listHeight);
  } catch (e) {
    console.warn("[indexer] tokens kpis snapshot", String(e));
  }
  if (!SKIP_RENT_SNAP) {
    try {
      await writeRentSnapshot(pool, listHeight);
    } catch (e) {
      console.warn("[indexer] rent snapshot", String(e));
    }
  }
  lastListSnap = { key, at: startedAt };
}

/** SyncChip / `/v1/indexer/status` only. No COUNT(*), rent, or home lists. */
export async function writeIndexerStatusSnapshot(
  pool: Pool,
  tip: number
): Promise<void> {
  await ensureSnapshotSchema(pool);
  const indexer = await buildIndexerStatus(pool, tip);
  await upsert(pool, "indexer_status", indexer, tip);
}

/**
 * After deepen: refresh keys the window actually moves.
 * While history is still open, `heavy=false` — status only (rent / COUNT tokens
 * steal the pool from indexHeight). After genesis, KPIs + rent again.
 *
 * addresses_top / holder_bands stay on the throttled full snap; they lag.
 */
export async function writeWindowSnapshots(
  pool: Pool,
  tip: number,
  opts?: { heavy?: boolean }
): Promise<void> {
  await writeIndexerStatusSnapshot(pool, tip);
  if (opts?.heavy === false) return;
  try {
    await writeTokenKpis(pool, tip);
  } catch (e) {
    console.warn("[indexer] tokens kpis snapshot", String(e));
  }
  if (!SKIP_RENT_SNAP) {
    try {
      await writeRentSnapshot(pool, tip);
    } catch (e) {
      console.warn("[indexer] rent snapshot", String(e));
    }
  }
}
