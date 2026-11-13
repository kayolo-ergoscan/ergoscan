/**
 * Header figures for /lithos, computed in the Lithos snapshot pass and stored in the same
 * `snapshot_kv.lithos_protocol` row (field `stats`). No table, column, index or row of its own.
 *
 * Every query reads a few hundred rows on an existing index: the Lithos finds joined to their
 * blocks (PK), the live/rollup boxes of a handful of contract addresses (partial unspent indexes,
 * `packed_boxes_addr_replay_idx`), and block counts by `packed_blocks_timestamp_idx`. The chart
 * series lives in the snapshot: past UTC days are kept, only the last stored day and today are
 * counted again (≤ 1 440 block rows).
 */
import type pg from "pg";
import {
  DAY_MS,
  ERGO_BLOCK_SECONDS,
  LITHOS_ADDR_MD5,
  LITHOS_MAX_ACTIVE,
  LIT_TOKEN_ID_MAINNET,
  LITHOS_LIT_POOL_NFT,
  lithosHashWindow,
  lithosNispLowerBoundHs,
  lithosRollupRegs,
  parseLithosStats,
  utcDay,
  type LithosAddrRole,
  type LithosBlockSample,
  type LithosDay,
  type LithosProtocolStats,
  type LithosRound,
} from "@ergoscan/shared";

type Queryable = { query: pg.Pool["query"] };

export type RollupBoxRow = {
  creationHeight: number;
  valueNano: number;
  live: boolean;
  r5: unknown;
  r6: unknown;
  r7: unknown;
};

export type UnspentSum = { n: number; nano: number };

export type LithosStatsInput = {
  tip: { height: number; ts: number; diff: bigint | null };
  finds: LithosBlockSample[];
  /** All Ergo blocks in the hash window (null when the window or the query is missing). */
  netWindowN: number | null;
  holding: RollupBoxRow[];
  evaluation: RollupBoxRow[];
  payout: UnspentSum | null;
  collateral: UnspentSum | null;
  queue: UnspentSum | null;
  minerRegistry: number | null;
  genesisNano: number | null;
  litPool: { nano: bigint; lit: bigint } | null;
  prevSeries: LithosDay[];
  /** Network per UTC day, fresh for days ≥ `recomputeFrom`. */
  netDays: { d: number; nb: number; ng: number }[];
  recomputeFrom: number;
};

type Round = LithosRound & { score: bigint; live: boolean; created: number };

function decodeRounds(rows: readonly RollupBoxRow[]): Round[] {
  const out: Round[] = [];
  for (const row of rows) {
    const regs = lithosRollupRegs(row.r5, row.r6, row.r7);
    if (!regs || regs.s1 <= 0) continue;
    out.push({
      h: regs.s1,
      start: regs.s0,
      miners: regs.miners,
      bank: Math.max(0, row.valueNano - regs.bond),
      score: regs.score,
      live: row.live,
      created: row.creationHeight,
    });
  }
  return out;
}

const pub = (r: Round): LithosRound => ({ h: r.h, start: r.start, miners: r.miners, bank: r.bank });

/** Σ difficulty ÷ 1e9, whole units (≤ 2^53 for any day of the whole network). */
function giga(diff: bigint): number {
  return Number(diff / 1_000_000_000n);
}

/**
 * The first UTC day whose network counts must be read again: the last stored day (it may have
 * been partial), or the first stored day with no blocks, or launch day when nothing usable is
 * stored. Days before it are kept as they are.
 */
export function seriesRecomputeFrom(prev: readonly LithosDay[], launchDay: number, tipDay: number): number {
  if (!prev.length || prev[0]!.d !== launchDay) return launchDay;
  for (let i = 0; i < prev.length; i++) {
    const day = prev[i]!;
    if (day.d !== launchDay + i || day.d > tipDay) return launchDay;
    if (day.nb <= 0) return day.d;
  }
  return Math.min(prev[prev.length - 1]!.d, tipDay);
}

export function buildLithosStats(input: LithosStatsInput): LithosProtocolStats {
  const { tip, finds } = input;
  const window = lithosHashWindow(finds, tip.ts);

  const holding = decodeRounds(input.holding).sort((a, b) => b.h - a.h);
  const evalAll = decodeRounds(input.evaluation);
  const evalLive = evalAll.filter((r) => r.live).sort((a, b) => b.h - a.h);

  // One bank per round: the earliest evaluation box of each block height, then the rounds
  // still collecting NISPs. A fraud proof takes a bond out of value and R7(2) together.
  const byRound = new Map<number, Round>();
  for (const r of evalAll) {
    const seen = byRound.get(r.h);
    if (!seen || r.created < seen.created) byRound.set(r.h, r);
  }
  for (const r of holding) if (!byRound.has(r.h)) byRound.set(r.h, r);
  let totalNano = 0;
  for (const r of byRound.values()) totalNano += r.bank;

  let avgNano: number | null = null;
  let avgN = 0;
  if (window) {
    const inWindow = new Set(finds.filter((b) => b.ts > window.from && b.ts <= window.to).map((b) => b.height));
    let sum = 0;
    for (const r of byRound.values()) {
      if (!inWindow.has(r.h)) continue;
      sum += r.bank;
      avgN += 1;
    }
    if (avgN) avgNano = Math.round(sum / avgN);
  }

  const newest = holding[0] ?? evalLive[0] ?? null;
  const nispRound =
    holding.find((r) => r.miners > 0 && r.score > 0n) ??
    evalLive.find((r) => r.miners > 0 && r.score > 0n) ??
    null;

  const d1From = tip.ts - DAY_MS;
  const d7From = tip.ts - 7 * DAY_MS;
  let launch: number | null = null;
  let d1 = 0;
  let d7 = 0;
  for (const b of finds) {
    if (launch == null || b.ts < launch) launch = b.ts;
    if (b.ts > d1From && b.ts <= tip.ts) d1 += 1;
    if (b.ts > d7From && b.ts <= tip.ts) d7 += 1;
  }

  let litErg: number | null = null;
  if (input.litPool && input.litPool.lit > 0n && input.litPool.nano > 0n) {
    // ERG and LIT both have 9 decimals.
    litErg = Number(input.litPool.nano) / Number(input.litPool.lit);
  }

  return {
    v: 1,
    tip: { height: tip.height, ts: tip.ts },
    netHs: tip.diff != null && tip.diff > 0n ? Number(tip.diff / BigInt(ERGO_BLOCK_SECONDS)) : null,
    hash: window
      ? {
          from: window.from,
          to: window.to,
          n: window.n,
          netN: input.netWindowN ?? 0,
          hs: Math.round(window.hs),
          err: Math.round(window.err * 10_000) / 10_000,
          extended: window.extended,
        }
      : null,
    nisp: nispRound
      ? {
          h: nispRound.h,
          miners: nispRound.miners,
          hs: Math.round(lithosNispLowerBoundHs(nispRound.score)),
        }
      : null,
    blocks: { total: finds.length, d1, d7, launch },
    miners: { round: newest ? newest.miners : null, registry: input.minerRegistry },
    rounds: {
      holding: holding.map(pub),
      evaluation: evalLive.map(pub),
      payoutN: input.payout?.n ?? 0,
      payoutNano: input.payout?.nano ?? 0,
    },
    collateral:
      input.collateral || input.queue
        ? {
            active: input.collateral?.n ?? 0,
            activeNano: input.collateral?.nano ?? 0,
            max: LITHOS_MAX_ACTIVE,
            queue: input.queue?.n ?? 0,
            queueNano: input.queue?.nano ?? 0,
          }
        : null,
    bank: {
      genesisNano: input.genesisNano,
      avgNano,
      avgN,
      totalNano,
      totalN: byRound.size,
    },
    litErg,
    series: buildSeries(input, launch),
  };
}

function buildSeries(input: LithosStatsInput, launch: number | null): LithosDay[] {
  if (launch == null) return [];
  const launchDay = utcDay(launch);
  const tipDay = utcDay(input.tip.ts);
  if (tipDay < launchDay) return [];
  const lithos = new Map<number, { lb: number; diff: bigint }>();
  for (const b of input.finds) {
    const d = utcDay(b.ts);
    const cur = lithos.get(d) ?? { lb: 0, diff: 0n };
    cur.lb += 1;
    cur.diff += b.diff;
    lithos.set(d, cur);
  }
  const prev = new Map(input.prevSeries.map((day) => [day.d, day]));
  const fresh = new Map(input.netDays.map((day) => [day.d, day]));
  const out: LithosDay[] = [];
  for (let d = launchDay; d <= tipDay; d++) {
    const net = d >= input.recomputeFrom ? fresh.get(d) : prev.get(d);
    const own = lithos.get(d);
    const day: LithosDay = {
      d,
      lb: own?.lb ?? 0,
      lg: own ? giga(own.diff) : 0,
      nb: net?.nb ?? 0,
      ng: net?.ng ?? 0,
    };
    if (d === tipDay) {
      const s = Math.round((input.tip.ts - d * DAY_MS) / 1000);
      if (s > 0 && s < 86_400) day.s = s;
    }
    out.push(day);
  }
  return out;
}

/* ───────────────────────────── queries ───────────────────────────── */

let addrIds: Map<LithosAddrRole, string> | null = null;

async function lithosAddrIds(db: Queryable): Promise<Map<LithosAddrRole, string>> {
  if (addrIds && addrIds.size === Object.keys(LITHOS_ADDR_MD5).length) return addrIds;
  const roles = Object.entries(LITHOS_ADDR_MD5) as [LithosAddrRole, string][];
  const rows = await db.query<{ id: string; md5: string }>(
    `SELECT id::text AS id, addr_md5 AS md5 FROM packed.addr WHERE addr_md5 = ANY($1::text[])`,
    [roles.map(([, md5]) => md5)]
  );
  const byMd5 = new Map(rows.rows.map((r) => [r.md5, r.id]));
  const out = new Map<LithosAddrRole, string>();
  for (const [role, md5] of roles) {
    const id = byMd5.get(md5);
    if (id) out.set(role, id);
  }
  addrIds = out;
  return out;
}

function int(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? NaN);
  return Number.isFinite(n) ? n : 0;
}

function big(v: string | null | undefined): bigint | null {
  const s = (v ?? "").trim().split(".")[0] ?? "";
  return /^\d+$/.test(s) ? BigInt(s) : null;
}

/** The previous stats in the row, for the kept chart days (and as the fallback on a failed pass). */
export async function readPrevLithosStats(db: Queryable): Promise<unknown> {
  const prev = await db.query<{ stats: unknown }>(
    `SELECT payload->'stats' AS stats FROM snapshot_kv WHERE key = 'lithos_protocol'`
  );
  return prev.rows[0]?.stats ?? null;
}

/** All header figures. Read-only; the caller writes them with the rest of the snapshot. */
export async function readLithosStats(db: Queryable, prevRaw: unknown): Promise<LithosProtocolStats | null> {
  const tipRes = await db.query<{ height: string; ts: string; diff: string | null }>(
    // Order by the column, not the text alias ("999999" sorts after "1915932").
    `SELECT b.height::text AS height, b.timestamp_ms::text AS ts, b.difficulty AS diff
       FROM packed.blocks b ORDER BY b.height DESC LIMIT 1`
  );
  const tipRow = tipRes.rows[0];
  if (!tipRow) return null;
  const tip = { height: int(tipRow.height), ts: int(tipRow.ts), diff: big(tipRow.diff) };

  const findRes = await db.query<{ height: string; ts: string; diff: string | null }>(
    `SELECT f.height::text AS height, b.timestamp_ms::text AS ts, b.difficulty AS diff
       FROM packed.lithos_find f
       JOIN packed.blocks b ON b.height = f.height`
  );
  const finds: LithosBlockSample[] = [];
  for (const r of findRes.rows) {
    const diff = big(r.diff);
    if (diff == null) continue;
    finds.push({ height: int(r.height), ts: int(r.ts), diff });
  }

  const window = lithosHashWindow(finds, tip.ts);
  let netWindowN: number | null = null;
  if (window) {
    const res = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM packed.blocks WHERE timestamp_ms > $1 AND timestamp_ms <= $2`,
      [window.from, window.to]
    );
    netWindowN = int(res.rows[0]?.n);
  }

  const prev = parseLithosStats(prevRaw);
  let launch: number | null = null;
  for (const b of finds) if (launch == null || b.ts < launch) launch = b.ts;
  const launchDay = launch != null ? utcDay(launch) : utcDay(tip.ts);
  const recomputeFrom = seriesRecomputeFrom(prev?.series ?? [], launchDay, utcDay(tip.ts));
  const netDayRes = await db.query<{ d: string; nb: string; ng: string }>(
    `SELECT (timestamp_ms / ${DAY_MS})::text AS d,
            count(*)::text AS nb,
            COALESCE(sum(CASE WHEN btrim(difficulty) ~ '^[0-9]+$' THEN btrim(difficulty)::numeric END), 0)::text AS ng
       FROM packed.blocks
      WHERE timestamp_ms >= $1
      GROUP BY 1`,
    [recomputeFrom * DAY_MS]
  );
  const netDays = netDayRes.rows.map((r) => ({
    d: int(r.d),
    nb: int(r.nb),
    ng: giga(big(r.ng) ?? 0n),
  }));

  const ids = await lithosAddrIds(db);
  const idOf = (role: LithosAddrRole) => ids.get(role) ?? null;

  const rollupRows = async (role: "holding" | "evaluation", liveOnly: boolean): Promise<RollupBoxRow[]> => {
    const id = idOf(role);
    if (!id) return [];
    const res = await db.query<{ ch: string; nano: string; live: boolean; r5: unknown; r6: unknown; r7: unknown }>(
      `SELECT creation_height::text AS ch, value_nano::text AS nano, spent_tx_id IS NULL AS live,
              additional_registers->'R5' AS r5,
              additional_registers->'R6' AS r6,
              additional_registers->'R7' AS r7
         FROM packed.boxes
        WHERE addr_id = $1 ${liveOnly ? "AND spent_tx_id IS NULL" : ""}`,
      [id]
    );
    return res.rows.map((r) => ({
      creationHeight: int(r.ch),
      valueNano: int(r.nano),
      live: r.live === true,
      r5: r.r5,
      r6: r.r6,
      r7: r.r7,
    }));
  };
  const holding = await rollupRows("holding", true);
  // Every evaluation box: one per round (more only after a fraud proof), for the bank totals.
  const evaluation = await rollupRows("evaluation", false);

  const sumRoles = (["payout", "collateral", "emissionGate"] as const).filter((r) => idOf(r));
  const sums = new Map<string, UnspentSum>();
  if (sumRoles.length) {
    const res = await db.query<{ addr: string; n: string; nano: string }>(
      `SELECT addr_id::text AS addr, count(*)::text AS n, COALESCE(sum(value_nano), 0)::text AS nano
         FROM packed.boxes
        WHERE spent_tx_id IS NULL AND addr_id = ANY($1::bigint[])
        GROUP BY addr_id`,
      [sumRoles.map((r) => idOf(r))]
    );
    for (const r of res.rows) sums.set(r.addr, { n: int(r.n), nano: int(r.nano) });
  }
  const sumOf = (role: LithosAddrRole): UnspentSum | null => {
    const id = idOf(role);
    if (!id) return null;
    return sums.get(id) ?? { n: 0, nano: 0 };
  };

  let minerRegistry: number | null = null;
  const minerData = idOf("minerData");
  if (minerData) {
    const res = await db.query<{ n: string }>(
      `SELECT count(DISTINCT additional_registers->>'R5')::text AS n
         FROM packed.boxes WHERE addr_id = $1 AND spent_tx_id IS NULL`,
      [minerData]
    );
    minerRegistry = int(res.rows[0]?.n);
  }

  let genesisNano: number | null = null;
  const holdingId = idOf("holding");
  if (holdingId) {
    const res = await db.query<{ nano: string }>(
      `SELECT b.value_nano::text AS nano
         FROM packed.boxes b
        WHERE b.creation_tx_id = (SELECT tx_id FROM packed.lithos_find ORDER BY height DESC LIMIT 1)
          AND b.addr_id = $1
        LIMIT 1`,
      [holdingId]
    );
    if (res.rows[0]) genesisNano = int(res.rows[0].nano);
  }

  let litPool: { nano: bigint; lit: bigint } | null = null;
  const poolId = idOf("litPool");
  if (poolId) {
    const res = await db.query<{ nano: string; lit: string | null }>(
      `SELECT b.value_nano::text AS nano, lit.amount::text AS lit
         FROM packed.boxes b
         JOIN packed.box_assets nft ON nft.box_id = b.box_id AND nft.token_id = packed.hex32($2)
         LEFT JOIN packed.box_assets lit ON lit.box_id = b.box_id AND lit.token_id = packed.hex32($3)
        WHERE b.addr_id = $1 AND b.spent_tx_id IS NULL
        LIMIT 1`,
      [poolId, LITHOS_LIT_POOL_NFT, LIT_TOKEN_ID_MAINNET]
    );
    const row = res.rows[0];
    const nano = big(row?.nano);
    const lit = big(row?.lit);
    if (nano != null && lit != null) litPool = { nano, lit };
  }

  return buildLithosStats({
    tip,
    finds,
    netWindowN,
    holding,
    evaluation,
    payout: sumOf("payout"),
    collateral: sumOf("collateral"),
    queue: sumOf("emissionGate"),
    minerRegistry,
    genesisNano,
    litPool,
    prevSeries: prev?.series ?? [],
    netDays,
    recomputeFrom,
  });
}
