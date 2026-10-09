/**
 * Read list snapshots (indexer-written). Fallback: SELECT from chain tables.
 * Never call the Ergo node.
 */
import { fillAddressActivityTxs, getIndexPool, listAddressSummaries, parseAddressSort, parseAddressSortDir, refreshSpectrumPoolNfts, cachedDexLockHints, type AddressListItem, type AddressSort, type AddressSortDir, type IndexerStatus } from "./indexDb.js";
import {
  isHex64,
  PACKED_BLOCK_BY_HEIGHT_SQL,
  PACKED_BLOCK_BY_ID_SQL,
  PACKED_BLOCK_ID_SQL,
  PACKED_TXS_AT_HEIGHT_SQL,
  packedReadEnabled,
} from "./packedRead.js";
import { publicIndexerStatus } from "./public-health.js";
import { normalizeAddressFilter, parseAddressBandList, parseAddressKindList, type AddressBand, type AddressKind } from "./addressListFilter.js";
import {
  RENT_BLOCKS_24H,
  RENT_BLOCKS_7D,
  RENT_BLOCKS_30D,
  RENT_PACK,
  rentBoxesFromIndex,
  rentHistoryDailyFromIndex,
  rentHistoryHourlyFromIndex,
  rentKpisFromIndex,
  rentMinerWindowsFromIndex,
  rentMinersAllFromIndex,
  rentRecentClaims,
  type RentBoxRow,
  type RentClaimRow,
  type RentKpis,
  type RentMinersPack,
  type RentPage,
  type RentTab,
  type RentWindow,
} from "./rentIndex.js";
import { classifyTxShape, pickTxAction, txTapeFields, rentTapePaint, MINERS_FEE_ADDRESS, MINERS_FEE_TREE, fillRentWeekGaps, parseRentSeries, parseRentTape, parseRentEpochBoxes, parseRentEpochNano, pickTxLock, LITHOS_COLLAT_ADDRESS, LITHOS_COLLAT_TOKEN_ID, LITHOS_MINED_HEIGHTS_SQL, type RentTapeCategory, type RentTapeRow, type ShapeBox } from "@ergoscan/shared";
import { blockHeaderFromRow, type BlockHeaderView } from "./blockHeader.js";

export const SNAP_BLOCKS = "blocks_latest";
export const SNAP_TXS = "txs_recent";
export const SNAP_STATUS = "indexer_status";
export const SNAP_HOME = "home";
export const SNAP_MARKET = "market";
export const SNAP_ADDRESSES = "addresses_top";
export const SNAP_HOLDER_BANDS = "holder_bands";
export const SNAP_RENT = "rent";
export const SNAP_RENT_HISTORY = "rent_history";
export const SNAP_RENT_MINERS = "rent_miners";


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
  /** Output sum minus coinbase (emission-box recycle). Additive. */
  userValueNano?: string;
  /** True when this block was mined with Lithos. Additive. */
  lithos?: boolean;
};

export type { AddressListItem };

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
  /** Template action. Absent when the script is not in the dictionary. */
  action?: string | null;
  inputs: number;
  outputs: number;
  value: number;
  confirmed: boolean;
  /** Distinct tokens on boxes created or spent by this tx. Additive. */
  tokenCount?: number;
};

export type SnapshotMeta = {
  height: number | null;
  updatedAt: string | null;
};

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

async function q<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[] | null> {
  const p = getIndexPool();
  if (!p) return null;
  try {
    const r = await p.query<T>(sql, params);
    return r.rows;
  } catch {
    return null;
  }
}

export async function readSnapshot<T>(
  key: string
): Promise<(SnapshotMeta & { payload: T }) | null> {
  const rows = await q<{
    payload: T;
    height: string | number | null;
    updated_at: Date | string | null;
  }>(
    `SELECT payload, height, updated_at FROM snapshot_kv WHERE key = $1`,
    [key]
  );
  const row = rows?.[0];
  if (!row) return null;
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at
        ? String(row.updated_at)
        : null;
  return {
    payload: row.payload,
    height: nNull(row.height),
    updatedAt,
  };
}

function nanoDigits(raw: unknown): string {
  const s = String(raw ?? "0").trim();
  return /^\d+$/.test(s) ? s : "0";
}

function nanoMinus(total: string, sub: string): string {
  try {
    const a = BigInt(nanoDigits(total));
    const b = BigInt(nanoDigits(sub));
    return (a > b ? a - b : 0n).toString();
  } catch {
    return nanoDigits(total);
  }
}

/** User output = block sum minus coinbase (emission leftover recycle). */
async function attachUserValueNano(items: BlockListItem[]): Promise<BlockListItem[]> {
  const heights = [...new Set(items.map((b) => b.height).filter((h) => Number.isFinite(h) && h > 0))];
  if (!heights.length) return items;
  const rows = await q<{ height: unknown; v: unknown }>(
    packedReadEnabled()
      ? `SELECT height, COALESCE(value_nano, 0)::text AS v
           FROM packed.transactions
          WHERE index_in_block = 0 AND height = ANY($1::bigint[])`
      : `SELECT height, COALESCE(value_nano, 0)::text AS v
     FROM transactions
     WHERE index_in_block = 0 AND height = ANY($1::bigint[])`,
    [heights]
  );
  if (!rows?.length) return items;
  const coin = new Map<number, string>();
  for (const r of rows) coin.set(n(r.height), nanoDigits(r.v));
  return items.map((b) => {
    const cb = coin.get(b.height);
    if (cb == null) return b;
    return { ...b, userValueNano: nanoMinus(b.valueNano, cb) };
  });
}

function mapBlock(r: {
  id: string;
  height: unknown;
  timestamp: unknown;
  size: unknown;
  txCount?: unknown;
  tx_count?: unknown;
  parentId?: string | null;
  parent_id?: string | null;
  minerAddress?: string | null;
  miner_address?: string | null;
  minerName?: string | null;
  feeNano?: unknown;
  fee_nano?: unknown;
  valueNano?: unknown;
  value_nano?: unknown;
}): BlockListItem {
  const minerAddress = r.minerAddress ?? r.miner_address ?? null;
  const named = r.minerName && r.minerName.length ? r.minerName : null;
  return {
    id: r.id,
    height: n(r.height),
    timestamp: n(r.timestamp),
    size: n(r.size),
    txCount: nNull(r.txCount ?? r.tx_count),
    parentId: r.parentId ?? r.parent_id ?? null,
    minerAddress: minerAddress && minerAddress.length ? minerAddress : null,
    minerName: named,
    feeNano: nanoDigits(r.feeNano ?? r.fee_nano),
    valueNano: nanoDigits(r.valueNano ?? r.value_nano),
  };
}

function mapTx(r: {
  id: string;
  index_in_block?: unknown;
  height?: unknown;
  timestamp_ms?: unknown;
  size?: unknown;
  fee?: unknown;
  input_count?: unknown;
  output_count?: unknown;
  value_nano?: unknown;
  shape?: string | null;
  protocol?: string | null;
}): TxListItem {
  const size = n(r.size);
  const fee = n(r.fee);
  const shape = r.shape && String(r.shape).length ? String(r.shape) : null;
  const protocol = r.protocol && String(r.protocol).length ? String(r.protocol) : null;
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

const TAPE_CAP = 50;
const TX_TAPE_COLS = `id, index_in_block, height, timestamp_ms, size, fee,
            input_count, output_count, value_nano, shape, protocol`;
const BLOCK_TAPE_SQL = `SELECT id, height, timestamp_ms AS timestamp, COALESCE(size, 0) AS size,
            tx_count AS "txCount", parent_id AS "parentId",
            miner_address AS "minerAddress",
            COALESCE(fee_nano, 0)::text AS "feeNano",
            COALESCE(value_nano, 0)::text AS "valueNano"
     FROM blocks`;

/** True when the blocks_latest payload already carries the mined-block flag. */
function blocksSnapshotHasLithos(items: BlockListItem[]): boolean {
  return items.length > 0 && items.every((item) => typeof item.lithos === "boolean");
}

/** Heights in this pack mined with Lithos. One lookup for a page that is not the snapshot. */
async function lithosHeights(heights: number[]): Promise<Set<number>> {
  if (!packedReadEnabled()) return new Set();
  const unique = [...new Set(heights.filter((h) => Number.isInteger(h) && h >= 0))];
  if (!unique.length) return new Set();
  const rows = await q<{ height: string }>(LITHOS_MINED_HEIGHTS_SQL, [
    unique,
    LITHOS_COLLAT_TOKEN_ID,
    LITHOS_COLLAT_ADDRESS,
  ]);
  const hit = new Set<number>();
  for (const row of rows ?? []) {
    const h = Number(row.height);
    if (Number.isInteger(h)) hit.add(h);
  }
  return hit;
}

/** Snapshot pages already have the flag. Cursor pages and the block card look it up. */
async function paintLithos(items: BlockListItem[]): Promise<BlockListItem[]> {
  if (blocksSnapshotHasLithos(items)) return items;
  return markLithos(items, await lithosHeights(items.map((item) => item.height)));
}

function markLithos(items: BlockListItem[], hit: Set<number>): BlockListItem[] {
  if (!hit.size) return items;
  return items.map((item) => (hit.has(item.height) ? { ...item, lithos: true } : item));
}

function tapeTake(limit: number): number {
  return Math.max(1, Math.min(TAPE_CAP, Math.floor(Number(limit) || 25)));
}

export function parseBlockHeightCursor(raw: unknown): number | null {
  const s = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim();
  if (!s) return null;
  const head = s.includes(":") ? s.slice(0, s.indexOf(":")) : s;
  if (!/^\d{1,12}$/.test(head)) return null;
  return Number(head);
}

export type TxTapeCursor = { height: number; index: number; id: string };

export function encodeTxTapeCursor(
  height: number | null | undefined,
  index: number | null | undefined,
  id: string
): string {
  return `${height ?? -1}:${index ?? -1}:${id}`;
}

export function parseTxTapeCursor(raw: unknown): TxTapeCursor | null {
  const s = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim();
  const i = s.indexOf(":");
  const j = i >= 0 ? s.indexOf(":", i + 1) : -1;
  if (i < 1 || j < i + 1) return null;
  const height = Number(s.slice(0, i));
  const index = Number(s.slice(i + 1, j));
  const id = s.slice(j + 1);
  if (!id || !Number.isFinite(height) || !Number.isFinite(index)) return null;
  return { height, index, id };
}

type BlockRowSql = {
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

async function selectBlocksPage(
  fetchN: number,
  beforeHeight: number | null,
  paintUserValue = true
): Promise<BlockListItem[] | null> {
  const n = Math.max(1, Math.min(TAPE_CAP + 1, fetchN));
  const tape = packedReadEnabled()
    ? `SELECT encode(id, 'hex') AS id, height, timestamp_ms AS timestamp, COALESCE(size, 0) AS size,
            tx_count AS "txCount", encode(parent_id, 'hex') AS "parentId",
            miner_address AS "minerAddress",
            COALESCE(fee_nano, 0)::text AS "feeNano",
            COALESCE(value_nano, 0)::text AS "valueNano"
     FROM packed.blocks`
    : BLOCK_TAPE_SQL;
  const rows =
    beforeHeight != null
      ? await q<BlockRowSql>(
          `${tape}
     WHERE height < $1
     ORDER BY height DESC
     LIMIT $2`,
          [beforeHeight, n]
        )
      : await q<BlockRowSql>(
          `${tape}
     ORDER BY height DESC
     LIMIT $1`,
          [n]
        );
  if (!rows) return null;
  const items = rows.map(mapBlock);
  const valued = paintUserValue ? await attachUserValueNano(items) : items;
  return paintLithos(valued);
}

export async function selectBlocks(limit: number, paintUserValue = true): Promise<BlockListItem[] | null> {
  return selectBlocksPage(limit, null, paintUserValue);
}

type TxRowSql = {
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
};

async function selectRecentTxsPage(
  fetchN: number,
  cursor: TxTapeCursor | null
): Promise<TxListItem[] | null> {
  const n = Math.max(1, Math.min(TAPE_CAP + 1, fetchN));
  const packed = packedReadEnabled();
  const cols = packed
    ? `encode(id, 'hex') AS id, index_in_block, height, timestamp_ms, size, fee,
            input_count, output_count, value_nano, shape, protocol`
    : TX_TAPE_COLS;
  const from = packed ? "packed.transactions" : "transactions";
  const usable = cursor && (!packed || isHex64(cursor.id)) ? cursor : null;
  const idCmp = packed ? "id < decode(lower($3), 'hex')" : "id < $3";
  const rows = usable
    ? await q<TxRowSql>(
        `SELECT ${cols}
     FROM ${from}
     WHERE height IS NOT NULL
       AND (
         height < $1
         OR (height = $1 AND COALESCE(index_in_block, -1) < $2)
         OR (height = $1 AND COALESCE(index_in_block, -1) = $2 AND ${idCmp})
       )
     ORDER BY height DESC, COALESCE(index_in_block, -1) DESC, id DESC
     LIMIT $4`,
        [usable.height, usable.index, usable.id, n]
      )
    : await q<TxRowSql>(
        `SELECT ${cols}
     FROM ${from}
     WHERE height IS NOT NULL
     ORDER BY height DESC, COALESCE(index_in_block, -1) DESC, id DESC
     LIMIT $1`,
        [n]
      );
  if (!rows) return null;
  return finishTxTape(rows.map(mapTx));
}

export async function selectRecentTxs(limit: number): Promise<TxListItem[] | null> {
  return selectRecentTxsPage(limit, null);
}

async function attachMinerFees(items: TxListItem[]): Promise<TxListItem[]> {
  if (!items.length) return items;
  const packed = packedReadEnabled();
  const rows = await q<{ tx_id: string; fee: string }>(
    packed
      ? `SELECT encode(b.creation_tx_id, 'hex') AS tx_id,
                COALESCE(SUM(b.value_nano), 0)::text AS fee
           FROM packed.boxes b
           LEFT JOIN packed.addr a ON a.id = b.addr_id
           LEFT JOIN packed.script s ON s.id = b.script_id
          WHERE b.creation_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
            AND (a.address = $2 OR lower(s.ergo_tree) = lower($3))
          GROUP BY b.creation_tx_id`
      : `SELECT b.creation_tx_id AS tx_id, COALESCE(SUM(b.value_nano), 0)::text AS fee
     FROM boxes b
     WHERE b.creation_tx_id = ANY($1::text[])
       AND (
         b.address = $2
         OR lower(b.ergo_tree) = lower($3)
       )
     GROUP BY b.creation_tx_id`,
    [items.map((t) => t.id), MINERS_FEE_ADDRESS, MINERS_FEE_TREE]
  );
  if (!rows?.length) return items;
  const m = new Map<string, number>();
  for (const r of rows) {
    const fee = Number(r.fee);
    if (Number.isFinite(fee) && fee > 0) m.set(r.tx_id, fee);
  }
  if (!m.size) return items;
  return items.map((t) => {
    const fee = m.get(t.id);
    if (fee == null) return t;
    return { ...t, fee, feeRate: t.size > 0 ? fee / t.size : 0 };
  });
}

async function attachTokenCounts(items: TxListItem[]): Promise<TxListItem[]> {
  const tokenCounts = await tokenCountsForTxIds(items.map((t) => t.id));
  if (!tokenCounts) return items;
  return items.map((t) => ({ ...t, tokenCount: tokenCounts.get(t.id) ?? t.tokenCount ?? 0 }));
}

/** Overlay on the pack: named lock family. PG `shape` is unchanged. */
async function attachTxLocks(items: TxListItem[]): Promise<TxListItem[]> {
  if (!items.length) return items;
  try {
    await refreshSpectrumPoolNfts();
    const ids = items.map((t) => t.id);
    const boxes = await q<{
      box_id: string;
      creation_tx_id: string | null;
      spent_tx_id: string | null;
      address: string | null;
      ergo_tree: string | null;
      template_hash: string | null;
    }>(
      packedReadEnabled()
        ? `SELECT encode(b.box_id, 'hex') AS box_id,
                  encode(b.creation_tx_id, 'hex') AS creation_tx_id,
                  encode(b.spent_tx_id, 'hex') AS spent_tx_id,
                  ad.address, sc.ergo_tree,
                  CASE WHEN octet_length(sc.template_hash) = 32
                       THEN encode(sc.template_hash, 'hex')
                       ELSE NULL END AS template_hash
             FROM (
               SELECT * FROM packed.boxes
                WHERE creation_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
               UNION
               SELECT * FROM packed.boxes
                WHERE spent_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
             ) b
             LEFT JOIN packed.addr ad ON ad.id = b.addr_id
             LEFT JOIN packed.script sc ON sc.id = b.script_id`
        : `SELECT box_id, creation_tx_id, spent_tx_id, address, ergo_tree,
                  NULL::text AS template_hash
       FROM boxes
       WHERE creation_tx_id = ANY($1::text[])
          OR spent_tx_id = ANY($1::text[])`,
      [ids]
    );
    if (!boxes) return items;

    const assetRows = boxes.length
      ? await q<{ box_id: string; token_id: string; amount: string }>(
          packedReadEnabled()
            ? `SELECT encode(box_id, 'hex') AS box_id,
                      encode(token_id, 'hex') AS token_id,
                      amount::text AS amount
                 FROM packed.box_assets
                WHERE box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`
            : `SELECT box_id, token_id, amount::text AS amount
           FROM box_assets WHERE box_id = ANY($1::text[])`,
          [boxes.map((b) => b.box_id)]
        )
      : [];
    const assetsByBox = new Map<string, { tokenId: string; amount: string }[]>();
    for (const r of assetRows ?? []) {
      const list = assetsByBox.get(r.box_id) ?? [];
      list.push({ tokenId: r.token_id, amount: r.amount });
      assetsByBox.set(r.box_id, list);
    }

    const byTx = new Map<string, { inputs: ShapeBox[]; outputs: ShapeBox[] }>();
    for (const id of ids) byTx.set(id, { inputs: [], outputs: [] });
    for (const b of boxes) {
      const shape: ShapeBox = {
        address: b.address,
        ergoTree: b.ergo_tree,
        templateHash: b.template_hash,
        assets: assetsByBox.get(b.box_id),
      };
      if (b.spent_tx_id) byTx.get(b.spent_tx_id)?.inputs.push(shape);
      if (b.creation_tx_id) byTx.get(b.creation_tx_id)?.outputs.push(shape);
    }

    const hints = cachedDexLockHints();
    return items.map((t) => {
      const io = byTx.get(t.id);
      if (!io || (!io.inputs.length && !io.outputs.length)) return t;
      const shaped = classifyTxShape({
        coinbase: t.index === 0,
        inputs: io.inputs,
        outputs: io.outputs,
      });
      const paint = txTapeFields(shaped.shape, shaped.protocol);
      const lock = pickTxLock(io, hints);
      const action = pickTxAction(io, shaped.shape);
      return {
        ...t,
        category: paint.category,
        color: paint.color,
        platform: lock?.id ?? paint.platform,
        action,
      };
    });
  } catch {
    return items;
  }
}

/** Stale SNAP_TXS may still have protocol as category. Repaint from index columns. */
async function attachTapeShape(items: TxListItem[]): Promise<TxListItem[]> {
  if (!items.length) return items;
  try {
    const rows = await q<{ id: string; shape: string | null; protocol: string | null }>(
      `SELECT encode(id, 'hex') AS id, shape, protocol
         FROM packed.transactions
        WHERE id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
      [items.map((t) => t.id)]
    );
    if (!rows?.length) return items;
    const by = new Map(rows.map((r) => [r.id, r]));
    return items.map((t) => {
      const r = by.get(t.id);
      if (!r) return t;
      const paint = txTapeFields(r.shape, r.protocol);
      return { ...t, category: paint.category, color: paint.color, platform: paint.platform };
    });
  } catch {
    return items;
  }
}

function pgBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

export type RentTapeMark = { category: RentTapeCategory; color: string };

/**
 * Protocol rows whose spend height sits in this page's window.
 * Uses rent_collected_spent_height_idx. Not a scan of the whole table.
 * A collector wins over a renewal when one tx holds both.
 */
export async function rentTapeMarks(
  ids: string[],
  minHeight: number,
  maxHeight: number
): Promise<Map<string, RentTapeMark>> {
  const out = new Map<string, RentTapeMark>();
  const clean = ids.filter((id) => isHex64(id));
  if (!clean.length || !Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) return out;
  const rows = await q<{ spent_tx_id: string; took: unknown; renewed: unknown }>(
    `SELECT spent_tx_id,
            bool_or(collector IS NOT NULL AND collector <> '') AS took,
            bool_or(collector IS NULL OR collector = '') AS renewed
       FROM rent_collected
      WHERE kind = 'protocol'
        AND spent_height >= $1
        AND spent_height <= $2
        AND spent_tx_id = ANY($3::text[])
      GROUP BY spent_tx_id`,
    [Math.trunc(minHeight), Math.trunc(maxHeight), clean]
  );
  for (const row of rows ?? []) {
    const paint = rentTapePaint(pgBool(row.took), pgBool(row.renewed));
    if (paint) out.set(row.spent_tx_id, paint);
  }
  return out;
}

/** Replace the shape chip when the rent writer has a protocol row for the tx. */
async function attachRentMarks(items: TxListItem[]): Promise<TxListItem[]> {
  if (!items.length) return items;
  const ids: string[] = [];
  let minH = Infinity;
  let maxH = -Infinity;
  for (const item of items) {
    const h = item.inclusionHeight;
    if (h == null || !Number.isFinite(h) || h < 0 || !isHex64(item.id)) continue;
    ids.push(item.id);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  if (!ids.length) return items;
  try {
    const marks = await rentTapeMarks(ids, minH, maxH);
    if (!marks.size) return items;
    return items.map((item) => {
      const mark = marks.get(item.id);
      if (!mark) return item;
      return { ...item, category: mark.category, color: mark.color, platform: null, action: null };
    });
  } catch {
    return items;
  }
}

async function finishTxTape(items: TxListItem[]): Promise<TxListItem[]> {
  const taped = await attachTxLocks(
    await attachMinerFees(await attachTokenCounts(await attachTapeShape(items)))
  );
  return attachRentMarks(taped);
}

async function blocksHaveOlder(height: number): Promise<boolean> {
  const rows = await q<{ ok: string }>(
    `SELECT 1::text AS ok FROM packed.blocks WHERE height < $1 LIMIT 1`,
    [height]
  );
  return Boolean(rows?.length);
}

async function txsHaveOlder(cursor: TxTapeCursor): Promise<boolean> {
  const rows = await q<{ ok: string }>(
    `SELECT 1::text AS ok
       FROM packed.transactions
      WHERE height IS NOT NULL
        AND (
          height < $1
          OR (height = $1 AND COALESCE(index_in_block, -1) < $2)
          OR (height = $1 AND COALESCE(index_in_block, -1) = $2 AND id < decode(lower($3), 'hex'))
        )
      LIMIT 1`,
    [cursor.height, cursor.index, cursor.id]
  );
  return Boolean(rows?.length);
}

function txItemCursor(item: TxListItem): string {
  return encodeTxTapeCursor(item.inclusionHeight, item.index, item.id);
}

export type BlocksTape = {
  blocks: BlockListItem[];
  meta: SnapshotMeta;
  source: string;
  hasMore: boolean;
  nextCursor: string | null;
  /** Timestamp of the block just older than this page. Already loaded with the page. */
  olderTs: number | null;
};

function blockStamp(row: BlockListItem | undefined): number | null {
  const ts = row?.timestamp;
  return typeof ts === "number" && Number.isFinite(ts) ? ts : null;
}

/** Snapshot is the first HTML pack — not the scroll ceiling. */
export async function getBlocksList(
  limit = 50,
  cursorHeight: number | null = null
): Promise<BlocksTape | null> {
  const take = tapeTake(limit);

  if (cursorHeight != null) {
    const built = await selectBlocksPage(take + 1, cursorHeight);
    if (!built) return null;
    const hasMore = built.length > take;
    const page = hasMore ? built.slice(0, take) : built;
    const last = page[page.length - 1];
    return {
      blocks: page,
      hasMore,
      nextCursor: hasMore && last ? String(last.height) : null,
      meta: { height: page[0]?.height ?? null, updatedAt: null },
      source: "tables",
      olderTs: blockStamp(hasMore ? built[take] : undefined),
    };
  }

  const snap = await readSnapshot<BlockListItem[]>(SNAP_BLOCKS);
  if (Array.isArray(snap?.payload) && snap.payload.length) {
    const sliced = snap.payload.slice(0, take + 1);
    const hasMoreSnap = sliced.length > take;
    const page = hasMoreSnap ? sliced.slice(0, take) : sliced;
    const last = page[page.length - 1];
    let hasMore = hasMoreSnap;
    if (!hasMore && last) hasMore = await blocksHaveOlder(last.height);
    const valued = await attachUserValueNano(page);
    return {
      blocks: await paintLithos(valued),
      hasMore,
      nextCursor: hasMore && last ? String(last.height) : null,
      meta: { height: snap.height, updatedAt: snap.updatedAt },
      source: "snapshot",
      olderTs: blockStamp(hasMoreSnap ? sliced[take] : undefined),
    };
  }

  const built = await selectBlocksPage(take + 1, null);
  if (!built) return null;
  const hasMore = built.length > take;
  const page = hasMore ? built.slice(0, take) : built;
  const last = page[page.length - 1];
  return {
    blocks: page,
    hasMore,
    nextCursor: hasMore && last ? String(last.height) : null,
    meta: { height: page[0]?.height ?? null, updatedAt: null },
    source: "tables",
    olderTs: blockStamp(hasMore ? built[take] : undefined),
  };
}

/** One block from PG. Never the Ergo node. */
export const BLOCK_TX_PACK = 25;

export type BlockCard = {
  id: string;
  height: number;
  timestamp: number;
  size: number;
  parentId: string | null;
  nextId: string | null;
  txCount: number;
  minerAddress: string | null;
  feeNano: string;
  valueNano: string;
  /** Output sum minus coinbase. Additive. */
  userValueNano?: string;
  /** True when this block was mined with Lithos. Additive. */
  lithos?: boolean;
  difficulty: string | null;
  /** Signing header. Null until the indexer has filled this height. */
  header: BlockHeaderView | null;
  prevTimestamp: number | null;
  tipHeight: number | null;
  payingTxCount: number | null;
  transactions: string[];
  txs: TxListItem[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  updatedAt: string | null;
  source: string;
};

function isHeightKey(id: string): boolean {
  return /^\d{1,12}$/.test(id);
}

/** Distinct tokens on boxes this tx created or spent. Indexes 008/009. */
async function tokenCountsForTxIds(ids: string[]): Promise<Map<string, number> | null> {
  if (!ids.length) return new Map();
  const packed = packedReadEnabled();
  const rows = await q<{ tx_id: string; n: unknown }>(
    packed
      ? `SELECT encode(tx_id, 'hex') AS tx_id, COUNT(DISTINCT token_id)::text AS n
           FROM (
             SELECT b.creation_tx_id AS tx_id, a.token_id
               FROM packed.boxes b
               JOIN packed.box_assets a ON a.box_id = b.box_id
              WHERE b.creation_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
             UNION ALL
             SELECT b.spent_tx_id, a.token_id
               FROM packed.boxes b
               JOIN packed.box_assets a ON a.box_id = b.box_id
              WHERE b.spent_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
           ) s
          GROUP BY tx_id`
      : `SELECT tx_id, COUNT(DISTINCT token_id)::text AS n
     FROM (
       SELECT b.creation_tx_id AS tx_id, a.token_id
       FROM boxes b
       JOIN box_assets a ON a.box_id = b.box_id
       WHERE b.creation_tx_id = ANY($1::text[])
       UNION ALL
       SELECT b.spent_tx_id, a.token_id
       FROM boxes b
       JOIN box_assets a ON a.box_id = b.box_id
       WHERE b.spent_tx_id = ANY($1::text[])
     ) s
     GROUP BY tx_id`,
    [ids]
  );
  if (!rows) return null;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.tx_id, n(r.n));
  return m;
}

export async function getBlockSections(
  id: string
): Promise<{ extension: string | null; adProofs: string | null } | "missing" | null> {
  const key = String(id ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return "missing";
  const rows = await q<{ extension: string | null; adProofs: string | null }>(
    `SELECT encode(extension, 'hex') AS extension,
            encode(ad_proofs, 'hex') AS "adProofs"
       FROM packed.blocks
      WHERE id = decode($1, 'hex')
      LIMIT 1`,
    [key]
  );
  if (!rows) return null;
  if (!rows[0]) return "missing";
  return {
    extension: rows[0].extension,
    adProofs: rows[0].adProofs,
  };
}

export async function getBlockCard(
  idOrHeight: string,
  limit = BLOCK_TX_PACK,
  offset = 0
): Promise<BlockCard | "missing" | null> {
  const take = Math.max(0, Math.min(50, Math.floor(Number(limit)) || 0));
  const skip = Math.max(0, Math.floor(Number(offset)) || 0);
  const key = String(idOrHeight ?? "").trim();
  if (!key) return "missing";

  const byHeight = isHeightKey(key);
  const packed = packedReadEnabled();
  if (packed && !byHeight && !isHex64(key)) return "missing";
  const head = await q<{
    id: string;
    height: unknown;
    timestamp: unknown;
    size: unknown;
    txCount: unknown;
    parentId: string | null;
    minerAddress: string | null;
    difficulty: string | null;
    feeNano: string | null;
    valueNano: string | null;
    version?: unknown;
    nBits?: unknown;
    votes?: unknown;
    stateRoot?: unknown;
    adProofsRoot?: unknown;
    transactionsRoot?: unknown;
    extensionHash?: unknown;
    powPk?: unknown;
    powW?: unknown;
    powN?: unknown;
    powD?: unknown;
  }>(
    packed
      ? byHeight
        ? PACKED_BLOCK_BY_HEIGHT_SQL
        : PACKED_BLOCK_BY_ID_SQL
      : `SELECT id, height, timestamp_ms AS timestamp, COALESCE(size, 0) AS size,
            tx_count AS "txCount", parent_id AS "parentId",
            miner_address AS "minerAddress", difficulty,
            COALESCE(fee_nano, 0)::text AS "feeNano",
            COALESCE(value_nano, 0)::text AS "valueNano"
     FROM blocks
     WHERE ${byHeight ? "height = $1" : "id = $1"}
     LIMIT 1`,
    [byHeight ? Number(key) : key]
  );
  if (!head) return null;
  if (!head[0]) return "missing";
  const b = head[0];
  const height = n(b.height);

  const [prevRows, nextRows, counts, tip, lithosHit] = await Promise.all([
    height > 0
      ? q<{ id: string; timestamp: unknown }>(
          packed
            ? PACKED_BLOCK_ID_SQL
            : `SELECT id, timestamp_ms AS timestamp FROM blocks WHERE height = $1 LIMIT 1`,
          [height - 1]
        )
      : Promise.resolve([] as { id: string; timestamp: unknown }[]),
    q<{ id: string }>(
      packed
        ? `SELECT encode(id, 'hex') AS id FROM packed.blocks WHERE height = $1 LIMIT 1`
        : `SELECT id FROM blocks WHERE height = $1 LIMIT 1`,
      [height + 1]
    ),
    q<{ n: string; paying: string; fee_nano: string }>(
      packed
        ? `SELECT
         (SELECT COUNT(*)::text FROM packed.transactions WHERE height = $1) AS n,
         (SELECT COUNT(DISTINCT b.creation_tx_id)::text
          FROM packed.boxes b
          JOIN packed.transactions t ON t.id = b.creation_tx_id
          LEFT JOIN packed.addr a ON a.id = b.addr_id
          LEFT JOIN packed.script s ON s.id = b.script_id
          WHERE t.height = $1
            AND (a.address = $2 OR lower(s.ergo_tree) = lower($3))) AS paying,
         (SELECT COALESCE(SUM(b.value_nano), 0)::text
          FROM packed.boxes b
          JOIN packed.transactions t ON t.id = b.creation_tx_id
          LEFT JOIN packed.addr a ON a.id = b.addr_id
          LEFT JOIN packed.script s ON s.id = b.script_id
          WHERE t.height = $1
            AND (a.address = $2 OR lower(s.ergo_tree) = lower($3))) AS fee_nano`
        : `SELECT
         (SELECT COUNT(*)::text FROM transactions WHERE height = $1) AS n,
         (SELECT COUNT(DISTINCT b.creation_tx_id)::text
          FROM boxes b
          JOIN transactions t ON t.id = b.creation_tx_id
          WHERE t.height = $1
            AND (b.address = $2 OR lower(b.ergo_tree) = lower($3))) AS paying,
         (SELECT COALESCE(SUM(b.value_nano), 0)::text
          FROM boxes b
          JOIN transactions t ON t.id = b.creation_tx_id
          WHERE t.height = $1
            AND (b.address = $2 OR lower(b.ergo_tree) = lower($3))) AS fee_nano`,
      [height, MINERS_FEE_ADDRESS, MINERS_FEE_TREE]
    ),
    peekChainTip(),
    lithosHeights([height]),
  ]);

  const counted = counts?.[0] ? Number(counts[0].n) : NaN;
  const txCount = Number.isFinite(counted) ? counted : nNull(b.txCount) ?? 0;
  const payingTxCount =
    counts?.[0] && Number.isFinite(Number(counts[0].paying))
      ? Number(counts[0].paying)
      : null;

  let txs: TxListItem[] = [];
  if (take > 0) {
    const rows = await q<{
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
      packed
        ? PACKED_TXS_AT_HEIGHT_SQL
        : `SELECT id, index_in_block, height, timestamp_ms, size, fee,
              input_count, output_count, value_nano, shape, protocol
       FROM transactions
       WHERE height = $1
       ORDER BY index_in_block ASC NULLS LAST, id
       LIMIT $2 OFFSET $3`,
      [height, take, skip]
    );
    if (rows) {
      txs = await finishTxTape(rows.map(mapTx));
    }
  }

  const card: BlockCard = {
    id: b.id,
    height,
    timestamp: n(b.timestamp),
    size: n(b.size),
    parentId: b.parentId && b.parentId.length ? b.parentId : null,
    nextId: nextRows?.[0]?.id ?? null,
    txCount,
    minerAddress: b.minerAddress && b.minerAddress.length ? b.minerAddress : null,
    feeNano: nanoDigits(counts?.[0]?.fee_nano ?? b.feeNano),
    valueNano: nanoDigits(b.valueNano),
    difficulty: b.difficulty && String(b.difficulty).length ? String(b.difficulty) : null,
    header: blockHeaderFromRow(b),
    prevTimestamp: prevRows?.[0] ? nNull(prevRows[0].timestamp) : null,
    tipHeight: tip?.height ?? null,
    payingTxCount,
    transactions: txs.map((t) => t.id),
    txs,
    pagination: {
      offset: skip,
      limit: take,
      total: txCount,
      hasMore: skip + txs.length < txCount,
    },
    updatedAt: tip?.updatedAt ?? null,
    lithos: lithosHit.has(height),
    source: "index",
  };
  const [painted] = await attachUserValueNano([
    {
      id: card.id,
      height: card.height,
      timestamp: card.timestamp,
      size: card.size,
      txCount: card.txCount,
      parentId: card.parentId,
      minerAddress: card.minerAddress,
      minerName: null,
      feeNano: card.feeNano,
      valueNano: card.valueNano,
    },
  ]);
  return { ...card, userValueNano: painted?.userValueNano };
}

export async function getConfirmedRecentTxs(
  limit: number,
  cursor: TxTapeCursor | null = null
): Promise<
  | {
      items: TxListItem[];
      meta: SnapshotMeta;
      source: string;
      hasMore: boolean;
      nextCursor: string | null;
    }
  | null
> {
  const take = tapeTake(limit);

  if (cursor) {
    const built = await selectRecentTxsPage(take + 1, cursor);
    if (!built) return null;
    const hasMore = built.length > take;
    const page = hasMore ? built.slice(0, take) : built;
    const last = page[page.length - 1];
    return {
      items: page,
      hasMore,
      nextCursor: hasMore && last ? txItemCursor(last) : null,
      meta: {
        height: page[0]?.inclusionHeight ?? null,
        updatedAt: null,
      },
      source: "tables",
    };
  }

  const snap = await readSnapshot<{ items?: TxListItem[] }>(SNAP_TXS);
  const fromSnap = snap?.payload?.items;
  if (snap && Array.isArray(fromSnap) && fromSnap.length) {
    const sliced = fromSnap.slice(0, take + 1).map((t) => ({ ...t, confirmed: true as const }));
    const hasMoreSnap = sliced.length > take;
    const page = hasMoreSnap ? sliced.slice(0, take) : sliced;
    const last = page[page.length - 1];
    let hasMore = hasMoreSnap;
    if (!hasMore && last) {
      hasMore = await txsHaveOlder({
        height: last.inclusionHeight ?? -1,
        index: last.index ?? -1,
        id: last.id,
      });
    }
    return {
      items: await finishTxTape(page),
      hasMore,
      nextCursor: hasMore && last ? txItemCursor(last) : null,
      meta: { height: snap.height, updatedAt: snap.updatedAt },
      source: "snapshot",
    };
  }

  const built = await selectRecentTxsPage(take + 1, null);
  if (!built) return null;
  const hasMore = built.length > take;
  const page = hasMore ? built.slice(0, take) : built;
  const last = page[page.length - 1];
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? txItemCursor(last) : null,
    meta: {
      height: page[0]?.inclusionHeight ?? snap?.height ?? null,
      updatedAt: snap?.updatedAt ?? null,
    },
    source: "tables",
  };
}

export async function getStatusSnapshot(): Promise<
  (IndexerStatus & { ts?: number; height?: number | null; updatedAt?: string | null; source: string }) | null
> {
  const snap = await readSnapshot<IndexerStatus & { ts?: number }>(SNAP_STATUS);
  if (snap?.payload && typeof snap.payload === "object") {
    return {
      ...snap.payload,
      height: snap.height,
      updatedAt: snap.updatedAt,
      source: "snapshot",
    };
  }
  return null;
}

export type TxActivityPoint = { t: number; txs: number; feesErg: number; feesKnown?: boolean };

export type HomeStats24h = {
  blocks: number | null;
  avgBlockMs: number | null;
  coinsMined: number | null;
  txs: number | null;
  feesErg: number | null;
  outputErg: number | null;
  minerRevenueErg: number | null;
  feeSharePct: number | null;
};

export type HomePoolShare = {
  name: string;
  blocks: number;
  share: number;
  address?: string;
};

export type HomePage = {
  height: number | null;
  blocks: BlockListItem[];
  txs: TxListItem[];
  indexer: IndexerStatus | null;
  ts: number;
  source: string;
  updatedAt: string | null;
  /** Additive: last header H/s from indexer `blocks.difficulty` / 120. */
  hashRate?: number | null;
  /** Additive: hourly H/s over the indexed 7d window. */
  hashRateSeries?: { t: number; v: number }[];
  /** Additive: SUM(tx_count) over last 24h in the indexer window. */
  txPerDay?: number | null;
  /** Additive: confirmed txs in the indexed window. Indexer running SUM, not GET COUNT. */
  txTotal?: number | null;
  /** Additive: rolling 24h tx count at each hour over the indexed 7d window. */
  txPerDaySeries?: { t: number; v: number }[];
  /** Additive: hourly tx count + fees (ERG) over the indexed 7d window. `feesKnown` false = gap, not a zero. */
  txActivity?: TxActivityPoint[];
  /** Additive: EIP-27 circulating from the emission schedule at indexed height. */
  circulating?: number | null;
  maxSupply?: number | null;
  avgBlockMs?: number | null;
  stats24h?: Partial<HomeStats24h>;
  /** Additive: CoinGecko ERG/USD written by the indexer, not on GET. */
  ergUsd?: number | null;
  ergUsdSource?: string | null;
  /** Additive: EIP-23 oracle from indexer PK hop. Does not replace ergUsd. */
  ergUsdOracle?: number | null;
  ergUsdOracleNano?: number | null;
  ergUsdOracleBoxId?: string | null;
  ergUsdOracleHeight?: number | null;
  /** Additive: hourly CG ERG/USD from market_cg_tick. */
  priceSeries?: { t: number; v: number }[];
  /** Additive: CoinGecko rank / 24h volume / 24h %, same poll as ergUsd. */
  rank?: number | null;
  volume24h?: number | null;
  change24h?: number | null;
  /** Additive: 24h blocks grouped by miner reward address. */
  pools?: HomePoolShare[];
  /** Additive: distinct miner addresses in the 24h window. */
  minerCount?: number | null;
  /** Additive: P2PK with nanoERG > 0 in address_summary. */
  holderCount?: number | null;
  /** Additive: protocol + pool + contract with nanoERG > 0. Same holder-bands pass. */
  scriptCount?: number | null;
  /** Additive: those holders whose first height is inside the last ~30 days. */
  holdersMonth?: number | null;
  /** Additive: oldest addresses due this week from snapshot_kv.rent. Snapshot GET only. */
  rentTape?: RentTapeRow[];
  /** Additive: unspent boxes due before this header epoch ends. Snapshot GET only. */
  rentEpochBoxes?: number | null;
  /** Additive: estimated rent nano due before this header epoch ends. Snapshot GET only. */
  rentEpochNano?: string | null;
  /** Additive: tokens short on ERG, copied from snapshot_kv.rent.danger. Snapshot GET only. */
  rentDanger?: unknown[];
};

function parseSeries(raw: unknown): { t: number; v: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { t: number; v: number }[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const t = nNull((p as { t?: unknown }).t);
    const v = nNull((p as { v?: unknown }).v);
    if (t == null || v == null || v <= 0) continue;
    out.push({ t, v });
  }
  return out;
}

function parseTxActivity(raw: unknown): TxActivityPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: TxActivityPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const r = p as { t?: unknown; txs?: unknown; feesErg?: unknown; feesKnown?: unknown };
    const t = nNull(r.t);
    const txs = nNull(r.txs);
    const feesErg = nNull(r.feesErg);
    if (t == null || txs == null || txs < 0 || feesErg == null || feesErg < 0) continue;
    out.push({ t, txs, feesErg, feesKnown: r.feesKnown !== false });
  }
  return out;
}

function parseStats24h(raw: unknown): Partial<HomeStats24h> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<HomeStats24h> = {};
  const keys: (keyof HomeStats24h)[] = [
    "blocks",
    "avgBlockMs",
    "coinsMined",
    "txs",
    "feesErg",
    "outputErg",
    "minerRevenueErg",
    "feeSharePct",
  ];
  let any = false;
  for (const k of keys) {
    const n = nNull(r[k]);
    if (n != null) {
      out[k] = n;
      any = true;
    }
  }
  return any ? out : undefined;
}

function parsePools(raw: unknown): HomePoolShare[] {
  if (!Array.isArray(raw)) return [];
  const pools: HomePoolShare[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; blocks?: unknown; share?: unknown; address?: unknown };
    const blocks = nNull(r.blocks);
    if (blocks == null || blocks <= 0) continue;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "—";
    const share = nNull(r.share);
    const address =
      typeof r.address === "string" && r.address.trim() ? r.address.trim() : undefined;
    pools.push({
      name,
      blocks,
      share: share != null && share >= 0 ? share : 0,
      ...(address ? { address } : {}),
    });
  }
  if (!pools.length) return [];
  const total = pools.reduce((s, p) => s + p.blocks, 0);
  if (pools.every((p) => p.share === 0) && total > 0) {
    return pools.map((p) => ({ ...p, share: p.blocks / total }));
  }
  return pools;
}

function homeKpisFromPayload(p: {
  hashRate?: number | null;
  hashRateSeries?: { t: number; v: number }[];
  txPerDay?: number | null;
  txPerDaySeries?: { t: number; v: number }[];
  txActivity?: TxActivityPoint[];
  txTotal?: number | null;
  circulating?: number | null;
  maxSupply?: number | null;
  avgBlockMs?: number | null;
  stats24h?: Partial<HomeStats24h>;
  pools?: HomePoolShare[];
  minerCount?: number | null;
  holderCount?: number | null;
  scriptCount?: number | null;
  holdersMonth?: number | null;
  ergUsd?: number | null;
  ergUsdSource?: string | null;
  ergUsdOracle?: number | null;
  ergUsdOracleNano?: number | null;
  ergUsdOracleBoxId?: string | null;
  ergUsdOracleHeight?: number | null;
  priceSeries?: { t: number; v: number }[];
  rank?: number | null;
  volume24h?: number | null;
  change24h?: number | null;
}): Pick<
  HomePage,
  | "hashRate"
  | "hashRateSeries"
  | "txPerDay"
  | "txPerDaySeries"
  | "txActivity"
  | "txTotal"
  | "circulating"
  | "maxSupply"
  | "avgBlockMs"
  | "stats24h"
  | "pools"
  | "minerCount"
  | "holderCount"
  | "scriptCount"
  | "holdersMonth"
  | "ergUsd"
  | "ergUsdSource"
  | "ergUsdOracle"
  | "ergUsdOracleNano"
  | "ergUsdOracleBoxId"
  | "ergUsdOracleHeight"
  | "priceSeries"
  | "rank"
  | "volume24h"
  | "change24h"
> {
  const hashRateSeries = parseSeries(p.hashRateSeries);
  const txPerDaySeries = parseSeries(p.txPerDaySeries);
  const txActivity = parseTxActivity(p.txActivity);
  return {
    hashRate: nNull(p.hashRate) ?? (hashRateSeries.at(-1)?.v ?? null),
    hashRateSeries,
    txPerDay: nNull(p.txPerDay) ?? (txPerDaySeries.at(-1)?.v ?? null),
    txPerDaySeries,
    txActivity,
    txTotal: (() => {
      const n = nNull(p.txTotal);
      return n != null && n > 0 ? Math.round(n) : null;
    })(),
    circulating: nNull(p.circulating),
    maxSupply: nNull(p.maxSupply),
    avgBlockMs: nNull(p.avgBlockMs),
    stats24h: parseStats24h(p.stats24h),
    pools: parsePools(p.pools),
    minerCount: nNull(p.minerCount),
    holderCount: nNull(p.holderCount),
    scriptCount: (() => {
      const n = nNull(p.scriptCount);
      return n != null && n >= 0 ? Math.round(n) : null;
    })(),
    holdersMonth: nNull(p.holdersMonth),
    ergUsd: nNull(p.ergUsd),
    ergUsdSource: typeof p.ergUsdSource === "string" && p.ergUsdSource.trim() ? p.ergUsdSource.trim() : null,
    ergUsdOracle: nNull(p.ergUsdOracle),
    ergUsdOracleNano: nNull(p.ergUsdOracleNano),
    ergUsdOracleBoxId:
      typeof p.ergUsdOracleBoxId === "string" && /^[0-9a-f]{64}$/i.test(p.ergUsdOracleBoxId)
        ? p.ergUsdOracleBoxId.toLowerCase()
        : null,
    ergUsdOracleHeight: nNull(p.ergUsdOracleHeight),
    priceSeries: parseSeries(p.priceSeries),
    rank: (() => {
      const r = nNull(p.rank);
      return r != null && r >= 1 ? Math.round(r) : null;
    })(),
    volume24h: (() => {
      const v = nNull(p.volume24h);
      return v != null && v > 0 ? v : null;
    })(),
    change24h: nNull(p.change24h),
  };
}

export async function getHomePage(): Promise<HomePage | null> {
  const [snap, rentSnap] = await Promise.all([
    readSnapshot<{
      height?: number;
      blocks?: BlockListItem[];
      txs?: TxListItem[];
      indexer?: IndexerStatus;
      ts?: number;
      hashRate?: number | null;
      hashRateSeries?: { t: number; v: number }[];
      txPerDay?: number | null;
      txPerDaySeries?: { t: number; v: number }[];
      txActivity?: TxActivityPoint[];
      txTotal?: number | null;
      circulating?: number | null;
      maxSupply?: number | null;
      avgBlockMs?: number | null;
      stats24h?: Partial<HomeStats24h>;
      pools?: HomePoolShare[];
      minerCount?: number | null;
      holderCount?: number | null;
      scriptCount?: number | null;
      holdersMonth?: number | null;
      ergUsd?: number | null;
      ergUsdSource?: string | null;
      ergUsdOracle?: number | null;
      ergUsdOracleNano?: number | null;
      ergUsdOracleBoxId?: string | null;
      ergUsdOracleHeight?: number | null;
      priceSeries?: { t: number; v: number }[];
      rank?: number | null;
      volume24h?: number | null;
      change24h?: number | null;
    }>(SNAP_HOME),
    readSnapshot<{
      addresses?: unknown;
      thisEpoch?: { boxCount?: unknown; rentNano?: unknown };
      danger?: unknown;
    }>(SNAP_RENT),
  ]);
  const rentTape = parseRentTape(rentSnap?.payload?.addresses);
  const rentEpochBoxes = parseRentEpochBoxes(rentSnap?.payload?.thisEpoch);
  const rentEpochNano = parseRentEpochNano(rentSnap?.payload?.thisEpoch);
  const rentDanger = Array.isArray(rentSnap?.payload?.danger) ? rentSnap.payload.danger : null;
  const rentField = {
    ...(rentTape != null ? { rentTape } : {}),
    ...(rentEpochBoxes != null ? { rentEpochBoxes } : {}),
    ...(rentEpochNano != null ? { rentEpochNano } : {}),
    ...(rentDanger != null ? { rentDanger } : {}),
  };
  if (snap?.payload && Array.isArray(snap.payload.blocks)) {
    return {
      height: snap.payload.height ?? snap.height,
      // Cadence uses txCount/size only. userValueNano stays on /v1/blocks + block card.
      blocks: snap.payload.blocks,
      txs: (snap.payload.txs ?? []).map((t) => ({ ...t, confirmed: true })),
      indexer: snap.payload.indexer
        ? publicIndexerStatus(snap.payload.indexer as IndexerStatus)
        : null,
      ts: snap.payload.ts ?? Date.now(),
      source: "snapshot",
      updatedAt: snap.updatedAt,
      ...homeKpisFromPayload(snap.payload),
      ...rentField,
    };
  }
  const [blocks, txs, status] = await Promise.all([
    selectBlocks(10, false),
    selectRecentTxs(16),
    getStatusSnapshot(),
  ]);
  if (!blocks?.length && !txs?.length) return null;
  return {
    height: blocks?.[0]?.height ?? status?.tipHeight ?? null,
    blocks: blocks ?? [],
    txs: txs ?? [],
    indexer: status ? publicIndexerStatus(status) : null,
    ts: Date.now(),
    source: "tables",
    updatedAt: status?.updatedAt ?? null,
    ...rentField,
  };
}

/** Snapshot tip for WS `chain.tip` — never the Ergo node. */
export type ChainTip = {
  height: number;
  headerId: string;
  updatedAt: string | null;
};

export async function peekChainTip(): Promise<ChainTip | null> {
  const snap = await readSnapshot<BlockListItem[]>(SNAP_BLOCKS);
  const height = snap?.height ?? null;
  const headerId = Array.isArray(snap?.payload) ? snap.payload[0]?.id : undefined;
  if (height == null || !headerId) return null;
  return { height, headerId, updatedAt: snap?.updatedAt ?? null };
}

export async function getHolderBands(): Promise<{
  p2pk: { id: string; n: number; nanoerg: string }[];
  all: { id: string; n: number; nanoerg: string }[];
  kinds: { id: string; n: number; nanoerg: string }[];
} | null> {
  const snap = await readSnapshot<{
    p2pk?: { id: string; n: number; nanoerg: string }[];
    all?: { id: string; n: number; nanoerg: string }[];
    kinds?: { id: string; n: number; nanoerg: string }[];
  }>(SNAP_HOLDER_BANDS);
  const p2pk = Array.isArray(snap?.payload?.p2pk) ? snap.payload.p2pk : null;
  const all = Array.isArray(snap?.payload?.all) ? snap.payload.all : null;
  const kinds = Array.isArray(snap?.payload?.kinds) ? snap.payload.kinds : [];
  if (!p2pk && !all) return null;
  return { p2pk: p2pk ?? [], all: all ?? [], kinds };
}

export async function getAddressesPage(opts: {
  limit?: number;
  offset?: number;
  p2pkOnly?: boolean;
  sort?: AddressSort;
  dir?: AddressSortDir;
  bands?: AddressBand[] | null;
  kinds?: AddressKind[] | null;
  band?: AddressBand | null;
  kind?: AddressKind | null;
}): Promise<
  | { items: AddressListItem[]; meta: SnapshotMeta; source: string }
  | null
> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const p2pkOnly = !!opts.p2pkOnly;
  const sort = parseAddressSort(opts.sort);
  const dir = parseAddressSortDir(opts.dir);
  const { bands, kinds } = normalizeAddressFilter(
    parseAddressBandList(opts.bands ?? opts.band ?? null),
    parseAddressKindList(opts.kinds ?? opts.kind ?? null)
  );
  const defaultOrder = sort === "erg" && dir === "desc";
  if (!p2pkOnly && !bands.length && !kinds.length && defaultOrder) {
    const snap = await readSnapshot<AddressListItem[]>(SNAP_ADDRESSES);
    const rows = Array.isArray(snap?.payload) ? snap.payload : [];
    const page = rows.slice(offset, offset + limit);
    const dated = page.some((row) => row.firstTs != null || row.lastTs != null);
    if (page.length && offset + limit <= rows.length && dated) {
      return {
        items: await fillAddressActivityTxs(
          page.map((row, i) => ({
            ...row,
            rank: offset + i + 1,
            nanoerg: String(row.nanoerg ?? "0"),
            firstTs: row.firstTs ?? null,
            lastTs: row.lastTs ?? null,
            firstHeight: row.firstHeight ?? null,
            lastHeight: row.lastHeight ?? null,
          }))
        ),
        meta: { height: snap!.height, updatedAt: snap!.updatedAt },
        source: "snapshot",
      };
    }
  }
  const built = await listAddressSummaries({ limit, offset, p2pkOnly, sort, dir, bands, kinds });
  if (!built) return null;
  return {
    items: await fillAddressActivityTxs(built),
    meta: { height: null, updatedAt: null },
    source: "tables",
  };
}

/** Display/USD only — never use for stored amounts. */
export function nanoToErgApprox(nano: string): number {
  const raw = String(nano ?? "0").trim();
  if (!raw) return 0;
  const neg = raw.startsWith("-");
  const body = (neg ? raw.slice(1) : raw).split(".")[0] ?? "0";
  if (!/^\d+$/.test(body)) return 0;
  const d = body.replace(/^0+/, "") || "0";
  const n =
    d.length <= 9
      ? Number(d) / 1e9
      : Number(d.slice(0, -9)) + Number(d.slice(-9)) / 1e9;
  return neg ? -n : n;
}

function nanoBigInt(nano: string): bigint {
  const raw = String(nano ?? "0").trim();
  const neg = raw.startsWith("-");
  const body = (neg ? raw.slice(1) : raw).split(".")[0] ?? "0";
  if (!/^\d+$/.test(body)) return 0n;
  const n = BigInt(body);
  return neg ? -n : n;
}

export type AddressListMarketItem = AddressListItem & {
  balanceUsd: number | null;
  sharePct: number | null;
};

export function withAddressListMarket(
  items: AddressListItem[],
  ergUsd: number
): AddressListMarketItem[] {
  let total = 0n;
  const nanos = items.map((r) => {
    const n = nanoBigInt(r.nanoerg);
    const pos = n < 0n ? 0n : n;
    total += pos;
    return pos;
  });
  return items.map((row, i) => {
    const n = nanos[i] ?? 0n;
    const balanceErg = nanoToErgApprox(row.nanoerg);
    return {
      ...row,
      balanceUsd: ergUsd > 0 ? balanceErg * ergUsd : null,
      sharePct: total > 0n ? Number((n * 10000n) / total) / 100 : null,
    };
  });
}

export type { RentPage, RentTab };

function coverSnapWindow(w: RentWindow, windowHi: number, minHeight: number | null): RentWindow {
  if (typeof w.inIndex === "boolean") return w;
  return { ...w, inIndex: minHeight == null || windowHi >= minHeight };
}

function withWindowCoverage(kpis: RentKpis): RentKpis {
  const min = kpis.minHeight;
  const due = kpis.dueHeight;
  return {
    ...kpis,
    due: coverSnapWindow(kpis.due, due, min),
    next24h: coverSnapWindow(kpis.next24h, due + RENT_BLOCKS_24H, min),
    next7d: coverSnapWindow(kpis.next7d, due + RENT_BLOCKS_7D, min),
    next30d: coverSnapWindow(kpis.next30d, due + RENT_BLOCKS_30D, min),
  };
}

function readBoxPage(
  snap: RentKpis | null | undefined,
  key: "duePage" | "aheadPage"
): RentBoxRow[] | null {
  const raw = (snap as Record<string, unknown> | null | undefined)?.[key];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw as RentBoxRow[];
}

function readClaimsPack(snap: RentKpis | null | undefined): {
  recent: RentClaimRow[];
  recentTotal: number;
  miners: RentMinersPack | null;
  minersDay: RentMinersPack | null;
  minersMonth: RentMinersPack | null;
} | null {
  const raw = (snap as { claims?: unknown } | null | undefined)?.claims;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as {
    recent?: RentClaimRow[];
    recentTotal?: number;
    miners?: RentMinersPack;
    minersDay?: RentMinersPack;
    minersMonth?: RentMinersPack;
  };
  if (!Array.isArray(c.recent)) return null;
  return {
    recent: c.recent,
    recentTotal: typeof c.recentTotal === "number" ? c.recentTotal : c.recent.length,
    miners: c.miners ?? null,
    minersDay: c.minersDay ?? null,
    minersMonth: c.minersMonth ?? null,
  };
}

export async function getRentPage(opts?: {
  tab?: string;
  offset?: number;
  limit?: number;
  claimOffset?: number;
}): Promise<RentPage | null> {
  const tab: RentTab =
    opts?.tab === "upcoming" ? "upcoming" : opts?.tab === "due" ? "due" : "oldest";
  const limit = Math.min(100, Math.max(1, opts?.limit ?? RENT_PACK));
  const offset = Math.max(0, opts?.offset ?? 0);
  const snap = await readSnapshot<RentKpis>(SNAP_RENT);
  const snapKpis = snap?.payload;
  const usedSnap = Boolean(snapKpis?.tipHeight && snapKpis.next24h);
  let kpis: RentKpis | null = usedSnap && snapKpis ? snapKpis : null;
  if (!kpis) {
    const st = await getStatusSnapshot();
    const tip = st?.tipHeight ?? st?.tipSeen ?? st?.lastHeight ?? 0;
    kpis = await rentKpisFromIndex(Number(tip) || 0);
  }
  if (!kpis) return null;
  const minRow = await q<{ v: string }>(
    `SELECT value AS v FROM indexer_state WHERE key = 'min_height'`
  );
  const chainMin = nNull(minRow?.[0]?.v);
  if (chainMin != null) kpis = { ...kpis, minHeight: chainMin };
  kpis = withWindowCoverage(kpis);
  const hist = await readSnapshot<{
    boxCount?: number;
    rentNano?: string;
    lastHeight?: number;
    series?: unknown;
    daily?: unknown;
    hourly?: unknown;
  }>(SNAP_RENT_HISTORY);
  let collected: RentPage["collected"] = null;
  if (hist?.payload) {
    const lastH = nNull(hist.payload.lastHeight) ?? hist.height;
    let daily = parseRentSeries(hist.payload.daily);
    let series = fillRentWeekGaps(parseRentSeries(hist.payload.series));
    let hourly = parseRentSeries(hist.payload.hourly);
    if (hist.payload.daily == null || hist.payload.series == null) {
      const loaded = await rentHistoryDailyFromIndex();
      if (hist.payload.daily == null) daily = loaded.daily;
      if (hist.payload.series == null) series = loaded.week;
    }
    if (hist.payload.hourly == null) hourly = await rentHistoryHourlyFromIndex();
    const claimOffset = Math.max(0, opts?.claimOffset ?? 0);
    const snapClaims = readClaimsPack(snapKpis);
    const recentSlice =
      snapClaims && claimOffset + limit <= snapClaims.recent.length
        ? snapClaims.recent.slice(claimOffset, claimOffset + limit)
        : null;
    let minersAll = snapClaims?.miners ?? null;
    let minersDay = snapClaims?.minersDay ?? null;
    let minersMonth = snapClaims?.minersMonth ?? null;
    let recentItems = recentSlice;
    let recentTotal = snapClaims?.recentTotal ?? null;
    if (!recentItems || !minersAll) {
      const [minerWindows, liveAll, recent] = await Promise.all([
        minersDay && minersMonth ? Promise.resolve(null) : rentMinerWindowsFromIndex(kpis.tipHeight),
        minersAll ? Promise.resolve(null) : rentMinersAllFromIndex(),
        recentItems ? Promise.resolve(null) : rentRecentClaims(claimOffset, limit),
      ]);
      if (!minersAll && liveAll) minersAll = liveAll;
      if (!minersDay && minerWindows) minersDay = minerWindows.day;
      if (!minersMonth && minerWindows) minersMonth = minerWindows.month;
      if (!recentItems && recent) {
        recentItems = recent.items;
        recentTotal = recent.total;
      }
    }
    const protocolBoxes = minersAll?.boxCount ?? recentTotal ?? 0;
    const protocolNano = minersAll?.rentNano ?? "0";
    collected = {
      boxCount: protocolBoxes,
      rentNano: nanoDigits(protocolNano),
      lastHeight: lastH,
      catchingUp: lastH != null && lastH + 32 < kpis.tipHeight,
      recent: recentItems ?? [],
      recentTotal: recentTotal ?? 0,
      ...(series.length >= 2 ? { series } : {}),
      ...(daily.length >= 2 ? { daily } : {}),
      ...(hourly.length >= 2 ? { hourly } : {}),
      ...(minersAll && (minersAll.pools.length || minersAll.uncoveredBoxes > 0)
        ? { miners: minersAll }
        : {}),
      ...(minersDay && minersMonth ? { minersDay, minersMonth } : {}),
    };
  }
  kpis = { ...kpis, collected };
  const snapDanger = (snapKpis as { danger?: unknown } | null)?.danger;
  const danger =
    tab === "upcoming" && Array.isArray(snapDanger) ? snapDanger : [];
  const stored =
    tab === "due"
      ? readBoxPage(snapKpis, "duePage")
      : tab === "upcoming"
        ? readBoxPage(snapKpis, "aheadPage")
        : null;
  const boxes =
    stored && offset + limit <= stored.length
      ? {
          items: stored.slice(offset, offset + limit),
          hasMore: true,
          total: null as number | null,
        }
      : await rentBoxesFromIndex({
          tipHeight: kpis.tipHeight,
          tab,
          offset,
          limit,
        });
  // The snapshot's stored first pages: items already carries the one asked for.
  const { duePage: _duePage, aheadPage: _aheadPage, ...shown } = kpis as RentKpis & {
    duePage?: unknown;
    aheadPage?: unknown;
  };
  return {
    ...shown,
    ...(tab === "upcoming" ? { danger } : {}),
    items: boxes?.items ?? [],
    pagination: {
      offset,
      limit,
      hasMore: boxes?.hasMore ?? false,
      total: boxes?.total ?? null,
    },
    tab,
    source: usedSnap ? "snapshot" : "indexer",
    updatedAt: snap?.updatedAt ?? null,
  };
}

