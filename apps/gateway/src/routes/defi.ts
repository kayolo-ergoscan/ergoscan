/**
 * DeFi overlay read API (Phase 5.7d D4+) — localhost-friendly.
 * GET /v1/defi/trades|ranks|health  (+ /api/v1/defi/* aliases)
 *
 * Additive (2026-08-14 plan P1/P2):
 *   trades?cursor=  — keyset pagination (ts_ms|tx_id base64url)
 *   trades?address= — filter by trader (my fills foundation)
 *   ranks.stale     — true when ranksAgeMs > 3 min
 *
 * Additive (2026-08-25 projector):
 *   global trades tape includes leftover spectrum_detect + projector rows.
 *   tokenId= still any source. Path/JSON freeze unchanged.
 *
 * Additive: GET /volume-history — N2T fill volume walls from defi.trades.
 *            ?venue=spectrum|lithos_dex|spectrum_cfmm  ?poolId=
 * Additive: GET /pools — live pools (have a fill). LithosDex also from registry
 *            before the first fill. ?venue=
 * Additive: GET /lithos — LithosDex page snapshot.
 * Additive: GET /spectrum — Spectrum page snapshot (N2T+T2T tape; N2T ERG vol
 *            + N2T trades KPI; eventsCount for the tape; tokenId on all KPIs;
 *            pools with pool_snap.tvl_erg >= 100, else fill-gated).
 * Additive: GET /pool-board — ErgoDex pool list for /defi/pool. Registry +
 *            pool_snap only (TVL, 24h vol, all-time N2T vol, trades, first/last).
 *            Traders per pool are null. Does not replace GET /pools.
 *
 * Data lives in schema `defi` (explorer Postgres). No node REST.
 * Contracts frozen for Edge: path names unchanged.
 */
import type { Express, Request, Response } from "express";
import pg from "pg";
import {
  AGEUSD_BANK_V2_NFT,
  BASIS_ERG_RESERVE_ADDRESS,
  BASIS_TOKEN_RESERVE_ADDRESS,
  basisReserveStatus,
  isBasisReserveAddress,
  decodeSigmaConstant,
  AGEUSD_RC_MAX_RAW,
  AGEUSD_SC_MAX_RAW,
  LITHOS_DEX_VENUE,
  SIGMAUSD_BANK_ADDRESS,
  SIGRSV_TOKEN_ID,
  SIGUSD_TOKEN_ID,
  ageUsdCircRaw,
  decodeRegisterMap,
  displayErgoTokenName,
  longFromRegister,
  snapshotAgeUsd,
  snapshotAgeUsdFromOracle,
  sqlNotAgeUsdBankPool,
  POOL_LIST_MIN_TVL_ERG,
} from "@ergoscan/shared";
import { cacheNoStore, cacheTokens } from "../lib/httpCache.js";
import { fetchErgUsd, fetchOracleErgUsd } from "../lib/market.js";
import {
  SPECTRUM_N2T_SQL,
  SPECTRUM_VENUE_SQL,
  spectrumEventTokenSql,
  spectrumPoolTokenSql,
} from "../lib/spectrum-page.js";

const { Pool } = pg;

export type DefiDeps = {
  getFullHeight?: () => number | null | undefined;
};

const RANKS_STALE_MS = Number(process.env.DEFI_RANKS_STALE_MS || 3 * 60_000);
const VOL_DAYS = new Set([7, 30, 90]);
const DAY_MS = 24 * 60 * 60_000;
const POOL_LIST_CAP = 2_000;

const VENUE_ONE = new Set(["spectrum_cfmm", "spectrum_n2n", "lithos_dex"]);
const VENUE_GROUPS: Record<string, string[]> = {
  spectrum: ["spectrum_cfmm", "spectrum_n2n"],
  lithos: ["lithos_dex"],
};

/** `?venue=spectrum` → both Spectrum venues. `lithos` / `lithos_dex` → Lithos. */
function parseDefiVenues(raw: string): string[] | null {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (VENUE_GROUPS[v]) return VENUE_GROUPS[v];
  if (VENUE_ONE.has(v)) return [v];
  return null;
}

/** Leftover worker rows + projector. Do not add HTTP/Spectrum sources here. */
const LIVE_TRADE_SOURCES_SQL = `source IN ('spectrum_detect', 'projector')`;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  const url =
    process.env.DATABASE_READ_URL ||
    process.env.DATABASE_URL ||
    process.env.INDEXER_DATABASE_URL ||
    "";
  if (!url) return null;
  if (!pool) {
    const withTimeout =
      url.includes("options=") || url.includes("statement_timeout")
        ? url
        : `${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c statement_timeout=4000")}`;
    pool = new Pool({
      connectionString: withTimeout,
      max: 3,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 20_000,
    });
    pool.on("error", () => {
      /* ignore */
    });
  }
  return pool;
}

async function q<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[] | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const r = await p.query<T>(sql, params);
    return r.rows;
  } catch {
    return null;
  }
}

function looksLikeTicker(s: string, tokenId?: string | null): boolean {
  const t = s.trim();
  if (!t || t === "?" || t === "SEED") return false;
  if (t.length > 32 || !/[a-zA-Z]/.test(t)) return false;
  const id = String(tokenId || "").toLowerCase();
  if (id && id.startsWith(t.toLowerCase()) && /^[0-9a-f]+$/i.test(t) && t.length <= 8) {
    return false;
  }
  return true;
}

/** A side name, including an emoji ticker. A pair string (`rsETH/🤡`) is not one side. */
function sideLabel(s: string, tokenId?: string | null): string {
  const t = s.trim();
  if (!t || t === "?" || t === "SEED" || t.includes("/")) return "";
  if (t.length > 32) return "";
  const id = String(tokenId || "").toLowerCase();
  if (id && id.startsWith(t.toLowerCase()) && /^[0-9a-f]+$/i.test(t) && t.length <= 8) {
    return "";
  }
  return t;
}

/** ERG per 1 whole token, from that token's deepest Spectrum ERG pool. */
async function ergPairPrices(tokenIds: string[]): Promise<Map<string, number>> {
  const ids = [
    ...new Set(
      tokenIds
        .map((id) => id.toLowerCase())
        .filter((id) => id && id !== ERG_ZERO && /^[0-9a-f]{64}$/.test(id))
    ),
  ];
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await q<{ token_id: string; price_erg: number }>(
    `
    SELECT DISTINCT ON (r.quote_token)
           r.quote_token AS token_id,
           ps.price_erg::float8 AS price_erg
    FROM defi.pool_registry r
    JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
    WHERE r.venue = 'spectrum_cfmm'
      AND (r.base_token IS NULL OR r.base_token = $2)
      AND r.quote_token = ANY($1::text[])
      AND ps.price_erg > 0
      AND ps.price_erg < 1e12
    ORDER BY r.quote_token, ps.tvl_erg DESC NULLS LAST
    `,
    [ids, ERG_ZERO]
  );
  for (const row of rows ?? []) {
    const px = Number(row.price_erg);
    if (px > 0 && px < 1e12) out.set(String(row.token_id).toLowerCase(), px);
  }
  return out;
}

/**
 * One n2n swap, in ERG. Amounts are whole tokens when they were scaled at
 * write time. A raw amount (decimals unknown then) is at least 10^decimals.
 * Quote side wins so the two legs are not added twice.
 */
function n2nLegErg(amount: number, price: number, decimals: number): number {
  if (!(amount > 0) || !(price > 0) || price >= 1e12) return 0;
  const dec = Math.max(0, Math.min(18, Math.trunc(decimals) || 0));
  const whole = dec > 0 && amount >= 10 ** dec ? amount / 10 ** dec : amount;
  const v = whole * price;
  return Number.isFinite(v) && v > 0 && v < 1e7 ? v : 0;
}

async function n2nVolumeErg(
  poolId: string,
  quoteId: string,
  baseId: string,
  pxQ: number,
  pxB: number
): Promise<{ all: number; d30: number } | null> {
  if (!(pxQ > 0) && !(pxB > 0)) return null;
  const rows = await q<{
    token_amount: number;
    base_amount: number;
    height: number | null;
    dec_q: number | null;
    dec_b: number | null;
    tip: number | null;
  }>(
    `
    SELECT s.token_amount::float8 AS token_amount,
           s.base_amount::float8 AS base_amount,
           s.height,
           tq.decimals AS dec_q,
           tb.decimals AS dec_b,
           (SELECT value::bigint FROM indexer_state WHERE key = 'last_height') AS tip
    FROM defi.swaps s
    LEFT JOIN tokens tq ON tq.token_id = s.token_id
    LEFT JOIN tokens tb ON tb.token_id = s.base_id
    WHERE s.pool_id = $1
      AND s.event_kind = 'swap'
    `,
    [poolId]
  );
  if (!rows) return null;
  let all = 0;
  let d30 = 0;
  const tip = rows[0]?.tip ?? 0;
  const cut = tip > POOL_APR_BLOCKS ? tip - POOL_APR_BLOCKS : 0;
  for (const row of rows) {
    const qv = n2nLegErg(Number(row.token_amount), pxQ, Number(row.dec_q) || 0);
    const bv = n2nLegErg(Number(row.base_amount), pxB, Number(row.dec_b) || 0);
    const v = qv > 0 ? qv : bv;
    if (!(v > 0)) continue;
    all += v;
    if (row.height != null && row.height > cut) d30 += v;
  }
  return { all, d30 };
}

function registerHex(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.serializedValue === "string") return o.serializedValue;
  }
  return null;
}

function eip4NameFromRegs(raw: unknown, tokenId?: string | null): string | null {
  if (!raw || typeof raw !== "object") return null;
  const strs: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const hex = registerHex(v);
    if (hex) strs[k] = hex;
  }
  const text = decodeRegisterMap(strs).R4?.text?.trim() ?? "";
  if (!text || text.length > 32) return null;
  if (/^https?:\/\//i.test(text) || text.startsWith("ipfs://")) return null;
  return looksLikeTicker(text, tokenId) ? text : null;
}

function pickTradeSymbol(
  snap: string,
  tokenName: string | null,
  regs: unknown,
  tokenId: string | null
): string {
  const known = displayErgoTokenName(tokenId, null);
  if (known) return known;
  if (looksLikeTicker(snap, tokenId)) return snap.trim();
  const col = String(tokenName || "").trim();
  if (looksLikeTicker(col, tokenId)) return col;
  return eip4NameFromRegs(regs, tokenId) || "";
}

const ERG_ZERO = "0".repeat(64);
/** Spectrum R4 is feeNum out of 1000. 995 → LPs keep 0.5% of each swap. */
const SPECTRUM_FEE_DENOM = 1000n;
/** ~30d at a 2-minute block. Hits defi_swaps_pool_height, not a time scan. */
const POOL_APR_BLOCKS = 30 * 24 * 30;

function spectrumFeeRate(regs: unknown): number | null {
  if (!regs || typeof regs !== "object" || Array.isArray(regs)) return null;
  const feeNum = longFromRegister((regs as Record<string, unknown>).R4);
  if (feeNum == null || feeNum <= 0n || feeNum >= SPECTRUM_FEE_DENOM) return null;
  return Number(SPECTRUM_FEE_DENOM - feeNum) / Number(SPECTRUM_FEE_DENOM);
}

function mapPoolJson(r: {
  pool_id: string;
  token_id: string;
  base_id: string | null;
  venue: string | null;
  symbol: string | null;
  token_name: string | null;
  base_name: string | null;
  tvl_erg: number | null;
  vol24_erg: number | null;
  last_ts: string | number | null;
}) {
  const tokenId = String(r.token_id || "").toLowerCase();
  const baseId = String(r.base_id || "").toLowerCase();
  const ergoBase = !baseId || baseId === ERG_ZERO;
  const known = displayErgoTokenName(tokenId, null);
  const snap = String(r.symbol || "").trim();
  const col = String(r.token_name || "").trim();
  const symbol =
    known ||
    (looksLikeTicker(snap, tokenId) ? snap : "") ||
    (looksLikeTicker(col, tokenId) ? col : "") ||
    "";
  const baseKnown = ergoBase ? "ERG" : displayErgoTokenName(baseId, null);
  const baseCol = String(r.base_name || "").trim();
  return {
    poolId: String(r.pool_id || "").toLowerCase(),
    tokenId,
    symbol,
    baseId: ergoBase ? ERG_ZERO : baseId,
    baseSymbol: ergoBase
      ? "ERG"
      : baseKnown || sideLabel(baseCol, baseId) || "",
    tvlErg: Number(r.tvl_erg) || 0,
    vol24h: Number(r.vol24_erg) || 0,
    lastTs: Number(r.last_ts) || 0,
    venue: r.venue || null,
  };
}

function mapTrade(r: Record<string, unknown>) {
  const side = String(r.side || "unknown");
  let label = "Trade";
  if (side === "buy") label = "buy";
  else if (side === "sell") label = "sell";
  else if (side === "add") label = "Add liq";
  else if (side === "remove") label = "Remove liq";
  const baseId = String(r.base_id || "").toLowerCase();
  const ergoBase = !baseId || baseId === ERG_ZERO;
  const baseName = String(r.base_name || "").trim();
  return {
    txId: r.tx_id,
    side,
    status: "Filled",
    tokenId: r.token_id || null,
    tokenSymbol: "", // client may resolve; keep Edge-compatible
    baseId: ergoBase ? ERG_ZERO : baseId,
    baseSymbol: ergoBase ? "ERG" : baseName || "token",
    tokenAmount: Number(r.token_amount) || 0,
    baseAmount: Number(r.base_amount) || 0,
    price: r.price != null ? Number(r.price) : null,
    trader: r.trader || "",
    time: Number(r.ts_ms) || 0,
    label,
    poolId: r.pool_id || null,
    height: r.height != null ? Number(r.height) : null,
    source: r.source || "lumen-defi",
    venue: r.venue || null,
  };
}

/** cursor = base64url(`${ts_ms}|${tx_id}`) */
function encodeCursor(tsMs: number, txId: string): string {
  return Buffer.from(`${tsMs}|${txId}`, "utf8").toString("base64url");
}

function decodeCursor(
  raw: string
): { tsMs: number; txId: string } | null {
  try {
    const s = Buffer.from(String(raw || ""), "base64url").toString("utf8");
    const i = s.indexOf("|");
    if (i < 1) return null;
    const tsMs = Number(s.slice(0, i));
    const txId = s.slice(i + 1).toLowerCase();
    if (!Number.isFinite(tsMs) || tsMs <= 0 || txId.length < 16) return null;
    return { tsMs, txId };
  } catch {
    return null;
  }
}

function isErgoAddr(a: string): boolean {
  // P2PK mainnet ~51 chars starting with 9; allow a bit of slack
  return /^9[a-zA-Z0-9]{48,60}$/.test(a);
}

export function registerDefiRoutes(app: Express, _deps: DefiDeps = {}) {
  const handlers = {
    async trades(req: Request, res: Response) {
      const tokenId = String(req.query.tokenId || req.query.token_id || "")
        .trim()
        .toLowerCase();
      const address = String(req.query.address || req.query.trader || "").trim();
      const venueRaw = String(req.query.venue || "").trim();
      const venues = parseDefiVenues(venueRaw);
      const limit = Math.min(
        100,
        Math.max(1, Number(req.query.limit ?? 20) || 20)
      );
      const cursorRaw = String(req.query.cursor || "").trim();
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      const globalTape = !tokenId || tokenId.length < 40;
      const byAddress = address.length > 0 && isErgoAddr(address);

      // Build keyset page: ORDER BY ts_ms DESC, tx_id DESC
      const params: unknown[] = [];
      const where: string[] = [];

      if (globalTape) {
        where.push(`t.${LIVE_TRADE_SOURCES_SQL}`);
      } else {
        params.push(tokenId);
        where.push(`t.token_id = $${params.length}`);
      }
      where.push(sqlNotAgeUsdBankPool("t.pool_id"));

      if (byAddress) {
        params.push(address);
        where.push(`t.trader = $${params.length}`);
      }

      if (venues?.length) {
        params.push(venues);
        where.push(
          `EXISTS (SELECT 1 FROM defi.pool_registry vr WHERE vr.pool_id = t.pool_id AND vr.venue = ANY($${params.length}::text[]))`
        );
      }

      if (cursor) {
        params.push(cursor.tsMs, cursor.txId);
        const a = params.length - 1;
        const b = params.length;
        where.push(
          `(t.ts_ms < $${a} OR (t.ts_ms = $${a} AND t.tx_id < $${b}))`
        );
      }

      params.push(limit);
      const lim = `$${params.length}`;

      // Keep the LIMIT inside: the joins above it must run per page row, not per trade.
      const sql = `
        SELECT t.tx_id, t.box_id, t.token_id, t.base_id, t.side, t.token_amount, t.base_amount,
               t.price, t.trader, t.pool_id, t.height, t.ts_ms, t.source,
               r.venue,
               ps.symbol AS snap_symbol,
               tok.name AS token_name,
               btok.name AS base_name,
               iss.additional_registers AS issuance_regs
        FROM (
          SELECT t.* FROM defi.trades t
          WHERE ${where.join(" AND ")}
          ORDER BY t.ts_ms DESC, t.tx_id DESC
          LIMIT ${lim}
        ) t
        LEFT JOIN defi.pool_registry r ON r.pool_id = t.pool_id
        LEFT JOIN LATERAL (
          SELECT symbol FROM defi.pool_snap s
          WHERE s.token_id = t.token_id
          ORDER BY s.tvl_erg DESC NULLS LAST
          LIMIT 1
        ) ps ON true
        LEFT JOIN tokens tok ON tok.token_id = t.token_id
        LEFT JOIN tokens btok ON btok.token_id = t.base_id
        LEFT JOIN packed.boxes iss ON iss.box_id = packed.hex32(t.token_id)
        ORDER BY t.ts_ms DESC, t.tx_id DESC
      `;

      const rows = await q<Record<string, unknown>>(sql, params);

      if (!rows) {
        cacheNoStore(res);
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          trades: [],
          source: "lumen-defi",
        });
        return;
      }
      const trades = rows.map((r) => {
        const t = mapTrade(r);
        t.tokenSymbol = pickTradeSymbol(
          String(r.snap_symbol || ""),
          r.token_name != null ? String(r.token_name) : null,
          r.issuance_regs,
          t.tokenId != null ? String(t.tokenId) : null
        );
        return t;
      });

      let nextCursor: string | null = null;
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        const ts = Number(last.ts_ms) || 0;
        const tx = String(last.tx_id || "");
        if (ts > 0 && tx) nextCursor = encodeCursor(ts, tx);
      }

      if (byAddress) cacheNoStore(res);
      else cacheTokens(res);
      res.json({
        ok: true,
        tokenId: globalTape ? null : tokenId,
        address: byAddress ? address : null,
        trades,
        count: trades.length,
        nextCursor,
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    async ranks(_req: Request, res: Response) {
      const rows = await q<{
        payload_json: unknown;
        updated_at_ms: string;
        source: string;
      }>(
        `SELECT payload_json, updated_at_ms, source FROM defi.ranks_cache WHERE id = 1`
      );
      if (!rows?.length) {
        cacheNoStore(res);
        res.status(503).json({
          ok: false,
          error: "ranks_cold",
          source: "lumen-defi",
          stale: true,
        });
        return;
      }
      const row = rows[0];
      const payload =
        typeof row.payload_json === "string"
          ? JSON.parse(row.payload_json)
          : row.payload_json;
      const ranksAgeMs = Date.now() - Number(row.updated_at_ms);
      cacheTokens(res);
      res.json({
        ...(payload as object),
        ranksAgeMs,
        stale: ranksAgeMs > RANKS_STALE_MS,
        source: row.source || "lumen-defi",
      });
    },

    /**
     * N2T fill volume by UTC wall. 7d → 12h, 30d/90d → day.
     * GET ?days=7|30|90&tokenId=&venue=spectrum_cfmm|lithos_dex&poolId=
     * Same filter as ranks 24h vol (ERG base, AgeUSD bank off, projector + leftover detect).
     */
    async volumeHistory(req: Request, res: Response) {
      const daysRaw = Number(req.query.days ?? 7);
      const days = VOL_DAYS.has(daysRaw) ? daysRaw : 7;
      const binMs = days <= 7 ? 12 * 60 * 60_000 : DAY_MS;
      const tokenId = String(req.query.tokenId || req.query.token_id || "")
        .trim()
        .toLowerCase();
      const tokenOk = /^[0-9a-f]{64}$/.test(tokenId);
      const venueRaw = String(req.query.venue || "").trim();
      const venues = parseDefiVenues(venueRaw);
      const venue = venues ? venueRaw.trim().toLowerCase() : null;
      const poolId = String(req.query.poolId || req.query.pool_id || "")
        .trim()
        .toLowerCase();
      const poolOk = /^[0-9a-f]{64}$/.test(poolId);
      const until = Math.floor(Date.now() / binMs) * binMs;
      const since = until - days * DAY_MS;
      const params: unknown[] = [since, until, binMs];
      const where = [
        `t.ts_ms >= $1`,
        `t.ts_ms < $2`,
        `t.base_amount IS NOT NULL`,
        `t.base_amount > 0`,
        `COALESCE(t.token_amount, 0) > 0`,
        `t.${LIVE_TRADE_SOURCES_SQL}`,
        sqlNotAgeUsdBankPool("t.pool_id"),
        `(t.base_id IS NULL OR t.base_id = repeat('0', 64))`,
      ];
      if (tokenOk) {
        params.push(tokenId);
        where.push(`t.token_id = $${params.length}`);
      }
      if (poolOk) {
        params.push(poolId);
        where.push(`t.pool_id = $${params.length}`);
      }
      if (venues?.length) {
        params.push(venues);
        where.push(
          `EXISTS (SELECT 1 FROM defi.pool_registry r WHERE r.pool_id = t.pool_id AND r.venue = ANY($${params.length}::text[]))`
        );
      }
      const rows = await q<{ t: string; vol_erg: number; swaps: number }>(
        `SELECT (t.ts_ms / $3::bigint) * $3::bigint AS t,
                COALESCE(SUM(t.base_amount), 0)::float8 AS vol_erg,
                COUNT(*)::int AS swaps
         FROM defi.trades t
         WHERE ${where.join(" AND ")}
         GROUP BY 1
         ORDER BY 1`,
        params
      );
      if (!rows) {
        cacheNoStore(res);
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          points: [],
          source: "lumen-defi",
        });
        return;
      }
      cacheTokens(res);
      res.json({
        ok: true,
        days,
        binMs,
        tokenId: tokenOk ? tokenId : null,
        poolId: poolOk ? poolId : null,
        venue,
        points: rows.map((r) => ({
          t: Number(r.t),
          volErg: Number(r.vol_erg) || 0,
          swaps: Number(r.swaps) || 0,
        })),
        note: "Indexed N2T fills. Not ranks 24h and not T2T.",
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * Live pools: at least one projector/detect fill. AgeUSD bank off.
     * LithosDex also listed from registry before the first fill.
     * GET ?venue=spectrum_cfmm|lithos_dex — no boxes scan.
     * Sort last fill, then 24h snap vol.
     */
    async pools(req: Request, res: Response) {
      const venueRaw = String(req.query.venue || "").trim();
      const venues = parseDefiVenues(venueRaw);
      const venue = venues ? venueRaw.trim().toLowerCase() : null;
      const params: unknown[] = [];
      let venueSql = "";
      if (venues?.length) {
        params.push(venues);
        venueSql = `AND COALESCE(r.venue, '') = ANY($${params.length}::text[])`;
      }
      const includeLithosGhost = !venues || venues.includes("lithos_dex");
      const rows = await q<{
        pool_id: string;
        token_id: string;
        base_id: string | null;
        venue: string | null;
        symbol: string | null;
        token_name: string | null;
        base_name: string | null;
        tvl_erg: number | null;
        vol24_erg: number | null;
        last_ts: string | number | null;
      }>(
        `WITH live AS (
           SELECT DISTINCT ON (t.pool_id)
                  t.pool_id,
                  t.ts_ms AS last_ts,
                  t.token_id,
                  t.base_id
           FROM defi.trades t
           WHERE t.${LIVE_TRADE_SOURCES_SQL}
             AND t.pool_id IS NOT NULL
             AND length(t.pool_id) = 64
             AND ${sqlNotAgeUsdBankPool("t.pool_id")}
           ORDER BY t.pool_id, t.ts_ms DESC
         ),
         listed AS (
           SELECT * FROM live
           ${
             includeLithosGhost
               ? `UNION ALL
           SELECT r.pool_id, 0::bigint AS last_ts, r.quote_token AS token_id, r.base_token AS base_id
           FROM defi.pool_registry r
           WHERE r.venue = 'lithos_dex'
             AND length(r.pool_id) = 64
             AND NOT EXISTS (SELECT 1 FROM live l WHERE l.pool_id = r.pool_id)`
               : ""
           }
         )
         SELECT l.pool_id,
                COALESCE(r.quote_token, ps.token_id, l.token_id) AS token_id,
                COALESCE(r.base_token, l.base_id) AS base_id,
                r.venue,
                COALESCE(NULLIF(ps.symbol, '?'), r.symbol) AS symbol,
                tok.name AS token_name,
                btok.name AS base_name,
                ps.tvl_erg::float8 AS tvl_erg,
                ps.volume_erg_24h::float8 AS vol24_erg,
                l.last_ts
         FROM listed l
         LEFT JOIN defi.pool_registry r ON r.pool_id = l.pool_id
         LEFT JOIN defi.pool_snap ps ON ps.pool_id = l.pool_id
         LEFT JOIN tokens tok ON tok.token_id = COALESCE(r.quote_token, ps.token_id)
         LEFT JOIN tokens btok ON btok.token_id = r.base_token
         WHERE 1=1 ${venueSql}
         ORDER BY l.last_ts DESC NULLS LAST,
                  COALESCE(ps.volume_erg_24h, 0) DESC,
                  l.pool_id
         LIMIT ${POOL_LIST_CAP}`,
        params
      );
      if (!rows) {
        cacheNoStore(res);
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          pools: [],
          source: "lumen-defi",
        });
        return;
      }
      cacheTokens(res);
      res.json({
        ok: true,
        venue,
        pools: rows.map((r) => mapPoolJson(r)),
        note: "Live pools: a fill in defi.trades. LithosDex also from registry before the first fill. Not a boxes scan.",
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * AMM price history from defi.price_tick (worker ranks cycle).
     * GET ?tokenId=&hours=24  → points[{t, priceErg, priceUsd, tvlErg}]
     * GET ?tokenId=&days=30   → one point a day from defi.price_day, up to 10 years.
     * Does NOT replace CG /charts majors — additive index path.
     */
    async priceHistory(req: Request, res: Response) {
      const tokenId = String(req.query.tokenId || req.query.token_id || "")
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(tokenId)) {
        res.status(400).json({
          ok: false,
          error: "tokenId_required",
          points: [],
          source: "lumen-defi",
        });
        return;
      }
      const daysRaw = Number(req.query.days);
      if (Number.isFinite(daysRaw) && daysRaw > 14) {
        const days = Math.min(3650, Math.max(15, Math.floor(daysRaw)));
        const daily = await q<{
          ts_ms: string;
          price_erg: number | null;
          price_usd: number | null;
          tvl_erg: number | null;
        }>(
          `SELECT (extract(epoch FROM day) * 1000)::bigint::text AS ts_ms,
                  price_erg, price_usd, tvl_erg
           FROM defi.price_day
           WHERE token_id = $1
             AND day >= (CURRENT_DATE - $2::int)
           ORDER BY day ASC
           LIMIT 4000`,
          [tokenId, days]
        );
        if (!daily) {
          res.status(503).json({
            ok: false,
            error: "db_unreachable",
            points: [],
            source: "lumen-defi",
          });
          return;
        }
        const points = daily.map((r) => ({
          t: Number(r.ts_ms),
          priceErg: r.price_erg != null ? Number(r.price_erg) : null,
          priceUsd: r.price_usd != null ? Number(r.price_usd) : null,
          tvlErg: r.tvl_erg != null ? Number(r.tvl_erg) : null,
        }));
        res.json({
          ok: true,
          tokenId,
          days,
          points,
          count: points.length,
          source: "lumen-defi",
          at: Date.now(),
        });
        return;
      }
      const hours = Math.min(
        14 * 24,
        Math.max(1, Number(req.query.hours ?? 24) || 24)
      );
      const since = Date.now() - hours * 3600 * 1000;
      const rows = await q<{
        ts_ms: string;
        price_erg: number | null;
        price_usd: number | null;
        tvl_erg: number | null;
      }>(
        `SELECT ts_ms, price_erg, price_usd, tvl_erg
         FROM defi.price_tick
         WHERE token_id = $1 AND ts_ms >= $2
         ORDER BY ts_ms ASC
         LIMIT 5000`,
        [tokenId, since]
      );
      if (!rows) {
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          points: [],
          source: "lumen-defi",
        });
        return;
      }
      const points = rows.map((r) => ({
        t: Number(r.ts_ms),
        priceErg: r.price_erg != null ? Number(r.price_erg) : null,
        priceUsd: r.price_usd != null ? Number(r.price_usd) : null,
        tvlErg: r.tvl_erg != null ? Number(r.tvl_erg) : null,
      }));
      res.json({
        ok: true,
        tokenId,
        hours,
        points,
        count: points.length,
        source: "lumen-defi",
        at: Date.now(),
        note:
          points.length < 2
            ? "warming — ticks written each ranks cycle (~75s)"
            : undefined,
      });
    },

    /**
     * Per-pool TVL / 24h vol from defi.pool_tick (one point per hour, 14 days).
     * GET ?poolId=&hours=24 → points[{t, tvlErg, vol24h, priceErg}]
     */
    async poolHistory(req: Request, res: Response) {
      const poolId = String(req.query.poolId || req.query.pool_id || "")
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(poolId)) {
        res.status(400).json({
          ok: false,
          error: "poolId_required",
          points: [],
          source: "lumen-defi",
        });
        return;
      }
      const hours = Math.min(
        14 * 24,
        Math.max(1, Number(req.query.hours ?? 24) || 24)
      );
      const since = Date.now() - hours * 3600 * 1000;
      const rows = await q<{
        ts_ms: string;
        tvl_erg: number | null;
        volume_erg_24h: number | null;
        price_erg: number | null;
      }>(
        `SELECT ts_ms, tvl_erg, volume_erg_24h, price_erg
         FROM defi.pool_tick
         WHERE pool_id = $1 AND ts_ms >= $2
         ORDER BY ts_ms ASC
         LIMIT 5000`,
        [poolId, since]
      );
      if (!rows) {
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          points: [],
          source: "lumen-defi",
        });
        return;
      }
      const points = rows.map((r) => ({
        t: Number(r.ts_ms),
        tvlErg: r.tvl_erg != null ? Number(r.tvl_erg) : null,
        vol24h: r.volume_erg_24h != null ? Number(r.volume_erg_24h) : null,
        priceErg: r.price_erg != null ? Number(r.price_erg) : null,
      }));
      res.json({
        ok: true,
        poolId,
        hours,
        points,
        count: points.length,
        source: "lumen-defi",
        at: Date.now(),
        note:
          points.length < 2
            ? "warming — one tick per pool per hour"
            : undefined,
      });
    },

    /**
     * Coarse OHLC from price_tick (bucket minutes).
     * GET ?tokenId=&intervalMin=60&limit=48
     */
    async ohlc(req: Request, res: Response) {
      const tokenId = String(req.query.tokenId || req.query.token_id || "")
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(tokenId)) {
        res.status(400).json({
          ok: false,
          error: "tokenId_required",
          candles: [],
          source: "lumen-defi",
        });
        return;
      }
      const intervalMin = Math.min(
        24 * 60,
        Math.max(5, Number(req.query.intervalMin ?? 60) || 60)
      );
      const limit = Math.min(
        500,
        Math.max(1, Number(req.query.limit ?? 48) || 48)
      );
      const bucketMs = intervalMin * 60 * 1000;
      const rows = await q<{
        bucket: string;
        o: number | null;
        h: number | null;
        l: number | null;
        c: number | null;
        tvl: number | null;
      }>(
        `WITH t AS (
           SELECT ts_ms, price_usd, price_erg, tvl_erg,
                  (ts_ms / $2::bigint) * $2::bigint AS bucket
           FROM defi.price_tick
           WHERE token_id = $1
             AND ts_ms > (extract(epoch from now())*1000 - $2::bigint * $3::bigint)
             AND (price_usd IS NOT NULL OR price_erg IS NOT NULL)
         )
         SELECT bucket,
           (array_agg(COALESCE(price_usd, price_erg) ORDER BY ts_ms ASC))[1] AS o,
           max(COALESCE(price_usd, price_erg)) AS h,
           min(COALESCE(price_usd, price_erg)) AS l,
           (array_agg(COALESCE(price_usd, price_erg) ORDER BY ts_ms DESC))[1] AS c,
           max(tvl_erg) AS tvl
         FROM t
         GROUP BY bucket
         ORDER BY bucket DESC
         LIMIT $3`,
        [tokenId, bucketMs, limit]
      );
      if (!rows) {
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          candles: [],
          source: "lumen-defi",
        });
        return;
      }
      const candles = rows
        .map((r) => ({
          t: Number(r.bucket),
          open: r.o != null ? Number(r.o) : null,
          high: r.h != null ? Number(r.h) : null,
          low: r.l != null ? Number(r.l) : null,
          close: r.c != null ? Number(r.c) : null,
          tvlErg: r.tvl != null ? Number(r.tvl) : null,
        }))
        .reverse();
      res.json({
        ok: true,
        tokenId,
        intervalMin,
        candles,
        count: candles.length,
        source: "lumen-defi",
        at: Date.now(),
        note:
          candles.length < 2
            ? "warming — need multiple ranks cycles"
            : "USD preferred when present else ERG",
      });
    },

    async health(_req: Request, res: Response) {
      const trades = await q<{ c: string }>(
        `SELECT count(*)::text AS c FROM defi.trades`
      );
      const ranks = await q<{ updated_at_ms: string; source: string }>(
        `SELECT updated_at_ms, source FROM defi.ranks_cache WHERE id = 1`
      );
      const scans = await q<{ key: string; value: string }>(
        `SELECT key, value
         FROM defi.worker_state
         WHERE key IN ('scan_height', 'scan_height_t2t')`
      );
      const tip = await q<{ value: string }>(
        `SELECT value FROM indexer_state WHERE key = 'last_height'`
      );
      const withTrader = await q<{ c: string }>(
        `SELECT count(*)::text AS c FROM defi.trades
         WHERE ${LIVE_TRADE_SOURCES_SQL}
           AND ${sqlNotAgeUsdBankPool("pool_id")}
           AND trader IS NOT NULL AND trader <> ''
           AND ts_ms > (extract(epoch from now())*1000 - 24*3600*1000)`
      );
      const trades24 = await q<{ c: string }>(
        `SELECT count(*)::text AS c FROM defi.trades
         WHERE ${LIVE_TRADE_SOURCES_SQL}
           AND ${sqlNotAgeUsdBankPool("pool_id")}
           AND ts_ms > (extract(epoch from now())*1000 - 24*3600*1000)`
      );
      const tradesCount = trades?.[0] ? Number(trades[0].c) : null;
      const ranksAt = ranks?.[0] ? Number(ranks[0].updated_at_ms) : null;
      const scanMap = new Map((scans ?? []).map((row) => [row.key, Number(row.value)]));
      const n2tRaw = scanMap.get("scan_height");
      const t2tRaw = scanMap.get("scan_height_t2t");
      const cursorN2t =
        n2tRaw != null && Number.isFinite(n2tRaw) ? n2tRaw : null;
      const cursorT2t =
        t2tRaw != null && Number.isFinite(t2tRaw) ? t2tRaw : null;
      const cursor =
        cursorN2t != null && cursorT2t != null
          ? Math.min(cursorN2t, cursorT2t)
          : null;
      const tipH = tip?.[0] ? Number(tip[0].value) : null;
      const ranksAgeMs = ranksAt != null ? Date.now() - ranksAt : null;
      const t24 = trades24?.[0] ? Number(trades24[0].c) : null;
      const t24tr = withTrader?.[0] ? Number(withTrader[0].c) : null;
      cacheTokens(res);
      res.json({
        ok:
          tradesCount != null &&
          ranksAt != null &&
          cursorN2t != null &&
          cursorT2t != null,
        tradesCount,
        trades24h: Number.isFinite(t24) ? t24 : null,
        ranksAgeMs,
        stale: ranksAgeMs != null ? ranksAgeMs > RANKS_STALE_MS : true,
        ranksSource: ranks?.[0]?.source ?? null,
        workerLag:
          tipH != null && cursor != null ? Math.max(0, tipH - cursor) : null,
        scanHeight: cursor,
        scanHeightN2t: cursorN2t,
        scanHeightT2t: cursorT2t,
        indexerHeight: tipH,
        traderFillRate24h:
          t24 != null && t24 > 0 && t24tr != null
            ? Math.round((t24tr / t24) * 1000) / 1000
            : null,
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    async ageusd(req: Request, res: Response) {
      const limit = Math.min(25, Math.max(1, Math.floor(Number(req.query.limit) || 25)));
      const eventsOffset = Math.max(0, Math.floor(Number(req.query.eventsOffset) || 0));
      const tradersOffset = Math.max(0, Math.floor(Number(req.query.tradersOffset) || 0));
      const sortRaw = String(req.query.eventsSort || "time");
      const sort = ["time", "trader", "ticker", "amount"].includes(sortRaw)
        ? sortRaw
        : "time";
      const dir = String(req.query.eventsDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
      const evOrder =
        sort === "trader"
          ? `trader ${dir} NULLS LAST, ts_ms DESC`
          : sort === "amount"
            ? `token_amount ${dir} NULLS LAST, ts_ms DESC`
            : sort === "ticker"
              ? `CASE token_id WHEN '${SIGUSD_TOKEN_ID}' THEN 0 WHEN '${SIGRSV_TOKEN_ID}' THEN 1 ELSE 2 END ${dir}, token_id ${dir}, ts_ms DESC`
              : `ts_ms ${dir} NULLS LAST, tx_id ${dir}`;
      const [events, counted, topTraders, tradersCounted] = await Promise.all([
        q<{
          tx_id: string;
          height: string | number;
          ts_ms: string | number;
          side: string;
          token_id: string;
          token_amount: string | number;
          base_amount: string | number;
          trader: string | null;
        }>(
        `
        SELECT tx_id, height, ts_ms, side, token_id, token_amount, base_amount, trader
        FROM defi.swaps
        WHERE venue = 'ageusd_bank'
        ORDER BY ${evOrder}
        LIMIT $1 OFFSET $2
        `,
        [limit, eventsOffset]
        ),
        q<{ c: string }>(
          `SELECT count(*)::text AS c FROM defi.swaps WHERE venue = 'ageusd_bank'`
        ),
        q<{ trader: string; erg: string | number; deals: string | number }>(
          `
          SELECT trader, coalesce(sum(base_amount), 0) AS erg, count(*)::int AS deals
          FROM defi.swaps
          WHERE venue = 'ageusd_bank'
            AND trader IS NOT NULL AND trader <> ''
          GROUP BY trader
          ORDER BY sum(base_amount) DESC NULLS LAST
          LIMIT $1 OFFSET $2
          `,
          [limit, tradersOffset]
        ),
        q<{ c: string }>(
          `SELECT count(*)::text AS c FROM (
             SELECT 1 FROM defi.swaps
             WHERE venue = 'ageusd_bank'
               AND trader IS NOT NULL AND trader <> ''
             GROUP BY trader
           ) t`
        ),
      ]);
      const bank = await q<{
        box_id: string;
        value_nano: string;
        creation_height: string | number;
        additional_registers: unknown;
      }>(
        `
        SELECT encode(b.box_id, 'hex') AS box_id, b.value_nano::text,
               b.creation_height, b.additional_registers
        FROM packed.box_assets a
        JOIN packed.boxes b ON b.box_id = a.box_id AND b.spent_tx_id IS NULL
        WHERE a.token_id = decode(lower($1), 'hex') AND a.amount = 1
        ORDER BY b.creation_height DESC NULLS LAST
        LIMIT 1
        `,
        [AGEUSD_BANK_V2_NFT]
      );
      const box = bank?.[0] ?? null;
      const assets = box
        ? await q<{ token_id: string; amount: string }>(
            `SELECT encode(token_id, 'hex') AS token_id, amount::text
               FROM packed.box_assets WHERE box_id = decode(lower($1), 'hex')`,
            [box.box_id]
          )
        : [];
      const amt = (id: string) => {
        const hit = (assets ?? []).find((a) => a.token_id === id);
        const n = Number(hit?.amount);
        return Number.isFinite(n) ? n : null;
      };
      const sigUsdInBank = amt(SIGUSD_TOKEN_ID);
      const sigRsvInBank = amt(SIGRSV_TOKEN_ID);
      const reserveNano = box?.value_nano ?? null;
      const regs =
        box?.additional_registers && typeof box.additional_registers === "object"
          ? (box.additional_registers as Record<string, unknown>)
          : null;
      const scCircReg = regs ? Number(longFromRegister(regs.R4)) : NaN;
      const rcCircReg = regs ? Number(longFromRegister(regs.R5)) : NaN;
      const [{ usd: ergUsd, source: ergUsdSource }, oracle] = await Promise.all([
        fetchErgUsd(),
        fetchOracleErgUsd(),
      ]);
      const status =
        oracle.nano != null && oracle.nano > 0
          ? snapshotAgeUsdFromOracle({
              reserveNano,
              scCircRaw:
                Number.isFinite(scCircReg) && scCircReg > 0
                  ? scCircReg
                  : ageUsdCircRaw(sigUsdInBank, AGEUSD_SC_MAX_RAW),
              rcCircRaw:
                Number.isFinite(rcCircReg) && rcCircReg > 0
                  ? rcCircReg
                  : ageUsdCircRaw(sigRsvInBank, AGEUSD_RC_MAX_RAW),
              nanoPerUsd: oracle.nano,
            })
          : snapshotAgeUsd({
              reserveNano,
              sigUsdInBank,
              sigRsvInBank,
              ergUsd: ergUsd > 0 ? ergUsd : null,
            });
      cacheTokens(res);
      res.json({
        ok: true,
        protocol: "ageusd-v2",
        bankAddress: SIGMAUSD_BANK_ADDRESS,
        nft: AGEUSD_BANK_V2_NFT,
        sigUsdToken: SIGUSD_TOKEN_ID,
        sigRsvToken: SIGRSV_TOKEN_ID,
        boxId: box?.box_id ?? null,
        height: box ? Number(box.creation_height) : null,
        reserveNano,
        sigUsdInBank,
        sigRsvInBank,
        ergUsd: ergUsd > 0 ? ergUsd : null,
        ergUsdSource,
        ergUsdOracle: oracle.usd,
        ergUsdOracleNano: oracle.nano,
        ergUsdOracleBoxId: oracle.boxId,
        ergUsdOracleHeight: oracle.height,
        ...status,
        eventsCount: counted?.[0] ? Number(counted[0].c) : null,
        tradersCount: tradersCounted?.[0] ? Number(tradersCounted[0].c) : null,
        eventsOffset,
        tradersOffset,
        events: (events ?? []).map((e) => ({
          txId: String(e.tx_id),
          height: Number(e.height) || null,
          time: Number(e.ts_ms) || null,
          side: String(e.side || ""),
          tokenId: String(e.token_id || ""),
          tokenAmount: Number(e.token_amount) || 0,
          baseAmount: Number(e.base_amount) || 0,
          trader: e.trader || null,
        })),
        topTraders: (topTraders ?? []).map((r) => ({
          trader: String(r.trader),
          erg: Number(r.erg) || 0,
          deals: Number(r.deals) || 0,
        })),
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * LithosDex page snapshot — AgeUSD-shaped: KPIs + tape pack + top traders + pools.
     * GET ?limit=25&eventsOffset=&tradersOffset=&eventsSort=time|ticker|amount&eventsDir=
     * Fills from defi.swaps venue=lithos_dex. TVL from pool_snap. No Lithos HTTP.
     */
    async lithos(req: Request, res: Response) {
      const limit = Math.min(25, Math.max(1, Math.floor(Number(req.query.limit) || 25)));
      const eventsOffset = Math.max(0, Math.floor(Number(req.query.eventsOffset) || 0));
      const tradersOffset = Math.max(0, Math.floor(Number(req.query.tradersOffset) || 0));
      const tokenId = String(req.query.tokenId || req.query.token_id || "")
        .trim()
        .toLowerCase();
      const tokenOk = /^[0-9a-f]{64}$/.test(tokenId);
      const sortRaw = String(req.query.eventsSort || "time");
      const sort = ["time", "trader", "ticker", "amount"].includes(sortRaw)
        ? sortRaw
        : "time";
      const dir = String(req.query.eventsDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
      const evOrder =
        sort === "trader"
          ? `trader ${dir} NULLS LAST, ts_ms DESC`
          : sort === "amount"
            ? `token_amount ${dir} NULLS LAST, ts_ms DESC`
            : sort === "ticker"
              ? `token_id ${dir}, ts_ms DESC`
              : `ts_ms ${dir} NULLS LAST, tx_id ${dir}`;
      const eventParams: unknown[] = tokenOk
        ? [limit, eventsOffset, tokenId]
        : [limit, eventsOffset];
      const eventWhere = tokenOk
        ? `venue = '${LITHOS_DEX_VENUE}' AND token_id = $3`
        : `venue = '${LITHOS_DEX_VENUE}'`;
      const countParams: unknown[] = tokenOk ? [tokenId] : [];
      const countWhere = tokenOk
        ? `venue = '${LITHOS_DEX_VENUE}' AND token_id = $1`
        : `venue = '${LITHOS_DEX_VENUE}'`;
      const [
        events,
        counted,
        topTraders,
        tradersCounted,
        kpis,
        poolRows,
      ] = await Promise.all([
        q<{
          tx_id: string;
          height: string | number;
          ts_ms: string | number;
          side: string;
          token_id: string;
          token_amount: string | number;
          base_amount: string | number;
          trader: string | null;
        }>(
          `
          SELECT tx_id, height, ts_ms, side, token_id, token_amount, base_amount, trader
          FROM defi.swaps
          WHERE ${eventWhere}
          ORDER BY ${evOrder}
          LIMIT $1 OFFSET $2
          `,
          eventParams
        ),
        q<{ c: string }>(
          `SELECT count(*)::text AS c FROM defi.swaps WHERE ${countWhere}`,
          countParams
        ),
        q<{ trader: string; erg: string | number; deals: string | number }>(
          `
          SELECT trader, coalesce(sum(base_amount), 0) AS erg, count(*)::int AS deals
          FROM defi.swaps
          WHERE venue = '${LITHOS_DEX_VENUE}'
            AND trader IS NOT NULL AND trader <> ''
          GROUP BY trader
          ORDER BY sum(base_amount) DESC NULLS LAST
          LIMIT $1 OFFSET $2
          `,
          [limit, tradersOffset]
        ),
        q<{ c: string }>(
          `SELECT count(*)::text AS c FROM (
             SELECT 1 FROM defi.swaps
             WHERE venue = '${LITHOS_DEX_VENUE}'
               AND trader IS NOT NULL AND trader <> ''
             GROUP BY trader
           ) t`
        ),
        q<{ tvl_erg: number | null; vol_erg: number | null }>(
          `
          SELECT
            (SELECT coalesce(sum(ps.tvl_erg), 0)::float8
               FROM defi.pool_registry r
               LEFT JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
              WHERE r.venue = '${LITHOS_DEX_VENUE}') AS tvl_erg,
            (SELECT coalesce(sum(s.base_amount), 0)::float8
               FROM defi.swaps s
              WHERE s.venue = '${LITHOS_DEX_VENUE}'
                AND s.event_kind = 'swap'
                AND s.base_amount IS NOT NULL
                AND s.base_amount > 0
                AND coalesce(s.token_amount, 0) > 0) AS vol_erg
          `
        ),
        q<{
          pool_id: string;
          token_id: string;
          base_id: string | null;
          venue: string | null;
          symbol: string | null;
          token_name: string | null;
          base_name: string | null;
          tvl_erg: number | null;
          vol24_erg: number | null;
          last_ts: string | number | null;
        }>(
          `
          SELECT r.pool_id,
                 r.quote_token AS token_id,
                 r.base_token AS base_id,
                 r.venue,
                 coalesce(nullif(ps.symbol, '?'), r.symbol) AS symbol,
                 tok.name AS token_name,
                 btok.name AS base_name,
                 ps.tvl_erg::float8 AS tvl_erg,
                 ps.volume_erg_24h::float8 AS vol24_erg,
                 0::bigint AS last_ts
          FROM defi.pool_registry r
          LEFT JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
          LEFT JOIN tokens tok ON tok.token_id = r.quote_token
          LEFT JOIN tokens btok ON btok.token_id = r.base_token
          WHERE r.venue = '${LITHOS_DEX_VENUE}'
            AND length(r.pool_id) = 64
          ORDER BY coalesce(ps.tvl_erg, 0) DESC, r.pool_id
          LIMIT 200
          `
        ),
      ]);
      const kpi = kpis?.[0];
      cacheTokens(res);
      res.json({
        ok: true,
        protocol: "lithos-dex",
        venue: LITHOS_DEX_VENUE,
        tvlErg: kpi?.tvl_erg != null ? Number(kpi.tvl_erg) : null,
        volErg: kpi?.vol_erg != null ? Number(kpi.vol_erg) : null,
        tradesCount: counted?.[0] ? Number(counted[0].c) : null,
        tradersCount: tradersCounted?.[0] ? Number(tradersCounted[0].c) : null,
        eventsOffset,
        tradersOffset,
        events: (events ?? []).map((e) => ({
          txId: String(e.tx_id),
          height: Number(e.height) || null,
          time: Number(e.ts_ms) || null,
          side: String(e.side || ""),
          tokenId: String(e.token_id || ""),
          tokenAmount: Number(e.token_amount) || 0,
          baseAmount: Number(e.base_amount) || 0,
          trader: e.trader || null,
        })),
        topTraders: (topTraders ?? []).map((r) => ({
          trader: String(r.trader),
          erg: Number(r.erg) || 0,
          deals: Number(r.deals) || 0,
        })),
        pools: (poolRows ?? []).map((r) => mapPoolJson(r)),
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * Spectrum page snapshot — AgeUSD/Lithos-shaped.
     * GET ?limit=25&eventsOffset=&tradersOffset=&eventsSort=&eventsDir=&tokenId=
     * Tape: defi.swaps CFMM+N2N (eventsCount). tradesCount and tradersCount match /defi/pool.
     * tokenId filters tape, KPIs, traders, pools. Pools TVL>=100, else fills.
     */
    async spectrum(req: Request, res: Response) {
      const limit = Math.min(25, Math.max(1, Math.floor(Number(req.query.limit) || 25)));
      const eventsOffset = Math.max(0, Math.floor(Number(req.query.eventsOffset) || 0));
      const tradersOffset = Math.max(0, Math.floor(Number(req.query.tradersOffset) || 0));
      const tokenId = String(req.query.tokenId || req.query.token_id || "")
        .trim()
        .toLowerCase();
      const tokenOk = /^[0-9a-f]{64}$/.test(tokenId);
      const sortRaw = String(req.query.eventsSort || "time");
      const sort = ["time", "trader", "ticker", "amount"].includes(sortRaw)
        ? sortRaw
        : "time";
      const dir = String(req.query.eventsDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
      const evOrder =
        sort === "trader"
          ? `trader ${dir} NULLS LAST, ts_ms DESC`
          : sort === "amount"
            ? `token_amount ${dir} NULLS LAST, ts_ms DESC`
            : sort === "ticker"
              ? `token_id ${dir}, ts_ms DESC`
              : `ts_ms ${dir} NULLS LAST, tx_id ${dir}`;
      const eventParams: unknown[] = tokenOk
        ? [limit, eventsOffset, tokenId]
        : [limit, eventsOffset];
      const eventWhere = tokenOk
        ? `${SPECTRUM_VENUE_SQL} AND ${spectrumEventTokenSql(3)}`
        : SPECTRUM_VENUE_SQL;
      const countParams: unknown[] = tokenOk ? [tokenId] : [];
      const eventCountWhere = tokenOk
        ? `${SPECTRUM_VENUE_SQL} AND ${spectrumEventTokenSql(1)}`
        : SPECTRUM_VENUE_SQL;
      const traderWhere = tokenOk
        ? `${SPECTRUM_VENUE_SQL} AND ${spectrumEventTokenSql(3)} AND trader IS NOT NULL AND trader <> ''`
        : `${SPECTRUM_VENUE_SQL} AND ${SPECTRUM_N2T_SQL} AND trader IS NOT NULL AND trader <> ''`;
      const traderCountWhere = tokenOk
        ? `event_kind = 'swap' AND ${SPECTRUM_VENUE_SQL} AND ${spectrumEventTokenSql(1)} AND trader IS NOT NULL AND trader <> ''`
        : `event_kind = 'swap' AND ${SPECTRUM_VENUE_SQL} AND trader IS NOT NULL AND trader <> ''`;
      const poolTokenSql = tokenOk ? `AND ${spectrumPoolTokenSql("r", 2)}` : "";
      const kpiTokenSql = tokenOk ? `AND ${spectrumPoolTokenSql("r", 2)}` : "";
      const kpiParams: unknown[] = tokenOk
        ? [POOL_LIST_MIN_TVL_ERG, tokenId]
        : [POOL_LIST_MIN_TVL_ERG];
      const tvlPoolParams: unknown[] = tokenOk
        ? [POOL_LIST_MIN_TVL_ERG, tokenId]
        : [POOL_LIST_MIN_TVL_ERG];
      const [
        events,
        counted,
        topTraders,
        tradersCounted,
        kpis,
        tvlPools,
      ] = await Promise.all([
        q<{
          tx_id: string;
          height: string | number;
          ts_ms: string | number;
          side: string;
          token_id: string;
          base_id: string | null;
          token_amount: string | number;
          base_amount: string | number;
          trader: string | null;
        }>(
          `
          SELECT tx_id, height, ts_ms, side, token_id, base_id, token_amount, base_amount, trader
          FROM defi.swaps
          WHERE ${eventWhere}
          ORDER BY ${evOrder}
          LIMIT $1 OFFSET $2
          `,
          eventParams
        ),
        q<{ c: string }>(
          `SELECT count(*)::text AS c FROM defi.swaps WHERE ${eventCountWhere}`,
          countParams
        ),
        q<{ trader: string; erg: string | number; deals: string | number }>(
          `
          SELECT trader, coalesce(sum(base_amount), 0) AS erg, count(*)::int AS deals
          FROM defi.swaps
          WHERE ${traderWhere}
          GROUP BY trader
          ORDER BY sum(base_amount) DESC NULLS LAST
          LIMIT $1 OFFSET $2
          `,
          tokenOk ? [limit, tradersOffset, tokenId] : [limit, tradersOffset]
        ),
        tokenOk
          ? q<{ c: string }>(
              `SELECT count(*)::text AS c FROM (
                 SELECT 1 FROM defi.swaps
                 WHERE ${traderCountWhere}
                 GROUP BY trader
               ) t`,
              countParams
            )
          : q<{ value: string }>(
              `SELECT value FROM defi.worker_state WHERE key = 'spectrum_traders'`
            ),
        q<{ tvl_erg: number | null; vol_erg: number | null; trades_n: string | null }>(
          `
          SELECT
            (SELECT coalesce(sum(ps.tvl_erg), 0)::float8
               FROM defi.pool_registry r
               JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
              WHERE r.venue IN ('spectrum_cfmm', 'spectrum_n2n')
                AND coalesce(ps.tvl_erg, 0) >= $1
                ${kpiTokenSql}) AS tvl_erg,
            (SELECT coalesce(sum(ps.vol_erg), 0)::float8
               FROM defi.pool_registry r
               JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
              WHERE r.venue = 'spectrum_cfmm'
                ${kpiTokenSql}) AS vol_erg,
            (SELECT coalesce(sum(ps.trades_n), 0)::text
               FROM defi.pool_registry r
               JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
              WHERE r.venue = 'spectrum_cfmm'
                ${kpiTokenSql}) AS trades_n
          `,
          kpiParams
        ),
        q<{
          pool_id: string;
          token_id: string;
          base_id: string | null;
          venue: string | null;
          symbol: string | null;
          token_name: string | null;
          base_name: string | null;
          tvl_erg: number | null;
          vol24_erg: number | null;
          last_ts: string | number | null;
        }>(
          `
          SELECT r.pool_id,
                 r.quote_token AS token_id,
                 r.base_token AS base_id,
                 r.venue,
                 coalesce(nullif(ps.symbol, '?'), r.symbol) AS symbol,
                 tok.name AS token_name,
                 btok.name AS base_name,
                 ps.tvl_erg::float8 AS tvl_erg,
                 ps.volume_erg_24h::float8 AS vol24_erg,
                 0::bigint AS last_ts
          FROM defi.pool_registry r
          LEFT JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
          LEFT JOIN tokens tok ON tok.token_id = r.quote_token
          LEFT JOIN tokens btok ON btok.token_id = r.base_token
          WHERE r.venue IN ('spectrum_cfmm', 'spectrum_n2n')
            AND length(r.pool_id) = 64
            AND coalesce(ps.tvl_erg, 0) >= $1
            ${poolTokenSql}
          ORDER BY coalesce(ps.tvl_erg, 0) DESC, r.pool_id
          LIMIT 200
          `,
          tvlPoolParams
        ),
      ]);
      let listedBy: "tvl" | "fills" = "tvl";
      let poolRows = tvlPools;
      if (!poolRows?.length) {
        listedBy = "fills";
        const fillParams: unknown[] = tokenOk ? [tokenId] : [];
        const fillTokenSql = tokenOk
          ? `AND ${spectrumEventTokenSql(1)}`
          : "";
        const fillRegTokenSql = tokenOk
          ? `AND ${spectrumPoolTokenSql("r", 1)}`
          : "";
        poolRows = await q<{
          pool_id: string;
          token_id: string;
          base_id: string | null;
          venue: string | null;
          symbol: string | null;
          token_name: string | null;
          base_name: string | null;
          tvl_erg: number | null;
          vol24_erg: number | null;
          last_ts: string | number | null;
        }>(
          `
          WITH live AS (
            SELECT DISTINCT ON (t.pool_id)
                   t.pool_id,
                   t.ts_ms AS last_ts,
                   t.token_id,
                   t.base_id
            FROM defi.trades t
            WHERE t.${LIVE_TRADE_SOURCES_SQL}
              AND t.pool_id IS NOT NULL
              AND length(t.pool_id) = 64
              AND ${sqlNotAgeUsdBankPool("t.pool_id")}
              ${fillTokenSql}
            ORDER BY t.pool_id, t.ts_ms DESC
          )
          SELECT l.pool_id,
                 COALESCE(r.quote_token, ps.token_id, l.token_id) AS token_id,
                 COALESCE(r.base_token, l.base_id) AS base_id,
                 r.venue,
                 COALESCE(NULLIF(ps.symbol, '?'), r.symbol) AS symbol,
                 tok.name AS token_name,
                 btok.name AS base_name,
                 ps.tvl_erg::float8 AS tvl_erg,
                 ps.volume_erg_24h::float8 AS vol24_erg,
                 l.last_ts
          FROM live l
          JOIN defi.pool_registry r ON r.pool_id = l.pool_id
          LEFT JOIN defi.pool_snap ps ON ps.pool_id = l.pool_id
          LEFT JOIN tokens tok ON tok.token_id = COALESCE(r.quote_token, ps.token_id)
          LEFT JOIN tokens btok ON btok.token_id = r.base_token
          WHERE r.venue IN ('spectrum_cfmm', 'spectrum_n2n')
            ${fillRegTokenSql}
          ORDER BY l.last_ts DESC NULLS LAST,
                   COALESCE(ps.volume_erg_24h, 0) DESC,
                   l.pool_id
          LIMIT 200
          `,
          fillParams
        );
      }
      const kpi = kpis?.[0];
      cacheTokens(res);
      res.json({
        ok: true,
        protocol: "spectrum-amm",
        venue: "spectrum",
        minTvlErg: listedBy === "tvl" ? POOL_LIST_MIN_TVL_ERG : 0,
        listedBy,
        tvlErg: kpi?.tvl_erg != null ? Number(kpi.tvl_erg) : null,
        volErg: kpi?.vol_erg != null ? Number(kpi.vol_erg) : null,
        tradesCount: kpi?.trades_n != null ? Number(kpi.trades_n) : null,
        eventsCount: counted?.[0] ? Number(counted[0].c) : null,
        tradersCount: tradersCounted?.[0]
          ? Number(
              "value" in tradersCounted[0] ? tradersCounted[0].value : tradersCounted[0].c
            )
          : null,
        eventsOffset,
        tradersOffset,
        events: (events ?? []).map((e) => ({
          txId: String(e.tx_id),
          height: Number(e.height) || null,
          time: Number(e.ts_ms) || null,
          side: String(e.side || ""),
          tokenId: String(e.token_id || ""),
          baseId: e.base_id ? String(e.base_id).toLowerCase() : null,
          tokenAmount: Number(e.token_amount) || 0,
          baseAmount: Number(e.base_amount) || 0,
          trader: e.trader || null,
        })),
        topTraders: (topTraders ?? []).map((r) => ({
          trader: String(r.trader),
          erg: Number(r.erg) || 0,
          deals: Number(r.deals) || 0,
        })),
        pools: (poolRows ?? []).map((r) => mapPoolJson(r)),
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * ErgoDex pool board for /defi/pool.
     * Reads registry + pool_snap. No swaps scan except the Spectrum traders KPI.
     * Per-pool traders stay null until a cheap distinct set exists.
     */
    async poolBoard(_req: Request, res: Response) {
      const [rows, kpis, tradersCounted] = await Promise.all([
        q<{
          pool_id: string;
          token_id: string;
          base_id: string | null;
          venue: string | null;
          symbol: string | null;
          token_name: string | null;
          base_name: string | null;
          tvl_erg: number | null;
          vol24_erg: number | null;
          price_erg: number | null;
          trades_n: string | number | null;
          vol_erg: number | null;
          traders_n: string | number | null;
          first_ts: string | number | null;
          last_ts: string | number | null;
        }>(
          `
          SELECT r.pool_id,
                 r.quote_token AS token_id,
                 r.base_token AS base_id,
                 r.venue,
                 coalesce(nullif(ps.symbol, '?'), r.symbol) AS symbol,
                 tok.name AS token_name,
                 btok.name AS base_name,
                 ps.tvl_erg::float8 AS tvl_erg,
                 ps.volume_erg_24h::float8 AS vol24_erg,
                 ps.price_erg::float8 AS price_erg,
                 ps.trades_n::text AS trades_n,
                 ps.vol_erg::float8 AS vol_erg,
                 ps.traders_n::text AS traders_n,
                 ps.first_ts_ms AS first_ts,
                 ps.last_ts_ms AS last_ts
          FROM defi.pool_registry r
          LEFT JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
          LEFT JOIN tokens tok ON tok.token_id = r.quote_token
          LEFT JOIN tokens btok ON btok.token_id = r.base_token
          WHERE r.venue IN ('spectrum_cfmm', 'spectrum_n2n')
            AND length(r.pool_id) = 64
          `
        ),
        q<{
          tvl_erg: number | null;
          vol_erg: number | null;
          trades_n: string | number | null;
          rolled: boolean | null;
        }>(
          `
          SELECT
            coalesce(sum(ps.tvl_erg) FILTER (
              WHERE coalesce(ps.tvl_erg, 0) >= $1
            ), 0)::float8 AS tvl_erg,
            coalesce(sum(ps.vol_erg) FILTER (
              WHERE r.venue = 'spectrum_cfmm'
            ), 0)::float8 AS vol_erg,
            coalesce(sum(ps.trades_n) FILTER (
              WHERE r.venue = 'spectrum_cfmm'
            ), 0)::text AS trades_n,
            bool_or(ps.trades_n IS NOT NULL) AS rolled
          FROM defi.pool_registry r
          LEFT JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
          WHERE r.venue IN ('spectrum_cfmm', 'spectrum_n2n')
          `,
          [POOL_LIST_MIN_TVL_ERG]
        ),
        q<{ value: string }>(
          `SELECT value FROM defi.worker_state WHERE key = 'spectrum_traders'`
        ),
      ]);
      if (!rows || !kpis) {
        cacheNoStore(res);
        res.status(503).json({
          ok: false,
          error: "db_unreachable",
          pools: [],
          source: "lumen-defi",
        });
        return;
      }
      const kpi = kpis[0];
      const rolled = kpi?.rolled === true;
      cacheTokens(res);
      res.json({
        ok: true,
        protocol: "spectrum-amm",
        rolled,
        minTvlErg: POOL_LIST_MIN_TVL_ERG,
        tvlErg: kpi?.tvl_erg != null ? Number(kpi.tvl_erg) : null,
        volErg: rolled && kpi?.vol_erg != null ? Number(kpi.vol_erg) : null,
        tradesCount: rolled && kpi?.trades_n != null ? Number(kpi.trades_n) : null,
        tradersCount: tradersCounted?.[0] ? Number(tradersCounted[0].value) : null,
        pools: rows.map((r) => {
          const base = mapPoolJson({
            pool_id: r.pool_id,
            token_id: r.token_id,
            base_id: r.base_id,
            venue: r.venue,
            symbol: r.symbol,
            token_name: r.token_name,
            base_name: r.base_name,
            tvl_erg: r.tvl_erg,
            vol24_erg: r.vol24_erg,
            last_ts: r.last_ts,
          });
          const trades = r.trades_n != null && r.trades_n !== "" ? Number(r.trades_n) : null;
          const traders = r.traders_n != null && r.traders_n !== "" ? Number(r.traders_n) : null;
          return {
            ...base,
            volErg: r.vol_erg != null ? Number(r.vol_erg) : null,
            priceErg: r.price_erg != null && Number(r.price_erg) > 0 ? Number(r.price_erg) : null,
            trades: trades != null && Number.isFinite(trades) ? trades : null,
            firstTs: r.first_ts != null && Number(r.first_ts) > 0 ? Number(r.first_ts) : null,
            traders: traders != null && Number.isFinite(traders) ? traders : null,
          };
        }),
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * One ErgoDex/Lithos pool. Trades from defi.swaps. LPs from the fungible
     * share token on the unspent pool box (not the NFT), minus the pool P2S.
     */
    async poolCard(req: Request, res: Response) {
      const poolId = String(req.params.id || "")
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(poolId)) {
        res.status(400).json({ ok: false, error: "bad_pool" });
        return;
      }
      const view = String(req.query.view || "trades") === "lp" ? "lp" : "trades";
      const limit = 25;
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
      const sortRaw = String(req.query.sort || "time");
      const dir = String(req.query.dir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
      const poolRows = await q<{
        pool_id: string;
        token_id: string;
        base_id: string | null;
        venue: string | null;
        symbol: string | null;
        token_name: string | null;
        base_name: string | null;
        tvl_erg: number | null;
        vol24_erg: number | null;
        price_erg: number | null;
        trades_n: string | null;
        vol_erg: number | null;
        vol_30: number | null;
        fee_rate: number | null;
        first_ts: string | number | null;
        last_ts: string | number | null;
      }>(
        `
        SELECT r.pool_id, r.quote_token AS token_id, r.base_token AS base_id, r.venue,
               coalesce(nullif(ps.symbol, '?'), r.symbol) AS symbol,
               tok.name AS token_name, btok.name AS base_name,
               ps.tvl_erg::float8 AS tvl_erg,
               ps.volume_erg_24h::float8 AS vol24_erg,
               ps.price_erg::float8 AS price_erg,
               ps.trades_n::text AS trades_n,
               ps.vol_erg::float8 AS vol_erg,
               ps.vol_erg_30d::float8 AS vol_30,
               ps.fee_rate::float8 AS fee_rate,
               ps.first_ts_ms AS first_ts,
               ps.last_ts_ms AS last_ts
        FROM defi.pool_registry r
        LEFT JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
        LEFT JOIN tokens tok ON tok.token_id = r.quote_token
        LEFT JOIN tokens btok ON btok.token_id = r.base_token
        WHERE r.pool_id = $1
        `,
        [poolId]
      );
      const row = poolRows?.[0];
      if (!row) {
        cacheNoStore(res);
        res.status(404).json({ ok: false, error: "pool_not_found" });
        return;
      }
      const base = mapPoolJson({
        pool_id: row.pool_id,
        token_id: row.token_id,
        base_id: row.base_id,
        venue: row.venue,
        symbol: row.symbol,
        token_name: row.token_name,
        base_name: row.base_name,
        tvl_erg: row.tvl_erg,
        vol24_erg: row.vol24_erg,
        last_ts: row.last_ts,
      });
      const tradesN = row.trades_n != null && row.trades_n !== "" ? Number(row.trades_n) : null;
      const pool = {
        ...base,
        volErg: row.vol_erg != null ? Number(row.vol_erg) : null,
        priceErg: row.price_erg != null && Number(row.price_erg) > 0 ? Number(row.price_erg) : null,
        trades: tradesN != null && Number.isFinite(tradesN) ? tradesN : null,
        firstTs: row.first_ts != null && Number(row.first_ts) > 0 ? Number(row.first_ts) : null,
        feePct: null as number | null,
        income30Erg: null as number | null,
        apr30Pct: null as number | null,
      };
      const feeRate = row.fee_rate != null && Number(row.fee_rate) > 0 ? Number(row.fee_rate) : null;
      const vol30 = row.vol_30 != null && Number(row.vol_30) > 0 ? Number(row.vol_30) : 0;
      pool.feePct = feeRate != null ? feeRate * 100 : null;
      if (feeRate != null && vol30 > 0 && pool.tvlErg > 0) {
        const income = vol30 * feeRate;
        pool.income30Erg = income;
        pool.apr30Pct = (income / pool.tvlErg) * (365 / 30) * 100;
      }
      if (view === "lp") {
        const boxSql = `
          SELECT box.address, encode(ba.token_id, 'hex') AS token_id,
                 ba.amount::text, tok.emission::text AS emission
          FROM box
          JOIN packed.box_assets ba ON ba.box_id = box.box_id
          LEFT JOIN tokens tok ON tok.token_id = encode(ba.token_id, 'hex')
        `;
        let box = await q<{
          address: string | null;
          token_id: string;
          amount: string;
          emission: string | null;
        }>(
          `
          WITH last AS (
            SELECT tx_id FROM defi.swaps
            WHERE pool_id = $1 AND event_kind = 'swap'
            ORDER BY height DESC NULLS LAST, ts_ms DESC
            LIMIT 1
          ),
          box AS (
            SELECT b.box_id, ad.address
            FROM last
            JOIN packed.boxes b
              ON b.creation_tx_id = decode(lower(last.tx_id), 'hex')
             AND b.spent_tx_id IS NULL
            JOIN packed.box_assets nft
              ON nft.box_id = b.box_id
             AND nft.token_id = decode(lower($1), 'hex')
             AND nft.amount = 1
            LEFT JOIN packed.addr ad ON ad.id = b.addr_id
            LIMIT 1
          )
          ${boxSql}
          `,
          [poolId]
        );
        if (!box?.length) {
          box = await q(
            `
            WITH box AS (
              SELECT b.box_id, ad.address
              FROM packed.box_assets nft
              JOIN packed.boxes b ON b.box_id = nft.box_id AND b.spent_tx_id IS NULL
              LEFT JOIN packed.addr ad ON ad.id = b.addr_id
              WHERE nft.token_id = decode(lower($1), 'hex') AND nft.amount = 1
              ORDER BY b.creation_height DESC NULLS LAST
              LIMIT 1
            )
            ${boxSql}
            `,
            [poolId]
          );
        }
        const assets = box ?? [];
        const poolAddr = assets[0]?.address ?? "";
        const skip = new Set(
          [poolId, base.tokenId, base.baseId && base.baseId !== ERG_ZERO ? base.baseId : ""]
            .map((s) => s.toLowerCase())
            .filter(Boolean)
        );
        const asInt = (v: string | null | undefined) => {
          const s = String(v ?? "0").split(".")[0] || "0";
          return /^-?\d+$/.test(s) ? BigInt(s) : 0n;
        };
        const rest = assets.filter((a) => !skip.has(a.token_id.toLowerCase()));
        const lp = [...rest].sort((a, b) => {
          const ae = asInt(a.emission);
          const be = asInt(b.emission);
          return ae === be ? 0 : ae > be ? -1 : 1;
        })[0];
        if (!lp) {
          cacheTokens(res);
          res.json({
            ok: true,
            pool,
            view,
            lpTokenId: null,
            lps: [],
            lpTotal: 0,
            source: "lumen-defi",
            at: Date.now(),
          });
          return;
        }
        const onPool = asInt(lp.amount);
        const emission = lp.emission != null ? asInt(lp.emission) : null;
        const circulating =
          emission != null && emission > onPool ? emission - onPool : emission ?? 0n;
        const holders = await q<{
          address: string;
          amount: string;
          tx_count: number | null;
          first_height: string | null;
          last_height: string | null;
        }>(
          `
          SELECT address, amount::text AS amount, tx_count, first_height::text, last_height::text
          FROM token_balances
          WHERE token_id = $1 AND amount > 0 AND address <> $2
          ORDER BY token_balances.amount DESC
          LIMIT 500
          `,
          [lp.token_id, poolAddr]
        );
        const heights = new Set<number>();
        for (const h of holders ?? []) {
          const a = Number(h.first_height);
          const b = Number(h.last_height);
          if (a > 0) heights.add(a);
          if (b > 0) heights.add(b);
        }
        const tsRows = heights.size
          ? await q<{ height: string; ts: string | null }>(
              `SELECT height::text, timestamp_ms::text AS ts FROM packed.blocks WHERE height = ANY($1::bigint[])`,
              [[...heights]]
            )
          : [];
        const tsByH = new Map<number, number>();
        for (const r of tsRows ?? []) {
          const h = Number(r.height);
          const ts = Number(r.ts);
          if (h > 0 && ts > 0) tsByH.set(h, ts);
        }
        const tvl = pool.tvlErg > 0 ? pool.tvlErg : 0;
        const lps = (holders ?? []).map((h) => {
          const amt = asInt(h.amount);
          const share = circulating > 0n ? Number((amt * 10000n) / circulating) / 100 : null;
          const fh = Number(h.first_height);
          const lh = Number(h.last_height);
          return {
            address: h.address,
            amount: h.amount,
            share,
            tvlErg: share != null && tvl > 0 ? (share / 100) * tvl : null,
            txCount: h.tx_count != null ? Number(h.tx_count) : null,
            firstTs: fh > 0 ? tsByH.get(fh) ?? null : null,
            lastTs: lh > 0 ? tsByH.get(lh) ?? null : null,
          };
        });
        cacheTokens(res);
        res.json({
          ok: true,
          pool,
          view,
          lpTokenId: lp.token_id,
          lps,
          lpTotal: lps.length,
          offset,
          limit,
          source: "lumen-defi",
          at: Date.now(),
        });
        return;
      }
      const order =
        sortRaw === "amount"
          ? `token_amount ${dir} NULLS LAST, ts_ms DESC`
          : `height ${dir} NULLS LAST, ts_ms ${dir}`;
      const [events, counted] = await Promise.all([
        q<{
          tx_id: string;
          height: string | number;
          ts_ms: string | number;
          side: string;
          token_id: string;
          base_id: string | null;
          token_amount: string | number;
          base_amount: string | number;
          trader: string | null;
        }>(
          `
          SELECT tx_id, height, ts_ms, side, token_id, base_id, token_amount, base_amount, trader
          FROM defi.swaps
          WHERE pool_id = $1 AND event_kind IN ('swap', 'mint', 'redeem')
          ORDER BY ${order}
          LIMIT $2 OFFSET $3
          `,
          [poolId, limit, offset]
        ),
        q<{ c: string }>(
          `SELECT count(*)::text AS c FROM defi.swaps WHERE pool_id = $1 AND event_kind IN ('swap', 'mint', 'redeem')`,
          [poolId]
        ),
      ]);
      cacheTokens(res);
      res.json({
        ok: true,
        pool,
        view,
        tradesCount: counted?.[0] ? Number(counted[0].c) : null,
        offset,
        limit,
        events: (events ?? []).map((e) => ({
          txId: String(e.tx_id),
          height: Number(e.height) || null,
          time: Number(e.ts_ms) || null,
          side: String(e.side || ""),
          tokenId: String(e.token_id || ""),
          baseId: e.base_id ? String(e.base_id).toLowerCase() : null,
          tokenAmount: Number(e.token_amount) || 0,
          baseAmount: Number(e.base_amount) || 0,
          trader: e.trader || null,
        })),
        source: "lumen-defi",
        at: Date.now(),
      });
    },

    /**
     * Basis lockboxes. Two P2S scripts from basis-tracker. Not ChainCash.
     * Unspent boxes only. Tracker boxes are the NFT named in R6. No tracker HTTP API.
     */
    async basis(_req: Request, res: Response) {
      const rows = await q<{
        box_id: string;
        value_nano: string;
        creation_height: string | null;
        additional_registers: unknown;
        address: string;
      }>(
        `
        SELECT encode(b.box_id, 'hex') AS box_id,
               b.value_nano::text AS value_nano,
               b.creation_height::text AS creation_height,
               b.additional_registers,
               ad.address
          FROM packed.addr ad
          JOIN packed.boxes b ON b.addr_id = ad.id AND b.spent_tx_id IS NULL
         WHERE (ad.addr_md5 = md5($1) AND ad.address = $1)
            OR (ad.addr_md5 = md5($2) AND ad.address = $2)
         ORDER BY b.creation_height DESC NULLS LAST
        `,
        [BASIS_ERG_RESERVE_ADDRESS, BASIS_TOKEN_RESERVE_ADDRESS]
      );
      if (!rows) {
        res.status(503).json({ ok: false });
        return;
      }
      const tipRow = await q<{ tip: string | null }>(
        `SELECT value::text AS tip FROM indexer_state WHERE key = 'last_height' LIMIT 1`
      );
      const tipNum = Number(tipRow?.[0]?.tip);
      const tip = Number.isFinite(tipNum) ? tipNum : null;
      const ids = rows.map((r) => r.box_id);
      const assets = ids.length
        ? await q<{ box_id: string; token_id: string; amount: string }>(
            `
            SELECT encode(box_id, 'hex') AS box_id,
                   encode(token_id, 'hex') AS token_id,
                   amount::text AS amount
              FROM packed.box_assets
             WHERE box_id = ANY($1::bytea[])
            `,
            [ids.map((id) => Buffer.from(id, "hex"))]
          )
        : [];
      const byBox = new Map<string, { tokenId: string; amount: string }[]>();
      for (const a of assets ?? []) {
        const list = byBox.get(a.box_id) ?? [];
        list.push({ tokenId: a.token_id, amount: a.amount });
        byBox.set(a.box_id, list);
      }
      const parsed = rows.map((r) => {
        const regs =
          r.additional_registers && typeof r.additional_registers === "object"
            ? (r.additional_registers as Record<string, unknown>)
            : {};
        const ownerInfo = decodeSigmaConstant(registerHex(regs.R4));
        const trackerInfo = decodeSigmaConstant(registerHex(regs.R6));
        const owner =
          ownerInfo?.sigmaType === "SGroupElement" ? ownerInfo.renderedValue.toLowerCase() : null;
        const trackerRaw = trackerInfo?.renderedValue?.toLowerCase() ?? "";
        const trackerNft =
          trackerInfo?.sigmaType === "Coll[SByte]" && /^[0-9a-f]{64}$/.test(trackerRaw)
            ? trackerRaw
            : null;
        const refund = longFromRegister(regs.R7);
        const refundHeight = refund != null && refund > 0n ? refund.toString() : null;
        const held = byBox.get(r.box_id) ?? [];
        const collateral =
          held
            .filter((a) => a.amount !== "1")
            .sort((a, b) => {
              try {
                const x = BigInt(a.amount.split(".")[0] || "0");
                const y = BigInt(b.amount.split(".")[0] || "0");
                if (x === y) return 0;
                return x > y ? -1 : 1;
              } catch {
                return 0;
              }
            })[0] ?? null;
        return {
          boxId: r.box_id,
          kind: r.address === BASIS_ERG_RESERVE_ADDRESS ? ("erg" as const) : ("token" as const),
          nano: r.value_nano || "0",
          height: r.creation_height != null ? Number(r.creation_height) : null,
          owner,
          trackerNft,
          refundHeight,
          collateral,
        };
      });
      const trackerIds = [...new Set(parsed.map((p) => p.trackerNft).filter((id): id is string => Boolean(id)))];
      const trackerRows = trackerIds.length
        ? await q<{ nft: string; box_id: string; creation_height: string | null; live: boolean }>(
            `
            SELECT encode(a.token_id, 'hex') AS nft,
                   encode(b.box_id, 'hex') AS box_id,
                   b.creation_height::text AS creation_height,
                   (b.spent_tx_id IS NULL) AS live
              FROM packed.box_assets a
              JOIN packed.boxes b ON b.box_id = a.box_id
             WHERE a.amount = 1
               AND a.token_id = ANY($1::bytea[])
             ORDER BY (b.spent_tx_id IS NULL) DESC, b.creation_height DESC NULLS LAST
            `,
            [trackerIds.map((id) => Buffer.from(id, "hex"))]
          )
        : [];
      const trackerByNft = new Map<string, { boxId: string; height: number | null }>();
      for (const t of trackerRows ?? []) {
        if (trackerByNft.has(t.nft)) continue;
        const h = t.creation_height != null ? Number(t.creation_height) : null;
        trackerByNft.set(t.nft, {
          boxId: t.box_id,
          height: t.live && Number.isFinite(h as number) ? h : null,
        });
      }
      const tokenIds = [
        ...new Set(parsed.map((p) => p.collateral?.tokenId).filter((id): id is string => Boolean(id))),
      ];
      const names = tokenIds.length
        ? await q<{ token_id: string; name: string | null; decimals: string | null }>(
            `
            SELECT token_id, name, decimals::text AS decimals
              FROM tokens
             WHERE token_id = ANY($1::text[])
            `,
            [tokenIds]
          )
        : [];
      const meta = new Map((names ?? []).map((n) => [n.token_id, n]));
      const heights = [
        ...new Set(
          parsed
            .map((p) => p.height)
            .filter((h): h is number => h != null && Number.isFinite(h))
        ),
      ];
      const stamps = heights.length
        ? await q<{ height: string; ts: string }>(
            `SELECT height::text AS height, timestamp_ms::text AS ts
               FROM packed.blocks
              WHERE height = ANY($1::bigint[])`,
            [heights]
          )
        : [];
      const createdAtByHeight = new Map<number, number>();
      for (const row of stamps ?? []) {
        const h = Number(row.height);
        const ts = Number(row.ts);
        if (Number.isFinite(h) && Number.isFinite(ts)) createdAtByHeight.set(h, ts);
      }
      const makers = ids.length
        ? await q<{ reserve_id: string; address: string; nano: string }>(
            `
            SELECT encode(out.box_id, 'hex') AS reserve_id,
                   ad.address,
                   src.value_nano::text AS nano
              FROM packed.boxes out
              -- The boxes this tx spent. spent_tx_id is indexed; tx_inputs is not.
              JOIN packed.boxes src ON src.spent_tx_id = out.creation_tx_id
              JOIN packed.addr ad ON ad.id = src.addr_id
             WHERE out.box_id = ANY($1::bytea[])
            `,
            [ids.map((id) => Buffer.from(id, "hex"))]
          )
        : [];
      const creatorByBox = new Map<string, string>();
      const creatorScore = new Map<string, bigint>();
      for (const row of makers ?? []) {
        if (!row.address || isBasisReserveAddress(row.address)) continue;
        const nano = BigInt(row.nano?.split(".")[0] || "0");
        const prev = creatorScore.get(row.reserve_id);
        const p2pk = row.address.startsWith("9");
        const prevAddr = creatorByBox.get(row.reserve_id);
        const prevP2pk = prevAddr?.startsWith("9") ?? false;
        if (prev == null || (p2pk && !prevP2pk) || (p2pk === prevP2pk && nano > prev)) {
          creatorByBox.set(row.reserve_id, row.address);
          creatorScore.set(row.reserve_id, nano);
        }
      }
      const prices = tokenIds.length
        ? await q<{ token_id: string; price_erg: number }>(
            `
            SELECT DISTINCT ON (r.quote_token)
                   r.quote_token AS token_id,
                   ps.price_erg::float8 AS price_erg
              FROM defi.pool_registry r
              JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
             WHERE r.quote_token = ANY($1::text[])
               AND r.base_token = repeat('0', 64)
               AND coalesce(ps.price_erg, 0) > 0
               AND coalesce(ps.tvl_erg, 0) >= 0.05
             ORDER BY r.quote_token, coalesce(ps.tvl_erg, 0) DESC
            `,
            [tokenIds]
          )
        : [];
      const priceByToken = new Map(
        (prices ?? [])
          .filter((row) => row.price_erg > 0)
          .map((row) => [row.token_id, row.price_erg])
      );
      let ergLocked = 0n;
      for (const p of parsed) {
        if (p.kind === "erg") ergLocked += BigInt(p.nano.split(".")[0] || "0");
      }
      const reserves = parsed.map((p) => {
        const tracker = p.trackerNft ? trackerByNft.get(p.trackerNft) : undefined;
        const state = basisReserveStatus({
          tip,
          refundHeight: p.refundHeight,
          trackerHeight: tracker?.height ?? null,
        });
        const token = p.collateral ? meta.get(p.collateral.tokenId) : undefined;
        const decimals = token?.decimals != null ? Number(token.decimals) : 0;
        const safeDecimals = Number.isFinite(decimals) ? decimals : 0;
        let ergValueNano: string | null = null;
        if (p.kind === "erg") {
          ergValueNano = p.nano.split(".")[0] || "0";
        } else if (p.collateral) {
          const price = priceByToken.get(p.collateral.tokenId);
          if (price != null && price > 0) {
            const raw = BigInt(p.collateral.amount.split(".")[0] || "0");
            const priceNano = BigInt(Math.round(price * 1e9));
            const scale = 10n ** BigInt(Math.min(18, Math.max(0, safeDecimals)));
            ergValueNano = ((raw * priceNano) / scale).toString();
          }
        }
        return {
          boxId: p.boxId,
          kind: p.kind,
          nano: p.nano,
          height: p.height,
          createdAt: p.height != null ? createdAtByHeight.get(p.height) ?? null : null,
          owner: p.owner,
          creator: creatorByBox.get(p.boxId) ?? null,
          ergValueNano,
          trackerNft: p.trackerNft,
          trackerBoxId: tracker?.boxId ?? null,
          trackerHeight: tracker?.height ?? null,
          refundHeight: p.refundHeight,
          status: state.status,
          blocksLeft: state.blocksLeft,
          collateral: p.collateral
            ? {
                tokenId: p.collateral.tokenId,
                amount: p.collateral.amount,
                decimals: safeDecimals,
                name: token?.name || null,
              }
            : null,
        };
      });
      cacheTokens(res);
      res.json({
        ok: true,
        protocol: "basis",
        tipHeight: tip,
        reserveCount: reserves.length,
        ergLockedNano: ergLocked.toString(),
        totalErgNano: reserves
          .reduce((sum, row) => sum + BigInt(row.ergValueNano ?? "0"), 0n)
          .toString(),
        unpricedCount: reserves.filter((row) => row.kind === "token" && row.ergValueNano == null)
          .length,
        tokenReserveCount: reserves.filter((r) => r.kind === "token").length,
        trackerCount: [...trackerByNft.values()].filter((t) => t.height != null).length,
        reserves,
        source: "index",
        at: Date.now(),
      });
    },
  };

  // primary + aliases (Caddy may strip /api)
  for (const base of ["/v1/defi", "/api/v1/defi"]) {
    app.get(`${base}/trades`, (req, res) => void handlers.trades(req, res));
    app.get(`${base}/volume-history`, (req, res) =>
      void handlers.volumeHistory(req, res)
    );
    app.get(`${base}/pools`, (req, res) => void handlers.pools(req, res));
    app.get(`${base}/ranks`, (req, res) => void handlers.ranks(req, res));
    app.get(`${base}/health`, (req, res) => void handlers.health(req, res));
    app.get(`${base}/price-history`, (req, res) =>
      void handlers.priceHistory(req, res)
    );
    app.get(`${base}/pool-history`, (req, res) =>
      void handlers.poolHistory(req, res)
    );
    app.get(`${base}/ohlc`, (req, res) => void handlers.ohlc(req, res));
    app.get(`${base}/ageusd`, (req, res) => void handlers.ageusd(req, res));
    app.get(`${base}/basis`, (req, res) => void handlers.basis(req, res));
    app.get(`${base}/lithos`, (req, res) => void handlers.lithos(req, res));
    app.get(`${base}/spectrum`, (req, res) => void handlers.spectrum(req, res));
    app.get(`${base}/pool-board`, (req, res) => void handlers.poolBoard(req, res));
    app.get(`${base}/pool/:id`, (req, res) => void handlers.poolCard(req, res));
  }
}
