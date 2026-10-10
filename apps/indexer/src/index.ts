/**
 * ErgoScan indexer — tip + deepen.
 *
 * P2-2: mark spent inputs (spent_tx_id / spent_height), estimate fee when possible.
 * P2-3/4: resolve output address from ergoTree (node block txs omit address).
 * P2-5: upsert tokens (esp. amount=1 NFT-like) + optional meta hydration.
 * P2-6: deepen walk-back under disk cap when tip is caught up.
 *
 * Env:
 *   DATABASE_URL   postgres://...
 *   ERGO_NODE_URL  http://127.0.0.1:9053
 *   BACKFILL_DEPTH default 5000   (initial tip window)
 *   DEEPEN_DEPTH   default 25000  (how far back from tip to walk)
 *   MAX_PER_TICK   default 25
 *   DEEPEN_PER_TICK default 12
 *   PREFETCH_BLOCKS default 3  (HTTP lookahead; 1 = off)
 *   BATCH_SQL default 1  (multi-row SQL per height; 0 = per-row / per-tx)
 *   TOKEN_STATS_EVERY_N default 5  (after genesis; skipped while minH > floor)
 *   TOKEN_STATS_MS default 60000
 *   LIST_SNAP_MS default 60000  (full list snap while history open; 0 = every tick)
 *   TOKEN_STATS_CATCHUP_MULT unused while history open (seed skipped)
 *   BACKFILL_SUMMARY_CAP default 40  (0 = all pending, no P2PK filter)
 *   BACKFILL_SUMMARY_EVERY_N default 5  (0 = every backfill tick)
 *   MIN_DISK_FREE_GB default 8
 *   POLL_MS        default 8000
 *   INDEXER_ENABLED 1 to run
 *   REPAIR_SPENDS  1 once to re-walk indexed heights and re-apply spends
 *   REPAIR_ADDRESSES 1 once to fill NULL addresses via ergoTreeToAddress
 *   REPAIR_OUTPUT_INDEX 1 once to aggressively fill boxes.output_index
 *   ENRICH_TOKENS  1 (default) hydrate token names from node
 *   ADDRESS_TX_LONG  0 on the tip unit (historical long P2S lives in
 *                    lumen-address-tx-long-writer). Default 1.
 *   GIX_BACKFILL     0 on the tip unit (historical gix lives in
 *                    lumen-gix-writer). Default 1. Tip stamps gix
 *                    only after indexer_state.gix_v1.
 *
 * Long P2S (emission 318 chars) skip the address btree (length > 200).
 * Writer recounts them via md5 after boxes_unspent_long_md5_idx is ready.
 */
import type pg from "pg";
import { ERG_USD_ORACLE_NFT } from "@ergoscan/shared";
import { createPool } from "./db.js";
import { rememberOracleBox, writeOracleHomeFields } from "./oracleErgUsd.js";
import {
  writeListSnapshots,
  writeWindowSnapshots,
  writeIndexerStatusSnapshot,
  ensureSnapshotSchema,
  maybeFillRecentTxShapes,
} from "./snapshots.js";
import { ensureMarketCgSchema } from "./cgMarket.js";
import {
  applyTokenCredits,
  applyTokenSpends,
  enableHolderTxCountLive,
  loadHolderTxCountLive,
  syncTokenBalanceHeightsPage,
  syncTokenBalanceTxCountPage,
  maybeFillLongHolderTxCounts,
  ensureTokenStatsSchema,
  invertTokenStatsAtHeight,
  maybeCatchupTokenStats,
  maybeRecountTokenTapeCounts,
  syncTokenBalancesUtxoPage,
} from "./tokenStats.js";
import {
  backfillAddressSummaryTxCounts,
  ensureAddressSummarySchema,
  maybeFillHugeAddressSummaries,
  ensureLongAddressLookup,
  fatSummaryRows,
  isBoxesUnspentValueIdxValid,
  refreshAddressSummaries,
  seedAddressSummaries,
  touchedAddressesAtHeight,
} from "./addressSummary.js";
import { packedWriteEnabled, textChainBoxesEnabled, textChainHeadersEnabled } from "./packed/flags.js";
import { writePackedHeight } from "./packed/copy.js";
import { ensurePackedSchema } from "./packed/schema.js";
import { unwindPackedHeight } from "./packed/unwind.js";
import { execSync } from "node:child_process";
import { isMinerPayAddress } from "./knownMiners.js";
import { classifyTxShape, TX_SHAPE_RULES_VERSION, minerFeeFromOutputs, type ShapeBox } from "./txShape.js";
import {
  maybeBackfillMintArtwork,
  maybeBackfillNftKindFromRegs,
  maybeBackfillTokenNamesFromRegs,
  maybeRetryTokenMetaAfterRegs,
} from "./tokenNamesFromRegs.js";
import {
  maybeBackfillTokenIssuance,
  tokenRowFromOutputAsset,
} from "./tokenIssuance.js";
import { maybeBackfillAddressTxSpends } from "./addressTxSpendBackfill.js";
import { headerBytesFromNode, maybeBackfillBlockHeaders } from "./headerBackfill.js";
import { maybeBackfillBlockSections, sectionBytesFromBlock } from "./sectionBackfill.js";
import { maybeBackfillInputProofs, spendingProofHex } from "./inputProofBackfill.js";
import { maybeWriteLithosFinds } from "./lithosFind.js";
import {
  longAddressTxSlotEnabled,
  maybeBackfillLongAddressTx,
} from "./addressTxLong.js";
import {
  bumpGixNextAfterUnwind,
  gixBackfillEnabled,
  maybeBackfillGix,
  stampBoxGix,
  stampTxGix,
} from "./gix.js";
import { maybeBackfillBoxRegisters } from "./regsBackfill.js";
import { maybeBackfillRentCollected } from "./rentCollected.js";
import { createBlockPrefetch } from "./blockPrefetch.js";
import {
  addressesForBoxIds,
  bumpTokensForBoxes,
  insertBoxAssetsMany,
  insertBoxesMany,
  insertTransactionsMany,
  markSpentMany,
  upsertAddressTxMany,
  upsertTokensMany,
  upsertTxInputs,
  type AddressTxRow,
  type AssetInsertRow,
  type BoxInsertRow,
  type SpendMark,
  type TokenUpsertRow,
  type TxInsertRow,
} from "./batchSql.js";

const NODE = (process.env.ERGO_NODE_URL || "http://127.0.0.1:9053").replace(
  /\/$/,
  ""
);
const POLL_MS = Number(process.env.POLL_MS || 8000);
const BACKFILL_DEPTH = Number(process.env.BACKFILL_DEPTH || 5000);
const DEEPEN_DEPTH = Number(process.env.DEEPEN_DEPTH || 25000);
const MAX_PER_TICK = Number(process.env.MAX_PER_TICK || 25);
const DEEPEN_PER_TICK = Number(process.env.DEEPEN_PER_TICK || 12);
const PREFETCH_BLOCKS = Math.min(
  8,
  Math.max(1, Math.trunc(Number(process.env.PREFETCH_BLOCKS || 3)) || 3)
);
/** Tip-only reorg. Stop before genesis / the rest of the window. */
const TIP_UNWIND_CAP = 32;
/** Multi-row SQL for the whole height. 0 = old per-row / per-tx path. */
const BATCH_SQL =
  process.env.BATCH_SQL !== "0" && process.env.BATCH_SQL !== "false";
const MIN_DISK_FREE_GB = Number(process.env.MIN_DISK_FREE_GB || 8);
const ENABLED =
  process.env.INDEXER_ENABLED === "1" || process.env.INDEXER_ENABLED === "true";
const REPAIR_SPENDS =
  process.env.REPAIR_SPENDS === "1" || process.env.REPAIR_SPENDS === "true";
const REPAIR_ADDRESSES =
  process.env.REPAIR_ADDRESSES === "1" ||
  process.env.REPAIR_ADDRESSES === "true";
const REPAIR_OUTPUT_INDEX =
  process.env.REPAIR_OUTPUT_INDEX === "1" ||
  process.env.REPAIR_OUTPUT_INDEX === "true";
/** Per-tick budget for filling boxes.output_index (node hydrate + height re-walk). */
const OUTPUT_INDEX_PER_TICK = Number(process.env.OUTPUT_INDEX_PER_TICK || 40);
const ENRICH_TOKENS =
  process.env.ENRICH_TOKENS !== "0" && process.env.ENRICH_TOKENS !== "false";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
/** Any mode. Both 0 = every tick. EVERY_N=1 and MS=0 also every tick (rollback). */
const TOKEN_STATS_EVERY_N = envInt("TOKEN_STATS_EVERY_N", 5);
const TOKEN_STATS_MS = envInt("TOKEN_STATS_MS", 60_000);
/** Full writeListSnapshots while minH > genesis. After tip, always snap. 0 = every tick. */
const LIST_SNAP_MS = envInt("LIST_SNAP_MS", 60_000);
/**
 * After genesis only. While history remains, catalog seed and per-tx
 * applyTokenSpends/Credits are off (same as address_summary).
 * throttleDue is byN || byMs — the more frequent wins.
 */
const TOKEN_STATS_CATCHUP_MULT = Math.max(
  1,
  envInt("TOKEN_STATS_CATCHUP_MULT", 6)
);
/** Backfill only. Cap 0 = all pending; N 0 = every backfill tick. */
const BACKFILL_SUMMARY_CAP = envInt("BACKFILL_SUMMARY_CAP", 40);
const BACKFILL_SUMMARY_EVERY_N = envInt("BACKFILL_SUMMARY_EVERY_N", 5);
/** Tip UPSERT + long-P2S repair. Seed still only if address_summary_v2 missing. */
const SKIP_ADDRESS_SUMMARY =
  process.env.SKIP_ADDRESS_SUMMARY === "1" ||
  process.env.SKIP_ADDRESS_SUMMARY === "true";

type Pool = ReturnType<typeof createPool>;
type Client = pg.PoolClient;
type Queryable = { query: pg.Pool["query"] };

/**
 * Packed address_tx is keyed by addr_id, not the address text.
 * 8000 matches the checksum cap. The text summary btree still stops at 2000;
 * longer addresses bump address_summary_long.
 */
const MAX_ADDRESS_TX_LEN = 8000;

type NodeTx = {
  id?: string;
  size?: number;
  inputs?: Array<{
    boxId?: string;
    value?: number | string;
    address?: string;
    spendingProof?: { proofBytes?: string; extension?: Record<string, string> };
  }>;
  dataInputs?: Array<{ boxId?: string }>;
  outputs?: Array<{
    boxId?: string;
    value?: number | string;
    ergoTree?: string;
    address?: string;
    /** Declared creation height on the box (≠ block inclusion height). */
    creationHeight?: number;
    /** Node field — output index in this tx (do not invent). */
    index?: number;
    assets?: Array<{ tokenId?: string; amount?: number | string }>;
    additionalRegisters?: Record<string, unknown>;
    registers?: Record<string, unknown>;
  }>;
};

type NodeFullBlock = {
  header?: {
    id?: string;
    height?: number;
    timestamp?: number;
    parentId?: string;
    difficulty?: string | number;
    powSolutions?: { pk?: string; w?: string; n?: string; d?: number | string };
    version?: number;
    nBits?: number | string;
    votes?: string | number[];
    stateRoot?: string;
    adProofsRoot?: string;
    transactionsRoot?: string;
    extensionHash?: string;
  };
  blockTransactions?: {
    size?: number;
    transactions?: NodeTx[];
  };
  extension?: { headerId?: string; fields?: unknown };
  adProofs?: unknown;
};

type FetchedBlock = {
  headerId: string;
  block: NodeFullBlock;
};

/** Headers exist at height, none with parentId = our indexed parent. */
class TipForkError extends Error {
  readonly kind = "fork" as const;
  constructor(
    readonly height: number,
    readonly wantParent: string,
    readonly headerIds: string[]
  ) {
    super(`no header at ${height} with parent ${wantParent}`);
    this.name = "TipForkError";
  }
}

function isRetryableFetch(e: unknown): boolean {
  if (e instanceof TipForkError) return false;
  const s = String(e);
  return (
    /node 5\d\d/.test(s) ||
    /node 429/.test(s) ||
    /timeout/i.test(s) ||
    /aborted/i.test(s) ||
    /ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(s)
  );
}

/** Exact integer string — LP/token raw and nanoERG must not pass through JS Number. */
function exactIntStr(v: unknown): string {
  if (v == null || v === "") return "0";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "0";
    return String(Math.trunc(v));
  }
  const s = String(v).trim();
  if (!s) return "0";
  if (/^-?\d+$/.test(s)) return s;
  const intPart = s.split(".")[0] ?? "0";
  return /^-?\d+$/.test(intPart) ? intPart : "0";
}

async function loadInputShapeBoxes(
  client: Client,
  ids: string[]
): Promise<ShapeBox[]> {
  if (!ids.length) return [];
  const boxes = textChainBoxesEnabled()
    ? await client.query<{
        box_id: string;
        ergo_tree: string | null;
        address: string | null;
      }>(`SELECT box_id, ergo_tree, address FROM boxes WHERE box_id = ANY($1::text[])`, [ids])
    : { rows: [] as { box_id: string; ergo_tree: string | null; address: string | null }[] };
  const assets = textChainBoxesEnabled()
    ? await client.query<{
        box_id: string;
        token_id: string;
        amount: string;
      }>(
        `SELECT box_id, token_id, amount::text AS amount FROM box_assets WHERE box_id = ANY($1::text[])`,
        [ids]
      )
    : { rows: [] as { box_id: string; token_id: string; amount: string }[] };
  const have = new Set(boxes.rows.map((r) => r.box_id));
  const missing = ids.filter((id) => !have.has(id) && /^[0-9a-fA-F]{64}$/.test(id));
  if (missing.length) {
    const packedBoxes = await client.query<{
      box_id: string;
      ergo_tree: string | null;
      address: string | null;
    }>(
      `SELECT encode(b.box_id, 'hex') AS box_id, sc.ergo_tree, ad.address
         FROM packed.boxes b
         LEFT JOIN packed.addr ad ON ad.id = b.addr_id
         LEFT JOIN packed.script sc ON sc.id = b.script_id
        WHERE b.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
      [missing]
    );
    boxes.rows.push(...packedBoxes.rows);
    const packedAssets = await client.query<{
      box_id: string;
      token_id: string;
      amount: string;
    }>(
      `SELECT encode(box_id, 'hex') AS box_id, encode(token_id, 'hex') AS token_id,
              amount::text AS amount
         FROM packed.box_assets
        WHERE box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
      [missing]
    );
    assets.rows.push(...packedAssets.rows);
  }
  const byId = new Map<string, ShapeBox>();
  for (const id of ids) byId.set(id, { ergoTree: null, address: null, assets: [] });
  for (const r of boxes.rows) {
    byId.set(r.box_id, { ergoTree: r.ergo_tree, address: r.address, assets: [] });
  }
  for (const a of assets.rows) {
    const row = byId.get(a.box_id);
    if (!row) continue;
    row.assets = row.assets ?? [];
    row.assets.push({ tokenId: a.token_id, amount: a.amount });
  }
  return ids.map((id) => byId.get(id) ?? { assets: [] });
}

function outputShapeBoxes(tx: NodeTx): ShapeBox[] {
  return (tx.outputs ?? []).map((o) => ({
    ergoTree: o.ergoTree ?? null,
    address: o.address ?? null,
    assets: (o.assets ?? []).map((a) => ({
      tokenId: a.tokenId ?? null,
      amount: a.amount ?? null,
    })),
  }));
}

function registersJson(o: {
  additionalRegisters?: Record<string, unknown>;
  registers?: Record<string, unknown>;
}): string | null {
  const r = o.additionalRegisters ?? o.registers;
  if (!r || typeof r !== "object") return null;
  try {
    return JSON.stringify(r);
  } catch {
    return null;
  }
}

/** ergoTree → address (node utils); process-local cache. */
const treeAddrCache = new Map<string, string | null>();

/** Large ints as strings — LP/token raw must not pass through JS Number. */
function parseErgoJson<T>(text: string): T {
  const quoted = text.replace(
    /([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
    '$1"$2"'
  );
  return JSON.parse(quoted) as T;
}

async function nodeGet<T>(path: string, timeoutMs = 12000): Promise<T> {
  const res = await fetch(`${NODE}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`node ${res.status} ${path}`);
  const text = await res.text();
  return parseErgoJson<T>(text);
}

async function nodePost<T>(
  path: string,
  body: unknown,
  timeoutMs = 8000
): Promise<T> {
  const res = await fetch(`${NODE}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    // Always JSON-encode (ergoTree must be a JSON string: "0008cd…")
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`node ${res.status} ${path}`);
  const text = await res.text();
  return parseErgoJson<T>(text);
}

async function ergoTreeToAddress(tree: string | null | undefined): Promise<string | null> {
  if (!tree) return null;
  if (treeAddrCache.has(tree)) return treeAddrCache.get(tree) ?? null;
  let addr: string | null = null;
  try {
    // Prefer POST body — trees can be long for scripts
    const r = await nodePost<{ address?: string }>(
      "/utils/ergoTreeToAddress",
      tree,
      5000
    );
    addr = r.address ?? null;
  } catch {
    try {
      const r = await nodeGet<{ address?: string }>(
        `/utils/ergoTreeToAddress/${tree}`,
        5000
      );
      addr = r.address ?? null;
    } catch {
      addr = null;
    }
  }
  treeAddrCache.set(tree, addr);
  return addr;
}

async function resolveOutputAddress(o: {
  address?: string;
  ergoTree?: string;
}): Promise<string | null> {
  if (o.address) return o.address;
  return ergoTreeToAddress(o.ergoTree);
}

async function getState(pool: Pool, key: string): Promise<string | null> {
  const r = await pool.query("SELECT value FROM indexer_state WHERE key = $1", [
    key,
  ]);
  return r.rows[0]?.value ?? null;
}

async function setState(pool: Pool, key: string, value: string) {
  await pool.query(
    `INSERT INTO indexer_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

async function tipHeight(): Promise<number> {
  const info = await nodeGet<{
    fullHeight?: number;
    headersHeight?: number;
  }>("/info", 5000);
  return Number(info.fullHeight ?? info.headersHeight ?? 0);
}

async function nodeInfo(): Promise<{
  fullHeight: number;
  bestFullHeaderId: string | null;
}> {
  const info = await nodeGet<{
    fullHeight?: number;
    headersHeight?: number;
    bestFullHeaderId?: string;
  }>("/info", 5000);
  return {
    fullHeight: Number(info.fullHeight ?? info.headersHeight ?? 0),
    bestFullHeaderId:
      typeof info.bestFullHeaderId === "string" && info.bestFullHeaderId
        ? info.bestFullHeaderId
        : null,
  };
}

/** Mark box spent. Missing creation: tx_inputs only, no stub row. */
async function markSpent(
  client: Queryable,
  boxId: string,
  spentTxId: string,
  spentHeight: number,
  valueHint?: number
) {
  await upsertTxInputs(client, [{ boxId, spentTxId, spentHeight, valueHint }]);
  await client.query(
    `UPDATE boxes
     SET spent_tx_id = $2, spent_height = $3
     WHERE box_id = $1`,
    [boxId, spentTxId, spentHeight]
  );
}

async function bumpTokensForBox(
  client: Queryable,
  boxId: string,
  height: number
): Promise<void> {
  await client.query(
    `UPDATE tokens t
     SET last_height = CASE
       WHEN t.last_height IS NULL THEN $2
       ELSE GREATEST(t.last_height, $2)
     END
     FROM box_assets a
     WHERE a.box_id = $1 AND a.token_id = t.token_id`,
    [boxId, height]
  );
}

async function sumBoxValues(
  client: Client,
  boxIds: string[]
): Promise<number | null> {
  if (!boxIds.length) return 0;
  const r = await client.query<{ s: string }>(
    `SELECT COALESCE(SUM(value_nano), 0)::text AS s FROM boxes WHERE box_id = ANY($1::text[])`,
    [boxIds]
  );
  const found = await client.query(
    `SELECT count(*)::int AS c FROM boxes WHERE box_id = ANY($1::text[])`,
    [boxIds]
  );
  if (found.rows[0].c < boxIds.length) return null; // incomplete
  return Number(r.rows[0].s);
}

async function pickMinerPayAddress(
  tx: NodeTx | undefined
): Promise<string | null> {
  if (!tx?.outputs?.length) return null;
  let best: string | null = null;
  let bestVal = -1;
  for (const o of tx.outputs) {
    const address = await resolveOutputAddress(o);
    if (!address || !isMinerPayAddress(address)) continue;
    const value = Number(o.value ?? 0);
    if (value > bestVal) {
      bestVal = value;
      best = address;
    }
  }
  return best;
}

/** +1 = tip catch-up (link to height-1); -1 = deepen (parent of height+1). */
let chainWalkDir: 1 | -1 = 1;
const fetchJobs = new Map<number, Promise<FetchedBlock | null>>();
const recentChain = new Map<number, { id: string; parentId: string | null }>();
let chainEpoch = 0;

function rememberChain(height: number, fetched: FetchedBlock | null): void {
  if (!fetched) return;
  recentChain.set(height, {
    id: fetched.headerId,
    parentId: fetched.block.header?.parentId ?? null,
  });
  while (recentChain.size > 64) {
    const k = recentChain.keys().next().value;
    if (k == null) break;
    recentChain.delete(k);
  }
}

function dropChainFrom(height: number): void {
  chainEpoch++;
  const lo = Math.trunc(height);
  for (const k of [...recentChain.keys()]) {
    if (k >= lo) recentChain.delete(k);
  }
  for (const k of [...fetchJobs.keys()]) {
    if (k >= lo) fetchJobs.delete(k);
  }
}

async function indexedBlockAt(
  pool: Pool,
  height: number
): Promise<{ id: string; parent_id: string | null } | null> {
  if (packedWriteEnabled()) {
    const packed = await pool.query<{ id: string; parent_id: string | null }>(
      `SELECT encode(id, 'hex') AS id, encode(parent_id, 'hex') AS parent_id
         FROM packed.blocks WHERE height = $1`,
      [height]
    );
    if (packed.rows[0]) return packed.rows[0];
  }
  if (!textChainHeadersEnabled()) return null;
  const r = await pool.query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM blocks WHERE height = $1`,
    [height]
  );
  return r.rows[0] ?? null;
}

async function fetchBlockById(headerId: string): Promise<FetchedBlock> {
  const block = await nodeGet<NodeFullBlock>(`/blocks/${headerId}`, 20000);
  if (block.header?.height == null || !Number.isFinite(Number(block.header.height))) {
    throw new Error(`node block ${headerId} has no height`);
  }
  return { headerId, block };
}

function isNode404(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("node 404 ");
}

/** Parent of a header. A block id the node has already dropped (404) is not a parent. */
async function headerParentId(id: string): Promise<string | undefined> {
  try {
    const hdr = await nodeGet<{ parentId?: string }>(`/blocks/${id}/header`, 8000);
    return hdr.parentId;
  } catch (e) {
    try {
      const full = await nodeGet<NodeFullBlock>(`/blocks/${id}`, 20000);
      return full.header?.parentId;
    } catch (e2) {
      if (isNode404(e) && isNode404(e2)) return undefined;
      throw e2;
    }
  }
}

/** Best-chain header at `height`, when the node tip is at most one unwind window ahead. */
async function canonicalHeaderId(height: number): Promise<string | null> {
  const info = await nodeInfo();
  const tip = info.fullHeight;
  const best = info.bestFullHeaderId;
  if (!best || !Number.isFinite(tip) || tip < height) return null;
  if (tip - height > TIP_UNWIND_CAP) return null;
  let id = best;
  for (let h = tip; h > height; h--) {
    const parent = await headerParentId(id);
    if (!parent) return null;
    id = parent;
  }
  return id;
}

async function fetchBlockLinked(
  height: number,
  parentId: string
): Promise<FetchedBlock | null> {
  const ids = await nodeGet<string[]>(`/blocks/at/${height}`, 8000);
  if (!ids.length) return null;
  const matched: string[] = [];
  for (const id of ids) {
    const pid = await headerParentId(id);
    if (pid && pid.toLowerCase() === parentId.toLowerCase()) matched.push(id);
  }
  if (!matched.length) throw new TipForkError(height, parentId, ids);
  const canon = await canonicalHeaderId(height);
  if (canon) {
    const hit = matched.find((id) => id.toLowerCase() === canon.toLowerCase());
    if (!hit) throw new TipForkError(height, parentId, ids);
    return fetchBlockById(hit);
  }
  return fetchBlockById(matched[0]);
}

async function lastPlusOneLink(
  pool: Pool,
  last: number
): Promise<"ok" | "empty" | "fork"> {
  const ids = await nodeGet<string[]>(`/blocks/at/${last + 1}`, 8000);
  if (!ids.length) return "empty";
  const prev = await indexedBlockAt(pool, last);
  if (!prev?.id) return "ok";
  const want = prev.id.toLowerCase();
  let linked = false;
  const foreign = new Set<string>();
  for (const id of ids) {
    const pid = await headerParentId(id);
    if (pid && pid.toLowerCase() === want) linked = true;
    else foreign.add(id.toLowerCase());
  }
  if (!linked) return "fork";
  const canon = await canonicalHeaderId(last + 1);
  if (canon) {
    const canonParent = await headerParentId(canon);
    if (canonParent && canonParent.toLowerCase() !== want) return "fork";
    return "ok";
  }
  // Far behind the node: a sibling that already has its own child is the
  // chain to follow. Our header is then a side branch, even if it also has one.
  if (!foreign.size) return "ok";
  const further = await nodeGet<string[]>(`/blocks/at/${last + 2}`, 8000);
  for (const id of further) {
    const pid = await headerParentId(id);
    if (pid && foreign.has(pid.toLowerCase())) return "fork";
  }
  return "ok";
}

async function fetchBlockAtHeightOnce(
  pool: Pool,
  height: number
): Promise<FetchedBlock | null> {
  const nextDb = await indexedBlockAt(pool, height + 1);
  if (nextDb?.parent_id) {
    const fetched = await fetchBlockById(nextDb.parent_id);
    if (Number(fetched.block.header?.height) !== height) {
      throw new Error(
        `parent of ${height + 1} is height ${fetched.block.header?.height}, not ${height}`
      );
    }
    return fetched;
  }
  const prevDb = await indexedBlockAt(pool, height - 1);
  if (prevDb?.id) return fetchBlockLinked(height, prevDb.id);

  if (chainWalkDir === 1) {
    await Promise.resolve();
    const prevJob = fetchJobs.get(height - 1);
    if (prevJob) {
      const prev = await prevJob;
      if (prev) return fetchBlockLinked(height, prev.headerId);
    }
    const prevMem = recentChain.get(height - 1);
    if (prevMem) return fetchBlockLinked(height, prevMem.id);
    const info = await nodeInfo();
    if (info.fullHeight === height && info.bestFullHeaderId) {
      return fetchBlockById(info.bestFullHeaderId);
    }
  } else {
    await Promise.resolve();
    const nextJob = fetchJobs.get(height + 1);
    if (nextJob) {
      const next = await nextJob;
      const pid = next?.block.header?.parentId;
      if (pid) return fetchBlockById(pid);
    }
    const nextMem = recentChain.get(height + 1);
    if (nextMem?.parentId) return fetchBlockById(nextMem.parentId);
  }

  const ids = await nodeGet<string[]>(`/blocks/at/${height}`, 8000);
  if (ids.length === 1) return fetchBlockById(ids[0]);
  if (!ids.length) return null;
  throw new Error(`ambiguous headers at ${height} without a chain neighbor`);
}

function fetchBlockAtHeight(
  pool: Pool,
  height: number
): Promise<FetchedBlock | null> {
  const h = Math.trunc(height);
  const existing = fetchJobs.get(h);
  if (existing) return existing;
  const epoch = chainEpoch;
  let job!: Promise<FetchedBlock | null>;
  job = fetchBlockAtHeightOnce(pool, h)
    .then((fetched) => {
      if (epoch === chainEpoch) rememberChain(h, fetched);
      return fetched;
    })
    .finally(() => {
      if (fetchJobs.get(h) === job) fetchJobs.delete(h);
    });
  fetchJobs.set(h, job);
  return job;
}

function prefetchWindow(
  start: number,
  dir: 1 | -1,
  n: number,
  lo: number,
  hi: number
): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = start + i * dir;
    if (h < lo || h > hi) break;
    out.push(h);
  }
  return out;
}

async function takePrefetched(
  prefetch: ReturnType<typeof createBlockPrefetch<FetchedBlock | null>>,
  height: number
): Promise<FetchedBlock | null> {
  try {
    return await prefetch.take(height);
  } catch (e) {
    if (!isRetryableFetch(e)) throw e;
    console.warn(`[indexer] prefetch ${height} retry`, String(e));
    return await prefetch.take(height);
  }
}

/**
 * Per-tx path when BATCH_SQL=0. Prefer indexHeightBatched (whole height).
 */
async function indexTxBatched(
  client: Client,
  tx: NodeTx,
  indexInBlock: number,
  height: number,
  timestampMs: number,
  tokenStats: boolean
): Promise<AddressTxRow[]> {
  const txId = tx.id;
  if (!txId) return [];

  const inputIds = (tx.inputs ?? [])
    .map((inp) => inp.boxId)
    .filter((x): x is string => !!x);

  if (tokenStats) await applyTokenSpends(client, inputIds, txId, height);

  const spends: SpendMark[] = [];
  for (const inp of tx.inputs ?? []) {
    if (!inp.boxId) continue;
    const hint =
      inp.value != null && Number(inp.value) > 0
        ? Number(inp.value)
        : undefined;
    spends.push({
      boxId: inp.boxId,
      spentTxId: txId,
      spentHeight: height,
      valueHint: hint,
      proofHex: spendingProofHex(inp.spendingProof?.proofBytes),
    });
  }
  await markSpentMany(client, spends);
  if (tokenStats) {
    await bumpTokensForBoxes(
      client,
      spends.map((s) => s.boxId),
      height
    );
  }

  const outSum = (tx.outputs ?? []).reduce(
    (s, o) => s + Number(o.value ?? 0),
    0
  );
  const fee = minerFeeFromOutputs(tx.outputs ?? []);

  const inCount = (tx.inputs ?? []).length;
  const outCount = (tx.outputs ?? []).length;
  const inputBoxes = await loadInputShapeBoxes(client, inputIds);
  const shaped = classifyTxShape({
    coinbase: indexInBlock === 0,
    inputs: inputBoxes,
    outputs: outputShapeBoxes(tx),
  });
  const txRow: TxInsertRow = {
    id: txId,
    height,
    timestampMs,
    size: tx.size ?? null,
    fee,
    indexInBlock,
    inputCount: inCount,
    outputCount: outCount,
    valueNano: outSum,
    shape: shaped.shape,
    protocol: shaped.protocol,
    ruleId: shaped.ruleId,
    rulesVersion: TX_SHAPE_RULES_VERSION,
  };
  await stampTxGix(client, [txRow]);
  await insertTransactionsMany(client, [txRow]);

  const outs = tx.outputs ?? [];
  const boxRows: BoxInsertRow[] = [];
  const tokenRows: TokenUpsertRow[] = [];
  const assetRows: AssetInsertRow[] = [];
  const addrRows: AddressTxRow[] = [];
  const minted = new Set(inputIds);
  for (let oi = 0; oi < outs.length; oi++) {
    const o = outs[oi];
    const boxId = o.boxId;
    if (!boxId) continue;
    const address = await resolveOutputAddress(o);
    const outputIndex =
      o.index != null && Number.isFinite(Number(o.index))
        ? Number(o.index)
        : oi;
    const creationHeight =
      o.creationHeight != null && Number.isFinite(Number(o.creationHeight))
        ? Number(o.creationHeight)
        : height;
    boxRows.push({
      boxId,
      creationHeight,
      valueNano: exactIntStr(o.value),
      ergoTree: o.ergoTree ?? null,
      address,
      creationTxId: txId,
      outputIndex,
      registers: registersJson(o),
    });
    for (const a of o.assets ?? []) {
      if (!a.tokenId) continue;
      const amt = exactIntStr(a.amount);
      tokenRows.push(
        tokenRowFromOutputAsset({
          tokenId: a.tokenId,
          boxId,
          height,
          amount: amt,
          registers: o.additionalRegisters ?? o.registers,
          issuance: minted.has(a.tokenId),
        })
      );
      assetRows.push({ boxId, tokenId: a.tokenId, amount: amt });
    }
    if (address && address.length <= MAX_ADDRESS_TX_LEN) {
      addrRows.push({ address, txId, height });
    }
  }

  await stampBoxGix(client, boxRows);
  await insertBoxesMany(client, boxRows);
  await upsertTokensMany(client, tokenRows);
  const freshAssets = await insertBoxAssetsMany(client, assetRows);
  if (chainWalkDir === 1) {
    for (const a of freshAssets) {
      if (a.tokenId === ERG_USD_ORACLE_NFT && a.amount === "1") {
        await rememberOracleBox(client, a.boxId);
      }
    }
  }
  if (tokenStats) await applyTokenCredits(client, freshAssets, txId, height);

  const prevById = await addressesForBoxIds(client, inputIds);
  for (const inp of tx.inputs ?? []) {
    if (!inp.boxId) continue;
    const a = prevById.get(inp.boxId);
    if (a && a.length <= MAX_ADDRESS_TX_LEN) {
      addrRows.push({ address: a, txId, height });
    }
  }
  return addrRows;
}

/** One COMMIT's worth of txs: inputs → txs → boxes JOIN tx_inputs. */
async function writeHeightRows(
  client: Client,
  height: number,
  timestampMs: number,
  txs: NodeTx[],
  tokenStats: boolean
): Promise<AddressTxRow[]> {
  const spends: SpendMark[] = [];
  const txRows: TxInsertRow[] = [];
  const boxRows: BoxInsertRow[] = [];
  const tokenRows: TokenUpsertRow[] = [];
  const assetRows: AssetInsertRow[] = [];
  const addrRows: AddressTxRow[] = [];
  const produced = new Map<string, ShapeBox & { address?: string | null }>();
  const allInputIds: string[] = [];
  for (const tx of txs) {
    for (const inp of tx.inputs ?? []) {
      if (inp.boxId) allInputIds.push(inp.boxId);
    }
  }
  const uniqInputs = [...new Set(allInputIds)];
  const dbShapes = await loadInputShapeBoxes(client, uniqInputs);
  const dbById = new Map<string, ShapeBox>();
  for (let i = 0; i < uniqInputs.length; i++) {
    dbById.set(uniqInputs[i], dbShapes[i] ?? { assets: [] });
  }

  if (tokenStats) {
    for (const tx of txs) {
      const txId = tx.id;
      if (!txId) continue;
      const inputIds = (tx.inputs ?? [])
        .map((inp) => inp.boxId)
        .filter((x): x is string => !!x);
      await applyTokenSpends(client, inputIds, txId, height);
    }
  }

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const txId = tx.id;
    if (!txId) continue;
    const inputIds = (tx.inputs ?? [])
      .map((inp) => inp.boxId)
      .filter((x): x is string => !!x);
    for (const inp of tx.inputs ?? []) {
      if (!inp.boxId) continue;
      const hint =
        inp.value != null && Number(inp.value) > 0
          ? Number(inp.value)
          : undefined;
      spends.push({
        boxId: inp.boxId,
        spentTxId: txId,
        spentHeight: height,
        valueHint: hint,
        proofHex: spendingProofHex(inp.spendingProof?.proofBytes),
      });
    }
    const inputBoxes = inputIds.map(
      (id) => produced.get(id) ?? dbById.get(id) ?? { assets: [] }
    );
    const shaped = classifyTxShape({
      coinbase: i === 0,
      inputs: inputBoxes,
      outputs: outputShapeBoxes(tx),
    });
    const outSum = (tx.outputs ?? []).reduce(
      (s, o) => s + Number(o.value ?? 0),
      0
    );
    txRows.push({
      id: txId,
      height,
      timestampMs,
      size: tx.size ?? null,
      fee: minerFeeFromOutputs(tx.outputs ?? []),
      indexInBlock: i,
      inputCount: (tx.inputs ?? []).length,
      outputCount: (tx.outputs ?? []).length,
      valueNano: outSum,
      shape: shaped.shape,
      protocol: shaped.protocol,
      ruleId: shaped.ruleId,
      rulesVersion: TX_SHAPE_RULES_VERSION,
    });
    const outs = tx.outputs ?? [];
    const minted = new Set(inputIds);
    for (let oi = 0; oi < outs.length; oi++) {
      const o = outs[oi];
      const boxId = o.boxId;
      if (!boxId) continue;
      const address = await resolveOutputAddress(o);
      const outputIndex =
        o.index != null && Number.isFinite(Number(o.index))
          ? Number(o.index)
          : oi;
      const creationHeight =
        o.creationHeight != null && Number.isFinite(Number(o.creationHeight))
          ? Number(o.creationHeight)
          : height;
      boxRows.push({
        boxId,
        creationHeight,
        valueNano: exactIntStr(o.value),
        ergoTree: o.ergoTree ?? null,
        address,
        creationTxId: txId,
        outputIndex,
        registers: registersJson(o),
      });
      const assets = (o.assets ?? []).map((a) => ({
        tokenId: a.tokenId ?? null,
        amount: a.amount ?? null,
      }));
      produced.set(boxId, {
        ergoTree: o.ergoTree ?? null,
        address,
        assets,
      });
      for (const a of o.assets ?? []) {
        if (!a.tokenId) continue;
        const amt = exactIntStr(a.amount);
        tokenRows.push(
          tokenRowFromOutputAsset({
            tokenId: a.tokenId,
            boxId,
            height,
            amount: amt,
            registers: o.additionalRegisters ?? o.registers,
            issuance: minted.has(a.tokenId),
          })
        );
        assetRows.push({ boxId, tokenId: a.tokenId, amount: amt });
      }
      if (address && address.length <= MAX_ADDRESS_TX_LEN) {
        addrRows.push({ address, txId, height });
      }
    }
  }

  await markSpentMany(client, spends);
  if (tokenStats) {
    await bumpTokensForBoxes(
      client,
      spends.map((s) => s.boxId),
      height
    );
  }
  await stampTxGix(client, txRows);
  await stampBoxGix(client, boxRows);
  await insertTransactionsMany(client, txRows);
  await insertBoxesMany(client, boxRows);
  await upsertTokensMany(client, tokenRows);
  const freshAssets = await insertBoxAssetsMany(client, assetRows);
  if (chainWalkDir === 1) {
    for (const a of freshAssets) {
      if (a.tokenId === ERG_USD_ORACLE_NFT && a.amount === "1") {
        await rememberOracleBox(client, a.boxId);
      }
    }
  }
  if (tokenStats) {
    const boxTx = new Map(boxRows.map((b) => [b.boxId, b.creationTxId]));
    const byTx = new Map<string, AssetInsertRow[]>();
    for (const a of freshAssets) {
      const txId = boxTx.get(a.boxId);
      if (!txId) continue;
      const list = byTx.get(txId);
      if (list) list.push(a);
      else byTx.set(txId, [a]);
    }
    for (const [txId, rows] of byTx) {
      await applyTokenCredits(client, rows, txId, height);
    }
  }
  const prevById = await addressesForBoxIds(client, uniqInputs);
  for (const tx of txs) {
    const txId = tx.id;
    if (!txId) continue;
    for (const inp of tx.inputs ?? []) {
      if (!inp.boxId) continue;
      const a =
        produced.get(inp.boxId)?.address ?? prevById.get(inp.boxId) ?? null;
      if (a && a.length <= MAX_ADDRESS_TX_LEN) {
        addrRows.push({ address: a, txId, height });
      }
    }
  }
  return addrRows;
}

export async function indexHeight(
  pool: Pool,
  height: number,
  prefetched?: FetchedBlock | null,
  opts?: { tokenStats?: boolean }
): Promise<string[]> {
  const tokenStats = opts?.tokenStats !== false;
  const fetched =
    prefetched === undefined ? await fetchBlockAtHeight(pool, height) : prefetched;
  if (!fetched) {
    throw new Error(`no block at ${height}`);
  }
  const id = fetched.headerId;
  const full = fetched.block;

  const h = full.header;
  if (h?.height == null || Number(h.height) !== height) {
    throw new Error(
      `block at ${height} has header.height=${h?.height ?? "none"}`
    );
  }
  const ts = Number(h.timestamp ?? 0);
  const txs = full.blockTransactions?.transactions ?? [];
  const minerPk =
    typeof h.powSolutions?.pk === "string" && h.powSolutions.pk.trim()
      ? h.powSolutions.pk.trim()
      : null;
  const minerAddress =
    (await pickMinerPayAddress(txs[0])) ??
    (await pickMinerPayAddress(txs.find((tx) => !(tx.inputs ?? []).length)));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const blockId = h.id ?? id;
    const existed = textChainHeadersEnabled()
      ? await client.query<{ id: string }>(
          `SELECT id FROM blocks WHERE height = $1 FOR UPDATE`,
          [h.height]
        )
      : { rows: [] as { id: string }[] };
    if (existed.rows[0] && existed.rows[0].id !== blockId) {
      throw new Error(
        `block id conflict at ${h.height}: have ${existed.rows[0].id} want ${blockId}; unwind first`
      );
    }
    if (!existed.rows[0] && packedWriteEnabled()) {
      const packedHave = await client.query<{ id: string }>(
        `SELECT encode(id, 'hex') AS id FROM packed.blocks WHERE height = $1`,
        [h.height]
      );
      if (packedHave.rows[0] && packedHave.rows[0].id !== blockId) {
        throw new Error(
          `block id conflict at packed ${h.height}: have ${packedHave.rows[0].id} want ${blockId}; unwind first`
        );
      }
    }
    const hdr = headerBytesFromNode(h);
    const sections = sectionBytesFromBlock(full);
    const headerParams = [
      h.height,
      blockId,
      ts,
      full.blockTransactions?.size ?? null,
      txs.length,
      h.difficulty != null ? String(h.difficulty) : null,
      h.parentId ?? null,
      minerPk,
      minerAddress,
      hdr.version,
      hdr.nBits,
      hdr.votes,
      hdr.stateRoot,
      hdr.adProofsRoot,
      hdr.transactionsRoot,
      hdr.extensionHash,
      hdr.powW,
      hdr.powN,
      hdr.powD,
      sections.extension,
      sections.adProofs,
    ];
    if (textChainHeadersEnabled()) {
      await client.query(
        `INSERT INTO blocks (height, id, timestamp_ms, size, tx_count, difficulty, parent_id, miner_pk, miner_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (height) DO UPDATE SET
           id = EXCLUDED.id,
           timestamp_ms = EXCLUDED.timestamp_ms,
           size = EXCLUDED.size,
           tx_count = EXCLUDED.tx_count,
           difficulty = EXCLUDED.difficulty,
           parent_id = EXCLUDED.parent_id,
           miner_pk = COALESCE(EXCLUDED.miner_pk, blocks.miner_pk),
           miner_address = COALESCE(EXCLUDED.miner_address, blocks.miner_address)
         WHERE blocks.id = EXCLUDED.id`,
        headerParams.slice(0, 9)
      );
    }
    if (packedWriteEnabled() && !textChainHeadersEnabled()) {
      await client.query(
        `INSERT INTO packed.blocks (
           height, id, parent_id, timestamp_ms, size, tx_count, difficulty,
           miner_pk, miner_address,
           version, n_bits, votes, state_root, ad_proofs_root, transactions_root,
           extension_hash, pow_w, pow_n, pow_d, extension, ad_proofs
         )
         VALUES (
           $1, packed.hex32($2), packed.hex32($7), $3, $4, $5, $6, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
         )
         ON CONFLICT (height) DO UPDATE SET
           id = EXCLUDED.id,
           parent_id = EXCLUDED.parent_id,
           timestamp_ms = EXCLUDED.timestamp_ms,
           size = EXCLUDED.size,
           tx_count = EXCLUDED.tx_count,
           difficulty = EXCLUDED.difficulty,
           miner_pk = COALESCE(EXCLUDED.miner_pk, packed.blocks.miner_pk),
           miner_address = COALESCE(EXCLUDED.miner_address, packed.blocks.miner_address),
           version = COALESCE(EXCLUDED.version, packed.blocks.version),
           n_bits = COALESCE(EXCLUDED.n_bits, packed.blocks.n_bits),
           votes = COALESCE(EXCLUDED.votes, packed.blocks.votes),
           state_root = COALESCE(EXCLUDED.state_root, packed.blocks.state_root),
           ad_proofs_root = COALESCE(EXCLUDED.ad_proofs_root, packed.blocks.ad_proofs_root),
           transactions_root = COALESCE(EXCLUDED.transactions_root, packed.blocks.transactions_root),
           extension_hash = COALESCE(EXCLUDED.extension_hash, packed.blocks.extension_hash),
           pow_w = COALESCE(EXCLUDED.pow_w, packed.blocks.pow_w),
           pow_n = COALESCE(EXCLUDED.pow_n, packed.blocks.pow_n),
           pow_d = COALESCE(EXCLUDED.pow_d, packed.blocks.pow_d),
           extension = COALESCE(EXCLUDED.extension, packed.blocks.extension),
           ad_proofs = COALESCE(EXCLUDED.ad_proofs, packed.blocks.ad_proofs)
         WHERE packed.blocks.id = EXCLUDED.id`,
        headerParams
      );
    }

    const prev = textChainHeadersEnabled()
      ? await client.query<{ id: string }>(
          `SELECT id FROM blocks WHERE height = $1`,
          [h.height - 1]
        )
      : { rows: [] as { id: string }[] };
    let prevId = prev.rows[0]?.id ?? null;
    if (!prevId && packedWriteEnabled() && h.height > 0) {
      const packedPrev = await client.query<{ id: string }>(
        `SELECT encode(id, 'hex') AS id FROM packed.blocks WHERE height = $1`,
        [h.height - 1]
      );
      prevId = packedPrev.rows[0]?.id ?? null;
    }
    if (prevId && prevId !== (h.parentId ?? null)) {
      throw new Error(
        `parent mismatch at ${h.height}: header.parentId=${h.parentId} prev.id=${prevId}`
      );
    }
    const next = textChainHeadersEnabled()
      ? await client.query<{ parent_id: string | null }>(
          `SELECT parent_id FROM blocks WHERE height = $1`,
          [h.height + 1]
        )
      : { rows: [] as { parent_id: string | null }[] };
    let nextParent = next.rows[0]?.parent_id ?? null;
    if (!next.rows[0] && packedWriteEnabled()) {
      const packedNext = await client.query<{ parent_id: string | null }>(
        `SELECT encode(parent_id, 'hex') AS parent_id FROM packed.blocks WHERE height = $1`,
        [h.height + 1]
      );
      nextParent = packedNext.rows[0]?.parent_id ?? null;
    }
    if (nextParent && nextParent !== blockId) {
      throw new Error(
        `parent mismatch at ${h.height + 1}: parent_id=${nextParent} id=${blockId}`
      );
    }

    const addrRows: AddressTxRow[] = [];
    if (BATCH_SQL) {
      addrRows.push(
        ...(await writeHeightRows(client, h.height, ts, txs, tokenStats))
      );
    } else {
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const txId = tx.id;
      if (!txId) continue;


      const inputIds = (tx.inputs ?? [])
        .map((inp) => inp.boxId)
        .filter((x): x is string => !!x);

      // Token balances before spend mark — skip already-spent (repair).
      if (tokenStats) await applyTokenSpends(client, inputIds, txId, h.height);

      // 1) Mark inputs spent (order: before creating new outputs in this tx)
      for (const inp of tx.inputs ?? []) {
        if (!inp.boxId) continue;
        const hint =
          inp.value != null && Number(inp.value) > 0
            ? Number(inp.value)
            : undefined;
        await markSpent(client, inp.boxId, txId, h.height, hint);
        if (tokenStats) await bumpTokensForBox(client, inp.boxId, h.height);
      }

      const outSum = (tx.outputs ?? []).reduce(
        (s, o) => s + Number(o.value ?? 0),
        0
      );
      const fee = minerFeeFromOutputs(tx.outputs ?? []);

      const inCount = (tx.inputs ?? []).length;
      const outCount = (tx.outputs ?? []).length;
      const inputBoxes = await loadInputShapeBoxes(client, inputIds);
      const shaped = classifyTxShape({
        coinbase: i === 0,
        inputs: inputBoxes,
        outputs: outputShapeBoxes(tx),
      });
      const oneTx: TxInsertRow = {
        id: txId,
        height: h.height,
        timestampMs: ts,
        size: tx.size ?? null,
        fee,
        indexInBlock: i,
        inputCount: inCount,
        outputCount: outCount,
        valueNano: outSum,
        shape: shaped.shape,
        protocol: shaped.protocol,
        ruleId: shaped.ruleId,
        rulesVersion: TX_SHAPE_RULES_VERSION,
      };
      await stampTxGix(client, [oneTx]);
      await insertTransactionsMany(client, [oneTx]);

      // 2) Create outputs (resolve address — node often omits it on block txs)
      const outs = tx.outputs ?? [];
      const freshAssets: { boxId: string; tokenId: string; amount: string }[] =
        [];
      for (let oi = 0; oi < outs.length; oi++) {
        const o = outs[oi];
        const boxId = o.boxId;
        if (!boxId) continue;
        const address = await resolveOutputAddress(o);
        // Prefer node `index`; array position is the same when node omits it.
        const outputIndex =
          o.index != null && Number.isFinite(Number(o.index))
            ? Number(o.index)
            : oi;
        // Fleet/Nautilus need box.creationHeight (declared), NOT block inclusion height.
        // Node often has creationHeight = inclusionHeight - 1 (or more); never use h.height alone.
        const creationHeight =
          o.creationHeight != null && Number.isFinite(Number(o.creationHeight))
            ? Number(o.creationHeight)
            : h.height;
        const regs = registersJson(o);
        const oneBox: BoxInsertRow = {
          boxId,
          creationHeight,
          valueNano: exactIntStr(o.value),
          ergoTree: o.ergoTree ?? null,
          address,
          creationTxId: txId,
          outputIndex,
          registers: regs,
        };
        await stampBoxGix(client, [oneBox]);
        await insertBoxesMany(client, [oneBox]);
        for (const a of o.assets ?? []) {
          if (!a.tokenId) continue;
          const amt = exactIntStr(a.amount);
          const tok = tokenRowFromOutputAsset({
            tokenId: a.tokenId,
            boxId,
            height: h.height,
            amount: amt,
            registers: o.additionalRegisters ?? o.registers,
            issuance: (tx.inputs ?? []).some((inp) => inp.boxId === a.tokenId),
          });
          await client.query(
            `INSERT INTO tokens (token_id, box_id, first_height, last_height, emission, decimals)
             VALUES ($1, $2, $3, $3, $4::numeric, $5::int)
             ON CONFLICT (token_id) DO UPDATE SET
               first_height = CASE
                 WHEN tokens.first_height IS NULL THEN EXCLUDED.first_height
                 WHEN EXCLUDED.first_height IS NULL THEN tokens.first_height
                 ELSE LEAST(tokens.first_height, EXCLUDED.first_height)
               END,
               last_height = CASE
                 WHEN tokens.last_height IS NULL THEN EXCLUDED.last_height
                 WHEN EXCLUDED.last_height IS NULL THEN tokens.last_height
                 ELSE GREATEST(tokens.last_height, EXCLUDED.last_height)
               END,
               box_id = COALESCE(
                 CASE WHEN EXCLUDED.box_id = tokens.token_id THEN EXCLUDED.box_id END,
                 tokens.box_id,
                 EXCLUDED.box_id
               ),
               emission = COALESCE(EXCLUDED.emission, tokens.emission),
               decimals = COALESCE(EXCLUDED.decimals, tokens.decimals)`,
            [
              tok.tokenId,
              tok.nftBoxId,
              tok.firstHeight,
              tok.emission,
              tok.decimals ?? null,
            ]
          );
          const assetIns = await client.query<{ box_id: string }>(
            `INSERT INTO box_assets (box_id, token_id, amount)
             VALUES ($1,$2,$3::numeric)
             ON CONFLICT (box_id, token_id) DO NOTHING
             RETURNING box_id`,
            [boxId, a.tokenId, amt]
          );
          if ((assetIns.rowCount ?? 0) > 0) {
            freshAssets.push({ boxId, tokenId: a.tokenId, amount: amt });
            if (chainWalkDir === 1 && a.tokenId === ERG_USD_ORACLE_NFT && amt === "1") {
              await rememberOracleBox(client, boxId);
            }
          }
        }
        // address_tx — flushed once per height
        if (address && address.length <= MAX_ADDRESS_TX_LEN) {
          addrRows.push({ address, txId, height: h.height });
        }
      }
      if (tokenStats) await applyTokenCredits(client, freshAssets, txId, h.height);
      // spent inputs → address_tx for prior owners
      for (const inp of tx.inputs ?? []) {
        if (!inp.boxId) continue;
        const prev = await client.query<{ address: string | null }>(
          `SELECT address FROM boxes WHERE box_id = $1`,
          [inp.boxId]
        );
        const a = prev.rows[0]?.address;
        if (a && a.length <= MAX_ADDRESS_TX_LEN) {
          addrRows.push({ address: a, txId, height: h.height });
        }
      }
    }
    }

    await upsertAddressTxMany(client, addrRows);

    if (textChainHeadersEnabled()) {
      await client.query(
        `UPDATE blocks
         SET fee_nano = COALESCE((SELECT SUM(fee) FROM transactions WHERE height = $1), 0),
             value_nano = COALESCE((SELECT SUM(value_nano) FROM transactions WHERE height = $1), 0)
         WHERE height = $1`,
        [h.height]
      );
    }
    if (packedWriteEnabled() && !textChainHeadersEnabled()) {
      await client.query(
        `UPDATE packed.blocks
         SET fee_nano = COALESCE((SELECT SUM(fee) FROM packed.transactions WHERE height = $1), 0),
             value_nano = COALESCE((SELECT SUM(value_nano) FROM packed.transactions WHERE height = $1), 0)
         WHERE height = $1`,
        [h.height]
      );
    }

    if (textChainBoxesEnabled()) {
      await client.query(
        `UPDATE boxes
            SET spent_tx_id = t.spent_tx_id,
                spent_height = t.spent_height
           FROM tx_inputs t
          WHERE boxes.spent_tx_id IS NULL
            AND boxes.box_id = t.box_id
            AND t.spent_height = $1`,
        [h.height]
      );
    }

    // Direct packed inserts already wrote this height. The text copy would
    // read blocks/boxes that no longer receive rows and fail once those tables go.
    if (
      packedWriteEnabled() &&
      (textChainBoxesEnabled() || textChainHeadersEnabled())
    ) {
      await writePackedHeight(client, h.height);
    }
    const touched = await touchedAddressesAtHeight(client, h.height);
    await client.query("COMMIT");
    return touched;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Re-walk [from..to] to apply spend marks (idempotent). */
async function repairSpends(pool: Pool, from: number, to: number) {
  console.log(`[indexer] REPAIR_SPENDS ${from}→${to}`);
  let n = 0;
  for (let h = from; h <= to; h++) {
    try {
      await indexHeight(pool, h);
      n++;
      if (n % 25 === 0 || h === to) {
        console.log(`[indexer] repair ${h}/${to}`);
      }
    } catch (e) {
      console.warn(`[indexer] repair ${h} failed`, String(e));
    }
  }
  await setState(pool, "last_height", String(to));
  await setState(pool, "repair_spends_done", String(Date.now()));
}

/**
 * Fill boxes.output_index from node (real `index` field — never invent 0).
 * Paths:
 *   1) Re-index heights that still have NULL output_index (block outputs carry index)
 *   2) Per-box: unspent → /utxo/byId, else → /blockchain/box/byId
 * Safe to re-run; only writes when node returns a finite index.
 */
async function fillOutputIndexFromNode(
  pool: Pool,
  boxId: string
): Promise<boolean> {
  // Prefer UTXO set (fast for spendable); fall back to blockchain history
  for (const path of [`/utxo/byId/${boxId}`, `/blockchain/box/byId/${boxId}`]) {
    try {
      const box = await nodeGet<{ index?: number }>(path, 6000);
      if (box.index == null || !Number.isFinite(Number(box.index))) continue;
      const idx = Number(box.index);
      await pool.query(
        `UPDATE boxes SET output_index = $2
         WHERE box_id = $1 AND output_index IS NULL`,
        [boxId, idx]
      );
      return true;
    } catch {
      /* try next path */
    }
  }
  // Creating tx: find output position of this boxId
  try {
    const row = await pool.query<{ creation_tx_id: string | null }>(
      `SELECT creation_tx_id FROM boxes WHERE box_id = $1`,
      [boxId]
    );
    const txId = row.rows[0]?.creation_tx_id;
    if (!txId) return false;
    const tx = await nodeGet<{
      outputs?: Array<{ boxId?: string; index?: number }>;
    }>(`/blockchain/transaction/byId/${txId}`, 10000);
    const outs = tx.outputs ?? [];
    for (let i = 0; i < outs.length; i++) {
      const o = outs[i];
      if (o.boxId !== boxId) continue;
      const idx =
        o.index != null && Number.isFinite(Number(o.index))
          ? Number(o.index)
          : i;
      await pool.query(
        `UPDATE boxes SET output_index = $2
         WHERE box_id = $1 AND output_index IS NULL`,
        [boxId, idx]
      );
      return true;
    }
  } catch {
    /* */
  }
  return false;
}

/**
 * Continuous / one-shot backfill for output_index.
 * Prefer re-walking creation heights (many boxes per block fetch), then node per-box.
 */
async function repairOutputIndex(
  pool: Pool,
  opts: { heightBudget: number; boxBudget: number; label: string }
) {
  const { heightBudget, boxBudget, label } = opts;
  let heightsDone = 0;
  let boxesFilled = 0;

  // 1) Heights with missing index — unspent first (signing path), then any
  if (heightBudget > 0) {
    const hs = await pool.query<{ creation_height: string }>(
      `SELECT creation_height::text AS creation_height FROM (
         SELECT creation_height, 0 AS prio
         FROM boxes
         WHERE output_index IS NULL AND creation_height IS NOT NULL
           AND spent_tx_id IS NULL
         GROUP BY creation_height
         UNION ALL
         SELECT creation_height, 1 AS prio
         FROM boxes
         WHERE output_index IS NULL AND creation_height IS NOT NULL
         GROUP BY creation_height
       ) x
       GROUP BY creation_height
       ORDER BY MIN(prio), creation_height DESC
       LIMIT $1`,
      [heightBudget]
    );
    for (const row of hs.rows) {
      const h = Number(row.creation_height);
      if (!Number.isFinite(h) || h <= 0) continue;
      try {
        await indexHeight(pool, h);
        heightsDone++;
      } catch (e) {
        console.warn(
          `[indexer] ${label} reindex height ${h}`,
          String(e)
        );
      }
    }
  }

  // 2) Leftover boxes (stubs without height, or reindex miss)
  if (boxBudget > 0) {
    const rows = await pool.query<{ box_id: string }>(
      `SELECT box_id FROM boxes
       WHERE output_index IS NULL
       ORDER BY
         CASE WHEN spent_tx_id IS NULL THEN 0 ELSE 1 END,
         creation_height DESC NULLS LAST
       LIMIT $1`,
      [boxBudget]
    );
    for (const row of rows.rows) {
      try {
        if (await fillOutputIndexFromNode(pool, row.box_id)) boxesFilled++;
      } catch (e) {
        console.warn(
          `[indexer] ${label} box ${row.box_id.slice(0, 12)}…`,
          String(e)
        );
      }
    }
  }

  if (heightsDone || boxesFilled) {
    // Never COUNT(*) boxes here — 2M+ NULL output_index seq-scans freeze the tip loop.
    console.log(
      `[indexer] ${label} heights=${heightsDone} boxes+=${boxesFilled}`
    );
  }
}

/**
 * Fill NULL addresses for rows that already have ergo_tree.
 * Batched; safe to re-run.
 */
async function repairAddresses(pool: Pool) {
  console.log("[indexer] REPAIR_ADDRESSES start");
  let filled = 0;
  let failed = 0;
  for (;;) {
    const r = await pool.query<{ box_id: string; ergo_tree: string }>(
      `SELECT box_id, ergo_tree FROM boxes
       WHERE (address IS NULL OR address = '')
         AND ergo_tree IS NOT NULL AND ergo_tree <> ''
       LIMIT 200`
    );
    if (!r.rows.length) break;
    let batchFail = 0;
    for (const row of r.rows) {
      try {
        const addr = await ergoTreeToAddress(row.ergo_tree);
        if (!addr) {
          failed++;
          batchFail++;
          continue;
        }
        // Huge P2S addresses may exceed btree limits; still store (partial idx skips long)
        await pool.query(
          `UPDATE boxes SET address = $2
           WHERE box_id = $1 AND (address IS NULL OR address = '')`,
          [row.box_id, addr]
        );
        filled++;
      } catch (e) {
        failed++;
        batchFail++;
        console.warn(
          `[indexer] REPAIR_ADDRESSES box ${row.box_id.slice(0, 12)}…`,
          String(e)
        );
      }
    }
    console.log(
      `[indexer] REPAIR_ADDRESSES progress filled=${filled} failed=${failed}`
    );
    // All remaining rows in this batch unconvertible — stop to avoid infinite loop
    if (batchFail === r.rows.length) break;
  }
  await setState(pool, "repair_addresses_done", String(Date.now()));
  console.log(
    `[indexer] REPAIR_ADDRESSES done filled=${filled} failed=${failed}`
  );
}

/** Root filesystem free space in GB (best-effort). */
function freeDiskGb(): number {
  try {
    const out = execSync("df -P -B1 / | awk 'NR==2{print $4}'", {
      encoding: "utf8",
    }).trim();
    const bytes = Number(out);
    if (!Number.isFinite(bytes) || bytes <= 0) return 99;
    return bytes / 1024 ** 3;
  } catch {
    return 99;
  }
}

async function indexedMinMax(pool: Pool): Promise<{ min: number; max: number }> {
  const r = await pool.query<{ mn: string | null; mx: string | null }>(
    packedWriteEnabled()
      ? `SELECT min(height)::text AS mn, max(height)::text AS mx FROM packed.blocks`
      : `SELECT min(height)::text AS mn, max(height)::text AS mx FROM blocks`
  );
  return {
    min: Number(r.rows[0]?.mn || 0),
    max: Number(r.rows[0]?.mx || 0),
  };
}

function cleanMetaText(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (t.length < 1 || t.length > 120) return null;
  const printable = [...t].filter((ch) => ch.charCodeAt(0) >= 32).length;
  if (printable / t.length < 0.85) return null;
  return t;
}

/** Best-effort artwork from issuance box registers (EIP-4). */
function pickArtFromRegs(regs: Record<string, string | null | undefined>): string | null {
  const order = ["R9", "R8", "R7", "R5"];
  for (const key of order) {
    const raw = regs[key];
    if (!raw || typeof raw !== "string") continue;
    // common: 0e + hex utf8, or plain url in decoded form from node
    let text = raw;
    if (/^0e[0-9a-fA-F]+$/i.test(raw) && raw.length > 4) {
      try {
        const hex = raw.slice(4);
        text = Buffer.from(hex, "hex").toString("utf8");
      } catch {
        continue;
      }
    }
    text = text.trim();
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith("ipfs://")) {
      return `https://ipfs.io/ipfs/${text.replace("ipfs://", "")}`;
    }
    if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(text) || /^bafy/i.test(text)) {
      return `https://ipfs.io/ipfs/${text}`;
    }
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const u = j.url || j.image || j.media || j.link;
      if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * P2-9: hydrate names + artwork from node EIP-4.
 * Prioritises amount=1 (NFT-like) without name/art.
 */
async function enrichTokenMeta(pool: Pool, budget = 24) {
  if (!ENRICH_TOKENS) return;
  // Prefer NFT-like without art, then unnamed
  const rows = await pool.query<{ token_id: string; box_id: string | null }>(
    `SELECT t.token_id, t.box_id
     FROM tokens t
     WHERE (t.name IS NULL OR t.name = '' OR t.artwork_url IS NULL)
       AND (
         t.emission = 1
         OR EXISTS (
           SELECT 1 FROM box_assets a
           JOIN boxes b ON b.box_id = a.box_id
           WHERE a.token_id = t.token_id AND a.amount = 1 AND b.spent_tx_id IS NULL
         )
         OR t.name IS NULL OR t.name = ''
       )
     ORDER BY
       CASE WHEN t.artwork_url IS NULL AND (t.emission = 1 OR t.name IS NOT NULL) THEN 0
            WHEN t.name IS NULL OR t.name = '' THEN 1
            ELSE 2 END,
       t.first_height DESC NULLS LAST
     LIMIT $1`,
    [budget]
  );
  let named = 0;
  let arts = 0;
  for (const row of rows.rows) {
    try {
      const meta = await nodeGet<{
        name?: string;
        description?: string;
        decimals?: number;
        emissionAmount?: number | string;
        boxId?: string;
      }>(`/blockchain/token/byId/${row.token_id}`, 6000);
      const name = cleanMetaText(meta.name);
      const desc = cleanMetaText(meta.description);
      // EIP-4 registers live on **issuance** box (token.byId.boxId), not holding UTXO
      const issuanceBoxId = meta.boxId || null;
      let artwork: string | null = null;
      if (issuanceBoxId) {
        try {
          const box = await nodeGet<{
            additionalRegisters?: Record<string, string>;
            registers?: Record<string, string>;
          }>(`/blockchain/box/byId/${issuanceBoxId}`, 5000);
          const regs =
            box.additionalRegisters ?? box.registers ?? {};
          artwork = pickArtFromRegs(regs);
        } catch {
          /* no box */
        }
      }
      // Mark checked with '' when issuance seen but no image — avoid infinite re-scan
      const artVal = artwork ?? (issuanceBoxId ? "" : null);
      await pool.query(
        `UPDATE tokens SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           decimals = COALESCE($4, decimals),
           emission = COALESCE($5, emission),
           box_id = COALESCE($6, box_id),
           artwork_url = CASE
             WHEN $7::text IS NOT NULL AND $7::text <> '' THEN $7
             WHEN $7::text = '' AND (artwork_url IS NULL) THEN ''
             ELSE artwork_url
           END
         WHERE token_id = $1`,
        [
          row.token_id,
          name,
          desc,
          meta.decimals != null ? Number(meta.decimals) : null,
          meta.emissionAmount != null ? Number(meta.emissionAmount) : null,
          issuanceBoxId,
          artVal,
        ]
      );
      if (name) named++;
      if (artwork) arts++;
    } catch {
      /* skip missing meta */
    }
  }
  if (rows.rows.length && (named || arts)) {
    console.log(
      `[indexer] enrich tokens batch=${rows.rows.length} named+=${named} art+=${arts}`
    );
  }
}

/** Lag pause: if tip lag > this, do not backfill (lab: tip > backfill always). */
const MAX_LAG_FOR_BACKFILL = Number(process.env.MAX_LAG_FOR_BACKFILL || 20);
/** Genesis target height (0 = full chain). Honest progress only.
 *  Ergo OpenAPI: genesis block height == 1. `/blocks/at/0` is empty. */
const ERGO_GENESIS_HEIGHT = 1;
const BACKFILL_TARGET = Number(process.env.BACKFILL_TARGET ?? 0);

/** One-shot unspent GROUP BY. Never on GET. Concurrent with tip via other pool slots. */
let addressSeedRunning = false;

async function maybeSeedAddressSummaries(pool: Pool): Promise<void> {
  if (addressSeedRunning) return;
  const done = await getState(pool, "address_summary_v2");
  if (done) return;
  addressSeedRunning = true;
  void seedAddressSummaries(pool)
    .then(async ({ rows }) => {
      await setState(pool, "address_summary_v2", String(Date.now()));
      await setState(pool, "address_summary_count", String(rows));
    })
    .catch((e) => {
      console.warn("[indexer] address_summary seed", String(e));
    })
    .finally(() => {
      addressSeedRunning = false;
    });
}

let txCountBackfillRunning = false;
let tokenBalancesUtxoRunning = false;

async function maybeSyncTokenBalancesUtxo(pool: Pool): Promise<void> {
  if (tokenBalancesUtxoRunning) return;
  if (await getState(pool, "token_balances_utxo_v1")) return;
  tokenBalancesUtxoRunning = true;
  void (async () => {
    const client = await pool.connect();
    try {
      const cursor = (await getState(pool, "token_balances_utxo_cursor")) ?? "";
      await client.query("SET statement_timeout = 45000");
      let last = cursor;
      let rows = 0;
      let done = false;
      for (let i = 0; i < 8; i++) {
        const page = await syncTokenBalancesUtxoPage(client, last);
        if (page.done) {
          done = true;
          break;
        }
        if (page.last) last = page.last;
        rows += page.rows;
        if (page.slow) break;
      }
      if (done) {
        await setState(pool, "token_balances_utxo_v1", String(Date.now()));
        console.log("[indexer] token_balances UTXO sync done");
        try {
          const tip = await tipHeight();
          await writeListSnapshots(pool, tip, { force: true });
        } catch (e) {
          console.warn("[indexer] token_balances UTXO snapshots", String(e));
        }
      } else {
        if (last) await setState(pool, "token_balances_utxo_cursor", last);
        console.log(`[indexer] token_balances UTXO sync n=${rows} after=${last.slice(0, 12)}`);
      }
    } catch (e) {
      console.warn("[indexer] token_balances UTXO sync", String(e));
    } finally {
      client.release();
      tokenBalancesUtxoRunning = false;
    }
  })();
}

let tokenBalanceHeightsRunning = false;

/** One-shot NULL first/last seed. Not UTXO amount sync. After token_balances_utxo_v1. */
async function maybeFillTokenBalanceHeights(pool: Pool): Promise<void> {
  if (tokenBalanceHeightsRunning) return;
  if (!(await getState(pool, "token_balances_utxo_v1"))) return;
  if (await getState(pool, "token_balances_activity_v1")) return;
  tokenBalanceHeightsRunning = true;
  void (async () => {
    const client = await pool.connect();
    try {
      const cursor = (await getState(pool, "token_balances_activity_cursor")) ?? "";
      await client.query("SET statement_timeout = 45000");
      let last = cursor;
      let rows = 0;
      let done = false;
      for (let i = 0; i < 6; i++) {
        const page = await syncTokenBalanceHeightsPage(client, last);
        if (page.done) {
          done = true;
          break;
        }
        if (page.last) last = page.last;
        rows += page.rows;
      }
      if (done) {
        await setState(pool, "token_balances_activity_v1", String(Date.now()));
        console.log("[indexer] token_balances first/last seed done");
      } else {
        if (last) await setState(pool, "token_balances_activity_cursor", last);
        console.log(`[indexer] token_balances first/last seed n=${rows} after=${last.slice(0, 12)}`);
      }
    } catch (e) {
      console.warn("[indexer] token_balances first/last seed", String(e));
    } finally {
      client.release();
      tokenBalanceHeightsRunning = false;
    }
  })();
}

let tokenBalanceTxCountRunning = false;

/** One-shot holder tx_count (this token). After UTXO sync. Own client, not tip. */
async function maybeFillTokenBalanceTxCounts(pool: Pool): Promise<void> {
  if (tokenBalanceTxCountRunning) return;
  if (!(await getState(pool, "token_balances_utxo_v1"))) return;
  if (await getState(pool, "token_balances_tx_count_v1")) {
    enableHolderTxCountLive();
    return;
  }
  tokenBalanceTxCountRunning = true;
  void (async () => {
    const client = await pool.connect();
    try {
      const cursor = (await getState(pool, "token_balances_tx_count_cursor")) ?? "";
      await client.query("SET statement_timeout = 120000");
      let last = cursor;
      let rows = 0;
      let done = false;
      for (let i = 0; i < 10; i++) {
        const page = await syncTokenBalanceTxCountPage(client, last);
        if (page.done) {
          done = true;
          break;
        }
        if (page.last) last = page.last;
        rows += page.rows;
      }
      if (done) {
        await setState(pool, "token_balances_tx_count_v1", String(Date.now()));
        enableHolderTxCountLive();
        console.log("[indexer] token_balances tx_count seed done");
      } else {
        if (last) await setState(pool, "token_balances_tx_count_cursor", last);
        console.log(`[indexer] token_balances tx_count seed n=${rows} after=${last.slice(0, 20)}`);
      }
    } catch (e) {
      console.warn("[indexer] token_balances tx_count seed", String(e));
    } finally {
      client.release();
      tokenBalanceTxCountRunning = false;
    }
  })();
}

async function maybeBackfillAddressTokenCounts(pool: Pool): Promise<void> {
  return maybeSyncTokenBalancesUtxo(pool);
}

async function maybeBackfillAddressTxCounts(pool: Pool): Promise<void> {
  if (txCountBackfillRunning) return;
  if (!(await getState(pool, "address_summary_v2"))) return;
  if (await getState(pool, "address_summary_tx_count_v1")) return;
  txCountBackfillRunning = true;
  void (async () => {
    const client = await pool.connect();
    try {
      await client.query("SET statement_timeout = 0");
      console.log("[indexer] address_summary tx_count backfill start");
      await backfillAddressSummaryTxCounts(client);
      await setState(pool, "address_summary_tx_count_v1", String(Date.now()));
      try {
        const tip = await tipHeight();
        await writeListSnapshots(pool, tip, { force: true });
      } catch (e) {
        console.warn("[indexer] address_summary tx_count snapshots", String(e));
      }
    } catch (e) {
      console.warn("[indexer] address_summary tx_count backfill", String(e));
    } finally {
      client.release();
      txCountBackfillRunning = false;
    }
  })();
}

let tokenStatsTicks = 0;
let lastTokenStatsAt = 0;
let lastListSnapAt = 0;
let summaryBackfillTicks = 0;
/** One recount at a time. Backfill voids; tip aborts then awaits. */
let summaryJob: Promise<void> | null = null;
let summaryAbort = false;
/** `tip-catchup` log: on enter, then at most once a minute (POLL_MS=2000 → else 30 lines/min). */
const DEEPEN_SKIP_LOG_MS = 60_000;
let lastDeepenSkipLogAt = 0;
let wasTipCatchup = false;

/** One address per commit: a hot contract must not roll back the P2PKs. */
const SUMMARY_COMMIT = 1;
/** Mainnet P2PK is ~51 chars. Backfill summary skips long P2S (repair is async). */
const BACKFILL_P2PK_MAX_LEN = 54;

function throttleDue(
  tickIndex: number,
  everyN: number,
  everyMs: number,
  lastAt: number
): boolean {
  if (everyN <= 0 && everyMs <= 0) return true;
  const byN = everyN > 0 && tickIndex % everyN === 0;
  const byMs = everyMs > 0 && Date.now() - lastAt >= everyMs;
  // OR: the more frequent of N and MS wins. Stretching MS does nothing if N is due first.
  return byN || byMs;
}

function sliceBackfillSummary(addresses: string[], cap: number): string[] {
  if (cap <= 0) return addresses;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    if (typeof a !== "string" || a.length === 0 || seen.has(a)) continue;
    if (!a.startsWith("9") || a.length > BACKFILL_P2PK_MAX_LEN) continue;
    seen.add(a);
    out.push(a);
    if (out.length >= cap) break;
  }
  return out;
}

async function deferAddressSummaries(pool: Pool, addresses: string[]): Promise<void> {
  if (!addresses.length) return;
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const a of addresses) {
    if (typeof a !== "string" || a.length === 0 || seen.has(a)) continue;
    seen.add(a);
    uniq.push(a);
  }
  if (!uniq.length) return;
  const client = await pool.connect();
  const t0 = Date.now();
  let ok = 0;
  let fail = 0;
  let skip = 0;
  try {
    // Once per job: covering missing/INVALID → skip fat; valid → SUM (Index Only).
    const coveringOk = await isBoxesUnspentValueIdxValid(client);
    let work = uniq;
    if (!coveringOk) {
      const fat = await fatSummaryRows(client, uniq);
      if (fat.length) {
        const skipSet = new Set(fat.map((r) => r.address));
        skip = skipSet.size;
        for (const row of fat) {
          console.log(
            `[indexer] address_summary skip fat ${row.address} boxes=${row.box_count}`
          );
        }
        work = uniq.filter((a) => !skipSet.has(a));
      }
    }
    for (let i = 0; i < work.length; i += SUMMARY_COMMIT) {
      if (summaryAbort) break;
      const slice = work.slice(i, i + SUMMARY_COMMIT);
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = 3000");
        await refreshAddressSummaries(client, slice, SUMMARY_COMMIT);
        await client.query("COMMIT");
        ok += slice.length;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        fail += slice.length;
        console.warn("[indexer] address_summary deferred", String(e));
      }
    }
  } finally {
    client.release();
  }
  console.log(
    `[indexer] address_summary deferred n=${ok} fail=${fail} skip=${skip} ${Date.now() - t0}ms`
  );
}

function scheduleBackfillSummaries(pool: Pool, addresses: string[]): void {
  if (!addresses.length) return;
  if (summaryJob) {
    console.log("[indexer] address_summary deferred skip in-flight");
    return;
  }
  summaryAbort = false;
  summaryJob = deferAddressSummaries(pool, addresses)
    .catch((e) => {
      console.warn("[indexer] address_summary", String(e));
    })
    .finally(() => {
      summaryJob = null;
      summaryAbort = false;
    });
}

async function runTipSummaries(pool: Pool, addresses: string[]): Promise<void> {
  if (summaryJob) {
    summaryAbort = true;
    await summaryJob;
  }
  summaryAbort = false;
  await deferAddressSummaries(pool, addresses);
}

async function packedTouchedAddresses(
  client: Client,
  height: number
): Promise<string[]> {
  const rows = await client.query<{ address: string }>(
    `SELECT DISTINCT ad.address
       FROM (
         SELECT b.addr_id
           FROM packed.boxes b
           JOIN packed.transactions t ON t.id = b.creation_tx_id
          WHERE t.height = $1
         UNION
         SELECT b.addr_id FROM packed.boxes b WHERE b.spent_height = $1
         UNION
         SELECT x.addr_id FROM packed.address_tx x WHERE x.height = $1
       ) u
       JOIN packed.addr ad ON ad.id = u.addr_id
      WHERE ad.address IS NOT NULL`,
    [height]
  );
  return rows.rows.map((r) => r.address);
}

export async function unwindIndexedHeight(
  pool: Pool,
  height: number,
  opts?: { keepLastHeight?: boolean }
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const blk = textChainHeadersEnabled()
      ? await client.query<{ id: string }>(
          `SELECT id FROM blocks WHERE height = $1 FOR UPDATE`,
          [height]
        )
      : { rows: [] as { id: string }[] };
    const packedBlk = packedWriteEnabled()
      ? await client.query<{ id: string }>(
          `SELECT encode(id, 'hex') AS id FROM packed.blocks WHERE height = $1 FOR UPDATE`,
          [height]
        )
      : { rows: [] as { id: string }[] };
    if (!blk.rows[0] && !packedBlk.rows[0]) {
      await client.query("ROLLBACK");
      return [];
    }
    if (!blk.rows[0]) {
      const touched = await packedTouchedAddresses(client, height);
      const gone = await client.query<{ address: string }>(
        `SELECT ad.address
           FROM packed.address_tx x
           JOIN packed.addr ad ON ad.id = x.addr_id
          WHERE x.height = $1`,
        [height]
      );
      await invertTokenStatsAtHeight(client, height);
      await unwindPackedHeight(client, height);
      if (touched.length) {
        // tx_count rose by one per new address_tx row, so take back rows, not addresses.
        // max() over address_tx alone reads the (addr_id, height DESC) index; a JOIN sorts the whole fee contract.
        await client.query(
          `UPDATE address_summary s
              SET tx_count = GREATEST(0, s.tx_count - c.n),
                  last_height = (
                    SELECT max(x.height)
                      FROM packed.address_tx x
                     WHERE x.addr_id = (
                       SELECT ad.id
                         FROM packed.addr ad
                        WHERE ad.addr_md5 = md5(s.address) AND ad.address = s.address
                     )
                  )
             FROM (
               SELECT t.address, COALESCE(g.n, 0) AS n
                 FROM unnest($1::text[]) AS t(address)
                 LEFT JOIN (
                   SELECT address, COUNT(*)::int AS n
                     FROM unnest($2::text[]) AS a(address)
                    GROUP BY address
                 ) g ON g.address = t.address
             ) c
            WHERE s.address = c.address`,
          [touched, gone.rows.map((r) => r.address)]
        );
      }
      await bumpGixNextAfterUnwind(client);
      if (!opts?.keepLastHeight) {
        await client.query(
          `INSERT INTO indexer_state (key, value, updated_at)
           VALUES ('last_height', $1, now())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [String(height - 1)]
        );
      }
      await client.query("COMMIT");
      return touched;
    }
    const touched = await touchedAddressesAtHeight(client, height);
    const boxesFromPacked = packedWriteEnabled() && !textChainBoxesEnabled();
    let packedAddrGone: string[] = [];
    if (boxesFromPacked) {
      const gone = await client.query<{ address: string }>(
        `SELECT ad.address
           FROM packed.address_tx x
           JOIN packed.addr ad ON ad.id = x.addr_id
          WHERE x.height = $1`,
        [height]
      );
      packedAddrGone = gone.rows.map((r) => r.address);
      await invertTokenStatsAtHeight(client, height);
      await unwindPackedHeight(client, height);
    } else {
      if (packedWriteEnabled()) await unwindPackedHeight(client, height);
      await invertTokenStatsAtHeight(client, height);
    }
    if (textChainBoxesEnabled()) {
      await client.query(
        `UPDATE boxes
            SET spent_tx_id = NULL, spent_height = NULL
          WHERE spent_height = $1
            AND creation_tx_id NOT IN (
              SELECT id FROM transactions WHERE height = $1
            )`,
        [height]
      );
      await client.query(`DELETE FROM tx_inputs WHERE spent_height = $1`, [
        height,
      ]);
      await client.query(
        `DELETE FROM boxes
          WHERE creation_tx_id IN (SELECT id FROM transactions WHERE height = $1)`,
        [height]
      );
    }
    const goneAddr = textChainBoxesEnabled()
      ? await client.query<{ address: string }>(
          `DELETE FROM address_tx WHERE height = $1 RETURNING address`,
          [height]
        )
      : { rows: [] as { address: string }[] };
    if (goneAddr.rows.length) {
      // Subtract the removed rows. last_height is one index lookup, not a full recount.
      await client.query(
        `UPDATE address_summary s
            SET tx_count = GREATEST(0, s.tx_count - c.n),
                last_height = (
                  SELECT x.height
                    FROM address_tx x
                   WHERE x.address = s.address
                   ORDER BY x.height DESC NULLS LAST, x.tx_id DESC
                   LIMIT 1
                )
           FROM (
             SELECT address, COUNT(*)::int AS n
               FROM unnest($1::text[]) AS a(address)
              GROUP BY address
           ) c
          WHERE s.address = c.address`,
        [goneAddr.rows.map((r) => r.address)]
      );
    }
    if (packedAddrGone.length) {
      await client.query(
        `UPDATE address_summary s
            SET tx_count = GREATEST(0, s.tx_count - c.n),
                last_height = (
                  SELECT x.height
                    FROM packed.address_tx x
                    JOIN packed.addr ad ON ad.id = x.addr_id
                   WHERE ad.addr_md5 = md5(s.address) AND ad.address = s.address
                   ORDER BY x.height DESC, x.tx_id
                   LIMIT 1
                )
           FROM (
             SELECT address, COUNT(*)::int AS n
               FROM unnest($1::text[]) AS a(address)
              GROUP BY address
           ) c
          WHERE s.address = c.address`,
        [packedAddrGone]
      );
    }
    if (textChainHeadersEnabled()) {
      await client.query(`DELETE FROM transactions WHERE height = $1`, [height]);
      await client.query(`DELETE FROM blocks WHERE height = $1`, [height]);
    }
    await bumpGixNextAfterUnwind(client);
    if (!opts?.keepLastHeight) {
      await client.query(
        `INSERT INTO indexer_state (key, value, updated_at)
         VALUES ('last_height', $1, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [String(height - 1)]
      );
    }
    await client.query("COMMIT");
    return touched;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * One block per height, so a fork is removed, not flagged.
 * While the indexed block at fullHeight is bestFullHeaderId, this is one PK read.
 * A header walk happens when the indexed tip is not the best chain, including a side
 * branch sitting below the node tip. Missing heights are skipped on that walk.
 * No anchor within TIP_UNWIND_CAP means do not unwind.
 */
async function canonicalAnchor(
  pool: Pool,
  fullHeight: number,
  bestId: string
): Promise<number | null> {
  let h = fullHeight;
  let id = bestId;
  for (let i = 0; i < TIP_UNWIND_CAP; i++) {
    const ours = await indexedBlockAt(pool, h);
    if (ours && ours.id.toLowerCase() === id.toLowerCase()) return h;
    let parent: string | undefined;
    try {
      parent = await headerParentId(id);
    } catch (e) {
      console.warn(`[indexer] canonical parent ${h}`, String(e));
      return null;
    }
    if (!parent) return null;
    id = parent;
    h -= 1;
    if (h <= 0) return null;
  }
  console.warn(
    `[indexer] canonical unwind stop: no shared block within ${TIP_UNWIND_CAP}`
  );
  return null;
}

async function reconcileCanonicalTip(
  pool: Pool,
  prefetch: ReturnType<typeof createBlockPrefetch<FetchedBlock | null>>,
  bestId: string | null,
  fullHeight: number,
  minH: number
): Promise<{ touched: string[]; n: number }> {
  const none = { touched: [] as string[], n: 0 };
  if (!bestId || fullHeight <= 0) return none;
  const { max: ourMax } = await indexedMinMax(pool);
  if (ourMax <= 0) return none;
  const at = await indexedBlockAt(pool, fullHeight);
  const ahead = ourMax > fullHeight;
  if (ahead && !at) {
    console.warn(
      `[indexer] canonical tip ${fullHeight} missing while indexed max is ${ourMax}`
    );
    return none;
  }
  const anchor = await canonicalAnchor(pool, fullHeight, bestId);
  if (anchor == null) return none;

  const touched: string[] = [];
  let n = 0;
  while (n < TIP_UNWIND_CAP) {
    const { max } = await indexedMinMax(pool);
    if (max <= anchor) break;
    if (n > 0 && max < minH) {
      console.warn(
        `[indexer] canonical unwind stop: floor min=${minH} max=${max}`
      );
      break;
    }
    console.log(
      `[indexer] canonical fork: best ${bestId.slice(0, 12)} at ${fullHeight}; unwind ${max}`
    );
    touched.push(...(await unwindIndexedHeight(pool, max)));
    dropChainFrom(max);
    prefetch.dropFrom(max);
    n++;
  }
  if (n > 0) console.log(`[indexer] canonical unwind ${n} height(s)`);
  return { touched, n };
}

async function unwindTipForks(
  pool: Pool,
  prefetch: ReturnType<typeof createBlockPrefetch<FetchedBlock | null>>,
  minH: number,
  remaining: number
): Promise<{ touched: string[]; n: number }> {
  const touched: string[] = [];
  let n = 0;
  const cap = Math.max(0, remaining);
  while (n < cap) {
    const { max: maxH } = await indexedMinMax(pool);
    if (maxH <= 0) break;
    if (n > 0 && maxH < minH) {
      console.warn(
        `[indexer] tip unwind stop: floor min=${minH} max=${maxH}`
      );
      break;
    }
    let kind: "ok" | "empty" | "fork";
    try {
      kind = await lastPlusOneLink(pool, maxH);
    } catch (e) {
      console.warn(`[indexer] tip unwind probe ${maxH + 1}`, String(e));
      break;
    }
    if (kind !== "fork") break;
    const loser = await indexedBlockAt(pool, maxH);
    console.log(
      `[indexer] tip fork at ${maxH + 1}: parent ${loser?.id ?? "?"} not on chain; unwind ${maxH}`
    );
    touched.push(...(await unwindIndexedHeight(pool, maxH)));
    dropChainFrom(maxH);
    prefetch.dropFrom(maxH);
    n++;
  }
  if (n >= cap && cap > 0) {
    const { max: still } = await indexedMinMax(pool);
    let stillFork = false;
    try {
      stillFork = (await lastPlusOneLink(pool, still)) === "fork";
    } catch {
      stillFork = false;
    }
    if (stillFork) {
      console.warn(`[indexer] tip unwind stop: cap ${TIP_UNWIND_CAP}`);
    }
  } else if (n > 0) {
    console.log(`[indexer] tip unwind ${n} height(s)`);
  }
  return { touched, n };
}

async function loop(pool: Pool): Promise<boolean> {
  const info = await nodeInfo();
  const tip = info.fullHeight;
  if (!tip) {
    console.warn("[indexer] no tip");
    return false;
  }
  const freeGb = freeDiskGb();
  const diskOk = freeGb >= MIN_DISK_FREE_GB;
  let last = Number((await getState(pool, "last_height")) || 0);
  let { min: minH, max: maxH } = await indexedMinMax(pool);
  const initFloor = Math.max(1, tip - BACKFILL_DEPTH);
  // Historical backfill toward BACKFILL_TARGET (0 = genesis). DEEPEN_DEPTH caps per-run floor.
  const deepenFloor = Math.max(
    BACKFILL_TARGET,
    Math.max(0, tip - DEEPEN_DEPTH)
  );

  // 1) Tip catch-up first (never skip when behind)
  let from = last > 0 ? last + 1 : initFloor;
  if (from < initFloor && last === 0) from = initFloor;
  // if we somehow have last below tip, catch up regardless of deepen
  if (last > 0 && last < tip) {
    from = last + 1;
  }

  let n = 0;
  let mode = "tip";
  let snappedAfterTipLoop = false;
  let deepenedThisTick = false;
  // Ergo genesis is height 1. Until then history is open; height 0 is not a block.
  const chainFloor =
    BACKFILL_TARGET <= 0 ? ERGO_GENESIS_HEIGHT : BACKFILL_TARGET;
  const historyOpen = minH > Math.max(deepenFloor, chainFloor);
  const tokenStats = !historyOpen;
  let tipLag = tip - Math.max(last, maxH);
  const pendingSummary: string[] = [];
  const prefetch = createBlockPrefetch({
    load: (height) => fetchBlockAtHeight(pool, height),
    concurrency: PREFETCH_BLOCKS,
  });
  const canon = await reconcileCanonicalTip(
    pool,
    prefetch,
    info.bestFullHeaderId,
    tip,
    minH
  );
  if (canon.n > 0) {
    pendingSummary.push(...canon.touched);
    last = Number((await getState(pool, "last_height")) || 0);
    maxH = (await indexedMinMax(pool)).max;
    from = last > 0 ? last + 1 : initFloor;
    tipLag = tip - Math.max(last, maxH);
  }

  void maybeSeedAddressSummaries(pool);
  void maybeFillHugeAddressSummaries(pool);
  void maybeBackfillAddressTxCounts(pool);
  void maybeBackfillAddressTokenCounts(pool);
  void maybeFillTokenBalanceHeights(pool);
  void maybeFillTokenBalanceTxCounts(pool);
  void maybeFillLongHolderTxCounts(pool);
  void maybeRecountTokenTapeCounts(pool);

  const skipListsSnap = tipLag > MAX_LAG_FOR_BACKFILL;
  const snapNow = async () => {
    if (skipListsSnap) return;
    try {
      await writeListSnapshots(pool, tip);
    } catch (e) {
      console.warn("[indexer] list snapshots", String(e));
    }
  };

  const canDeepen =
    diskOk && tipLag <= MAX_LAG_FOR_BACKFILL && historyOpen;

  const runDeepen = async (): Promise<number> => {
    let h = minH > 0 ? minH - 1 : deepenFloor;
    chainWalkDir = -1;
    let did = 0;
    while (h >= deepenFloor && n < DEEPEN_PER_TICK) {
      if (h === 0 && BACKFILL_TARGET <= 0) {
        console.log(
          "[indexer] genesis floor: no height 0 (Ergo genesis is 1)"
        );
        h = -1;
        break;
      }
      prefetch.ensure(prefetchWindow(h, -1, PREFETCH_BLOCKS, deepenFloor, h));
      let fetched: FetchedBlock | null;
      const tTake = Date.now();
      try {
        fetched = await takePrefetched(prefetch, h);
      } catch (e) {
        console.warn(`[indexer] backfill ${h} failed`, String(e));
        break;
      }
      const fetchMs = Date.now() - tTake;
      if (!fetched) {
        console.warn(`[indexer] backfill ${h} failed no headers`);
        break;
      }
      try {
        const tCommit = Date.now();
        const touched = await indexHeight(pool, h, fetched, { tokenStats });
        const commitMs = Date.now() - tCommit;
        prefetch.drop(h);
        pendingSummary.push(...touched);
        if (did === 0 || n === DEEPEN_PER_TICK - 1 || commitMs >= 4000) {
          console.log(
            `[indexer] backfill ${h} (floor ${deepenFloor} target ${BACKFILL_TARGET}) tip ${tip} disk=${freeGb.toFixed(1)}G fetch=${fetchMs}ms commit=${commitMs}ms`
          );
        }
      } catch (e) {
        console.warn(`[indexer] backfill ${h} failed`, String(e));
        break;
      }
      h--;
      n++;
      did++;
    }
    await setState(pool, "min_height", String(Math.max(deepenFloor, h + 1)));
    return did;
  };

  // At tip: full lists at most every LIST_SNAP_MS while history is open.
  // After a tip-catchup loop we always snap (new block on home).
  if (last > 0 && last >= tip && maxH >= tip) {
    const due =
      !historyOpen ||
      LIST_SNAP_MS <= 0 ||
      !lastListSnapAt ||
      Date.now() - lastListSnapAt >= LIST_SNAP_MS;
    if (due) {
      await snapNow();
      lastListSnapAt = Date.now();
    }
  }

  if (last < tip || maxH < tip || last === 0) {
    let h = from;
    if (last === 0 && maxH === 0) h = initFloor;
    else if (last > 0) h = last + 1;
    else if (maxH > 0 && maxH < tip) h = maxH + 1;

    chainWalkDir = 1;
    let tipUnwind = 0;
    while (h <= tip && n < MAX_PER_TICK) {
      prefetch.ensure(prefetchWindow(h, 1, PREFETCH_BLOCKS, 1, tip));
      let fetched: FetchedBlock | null;
      try {
        fetched = await takePrefetched(prefetch, h);
      } catch (e) {
        if (e instanceof TipForkError) {
          if (tipUnwind >= TIP_UNWIND_CAP) {
            console.warn(`[indexer] tip unwind stop: cap ${TIP_UNWIND_CAP}`);
            break;
          }
          const before = (await indexedMinMax(pool)).max;
          const unwound = await unwindTipForks(
            pool,
            prefetch,
            minH,
            TIP_UNWIND_CAP - tipUnwind
          );
          pendingSummary.push(...unwound.touched);
          tipUnwind += unwound.n;
          const after = (await indexedMinMax(pool)).max;
          if (unwound.n === 0 || after >= before) {
            console.warn(`[indexer] height ${h} failed`, String(e));
            break;
          }
          h = after + 1;
          continue;
        }
        console.warn(`[indexer] height ${h} failed`, String(e));
        break;
      }
      if (!fetched) {
        console.warn(`[indexer] no headers at ${h} yet`);
        break;
      }
      try {
        const touched = await indexHeight(pool, h, fetched, { tokenStats });
        prefetch.drop(h);
        pendingSummary.push(...touched);
        await setState(pool, "last_height", String(h));
        if (n === 0 || h === tip) {
          console.log(`[indexer] tip ${h}/${tip} disk=${freeGb.toFixed(1)}G`);
        }
      } catch (e) {
        console.warn(`[indexer] height ${h} failed`, String(e));
        break;
      }
      h++;
      n++;
    }
    const tipCaught = h > tip;
    mode = historyOpen ? "tip-catchup" : "tip";
    await setState(pool, "mode", mode);
    await snapNow();
    snappedAfterTipLoop = true;
    lastListSnapAt = Date.now();
    if (tipCaught && canDeepen && n < DEEPEN_PER_TICK) {
      const did = await runDeepen();
      if (did > 0) {
        deepenedThisTick = true;
        mode = "backfill";
        wasTipCatchup = false;
        await setState(pool, "mode", "backfill");
      } else {
        wasTipCatchup = historyOpen;
      }
    } else if (historyOpen) {
      const now = Date.now();
      if (!wasTipCatchup || now - lastDeepenSkipLogAt >= DEEPEN_SKIP_LOG_MS) {
        console.log(
          `[indexer] deepen skipped: tip took the tick (last=${last} tip=${tip} lag=${tipLag} did=${n} min=${minH} floor=${deepenFloor})`
        );
        lastDeepenSkipLogAt = now;
      }
      wasTipCatchup = true;
    } else {
      wasTipCatchup = false;
    }
  } else if (canDeepen) {
    wasTipCatchup = false;
    mode = "backfill";
    await setState(pool, "mode", "backfill");
    const did = await runDeepen();
    deepenedThisTick = did > 0;
  } else {
    wasTipCatchup = false;
    mode =
      !diskOk
        ? "tip-disk-hold"
        : tipLag > MAX_LAG_FOR_BACKFILL
          ? "tip-lag-hold"
          : "tip";
    await setState(pool, "mode", mode);
    if (!diskOk) {
      console.warn(
        `[indexer] backfill paused: free ${freeGb.toFixed(1)}G < ${MIN_DISK_FREE_GB}G`
      );
    } else if (tipLag > MAX_LAG_FOR_BACKFILL) {
      console.warn(
        `[indexer] backfill paused: tip lag ${tipLag} > ${MAX_LAG_FOR_BACKFILL}`
      );
    }
  }

  // keep last_height at tip side
  const mm = await indexedMinMax(pool);
  if (mm.max > 0) await setState(pool, "last_height", String(mm.max));
  const genesisDone =
    BACKFILL_TARGET <= 0 && mm.min > 0 && mm.min <= ERGO_GENESIS_HEIGHT;
  if (genesisDone) {
    await setState(pool, "min_height", "0");
  } else if (mm.min > 0) {
    await setState(pool, "min_height", String(mm.min));
  }
  await setState(pool, "tip_seen", String(tip));
  await setState(pool, "mode", mode);
  await setState(pool, "disk_free_gb", freeGb.toFixed(2));
  await setState(pool, "backfill_target", String(BACKFILL_TARGET));
  // honest progress (never 100 until min at target; Ergo genesis is height 1)
  if (tip > 0 && mm.min > 0) {
    const denom = Math.max(1, tip - BACKFILL_TARGET);
    const done = Math.max(0, tip - mm.min);
    let pct = Math.min(99.99, Math.round((done / denom) * 10000) / 100);
    if (mm.min <= BACKFILL_TARGET || genesisDone) pct = 100;
    await setState(pool, "backfill_pct", String(pct));
  }

  if (!snappedAfterTipLoop) {
    try {
      if (mode === "backfill" || deepenedThisTick) {
        await writeWindowSnapshots(pool, tip, { heavy: !historyOpen });
      } else if (!skipListsSnap) {
        await writeListSnapshots(pool, tip);
      }
    } catch (e) {
      console.warn("[indexer] list snapshots", String(e));
    }
  } else if (deepenedThisTick) {
    try {
      await writeIndexerStatusSnapshot(pool, tip);
    } catch (e) {
      console.warn("[indexer] list snapshots", String(e));
    }
  }

  let tokenStatsBite = false;
  if (!historyOpen) {
    const statsEveryTick =
      (TOKEN_STATS_EVERY_N <= 0 && TOKEN_STATS_MS <= 0) ||
      (TOKEN_STATS_EVERY_N === 1 && TOKEN_STATS_MS <= 0);
    const runTokenStats = throttleDue(
      tokenStatsTicks,
      statsEveryTick ? 1 : TOKEN_STATS_EVERY_N,
      statsEveryTick ? 0 : TOKEN_STATS_MS,
      lastTokenStatsAt
    );
    tokenStatsTicks += 1;
    if (runTokenStats) {
      try {
        for (let i = 0; i < TOKEN_STATS_CATCHUP_MULT; i++) {
          const bite = await maybeCatchupTokenStats(pool);
          if (!bite) break;
          tokenStatsBite = true;
        }
      } catch (e) {
        console.warn("[indexer] token stats catch-up", String(e));
      } finally {
        lastTokenStatsAt = Date.now();
      }
    }
  }

  // Seed is the tick. Names/shape/regs wait until the catalog bite is idle.
  if (tokenStatsBite) return true;

  if (mode !== "backfill") {
    try {
      await maybeFillRecentTxShapes(pool);
    } catch (e) {
      console.warn("[indexer] tx shape fill", String(e));
    }
  }

  if (SKIP_ADDRESS_SUMMARY) {
    /* regs/history bite — recount later via seedAddressSummaries */
  } else if (historyOpen) {
    if (summaryJob) summaryAbort = true;
  } else {
    const runSummary =
      mode !== "backfill" ||
      throttleDue(
        summaryBackfillTicks,
        BACKFILL_SUMMARY_EVERY_N,
        0,
        0
      );
    if (mode === "backfill") summaryBackfillTicks += 1;
    if (runSummary) {
      const addrs =
        mode === "backfill"
          ? sliceBackfillSummary(pendingSummary, BACKFILL_SUMMARY_CAP)
          : pendingSummary;
      try {
        if (mode === "backfill") {
          scheduleBackfillSummaries(pool, addrs);
        } else {
          await runTipSummaries(pool, addrs);
        }
      } catch (e) {
        console.warn("[indexer] address_summary", String(e));
      }
    }
  }

  // P2-9: name + artwork hydration (two passes: general + art-focused)
  try {
    await enrichTokenMeta(pool, 24);
    await enrichTokenMeta(pool, 20); // second batch same tick — art catch-up
  } catch (e) {
    console.warn("[indexer] enrich tokens", String(e));
  }

  // Names from issuance-box R4 already in PG. Not ENRICH, not node.
  try {
    await maybeBackfillTokenNamesFromRegs(pool);
  } catch (e) {
    console.warn("[indexer] token names r4", String(e));
  }

  // EIP-4 R7 → tokens.nft_kind. Same mint join. Not ENRICH, not node.
  try {
    await maybeBackfillNftKindFromRegs(pool);
  } catch (e) {
    console.warn("[indexer] token nft_kind", String(e));
  }

  // artwork_url '' → mint-output R9. Typed NFTs only. Not ENRICH, not node.
  try {
    await maybeBackfillMintArtwork(pool);
  } catch (e) {
    console.warn("[indexer] token art mint", String(e));
  }

  // Issuance box_id=token_id → emission + decimals. Overwrites first-seen lie.
  try {
    await maybeBackfillTokenIssuance(pool);
  } catch (e) {
    console.warn("[indexer] token issuance", String(e));
  }

  let metaRetry = false;
  try {
    metaRetry = await maybeRetryTokenMetaAfterRegs(pool);
  } catch (e) {
    console.warn("[indexer] token meta retry", String(e));
  }

  // Spend-side address_tx for heights the live writer never saw. After catalog seed.
  try {
    await maybeBackfillAddressTxSpends(pool);
  } catch (e) {
    console.warn("[indexer] address_tx spend bf", String(e));
  }

  try {
    await maybeBackfillBlockHeaders(pool);
  } catch (e) {
    console.warn("[indexer] block header", String(e));
  }

  try {
    await maybeBackfillBlockSections(pool);
  } catch (e) {
    console.warn("[indexer] block section", String(e));
  }

  try {
    await maybeBackfillInputProofs(pool);
  } catch (e) {
    console.warn("[indexer] input proof", String(e));
  }

  try {
    await maybeWriteLithosFinds(pool);
  } catch (e) {
    console.warn("[indexer] lithos find", String(e));
  }

  // Long P2S history: dedicated writer. Tip keeps ADDRESS_TX_LONG=0.
  if (longAddressTxSlotEnabled()) {
    try {
      await maybeBackfillLongAddressTx(pool);
    } catch (e) {
      console.warn("[indexer] address_tx long", String(e));
    }
  }

  // Historical gix: dedicated writer. Tip keeps GIX_BACKFILL=0.
  if (gixBackfillEnabled()) {
    try {
      await maybeBackfillGix(pool);
    } catch (e) {
      console.warn("[indexer] gix backfill", String(e));
    }
  }

  // additional_registers hole ~1.401M–1.854M. Node /blocks/{id} only. Not ENRICH.
  let regsBite = false;
  try {
    regsBite = await maybeBackfillBoxRegisters(pool);
  } catch (e) {
    console.warn("[indexer] regs bf", String(e));
  }

  let rentColBite = false;
  try {
    rentColBite = await maybeBackfillRentCollected(pool);
  } catch (e) {
    console.warn("[indexer] rent collected", String(e));
  }

  // output_index backfill is opt-in. The GROUP BY / COUNT on 2M+ NULL rows
  // blocked the tip loop for ~40 min and froze home/blocks/txs snapshots.
  if (REPAIR_OUTPUT_INDEX && tipLag <= 0) {
    try {
      const hBudget = Math.min(8, Math.max(2, Math.floor(OUTPUT_INDEX_PER_TICK / 5)));
      const bBudget = Math.min(OUTPUT_INDEX_PER_TICK, 30);
      await repairOutputIndex(pool, {
        heightBudget: hBudget,
        boxBudget: bBudget,
        label: "output_index tick",
      });
    } catch (e) {
      console.warn("[indexer] output_index backfill", String(e));
    }
  }
  return regsBite || metaRetry || tokenStatsBite || rentColBite;
}

async function main() {
  console.log(
    "[indexer] ErgoScan (tip+deepen+tokens P2-5/6)"
  );
  console.log("[indexer] NODE", NODE);
  console.log("[indexer] ENABLED", ENABLED);
  console.log(
    `[indexer] BACKFILL=${BACKFILL_DEPTH} DEEPEN=${DEEPEN_DEPTH} PREFETCH=${PREFETCH_BLOCKS} BATCH_SQL=${BATCH_SQL ? 1 : 0} MIN_DISK=${MIN_DISK_FREE_GB}G`
  );
  console.log(
    `[indexer] TOKEN_STATS_N=${TOKEN_STATS_EVERY_N} TOKEN_STATS_MS=${TOKEN_STATS_MS} TOKEN_STATS_CATCHUP_MULT=${TOKEN_STATS_CATCHUP_MULT} SUMMARY_CAP=${BACKFILL_SUMMARY_CAP} SUMMARY_N=${BACKFILL_SUMMARY_EVERY_N} SKIP_ADDRESS_SUMMARY=${SKIP_ADDRESS_SUMMARY ? 1 : 0}`
  );

  if (!ENABLED) {
    console.log(
      "[indexer] INDEXER_ENABLED!=1 — exit. migrate + INDEXER_ENABLED=1 to run."
    );
    process.exit(0);
  }

  if (!textChainBoxesEnabled() && !packedWriteEnabled()) {
    throw new Error("TEXT_CHAIN_BOXES=0 requires PACKED_WRITE=1");
  }
  if (!textChainHeadersEnabled() && !packedWriteEnabled()) {
    throw new Error("TEXT_CHAIN_HEADERS=0 requires PACKED_WRITE=1");
  }
  if (!textChainBoxesEnabled() && !BATCH_SQL) {
    throw new Error("TEXT_CHAIN_BOXES=0 requires BATCH_SQL=1");
  }
  const pool = createPool();
  await pool.query("SELECT 1");
  console.log("[indexer] db ok");
  if (packedWriteEnabled()) await ensurePackedSchema(pool);
  console.log(
    `[indexer] PACKED_WRITE=${packedWriteEnabled() ? 1 : 0} TEXT_CHAIN_BOXES=${textChainBoxesEnabled() ? 1 : 0} TEXT_CHAIN_HEADERS=${textChainHeadersEnabled() ? 1 : 0}`
  );
  await ensureSnapshotSchema(pool);
  void writeOracleHomeFields(pool)
    .then((snap) => {
      if (snap) {
        console.log(
          JSON.stringify({
            type: "oracle_erg_usd",
            boxId: snap.boxId,
            height: snap.height,
            nanoPerUsd: snap.nanoPerUsd,
            ergUsd: snap.ergUsd,
          })
        );
      }
    })
    .catch((e) => {
      console.warn("[indexer] oracle erg/usd seed", String(e));
    });
  await ensureAddressSummarySchema(pool);
  await ensureTokenStatsSchema(pool);
  await loadHolderTxCountLive(pool);
  await ensureMarketCgSchema(pool);
  void ensureLongAddressLookup(pool).catch((e) => {
    console.warn("[indexer] long address index", String(e));
  });

  if (REPAIR_SPENDS) {
    const tip = await tipHeight();
    const minR = await pool.query<{ m: string | null }>(
      "SELECT min(height)::text AS m FROM blocks"
    );
    const maxR = await pool.query<{ m: string | null }>(
      "SELECT max(height)::text AS m FROM blocks"
    );
    const from = Number(minR.rows[0]?.m || tip - BACKFILL_DEPTH);
    const to = Number(maxR.rows[0]?.m || tip);
    await repairSpends(pool, Math.max(1, from), Math.max(from, to));
    // continue into normal loop after repair
  }

  if (REPAIR_ADDRESSES) {
    console.log("[indexer] address backfill (REPAIR_ADDRESSES=1)");
    await repairAddresses(pool);
  }

  if (REPAIR_OUTPUT_INDEX) {
    console.log("[indexer] output_index backfill (REPAIR_OUTPUT_INDEX=1)");
    await repairOutputIndex(pool, {
      heightBudget: 40,
      boxBudget: 200,
      label: "REPAIR_OUTPUT_INDEX",
    });
    await setState(pool, "repair_output_index_done", String(Date.now()));
  }

  for (;;) {
    let skipPoll = false;
    try {
      skipPoll = await loop(pool);
    } catch (e) {
      console.error("[indexer] tick error", e);
    }
    // After a regs bite the 2s POLL just idles the node pipeline.
    const wait = skipPoll ? 50 : POLL_MS;
    await new Promise((r) => setTimeout(r, wait));
  }
}

if (!process.env.STITCH_IMPORT) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
