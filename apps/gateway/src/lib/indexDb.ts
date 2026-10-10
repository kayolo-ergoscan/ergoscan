/**
 * Optional Phase 2 Postgres indexer reads.
 * When DATABASE_URL is unset or DB cold/unreachable → null (stale / empty, never the node).
 */
import pg from "pg";
import {
  classifyAddrFlow,
  decodeRegisterMap,
  displayErgoTokenName,
  eip24FromIssuerRegs,
  eip4DecimalsFromRegs,
  eip4MediaFromRegs,
  eip4MintOfOutputs,
  eip4PreviewUrl,
  isAgeUsdBankNft,
  MINERS_FEE_ADDRESS,
  isNftKind,
  ipfsCidFromPath,
  ipfsPathFromHref,
  minerFeeFromOutputs,
  ORACLE_POOL_NFTS,
  parseNanoErg,
  pickArtworkUrl,
  type AddrFlowKind,
  type NftKind,
} from "@ergoscan/shared";
import { GIX_STREAM_TIMEOUT_MS, gixMaxFromNext } from "./gix.js";
import {
  isHex64,
  PACKED_ASSETS_BY_IDS_SQL,
  PACKED_BOX_BY_ID_SQL,
  PACKED_BOX_IO_SQL,
  PACKED_BOXES_BY_IDS_SQL,
  PACKED_TOKEN_IS_SWAP_SQL,
  PACKED_TX_BY_ID_SQL,
  PACKED_TX_HEADS_SQL,
  PACKED_TX_NEIGHBOR_SQL,
  packedReadEnabled,
} from "./packedRead.js";
import { ADDR_TOKEN_TAPE, sortAddrTokenTape, type AddrTokenTapeRow } from "./addr-token-tape.js";
import { encodeHolderCursor, type HolderCursor } from "./holder-cursor.js";
import { leanTokenHolderAddresses } from "./token-holder-activity.js";
import { flowParties, netTokenParties, zipTokenLegs } from "./flow-parties.js";
import {
  addressListWhere,
  type AddressBand,
  type AddressKind,
} from "./addressListFilter.js";

export type { AddrTokenTapeRow };
export { sortAddrTokenTape, ADDR_TOKEN_TAPE };

const NFT_SKIP_IDS = ORACLE_POOL_NFTS;

const { Pool } = pg;

export type IndexerStatus = {
  enabled: boolean;
  ok: boolean;
  lastHeight: number | null;
  minHeight: number | null;
  tipSeen: number | null;
  tipHeight?: number | null;
  mode: string | null;
  lag: number | null;
  span: number | null;
  boxCount: number | null;
  unspentCount: number | null;
  tokenCount: number | null;
  /** Ops-only; stripped from public JSON. */
  diskFreeGb?: number | null;
  /** Genesis target height (0 = full chain). Honest — not claimed until minHeight reaches it. */
  backfillTarget?: number | null;
  /** Progress toward target; never 100% until minHeight <= target. */
  backfillPct?: number | null;
  utxoIndexed?: boolean;
  addressIndex?: boolean;
  mempoolOk?: boolean;
  detail?: string;
};

let writePool: pg.Pool | null = null;
let readPool: pg.Pool | null = null;
let lastFail = 0;
/** Cache /v1/health indexer block — avoid pile-up on slow PG */
let statusCache: { at: number; tip: number | null | undefined; value: IndexerStatus } | null =
  null;
const STATUS_CACHE_MS = 15_000;

export function indexerConfigured(): boolean {
  return !!(
    process.env.DATABASE_URL ||
    process.env.DATABASE_READ_URL ||
    process.env.INDEXER_DATABASE_URL
  );
}

function writeUrl(): string | null {
  return process.env.DATABASE_URL || process.env.INDEXER_DATABASE_URL || null;
}

function readUrl(): string | null {
  return process.env.DATABASE_READ_URL || writeUrl();
}

function makePool(url: string): pg.Pool {
  const withTimeout =
    url.includes("statement_timeout") || url.includes("options=")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c statement_timeout=4000")}`;
  const p = new Pool({
    connectionString: withTimeout,
    max: 4,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 2_500,
  });
  p.on("error", () => {
    lastFail = Date.now();
  });
  return p;
}

/** Primary — indexer uses DATABASE_URL in its own process. Gateway is read-only. */
export function getWritePool(): pg.Pool | null {
  const url = writeUrl();
  if (!url) return null;
  if (!writePool) writePool = makePool(url);
  return writePool;
}

/** Replica when DATABASE_READ_URL is set; otherwise the primary. */
export function getReadPool(): pg.Pool | null {
  const r = readUrl();
  const w = writeUrl();
  if (!r) return null;
  if (!w || r === w) return getWritePool();
  if (!readPool) readPool = makePool(r);
  return readPool;
}

/** CIDs whose preview webp is already on disk. Empty if the table is missing. */
export async function readyPreviewCids(
  urls: Array<string | null | undefined>
): Promise<Set<string>> {
  const cids = [
    ...new Set(
      urls
        .map((u) => ipfsCidFromPath(ipfsPathFromHref(u)))
        .filter((c): c is string => !!c)
    ),
  ];
  if (!cids.length) return new Set();
  const pool = getReadPool();
  if (!pool) return new Set();
  try {
    const r = await pool.query<{ cid: string }>(
      `SELECT cid FROM nft_preview WHERE status = 'ready' AND cid = ANY($1::text[])`,
      [cids]
    );
    return new Set(r.rows.map((row) => row.cid));
  } catch {
    return new Set();
  }
}
export function getIndexPool(): pg.Pool | null {
  return getReadPool();
}

const POOL_NFT_TTL_MS = 60_000;
let spectrumNftCache = new Set<string>();
let lithosNftCache = new Set<string>();
let poolNftAt = 0;
let poolNftInflight: Promise<void> | null = null;

/** Last successful Spectrum `defi.pool_registry` NFT set. Empty until first refresh. */
export function cachedSpectrumPoolNfts(): Set<string> {
  return spectrumNftCache;
}

export function cachedLithosPoolNfts(): Set<string> {
  return lithosNftCache;
}

export function cachedDexLockHints(): {
  poolNftIds: Set<string>;
  lithosNftIds: Set<string>;
} {
  return { poolNftIds: spectrumNftCache, lithosNftIds: lithosNftCache };
}

/** Soft: missing schema / load skip leaves the previous set. */
export function refreshSpectrumPoolNfts(): Promise<void> {
  if (poolNftInflight) return poolNftInflight;
  if (poolNftAt > 0 && Date.now() - poolNftAt < POOL_NFT_TTL_MS) {
    return Promise.resolve();
  }
  poolNftInflight = (async () => {
    const p = getIndexPool();
    if (p) {
      try {
        const r = await p.query<{ pool_id: string; venue: string | null }>(
          `SELECT pool_id, venue FROM defi.pool_registry WHERE pool_id IS NOT NULL`
        );
        const spectrum = new Set<string>();
        const lithos = new Set<string>();
        for (const row of r.rows) {
          const id = String(row.pool_id).trim().toLowerCase();
          if (id.length !== 64 || isAgeUsdBankNft(id)) continue;
          const venue = String(row.venue || "").toLowerCase();
          if (venue === "lithos_dex") lithos.add(id);
          else spectrum.add(id);
        }
        spectrumNftCache = spectrum;
        lithosNftCache = lithos;
      } catch {
        /* missing schema / load skip — do not trip lastFail */
      }
    }
    poolNftAt = Date.now();
    poolNftInflight = null;
  })();
  return poolNftInflight;
}

async function q<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[] | null> {
  const p = getIndexPool();
  if (!p) return null;
  // brief circuit after failure
  if (Date.now() - lastFail < 3000) return null;
  try {
    const r = await p.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    lastFail = Date.now();
    return null;
  }
}

/** Address reads: override the pool's 4s statement_timeout. Do not trip lastFail (that poisons list snapshots). */
async function qSlow<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  timeoutMs = 12000,
  localSql: string[] = []
): Promise<T[] | null> {
  const p = getIndexPool();
  if (!p) return null;
  let c: pg.PoolClient | null = null;
  try {
    c = await p.connect();
    await c.query("BEGIN");
    await c.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.trunc(timeoutMs))}`);
    for (const extra of localSql) await c.query(extra);
    const r = await c.query<T>(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) {
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

/**
 * boxes_address_idx / boxes_unspent_idx are partial `length(address) <= 200`.
 * node-pg generic plans cannot prove that from `address = $1` alone, so GET
 * seq-scans boxes (~seconds per address). Repeat the predicate in SQL.
 * Longer P2S: boxes_unspent_long_md5_idx.
 */
const BOXES_ADDRESS_BTREE_MAX = 200;

function boxesAddressWhere(address: string, unspentOnly: boolean, alias?: string): string {
  const p = alias ? `${alias}.` : "";
  const col = `${p}address`;
  const spent = unspentOnly ? `${p}spent_tx_id IS NULL AND ` : "";
  if (address.length > BOXES_ADDRESS_BTREE_MAX) {
    return `${spent}${col} IS NOT NULL
      AND length(${col}) > ${BOXES_ADDRESS_BTREE_MAX}
      AND md5(${col}) = md5($1)
      AND ${col} = $1`;
  }
  return `${col} = $1 AND ${spent}length(${col}) <= ${BOXES_ADDRESS_BTREE_MAX}`;
}

function boxesUnspentWhere(address: string, alias?: string): string {
  return boxesAddressWhere(address, true, alias);
}

/**
 * Fast status for health/UI.
 * Do NOT COUNT(*) boxes (~3M+ rows) — that blocked /v1/health for minutes.
 * Heights come from indexer_state only; counts optional from state keys if present.
 */
export async function indexerStatus(tipHeight?: number | null): Promise<IndexerStatus> {
  if (!indexerConfigured()) {
    return {
      enabled: false,
      ok: false,
      lastHeight: null,
      minHeight: null,
      tipSeen: null,
      mode: null,
      lag: null,
      span: null,
      boxCount: null,
      unspentCount: null,
      tokenCount: null,
      diskFreeGb: null,
      detail: "DATABASE_URL not set",
    };
  }
  const tipKey = tipHeight ?? null;
  if (
    statusCache &&
    Date.now() - statusCache.at < STATUS_CACHE_MS &&
    statusCache.tip === tipKey
  ) {
    return statusCache.value;
  }
  const rows = await q<{ key: string; value: string }>(
    "SELECT key, value FROM indexer_state"
  );
  if (!rows) {
    const failed: IndexerStatus = {
      enabled: true,
      ok: false,
      lastHeight: null,
      minHeight: null,
      tipSeen: null,
      mode: null,
      lag: null,
      span: null,
      boxCount: null,
      unspentCount: null,
      tokenCount: null,
      diskFreeGb: null,
      detail: "db_unreachable",
    };
    statusCache = { at: Date.now(), tip: tipKey, value: failed };
    return failed;
  }
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const lastHeight = map.last_height ? Number(map.last_height) : null;
  const minHeight = map.min_height ? Number(map.min_height) : null;
  const tipSeen = map.tip_seen ? Number(map.tip_seen) : null;
  const tip = tipHeight ?? tipSeen;
  const maxH = lastHeight;
  const span =
    minHeight != null && maxH != null && maxH >= minHeight
      ? maxH - minHeight + 1
      : null;
  // optional precomputed counters written by indexer (never full-table scan here)
  const boxCount = map.box_count ? Number(map.box_count) : null;
  const unspentCount = map.unspent_count ? Number(map.unspent_count) : null;
  const tokenCount = map.token_count ? Number(map.token_count) : null;
  // Honest backfill: target 0 = genesis. Never report 100% until minHeight <= target.
  const backfillTarget = map.backfill_target != null ? Number(map.backfill_target) : 0;
  let backfillPct: number | null = null;
  if (tip != null && tip > 0 && minHeight != null) {
    const target = backfillTarget;
    const denom = Math.max(1, tip - target);
    const done = Math.max(0, tip - minHeight);
    backfillPct = Math.min(99.99, Math.round((done / denom) * 10000) / 100);
    if (minHeight <= target) backfillPct = 100;
  }
  const value: IndexerStatus = {
    enabled: true,
    ok: lastHeight != null && lastHeight > 0,
    lastHeight,
    minHeight,
    tipSeen,
    tipHeight: tip ?? null,
    mode: map.mode ?? null,
    lag: tip != null && lastHeight != null ? tip - lastHeight : null,
    span,
    boxCount,
    unspentCount,
    tokenCount,
    diskFreeGb: map.disk_free_gb ? Number(map.disk_free_gb) : null,
    backfillTarget,
    backfillPct,
    utxoIndexed: true,
    addressIndex: true,
    mempoolOk: true,
    detail: boxCount == null ? "counts_skipped_fast_health" : undefined,
  };
  statusCache = { at: Date.now(), tip: tipKey, value };
  return value;
}

/** Prefer indexer when lag small enough (warm tip). */
export async function indexerWarm(
  tipHeight?: number | null,
  maxLag = 5
): Promise<boolean> {
  const st = await indexerStatus(tipHeight);
  if (!st.ok || st.lastHeight == null) return false;
  if (st.lag == null) return st.lastHeight > 0;
  return st.lag <= maxLag;
}

export type IdxBox = {
  boxId: string;
  value: number;
  creationHeight: number | null;
  address: string | null;
  ergoTree: string | null;
  creationTxId: string | null;
  spentTxId: string | null;
  spentHeight: number | null;
  /** output index when known (node / boxes.output_index) */
  index?: number | null;
  additionalRegisters?: Record<string, unknown> | null;
  assets: { tokenId: string; amount: string }[];
};

export async function addressUnspentBoxes(
  address: string,
  offset: number,
  limit: number
): Promise<{ items: IdxBox[]; total: number } | null> {
  const where = boxesUnspentWhere(address);
  const tot = await q<{ c: string }>(
    `SELECT count(*)::text AS c FROM boxes WHERE ${where}`,
    [address]
  );
  if (!tot) return null;
  const rows = await q<{
    box_id: string;
    value_nano: string;
    creation_height: string | null;
    address: string | null;
    ergo_tree: string | null;
    creation_tx_id: string | null;
    spent_tx_id: string | null;
    spent_height: string | null;
  }>(
    `SELECT box_id, value_nano, creation_height, address, ergo_tree,
            creation_tx_id, spent_tx_id, spent_height
     FROM boxes
     WHERE ${where}
     ORDER BY creation_height DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [address, limit, offset]
  );
  if (!rows) return null;

  const items: IdxBox[] = [];
  for (const r of rows) {
    const assets =
      (await q<{ token_id: string; amount: string }>(
        `SELECT token_id, amount::text AS amount FROM box_assets WHERE box_id = $1`,
        [r.box_id]
      )) ?? [];
    items.push({
      boxId: r.box_id,
      value: Number(r.value_nano),
      creationHeight: r.creation_height != null ? Number(r.creation_height) : null,
      address: r.address,
      ergoTree: r.ergo_tree,
      creationTxId: r.creation_tx_id,
      spentTxId: r.spent_tx_id,
      spentHeight: r.spent_height != null ? Number(r.spent_height) : null,
      assets: assets.map((a) => ({ tokenId: a.token_id, amount: a.amount })),
    });
  }
  return { items, total: Number(tot[0].c) };
}

export type IdxBoxRow = {
  boxId: string;
  value: string;
  ergoTree: string | null;
  address: string | null;
  creationHeight: number | null;
  creationTxId: string | null;
  spentTxId: string | null;
  spentHeight: number | null;
  index: number | null;
  gix: number | null;
  additionalRegisters: Record<string, unknown> | null;
  assets: { tokenId: string; amount: string }[];
};

function parseGix(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function parseRegsJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function registerHex(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.serializedValue === "string") return o.serializedValue;
    if (typeof o.renderedValue === "string") return o.renderedValue;
  }
  return null;
}

function regsAsHexMap(issuanceRegs: unknown): Record<string, string> {
  const regs = parseRegsJson(issuanceRegs);
  if (!regs) return {};
  const strs: Record<string, string> = {};
  for (const [k, v] of Object.entries(regs)) {
    const hex = registerHex(v);
    if (hex) strs[k] = hex;
  }
  return strs;
}

/** EIP-4 description: tokens.description, else R5 on the issuance box (token id = box id). */
function eip4TextNameFromRegs(issuanceRegs: unknown): string | null {
  const decoded = decodeRegisterMap(regsAsHexMap(issuanceRegs));
  const r4 = decoded.R4;
  if (!r4 || r4.kind !== "text") return null;
  const text = (r4.text || "").trim();
  const n = [...text].length;
  if (n < 1 || n > 64) return null;
  if (/^https?:\/\//i.test(text) || text.startsWith("ipfs://")) return null;
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) return null;
  return text;
}

type MintNftCtx = {
  mintRegs: unknown;
  issuerRegs: unknown;
  issuerAddress: string | null;
  mintTxId: string | null;
};

/** EIP-4 lives on the mint *output*; EIP-24 royalty/collection on the issuer box. */
async function mintNftContextByTokenIds(
  ids: string[]
): Promise<Map<string, MintNftCtx>> {
  const map = new Map<string, MintNftCtx>();
  const uniq = [...new Set(ids.filter((id) => id && id.length === 64))];
  if (!uniq.length) return map;
  const rows = await q<{
    token_id: string;
    mint_regs: unknown;
    issuer_regs: unknown;
    issuer_address: string | null;
    mint_tx_id: string | null;
  }>(
    packedReadEnabled()
      ? `SELECT DISTINCT ON (x.token_id)
            x.token_id,
            o.additional_registers AS mint_regs,
            spent.additional_registers AS issuer_regs,
            ad.address AS issuer_address,
            encode(spent.spent_tx_id, 'hex') AS mint_tx_id
       FROM unnest($1::text[]) AS x(token_id)
       JOIN packed.boxes spent ON spent.box_id = decode(lower(x.token_id), 'hex')
       JOIN packed.boxes o ON o.creation_tx_id = spent.spent_tx_id
       JOIN packed.box_assets a ON a.box_id = o.box_id AND a.token_id = spent.box_id
       LEFT JOIN packed.addr ad ON ad.id = spent.addr_id
      ORDER BY x.token_id,
               CASE WHEN o.additional_registers ? 'R4' THEN 0 ELSE 1 END,
               o.output_index NULLS LAST`
      : `SELECT DISTINCT ON (x.token_id)
            x.token_id,
            o.additional_registers AS mint_regs,
            spent.additional_registers AS issuer_regs,
            spent.address AS issuer_address,
            spent.spent_tx_id AS mint_tx_id
       FROM unnest($1::text[]) AS x(token_id)
       JOIN boxes spent ON spent.box_id = x.token_id
       JOIN boxes o ON o.creation_tx_id = spent.spent_tx_id
       JOIN box_assets a ON a.box_id = o.box_id AND a.token_id = x.token_id
      ORDER BY x.token_id,
               CASE WHEN o.additional_registers ? 'R4' THEN 0 ELSE 1 END,
               o.output_index NULLS LAST`,
    [uniq]
  );
  for (const r of rows ?? []) {
    map.set(r.token_id, {
      mintRegs: r.mint_regs,
      issuerRegs: r.issuer_regs,
      issuerAddress: r.issuer_address,
      mintTxId: r.mint_tx_id,
    });
  }
  return map;
}

/** EIP-4 lives on the mint *output*, not on boxes.box_id = token_id (spent input). */
async function mintOutputRegsByTokenIds(
  ids: string[]
): Promise<Map<string, unknown>> {
  const ctx = await mintNftContextByTokenIds(ids);
  const map = new Map<string, unknown>();
  for (const [id, c] of ctx) map.set(id, c.mintRegs);
  return map;
}

let nftKindColumn: boolean | null = null;

async function tokensHaveNftKindColumn(): Promise<boolean> {
  if (nftKindColumn != null) return nftKindColumn;
  const rows = await q<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tokens'
          AND column_name = 'nft_kind'
     ) AS ok`
  );
  if (!rows) return false;
  nftKindColumn = rows[0]?.ok === true;
  return nftKindColumn;
}

export async function nftKindCountsFromIndex(): Promise<Record<NftKind, number> | null> {
  if (!(await tokensHaveNftKindColumn())) {
    return {
      image: 0,
      audio: 0,
      video: 0,
      collection: 0,
      file: 0,
      membership: 0,
    };
  }
  const rows = await q<{ k: string; c: string }>(
    `SELECT nft_kind AS k, count(*)::text AS c
       FROM tokens
      WHERE emission = 1
        AND nft_kind IS NOT NULL
        AND btrim(nft_kind) <> ''
        AND token_id <> ALL($1::text[])
      GROUP BY nft_kind`,
    [NFT_SKIP_IDS]
  );
  if (!rows) return null;
  const out: Record<NftKind, number> = {
    image: 0,
    audio: 0,
    video: 0,
    collection: 0,
    file: 0,
    membership: 0,
  };
  for (const r of rows) {
    if (isNftKind(r.k)) out[r.k] = Number(r.c) || 0;
  }
  return out;
}

function eip4DescriptionFromIndex(stored: string | null, issuanceRegs: unknown): string | null {
  const col = stored?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  if (col && !/^https?:\/\//i.test(col) && !col.startsWith("ipfs://")) return col;
  const regs = parseRegsJson(issuanceRegs);
  if (!regs) return null;
  const strs: Record<string, string> = {};
  for (const [k, v] of Object.entries(regs)) {
    const hex = registerHex(v);
    if (hex) strs[k] = hex;
  }
  const r5 = decodeRegisterMap(strs).R5;
  const text = r5?.text?.trim() ?? "";
  if (!text || r5?.kind === "url") return null;
  if (/^https?:\/\//i.test(text) || text.startsWith("ipfs://")) return null;
  return text;
}

/** One box by id. SELECT only. Amounts as text. */
export async function getBoxById(boxId: string): Promise<IdxBoxRow | null> {
  if (packedReadEnabled() && !isHex64(boxId)) return null;
  const rows = await qSlow<{
    box_id: string;
    value_nano: string;
    ergo_tree: string | null;
    address: string | null;
    creation_height: string | null;
    creation_tx_id: string | null;
    spent_tx_id: string | null;
    spent_height: string | null;
    output_index: string | null;
    additional_registers: unknown;
    gix: string | null;
  }>(
    packedReadEnabled()
      ? PACKED_BOX_BY_ID_SQL
      : `SELECT box_id, value_nano::text AS value_nano, ergo_tree, address,
            creation_height::text AS creation_height, creation_tx_id, spent_tx_id,
            spent_height::text AS spent_height, output_index::text AS output_index,
            additional_registers, gix::text AS gix
     FROM boxes WHERE box_id = $1`,
    [boxId],
    4000
  );
  if (!rows?.[0]) return null;
  const r = rows[0];
  const assets = await assetsForBoxes([r.box_id]);
  const creationHeight =
    r.creation_height != null ? Number(r.creation_height) : null;
  return {
    boxId: r.box_id,
    value: r.value_nano || "0",
    ergoTree: r.ergo_tree,
    address: r.address,
    creationHeight: Number.isFinite(creationHeight as number)
      ? creationHeight
      : null,
    creationTxId: r.creation_tx_id,
    spentTxId: r.spent_tx_id,
    spentHeight: r.spent_height != null ? Number(r.spent_height) : null,
    index: r.output_index != null ? Number(r.output_index) : null,
    gix: parseGix(r.gix),
    additionalRegisters: parseRegsJson(r.additional_registers),
    assets: assets.get(r.box_id) ?? [],
  };
}

export type TxHead = {
  id: string;
  height: number | null;
  timestampMs: number | null;
  blockId: string | null;
};

/** Height + time + block id for a handful of tx ids. SELECT only — not getTxById I/O. */
export async function getTxHeads(ids: string[]): Promise<Map<string, TxHead>> {
  const uniq = [
    ...new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id))),
  ].filter((id) => !packedReadEnabled() || isHex64(id));
  const out = new Map<string, TxHead>();
  if (!uniq.length) return out;
  const rows = await qSlow<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    block_id: string | null;
  }>(
    packedReadEnabled()
      ? PACKED_TX_HEADS_SQL
      : `SELECT t.id, t.height::text AS height, t.timestamp_ms::text AS timestamp_ms,
            b.id AS block_id
     FROM transactions t
     LEFT JOIN blocks b ON b.height = t.height
     WHERE t.id = ANY($1::text[])`,
    [uniq],
    3000
  );
  for (const r of rows ?? []) {
    const height = r.height != null ? Number(r.height) : NaN;
    const ts = r.timestamp_ms != null ? Number(r.timestamp_ms) : NaN;
    out.set(r.id, {
      id: r.id,
      height: Number.isFinite(height) ? height : null,
      timestampMs: Number.isFinite(ts) ? ts : null,
      blockId: r.block_id ?? null,
    });
  }
  return out;
}

type BoxSqlRow = {
  box_id: string;
  value_nano: string;
  ergo_tree: string | null;
  address: string | null;
  creation_height: string | null;
  creation_tx_id: string | null;
  spent_tx_id: string | null;
  spent_height: string | null;
  output_index: string | null;
  additional_registers: unknown;
  gix: string | null;
};

function boxSqlToRow(
  r: BoxSqlRow,
  assets: Map<string, { tokenId: string; amount: string }[]>
): IdxBoxRow {
  const creationHeight =
    r.creation_height != null ? Number(r.creation_height) : null;
  return {
    boxId: r.box_id,
    value: r.value_nano || "0",
    ergoTree: r.ergo_tree,
    address: r.address,
    creationHeight: Number.isFinite(creationHeight as number)
      ? creationHeight
      : null,
    creationTxId: r.creation_tx_id,
    spentTxId: r.spent_tx_id,
    spentHeight: r.spent_height != null ? Number(r.spent_height) : null,
    index: r.output_index != null ? Number(r.output_index) : null,
    gix: parseGix(r.gix),
    additionalRegisters: parseRegsJson(r.additional_registers),
    assets: assets.get(r.box_id) ?? [],
  };
}

const BOX_IO_SQL = `SELECT box_id, value_nano::text AS value_nano, ergo_tree, address,
            creation_height::text AS creation_height, creation_tx_id, spent_tx_id,
            spent_height::text AS spent_height, output_index::text AS output_index,
            additional_registers, gix::text AS gix
     FROM boxes`;

export type IdxTxDetail = {
  id: string;
  blockId: string | null;
  inclusionHeight: number | null;
  timestamp: number | null;
  size: number | null;
  fee: string | null;
  valueNano: string | null;
  inputCount: number | null;
  outputCount: number | null;
  indexInBlock: number | null;
  gix: number | null;
  prevId: string | null;
  nextId: string | null;
  inputs: IdxBoxRow[];
  outputs: IdxBoxRow[];
  assetsComplete: boolean;
};

/**
 * Confirmed tx from Postgres. A row in `transactions` always returns — even when
 * boxes are still thin (backfill window). Never null because I/O is incomplete.
 */
export async function getTxById(txId: string): Promise<IdxTxDetail | null> {
  const packed = packedReadEnabled();
  if (packed && !isHex64(txId)) return null;
  const head = await qSlow<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    size: string | null;
    fee: string | null;
    value_nano: string | null;
    input_count: string | null;
    output_count: string | null;
    block_id: string | null;
    index_in_block: string | null;
    gix: string | null;
  }>(
    packed
      ? PACKED_TX_BY_ID_SQL
      : `SELECT t.id, t.height::text AS height, t.timestamp_ms::text AS timestamp_ms,
            t.size::text AS size, t.fee::text AS fee,
            t.value_nano::text AS value_nano,
            t.input_count::text AS input_count, t.output_count::text AS output_count,
            t.index_in_block::text AS index_in_block,
            t.gix::text AS gix,
            b.id AS block_id
     FROM transactions t
     LEFT JOIN blocks b ON b.height = t.height
     WHERE t.id = $1`,
    [txId],
    4000
  );
  if (!head?.[0]) return null;
  const t = head[0];
  const height = t.height != null ? Number(t.height) : NaN;
  const indexInBlock = t.index_in_block != null ? Number(t.index_in_block) : NaN;
  const heightOk = Number.isFinite(height);
  const indexOk = Number.isFinite(indexInBlock);

  const [outRows, inRows, neighbors] = await Promise.all([
    qSlow<BoxSqlRow>(
      packed
        ? `${PACKED_BOX_IO_SQL} WHERE b.creation_tx_id = decode(lower($1), 'hex')
       ORDER BY b.output_index NULLS LAST, b.box_id`
        : `${BOX_IO_SQL} WHERE creation_tx_id = $1
       ORDER BY output_index NULLS LAST, box_id`,
      [txId],
      4000
    ),
    qSlow<BoxSqlRow>(
      packed
        ? `${PACKED_BOX_IO_SQL} WHERE b.spent_tx_id = decode(lower($1), 'hex')
       ORDER BY b.box_id`
        : `${BOX_IO_SQL} WHERE spent_tx_id = $1
       ORDER BY box_id`,
      [txId],
      4000
    ),
    heightOk && indexOk
      ? qSlow<{ prev_id: string | null; next_id: string | null }>(
          packed
            ? PACKED_TX_NEIGHBOR_SQL
            : `SELECT
             (SELECT id FROM transactions WHERE height = $1 AND index_in_block = $2 LIMIT 1) AS prev_id,
             (SELECT id FROM transactions WHERE height = $1 AND index_in_block = $3 LIMIT 1) AS next_id`,
          [height, indexInBlock - 1, indexInBlock + 1],
          4000
        )
      : Promise.resolve(null),
  ]);

  const outs = outRows ?? [];
  const ins = inRows ?? [];
  const assetResult = await assetsForBoxesChecked([
    ...outs.map((r) => r.box_id),
    ...ins.map((r) => r.box_id),
  ]);
  const wantIn = t.input_count != null ? Number(t.input_count) : NaN;
  const wantOut = t.output_count != null ? Number(t.output_count) : NaN;
  const ts = t.timestamp_ms != null ? Number(t.timestamp_ms) : null;
  const size = t.size != null ? Number(t.size) : null;
  const hop = neighbors?.[0];
  const outputs = outs.map((r) => boxSqlToRow(r, assetResult.assets));
  const inputs = ins.map((r) => boxSqlToRow(r, assetResult.assets));
  const paid = minerFeeFromOutputs(outputs);
  const fee =
    paid > 0 ? String(Math.trunc(paid)) : t.fee;
  return {
    id: t.id,
    blockId: t.block_id,
    inclusionHeight: heightOk ? height : null,
    timestamp: Number.isFinite(ts as number) ? ts : null,
    size: Number.isFinite(size as number) ? size : null,
    fee,
    valueNano: t.value_nano,
    inputCount: Number.isFinite(wantIn) ? wantIn : null,
    outputCount: Number.isFinite(wantOut) ? wantOut : null,
    indexInBlock: indexOk ? indexInBlock : null,
    gix: parseGix(t.gix),
    prevId: hop?.prev_id ?? null,
    nextId: hop?.next_id ?? null,
    inputs,
    outputs,
    assetsComplete: assetResult.complete,
  };
}

export type GixWatermark = { maxBoxGix: number | null; maxTxGix: number | null };

let gixWmCache: { at: number; value: GixWatermark } | null = null;
const GIX_WM_MS = 2_000;

/** tip watermark = *_gix_next − 1. Never MAX(gix). */
export async function readGixWatermark(): Promise<GixWatermark> {
  if (gixWmCache && Date.now() - gixWmCache.at < GIX_WM_MS) return gixWmCache.value;
  const rows = await q<{ key: string; value: string }>(
    `SELECT key, value FROM indexer_state WHERE key IN ('box_gix_next', 'tx_gix_next')`
  );
  const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const value: GixWatermark = {
    maxBoxGix: gixMaxFromNext(map.get("box_gix_next")),
    maxTxGix: gixMaxFromNext(map.get("tx_gix_next")),
  };
  gixWmCache = { at: Date.now(), value };
  return value;
}

export type GixStreamBox = IdxBoxRow & { blockId: string | null };

const BOX_GIX_SQL = `SELECT b.box_id, b.value_nano::text AS value_nano, b.ergo_tree, b.address,
            b.creation_height::text AS creation_height, b.creation_tx_id, b.spent_tx_id,
            b.spent_height::text AS spent_height, b.output_index::text AS output_index,
            b.additional_registers, b.gix::text AS gix,
            bl.id AS block_id
     FROM boxes b
     LEFT JOIN blocks bl ON bl.height = b.creation_height`;

const PACKED_BOX_GIX_SQL = `SELECT encode(b.box_id, 'hex') AS box_id,
            b.value_nano::text AS value_nano, sc.ergo_tree, ad.address,
            b.creation_height::text AS creation_height,
            encode(b.creation_tx_id, 'hex') AS creation_tx_id,
            encode(b.spent_tx_id, 'hex') AS spent_tx_id,
            b.spent_height::text AS spent_height,
            b.output_index::text AS output_index,
            b.additional_registers, b.gix::text AS gix,
            encode(bl.id, 'hex') AS block_id
     FROM packed.boxes b
     LEFT JOIN packed.addr ad ON ad.id = b.addr_id
     LEFT JOIN packed.script sc ON sc.id = b.script_id
     LEFT JOIN packed.blocks bl ON bl.height = b.creation_height`;

type BoxGixSqlRow = BoxSqlRow & { block_id: string | null };

function boxGixToRow(
  r: BoxGixSqlRow,
  assets: Map<string, { tokenId: string; amount: string }[]>
): GixStreamBox {
  return { ...boxSqlToRow(r, assets), blockId: r.block_id };
}

const TREE_LIMIT_MAX = 100;
const TREE_OFFSET_MAX = 500;

/** Exact ErgoTree via script md5, then boxes by script_id. No boxes seq-scan. */
export async function boxesByErgoTree(
  tree: string,
  offset: number,
  limit: number,
  unspentOnly: boolean
): Promise<{ items: IdxBoxRow[]; hasMore: boolean } | null> {
  const take = Math.max(1, Math.min(TREE_LIMIT_MAX, Math.floor(limit)));
  const skip = Math.max(0, Math.min(TREE_OFFSET_MAX, Math.floor(offset)));
  const script = await qSlow<{ id: string }>(
    `SELECT id::text AS id
       FROM packed.script
      WHERE tree_md5 = md5($1) AND ergo_tree = $1
      LIMIT 1`,
    [tree],
    GIX_STREAM_TIMEOUT_MS
  );
  if (!script) return null;
  if (!script.length) return { items: [], hasMore: false };
  const where = unspentOnly
    ? `b.script_id = $1 AND b.spent_tx_id IS NULL`
    : `b.script_id = $1`;
  const rows = await qSlow<BoxSqlRow>(
    `SELECT encode(b.box_id, 'hex') AS box_id,
            b.value_nano::text AS value_nano,
            s.ergo_tree,
            a.address,
            b.creation_height::text AS creation_height,
            encode(b.creation_tx_id, 'hex') AS creation_tx_id,
            encode(b.spent_tx_id, 'hex') AS spent_tx_id,
            b.spent_height::text AS spent_height,
            b.output_index::text AS output_index,
            b.additional_registers,
            b.gix::text AS gix
       FROM packed.boxes b
       LEFT JOIN packed.addr a ON a.id = b.addr_id
       LEFT JOIN packed.script s ON s.id = b.script_id
      WHERE ${where}
      ORDER BY b.creation_height DESC, b.box_id DESC
      LIMIT $2 OFFSET $3`,
    [script[0].id, take + 1, skip],
    GIX_STREAM_TIMEOUT_MS
  );
  if (!rows) return null;
  const page = rows.slice(0, take);
  const assetResult = await assetsForBoxesChecked(
    page.map((r) => r.box_id),
    GIX_STREAM_TIMEOUT_MS
  );
  if (!assetResult.complete) return null;
  return {
    items: page.map((r) => boxSqlToRow(r, assetResult.assets)),
    hasMore: rows.length > take,
  };
}

const TEMPLATE_LOCAL = [
  "SET LOCAL jit = off",
  "SET LOCAL max_parallel_workers_per_gather = 0",
];

function templateBoxSql(unspentOnly: boolean): string {
  const spent = unspentOnly ? "AND b.spent_tx_id IS NULL" : "";
  return `SELECT encode(b.box_id, 'hex') AS box_id,
            b.value_nano::text AS value_nano,
            s.ergo_tree,
            a.address,
            b.creation_height::text AS creation_height,
            encode(b.creation_tx_id, 'hex') AS creation_tx_id,
            encode(b.spent_tx_id, 'hex') AS spent_tx_id,
            b.spent_height::text AS spent_height,
            b.output_index::text AS output_index,
            b.additional_registers,
            b.gix::text AS gix
       FROM packed.box_template t
       JOIN packed.boxes b ON b.box_id = t.box_id
       LEFT JOIN packed.addr a ON a.id = b.addr_id
       LEFT JOIN packed.script s ON s.id = b.script_id
      WHERE t.template_hash = $1
        ${spent}
      ORDER BY t.creation_height DESC, t.box_id DESC
      LIMIT $2 OFFSET $3`;
}

/** Boxes sharing one ErgoTree template hash. Index on packed.box_template. No boxes seq-scan. */
export async function boxesByErgoTreeTemplate(
  hashHex: string,
  offset: number,
  limit: number,
  unspentOnly: boolean
): Promise<{ items: IdxBoxRow[]; hasMore: boolean } | null> {
  const take = Math.max(1, Math.min(TREE_LIMIT_MAX, Math.floor(limit)));
  const skip = Math.max(0, Math.min(TREE_OFFSET_MAX, Math.floor(offset)));
  const rows = await qSlow<BoxSqlRow>(
    templateBoxSql(unspentOnly),
    [Buffer.from(hashHex, "hex"), take + 1, skip],
    GIX_STREAM_TIMEOUT_MS,
    TEMPLATE_LOCAL
  );
  if (!rows) return null;
  const page = rows.slice(0, take);
  const assetResult = await assetsForBoxesChecked(
    page.map((r) => r.box_id),
    GIX_STREAM_TIMEOUT_MS
  );
  if (!assetResult.complete) return null;
  return {
    items: page.map((r) => boxSqlToRow(r, assetResult.assets)),
    hasMore: rows.length > take,
  };
}

/** Unspent boxes created in the last N header epochs. Index on creation_height. */
export async function unspentBoxesByLastEpochs(
  epochs: number,
  limit: number
): Promise<IdxBoxRow[] | null> {
  const n = Math.max(1, Math.min(4, Math.floor(epochs)));
  const take = Math.max(1, Math.min(TREE_LIMIT_MAX, Math.floor(limit)));
  const tipRow = await qSlow<{ h: string }>(
    `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`,
    [],
    GIX_STREAM_TIMEOUT_MS
  );
  if (!tipRow) return null;
  const tip = Number(tipRow[0]?.h ?? 0);
  if (!Number.isFinite(tip) || tip <= 0) return [];
  const floor = Math.max(0, tip - n * 1024);
  const rows = await qSlow<BoxSqlRow>(
    `SELECT encode(b.box_id, 'hex') AS box_id,
            b.value_nano::text AS value_nano,
            s.ergo_tree,
            a.address,
            b.creation_height::text AS creation_height,
            encode(b.creation_tx_id, 'hex') AS creation_tx_id,
            encode(b.spent_tx_id, 'hex') AS spent_tx_id,
            b.spent_height::text AS spent_height,
            b.output_index::text AS output_index,
            b.additional_registers,
            b.gix::text AS gix
       FROM packed.boxes b
       LEFT JOIN packed.addr a ON a.id = b.addr_id
       LEFT JOIN packed.script s ON s.id = b.script_id
      WHERE b.spent_tx_id IS NULL
        AND b.creation_height IS NOT NULL
        AND b.creation_height > $1
      ORDER BY b.creation_height DESC, b.box_id DESC
      LIMIT $2`,
    [floor, take],
    GIX_STREAM_TIMEOUT_MS
  );
  if (!rows) return null;
  const assetResult = await assetsForBoxesChecked(
    rows.map((r) => r.box_id),
    GIX_STREAM_TIMEOUT_MS
  );
  if (!assetResult.complete) return null;
  return rows.map((r) => boxSqlToRow(r, assetResult.assets));
}

export async function unspentBoxesByGix(
  minGix: number,
  maxGix: number
): Promise<GixStreamBox[] | null> {
  const rows = await qSlow<BoxGixSqlRow>(
    `${packedReadEnabled() ? PACKED_BOX_GIX_SQL : BOX_GIX_SQL}
     WHERE b.gix >= $1 AND b.gix <= $2 AND b.spent_tx_id IS NULL
     ORDER BY b.gix`,
    [minGix, maxGix],
    GIX_STREAM_TIMEOUT_MS
  );
  if (!rows) return null;
  const assetResult = await assetsForBoxesChecked(
    rows.map((r) => r.box_id),
    GIX_STREAM_TIMEOUT_MS
  );
  if (!assetResult.complete) return null;
  return rows.map((r) => boxGixToRow(r, assetResult.assets));
}

export type GixStreamTx = {
  id: string;
  blockId: string | null;
  inclusionHeight: number | null;
  timestamp: number | null;
  size: number | null;
  indexInBlock: number | null;
  gix: number | null;
  inputs: GixStreamBox[];
  outputs: GixStreamBox[];
};

export async function transactionsByGix(
  minGix: number,
  maxGix: number
): Promise<GixStreamTx[] | null> {
  const heads = await qSlow<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    size: string | null;
    index_in_block: string | null;
    gix: string | null;
    block_id: string | null;
  }>(
    packedReadEnabled()
      ? `SELECT encode(t.id, 'hex') AS id, t.height::text AS height,
                t.timestamp_ms::text AS timestamp_ms, t.size::text AS size,
                t.index_in_block::text AS index_in_block, t.gix::text AS gix,
                encode(b.id, 'hex') AS block_id
           FROM packed.transactions t
           LEFT JOIN packed.blocks b ON b.height = t.height
          WHERE t.gix >= $1 AND t.gix <= $2
          ORDER BY t.gix`
      : `SELECT t.id, t.height::text AS height, t.timestamp_ms::text AS timestamp_ms,
            t.size::text AS size, t.index_in_block::text AS index_in_block,
            t.gix::text AS gix, b.id AS block_id
     FROM transactions t
     LEFT JOIN blocks b ON b.height = t.height
     WHERE t.gix >= $1 AND t.gix <= $2
     ORDER BY t.gix`,
    [minGix, maxGix],
    GIX_STREAM_TIMEOUT_MS
  );
  if (!heads) return null;
  if (!heads.length) return [];
  const ids = heads.map((t) => t.id);
  const gixFrom = packedReadEnabled() ? PACKED_BOX_GIX_SQL : BOX_GIX_SQL;
  const gixByTx = packedReadEnabled()
    ? `IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x WHERE x ~ '^[0-9a-fA-F]{64}$')`
    : `= ANY($1::text[])`;
  const [outRows, inRows] = await Promise.all([
    qSlow<BoxGixSqlRow>(
      `${gixFrom}
       WHERE b.creation_tx_id ${gixByTx}
       ORDER BY b.creation_tx_id, b.output_index NULLS LAST, b.box_id`,
      [ids],
      GIX_STREAM_TIMEOUT_MS
    ),
    qSlow<BoxGixSqlRow>(
      `${gixFrom}
       WHERE b.spent_tx_id ${gixByTx}
       ORDER BY b.spent_tx_id, b.box_id`,
      [ids],
      GIX_STREAM_TIMEOUT_MS
    ),
  ]);
  if (!outRows || !inRows) return null;
  const assetResult = await assetsForBoxesChecked(
    [...outRows, ...inRows].map((r) => r.box_id),
    GIX_STREAM_TIMEOUT_MS
  );
  if (!assetResult.complete) return null;
  const outsByTx = new Map<string, GixStreamBox[]>();
  for (const r of outRows) {
    if (!r.creation_tx_id) continue;
    const list = outsByTx.get(r.creation_tx_id) ?? [];
    list.push(boxGixToRow(r, assetResult.assets));
    outsByTx.set(r.creation_tx_id, list);
  }
  const insByTx = new Map<string, GixStreamBox[]>();
  for (const r of inRows) {
    if (!r.spent_tx_id) continue;
    const list = insByTx.get(r.spent_tx_id) ?? [];
    list.push(boxGixToRow(r, assetResult.assets));
    insByTx.set(r.spent_tx_id, list);
  }
  return heads.map((t) => {
    const height = t.height != null ? Number(t.height) : NaN;
    const ts = t.timestamp_ms != null ? Number(t.timestamp_ms) : NaN;
    const size = t.size != null ? Number(t.size) : NaN;
    const indexInBlock = t.index_in_block != null ? Number(t.index_in_block) : NaN;
    return {
      id: t.id,
      blockId: t.block_id,
      inclusionHeight: Number.isFinite(height) ? height : null,
      timestamp: Number.isFinite(ts) ? ts : null,
      size: Number.isFinite(size) ? size : null,
      indexInBlock: Number.isFinite(indexInBlock) ? indexInBlock : null,
      gix: parseGix(t.gix),
      inputs: insByTx.get(t.id) ?? [],
      outputs: outsByTx.get(t.id) ?? [],
    };
  });
}

export type IdxTx = {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  size: number | null;
  fee: number | null;
};

/**
 * Unspent boxes that hold a token (Dexy/Bank/Spectrum protocol discovery).
 * Uses box_assets + boxes.spent_tx_id IS NULL — window = indexed tip/backfill.
 */
export async function unspentBoxesByTokenId(
  tokenId: string,
  offset: number,
  limit: number
): Promise<{ items: IdxBox[]; total: number } | null> {
  const tot = await q<{ c: string }>(
    `SELECT count(*)::text AS c
     FROM packed.box_assets a
     JOIN packed.boxes b ON b.box_id = a.box_id AND b.spent_tx_id IS NULL
     WHERE a.token_id = decode(lower($1), 'hex')`,
    [tokenId]
  );
  if (!tot) return null;
  const rows = await q<{
    box_id: string;
    value_nano: string;
    creation_height: string | null;
    address: string | null;
    ergo_tree: string | null;
    creation_tx_id: string | null;
    spent_tx_id: string | null;
    spent_height: string | null;
    output_index: string | null;
    additional_registers: unknown;
  }>(
    `SELECT encode(b.box_id, 'hex') AS box_id,
            b.value_nano, b.creation_height::text AS creation_height,
            ad.address, sc.ergo_tree,
            encode(b.creation_tx_id, 'hex') AS creation_tx_id,
            encode(b.spent_tx_id, 'hex') AS spent_tx_id,
            b.spent_height::text AS spent_height,
            b.output_index::text AS output_index,
            b.additional_registers
     FROM packed.box_assets a
     JOIN packed.boxes b ON b.box_id = a.box_id AND b.spent_tx_id IS NULL
     LEFT JOIN packed.addr ad ON ad.id = b.addr_id
     LEFT JOIN packed.script sc ON sc.id = b.script_id
     WHERE a.token_id = decode(lower($1), 'hex')
     ORDER BY b.creation_height DESC NULLS LAST, b.box_id
     LIMIT $2 OFFSET $3`,
    [tokenId, limit, offset]
  );
  if (!rows) return null;

  const items: IdxBox[] = [];
  for (const r of rows) {
    const assets =
      (await q<{ token_id: string; amount: string }>(
        `SELECT encode(token_id, 'hex') AS token_id, amount::text AS amount
           FROM packed.box_assets WHERE box_id = decode(lower($1), 'hex')`,
        [r.box_id]
      )) ?? [];
    items.push({
      boxId: r.box_id,
      value: Number(r.value_nano),
      creationHeight:
        r.creation_height != null ? Number(r.creation_height) : null,
      address: r.address,
      ergoTree: r.ergo_tree,
      creationTxId: r.creation_tx_id,
      spentTxId: r.spent_tx_id,
      spentHeight: r.spent_height != null ? Number(r.spent_height) : null,
      index: r.output_index != null ? Number(r.output_index) : null,
      additionalRegisters: parseRegsJson(r.additional_registers),
      assets: assets.map((a) => ({ tokenId: a.token_id, amount: a.amount })),
    });
  }
  return { items, total: Number(tot[0].c) };
}

export async function addressTransactions(
  address: string,
  offset: number,
  limit: number
): Promise<{ items: IdxTx[]; total: number } | null> {
  // Prefer address_tx index; fall back to boxes scan
  let tot = await q<{ c: string }>(
    `SELECT count(*)::text AS c FROM address_tx WHERE address = $1`,
    [address]
  );
  let rows = await q<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    size: string | null;
    fee: string | null;
  }>(
    `SELECT t.id, t.height::text, t.timestamp_ms::text, t.size::text, t.fee::text
     FROM address_tx a
     JOIN transactions t ON t.id = a.tx_id
     WHERE a.address = $1
     ORDER BY a.height DESC NULLS LAST, t.index_in_block DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [address, limit, offset]
  );
  if (!tot || !rows || (Number(tot[0]?.c || 0) === 0 && rows.length === 0)) {
    tot = await q<{ c: string }>(
      `SELECT count(DISTINCT t.id)::text AS c
       FROM transactions t
       JOIN boxes b ON b.creation_tx_id = t.id OR b.spent_tx_id = t.id
       WHERE b.address = $1 AND length(b.address) <= ${BOXES_ADDRESS_BTREE_MAX}`,
      [address]
    );
    if (!tot) return null;
    rows = await q<{
      id: string;
      height: string | null;
      timestamp_ms: string | null;
      size: string | null;
      fee: string | null;
    }>(
      `SELECT t.id, t.height::text, t.timestamp_ms::text, t.size::text, t.fee::text
       FROM transactions t
       WHERE t.id IN (
         SELECT DISTINCT x.tid FROM (
           SELECT creation_tx_id AS tid FROM boxes
            WHERE address = $1 AND length(address) <= ${BOXES_ADDRESS_BTREE_MAX}
              AND creation_tx_id IS NOT NULL
           UNION
           SELECT spent_tx_id AS tid FROM boxes
            WHERE address = $1 AND length(address) <= ${BOXES_ADDRESS_BTREE_MAX}
              AND spent_tx_id IS NOT NULL
         ) x
       )
       ORDER BY t.height DESC NULLS LAST, t.index_in_block DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [address, limit, offset]
    );
  }
  if (!tot || !rows) return null;
  return {
    total: Number(tot[0].c),
    items: rows.map((r) => ({
      id: r.id,
      inclusionHeight: r.height != null ? Number(r.height) : null,
      timestamp: r.timestamp_ms != null ? Number(r.timestamp_ms) : null,
      size: r.size != null ? Number(r.size) : null,
      fee: r.fee != null ? Number(r.fee) : null,
    })),
  };
}

async function tokenBalancesUtxoReady(): Promise<boolean> {
  const rows = await q<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = 'token_balances_utxo_v1'`
  );
  return Boolean(rows?.[0]?.value);
}

/** Confirmed token balances. Ledger first after UTXO sync; else unspent boxes. */
export async function addressTokensConfirmed(
  address: string
): Promise<{ tokenId: string; amount: string; firstHeight: number | null; lastHeight: number | null }[] | null> {
  const withH = await qSlow<{
    token_id: string;
    amount: string;
    first_height: string | null;
    last_height: string | null;
  }>(
    `SELECT token_id, amount::text AS amount,
            first_height::text, last_height::text
       FROM token_balances
      WHERE address = $1 AND amount > 0
      LIMIT 200`,
    [address]
  );
  const fromBal =
    withH ??
    (await qSlow<{ token_id: string; amount: string }>(
      `SELECT token_id, amount::text AS amount
         FROM token_balances
        WHERE address = $1 AND amount > 0
        LIMIT 200`,
      [address]
    ))?.map((t) => ({ ...t, first_height: null as string | null, last_height: null as string | null }));
  if (fromBal && fromBal.length > 0) {
    return fromBal.map((t) => ({
      tokenId: t.token_id,
      amount: t.amount,
      firstHeight: nHeight(t.first_height),
      lastHeight: nHeight(t.last_height),
    }));
  }
  if (await tokenBalancesUtxoReady()) {
    return [];
  }
  const toks = await qSlow<{ token_id: string; amount: string }>(
    `SELECT ba.token_id, SUM(ba.amount)::text AS amount
     FROM boxes b
     JOIN box_assets ba ON ba.box_id = b.box_id
     WHERE ${boxesUnspentWhere(address, "b")}
     GROUP BY ba.token_id
     LIMIT 200`,
    [address]
  );
  if (!toks) return null;
  return toks.map((t) => ({
    tokenId: t.token_id,
    amount: t.amount,
    firstHeight: null,
    lastHeight: null,
  }));
}

function nHeight(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Display-only float. Null when the raw amount does not fit in JS Number. */
function amountUiFromRaw(raw: string, decimals: number): number | null {
  try {
    const bi = BigInt(raw);
    const d =
      Number.isFinite(decimals) && decimals > 0
        ? Math.min(18, Math.trunc(decimals))
        : 0;
    if (d === 0) {
      if (bi > BigInt(Number.MAX_SAFE_INTEGER) || bi < 0n) return null;
      return Number(bi);
    }
    const base = 10n ** BigInt(d);
    const whole = bi / base;
    const frac = bi % base;
    if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(whole) + Number(frac) / Number(base);
  } catch {
    return null;
  }
}

async function tokenPricesUsd(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(ids.map((id) => id.toLowerCase()).filter((id) => id.length === 64))];
  if (!uniq.length) return out;
  const rows = await qSlow<{ token_id: string; price_usd: string | null }>(
    `SELECT DISTINCT ON (lower(token_id)) lower(token_id) AS token_id, price_usd::text
       FROM defi.price_tick
      WHERE lower(token_id) = ANY($1::text[])
        AND price_usd IS NOT NULL AND price_usd > 0
      ORDER BY lower(token_id), ts_ms DESC`,
    [uniq],
    4000
  );
  for (const r of rows ?? []) {
    const n = Number(r.price_usd);
    if (Number.isFinite(n) && n > 0) out.set(r.token_id, n);
  }
  return out;
}

/** Wallet token tape: names, defi quotes, first/last from the ledger. No unspent scan. */
export async function addressTokenTape(
  address: string
): Promise<{ items: AddrTokenTapeRow[]; truncated: boolean } | null> {
  const bals = await addressTokensConfirmed(address);
  if (bals == null) return null;
  const ids = bals.map((t) => t.tokenId);
  const [metaMap, quotes] = await Promise.all([tokenMetaMany(ids), tokenPricesUsd(ids)]);
  const heights = new Set<number>();
  const rows: AddrTokenTapeRow[] = bals.map((tok) => {
    const tokenId = tok.tokenId;
    const meta = metaMap.get(tokenId);
    const decimals =
      meta?.decimals != null && Number.isFinite(meta.decimals) ? meta.decimals : 0;
    const amountUi = amountUiFromRaw(tok.amount, decimals);
    const priceUsd = quotes.get(tokenId.toLowerCase()) ?? null;
    const valueUsd =
      priceUsd != null && amountUi != null && Number.isFinite(amountUi)
        ? amountUi * priceUsd
        : null;
    const firstHeight = tok.firstHeight ?? null;
    const lastHeight = tok.lastHeight ?? null;
    if (firstHeight != null) heights.add(firstHeight);
    if (lastHeight != null) heights.add(lastHeight);
    return {
      tokenId,
      amount: tok.amount,
      amountUi,
      name: meta?.name ?? null,
      decimals,
      emission: meta?.emission ?? null,
      artworkUrl: meta?.artworkUrl ?? null,
      priceUsd,
      valueUsd,
      firstHeight,
      lastHeight,
      firstTs: null,
      lastTs: null,
    };
  });
  if (heights.size) {
    const tsRows = await qSlow<{ height: string; ts: string | null }>(
      `SELECT height::text, timestamp_ms::text AS ts
         FROM packed.blocks WHERE height = ANY($1::bigint[])`,
      [[...heights]],
      4000
    );
    const tsByH = new Map<number, number | null>();
    for (const r of tsRows ?? []) {
      const h = nHeight(r.height);
      if (h != null) tsByH.set(h, tsMs(r.ts));
    }
    for (const row of rows) {
      row.firstTs = row.firstHeight != null ? tsByH.get(row.firstHeight) ?? null : null;
      row.lastTs = row.lastHeight != null ? tsByH.get(row.lastHeight) ?? null : null;
    }
  }
  const sorted = sortAddrTokenTape(rows);
  return {
    items: sorted.slice(0, ADDR_TOKEN_TAPE),
    truncated: bals.length > ADDR_TOKEN_TAPE,
  };
}

/** Confirmed balance: nanoErgs from summary (SELECT), tokens from unspent box_assets. */
export async function addressBalanceConfirmed(
  address: string
): Promise<{ nanoErgs: string; tokens: { tokenId: string; amount: string }[] } | null> {
  const summary = await getAddressSummary(address);
  const tokens = await addressTokensConfirmed(address);
  if (tokens == null) return null;
  return {
    nanoErgs: summary?.nanoerg ?? "0",
    tokens: tokens.map((t) => ({ tokenId: t.tokenId, amount: t.amount })),
  };
}

export type NftNameGroup = {
  rank: number;
  slug: string;
  name: string;
  count: number;
  tokenIds: string[];
  sample: { tokenId: string; name: string | null; artworkUrl: string | null }[];
  latestHeight: number | null;
  coverUrl: string | null;
};

export function groupNftNameCollections(
  hits: Array<{
    tokenId: string;
    name: string | null;
    artworkUrl: string | null;
    height: number | null;
  }>,
  limit: number
): NftNameGroup[] {
  const bySlug = new Map<string, NftNameGroup>();
  for (const h of hits) {
    const { collection, slug } = nftCollectionFromName(h.name, h.tokenId);
    const prev = bySlug.get(slug) ?? {
      rank: 0,
      slug,
      name: collection,
      count: 0,
      tokenIds: [] as string[],
      sample: [] as NftNameGroup["sample"],
      latestHeight: null as number | null,
      coverUrl: null as string | null,
    };
    prev.count += 1;
    if (!prev.tokenIds.includes(h.tokenId)) prev.tokenIds.push(h.tokenId);
    if (prev.sample.length < 6) {
      prev.sample.push({
        tokenId: h.tokenId,
        name: h.name,
        artworkUrl: h.artworkUrl,
      });
    }
    if (h.height != null && (prev.latestHeight == null || h.height > prev.latestHeight)) {
      prev.latestHeight = h.height;
    }
    if (h.artworkUrl && !prev.coverUrl) prev.coverUrl = h.artworkUrl;
    if (h.artworkUrl && prev.sample[0] && !prev.sample[0].artworkUrl) {
      prev.sample.unshift({
        tokenId: h.tokenId,
        name: h.name,
        artworkUrl: h.artworkUrl,
      });
      prev.sample = prev.sample.slice(0, 6);
    }
    bySlug.set(slug, prev);
  }
  return [...bySlug.values()]
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count || (b.latestHeight ?? 0) - (a.latestHeight ?? 0))
    .slice(0, limit)
    .map((c, i) => ({
      ...c,
      rank: i + 1,
      coverUrl: c.coverUrl ?? c.sample.find((s) => s.artworkUrl)?.artworkUrl ?? null,
    }));
}

/** Strip #123 / trailing edition so NFTs group like AdaStat policy names. */
export function nftCollectionFromName(
  name: string | null,
  tokenId: string
): { collection: string; slug: string } {
  const raw = (name ?? "").trim();
  let coll = raw
    .replace(/\s+edition\s+\d+$/i, "")
    .replace(/\s*#\s*\d+\s*$/i, "")
    .replace(/[-_\s]+\d+$/i, "")
    .trim();
  if (coll.length < 2) coll = raw || `Token ${tokenId.slice(0, 8)}`;
  const slug =
    coll
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || tokenId.slice(0, 16);
  return { collection: coll, slug };
}

export type AddrNft = {
  tokenId: string;
  name: string | null;
  collection: string;
  slug: string;
  artworkUrl: string | null;
  kind: NftKind | null;
  mediaUrl: string | null;
  amount: string;
  decimals: number;
  emission: number | null;
  boxId: string | null;
  height: number | null;
  boxes: number;
};

/** EIP-4 NFT, or 1-unit 0-decimal while emission is still unknown. */
const NFT_HELD = `t.emission = 1
      OR (
        coalesce(t.emission, 1) = 1
        AND coalesce(t.decimals, 0) = 0
        AND SUM(ba.amount) = 1
      )`;

const NFT_HELD_BAL = `t.emission = 1
      OR (
        coalesce(t.emission, 1) = 1
        AND coalesce(t.decimals, 0) = 0
        AND tb.amount = 1
      )`;

function mapAddrNftRows(
  rows: {
    token_id: string;
    amount: string;
    boxes: string;
    height: string | null;
    box_id: string | null;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    artwork_url: string | null;
  }[]
): AddrNft[] {
  return rows.map((r) => {
    const shown = displayErgoTokenName(r.token_id, r.name);
    const { collection, slug } = nftCollectionFromName(shown, r.token_id);
    return {
      tokenId: r.token_id,
      name: shown,
      collection,
      slug,
      artworkUrl: r.artwork_url,
      kind: null as NftKind | null,
      mediaUrl: null as string | null,
      amount: r.amount,
      decimals: r.decimals != null ? Number(r.decimals) : 0,
      emission: r.emission != null ? Number(r.emission) : null,
      boxId: r.box_id,
      height: r.height != null ? Number(r.height) : null,
      boxes: Number(r.boxes || 0),
    };
  });
}

async function paintAddrNftMedia(items: AddrNft[]): Promise<AddrNft[]> {
  const ctxs = await mintNftContextByTokenIds(items.map((it) => it.tokenId));
  if (!ctxs.size) return items;
  return items.map((it) => {
    const ctx = ctxs.get(it.tokenId);
    if (!ctx) return it;
    const media = eip4MediaFromRegs(ctx.mintRegs);
    return {
      ...it,
      kind: media.kind,
      mediaUrl: media.url,
      artworkUrl: it.artworkUrl || eip4PreviewUrl(media),
    };
  });
}

async function addressNftsFromBalances(
  address: string,
  limit: number,
  offset: number
): Promise<{ items: AddrNft[]; total: number } | null> {
  const tot = await qSlow<{ c: string }>(
    `SELECT count(*)::text AS c
       FROM token_balances tb
       LEFT JOIN tokens t ON t.token_id = tb.token_id
      WHERE tb.address = $1
        AND tb.amount > 0
        AND (${NFT_HELD_BAL})`,
    [address]
  );
  if (!tot) return null;
  const rows = await qSlow<{
    token_id: string;
    amount: string;
    boxes: string;
    height: string | null;
    box_id: string | null;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    artwork_url: string | null;
  }>(
    `SELECT tb.token_id,
            tb.amount::text AS amount,
            '1'::text AS boxes,
            tb.last_height::text AS height,
            NULL::text AS box_id,
            t.name,
            t.decimals::text AS decimals,
            t.emission::text AS emission,
            NULLIF(t.artwork_url, '') AS artwork_url
       FROM token_balances tb
       LEFT JOIN tokens t ON t.token_id = tb.token_id
      WHERE tb.address = $1
        AND tb.amount > 0
        AND (${NFT_HELD_BAL})
      ORDER BY
        CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
        tb.last_height DESC NULLS LAST,
        tb.token_id
      LIMIT $2 OFFSET $3`,
    [address, limit, offset]
  );
  if (!rows) return null;
  return {
    total: Number(tot[0]?.c ?? 0),
    items: await paintAddrNftMedia(mapAddrNftRows(rows)),
  };
}

export async function addressNftsFromIndex(
  address: string,
  limit: number,
  offset: number
): Promise<{ items: AddrNft[]; total: number } | null> {
  const fromBal = await addressNftsFromBalances(address, limit, offset);
  if (fromBal) return fromBal;
  if (await tokenBalancesUtxoReady()) {
    return { items: [], total: 0 };
  }
  return addressNftsFromUnspentBoxes(address, limit, offset);
}

async function addressNftsFromUnspentBoxes(
  address: string,
  limit: number,
  offset: number
): Promise<{ items: AddrNft[]; total: number } | null> {
  const where = boxesUnspentWhere(address, "b");
  const tot = await qSlow<{ c: string }>(
    `SELECT count(*)::text AS c FROM (
       SELECT ba.token_id
       FROM boxes b
       JOIN box_assets ba ON ba.box_id = b.box_id
       LEFT JOIN tokens t ON t.token_id = ba.token_id
       WHERE ${where}
       GROUP BY ba.token_id, t.emission, t.decimals
       HAVING ${NFT_HELD}
     ) x`,
    [address]
  );
  if (!tot) return null;
  const rows = await qSlow<{
    token_id: string;
    amount: string;
    boxes: string;
    height: string | null;
    box_id: string | null;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    artwork_url: string | null;
  }>(
    `SELECT ba.token_id,
            SUM(ba.amount)::text AS amount,
            COUNT(*)::text AS boxes,
            MAX(b.creation_height)::text AS height,
            (array_agg(b.box_id ORDER BY b.creation_height DESC NULLS LAST))[1] AS box_id,
            t.name,
            t.decimals::text AS decimals,
            t.emission::text AS emission,
            NULLIF(t.artwork_url, '') AS artwork_url
     FROM boxes b
     JOIN box_assets ba ON ba.box_id = b.box_id
     LEFT JOIN tokens t ON t.token_id = ba.token_id
     WHERE ${where}
     GROUP BY ba.token_id, t.name, t.decimals, t.emission, t.artwork_url
     HAVING ${NFT_HELD}
     ORDER BY
       CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
       MAX(b.creation_height) DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [address, limit, offset]
  );
  if (!rows) return null;
  return {
    total: Number(tot[0]?.c ?? 0),
    items: await paintAddrNftMedia(mapAddrNftRows(rows)),
  };
}

export type AddressSummary = {
  address: string;
  nanoerg: string;
  boxCount: number;
  txCount: number;
  tokenCount: number;
  lastHeight: number | null;
  firstHeight: number | null;
  firstTs: number | null;
  lastTs: number | null;
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
  /** First `address_tx` at `firstHeight`. Additive; null when the pack join misses. */
  firstTxId?: string | null;
  /** Last `address_tx` at `lastHeight`. Additive; null when the pack join misses. */
  lastTxId?: string | null;
  isContract: boolean;
};

export type KeysetCursor = { height: number; id: string };

export function encodeKeysetCursor(
  height: number | null | undefined,
  id: string
): string {
  return `${height ?? -1}:${id}`;
}

export function parseKeysetCursor(raw: unknown): KeysetCursor | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const i = s.indexOf(":");
  if (i < 1) return null;
  const height = Number(s.slice(0, i));
  const id = s.slice(i + 1);
  if (!id || !Number.isFinite(height)) return null;
  return { height, id };
}

/** Same CASE as indexer `holder_bands`: prefix `9` and length < 70. */
function isP2pkAddress(address: string): boolean {
  return address.startsWith("9") && address.length < 70;
}

function tsMs(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function mapAddressListRow(
  r: {
    address: string;
    nanoerg: string;
    box_count: string;
    tx_count: string;
    token_count: string;
    first_height: string | null;
    last_height: string | null;
    first_ts: string | null;
    last_ts: string | null;
  },
  rank: number
): AddressListItem {
  return {
    rank,
    address: r.address,
    nanoerg: r.nanoerg || "0",
    boxCount: Number(r.box_count || 0) || 0,
    txCount: Number(r.tx_count || 0) || 0,
    tokenCount: Number(r.token_count || 0) || 0,
    firstHeight: r.first_height != null ? Number(r.first_height) : null,
    lastHeight: r.last_height != null ? Number(r.last_height) : null,
    firstTs: tsMs(r.first_ts),
    lastTs: tsMs(r.last_ts),
    isContract: !isP2pkAddress(r.address),
  };
}

const RENT_PERIOD = 1_051_200;
/** 90 days at 720 blocks/day. Already-due boxes are included; later than this is not a warning. */
const RENT_WARN_BLOCKS = 90 * 720;

/**
 * Soonest storage rent on this address: the oldest unspent box.
 * One index row. Null when that box is due later than 90 days, or the address has none.
 * 0 means the deadline has already passed.
 */
export async function addressRentBlocks(address: string): Promise<number | null> {
  const rows = await qSlow<{ h: string | null; tip: string | null }>(
    `SELECT b.creation_height::text AS h,
            (SELECT value FROM indexer_state WHERE key = 'last_height') AS tip
       FROM packed.boxes b
      WHERE b.addr_id = (
              SELECT id FROM packed.addr
               WHERE addr_md5 = md5($1) AND address = $1
            )
        AND b.spent_tx_id IS NULL
        AND b.creation_height IS NOT NULL
      ORDER BY b.creation_height ASC
      LIMIT 1`,
    [address],
    2000
  );
  if (!rows) return null;
  const row = rows[0];
  if (!row?.h || !row.tip) return null;
  const created = Number(row.h);
  const tip = Number(row.tip);
  if (!Number.isFinite(created) || !Number.isFinite(tip)) return null;
  const left = created + RENT_PERIOD - tip;
  if (left > RENT_WARN_BLOCKS) return null;
  return Math.max(0, Math.trunc(left));
}

/** SELECT only. Writer = indexer. Never COUNT/SUM boxes on GET. */
export async function getAddressSummary(
  address: string
): Promise<AddressSummary | null> {
  const cols = `s.nanoerg::text AS nanoerg, s.box_count::text, s.tx_count::text, s.token_count::text,
            s.last_height::text, s.first_height::text,
            fb.timestamp_ms::text AS first_ts, lb.timestamp_ms::text AS last_ts`;
  const hit = await qSlow<{
    nanoerg: string;
    box_count: string;
    tx_count: string;
    token_count: string;
    last_height: string | null;
    first_height: string | null;
    first_ts: string | null;
    last_ts: string | null;
  }>(
    `SELECT ${cols}
     FROM address_summary s
     LEFT JOIN packed.blocks fb ON fb.height = s.first_height
     LEFT JOIN packed.blocks lb ON lb.height = s.last_height
     WHERE s.address = $1`,
    [address],
    4000
  );
  const row =
    hit?.[0] ??
    (address.length > 2000
      ? (
          await qSlow<{
            nanoerg: string;
            box_count: string;
            tx_count: string;
            token_count: string;
            last_height: string | null;
            first_height: string | null;
            first_ts: string | null;
            last_ts: string | null;
          }>(
            `SELECT ${cols}
               FROM address_summary_long s
               LEFT JOIN packed.blocks fb ON fb.height = s.first_height
               LEFT JOIN packed.blocks lb ON lb.height = s.last_height
              WHERE s.addr_md5 = md5($1) AND s.address = $1`,
            [address],
            4000
          )
        )?.[0]
      : undefined);
  if (!row) return null;
  const r = row;
  return {
    address,
    nanoerg: r.nanoerg || "0",
    boxCount: Number(r.box_count || 0) || 0,
    txCount: Number(r.tx_count || 0) || 0,
    tokenCount: Number(r.token_count || 0) || 0,
    lastHeight: r.last_height != null ? Number(r.last_height) : null,
    firstHeight: r.first_height != null ? Number(r.first_height) : null,
    firstTs: tsMs(r.first_ts),
    lastTs: tsMs(r.last_ts),
  };
}

export const ADDRESS_SORTS = ["erg", "tokens", "txs", "address", "first", "last"] as const;
export type AddressSort = (typeof ADDRESS_SORTS)[number];
export type AddressSortDir = "asc" | "desc";

const ORDER_BY: Record<`${AddressSort}:${AddressSortDir}`, string> = {
  "erg:desc": "s.nanoerg DESC, s.address DESC",
  "erg:asc": "s.nanoerg ASC, s.address ASC",
  "tokens:desc": "s.token_count DESC, s.nanoerg DESC, s.address DESC",
  "tokens:asc": "s.token_count ASC, s.nanoerg DESC, s.address DESC",
  "txs:desc": "s.tx_count DESC, s.nanoerg DESC, s.address DESC",
  "txs:asc": "s.tx_count ASC, s.nanoerg DESC, s.address DESC",
  "address:desc": "s.address DESC",
  "address:asc": "s.address ASC",
  "first:desc": "s.first_height DESC NULLS LAST, s.address DESC",
  "first:asc": "s.first_height ASC NULLS LAST, s.address ASC",
  "last:desc": "s.last_height DESC NULLS LAST, s.address DESC",
  "last:asc": "s.last_height ASC NULLS LAST, s.address ASC",
};

export function parseAddressSort(raw: unknown): AddressSort {
  const s = String(raw ?? "");
  return (ADDRESS_SORTS as readonly string[]).includes(s) ? (s as AddressSort) : "erg";
}

export function parseAddressSortDir(raw: unknown): AddressSortDir {
  return raw === "asc" ? "asc" : "desc";
}

export {
  parseAddressBand,
  parseAddressKind,
  parseAddressBandList,
  parseAddressKindList,
  joinAddressFilter,
  normalizeAddressFilter,
  type AddressBand,
  type AddressKind,
} from "./addressListFilter.js";

/** Address list. SELECT address_summary + PK join to blocks for dates. No COUNT/SUM boxes. */
export async function listAddressSummaries(opts: {
  limit: number;
  offset?: number;
  p2pkOnly?: boolean;
  sort?: AddressSort;
  dir?: AddressSortDir;
  bands?: AddressBand[] | null;
  kinds?: AddressKind[] | null;
  band?: AddressBand | null;
  kind?: AddressKind | null;
}): Promise<AddressListItem[] | null> {
  const limit = Math.min(100, Math.max(1, opts.limit || 50));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const sort = opts.sort && (ADDRESS_SORTS as readonly string[]).includes(opts.sort) ? opts.sort : "erg";
  const dir: AddressSortDir = opts.dir === "asc" ? "asc" : "desc";
  const order = ORDER_BY[`${sort}:${dir}`] ?? ORDER_BY["erg:desc"];
  const filter = addressListWhere({
    p2pkOnly: !!opts.p2pkOnly,
    bands: opts.bands ?? null,
    kinds: opts.kinds ?? null,
    band: opts.band ?? null,
    kind: opts.kind ?? null,
  });
  const limitPh = `$${filter.params.length + 1}`;
  const offsetPh = `$${filter.params.length + 2}`;
  const rows = await qSlow<{
    address: string;
    nanoerg: string;
    box_count: string;
    tx_count: string;
    token_count: string;
    first_height: string | null;
    last_height: string | null;
    first_ts: string | null;
    last_ts: string | null;
  }>(
    `SELECT s.address, s.nanoerg::text AS nanoerg, s.box_count::text, s.tx_count::text,
            s.token_count::text, s.first_height::text, s.last_height::text,
            bf.timestamp_ms::text AS first_ts, bl.timestamp_ms::text AS last_ts
     FROM address_summary s
     LEFT JOIN packed.blocks bf ON bf.height = s.first_height
     LEFT JOIN packed.blocks bl ON bl.height = s.last_height
     WHERE ${filter.sql}
     ORDER BY ${order}
     LIMIT ${limitPh} OFFSET ${offsetPh}`,
    [...filter.params, limit, offset],
    filter.bands.length || filter.kinds.length ? 10000 : 8000
  );
  if (!rows) return null;
  return rows.map((r, i) => mapAddressListRow(r, offset + i + 1));
}

/**
 * Pack join: first/last tx at the already-known heights.
 * `address_tx` by (address, height) only — never COUNT/SUM, never scan boxes.
 */
export async function fillAddressActivityTxs(
  items: AddressListItem[]
): Promise<AddressListItem[]> {
  const pairs: { address: string; height: number; kind: "first" | "last" }[] = [];
  for (const it of items) {
    if (!it.firstTxId && it.firstHeight != null && Number.isFinite(it.firstHeight)) {
      pairs.push({ address: it.address, height: it.firstHeight, kind: "first" });
    }
    if (!it.lastTxId && it.lastHeight != null && Number.isFinite(it.lastHeight)) {
      pairs.push({ address: it.address, height: it.lastHeight, kind: "last" });
    }
  }
  if (!pairs.length) return items;

  const rows = await qSlow<{ address: string; kind: string; tx_id: string }>(
    `SELECT DISTINCT ON (u.kind, u.address)
            u.kind, u.address, encode(x.tx_id, 'hex') AS tx_id
     FROM unnest($1::text[], $2::bigint[], $3::text[]) AS u(address, height, kind)
     JOIN packed.addr ad ON ad.addr_md5 = md5(u.address) AND ad.address = u.address
     JOIN packed.address_tx x ON x.addr_id = ad.id AND x.height = u.height
     LEFT JOIN packed.transactions t ON t.id = x.tx_id
     ORDER BY u.kind, u.address,
       CASE WHEN u.kind = 'last' THEN -COALESCE(t.index_in_block, 0)
            ELSE COALESCE(t.index_in_block, 0) END,
       x.tx_id`,
    [pairs.map((p) => p.address), pairs.map((p) => p.height), pairs.map((p) => p.kind)],
    4000
  );
  if (!rows?.length) {
    return items.map((it) => ({
      ...it,
      firstTxId: it.firstTxId ?? null,
      lastTxId: it.lastTxId ?? null,
    }));
  }
  const first = new Map<string, string>();
  const last = new Map<string, string>();
  for (const r of rows) {
    if (!r.tx_id) continue;
    if (r.kind === "last") last.set(r.address, r.tx_id);
    else first.set(r.address, r.tx_id);
  }
  return items.map((it) => ({
    ...it,
    firstTxId: it.firstTxId ?? first.get(it.address) ?? null,
    lastTxId: it.lastTxId ?? last.get(it.address) ?? null,
  }));
}

export type TokenHolderActivity = {
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
  firstTxId: string | null;
  lastTxId: string | null;
};

export type TokenHolderLedgerHeight = {
  firstHeight: number | null;
  lastHeight: number | null;
  txCount: number | null;
};

/**
 * Txs / first / last for this token on the holders pack.
 * Prefer token_balances.tx_count (indexer snapshot). Lean GET COUNT only
 * for rows still NULL while the seed walks. Long P2S waits for the seed.
 */
export async function tokenHolderActivityByAddresses(
  tokenId: string,
  addresses: string[],
  addrTxCount: ReadonlyMap<string, number>,
  ledger?: ReadonlyMap<string, TokenHolderLedgerHeight>
): Promise<Map<string, TokenHolderActivity>> {
  const out = new Map<string, TokenHolderActivity>();
  const needCount = leanTokenHolderAddresses(addresses, addrTxCount).filter((a) => {
    const n = ledger?.get(a)?.txCount;
    return n == null || !Number.isFinite(n);
  });
  const countRows = needCount.length
    ? await qSlow<{
        address: string;
        n: string;
        first_h: string | null;
        last_h: string | null;
      }>(
        packedReadEnabled()
          ? `SELECT ad.address, count(*)::int::text AS n,
                    min(x.height)::text AS first_h, max(x.height)::text AS last_h
               FROM packed.address_tx x
               JOIN packed.addr ad ON ad.id = x.addr_id
               JOIN packed.token_tx_seen s
                 ON s.token_id = packed.hex32($2) AND s.tx_id = x.tx_id
              WHERE ad.address = ANY($1::text[])
              GROUP BY ad.address`
          : `SELECT x.address, count(*)::int::text AS n,
                min(x.height)::text AS first_h, max(x.height)::text AS last_h
           FROM address_tx x
           JOIN token_tx_seen s ON s.token_id = $2 AND s.tx_id = x.tx_id
          WHERE x.address = ANY($1::text[])
          GROUP BY x.address`,
        [needCount, tokenId],
        2500,
        ["SET LOCAL jit = off"]
      )
    : null;

  const heights = new Set<number>();
  const fromCount = new Map<string, { n: number; firstH: number | null; lastH: number | null }>();
  for (const r of countRows ?? []) {
    if (!r.address) continue;
    const firstH = r.first_h != null ? Number(r.first_h) : NaN;
    const lastH = r.last_h != null ? Number(r.last_h) : NaN;
    fromCount.set(r.address, {
      n: Number(r.n || 0) || 0,
      firstH: Number.isFinite(firstH) ? firstH : null,
      lastH: Number.isFinite(lastH) ? lastH : null,
    });
    if (Number.isFinite(firstH)) heights.add(firstH);
    if (Number.isFinite(lastH)) heights.add(lastH);
  }
  if (ledger) {
    for (const addr of addresses) {
      if (fromCount.has(addr)) continue;
      const h = ledger.get(addr);
      if (!h) continue;
      if (h.firstHeight != null && Number.isFinite(h.firstHeight)) heights.add(h.firstHeight);
      if (h.lastHeight != null && Number.isFinite(h.lastHeight)) heights.add(h.lastHeight);
    }
  }
  const tsByH = new Map<number, number | null>();
  if (heights.size) {
    const tsRows = await q<{ height: string; ts: string | null }>(
      `SELECT height::text, timestamp_ms::text AS ts
         FROM packed.blocks WHERE height = ANY($1::bigint[])`,
      [[...heights]]
    );
    for (const r of tsRows ?? []) tsByH.set(Number(r.height), tsMs(r.ts));
  }

  for (const addr of addresses) {
    const c = fromCount.get(addr);
    const h = ledger?.get(addr);
    const snapN = h?.txCount;
    const firstH = c?.firstH ?? h?.firstHeight ?? null;
    const lastH = c?.lastH ?? h?.lastHeight ?? null;
    const txCount =
      snapN != null && Number.isFinite(snapN) ? snapN : c ? c.n : null;
    out.set(addr, {
      txCount,
      firstTs: firstH != null ? tsByH.get(firstH) ?? null : null,
      lastTs: lastH != null ? tsByH.get(lastH) ?? null : null,
      firstTxId: null,
      lastTxId: null,
    });
  }
  return out;
}

/** nanoerg / address_tx n / token_count for a holder pack. No first/last tx lookup. */
export async function addressPipsByAddresses(
  addresses: string[]
): Promise<Map<string, { nanoerg: string | null; txCount: number; tokenCount: number | null }>> {
  const uniq = [...new Set(addresses.filter((a) => a.length > 0))];
  const out = new Map<string, { nanoerg: string | null; txCount: number; tokenCount: number | null }>();
  if (!uniq.length) return out;
  const rows = await q<{
    address: string;
    nanoerg: string;
    tx_count: string;
    token_count: string | null;
  }>(
    `SELECT address, nanoerg::text AS nanoerg, tx_count::text, token_count::text
       FROM address_summary WHERE address = ANY($1::text[])`,
    [uniq]
  );
  for (const r of rows ?? []) {
    if (!r.address) continue;
    out.set(r.address, {
      nanoerg: r.nanoerg ?? null,
      txCount: Number(r.tx_count || 0) || 0,
      tokenCount: r.token_count != null ? Number(r.token_count) : null,
    });
  }
  return out;
}

/** Pack join: address_summary (+ first/last tx) for a holder tape. Not a COUNT. */
export async function addressSummariesByAddresses(
  addresses: string[]
): Promise<Map<string, AddressListItem>> {
  const uniq = [...new Set(addresses.filter((a) => a.length > 0))];
  if (!uniq.length) return new Map();
  const rows = await qSlow<{
    address: string;
    nanoerg: string;
    box_count: string;
    tx_count: string;
    token_count: string;
    first_height: string | null;
    last_height: string | null;
    first_ts: string | null;
    last_ts: string | null;
  }>(
    `SELECT s.address, s.nanoerg::text AS nanoerg, s.box_count::text, s.tx_count::text,
            s.token_count::text, s.first_height::text, s.last_height::text,
            bf.timestamp_ms::text AS first_ts, bl.timestamp_ms::text AS last_ts
     FROM address_summary s
     LEFT JOIN packed.blocks bf ON bf.height = s.first_height
     LEFT JOIN packed.blocks bl ON bl.height = s.last_height
     WHERE s.address = ANY($1::text[])`,
    [uniq],
    4000
  );
  if (!rows?.length) return new Map();
  const filled = await fillAddressActivityTxs(rows.map((r, i) => mapAddressListRow(r, i + 1)));
  return new Map(filled.map((it) => [it.address, it]));
}

export async function ergoTreeForAddress(address: string): Promise<string | null> {
  if (packedReadEnabled()) {
    const rows = await qSlow<{ ergo_tree: string }>(
      `SELECT sc.ergo_tree
         FROM packed.addr ad
         JOIN packed.boxes b ON b.addr_id = ad.id
         JOIN packed.script sc ON sc.id = b.script_id
        WHERE ad.addr_md5 = md5($1) AND ad.address = $1
          AND b.creation_height IS NOT NULL
          AND sc.ergo_tree IS NOT NULL
        LIMIT 1`,
      [address],
      4000
    );
    const tree = rows?.[0]?.ergo_tree;
    return tree && tree.length > 0 ? tree : null;
  }
  const long = address.length > BOXES_ADDRESS_BTREE_MAX;
  const where = long
    ? `address IS NOT NULL AND length(address) > ${BOXES_ADDRESS_BTREE_MAX} AND md5(address) = md5($1) AND address = $1`
    : `address = $1 AND length(address) <= ${BOXES_ADDRESS_BTREE_MAX}`;
  const rows = await qSlow<{ ergo_tree: string }>(
    `SELECT ergo_tree FROM boxes
     WHERE ${where} AND ergo_tree IS NOT NULL
     LIMIT 1`,
    [address],
    4000
  );
  const tree = rows?.[0]?.ergo_tree;
  return tree && tree.length > 0 ? tree : null;
}

export type BoxLite = {
  boxId: string;
  value: string;
  address: string | null;
  ergoTree: string | null;
  assets: { tokenId: string; amount: string }[];
};

export type BoxesLiteResult = {
  boxes: Map<string, BoxLite>;
  assetsComplete: boolean;
};

export async function boxesLiteByIdsChecked(ids: string[]): Promise<BoxesLiteResult> {
  const map = new Map<string, BoxLite>();
  const uniq = [...new Set(ids.filter((id) => id && id.length >= 16))]
    .filter((id) => !packedReadEnabled() || isHex64(id))
    .slice(0, 800);
  if (!uniq.length) return { boxes: map, assetsComplete: true };
  const rows = await qSlow<{
    box_id: string;
    value_nano: string;
    address: string | null;
    ergo_tree: string | null;
  }>(
    packedReadEnabled()
      ? PACKED_BOXES_BY_IDS_SQL
      : `SELECT box_id, value_nano::text AS value_nano, address, ergo_tree
     FROM boxes WHERE box_id = ANY($1::text[])`,
    [uniq],
    6000
  );
  if (!rows) return { boxes: map, assetsComplete: false };
  if (!rows.length) return { boxes: map, assetsComplete: true };
  const assetResult = await assetsForBoxesChecked(rows.map((r) => r.box_id));
  for (const r of rows) {
    map.set(r.box_id, {
      boxId: r.box_id,
      value: r.value_nano || "0",
      address: r.address,
      ergoTree: r.ergo_tree,
      assets: assetResult.assets.get(r.box_id) ?? [],
    });
  }
  return { boxes: map, assetsComplete: assetResult.complete };
}

export async function boxesLiteByIds(ids: string[]): Promise<Map<string, BoxLite>> {
  return (await boxesLiteByIdsChecked(ids)).boxes;
}

type AssetsForBoxesResult = {
  assets: Map<string, { tokenId: string; amount: string }[]>;
  complete: boolean;
};

async function assetsForBoxesChecked(
  boxIds: string[],
  timeoutMs = 12000
): Promise<AssetsForBoxesResult> {
  const map = new Map<string, { tokenId: string; amount: string }[]>();
  if (!boxIds.length) return { assets: map, complete: true };
  const packed = packedReadEnabled();
  const ids = packed ? boxIds.filter(isHex64) : boxIds;
  if (!ids.length) return { assets: map, complete: true };
  const rows = await qSlow<{ box_id: string; token_id: string; amount: string }>(
    packed
      ? PACKED_ASSETS_BY_IDS_SQL
      : `SELECT box_id, token_id, amount::text AS amount
     FROM box_assets WHERE box_id = ANY($1::text[])`,
    [ids],
    timeoutMs
  );
  if (!rows) return { assets: map, complete: false };
  for (const r of rows) {
    const list = map.get(r.box_id) ?? [];
    list.push({ tokenId: r.token_id, amount: r.amount });
    map.set(r.box_id, list);
  }
  return { assets: map, complete: true };
}

async function assetsForBoxes(
  boxIds: string[]
): Promise<Map<string, { tokenId: string; amount: string }[]>> {
  return (await assetsForBoxesChecked(boxIds)).assets;
}

export type IdxBoxCursor = {
  boxId: string;
  value: string;
  creationHeight: number | null;
  address: string | null;
  ergoTree: string | null;
  creationTxId: string | null;
  index: number | null;
  assets: { tokenId: string; amount: string }[];
};

export async function addressUnspentBoxesCursor(
  address: string,
  cursor: KeysetCursor | null,
  limit: number,
  offset = 0
): Promise<{ items: IdxBoxCursor[]; hasMore: boolean; nextCursor: string | null } | null> {
  const take = Math.max(1, Math.min(200, limit));
  const skip = cursor ? 0 : Math.max(0, Math.floor(offset) || 0);
  if (packedReadEnabled()) {
    return addressUnspentBoxesCursorPacked(address, cursor, take, skip);
  }
  const where = boxesUnspentWhere(address);
  const rows = await qSlow<{
    box_id: string;
    value_nano: string;
    creation_height: string | null;
    address: string | null;
    ergo_tree: string | null;
    creation_tx_id: string | null;
    output_index: string | null;
  }>(
    cursor
      ? `SELECT box_id, value_nano::text AS value_nano, creation_height::text AS creation_height,
                address, ergo_tree, creation_tx_id, output_index::text AS output_index
         FROM boxes
         WHERE ${where}
           AND (
             COALESCE(creation_height, -1) < $2
             OR (COALESCE(creation_height, -1) = $2 AND box_id < $3)
           )
         ORDER BY creation_height DESC NULLS LAST, box_id DESC
         LIMIT $4`
      : `SELECT box_id, value_nano::text AS value_nano, creation_height::text AS creation_height,
                address, ergo_tree, creation_tx_id, output_index::text AS output_index
         FROM boxes
         WHERE ${where}
         ORDER BY creation_height DESC NULLS LAST, box_id DESC
         LIMIT $2 OFFSET $3`,
    cursor
      ? [address, cursor.height, cursor.id, take + 1]
      : [address, take + 1, skip]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const assets = await assetsForBoxes(page.map((r) => r.box_id));
  const items: IdxBoxCursor[] = page.map((r) => {
    const creationHeight =
      r.creation_height != null ? Number(r.creation_height) : null;
    return {
      boxId: r.box_id,
      value: r.value_nano || "0",
      creationHeight: Number.isFinite(creationHeight as number)
        ? creationHeight
        : null,
      address: r.address,
      ergoTree: r.ergo_tree,
      creationTxId: r.creation_tx_id,
      index: r.output_index != null ? Number(r.output_index) : null,
      assets: assets.get(r.box_id) ?? [],
    };
  });
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last
      ? encodeKeysetCursor(last.creationHeight, last.boxId)
      : null,
  };
}

async function addressUnspentBoxesCursorPacked(
  address: string,
  cursor: KeysetCursor | null,
  take: number,
  skip: number
): Promise<{ items: IdxBoxCursor[]; hasMore: boolean; nextCursor: string | null } | null> {
  const usable = cursor && isHex64(cursor.id) ? cursor : null;
  const keyset = usable
    ? `AND (
         b.creation_height < $2
         OR (b.creation_height = $2 AND b.box_id < decode($3, 'hex'))
       )`
    : "";
  const rows = await qSlow<{
    box_id: string;
    value_nano: string;
    creation_height: string | null;
    address: string | null;
    ergo_tree: string | null;
    creation_tx_id: string | null;
    output_index: string | null;
  }>(
    `SELECT encode(p.box_id, 'hex') AS box_id,
            p.value_nano::text AS value_nano,
            p.creation_height::text AS creation_height,
            ad.address,
            sc.ergo_tree,
            encode(p.creation_tx_id, 'hex') AS creation_tx_id,
            p.output_index::text AS output_index
       FROM (
         SELECT b.box_id, b.value_nano, b.creation_height, b.creation_tx_id,
                b.output_index, b.addr_id, b.script_id
           FROM packed.boxes b
          WHERE b.addr_id = (
            SELECT id FROM packed.addr
             WHERE addr_md5 = md5($1) AND address = $1
             LIMIT 1
          )
            AND b.spent_tx_id IS NULL
            AND b.creation_height IS NOT NULL
            ${keyset}
          ORDER BY b.creation_height DESC, b.box_id DESC
          LIMIT ${usable ? "$4" : "$2"} OFFSET ${usable ? "0" : "$3"}
       ) p
       LEFT JOIN packed.addr ad ON ad.id = p.addr_id
       LEFT JOIN packed.script sc ON sc.id = p.script_id`,
    usable
      ? [address, usable.height, usable.id.toLowerCase(), take + 1]
      : [address, take + 1, skip]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const assets = await assetsForBoxes(page.map((r) => r.box_id));
  const items: IdxBoxCursor[] = page.map((r) => {
    const creationHeight = r.creation_height != null ? Number(r.creation_height) : null;
    return {
      boxId: r.box_id,
      value: r.value_nano || "0",
      creationHeight: Number.isFinite(creationHeight as number) ? creationHeight : null,
      address: r.address,
      ergoTree: r.ergo_tree,
      creationTxId: r.creation_tx_id,
      index: r.output_index != null ? Number(r.output_index) : null,
      assets: assets.get(r.box_id) ?? [],
    };
  });
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last ? encodeKeysetCursor(last.creationHeight, last.boxId) : null,
  };
}

export async function addressTransactionsCursor(
  address: string,
  cursor: KeysetCursor | null,
  limit: number
): Promise<{ items: IdxTx[]; hasMore: boolean; nextCursor: string | null } | null> {
  const take = Math.max(1, Math.min(100, limit));
  if (packedReadEnabled()) {
    return addressTransactionsCursorPacked(address, cursor, take);
  }
  const rows = await qSlow<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    size: string | null;
    fee: string | null;
  }>(
    cursor
      ? `SELECT x.id,
                COALESCE(x.height, t.height)::text AS height,
                t.timestamp_ms::text AS timestamp_ms,
                t.size::text AS size,
                t.fee::text AS fee
         FROM (
           SELECT a.tx_id AS id, a.height
             FROM address_tx a
            WHERE a.address = $1
              AND (
                a.height < $2
                OR (a.height = $2 AND a.tx_id < $3)
              )
            ORDER BY a.height DESC NULLS LAST, a.tx_id DESC
            LIMIT $4
         ) x
         LEFT JOIN transactions t ON t.id = x.id
         ORDER BY x.height DESC NULLS LAST, x.id DESC`
      : `SELECT x.id,
                COALESCE(x.height, t.height)::text AS height,
                t.timestamp_ms::text AS timestamp_ms,
                t.size::text AS size,
                t.fee::text AS fee
         FROM (
           SELECT a.tx_id AS id, a.height
             FROM address_tx a
            WHERE a.address = $1
            ORDER BY a.height DESC NULLS LAST, a.tx_id DESC
            LIMIT $2
         ) x
         LEFT JOIN transactions t ON t.id = x.id
         ORDER BY x.height DESC NULLS LAST, x.id DESC`,
    cursor
      ? [address, cursor.height, cursor.id, take + 1]
      : [address, take + 1]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items: IdxTx[] = page.map((r) => ({
    id: r.id,
    inclusionHeight: r.height != null ? Number(r.height) : null,
    timestamp: r.timestamp_ms != null ? Number(r.timestamp_ms) : null,
    size: r.size != null ? Number(r.size) : null,
    fee: r.fee != null ? Number(r.fee) : null,
  }));
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last
      ? encodeKeysetCursor(last.inclusionHeight, last.id)
      : null,
  };
}

export type AddrTxActivity = {
  kind: AddrFlowKind;
  /** Net nanoERG for this address (outputs − inputs), decimal string. */
  erg: string;
  tokens: { tokenId: string; amount: string }[];
  from?: string[];
  to?: string[];
};

type FlowIo = {
  boxId?: string | null;
  address: string | null;
  value: string;
  assets: { tokenId: string; amount: string }[];
};

function flowForAddress(
  address: string,
  inputs: FlowIo[],
  outputs: FlowIo[],
  fee: bigint
): AddrTxActivity | null {
  const hasIn = inputs.some((i) => i.address === address);
  const hasOut = outputs.some((o) => o.address === address);
  if (!hasIn && !hasOut) return null;

  let inErg = 0n;
  let outErg = 0n;
  const tokens = new Map<string, bigint>();
  const addTok = (id: string | undefined, d: bigint) => {
    if (!id || /^0+$/.test(id)) return;
    const k = id.toLowerCase();
    const next = (tokens.get(k) ?? 0n) + d;
    if (next === 0n) tokens.delete(k);
    else tokens.set(k, next);
  };

  for (const i of inputs) {
    if (i.address !== address) continue;
    inErg += parseNanoErg(i.value);
    for (const a of i.assets) addTok(a.tokenId, -parseNanoErg(a.amount));
  }
  for (const o of outputs) {
    if (o.address !== address) continue;
    outErg += parseNanoErg(o.value);
    for (const a of o.assets) addTok(a.tokenId, parseNanoErg(a.amount));
  }

  const mint = eip4MintOfOutputs(outputs.filter((o) => o.address === address));
  const netErg = outErg - inErg;
  const kind = classifyAddrFlow({
    netErg,
    fee,
    tokens: [...tokens.entries()].map(([id, amount]) => ({
      amount,
      mint: mint.get(id) ?? 0n,
    })),
  });
  return {
    kind,
    erg: netErg.toString(),
    tokens: [...tokens.entries()].map(([tokenId, amount]) => ({
      tokenId,
      amount: amount.toString(),
    })),
  };
}

/**
 * Sent / received / intra for one address over a page of tx ids.
 * AdaStat shape: CTE of the pack, then in/out UNION only for those ids.
 * Empty object on miss — never fail the page.
 */
async function addressTransactionsCursorPacked(
  address: string,
  cursor: KeysetCursor | null,
  take: number
): Promise<{ items: IdxTx[]; hasMore: boolean; nextCursor: string | null } | null> {
  // Index is (addr_id, height DESC, tx_id ASC). encode() and NULLS LAST
  // force a full history scan plus a join to every transaction. Match the
  // index so LIMIT stops after one page, then look up only those heads.
  const keyset =
    cursor && isHex64(cursor.id)
      ? `AND (
         x.height < $2
         OR (x.height = $2 AND x.tx_id > decode($3, 'hex'))
       )`
      : "";
  const limitP = cursor && isHex64(cursor.id) ? "$4" : "$2";
  const params =
    cursor && isHex64(cursor.id)
      ? [address, cursor.height, cursor.id.toLowerCase(), take + 1]
      : [address, take + 1];
  const rows = await qSlow<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    size: string | null;
    fee: string | null;
  }>(
    `SELECT encode(p.tx_id, 'hex') AS id,
            COALESCE(p.height, t.height)::text AS height,
            t.timestamp_ms::text AS timestamp_ms,
            t.size::text AS size,
            t.fee::text AS fee
       FROM (
         SELECT x.tx_id, x.height
           FROM packed.address_tx x
          WHERE x.addr_id = (
            SELECT a.id FROM packed.addr a
             WHERE a.addr_md5 = md5($1) AND a.address = $1
             LIMIT 1
          )
            ${keyset}
          ORDER BY x.height DESC, x.tx_id
          LIMIT ${limitP}
       ) p
       LEFT JOIN packed.transactions t ON t.id = p.tx_id
      ORDER BY p.height DESC, p.tx_id`,
    params
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items: IdxTx[] = page.map((r) => ({
    id: r.id,
    inclusionHeight: r.height != null ? Number(r.height) : null,
    timestamp: r.timestamp_ms != null ? Number(r.timestamp_ms) : null,
    size: r.size != null ? Number(r.size) : null,
    fee: r.fee != null ? Number(r.fee) : null,
  }));
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last ? encodeKeysetCursor(last.inclusionHeight, last.id) : null,
  };
}

export async function addressTxActivity(
  address: string,
  txIds: string[]
): Promise<Record<string, AddrTxActivity>> {
  const out: Record<string, AddrTxActivity> = {};
  const ids = [...new Set(txIds.filter((id) => typeof id === "string" && id.length > 8))];
  if (!ids.length) return out;
  const packed = packedReadEnabled();
  const hexIds = packed ? ids.filter(isHex64) : ids;
  if (!hexIds.length) return out;

  // Start from the page's tx ids. Walking this address's own boxes
  // reads the whole history of a contract like emission (~2M txs) and
  // the 8s timeout comes back as an empty tape.
  const [rows, feeRows] = await Promise.all([
    qSlow<{
      box_id: string;
      address: string | null;
      value_nano: string;
      creation_tx_id: string | null;
      spent_tx_id: string | null;
      side: string;
      token_id: string | null;
      token_amount: string | null;
    }>(
      packed
        ? `WITH p AS (SELECT decode(lower(x), 'hex') AS tx_id FROM unnest($1::text[]) AS x),
            self AS (
              SELECT id FROM packed.addr
               WHERE addr_md5 = md5($2) AND address = $2
               LIMIT 1
            )
       SELECT encode(b.box_id, 'hex') AS box_id, $2 AS address,
              b.value_nano::text AS value_nano,
              encode(b.creation_tx_id, 'hex') AS creation_tx_id,
              encode(b.spent_tx_id, 'hex') AS spent_tx_id, b.side,
              encode(ba.token_id, 'hex') AS token_id, ba.amount::text AS token_amount
       FROM (
         SELECT b.box_id, b.value_nano, b.creation_tx_id, b.spent_tx_id, 'out' AS side
           FROM p
           JOIN LATERAL (
             SELECT b.box_id, b.value_nano, b.creation_tx_id, b.spent_tx_id
               FROM packed.boxes b
              WHERE b.creation_tx_id = p.tx_id
                AND b.addr_id = (SELECT id FROM self)
           ) b ON true
         UNION ALL
         SELECT b.box_id, b.value_nano, b.creation_tx_id, b.spent_tx_id, 'in'
           FROM p
           JOIN LATERAL (
             SELECT b.box_id, b.value_nano, b.creation_tx_id, b.spent_tx_id
               FROM packed.boxes b
              WHERE b.spent_tx_id = p.tx_id
                AND b.addr_id = (SELECT id FROM self)
           ) b ON true
       ) b
       LEFT JOIN LATERAL (
         SELECT x.token_id, x.amount FROM packed.box_assets x WHERE x.box_id = b.box_id OFFSET 0
       ) ba ON true`
        : `WITH a AS (SELECT unnest($1::text[]) AS tx_id)
       SELECT b.box_id, b.address, b.value_nano::text AS value_nano,
              b.creation_tx_id, b.spent_tx_id, b.side,
              ba.token_id, ba.amount::text AS token_amount
       FROM (
         SELECT box_id, address, value_nano, creation_tx_id, spent_tx_id, 'out' AS side
           FROM boxes
          WHERE creation_tx_id IN (SELECT tx_id FROM a) AND address = $2
         UNION ALL
         SELECT box_id, address, value_nano, creation_tx_id, spent_tx_id, 'in' AS side
           FROM boxes
          WHERE spent_tx_id IN (SELECT tx_id FROM a) AND address = $2
       ) b
       LEFT JOIN box_assets ba ON ba.box_id = b.box_id`,
      [hexIds, address],
      8000
    ),
    qSlow<{ id: string; fee: string }>(
      packed
        ? `SELECT encode(id, 'hex') AS id, fee::text AS fee
             FROM packed.transactions
            WHERE id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`
        : `SELECT id, fee::text AS fee FROM transactions WHERE id = ANY($1::text[])`,
      [hexIds],
      4000
    ),
  ]);
  if (!rows?.length) return out;

  const fees = new Map<string, bigint>();
  for (const row of feeRows ?? []) fees.set(row.id, parseNanoErg(row.fee));

  const byTx = new Map<string, { inputs: FlowIo[]; outputs: FlowIo[] }>();
  for (const id of ids) byTx.set(id, { inputs: [], outputs: [] });

  const ioByBox = new Map<string, FlowIo>();
  for (const r of rows) {
    const txId = r.side === "out" ? r.creation_tx_id : r.spent_tx_id;
    if (!txId) continue;
    const key = `${r.side}:${r.box_id}`;
    let io = ioByBox.get(key);
    if (!io) {
      io = {
        boxId: r.box_id,
        address: r.address,
        value: r.value_nano || "0",
        assets: [],
      };
      ioByBox.set(key, io);
      if (r.side === "out") byTx.get(txId)?.outputs.push(io);
      else byTx.get(txId)?.inputs.push(io);
    }
    if (r.token_id) {
      io.assets.push({ tokenId: r.token_id, amount: r.token_amount || "0" });
    }
  }

  for (const [tid, { inputs, outputs }] of byTx) {
    const flow = flowForAddress(address, inputs, outputs, fees.get(tid) ?? 0n);
    if (flow) out[tid] = flow;
  }
  return out;
}

/**
 * From/To for one page of txs.
 * The tape shows one other address, or "many" once a second one exists.
 * Each side is two index probes that stop at that second address.
 * A 15k-output payment is not loaded box by box.
 */
const PARTY_PROBE_SQL = `
WITH p AS (
  SELECT decode(lower(x), 'hex') AS tx_id FROM unnest($1::text[]) AS x
),
self AS (
  SELECT id FROM packed.addr
   WHERE addr_md5 = md5($2) AND address = $2
   LIMIT 1
)
SELECT encode(tx_id, 'hex') AS tx_id, side, address FROM (
  SELECT p.tx_id, 'in'::text AS side, q.address, 1 AS ord
    FROM p
    JOIN LATERAL (
      SELECT ad.address, b.addr_id
        FROM packed.boxes b
        JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.spent_tx_id = p.tx_id
         AND b.addr_id IS DISTINCT FROM (SELECT id FROM self)
       LIMIT 1
    ) q ON true
  UNION ALL
  SELECT p.tx_id, 'in', q2.address, 2
    FROM p
    JOIN LATERAL (
      SELECT b.addr_id AS first_id
        FROM packed.boxes b
        JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.spent_tx_id = p.tx_id
         AND b.addr_id IS DISTINCT FROM (SELECT id FROM self)
       LIMIT 1
    ) q1 ON true
    JOIN LATERAL (
      SELECT ad.address
        FROM packed.boxes b
        JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.spent_tx_id = p.tx_id
         AND b.addr_id IS DISTINCT FROM (SELECT id FROM self)
         AND b.addr_id <> q1.first_id
       LIMIT 1
    ) q2 ON true
  UNION ALL
  SELECT p.tx_id, 'out', q.address, 1
    FROM p
    JOIN LATERAL (
      SELECT ad.address, b.addr_id
        FROM packed.boxes b
        JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.creation_tx_id = p.tx_id
         AND b.addr_id IS DISTINCT FROM (SELECT id FROM self)
         AND ad.address <> $3
         AND NOT EXISTS (
           SELECT 1 FROM packed.boxes i
            WHERE i.spent_tx_id = p.tx_id AND i.addr_id = b.addr_id
         )
       LIMIT 1
    ) q ON true
  UNION ALL
  SELECT p.tx_id, 'out', q2.address, 2
    FROM p
    JOIN LATERAL (
      SELECT b.addr_id AS first_id
        FROM packed.boxes b
        JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.creation_tx_id = p.tx_id
         AND b.addr_id IS DISTINCT FROM (SELECT id FROM self)
         AND ad.address <> $3
         AND NOT EXISTS (
           SELECT 1 FROM packed.boxes i
            WHERE i.spent_tx_id = p.tx_id AND i.addr_id = b.addr_id
         )
       LIMIT 1
    ) q1 ON true
    JOIN LATERAL (
      SELECT ad.address
        FROM packed.boxes b
        JOIN packed.addr ad ON ad.id = b.addr_id
       WHERE b.creation_tx_id = p.tx_id
         AND b.addr_id IS DISTINCT FROM (SELECT id FROM self)
         AND b.addr_id <> q1.first_id
         AND ad.address <> $3
         AND NOT EXISTS (
           SELECT 1 FROM packed.boxes i
            WHERE i.spent_tx_id = p.tx_id AND i.addr_id = b.addr_id
         )
       LIMIT 1
    ) q2 ON true
) s
ORDER BY tx_id, side, ord`;

/** When nobody is a fresh output, who still ended with more ERG. */
const PARTY_GAIN_SQL = `
WITH p AS (
  SELECT decode(lower(x), 'hex') AS tx_id FROM unnest($1::text[]) AS x
),
self AS (
  SELECT id FROM packed.addr
   WHERE addr_md5 = md5($2) AND address = $2
   LIMIT 1
),
nets AS (
  SELECT s.tx_id, ad.address, sum(s.signed) AS net
    FROM (
      SELECT b.creation_tx_id AS tx_id, b.addr_id, b.value_nano AS signed
        FROM packed.boxes b
       WHERE b.creation_tx_id IN (SELECT tx_id FROM p)
      UNION ALL
      SELECT b.spent_tx_id, b.addr_id, -b.value_nano
        FROM packed.boxes b
       WHERE b.spent_tx_id IN (SELECT tx_id FROM p)
    ) s
    JOIN packed.addr ad ON ad.id = s.addr_id
   WHERE s.addr_id IS DISTINCT FROM (SELECT id FROM self)
     AND ad.address <> $3
   GROUP BY s.tx_id, ad.address
)
SELECT encode(tx_id, 'hex') AS tx_id, address
  FROM (
    SELECT tx_id, address, net,
           row_number() OVER (PARTITION BY tx_id ORDER BY net DESC, address) AS rn
      FROM nets
     WHERE net > 0
  ) g
 WHERE rn <= 2`;

export async function addressTxParties(
  address: string,
  txIds: string[]
): Promise<Record<string, { from: string[]; to: string[] }>> {
  const ids = [...new Set(txIds.filter(isHex64))];
  const out: Record<string, { from: string[]; to: string[] }> = {};
  if (!ids.length || !address) return out;
  const rows = await qSlow<{
    tx_id: string;
    side: string;
    address: string | null;
  }>(PARTY_PROBE_SQL, [ids, address, MINERS_FEE_ADDRESS], 4000);
  if (!rows) return out;
  for (const id of ids) out[id] = { from: [], to: [] };
  for (const row of rows) {
    const slot = out[row.tx_id];
    const who = row.address?.trim();
    if (!slot || !who || who === address) continue;
    const list = row.side === "in" ? slot.from : slot.to;
    if (!list.includes(who)) list.push(who);
  }
  const unresolved = ids.filter((id) => !out[id]?.to.length);
  if (unresolved.length) {
    const gained = await qSlow<{ tx_id: string; address: string | null }>(
      PARTY_GAIN_SQL,
      [unresolved, address, MINERS_FEE_ADDRESS],
      4000
    );
    for (const row of gained ?? []) {
      const slot = out[row.tx_id];
      const who = row.address?.trim();
      if (!slot || !who || who === address || slot.to.includes(who)) continue;
      if (slot.to.length >= 2) continue;
      slot.to.push(who);
    }
  }
  // Token-only counterparty (a pool spent and recreated with the same ERG).
  // The fee contract stays on From only: collecting it is not a payment to the fee box.
  for (const slot of Object.values(out)) {
    if (slot.to.length) continue;
    const rest = slot.from.filter((a) => a !== MINERS_FEE_ADDRESS);
    if (rest.length) slot.to = rest;
  }
  return out;
}

export type IdxTokenMeta = {
  name: string | null;
  decimals: number | null;
  emission: number | null;
  artworkUrl: string | null;
};

export async function tokenMetaMany(
  ids: string[]
): Promise<Map<string, IdxTokenMeta>> {
  const map = new Map<string, IdxTokenMeta>();
  const uniq = [...new Set(ids.filter((id) => id && id.length === 64))];
  if (!uniq.length) return map;
  const rows = await q<{
    token_id: string;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    artwork_url: string | null;
  }>(
    `SELECT token_id, name, decimals::text AS decimals, emission::text AS emission,
            NULLIF(artwork_url, '') AS artwork_url
     FROM tokens WHERE token_id = ANY($1::text[])`,
    [uniq]
  );
  for (const r of rows ?? []) {
    map.set(r.token_id, {
      name: displayErgoTokenName(r.token_id, r.name),
      decimals: r.decimals != null ? Number(r.decimals) : null,
      emission: r.emission != null ? Number(r.emission) : null,
      artworkUrl: r.artwork_url,
    });
  }
  return map;
}

export type IdxHolder = {
  address: string;
  amount: number;
  boxes: number;
  firstHeight: number | null;
  lastHeight: number | null;
  txCount: number | null;
};

type TokenHoldersPage = {
  holders: IdxHolder[];
  uniqueAddresses: number;
  totalAmount: number;
  scannedBoxes: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export async function tokenHoldersFromIndex(
  tokenId: string,
  limit: number,
  offset: number,
  dir: "asc" | "desc" = "desc"
): Promise<TokenHoldersPage | null> {
  const take = Math.max(1, Math.min(100, limit));
  const skip = Math.max(0, Math.floor(offset) || 0);
  const agg = await q<{
    n: string;
    total: string;
    boxes: string;
  }>(
    `SELECT count(DISTINCT ad.address)::text AS n,
            COALESCE(sum(a.amount), 0)::text AS total,
            count(*)::text AS boxes
     FROM packed.box_assets a
     JOIN packed.boxes b ON b.box_id = a.box_id AND b.spent_tx_id IS NULL
     JOIN packed.addr ad ON ad.id = b.addr_id
     WHERE a.token_id = decode(lower($1), 'hex')`,
    [tokenId]
  );
  if (!agg) return null;
  const rows = await q<{
    address: string;
    amount: string;
    boxes: string;
  }>(
    `SELECT ad.address,
            sum(a.amount)::text AS amount,
            count(*)::text AS boxes
     FROM packed.box_assets a
     JOIN packed.boxes b ON b.box_id = a.box_id AND b.spent_tx_id IS NULL
     JOIN packed.addr ad ON ad.id = b.addr_id
     WHERE a.token_id = decode(lower($1), 'hex')
     GROUP BY ad.address
     ORDER BY sum(a.amount) ${dir === "asc" ? "ASC" : "DESC"}, ad.address
     LIMIT $2 OFFSET $3`,
    [tokenId, take + 1, skip]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page[page.length - 1];
  return {
    uniqueAddresses: Number(agg[0].n),
    totalAmount: Number(agg[0].total),
    scannedBoxes: Number(agg[0].boxes),
    hasMore,
    nextCursor: last ? encodeHolderCursor(last.amount, last.address) : null,
    holders: page.map((r) => ({
      address: r.address,
      amount: Number(r.amount),
      boxes: Number(r.boxes),
      firstHeight: null,
      lastHeight: null,
      txCount: null,
    })),
  };
}

/** Prefer token_balances (incremental writer) over a live unspent scan. Keyset, not OFFSET. */
export async function tokenHoldersFromBalances(
  tokenId: string,
  limit: number,
  offset: number,
  dir: "asc" | "desc" = "desc",
  cursor: HolderCursor | null = null,
  uniqueHint?: number | null
): Promise<TokenHoldersPage | null> {
  const take = Math.max(1, Math.min(100, limit));
  const skip = cursor ? 0 : Math.max(0, Math.floor(offset) || 0);
  const desc = dir !== "asc";
  const order = desc
    ? "token_balances.amount DESC, address ASC"
    : "token_balances.amount ASC, address ASC";
  const keyPred = desc
    ? `(amount <= $2::numeric AND (amount < $2::numeric OR address > $3))`
    : `(amount >= $2::numeric AND (amount > $2::numeric OR address > $3))`;
  const hint = uniqueHint != null && uniqueHint > 0 ? uniqueHint : null;
  const aggSql = hint
    ? `SELECT NULL::text AS n, COALESCE(sum(amount), 0)::text AS total
       FROM token_balances WHERE token_id = $1 AND amount > 0`
    : `SELECT count(*)::text AS n, COALESCE(sum(amount), 0)::text AS total
       FROM token_balances WHERE token_id = $1 AND amount > 0`;
  const pageSql = cursor
    ? `SELECT address, amount::text AS amount,
              first_height::text, last_height::text, tx_count::text
       FROM token_balances
       WHERE token_id = $1 AND amount > 0 AND ${keyPred}
       ORDER BY ${order}
       LIMIT $4`
    : `SELECT address, amount::text AS amount,
              first_height::text, last_height::text, tx_count::text
       FROM token_balances
       WHERE token_id = $1 AND amount > 0
       ORDER BY ${order}
       LIMIT $2 OFFSET $3`;
  const [agg, rows] = await Promise.all([
    q<{ n: string | null; total: string }>(aggSql, [tokenId]),
    q<{
      address: string;
      amount: string;
      first_height: string | null;
      last_height: string | null;
      tx_count: string | null;
    }>(
      pageSql,
      cursor ? [tokenId, cursor.amount, cursor.address, take + 1] : [tokenId, take + 1, skip]
    ),
  ]);
  if (!agg || !rows) return null;
  if (!cursor && skip === 0 && rows.length === 0) {
    return {
      holders: [],
      uniqueAddresses: 0,
      totalAmount: 0,
      scannedBoxes: 0,
      hasMore: false,
      nextCursor: null,
    };
  }
  const uniqueAddresses = hint ?? Number(agg[0].n ?? 0);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page[page.length - 1];
  return {
    uniqueAddresses,
    totalAmount: Number(agg[0].total),
    scannedBoxes: uniqueAddresses,
    hasMore,
    nextCursor: last ? encodeHolderCursor(last.amount, last.address) : null,
    holders: page.map((r) => ({
      address: r.address,
      amount: Number(r.amount),
      boxes: 0,
      firstHeight: nHeight(r.first_height),
      lastHeight: nHeight(r.last_height),
      txCount: (() => {
        const n = r.tx_count != null && r.tx_count !== "" ? Number(r.tx_count) : NaN;
        return Number.isFinite(n) ? n : null;
      })(),
    })),
  };
}

export type TokenTxKind = "mint" | "burn" | "transfer" | "swap";

export type IdxTokenTx = {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  created: string;
  spent: string;
  net: string;
  /** Sum of positive per-address nets of this token (0 = change / self-shuffle). */
  moved: string;
  kind: TokenTxKind;
  from: string[];
  to: string[];
};

/** Above this, a JSON number is not exact. Old box amounts can be a few ULPs off. */
const TOKEN_AMOUNT_SAFE = 9007199254740991n;

/**
 * Ergo mints a token only in the issuance tx (no inputs of that token).
 * A later created>spent row is a missing input or a rounded bank box, not a mint.
 * A gap of a few ULPs on an amount above 2^53 is the same rounding, not a burn.
 */
function tokenSupplyKind(created: string, spent: string): TokenTxKind {
  try {
    const c = BigInt(created.split(".")[0] ?? "0");
    const s = BigInt(spent.split(".")[0] ?? "0");
    if (c === s) return "transfer";
    if (s === 0n && c > 0n) return "mint";
    if (c > s) return "transfer";
    const mag = c > s ? c : s;
    const gap = s - c;
    if (mag > TOKEN_AMOUNT_SAFE) {
      let bits = 0;
      let n = mag;
      while (n > 1n) {
        n >>= 1n;
        bits += 1;
      }
      const ulp = bits > 52 ? 1n << BigInt(bits - 52) : 1n;
      if (gap <= ulp * 4n) return "transfer";
    }
    return "burn";
  } catch {
    return "transfer";
  }
}

/**
 * Mint: issuance only (`spent = 0`). Burn: real supply drop.
 * Not burn: a few ULPs on a sum above 2^53 (float64, before exact JSON parse).
 */
/** Indexed trade of this token (Spectrum / Lithos). Not an AgeUSD mint or redeem. */
const TOKEN_IS_SWAP_SQL = `EXISTS (
  SELECT 1 FROM defi.trades tr
  WHERE tr.tx_id = m.tx_id
    AND tr.token_id = m.token_id
    AND tr.side IN ('buy', 'sell')
)`;

const TOKEN_MINTBURN_SQL = `(
  (m.spent = 0 AND m.created > 0)
  OR (
    m.spent > m.created
    AND NOT (
      GREATEST(m.created, m.spent) > 9007199254740991
      AND abs(m.created - m.spent) <= CASE
        WHEN GREATEST(m.created, m.spent) > 0
        THEN 4 * power(2::numeric, floor(log(2::numeric, GREATEST(m.created, m.spent))) - 52)
        ELSE -1
      END
    )
  )
)`;

function tokenTxNet(created: string, spent: string): string {
  try {
    return (BigInt(created.split(".")[0] ?? "0") - BigInt(spent.split(".")[0] ?? "0")).toString();
  } catch {
    return "0";
  }
}

function pgTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is string => typeof a === "string" && a.length > 0);
}

function mapTokenMoveTx(r: {
  id: string;
  height: string | null;
  timestamp_ms: string | null;
  created: string;
  spent: string;
  moved: string;
  from_addrs?: unknown;
  to_addrs?: unknown;
}): IdxTokenTx {
  const created = r.created || "0";
  const spent = r.spent || "0";
  const parties = flowParties(
    pgTextArray(r.from_addrs).map((address) => ({ address })),
    pgTextArray(r.to_addrs).map((address) => ({ address }))
  );
  return {
    id: r.id,
    inclusionHeight: r.height != null ? Number(r.height) : null,
    timestamp: r.timestamp_ms != null ? Number(r.timestamp_ms) : null,
    created,
    spent,
    net: tokenTxNet(created, spent),
    moved: r.moved || "0",
    kind: tokenSupplyKind(created, spent),
    from: parties.from,
    to: parties.to,
  };
}

function mapTokenTx(r: {
  id: string;
  height: string | null;
  timestamp_ms: string | null;
  created: string;
  spent: string;
  from_addrs?: unknown;
  to_addrs?: unknown;
  from_amts?: unknown;
  to_amts?: unknown;
}): IdxTokenTx {
  const created = r.created || "0";
  const spent = r.spent || "0";
  const parties = netTokenParties(
    zipTokenLegs(r.from_addrs, r.from_amts),
    zipTokenLegs(r.to_addrs, r.to_amts)
  );
  return {
    id: r.id,
    inclusionHeight: r.height != null ? Number(r.height) : null,
    timestamp: r.timestamp_ms != null ? Number(r.timestamp_ms) : null,
    created,
    spent,
    net: tokenTxNet(created, spent),
    moved: parties.moved,
    kind: tokenSupplyKind(created, spent),
    from: parties.from,
    to: parties.to,
  };
}

/** Match index `token_tx_seen_height_idx` (height DESC NULLS LAST). Plain DESC sorts the whole token. */
function tokenTxSeenPageSql(withCursor: boolean): string {
  const keyset = withCursor
    ? `AND (
               s.height < $2
               OR (s.height = $2 AND s.tx_id < $3)
             )`
    : "";
  const limitP = withCursor ? "$4" : "$2";
  return `WITH page AS (
           SELECT s.tx_id AS id, s.height
           FROM token_tx_seen s
           WHERE s.token_id = $1
             AND s.height IS NOT NULL
             ${keyset}
           ORDER BY s.height DESC NULLS LAST, s.tx_id DESC
           LIMIT ${limitP}
         ),
         created AS (
           SELECT b.creation_tx_id AS tx_id, SUM(a.amount)::text AS created,
                  array_agg(b.address) FILTER (WHERE b.address IS NOT NULL) AS to_addrs,
                  array_agg(a.amount::text) FILTER (WHERE b.address IS NOT NULL) AS to_amts
           FROM page p
           JOIN boxes b ON b.creation_tx_id = p.id
           JOIN box_assets a ON a.box_id = b.box_id AND a.token_id = $1
           GROUP BY b.creation_tx_id
         ),
         spent AS (
           SELECT b.spent_tx_id AS tx_id, SUM(a.amount)::text AS spent,
                  array_agg(b.address) FILTER (WHERE b.address IS NOT NULL) AS from_addrs,
                  array_agg(a.amount::text) FILTER (WHERE b.address IS NOT NULL) AS from_amts
           FROM page p
           JOIN boxes b ON b.spent_tx_id = p.id
           JOIN box_assets a ON a.box_id = b.box_id AND a.token_id = $1
           GROUP BY b.spent_tx_id
         )
         SELECT p.id, p.height::text AS height, t.timestamp_ms::text AS timestamp_ms,
                COALESCE(c.created, '0') AS created, COALESCE(s.spent, '0') AS spent,
                COALESCE(s.from_addrs, ARRAY[]::text[]) AS from_addrs,
                COALESCE(c.to_addrs, ARRAY[]::text[]) AS to_addrs,
                COALESCE(s.from_amts, ARRAY[]::text[]) AS from_amts,
                COALESCE(c.to_amts, ARRAY[]::text[]) AS to_amts
         FROM page p
         LEFT JOIN transactions t ON t.id = p.id
         LEFT JOIN created c ON c.tx_id = p.id
         LEFT JOIN spent s ON s.tx_id = p.id
         ORDER BY p.height DESC NULLS LAST, p.id DESC`;
}

/**
 * Newest handoff on the transfers tape: not a mint, a burn, or a swap.
 * One index row. A same-address rewrite does not count.
 * Null when the lookup fails. `{ height: null }` when the token has no such row.
 */
export async function tokenTransferLast(
  tokenId: string
): Promise<{ height: number | null; ts: number | null } | null> {
  if (!packedReadEnabled() || !isHex64(tokenId)) return null;
  const rows = await q<{ height: string; ts: string | null }>(
    `SELECT m.height::text AS height, t.timestamp_ms::text AS ts
       FROM packed.token_tx_move m
       LEFT JOIN packed.transactions t ON t.id = m.tx_id
      WHERE m.token_id = decode(lower($1), 'hex')
        AND m.height IS NOT NULL
        AND NOT ${TOKEN_MINTBURN_SQL}
        AND NOT ${PACKED_TOKEN_IS_SWAP_SQL}
      ORDER BY m.height DESC NULLS LAST, m.tx_id DESC
      LIMIT 1`,
    [tokenId]
  );
  if (!rows) return null;
  const row = rows[0];
  if (!row) return { height: null, ts: null };
  const height = Number(row.height);
  if (!Number.isFinite(height)) return { height: null, ts: null };
  return { height, ts: tsMs(row.ts) };
}

/** Token tape from token_tx_seen. Keyset on stored height — not JOIN+OFFSET 270k txs. */
export async function tokenTransactions(
  tokenId: string,
  _offset: number,
  limit: number,
  flow: "all" | "mintburn" | "swap",
  cursor: KeysetCursor | null = null
): Promise<{
  items: IdxTokenTx[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  source: string;
} | null> {
  const take = Math.max(1, Math.min(100, limit));
  if (flow === "swap") return tokenSwapTransactions(tokenId, take, cursor);
  const packed = packedReadEnabled();
  if (packed && !isHex64(tokenId)) return { items: [], total: 0, hasMore: false, nextCursor: null, source: "indexer:packed" };
  const supply =
    flow === "mintburn" ? TOKEN_MINTBURN_SQL : `NOT ${TOKEN_MINTBURN_SQL}`;
  // Packed #txs total is tokens.tx_count: moves that are not a mint, a burn,
  // or a swap. A box rewrite that only carries the token is not included.
  // A COUNT of the history hits the 4s timeout and then blanks the list.
  const pageP = tokenTxMovePage(tokenId, cursor, take, flow);
  const [totMove, totSwap, page] = packed
    ? await (async () => {
        const ready = await pageP;
        const cat =
          flow === "all"
            ? await q<{ c: string }>(
                `SELECT COALESCE(tx_count, 0)::text AS c FROM tokens WHERE token_id = $1`,
                [tokenId]
              )
            : null;
        return [cat, null, ready] as const;
      })()
    : await Promise.all([
        q<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM token_tx_move m
        WHERE m.token_id = $1 AND m.height IS NOT NULL AND ${supply}`,
          [tokenId]
        ),
        flow === "all"
          ? q<{ c: string }>(
              `SELECT COUNT(DISTINCT t.tx_id)::text AS c
             FROM defi.trades t
            WHERE t.token_id = $1
              AND t.side IN ('buy', 'sell')
              AND (
                t.token_amount <> 0
                OR EXISTS (
                  SELECT 1 FROM token_tx_move m
                   WHERE m.token_id = t.token_id
                     AND m.tx_id = t.tx_id
                     AND m.moved <> 0
                )
              )`,
              [tokenId]
            )
          : Promise.resolve(null),
        pageP,
      ]);
  const moveN = Number(totMove?.[0]?.c || 0);
  const swapN = Number(totSwap?.[0]?.c || 0);
  const total =
    flow === "all"
      ? packed
        ? moveN
        : Math.max(0, moveN - swapN)
      : packed
        ? page && !page.hasMore
          ? page.items.length
          : moveN
        : moveN;
  if (!page) return null;
  return {
    items: page.items,
    total,
    hasMore: page.hasMore,
    nextCursor: page.hasMore ? page.nextCursor : null,
    source: flow === "mintburn" ? "indexer:token_tx_move+mintburn" : "indexer:token_tx_move",
  };
}

async function tokenSwapTransactions(
  tokenId: string,
  take: number,
  cursor: KeysetCursor | null
): Promise<{
  items: IdxTokenTx[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  source: string;
} | null> {
  const packed = packedReadEnabled();
  const moveFrom = packed ? "packed.token_tx_move" : "token_tx_move";
  // defi.trades ids are lowercase hex: decode() is built in, hex32() is PL/pgSQL and ran twice
  // per trade in the count (1.5 s for SigUSD's 86k trades on every page).
  const moveOnT = packed
    ? "m.token_id = decode(t.token_id, 'hex') AND m.tx_id = decode(t.tx_id, 'hex')"
    : "m.token_id = t.token_id AND m.tx_id = t.tx_id";
  const moveOnS = packed
    ? "m.token_id = decode(s.token_id, 'hex') AND m.tx_id = decode(s.tx_id, 'hex')"
    : "m.token_id = s.token_id AND m.tx_id = s.tx_id";
  const moveGroupKey = packed
    ? "CASE WHEN t.token_amount = 0 THEN encode(m.tx_id, 'hex') ELSE t.token_amount::text END"
    : "CASE WHEN t.token_amount = 0 THEN m.tx_id ELSE t.token_amount::text END";
  const movedTxIds = packed
    ? `SELECT encode(mv.tx_id, 'hex') FROM packed.token_tx_move mv
        WHERE mv.token_id = packed.hex32($1) AND mv.moved <> 0`
    : `SELECT mv.tx_id FROM token_tx_move mv
        WHERE mv.token_id = $1 AND mv.moved <> 0`;
  const keyset = cursor
    ? `AND (s.ts_ms < $2 OR (s.ts_ms = $2 AND s.tx_id < $3))`
    : "";
  const limitP = cursor ? "$4" : "$2";
  const params: unknown[] = cursor
    ? [tokenId, cursor.height, cursor.id, take + 1]
    : [tokenId, take + 1];
  const [tot, rows] = await Promise.all([
    q<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM (
         SELECT 1
           FROM defi.trades t
           LEFT JOIN ${moveFrom} m
             ON ${moveOnT}
          WHERE t.token_id = $1
            AND t.side IN ('buy', 'sell')
            AND (t.token_amount <> 0 OR COALESCE(m.moved, 0) <> 0)
          GROUP BY t.ts_ms, COALESCE(t.trader, ''),
                   ${moveGroupKey}
       ) g`,
      [tokenId]
    ),
    q<{
      id: string;
      height: string | null;
      ts_ms: string | null;
      timestamp_ms: string | null;
      created: string;
      spent: string;
      moved: string;
      from_addrs: unknown;
      to_addrs: unknown;
    }>(
      `SELECT s.tx_id AS id,
              COALESCE(m.height, s.height)::text AS height,
              s.ts_ms::text AS ts_ms,
              t.timestamp_ms::text AS timestamp_ms,
              COALESCE(m.created, 0)::text AS created,
              COALESCE(m.spent, 0)::text AS spent,
              CASE
                WHEN s.token_amount = 0 AND COALESCE(m.moved, 0) <> 0 THEN m.moved::text
                ELSE s.token_amount::text
              END AS moved,
              COALESCE(m.from_addrs, ARRAY[]::text[]) AS from_addrs,
              COALESCE(m.to_addrs, ARRAY[]::text[]) AS to_addrs
         FROM (
           SELECT DISTINCT ON (
                    ts_ms,
                    COALESCE(trader, ''),
                    CASE WHEN token_amount = 0 THEN tx_id ELSE token_amount::text END
                  )
                  tx_id, ts_ms, height, token_id, token_amount
             FROM defi.trades
            WHERE token_id = $1
              AND side IN ('buy', 'sell')
              AND (
                token_amount <> 0
                OR tx_id IN (
                  ${movedTxIds}
                )
              )
            ORDER BY ts_ms DESC, COALESCE(trader, ''),
                     CASE WHEN token_amount = 0 THEN tx_id ELSE token_amount::text END,
                     (base_id = repeat('0', 64)) DESC, tx_id DESC
         ) s
         LEFT JOIN ${moveFrom} m
           ON ${moveOnS}
         LEFT JOIN ${
           packedReadEnabled() ? "packed.transactions" : "transactions"
         } t ON t.id = ${
           packedReadEnabled()
             ? `CASE WHEN s.tx_id ~ '^[0-9a-fA-F]{64}$' THEN decode(lower(s.tx_id), 'hex') ELSE NULL END`
             : "s.tx_id"
         }
        WHERE TRUE
          ${keyset}
        ORDER BY s.ts_ms DESC, s.tx_id DESC
        LIMIT ${limitP}`,
      params
    ),
  ]);
  if (!rows) return null;
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  const hasMore = rows.length > take;
  const page = unique.slice(0, take);
  const items = page.map((r) => {
    const row = mapTokenMoveTx(r);
    return { ...row, kind: "swap" as const, moved: r.moved || row.moved };
  });
  const last = rows.length > take ? rows[take - 1] : rows[rows.length - 1];
  const ts = last?.ts_ms != null ? Number(last.ts_ms) : NaN;
  return {
    items,
    total: Number(tot?.[0]?.c || 0),
    hasMore,
    nextCursor: hasMore && last && Number.isFinite(ts) ? encodeKeysetCursor(ts, last.id) : null,
    source: "indexer:token_tx_move+swap",
  };
}

function tokenTxMovePageSql(withCursor: boolean, flow: "all" | "mintburn"): string {
  const packed = packedReadEnabled();
  const keyset = withCursor
    ? packed
      ? `AND (
               m.height < $2
               OR (m.height = $2 AND m.tx_id < decode($3, 'hex'))
             )`
      : `AND (
               m.height < $2
               OR (m.height = $2 AND m.tx_id < $3)
             )`
    : "";
  const limitP = withCursor ? "$4" : "$2";
  if (packed) {
    const swap = flow === "mintburn" ? "" : `AND NOT ${PACKED_TOKEN_IS_SWAP_SQL}`;
    const supply =
      flow === "mintburn"
        ? `AND ${TOKEN_MINTBURN_SQL}`
        : `AND NOT ${TOKEN_MINTBURN_SQL} ${swap}`;
    // Index is (token_id, height DESC NULLS LAST, tx_id DESC) WHERE height IS NOT NULL.
    // Limit inside the scan, then look up only that page of transaction heads.
    return `SELECT encode(p.tx_id, 'hex') AS id, p.height::text AS height,
                  t.timestamp_ms::text AS timestamp_ms,
                  p.created::text AS created, p.spent::text AS spent, p.moved::text AS moved,
                  p.from_addrs, p.to_addrs
             FROM (
               SELECT m.tx_id, m.height, m.created, m.spent, m.moved, m.from_addrs, m.to_addrs
                 FROM packed.token_tx_move m
                WHERE m.token_id = decode(lower($1), 'hex')
                  AND m.height IS NOT NULL
                  ${supply}
                  ${keyset}
                ORDER BY m.height DESC NULLS LAST, m.tx_id DESC
                LIMIT ${limitP}
             ) p
             LEFT JOIN packed.transactions t ON t.id = p.tx_id
            ORDER BY p.height DESC NULLS LAST, p.tx_id DESC`;
  }
  // Issuance is the only mint. A later surplus is rounded history, not a mint.
  // Float dust on amounts above 2^53 is not a burn.
  const supply =
    flow === "mintburn"
      ? `AND ${TOKEN_MINTBURN_SQL}`
      : `AND NOT ${TOKEN_MINTBURN_SQL} AND NOT ${TOKEN_IS_SWAP_SQL}`;
  return `SELECT m.tx_id AS id, m.height::text AS height, t.timestamp_ms::text AS timestamp_ms,
                m.created::text AS created, m.spent::text AS spent, m.moved::text AS moved,
                m.from_addrs, m.to_addrs
         FROM token_tx_move m
         LEFT JOIN transactions t ON t.id = m.tx_id
         WHERE m.token_id = $1
           AND m.height IS NOT NULL
           ${supply}
           ${keyset}
         ORDER BY m.height DESC NULLS LAST, m.tx_id DESC
         LIMIT ${limitP}`;
}

async function tokenTxMovePage(
  tokenId: string,
  cursor: KeysetCursor | null,
  take: number,
  flow: "all" | "mintburn"
): Promise<{ items: IdxTokenTx[]; hasMore: boolean; nextCursor: string | null } | null> {
  const packed = packedReadEnabled();
  const usable =
    cursor && (!packed || isHex64(cursor.id)) ? cursor : null;
  const rows = await q<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    created: string;
    spent: string;
    moved: string;
    from_addrs: unknown;
    to_addrs: unknown;
  }>(
    tokenTxMovePageSql(Boolean(usable), flow),
    usable
      ? [tokenId, usable.height, packed ? usable.id.toLowerCase() : usable.id, take + 1]
      : [tokenId, take + 1]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items = page.map(mapTokenMoveTx);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last ? encodeKeysetCursor(last.inclusionHeight, last.id) : null,
  };
}

async function tokenTxSeenPage(
  tokenId: string,
  cursor: KeysetCursor | null,
  take: number
): Promise<{ items: IdxTokenTx[]; hasMore: boolean; nextCursor: string | null } | null> {
  const rows = await q<{
    id: string;
    height: string | null;
    timestamp_ms: string | null;
    created: string;
    spent: string;
    from_addrs: unknown;
    to_addrs: unknown;
    from_amts: unknown;
    to_amts: unknown;
  }>(
    tokenTxSeenPageSql(Boolean(cursor)),
    cursor ? [tokenId, cursor.height, cursor.id, take + 1] : [tokenId, take + 1]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items = page.map(mapTokenTx);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last ? encodeKeysetCursor(last.inclusionHeight, last.id) : null,
  };
}

/** P2-5: NFT-like catalog from unspent amount=1 assets (+ tokens meta). */
export type IdxNft = {
  tokenId: string;
  name: string | null;
  decimals: number | null;
  emission: number | null;
  boxId: string | null;
  firstHeight: number | null;
  creationHeight: number | null;
  creationTxId: string | null;
  address: string | null;
  issuerAddress: string | null;
  amount: number;
  artworkUrl: string | null;
  kind: NftKind | null;
  mediaUrl: string | null;
  sha256: string | null;
  collection: string;
  slug: string;
};

function cleanNftName(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!t || t.includes("\uFFFD")) return null;
  if (t.length < 1 || t.length > 120) return null;
  const good = [...t].filter((ch) => ch.charCodeAt(0) >= 32).length;
  if (good / t.length < 0.85) return null;
  return t;
}

function mapNftRow(r: {
  token_id: string;
  name: string | null;
  decimals: string | null;
  emission: string | null;
  t_box_id: string | null;
  first_height: string | null;
  creation_height: string | null;
  creation_tx_id: string | null;
  address: string | null;
  issuer_address?: string | null;
  amount: string;
  box_id: string;
  artwork_url: string | null;
}): IdxNft {
  const name = cleanNftName(r.name);
  const { collection, slug } = nftCollectionFromName(name, r.token_id);
  return {
    tokenId: r.token_id,
    name,
    decimals: r.decimals != null ? Number(r.decimals) : null,
    emission: r.emission != null ? Number(r.emission) : null,
    boxId: r.t_box_id ?? r.box_id,
    firstHeight: r.first_height != null ? Number(r.first_height) : null,
    creationHeight: r.creation_height != null ? Number(r.creation_height) : null,
    creationTxId: r.creation_tx_id,
    address: r.address,
    issuerAddress: r.issuer_address ?? null,
    amount: Number(r.amount),
    artworkUrl: r.artwork_url && r.artwork_url.length > 0 ? r.artwork_url : null,
    kind: null,
    mediaUrl: null,
    sha256: null,
    collection,
    slug,
  };
}

/** Page-sized PK joins. Artwork from mint output registers already in PG. */
async function artworkByTokenIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need = [...new Set(ids.filter((id) => id && id.length === 64))];
  if (!need.length) return out;
  const regs = await mintOutputRegsByTokenIds(need);
  for (const id of need) {
    const raw = regs.get(id);
    if (!raw) continue;
    const url = pickArtworkUrl(decodeRegisterMap(regsAsHexMap(raw)));
    if (url) out.set(id, url);
  }
  return out;
}

/** Page-sized PK joins. Fills name/art/kind from mint output registers already in PG. */
async function fillNftMetaFromMint(items: IdxNft[]): Promise<IdxNft[]> {
  const need = items
    .filter((it) => !it.name || !it.artworkUrl || !it.kind)
    .map((it) => it.tokenId);
  if (!need.length) return items;
  const ctxs = await mintNftContextByTokenIds(need);
  return items.map((it) => {
    const ctx = ctxs.get(it.tokenId);
    if (!ctx) return it;
    const decoded = decodeRegisterMap(regsAsHexMap(ctx.mintRegs));
    const media = eip4MediaFromRegs(ctx.mintRegs);
    const name =
      displayErgoTokenName(it.tokenId, it.name) ||
      eip4TextNameFromRegs(ctx.mintRegs);
    const artworkUrl =
      it.artworkUrl || eip4PreviewUrl(media) || pickArtworkUrl(decoded);
    const coll = nftCollectionFromName(name, it.tokenId);
    return {
      ...it,
      name,
      artworkUrl,
      kind: it.kind || media.kind,
      mediaUrl: it.mediaUrl || media.url,
      sha256: it.sha256 || media.sha256,
      issuerAddress: it.issuerAddress || ctx.issuerAddress,
      creationTxId: it.creationTxId || ctx.mintTxId,
      collection: coll.collection,
      slug: coll.slug,
    };
  });
}

async function fillTokenHitArt(items: IdxTokenHit[]): Promise<IdxTokenHit[]> {
  const need = items
    .filter((it) => !it.artworkUrl || !it.kind)
    .map((it) => it.tokenId);
  if (!need.length) return items;
  const ctxs = await mintNftContextByTokenIds(need);
  if (!ctxs.size) return items;
  return items.map((it) => {
    const ctx = ctxs.get(it.tokenId);
    if (!ctx) return it;
    const media = eip4MediaFromRegs(ctx.mintRegs);
    return {
      ...it,
      artworkUrl: it.artworkUrl || eip4PreviewUrl(media),
      kind: it.kind || media.kind,
      mediaUrl: it.mediaUrl || media.url,
    };
  });
}

export type NftCatalogPage = {
  items: IdxNft[];
  total: number;
  named: number;
  withArt: number;
  kind: NftKind | null;
  kindReady: boolean;
  kinds: Record<NftKind, number>;
};

const NFT_ROW_SQL = `t.token_id,
              t.name,
              t.decimals::text AS decimals,
              t.emission::text AS emission,
              t.box_id AS t_box_id,
              t.first_height::text AS first_height,
              t.artwork_url,
              t.last_height::text AS creation_height,
              encode(spent.spent_tx_id, 'hex') AS creation_tx_id,
              ad.address AS issuer_address,
              NULL::text AS address,
              '1'::text AS amount,
              coalesce(t.box_id, t.token_id) AS box_id`;

export async function nftCatalogFromIndex(
  limit: number,
  offset: number,
  kind: NftKind | null = null
): Promise<NftCatalogPage | null> {
  // tokens only — never COUNT/DISTINCT on box_assets (4s statement_timeout).
  const take = Math.max(1, limit) + 1;
  const kinds = (await nftKindCountsFromIndex()) ?? {
    image: 0,
    audio: 0,
    video: 0,
    collection: 0,
    file: 0,
    membership: 0,
  };
  const kindReady = kind ? await tokensHaveNftKindColumn() : true;
  if (kind && !kindReady) {
    return {
      items: [],
      total: 0,
      named: 0,
      withArt: 0,
      kind,
      kindReady: false,
      kinds,
    };
  }
  const kindSql = kind ? ` AND t.nft_kind = $4` : "";
  const totKindSql = kind ? ` AND nft_kind = $2` : "";
  const totParams = kind ? [NFT_SKIP_IDS, kind] : [NFT_SKIP_IDS];
  const rowParams = kind ? [take, offset, NFT_SKIP_IDS, kind] : [take, offset, NFT_SKIP_IDS];
  const [tot, rows] = await Promise.all([
    q<{ c: string; named: string; with_art: string }>(
      `SELECT count(*)::text AS c,
              count(*) FILTER (WHERE name IS NOT NULL AND btrim(name) <> '')::text AS named,
              count(*) FILTER (WHERE NULLIF(artwork_url, '') IS NOT NULL)::text AS with_art
         FROM tokens
        WHERE emission = 1
          AND token_id <> ALL($1::text[])${totKindSql}`,
      totParams
    ),
    q<{
      token_id: string;
      name: string | null;
      decimals: string | null;
      emission: string | null;
      t_box_id: string | null;
      first_height: string | null;
      creation_height: string | null;
      creation_tx_id: string | null;
      issuer_address: string | null;
      address: string | null;
      amount: string;
      box_id: string;
      artwork_url: string | null;
    }>(
      `SELECT ${NFT_ROW_SQL}
         FROM (
           SELECT t.token_id, t.name, t.decimals, t.emission, t.box_id,
                  t.first_height, t.artwork_url, t.last_height
             FROM tokens t
            WHERE t.emission = 1
              AND t.token_id <> ALL($3::text[])${kindSql}
            ORDER BY
              CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
              CASE WHEN t.name IS NOT NULL AND t.name <> '' THEN 0 ELSE 1 END,
              COALESCE(t.last_height, t.first_height, 0) DESC,
              t.token_id
            LIMIT $1 OFFSET $2
         ) t
         LEFT JOIN packed.boxes spent ON spent.box_id = decode(t.token_id, 'hex')
         LEFT JOIN packed.addr ad ON ad.id = spent.addr_id`,
      rowParams
    ),
  ]);
  if (!rows) return null;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = await fillNftMetaFromMint(pageRows.map(mapNftRow));
  const counted = tot?.[0]?.c != null ? Number(tot[0].c) : NaN;
  const total = Number.isFinite(counted)
    ? counted
    : offset + items.length + (hasMore ? 1 : 0);
  return {
    items,
    total,
    named: tot?.[0]?.named != null ? Number(tot[0].named) : 0,
    withArt: tot?.[0]?.with_art != null ? Number(tot[0].with_art) : 0,
    kind,
    kindReady: true,
    kinds,
  };
}

/** Recent mints in the indexed window — first_height, not artwork-first. */
export async function recentNftsFromIndex(
  limit: number
): Promise<IdxNft[] | null> {
  const rows = await q<{
    token_id: string;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    t_box_id: string | null;
    first_height: string | null;
    creation_height: string | null;
    creation_tx_id: string | null;
    issuer_address: string | null;
    address: string | null;
    amount: string;
    box_id: string;
    artwork_url: string | null;
  }>(
    `SELECT ${NFT_ROW_SQL}
       FROM (
         SELECT t.token_id, t.name, t.decimals, t.emission, t.box_id,
                t.first_height, t.artwork_url, t.last_height
           FROM tokens t
          WHERE t.emission = 1
            AND t.token_id <> ALL($2::text[])
          ORDER BY COALESCE(t.first_height, t.last_height, 0) DESC, t.token_id
          LIMIT $1
       ) t
       LEFT JOIN packed.boxes spent ON spent.box_id = decode(t.token_id, 'hex')
       LEFT JOIN packed.addr ad ON ad.id = spent.addr_id`,
    [Math.max(1, limit), NFT_SKIP_IDS]
  );
  if (!rows) return null;
  return fillNftMetaFromMint(rows.map(mapNftRow));
}

export async function nftNameGroupsFromIndex(
  limit: number
): Promise<NftNameGroup[] | null> {
  const rows = await q<{
    token_id: string;
    name: string | null;
    artwork_url: string | null;
    first_height: string | null;
    last_height: string | null;
  }>(
    `SELECT token_id, name, artwork_url, first_height::text, last_height::text
       FROM tokens
      WHERE emission = 1
        AND name IS NOT NULL AND btrim(name) <> ''
        AND token_id <> ALL($1::text[])
      ORDER BY COALESCE(last_height, first_height, 0) DESC
      LIMIT 2000`,
    [NFT_SKIP_IDS]
  );
  if (!rows) return null;
  const groups = groupNftNameCollections(
    rows.map((r) => ({
      tokenId: r.token_id,
      name: cleanNftName(r.name),
      artworkUrl: r.artwork_url && r.artwork_url.length > 0 ? r.artwork_url : null,
      height:
        r.last_height != null
          ? Number(r.last_height)
          : r.first_height != null
            ? Number(r.first_height)
            : null,
    })),
    limit
  );
  const need = groups.flatMap((g) => {
    const ids: string[] = [];
    if (!g.coverUrl && g.tokenIds[0]) ids.push(g.tokenIds[0]);
    for (const s of g.sample) {
      if (!s.artworkUrl) ids.push(s.tokenId);
    }
    return ids;
  });
  const arts = await artworkByTokenIds(need);
  if (!arts.size) return groups;
  return groups.map((g) => {
    const sample = g.sample.map((s) => ({
      ...s,
      artworkUrl: s.artworkUrl || arts.get(s.tokenId) || null,
    }));
    return {
      ...g,
      sample,
      coverUrl:
        g.coverUrl ||
        sample.find((s) => s.artworkUrl)?.artworkUrl ||
        (g.tokenIds[0] ? arts.get(g.tokenIds[0]) ?? null : null),
    };
  });
}

export async function nftNameGroupDetailFromIndex(
  slug: string,
  limit: number,
  offset: number
): Promise<{ name: string; items: IdxNft[]; total: number } | null> {
  const groups = await nftNameGroupsFromIndex(80);
  if (!groups) return null;
  const group = groups.find((g) => g.slug === slug);
  if (!group) return { name: slug, items: [], total: 0 };
  const prefix = group.name.replace(/[%_]/g, "\\$&");
  const take = Math.max(1, limit) + 1;
  const rows = await q<{
    token_id: string;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    t_box_id: string | null;
    first_height: string | null;
    creation_height: string | null;
    creation_tx_id: string | null;
    issuer_address: string | null;
    address: string | null;
    amount: string;
    box_id: string;
    artwork_url: string | null;
  }>(
    `SELECT ${NFT_ROW_SQL}
       FROM (
         SELECT t.token_id, t.name, t.decimals, t.emission, t.box_id,
                t.first_height, t.artwork_url, t.last_height
           FROM tokens t
          WHERE t.emission = 1
            AND t.name IS NOT NULL
            AND t.name ILIKE $3 ESCAPE '\\'
            AND t.token_id <> ALL($4::text[])
          ORDER BY
            CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
            COALESCE(t.last_height, t.first_height, 0) DESC
          LIMIT $1 OFFSET $2
       ) t
       LEFT JOIN packed.boxes spent ON spent.box_id = decode(t.token_id, 'hex')
       LEFT JOIN packed.addr ad ON ad.id = spent.addr_id`,
    [take + 80, offset, `${prefix}%`, NFT_SKIP_IDS]
  );
  if (!rows) return null;
  const filled = await fillNftMetaFromMint(rows.map(mapNftRow));
  const matched = filled.filter((it) => it.slug === slug);
  const page = matched.slice(0, limit);
  return {
    name: group.name,
    items: page,
    total: Math.max(group.count, offset + page.length + (matched.length > limit ? 1 : 0)),
  };
}

export type NftIssuerGroup = {
  rank: number;
  address: string;
  count: number;
  coverUrl: string | null;
  sampleName: string | null;
  latestHeight: number | null;
};

export async function nftIssuersFromIndex(
  limit: number
): Promise<NftIssuerGroup[] | null> {
  const rows = await qSlow<{
    issuer: string;
    n: string;
    latest: string | null;
    cover: string | null;
    sample_name: string | null;
    sample_id: string | null;
  }>(
    `SELECT ad.address AS issuer,
            count(*)::text AS n,
            max(COALESCE(t.last_height, t.first_height))::text AS latest,
            (array_agg(NULLIF(t.artwork_url, '') ORDER BY
              CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
              COALESCE(t.last_height, t.first_height) DESC NULLS LAST
            ))[1] AS cover,
            (array_agg(NULLIF(btrim(t.name), '') ORDER BY
              CASE WHEN t.name IS NOT NULL AND btrim(t.name) <> '' THEN 0 ELSE 1 END
            ))[1] AS sample_name,
            (array_agg(t.token_id ORDER BY
              CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
              COALESCE(t.last_height, t.first_height) DESC NULLS LAST
            ))[1] AS sample_id
       FROM tokens t
       JOIN packed.boxes spent ON spent.box_id = packed.hex32(t.token_id)
       JOIN packed.addr ad ON ad.id = spent.addr_id
      WHERE t.emission = 1
        AND t.token_id <> ALL($1::text[])
        AND ad.address IS NOT NULL
      GROUP BY ad.address
     HAVING count(*) >= 2
      ORDER BY count(*) DESC, max(COALESCE(t.last_height, t.first_height)) DESC NULLS LAST
      LIMIT $2`,
    [NFT_SKIP_IDS, Math.max(1, limit)],
    12_000
  );
  if (!rows) return null;
  const arts = await artworkByTokenIds(
    rows.filter((r) => !r.cover && r.sample_id).map((r) => r.sample_id as string)
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    address: r.issuer,
    count: Number(r.n),
    coverUrl:
      (r.cover && r.cover.length > 0 ? r.cover : null) ||
      (r.sample_id ? arts.get(r.sample_id) ?? null : null),
    sampleName: cleanNftName(r.sample_name),
    latestHeight: r.latest != null ? Number(r.latest) : null,
  }));
}

export async function nftIssuerItemsFromIndex(
  address: string,
  limit: number,
  offset: number
): Promise<{ items: IdxNft[]; total: number } | null> {
  const addrPred = (p: string) =>
    `ad.addr_md5 = md5(${p}) AND ad.address = ${p}`;
  const take = Math.max(1, limit) + 1;
  const [tot, rows] = await Promise.all([
    q<{ c: string }>(
      `SELECT count(*)::text AS c
         FROM tokens t
         JOIN packed.boxes spent ON spent.box_id = packed.hex32(t.token_id)
       JOIN packed.addr ad ON ad.id = spent.addr_id
        WHERE t.emission = 1
          AND t.token_id <> ALL($2::text[])
          AND ${addrPred("$1")}`,
      [address, NFT_SKIP_IDS]
    ),
    q<{
      token_id: string;
      name: string | null;
      decimals: string | null;
      emission: string | null;
      t_box_id: string | null;
      first_height: string | null;
      creation_height: string | null;
      creation_tx_id: string | null;
      issuer_address: string | null;
      address: string | null;
      amount: string;
      box_id: string;
      artwork_url: string | null;
    }>(
      `SELECT ${NFT_ROW_SQL}
         FROM tokens t
         JOIN packed.boxes spent ON spent.box_id = packed.hex32(t.token_id)
       JOIN packed.addr ad ON ad.id = spent.addr_id
        WHERE t.emission = 1
          AND t.token_id <> ALL($4::text[])
          AND ${addrPred("$3")}
        ORDER BY
          CASE WHEN NULLIF(t.artwork_url, '') IS NOT NULL THEN 0 ELSE 1 END,
          COALESCE(t.last_height, t.first_height, 0) DESC
        LIMIT $1 OFFSET $2`,
      [take, offset, address, NFT_SKIP_IDS]
    ),
  ]);
  if (!rows) return null;
  const hasMore = rows.length > limit;
  const items = await fillNftMetaFromMint((hasMore ? rows.slice(0, limit) : rows).map(mapNftRow));
  const counted = tot?.[0]?.c != null ? Number(tot[0].c) : NaN;
  return {
    items,
    total: Number.isFinite(counted)
      ? counted
      : offset + items.length + (hasMore ? 1 : 0),
  };
}

export async function tokenMetaFromIndex(
  tokenId: string
): Promise<{
  tokenId: string;
  name: string | null;
  description: string | null;
  decimals: number | null;
  emission: number | null;
  boxId: string | null;
  firstHeight: number | null;
  lastHeight: number | null;
  holders: number | null;
  txCount: number | null;
  unspentBoxes: number | null;
  artworkUrl: string | null;
  registers: Record<string, string>;
  issuerAddress: string | null;
  mintTxId: string | null;
  nft: {
    kind: NftKind | null;
    sha256: string | null;
    url: string | null;
    coverUrl: string | null;
    extraUrls: string[];
    ipfsCid: string | null;
    royaltyPercent: number | null;
    collectionTokenId: string | null;
    collectionName: string | null;
    mintAddress: string | null;
    mintTxId: string | null;
    mintHeight: number | null;
  } | null;
} | null> {
  const rows = await q<{
    token_id: string;
    name: string | null;
    description: string | null;
    decimals: string | null;
    emission: string | null;
    box_id: string | null;
    first_height: string | null;
    last_height: string | null;
    holders: string | null;
    tx_count: string | null;
    unspent_boxes: string | null;
    artwork_url: string | null;
    issuance_regs: unknown;
  }>(
    `SELECT t.token_id, t.name, t.description, t.decimals::text, t.emission::text,
            t.box_id, t.first_height::text, t.last_height::text,
            t.holders::text, t.tx_count::text, t.unspent_boxes::text,
            NULLIF(t.artwork_url, '') AS artwork_url
     FROM tokens t
     WHERE t.token_id = $1`,
    [tokenId]
  );
  if (!rows || !rows[0]) return null;
  const r = rows[0];
  const ctx = (await mintNftContextByTokenIds([tokenId])).get(tokenId);
  const mintRegs = ctx?.mintRegs;
  const registers = regsAsHexMap(mintRegs);
  const decoded = decodeRegisterMap(registers);
  const name =
    displayErgoTokenName(tokenId, r.name) || eip4TextNameFromRegs(mintRegs);
  const media = eip4MediaFromRegs(mintRegs);
  const eip24 = eip24FromIssuerRegs(ctx?.issuerRegs);
  let collectionName: string | null = null;
  if (eip24.collectionTokenId) {
    const coll = await q<{ name: string | null }>(
      `SELECT name FROM tokens WHERE token_id = $1`,
      [eip24.collectionTokenId]
    );
    collectionName = coll?.[0]?.name?.trim() || null;
  }
  const firstHeight = r.first_height != null ? Number(r.first_height) : null;
  const emission = r.emission != null ? Number(r.emission) : null;
  const artworkUrl = r.artwork_url ?? eip4PreviewUrl(media) ?? pickArtworkUrl(decoded);
  const showNft =
    emission === 1 ||
    media.kind != null ||
    media.url != null ||
    eip24.royaltyPercent != null ||
    eip24.collectionTokenId != null;
  return {
    tokenId: r.token_id,
    name: name || null,
    description: eip4DescriptionFromIndex(r.description, mintRegs),
    decimals:
      r.decimals != null ? Number(r.decimals) : eip4DecimalsFromRegs(mintRegs),
    emission,
    boxId: r.box_id,
    firstHeight,
    lastHeight: r.last_height != null ? Number(r.last_height) : null,
    holders: r.holders != null ? Number(r.holders) : null,
    txCount: r.tx_count != null ? Number(r.tx_count) : null,
    unspentBoxes: r.unspent_boxes != null ? Number(r.unspent_boxes) : null,
    artworkUrl,
    registers,
    issuerAddress: ctx?.issuerAddress ?? null,
    mintTxId: ctx?.mintTxId ?? null,
    nft: showNft
      ? {
          kind: media.kind,
          sha256: media.sha256,
          url: media.url,
          coverUrl: media.coverUrl,
          extraUrls: media.extraUrls,
          ipfsCid: media.ipfsCid,
          royaltyPercent: eip24.royaltyPercent,
          collectionTokenId: eip24.collectionTokenId,
          collectionName,
          mintAddress: ctx?.issuerAddress ?? null,
          mintTxId: ctx?.mintTxId ?? null,
          mintHeight: firstHeight,
        }
      : null,
  };
}

/** P2-8: search tokens by name/id inside indexed window. */
export type IdxTokenHit = {
  tokenId: string;
  name: string | null;
  decimals: number | null;
  emission: number | null;
  firstHeight: number | null;
  isNftLike: boolean;
  unspentBoxes: number;
  artworkUrl: string | null;
  kind: NftKind | null;
  mediaUrl: string | null;
};

function mapTokenHit(r: {
  token_id: string;
  name: string | null;
  decimals: string | null;
  emission: string | null;
  first_height: string | null;
  unspent: string;
  artwork_url?: string | null;
}): IdxTokenHit {
  const emission = r.emission != null ? Number(r.emission) : null;
  return {
    tokenId: r.token_id,
    name: displayErgoTokenName(r.token_id, r.name),
    decimals: r.decimals != null ? Number(r.decimals) : null,
    emission,
    firstHeight: r.first_height != null ? Number(r.first_height) : null,
    isNftLike: emission === 1,
    unspentBoxes: Number(r.unspent),
    artworkUrl: r.artwork_url ?? null,
    kind: null,
    mediaUrl: null,
  };
}

export async function searchTokensFromIndex(
  query: string,
  limit: number,
  opts?: { nftOnly?: boolean }
): Promise<IdxTokenHit[] | null> {
  const qraw = query.trim();
  if (!qraw) return [];
  const nftOnly = !!opts?.nftOnly;
  // exact 64-hex token id
  if (/^[0-9a-fA-F]{64}$/.test(qraw)) {
    const rows = await q<{
      token_id: string;
      name: string | null;
      decimals: string | null;
      emission: string | null;
      first_height: string | null;
      unspent: string;
      artwork_url: string | null;
    }>(
      `SELECT t.token_id, t.name, t.decimals::text, t.emission::text, t.first_height::text,
              t.artwork_url,
              COALESCE(t.unspent_boxes, 0)::text AS unspent
       FROM tokens t WHERE t.token_id = $1`,
      [qraw.toLowerCase()]
    );
    if (!rows) return null;
    return fillTokenHitArt(rows.map(mapTokenHit));
  }

  const like = `%${qraw.replace(/[%_]/g, "\\$&")}%`;
  // P2-9: FTS (name_tsv) + ILIKE fallback in one query
  const fts = qraw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[':&|!()*]/g, ""))
    .filter((w) => w.length > 0)
    .join(" & ");
  const rows = await q<{
    token_id: string;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    first_height: string | null;
    unspent: string;
    artwork_url: string | null;
  }>(
    nftOnly
      ? `SELECT t.token_id, t.name, t.decimals::text, t.emission::text, t.first_height::text,
                t.artwork_url, COALESCE(t.unspent_boxes, 0)::text AS unspent
         FROM tokens t
         WHERE t.emission = 1
           AND (
             ($3 <> '' AND t.name_tsv @@ plainto_tsquery('simple', $3))
             OR t.name ILIKE $1 ESCAPE '\\'
           )
         ORDER BY
           CASE WHEN lower(t.name) = lower($4) THEN 0
                WHEN lower(t.name) LIKE lower($4) || '%' THEN 1
                ELSE 2 END,
           t.first_height DESC NULLS LAST
         LIMIT $2`
      : `SELECT t.token_id, t.name, t.decimals::text, t.emission::text, t.first_height::text,
                t.artwork_url,
                COALESCE(t.unspent_boxes, 0)::text AS unspent
         FROM tokens t
         WHERE (
           ($3 <> '' AND t.name_tsv @@ plainto_tsquery('simple', $3))
           OR t.name ILIKE $1 ESCAPE '\\'
         )
         ORDER BY
           CASE WHEN lower(t.name) = lower($4) THEN 0
                WHEN lower(t.name) LIKE lower($4) || '%' THEN 1
                ELSE 2 END,
           t.first_height DESC NULLS LAST
         LIMIT $2`,
    [like, limit, fts || qraw, qraw]
  );
  if (!rows) return null;
  return fillTokenHitArt(rows.map(mapTokenHit));
}

export type TokenCatalogSort = "last" | "first" | "holders" | "supply" | "txs" | "name";
export type TokenCatalogDir = "asc" | "desc";

export type TokenCatalogItem = {
  tokenId: string;
  name: string | null;
  decimals: number;
  emission: string | null;
  artworkUrl: string | null;
  holders: number | null;
  unspentBoxes: number | null;
  txCount: number | null;
  firstHeight: number | null;
  lastHeight: number | null;
  firstTs: number | null;
  lastTs: number | null;
};

export type TokenCatalogKpis = {
  tokenCount: number | null;
  holderCount: number | null;
  txCount: number | null;
  namedCount: number | null;
  nftLike: number | null;
};

export type TokenCatalogPage = {
  items: TokenCatalogItem[];
  total: number;
  offset: number;
  limit: number;
  sort: TokenCatalogSort;
  dir: TokenCatalogDir;
  q: string;
  kpis: TokenCatalogKpis;
  updatedAt: string | null;
};

const TOKEN_SORT: Record<TokenCatalogSort, string> = {
  last: "COALESCE(t.last_height, t.first_height)",
  first: "t.first_height",
  holders: "t.holders",
  supply: "t.emission",
  txs: "t.tx_count",
  name: "lower(COALESCE(t.name, t.token_id))",
};

function nInt(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function listTokensCatalog(opts: {
  limit: number;
  offset: number;
  sort: TokenCatalogSort;
  dir: TokenCatalogDir;
  q?: string;
}): Promise<TokenCatalogPage | null> {
  const p = getIndexPool();
  if (!p) return null;
  const limit = Math.min(50, Math.max(1, opts.limit));
  const offset = Math.max(0, opts.offset);
  const sort = opts.sort in TOKEN_SORT ? opts.sort : "last";
  const dir: TokenCatalogDir = opts.dir === "asc" ? "asc" : "desc";
  const qraw = (opts.q ?? "").trim();
  const orderExpr = TOKEN_SORT[sort];
  const dirSql = dir === "asc" ? "ASC" : "DESC";
  const nulls = dir === "asc" ? "NULLS FIRST" : "NULLS LAST";

  const where: string[] = [];
  const params: unknown[] = [];
  if (qraw) {
    if (/^[0-9a-fA-F]{64}$/.test(qraw)) {
      params.push(qraw.toLowerCase());
      where.push(`t.token_id = $${params.length}`);
    } else {
      params.push(`%${qraw.replace(/[%_]/g, "\\$&")}%`);
      const like = `$${params.length}`;
      params.push(qraw);
      const exact = `$${params.length}`;
      where.push(
        `(t.name ILIKE ${like} ESCAPE '\\' OR t.token_id ILIKE ${like} ESCAPE '\\' OR lower(t.name) = lower(${exact}))`
      );
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const exactIdx = qraw && !/^[0-9a-fA-F]{64}$/.test(qraw) ? params.length : 0;
  const relSql =
    exactIdx > 0
      ? `CASE WHEN lower(COALESCE(t.name, '')) = lower($${exactIdx}) THEN 0 WHEN lower(COALESCE(t.name, '')) LIKE lower($${exactIdx}) || '%' THEN 1 ELSE 2 END, `
      : "";
  const orderSql = `ORDER BY ${relSql}${orderExpr} ${dirSql} ${nulls}, t.token_id ${dirSql}`;

  const countSql = `SELECT COUNT(*)::text AS n FROM tokens t ${whereSql}`;
  const blockTable = packedReadEnabled() ? "packed.blocks" : "blocks";
  const listSql = `
    SELECT t.token_id, t.name, t.decimals, t.emission::text AS emission, t.artwork_url,
           t.holders, t.unspent_boxes, t.tx_count,
           t.first_height, t.last_height,
           bf.timestamp_ms AS first_ts, bl.timestamp_ms AS last_ts
    FROM (
      SELECT t.token_id, t.name, t.decimals, t.emission, t.artwork_url,
             t.holders, t.unspent_boxes, t.tx_count, t.first_height, t.last_height
      FROM tokens t
      ${whereSql}
      ${orderSql}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    ) t
    LEFT JOIN ${blockTable} bf ON bf.height = t.first_height
    LEFT JOIN ${blockTable} bl ON bl.height = COALESCE(t.last_height, t.first_height)
    ${orderSql}
  `;

  try {
    const countR = await p.query<{ n: string }>(countSql, params);
    const listR = await p.query<{
      token_id: string;
      name: string | null;
      decimals: number | string | null;
      emission: string | null;
      artwork_url: string | null;
      holders: number | string | null;
      unspent_boxes: number | string | null;
      tx_count: number | string | null;
      first_height: number | string | null;
      last_height: number | string | null;
      first_ts: number | string | null;
      last_ts: number | string | null;
    }>(listSql, [...params, limit, offset]);

    let kpis: TokenCatalogKpis = {
      tokenCount: nInt(countR.rows[0]?.n),
      holderCount: null,
      txCount: null,
      namedCount: null,
      nftLike: null,
    };
    let updatedAt: string | null = null;
    try {
      const snap = await p.query<{
        payload: TokenCatalogKpis;
        updated_at: Date | string | null;
      }>(`SELECT payload, updated_at FROM snapshot_kv WHERE key = 'tokens_kpis'`);
      const row = snap.rows[0];
      if (row?.payload) {
        kpis = {
          tokenCount: nInt(row.payload.tokenCount) ?? kpis.tokenCount,
          holderCount: nInt(row.payload.holderCount),
          txCount: nInt(row.payload.txCount),
          namedCount: nInt(row.payload.namedCount),
          nftLike: nInt(row.payload.nftLike),
        };
        updatedAt =
          row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : row.updated_at
              ? String(row.updated_at)
              : null;
      }
    } catch {
      /* kpis optional */
    }

    const needName = listR.rows.filter((r) => !String(r.name ?? "").trim()).map((r) => r.token_id);
    const mintRegs = needName.length ? await mintOutputRegsByTokenIds(needName) : new Map();
    const items: TokenCatalogItem[] = listR.rows.map((r) => ({
      tokenId: r.token_id,
      name:
        displayErgoTokenName(r.token_id, r.name) ||
        eip4TextNameFromRegs(mintRegs.get(r.token_id)) ||
        r.name,
      decimals: nInt(r.decimals) ?? eip4DecimalsFromRegs(mintRegs.get(r.token_id)) ?? 0,
      emission: r.emission,
      artworkUrl: r.artwork_url,
      holders: nInt(r.holders),
      unspentBoxes: nInt(r.unspent_boxes),
      txCount: nInt(r.tx_count),
      firstHeight: nInt(r.first_height),
      lastHeight: nInt(r.last_height),
      firstTs: nInt(r.first_ts),
      lastTs: nInt(r.last_ts),
    }));

    if (/^[0-9a-fA-F]{64}$/.test(qraw) && items.length === 1) {
      const move = await tokenTransferLast(qraw.toLowerCase());
      if (move && items[0]) {
        items[0] = { ...items[0], lastHeight: move.height, lastTs: move.ts };
      }
    }

    return {
      items,
      total: nInt(countR.rows[0]?.n) ?? items.length,
      offset,
      limit,
      sort,
      dir,
      q: qraw,
      kpis,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export type ExplorerTokenRow = {
  tokenId: string;
  boxId: string | null;
  name: string | null;
  description: string | null;
  decimals: number | null;
  emission: string | null;
};

function mapExplorerTokenRow(r: {
  token_id: string;
  box_id: string | null;
  name: string | null;
  description: string | null;
  decimals: string | null;
  emission: string | null;
}): ExplorerTokenRow {
  return {
    tokenId: r.token_id,
    boxId: r.box_id,
    name: displayErgoTokenName(r.token_id, r.name),
    description: r.description,
    decimals: r.decimals != null ? Number(r.decimals) : null,
    emission: r.emission,
  };
}

/** One token row. emission stays text. No holders COUNT. */
export async function tokenLiteById(tokenId: string): Promise<{
  tokenId: string;
  name: string | null;
  decimals: number | null;
  emission: string | null;
  boxId: string | null;
} | null> {
  const id = tokenId.trim();
  if (!id) return null;
  const rows = await q<{
    token_id: string;
    name: string | null;
    decimals: string | null;
    emission: string | null;
    box_id: string | null;
  }>(
    `SELECT token_id, name, decimals::text AS decimals, emission::text AS emission, box_id
     FROM tokens WHERE token_id = $1`,
    [id]
  );
  if (!rows?.[0]) return null;
  const r = rows[0];
  const dec = r.decimals != null ? Number(r.decimals) : NaN;
  return {
    tokenId: r.token_id,
    name: r.name,
    decimals: Number.isFinite(dec) ? dec : null,
    emission: r.emission,
    boxId: r.box_id,
  };
}

/** Exact symbol match. `tokens` only — no box_assets COUNT. */
export async function tokensBySymbol(symbol: string, limit = 50): Promise<ExplorerTokenRow[] | null> {
  const name = symbol.trim();
  if (!name) return [];
  const take = Math.max(1, Math.min(100, limit));
  const rows = await q<{
    token_id: string;
    box_id: string | null;
    name: string | null;
    description: string | null;
    decimals: string | null;
    emission: string | null;
  }>(
    `SELECT token_id, box_id, name, description, decimals::text, emission::text
     FROM tokens
     WHERE lower(name) = lower($1)
     ORDER BY first_height DESC NULLS LAST, token_id
     LIMIT $2`,
    [name, take]
  );
  if (!rows) return null;
  return rows.map(mapExplorerTokenRow);
}

/** Name / id search on `tokens` only. No box_assets COUNT, no official HTTP. */
export async function tokensSearchLite(
  query: string,
  limit = 24
): Promise<ExplorerTokenRow[] | null> {
  const qraw = query.trim();
  if (!qraw) return [];
  const take = Math.max(1, Math.min(100, limit));
  if (/^[0-9a-fA-F]{64}$/.test(qraw)) {
    const rows = await q<{
      token_id: string;
      box_id: string | null;
      name: string | null;
      description: string | null;
      decimals: string | null;
      emission: string | null;
    }>(
      `SELECT token_id, box_id, name, description, decimals::text, emission::text
       FROM tokens WHERE token_id = $1`,
      [qraw.toLowerCase()]
    );
    if (!rows) return null;
    return rows.map(mapExplorerTokenRow);
  }
  const like = `%${qraw.replace(/[%_]/g, "\\$&")}%`;
  const rows = await q<{
    token_id: string;
    box_id: string | null;
    name: string | null;
    description: string | null;
    decimals: string | null;
    emission: string | null;
  }>(
    `SELECT token_id, box_id, name, description, decimals::text, emission::text
     FROM tokens
     WHERE name ILIKE $1 ESCAPE '\\'
     ORDER BY
       CASE WHEN lower(name) = lower($3) THEN 0
            WHEN lower(name) LIKE lower($3) || '%' THEN 1
            ELSE 2 END,
       first_height DESC NULLS LAST
     LIMIT $2`,
    [like, take, qraw]
  );
  if (!rows) return null;
  return rows.map(mapExplorerTokenRow);
}

export type IdxBoxAll = IdxBoxCursor & { spentTxId: string | null };

/** Official `/boxes/byAddress` — spent included. Address index only. */
export async function addressBoxesCursor(
  address: string,
  cursor: KeysetCursor | null,
  limit: number,
  offset = 0
): Promise<{ items: IdxBoxAll[]; hasMore: boolean; nextCursor: string | null } | null> {
  const take = Math.max(1, Math.min(100, limit));
  const skip = cursor ? 0 : Math.max(0, Math.min(500, Math.floor(offset) || 0));
  if (packedReadEnabled()) {
    return addressBoxesCursorPacked(address, cursor, take, skip);
  }
  const where = boxesAddressWhere(address, false);
  const rows = await qSlow<{
    box_id: string;
    value_nano: string;
    creation_height: string | null;
    address: string | null;
    ergo_tree: string | null;
    creation_tx_id: string | null;
    output_index: string | null;
    spent_tx_id: string | null;
  }>(
    cursor
      ? `SELECT box_id, value_nano::text AS value_nano, creation_height::text AS creation_height,
                address, ergo_tree, creation_tx_id, output_index::text AS output_index,
                spent_tx_id
         FROM boxes
         WHERE ${where}
           AND (
             COALESCE(creation_height, -1) < $2
             OR (COALESCE(creation_height, -1) = $2 AND box_id < $3)
           )
         ORDER BY creation_height DESC NULLS LAST, box_id DESC
         LIMIT $4`
      : `SELECT box_id, value_nano::text AS value_nano, creation_height::text AS creation_height,
                address, ergo_tree, creation_tx_id, output_index::text AS output_index,
                spent_tx_id
         FROM boxes
         WHERE ${where}
         ORDER BY creation_height DESC NULLS LAST, box_id DESC
         LIMIT $2 OFFSET $3`,
    cursor ? [address, cursor.height, cursor.id, take + 1] : [address, take + 1, skip],
    8000
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const assets = await assetsForBoxes(page.map((r) => r.box_id));
  const items: IdxBoxAll[] = page.map((r) => {
    const creationHeight =
      r.creation_height != null ? Number(r.creation_height) : null;
    return {
      boxId: r.box_id,
      value: r.value_nano || "0",
      creationHeight: Number.isFinite(creationHeight as number) ? creationHeight : null,
      address: r.address,
      ergoTree: r.ergo_tree,
      creationTxId: r.creation_tx_id,
      index: r.output_index != null ? Number(r.output_index) : null,
      assets: assets.get(r.box_id) ?? [],
      spentTxId: r.spent_tx_id,
    };
  });
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last ? encodeKeysetCursor(last.creationHeight, last.boxId) : null,
  };
}

async function addressBoxesCursorPacked(
  address: string,
  cursor: KeysetCursor | null,
  take: number,
  skip: number
): Promise<{ items: IdxBoxAll[]; hasMore: boolean; nextCursor: string | null } | null> {
  const usable = cursor && isHex64(cursor.id) ? cursor : null;
  const keyset = usable
    ? `AND (
         b.creation_height < $2
         OR (b.creation_height = $2 AND b.box_id < decode($3, 'hex'))
       )`
    : "";
  const rows = await qSlow<{
    box_id: string;
    value_nano: string;
    creation_height: string | null;
    address: string | null;
    ergo_tree: string | null;
    creation_tx_id: string | null;
    output_index: string | null;
    spent_tx_id: string | null;
  }>(
    `SELECT encode(p.box_id, 'hex') AS box_id,
            p.value_nano::text AS value_nano,
            p.creation_height::text AS creation_height,
            ad.address,
            sc.ergo_tree,
            encode(p.creation_tx_id, 'hex') AS creation_tx_id,
            p.output_index::text AS output_index,
            encode(p.spent_tx_id, 'hex') AS spent_tx_id
       FROM (
         SELECT b.box_id, b.value_nano, b.creation_height, b.creation_tx_id,
                b.output_index, b.addr_id, b.script_id, b.spent_tx_id
           FROM packed.boxes b
          WHERE b.addr_id = (
            SELECT id FROM packed.addr
             WHERE addr_md5 = md5($1) AND address = $1
             LIMIT 1
          )
            AND b.creation_height IS NOT NULL
            ${keyset}
          ORDER BY b.creation_height DESC, b.box_id DESC
          LIMIT ${usable ? "$4" : "$2"} OFFSET ${usable ? "0" : "$3"}
       ) p
       LEFT JOIN packed.addr ad ON ad.id = p.addr_id
       LEFT JOIN packed.script sc ON sc.id = p.script_id`,
    usable
      ? [address, usable.height, usable.id.toLowerCase(), take + 1]
      : [address, take + 1, skip]
  );
  if (!rows) return null;
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const assets = await assetsForBoxes(page.map((r) => r.box_id));
  const items: IdxBoxAll[] = page.map((r) => {
    const creationHeight = r.creation_height != null ? Number(r.creation_height) : null;
    return {
      boxId: r.box_id,
      value: r.value_nano || "0",
      creationHeight: Number.isFinite(creationHeight as number) ? creationHeight : null,
      address: r.address,
      ergoTree: r.ergo_tree,
      creationTxId: r.creation_tx_id,
      index: r.output_index != null ? Number(r.output_index) : null,
      assets: assets.get(r.box_id) ?? [],
      spentTxId: r.spent_tx_id,
    };
  });
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: last ? encodeKeysetCursor(last.creationHeight, last.boxId) : null,
  };
}
