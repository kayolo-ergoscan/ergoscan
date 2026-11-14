/**
 * Storage rent from indexer boxes: windows of 24h / 7d / 30d.
 * GET never hits the node. Window COUNTs stay off the hot path when snapshot_kv.rent exists.
 */
import type pg from "pg";
import {
  DEFAULT_RENT_PARAMS,
  ergoBoxSizeBytes,
  fillRentWeekGaps,
  keepRecentRentHours,
  parseRentSeries,
  rollupRentSeries,
  RENT_HOUR_WINDOW,
  RENT_SERIES_DAY_MS,
  RENT_SERIES_HOUR_MS,
  rentTakeSql,
  storageFeeNano,
  type RentSeriesPoint,
} from "@ergoscan/shared";
import { getIndexPool } from "./indexDb.js";

export type { RentSeriesPoint };

export const RENT_PACK = 25;
export const RENT_BLOCKS_24H = 720;
export const RENT_BLOCKS_7D = 5040;
export const RENT_BLOCKS_30D = 21600;

const PERIOD = DEFAULT_RENT_PARAMS.storagePeriodBlocks;
const FEE = DEFAULT_RENT_PARAMS.storageFeeFactor;

export type RentTab = "upcoming" | "oldest" | "due";

export type RentWindow = {
  blocks: number;
  boxCount: number;
  rentNano: string;
  valueNano: string;
  /** False when the window’s max creation height is older than indexer min_height. */
  inIndex: boolean;
};

export type RentBoxRow = {
  boxId: string;
  address: string | null;
  valueNano: string;
  creationHeight: number;
  creationTs: number | null;
  tokenCount: number;
  /** Assets on the box. Additive. Not a boxes scan — page ids only. */
  tokens: { tokenId: string; name: string | null }[];
  sizeBytes: number;
  rentNano: string;
  blocksUntilRent: number;
  rentDue: boolean;
};

/** Priced protocol token on a box that cannot cover its own storage rent. */
export type RentDangerRow = {
  boxId: string;
  address: string | null;
  tokenId: string;
  name: string | null;
  amount: string;
  decimals: number | null;
  priceUsd: number;
  valueNano: string;
  rentNano: string;
  shortfallNano: string;
  blocksUntilRent: number;
};

export type RentCollected = {
  boxCount: number;
  rentNano: string;
  lastHeight: number | null;
  catchingUp: boolean;
  /** Weekly UTC bins from snapshot_kv.rent_history.series. Additive. */
  series?: RentSeriesPoint[];
  /** Daily UTC bins. Additive. */
  daily?: RentSeriesPoint[];
  /** Last 7d hourly UTC bins from rent_collected. Additive. Not a boxes scan. */
  hourly?: RentSeriesPoint[];
  /** Next 30d becomes-due, daily UTC. Additive. Not collected. */
  forecast?: RentSeriesPoint[];
  /** Miner who collected the rent (empty proof + extension 127). Not a heuristic. */
  miners?: RentMinersPack;
  /** Latest protocol claims: which box, who took it. */
  recent?: RentClaimRow[];
  recentTotal?: number;
  /** True while historical rows are still being checked against the tx proof. */
  verifying?: boolean;
  /** Last 720 blocks. Additive from rent_collected + blocks. Not a boxes scan. */
  minersDay?: RentMinersPack;
  /** Last 21600 blocks. Additive from rent_collected + blocks. Not a boxes scan. */
  minersMonth?: RentMinersPack;
};

export type RentClaimToken = {
  tokenId: string;
  amount: string;
  name: string | null;
  decimals: number | null;
};

export type RentClaimRow = {
  boxId: string;
  collector: string | null;
  /** Address that held the box. Additive. */
  owner?: string | null;
  /** ERG that sat in the box. Additive. */
  valueNano?: string | null;
  /** Collecting transaction. Additive. */
  spentTxId?: string | null;
  rentNano: string;
  spentHeight: number;
  /** Block time of the collection, ms. Additive. */
  spentTs?: number | null;
  /** Tokens that were in the box when the rent was collected. */
  tokens?: RentClaimToken[];
};

export type RentMinersPack = {
  boxCount?: number;
  rentNano?: string;
  coveredBoxes: number;
  coveredRentNano: string;
  uncoveredBoxes: number;
  uncoveredRentNano: string;
  /** Distinct collectors. The `pools` list is only the largest slice. */
  claimerCount?: number;
  pools: {
    address: string;
    name: string;
    boxCount: number;
    rentNano: string;
    share: number;
  }[];
};

export type RentKpis = {
  tipHeight: number;
  minHeight: number | null;
  dueHeight: number;
  periodBlocks: number;
  storageFeeFactor: number;
  due: RentWindow;
  next24h: RentWindow;
  next7d: RentWindow;
  next30d: RentWindow;
  oldestCreationHeight: number | null;
  blocksUntilFirst: number | null;
  /** Additive: miner collections from snapshot_kv.rent_history. Null until the writer wrote a snap. */
  collected?: RentCollected | null;
};

export type RentPage = RentKpis & {
  /** Upcoming pane only. Empty when the price table or the window is quiet. */
  danger?: RentDangerRow[];
  items: RentBoxRow[];
  pagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
    total: number | null;
  };
  tab: RentTab;
  source: string;
  updatedAt: string | null;
};

/**
 * Planner settings for the exact-size rent reads (same as the indexer). packed.boxes stats run
 * stale, so a few-hundred-box window is costed as a million rows: JIT (~300 ms a statement) or a
 * seq scan of the heap once the size needs heap columns and box_assets probes.
 */
const EXACT_SIZE_PLANNER = ["SET LOCAL jit = off", "SET LOCAL enable_seqscan = off", "SET LOCAL max_parallel_workers_per_gather = 0"];

async function qTimeout<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[],
  timeoutMs: number,
  settings: readonly string[] = []
): Promise<T[] | null> {
  const p = getIndexPool();
  if (!p) return null;
  let c: pg.PoolClient | null = null;
  try {
    c = await p.connect();
    await c.query("BEGIN");
    await c.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.trunc(timeoutMs))}`);
    for (const set of settings) await c.query(set);
    const r = await c.query<T>(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch {
    if (c) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* */
      }
    }
    return null;
  } finally {
    c?.release();
  }
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function emptyWindow(blocks: number): RentWindow {
  return { blocks, boxCount: 0, rentNano: "0", valueNano: "0", inIndex: false };
}

function mapWindow(blocks: number, row: { n?: unknown; rent_nano?: unknown; value_nano?: unknown } | undefined): RentWindow {
  return {
    blocks,
    boxCount: n(row?.n),
    rentNano: String(row?.rent_nano ?? "0"),
    valueNano: String(row?.value_nano ?? "0"),
    inIndex: true,
  };
}

function coverWindow(w: RentWindow, windowHi: number, minHeight: number | null): RentWindow {
  return {
    ...w,
    inIndex: minHeight == null || windowHi >= minHeight,
  };
}

/**
 * Unspent boxes with creation_height in (lo, hi] per window, one pass over (lo, max hi]. lo=-1
 * means no lower bound. Exact serialized box size (shared rent-exact); token bytes need one
 * box_assets primary-key probe per box, so only boxes created up to `tokensUpTo` (the 7-day
 * window) are probed and the 30-day tail counts no tokens (~2 % of its bytes). OFFSET 0 keeps the
 * size computed once per box, not once per FILTERed aggregate.
 */
async function windowsAgg(
  lo: number,
  windows: ReadonlyArray<{ hi: number; blocks: number }>,
  tokensUpTo: number
): Promise<RentWindow[]> {
  const maxHi = Math.max(...windows.map((w) => w.hi));
  const cols = windows
    .map((_, i) => {
      const hi = `$${5 + i}`;
      return `COUNT(*) FILTER (WHERE creation_height <= ${hi})::int AS n${i},
              COALESCE(SUM(value_nano) FILTER (WHERE creation_height <= ${hi}), 0)::text AS v${i},
              COALESCE(SUM(rent) FILTER (WHERE creation_height <= ${hi}), 0)::text AS r${i}`;
    })
    .join(",\n");
  const rows = await qTimeout<Record<string, unknown>>(
    `SELECT ${cols}
     FROM (
       SELECT b.creation_height, b.value_nano,
              ${rentTakeSql("b", "$1", { tokensUpTo: "$4" })} AS rent
       FROM packed.boxes b
       WHERE b.spent_tx_id IS NULL
         AND b.creation_height IS NOT NULL
         AND b.creation_height > $2
         AND b.creation_height <= $3
       OFFSET 0
     ) w`,
    [FEE, lo, maxHi, tokensUpTo, ...windows.map((w) => w.hi)],
    4000,
    EXACT_SIZE_PLANNER
  );
  const row = rows?.[0];
  return windows.map((w, i) =>
    row
      ? mapWindow(w.blocks, { n: row[`n${i}`], value_nano: row[`v${i}`], rent_nano: row[`r${i}`] })
      : emptyWindow(w.blocks)
  );
}

/** The live windows run only while snapshot_kv.rent is missing: at most once a minute, shared. */
const KPIS_LIVE_MS = 60_000;
let kpisMem: { at: number; kpis: RentKpis } | null = null;
let kpisFlight: Promise<RentKpis | null> | null = null;

/**
 * The /rent windows read live, for the page's fallback when the indexer's rent snapshot is absent
 * (~0.26 s of exact-size reads). Concurrent requests share one run; the answer is kept a minute.
 */
export async function rentKpisFromIndex(tipHeight: number): Promise<RentKpis | null> {
  if (!Number.isFinite(tipHeight) || tipHeight <= 0) return null;
  if (kpisMem && Date.now() - kpisMem.at < KPIS_LIVE_MS) return kpisMem.kpis;
  if (kpisFlight) return kpisFlight;
  kpisFlight = rentKpisLive(Math.trunc(tipHeight))
    .then((kpis) => {
      if (kpis) kpisMem = { at: Date.now(), kpis };
      return kpis;
    })
    .finally(() => {
      kpisFlight = null;
    });
  return kpisFlight;
}

async function rentKpisLive(tip: number): Promise<RentKpis | null> {
  const dueHeight = tip - PERIOD;
  const [[due], [next24h, next7d, next30d], oldest, minR] = await Promise.all([
    windowsAgg(-1, [{ hi: dueHeight, blocks: 0 }], dueHeight),
    windowsAgg(
      dueHeight,
      [
        { hi: dueHeight + RENT_BLOCKS_24H, blocks: RENT_BLOCKS_24H },
        { hi: dueHeight + RENT_BLOCKS_7D, blocks: RENT_BLOCKS_7D },
        { hi: dueHeight + RENT_BLOCKS_30D, blocks: RENT_BLOCKS_30D },
      ],
      dueHeight + RENT_BLOCKS_7D
    ),
    qTimeout<{ h: string | null }>(
      `SELECT creation_height::text AS h
       FROM packed.boxes
       WHERE spent_tx_id IS NULL AND creation_height IS NOT NULL
       ORDER BY creation_height ASC
       LIMIT 1`,
      [],
      4000
    ),
    qTimeout<{ v: string }>(
      `SELECT value FROM indexer_state WHERE key = 'min_height'`,
      [],
      2000
    ),
  ]);
  const oldestCreationHeight = oldest?.[0]?.h != null ? n(oldest[0].h) : null;
  const minFromState = minR?.[0]?.v != null ? n(minR[0].v) : null;
  const minHeight = minFromState ?? oldestCreationHeight;
  const blocksUntilFirst =
    oldestCreationHeight != null
      ? Math.max(0, oldestCreationHeight + PERIOD - tip)
      : null;
  return {
    tipHeight: tip,
    minHeight,
    dueHeight,
    periodBlocks: PERIOD,
    storageFeeFactor: FEE,
    due: coverWindow(due!, dueHeight, minHeight),
    next24h: coverWindow(next24h!, dueHeight + RENT_BLOCKS_24H, minHeight),
    next7d: coverWindow(next7d!, dueHeight + RENT_BLOCKS_7D, minHeight),
    next30d: coverWindow(next30d!, dueHeight + RENT_BLOCKS_30D, minHeight),
    oldestCreationHeight,
    blocksUntilFirst,
  };
}


export async function rentBoxesFromIndex(opts: {
  tipHeight: number;
  tab: RentTab;
  offset?: number;
  limit?: number;
}): Promise<{ items: RentBoxRow[]; hasMore: boolean; total: number | null } | null> {
  const tip = Math.trunc(opts.tipHeight);
  const dueHeight = tip - PERIOD;
  const limit = Math.min(100, Math.max(1, opts.limit ?? RENT_PACK));
  const offset = Math.max(0, opts.offset ?? 0);
  const upcomingHi = dueHeight + RENT_BLOCKS_30D;
  // due = a miner can take them now. upcoming = the next 30 days only.
  const where =
    opts.tab === "due"
      ? `spent_tx_id IS NULL AND creation_height IS NOT NULL
         AND creation_height <= $1`
      : opts.tab === "upcoming"
        ? `spent_tx_id IS NULL AND creation_height IS NOT NULL
           AND creation_height > $1 AND creation_height <= $2`
        : `spent_tx_id IS NULL AND creation_height IS NOT NULL`;
  const params: unknown[] =
    opts.tab === "due"
      ? [dueHeight, limit, offset]
      : opts.tab === "upcoming"
        ? [dueHeight, upcomingHi, limit, offset]
        : [limit, offset];
  const lim = opts.tab === "oldest" ? "$1" : opts.tab === "due" ? "$2" : "$3";
  const off = opts.tab === "oldest" ? "$2" : opts.tab === "due" ? "$3" : "$4";
  const rows = await qTimeout<{
    box_id: string;
    address: string | null;
    value_nano: string;
    creation_height: string;
    creation_ts: string | null;
    ergo_tree: string | null;
    tree_bytes: number | null;
    output_index: number | null;
    additional_registers: unknown;
  }>(
    `SELECT encode(b.box_id, 'hex') AS box_id, ad.address,
            b.value_nano::text AS value_nano,
            b.creation_height::text AS creation_height,
            bl.timestamp_ms::text AS creation_ts,
            sc.ergo_tree, b.tree_bytes, b.output_index, b.additional_registers
     FROM packed.boxes b
     LEFT JOIN packed.addr ad ON ad.id = b.addr_id
     LEFT JOIN packed.script sc ON sc.id = b.script_id
     LEFT JOIN packed.blocks bl ON bl.height = b.creation_height
     WHERE ${where}
     ORDER BY b.creation_height ASC, b.box_id ASC
     LIMIT ${lim} OFFSET ${off}`,
    params,
    8000
  );
  if (!rows) return null;
  const ids = rows.map((r) => r.box_id);
  const tokensByBox = new Map<string, { tokenId: string; name: string | null }[]>();
  const amountsByBox = new Map<string, string[]>();
  if (ids.length) {
    const tok = await qTimeout<{ box_id: string; token_id: string; amount: string; name: string | null }>(
      `SELECT encode(a.box_id, 'hex') AS box_id,
              encode(a.token_id, 'hex') AS token_id, a.amount::text AS amount, t.name
       FROM packed.box_assets a
       LEFT JOIN tokens t ON t.token_id = encode(a.token_id, 'hex')
       WHERE a.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
      [ids],
      4000
    );
    for (const r of tok ?? []) {
      const list = tokensByBox.get(r.box_id) ?? [];
      list.push({ tokenId: r.token_id, name: r.name });
      tokensByBox.set(r.box_id, list);
      const amounts = amountsByBox.get(r.box_id) ?? [];
      amounts.push(r.amount);
      amountsByBox.set(r.box_id, amounts);
    }
  }
  const items: RentBoxRow[] = rows.map((r) => {
    const creationHeight = n(r.creation_height);
    const tokens = tokensByBox.get(r.box_id) ?? [];
    const tokenCount = tokens.length;
    const sizeBytes = ergoBoxSizeBytes({
      valueNano: r.value_nano,
      ergoTree: r.ergo_tree,
      treeBytes: r.ergo_tree ? null : r.tree_bytes,
      creationHeight,
      tokenAmounts: amountsByBox.get(r.box_id) ?? [],
      registers: r.additional_registers,
      outputIndex: n(r.output_index),
    });
    const dueAt = creationHeight + PERIOD;
    const blocksUntilRent = Math.max(0, dueAt - tip);
    const rentDue = blocksUntilRent === 0;
    // The fee itself (once per spend): rows show it beside the value and cap it there.
    const rentNano = storageFeeNano(sizeBytes, FEE).toString();
    return {
      boxId: r.box_id,
      address: r.address,
      valueNano: r.value_nano,
      creationHeight,
      creationTs: r.creation_ts != null ? n(r.creation_ts) : null,
      tokenCount,
      tokens,
      sizeBytes,
      rentNano,
      blocksUntilRent,
      rentDue,
    };
  });
  return { items, hasMore: items.length === limit, total: null };
}

let seriesMem: { at: number; week: RentSeriesPoint[]; daily: RentSeriesPoint[] } | null = null;
let hourlyMem: { at: number; points: RentSeriesPoint[] } | null = null;
let forecastMem: { at: number; points: RentSeriesPoint[] } | null = null;

function mapSeriesRows(
  rows: { t: string; boxes: number; rent_nano: string }[]
): RentSeriesPoint[] {
  return parseRentSeries(
    rows.map((row) => ({
      t: Number(row.t),
      boxes: row.boxes,
      rentNano: row.rent_nano,
    }))
  );
}

/** Dedicated `rent_collected` + `blocks` PK. Not a boxes scan. RAM 60s. */
export async function rentHistorySeriesFromIndex(): Promise<RentSeriesPoint[]> {
  const loaded = await rentHistoryDailyFromIndex();
  if (loaded.week.length >= 2) return loaded.week;
  return [];
}

export async function rentHistoryDailyFromIndex(): Promise<{
  daily: RentSeriesPoint[];
  week: RentSeriesPoint[];
}> {
  const now = Date.now();
  if (seriesMem && now - seriesMem.at < 60_000) return seriesMem;
  const rows = await qTimeout<{ t: string; boxes: number; rent_nano: string }>(
    `SELECT ((bl.timestamp_ms / $1) * $1)::bigint::text AS t,
            COUNT(*)::int AS boxes,
            SUM(rc.rent_nano)::text AS rent_nano
     FROM rent_collected rc
     JOIN packed.blocks bl ON bl.height = rc.spent_height
     WHERE rc.kind = 'protocol'
     GROUP BY 1
     ORDER BY 1`,
    [RENT_SERIES_DAY_MS],
    2000
  );
  if (!rows) return seriesMem ?? { daily: [], week: [] };
  const daily = mapSeriesRows(rows);
  const week = fillRentWeekGaps(rollupRentSeries(daily, "week"));
  seriesMem = { at: now, daily, week };
  return seriesMem;
}

/** Last week of hourly collections. `rent_collected` + `blocks`, not boxes. RAM 60s. */
export async function rentHistoryHourlyFromIndex(): Promise<RentSeriesPoint[]> {
  const now = Date.now();
  if (hourlyMem && now - hourlyMem.at < 60_000) return hourlyMem.points;
  const since = now - RENT_HOUR_WINDOW * RENT_SERIES_HOUR_MS;
  const rows = await qTimeout<{ t: string; boxes: number; rent_nano: string }>(
    `SELECT ((bl.timestamp_ms / $1) * $1)::bigint::text AS t,
            COUNT(*)::int AS boxes,
            SUM(rc.rent_nano)::text AS rent_nano
     FROM rent_collected rc
     JOIN packed.blocks bl ON bl.height = rc.spent_height
     WHERE rc.kind = 'protocol'
       AND bl.timestamp_ms >= $2
     GROUP BY 1
     ORDER BY 1`,
    [RENT_SERIES_HOUR_MS, since],
    2000
  );
  if (!rows) return hourlyMem?.points ?? [];
  const points = keepRecentRentHours(mapSeriesRows(rows), now);
  hourlyMem = { at: now, points };
  return points;
}

/** Unspent boxes that become due in the next 30d. Indexed creation window. RAM 60s. */
export async function rentForecastFromIndex(tipHeight: number): Promise<RentSeriesPoint[]> {
  const now = Date.now();
  if (forecastMem && now - forecastMem.at < 60_000) return forecastMem.points;
  const tip = Math.trunc(tipHeight);
  if (!Number.isFinite(tip) || tip <= 0) return forecastMem?.points ?? [];
  const dueHeight = tip - PERIOD;
  const tipTs = await qTimeout<{ t: string }>(
    `SELECT timestamp_ms::text AS t FROM packed.blocks WHERE height = $1`,
    [tip],
    1500
  );
  const tipMs = Number(tipTs?.[0]?.t);
  if (!Number.isFinite(tipMs) || tipMs <= 0) return forecastMem?.points ?? [];
  // Exact box size; tokens probed for the first 7 days only, as in windowsAgg.
  const rows = await qTimeout<{ t: string; boxes: number; rent_nano: string }>(
    `SELECT ((($1::bigint + (b.creation_height + $2 - $3) * 120000) / $4) * $4)::bigint::text AS t,
            COUNT(*)::int AS boxes,
            COALESCE(SUM(${rentTakeSql("b", "$5", { tokensUpTo: "$8" })}), 0)::text AS rent_nano
     FROM packed.boxes b
     WHERE b.spent_tx_id IS NULL
       AND b.creation_height IS NOT NULL
       AND b.creation_height > $6
       AND b.creation_height <= $7
     GROUP BY 1
     ORDER BY 1`,
    [tipMs, PERIOD, tip, RENT_SERIES_DAY_MS, FEE, dueHeight, dueHeight + RENT_BLOCKS_30D, dueHeight + RENT_BLOCKS_7D],
    3000,
    EXACT_SIZE_PLANNER
  );
  if (!rows) return forecastMem?.points ?? [];
  const points = mapSeriesRows(rows);
  forecastMem = { at: now, points };
  return points;
}

let minerWinMem: {
  at: number;
  tip: number;
  day: RentMinersPack;
  month: RentMinersPack;
} | null = null;

function minerLabel(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 2)}…${address.slice(-8)}`;
}

function cmpNanoDesc(a: string, b: string): number {
  try {
    const d = BigInt(b) - BigInt(a);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  } catch {
    return 0;
  }
}

export function emptyRentMiners(): RentMinersPack {
  return {
    boxCount: 0,
    rentNano: "0",
    coveredBoxes: 0,
    coveredRentNano: "0",
    uncoveredBoxes: 0,
    uncoveredRentNano: "0",
    claimerCount: 0,
    pools: [],
  };
}

export function buildRentMiners(input: {
  boxCount: number;
  rentNano: string;
  coveredBoxes: number;
  coveredRentNano: string;
  pools: { address: string; boxCount: number; rentNano: string }[];
}): RentMinersPack {
  let total = 0n;
  try {
    total = BigInt(input.rentNano || "0");
  } catch {
    total = 0n;
  }
  const named = [...input.pools].filter((p) => p.address);
  const pools = named
    .sort((a, b) => cmpNanoDesc(a.rentNano, b.rentNano))
    .slice(0, 24)
    .map((p) => {
      let share = 0;
      try {
        share = total > 0n ? Number((BigInt(p.rentNano) * 100_000n) / total) / 100_000 : 0;
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
    const left = BigInt(input.rentNano || "0") - BigInt(input.coveredRentNano || "0");
    uncoveredNano = (left > 0n ? left : 0n).toString();
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
    claimerCount: named.length,
    pools,
  };
}

/** Last 24h / 30d pool shares from `rent_collected` + `blocks`. RAM 60s. */
export async function rentMinerWindowsFromIndex(
  tipHeight: number
): Promise<{ day: RentMinersPack; month: RentMinersPack } | null> {
  const tip = Math.trunc(tipHeight);
  const now = Date.now();
  if (!Number.isFinite(tip) || tip <= 0) return minerWinMem
    ? { day: minerWinMem.day, month: minerWinMem.month }
    : null;
  if (minerWinMem && minerWinMem.tip === tip && now - minerWinMem.at < 60_000) {
    return { day: minerWinMem.day, month: minerWinMem.month };
  }
  const dayLo = Math.max(0, tip - RENT_BLOCKS_24H);
  const monthLo = Math.max(0, tip - RENT_BLOCKS_30D);
  const tot = await qTimeout<{
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
       COUNT(*) FILTER (WHERE rc.spent_height > $1)::int AS day_n,
       COALESCE(SUM(rc.rent_nano) FILTER (WHERE rc.spent_height > $1), 0)::text AS day_nano,
       COUNT(*) FILTER (
         WHERE rc.spent_height > $1
           AND rc.collector IS NOT NULL AND rc.collector <> ''
       )::int AS day_covered_n,
       COALESCE(SUM(rc.rent_nano) FILTER (
         WHERE rc.spent_height > $1
           AND rc.collector IS NOT NULL AND rc.collector <> ''
       ), 0)::text AS day_covered_nano,
       COUNT(*)::int AS month_n,
       COALESCE(SUM(rc.rent_nano), 0)::text AS month_nano,
       COUNT(*) FILTER (
         WHERE rc.collector IS NOT NULL AND rc.collector <> ''
       )::int AS month_covered_n,
       COALESCE(SUM(rc.rent_nano) FILTER (
         WHERE rc.collector IS NOT NULL AND rc.collector <> ''
       ), 0)::text AS month_covered_nano
     FROM rent_collected rc
     WHERE rc.kind = 'protocol' AND rc.spent_height > $2`,
    [dayLo, monthLo],
    2000
  );
  const pools = await qTimeout<{
    address: string;
    day_n: number;
    day_nano: string;
    month_n: number;
    month_nano: string;
  }>(
    `SELECT rc.collector AS address,
            COUNT(*) FILTER (WHERE rc.spent_height > $1)::int AS day_n,
            COALESCE(SUM(rc.rent_nano) FILTER (WHERE rc.spent_height > $1), 0)::text AS day_nano,
            COUNT(*)::int AS month_n,
            COALESCE(SUM(rc.rent_nano), 0)::text AS month_nano
     FROM rent_collected rc
     WHERE rc.kind = 'protocol'
       AND rc.spent_height > $2
       AND rc.collector IS NOT NULL AND rc.collector <> ''
     GROUP BY rc.collector`,
    [dayLo, monthLo],
    2000
  );
  if (!tot?.[0] || !pools) {
    return minerWinMem ? { day: minerWinMem.day, month: minerWinMem.month } : null;
  }
  const row = tot[0];
  const day = buildRentMiners({
    boxCount: n(row.day_n),
    rentNano: String(row.day_nano ?? "0"),
    coveredBoxes: n(row.day_covered_n),
    coveredRentNano: String(row.day_covered_nano ?? "0"),
    pools: pools
      .filter((p) => {
        try {
          return BigInt(p.day_nano || "0") > 0n;
        } catch {
          return false;
        }
      })
      .map((p) => ({
        address: p.address,
        boxCount: n(p.day_n),
        rentNano: p.day_nano || "0",
      })),
  });
  const month = buildRentMiners({
    boxCount: n(row.month_n),
    rentNano: String(row.month_nano ?? "0"),
    coveredBoxes: n(row.month_covered_n),
    coveredRentNano: String(row.month_covered_nano ?? "0"),
    pools: pools
      .filter((p) => {
        try {
          return BigInt(p.month_nano || "0") > 0n;
        } catch {
          return false;
        }
      })
      .map((p) => ({
        address: p.address,
        boxCount: n(p.month_n),
        rentNano: p.month_nano || "0",
      })),
  });
  minerWinMem = { at: now, tip, day, month };
  return { day, month };
}

let minerAllMem: { at: number; pack: RentMinersPack } | null = null;

/** All-time collectors from protocol claims only. Not snapshot_kv.rent_miners. */
export async function rentMinersAllFromIndex(): Promise<RentMinersPack> {
  const now = Date.now();
  if (minerAllMem && now - minerAllMem.at < 60_000) return minerAllMem.pack;
  const tot = await qTimeout<{ n: number; nano: string; covered_n: number; covered_nano: string }>(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(rent_nano), 0)::text AS nano,
            COUNT(*) FILTER (WHERE collector IS NOT NULL AND collector <> '')::int AS covered_n,
            COALESCE(SUM(rent_nano) FILTER (WHERE collector IS NOT NULL AND collector <> ''), 0)::text AS covered_nano
     FROM rent_collected
     WHERE kind = 'protocol'`,
    [],
    2000
  );
  const pools = await qTimeout<{ address: string; n: number; nano: string }>(
    `SELECT collector AS address, COUNT(*)::int AS n, SUM(rent_nano)::text AS nano
     FROM rent_collected
     WHERE kind = 'protocol' AND collector IS NOT NULL AND collector <> ''
     GROUP BY collector`,
    [],
    2000
  );
  if (!tot?.[0] || !pools) return minerAllMem?.pack ?? emptyRentMiners();
  const pack = buildRentMiners({
    boxCount: n(tot[0].n),
    rentNano: String(tot[0].nano ?? "0"),
    coveredBoxes: n(tot[0].covered_n),
    coveredRentNano: String(tot[0].covered_nano ?? "0"),
    pools: pools.map((p) => ({
      address: p.address,
      boxCount: n(p.n),
      rentNano: p.nano || "0",
    })),
  });
  minerAllMem = { at: now, pack };
  return pack;
}

export async function rentRecentClaims(
  offset = 0,
  limit = 25
): Promise<{ items: RentClaimRow[]; total: number }> {
  const take = Math.min(100, Math.max(1, limit));
  const skip = Math.max(0, offset);
  const [rows, tot] = await Promise.all([
    qTimeout<{
      box_id: string;
      collector: string | null;
      owner: string | null;
      value_nano: string | null;
      spent_tx_id: string | null;
      rent_nano: string;
      spent_height: string;
      spent_ts: string | null;
    }>(
      `SELECT rc.box_id, rc.collector,
              ad.address AS owner,
              rc.value_nano::text AS value_nano,
              rc.spent_tx_id,
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
       LIMIT $1 OFFSET $2`,
      [take, skip],
      1500
    ),
    qTimeout<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM rent_collected WHERE kind = 'protocol'`,
      [],
      1500
    ),
  ]);
  const page = rows ?? [];
  const ids = page.map((row) => row.box_id).filter((id) => /^[0-9a-fA-F]{64}$/.test(id));
  const assets = ids.length
    ? await qTimeout<{
        box_id: string;
        token_id: string;
        amount: string;
        name: string | null;
        decimals: number | null;
      }>(
        `SELECT encode(ba.box_id, 'hex') AS box_id,
                encode(ba.token_id, 'hex') AS token_id,
                ba.amount::text AS amount,
                t.name,
                t.decimals
         FROM packed.box_assets ba
         LEFT JOIN tokens t ON t.token_id = encode(ba.token_id, 'hex')
         WHERE ba.box_id IN (
           SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x
         )`,
        [ids],
        1500
      )
    : [];
  const byBox = new Map<string, RentClaimToken[]>();
  for (const asset of assets ?? []) {
    const list = byBox.get(asset.box_id) ?? [];
    list.push({
      tokenId: asset.token_id,
      amount: asset.amount,
      name: asset.name,
      decimals:
        asset.decimals == null || !Number.isFinite(Number(asset.decimals))
          ? null
          : Number(asset.decimals),
    });
    byBox.set(asset.box_id, list);
  }
  return {
    items: page.map((row) => ({
      boxId: row.box_id,
      collector: row.collector,
      owner: row.owner,
      valueNano: row.value_nano,
      spentTxId: row.spent_tx_id,
      rentNano: row.rent_nano,
      spentHeight: Number(row.spent_height),
      spentTs: row.spent_ts != null && Number.isFinite(Number(row.spent_ts)) ? Number(row.spent_ts) : null,
      tokens: byBox.get(row.box_id) ?? [],
    })),
    total: Number(tot?.[0]?.n ?? 0) || 0,
  };
}

/** Public status for ergoscan-rent-writer. Cursors only. Does not call the node. */
export async function rentWriterHealth(): Promise<{
  ok: boolean;
  ready: boolean;
  mode: "history" | "tip";
  source: string;
  verifyHeight: number | null;
  liveHeight: number | null;
  tipHeight: number | null;
  lag: number | null;
} | null> {
  const rows = await qTimeout<{ key: string; value: string }>(
    `SELECT key, value FROM indexer_state
     WHERE key = ANY($1::text[])`,
    [["last_height", "rent_claim_verify_height", "rent_claim_live_height", "rent_claim_verify_done"]],
    1500
  );
  if (!rows) return null;
  const m = new Map(rows.map((row) => [row.key, row.value]));
  const num = (key: string): number | null => {
    const n = Number(m.get(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const tipHeight = num("last_height");
  const verifyHeight = num("rent_claim_verify_height");
  const liveHeight = num("rent_claim_live_height");
  const mode = m.get("rent_claim_verify_done") ? "tip" : "history";
  const lag = tipHeight != null && liveHeight != null ? Math.max(0, tipHeight - liveHeight) : null;
  return {
    ok: true,
    ready: liveHeight != null,
    mode,
    source: "lumen-rent",
    verifyHeight,
    liveHeight,
    tipHeight,
    lag,
  };
}
