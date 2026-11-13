/**
 * Lithos protocol page. First pack is snapshot_kv.lithos_protocol.
 * Older pages are a height keyset on packed.lithos_find. No chain COUNT.
 * `stats` (header figures) come from the same snapshot row; `client` is the GitHub release
 * held in RAM (lithosClient.ts). Both are additive: older clients ignore them.
 */
import { parseLithosStats, type LithosProtocolStats } from "@ergoscan/shared";
import { getIndexPool } from "./indexDb.js";
import { lithosClientRelease, type LithosClientRelease } from "./lithosClient.js";
import { readSnapshot } from "./snapshots.js";

const PAGE = 25;

export type LithosFindItem = {
  height: number;
  blockId: string;
  txId: string;
  ts: number | null;
  finderAddress: string;
  finderLit: string;
  finderNano: string;
  lenderAddress: string;
  permitLit: string;
  holdingAddress: string;
  holdingLit: string;
  teamLit: string;
  investorLit: string;
  auditorLit: string;
};

export type LithosProtocolPage = {
  finds: number;
  finders: number;
  finderLit: string;
  holdingLit: string;
  teamLit: string;
  investorLit: string;
  auditorLit: string;
  items: LithosFindItem[];
  hasMore: boolean;
  nextCursor: string | null;
  updatedAt: string | null;
  source: "snapshot" | "tables";
  /** Header figures; null on older pages and before the indexer writes them. */
  stats: LithosProtocolStats | null;
  /** Lithos client release (external: GitHub), null when unknown. */
  client: LithosClientRelease | null;
};

type Snap = Omit<LithosProtocolPage, "updatedAt" | "source" | "stats" | "client"> & { stats?: unknown };

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function digits(v: unknown): string {
  const s = String(v ?? "0").split(".")[0] ?? "0";
  return /^\d+$/.test(s) ? s : "0";
}

function parseItem(raw: unknown): LithosFindItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const height = n(r.height);
  const blockId = typeof r.blockId === "string" ? r.blockId : "";
  const txId = typeof r.txId === "string" ? r.txId : "";
  if (!height || !blockId || !txId) return null;
  return {
    height,
    blockId,
    txId,
    ts: r.ts == null ? null : n(r.ts),
    finderAddress: String(r.finderAddress ?? ""),
    finderLit: digits(r.finderLit),
    finderNano: digits(r.finderNano),
    lenderAddress: String(r.lenderAddress ?? ""),
    permitLit: digits(r.permitLit),
    holdingAddress: String(r.holdingAddress ?? ""),
    holdingLit: digits(r.holdingLit),
    teamLit: digits(r.teamLit),
    investorLit: digits(r.investorLit),
    auditorLit: digits(r.auditorLit),
  };
}

function parseSnap(payload: Snap | null | undefined): Snap | null {
  if (!payload || !Array.isArray(payload.items)) return null;
  const items = payload.items.map(parseItem).filter((row): row is LithosFindItem => row != null);
  return {
    finds: n(payload.finds),
    finders: n(payload.finders),
    finderLit: digits(payload.finderLit),
    holdingLit: digits(payload.holdingLit),
    teamLit: digits(payload.teamLit),
    investorLit: digits(payload.investorLit),
    auditorLit: digits(payload.auditorLit),
    items,
    hasMore: payload.hasMore === true,
    nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null,
  };
}

async function pageFromTable(before: number | null): Promise<LithosFindItem[] | null> {
  const pool = getIndexPool();
  if (!pool) return null;
  try {
    const params: unknown[] = [PAGE + 1];
    const where = before != null ? "WHERE f.height < $2" : "";
    if (before != null) params.push(before);
    const rows = await pool.query(
      `SELECT f.height::text AS height,
              encode(f.block_id, 'hex') AS "blockId",
              encode(f.tx_id, 'hex') AS "txId",
              b.timestamp_ms::text AS ts,
              f.finder_address AS "finderAddress",
              f.finder_lit::text AS "finderLit",
              f.finder_nano::text AS "finderNano",
              f.lender_address AS "lenderAddress",
              f.permit_lit::text AS "permitLit",
              f.holding_address AS "holdingAddress",
              f.holding_lit::text AS "holdingLit",
              f.team_lit::text AS "teamLit",
              f.investor_lit::text AS "investorLit",
              f.auditor_lit::text AS "auditorLit"
         FROM packed.lithos_find f
         LEFT JOIN packed.blocks b ON b.height = f.height
         ${where}
        ORDER BY f.height DESC
        LIMIT $1`,
      params
    );
    return rows.rows.map(parseItem).filter((row): row is LithosFindItem => row != null);
  } catch {
    return null;
  }
}

export function parseLithosCursor(raw: unknown): number | null {
  const s = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim();
  if (!/^\d{1,12}$/.test(s)) return null;
  return Number(s);
}

export async function getLithosProtocolPage(cursor: number | null): Promise<LithosProtocolPage | null> {
  if (cursor != null) {
    const rows = await pageFromTable(cursor);
    if (!rows) return null;
    const hasMore = rows.length > PAGE;
    const items = hasMore ? rows.slice(0, PAGE) : rows;
    const last = items[items.length - 1];
    return {
      finds: 0,
      finders: 0,
      finderLit: "0",
      holdingLit: "0",
      teamLit: "0",
      investorLit: "0",
      auditorLit: "0",
      items,
      hasMore,
      nextCursor: hasMore && last ? String(last.height) : null,
      updatedAt: null,
      source: "tables",
      stats: null,
      client: null,
    };
  }
  const snap = await readSnapshot<Snap>("lithos_protocol");
  const parsed = parseSnap(snap?.payload);
  if (parsed) {
    return {
      ...parsed,
      updatedAt: snap?.updatedAt ?? null,
      source: "snapshot",
      stats: parseLithosStats(snap?.payload?.stats),
      client: lithosClientRelease(),
    };
  }
  const rows = await pageFromTable(null);
  if (!rows) return null;
  const hasMore = rows.length > PAGE;
  const items = hasMore ? rows.slice(0, PAGE) : rows;
  const last = items[items.length - 1];
  return {
    finds: items.length,
    finders: new Set(items.map((row) => row.finderAddress)).size,
    finderLit: "0",
    holdingLit: "0",
    teamLit: "0",
    investorLit: "0",
    auditorLit: "0",
    items,
    hasMore,
    nextCursor: hasMore && last ? String(last.height) : null,
    updatedAt: null,
    source: "tables",
    stats: null,
    client: lithosClientRelease(),
  };
}
