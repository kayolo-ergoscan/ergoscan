/**
 * Server-only reads of gateway list snapshots for SSR.
 * Browser islands still use getGateway() after paint.
 */
import {
  parseRentTape,
  parseRentEpochBoxes,
  parseRentEpochNano,
  type AddrFlowKind,
  type RentTapeRow,
} from "@ergoscan/shared";
import { getGateway } from "./config";
import type { DefiVolPoint } from "./defi-volume";
import { sortDefiPools, type DefiPool, type PoolBoardRow } from "./defi-pools";
import { paintTxSnapshot } from "./tx-shape-paint";
import { CHAIN_MAX_SUPPLY, type ChainStats, type ChainStats24h, type PoolShare } from "./chain-stats";
import { toBigIntAmt } from "./format";
import type { RentMinersPack } from "./rent-miner-pools";
import { LIST_ENTITY_IDS, type ListEntityId } from "./address-pips";
import { HOLDER_BAND_IDS, type HolderBandId } from "./holder-bands";
import { parseRentDanger, type RentDangerRow } from "./rent-danger";

export type { RentDangerRow };

export type BlockListItem = {
  id: string;
  height: number;
  timestamp: number;
  txCount: number | null;
  size: number;
  parentId?: string | null;
  minerAddress?: string | null;
  minerName?: string | null;
  feeNano?: string | number | null;
  valueNano?: string | number | null;
  /** Output sum minus coinbase. Additive. */
  userValueNano?: string | number | null;
  /** True when this block was mined with Lithos. Additive. */
  lithos?: boolean;
};

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
  action?: string | null;
  inputs: number;
  outputs: number;
  value: number | null;
  confirmed: boolean;
  /** Distinct tokens on boxes created or spent by this tx. Additive. */
  tokenCount?: number | null;
};

export const BLOCK_TX_PACK = 25;

export type BlockHeaderFields = {
  version: number | null;
  nBits: string | null;
  votes: number[];
  difficulty: string | null;
  stateRoot: string;
  adProofsRoot: string;
  transactionsRoot: string;
  extensionHash: string;
  powPk: string | null;
  powW: string | null;
  powN: string | null;
  powD: string | null;
};

function asHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s || !/^[0-9a-f]+$/.test(s) || s.length % 2 !== 0) return null;
  return s;
}

function asDigits(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^-?\d+$/.test(s) ? s : null;
}

function asVotes(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 255) return [];
    out.push(n);
  }
  return out;
}

export function parseBlockHeader(raw: unknown): BlockHeaderFields | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stateRoot = asHex(r.stateRoot);
  if (!stateRoot) return null;
  const version = r.version == null || r.version === "" ? null : Number(r.version);
  return {
    version: version != null && Number.isInteger(version) ? version : null,
    nBits: asDigits(r.nBits),
    votes: asVotes(r.votes),
    difficulty: asDigits(r.difficulty),
    stateRoot,
    adProofsRoot: asHex(r.adProofsRoot) ?? "",
    transactionsRoot: asHex(r.transactionsRoot) ?? "",
    extensionHash: asHex(r.extensionHash) ?? "",
    powPk: asHex(r.powPk),
    powW: asHex(r.powW),
    powN: asHex(r.powN),
    powD: asDigits(r.powD),
  };
}

export type BlockCard = {
  id: string;
  height: number;
  timestamp: number;
  size: number;
  parentId: string | null;
  nextId: string | null;
  txCount: number;
  minerAddress: string | null;
  minerName: string | null;
  feeNano: string;
  valueNano: string;
  userValueNano?: string;
  /** True when this block was mined with Lithos. */
  lithos?: boolean;
  prevTimestamp: number | null;
  tipHeight: number | null;
  payingTxCount: number | null;
  /** Signing header. Missing until the indexer has filled this height. */
  header?: BlockHeaderFields | null;
  transactions: string[];
  txs: TxListItem[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  updatedAt: string | null;
};

export type HomePageSnapshot = {
  height: number | null;
  blocks: BlockListItem[];
  txs: TxListItem[];
  mempoolCount: number | null;
  updatedAt: string | null;
  /** Additive `/v1/page/home` fields from indexer snapshot. */
  hashRate?: number | null;
  circulating?: number | null;
  txPerDay?: number | null;
  /** Additive: confirmed txs in the indexed window. */
  txTotal?: number | null;
  avgBlockMs?: number | null;
  maxSupply?: number | null;
  protocol?: number | null;
  pools?: PoolShare[];
  stats24h?: Partial<ChainStats24h>;
  /** Additive hourly H/s from indexer `blocks.difficulty`. */
  hashRateSeries?: { t: number; v: number }[];
  /** Additive rolling 24h tx count from indexer `blocks.tx_count`. */
  txPerDaySeries?: { t: number; v: number }[];
  /** Additive hourly tx count + fees (ERG) from indexer tables. */
  txActivity?: { t: number; txs: number; feesErg: number; feesKnown?: boolean }[];
  holderCount?: number | null;
  /** Additive: protocol + pool + contract with nanoERG > 0, from the home snapshot. */
  scriptCount?: number | null;
  /** Additive: new P2PK holders in the last ~30 days. */
  holdersMonth?: number | null;
  minerCount?: number | null;
  /** Additive: unspent ERG/USD oracle box, written by the indexer. */
  ergUsd?: number | null;
  ergUsdSource?: string | null;
  /** Additive: hourly oracle ERG/USD. */
  priceSeries?: { t: number; v: number }[];
  /** Additive: CoinGecko extras from the home snapshot. */
  rank?: number | null;
  volume24h?: number | null;
  change24h?: number | null;
  /** Additive: oldest addresses due this week from snapshot_kv.rent. */
  rentTape?: RentTapeRow[] | null;
  /** Additive: unspent boxes due before this header epoch ends. */
  rentEpochBoxes?: number | null;
  /** Additive: estimated rent nano due before this header epoch ends. */
  rentEpochNano?: string | null;
  /** Additive: tokens short on ERG in the next 7 days, from snapshot_kv.rent. */
  rentDanger?: RentDangerRow[] | null;
};

export type TokenHeat = {
  tokenId: string;
  symbol: string;
  name?: string;
  volumeErg: number;
  tvlErg: number;
  volumeUsd?: number;
  tvlUsd?: number;
  priceUsd?: number;
  change24h?: number;
};

export type DefiRanks = {
  universe?: TokenHeat[];
  traded?: TokenHeat[];
  flow?: TokenHeat[];
  depth?: TokenHeat[];
  tokenCount?: number;
  poolCount?: number;
  heatCount?: number;
  ergUsd?: number;
  stale?: boolean;
  ranksAgeMs?: number;
  pulse?: {
    volUsd?: number;
    hotCount?: number;
    leader?: TokenHeat | null;
    headline?: string;
  };
};

export type DefiTrade = {
  txId: string;
  side: string;
  tokenId?: string | null;
  tokenSymbol?: string;
  baseId?: string | null;
  baseSymbol?: string;
  tokenAmount: number;
  baseAmount: number;
  price: number | null;
  trader?: string;
  time: number;
  label?: string;
  venue?: string | null;
  poolId?: string | null;
};

export type DefiHealth = {
  ok?: boolean;
  tradesCount?: number | null;
  trades24h?: number | null;
  ranksAgeMs?: number | null;
  workerLag?: number | null;
  scanHeight?: number | null;
  scanHeightN2t?: number | null;
  scanHeightT2t?: number | null;
  indexerHeight?: number | null;
  stale?: boolean;
  source?: string | null;
};

export const DEFI_PACK = 25;

export const ROSEN_PACK = 25;

export type RosenEventStatus = "processing" | "completed" | "fraud";

export type RosenEventItem = {
  id: string;
  eventId: string;
  triggerBoxId?: string | null;
  triggerTxId?: string | null;
  height: number | null;
  time: number | null;
  fromChain: string;
  toChain: string;
  fromChainLabel: string;
  toChainLabel: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  amountDisplay: string;
  bridgeFee: string;
  networkFee: string;
  bridgeFeeDisplay?: string | null;
  networkFeeDisplay?: string | null;
  sourceChainTokenId: string;
  targetChainTokenId: string;
  sourceTxId: string;
  spendTxId?: string | null;
  paymentTxId?: string | null;
  status: RosenEventStatus | string;
  tokenName?: string | null;
  tokenDecimals?: number | null;
  ergoSideTokenId?: string | null;
  widsCount?: number | null;
  watcherChain?: string | null;
};

export type RosenHealth = {
  ok?: boolean;
  ready?: boolean;
  source?: string;
  eventsTotal?: number;
  events24h?: number;
  completed?: number;
  processing?: number;
  fraud?: number;
  routes?: number;
  scanHeight?: number | null;
  tipHeight?: number | null;
  updatedAtMs?: number | null;
};

export function parseRosenItems(raw: unknown): RosenEventItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RosenEventItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<RosenEventItem>;
    const id = String(r.id || r.eventId || "").trim();
    if (!id) continue;
    out.push({
      id,
      eventId: String(r.eventId || id),
      triggerBoxId: r.triggerBoxId ?? null,
      triggerTxId: r.triggerTxId ?? null,
      height: finiteNum(r.height),
      time: finiteNum(r.time),
      fromChain: String(r.fromChain || ""),
      toChain: String(r.toChain || ""),
      fromChainLabel: String(r.fromChainLabel || r.fromChain || ""),
      toChainLabel: String(r.toChainLabel || r.toChain || ""),
      fromAddress: String(r.fromAddress || ""),
      toAddress: String(r.toAddress || ""),
      amount: String(r.amount ?? "0"),
      amountDisplay: String(r.amountDisplay || r.amount || "0"),
      bridgeFee: String(r.bridgeFee ?? "0"),
      networkFee: String(r.networkFee ?? "0"),
      bridgeFeeDisplay: r.bridgeFeeDisplay ? String(r.bridgeFeeDisplay) : null,
      networkFeeDisplay: r.networkFeeDisplay ? String(r.networkFeeDisplay) : null,
      sourceChainTokenId: String(r.sourceChainTokenId || ""),
      targetChainTokenId: String(r.targetChainTokenId || ""),
      sourceTxId: String(r.sourceTxId || ""),
      spendTxId: r.spendTxId ?? null,
      paymentTxId: r.paymentTxId ?? null,
      status: String(r.status || "processing"),
      tokenName: r.tokenName ?? null,
      tokenDecimals: finiteNum(r.tokenDecimals),
      ergoSideTokenId: r.ergoSideTokenId ?? null,
      widsCount: finiteNum(r.widsCount),
      watcherChain: r.watcherChain ?? null,
    });
  }
  return out;
}

export async function fetchRosenTape(opts?: {
  status?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{
  items: RosenEventItem[];
  nextCursor: string | null;
  hasMore: boolean;
  ready: boolean;
  health: RosenHealth | null;
}> {
  const limit = Math.min(50, Math.max(1, opts?.limit ?? ROSEN_PACK));
  const qs = new URLSearchParams({ limit: String(limit) });
  const status = (opts?.status ?? "").trim();
  if (status) qs.set("status", status);
  if (opts?.cursor) qs.set("cursor", opts.cursor);
  const [eventsJ, health] = await Promise.all([
    gwJson<{
      items?: unknown;
      nextCursor?: string | null;
      hasMore?: boolean;
      ready?: boolean;
    }>(`/v1/rosen/events?${qs}`),
    gwJson<RosenHealth>("/v1/rosen/health"),
  ]);
  const items = parseRosenItems(eventsJ?.items);
  return {
    items,
    nextCursor: eventsJ?.nextCursor ?? null,
    hasMore: Boolean(eventsJ?.hasMore),
    ready: eventsJ != null && eventsJ.ready !== false,
    health,
  };
}

export async function fetchDefiTape(opts?: {
  tokenId?: string;
  cursor?: string | null;
  limit?: number;
  venue?: string | null;
}): Promise<{
  trades: DefiTrade[];
  nextCursor: string | null;
}> {
  const limit = Math.min(50, Math.max(1, opts?.limit ?? DEFI_PACK));
  const qs = new URLSearchParams({ limit: String(limit) });
  const tokenId = (opts?.tokenId ?? "").trim();
  if (tokenId) qs.set("tokenId", tokenId);
  if (opts?.cursor) qs.set("cursor", opts.cursor);
  const venue = (opts?.venue ?? "").trim();
  if (venue) qs.set("venue", venue);
  const tradesJ = await gwJson<{ trades?: DefiTrade[]; nextCursor?: string | null }>(
    `/v1/defi/trades?${qs}`
  );
  return {
    trades: Array.isArray(tradesJ?.trades) ? tradesJ.trades : [],
    nextCursor: tradesJ?.nextCursor ?? null,
  };
}

export async function fetchDefiVolume(opts?: {
  days?: number;
  tokenId?: string;
  venue?: string | null;
}): Promise<DefiVolPoint[]> {
  const days = opts?.days ?? 7;
  const qs = new URLSearchParams({ days: String(days) });
  const tokenId = (opts?.tokenId ?? "").trim();
  if (tokenId) qs.set("tokenId", tokenId);
  const venue = (opts?.venue ?? "").trim();
  if (venue) qs.set("venue", venue);
  const j = await gwJson<{ points?: DefiVolPoint[] }>(`/v1/defi/volume-history?${qs}`);
  return Array.isArray(j?.points) ? j.points : [];
}

export type { DefiPool };

export async function fetchDefiPools(opts?: { venue?: string | null }): Promise<DefiPool[]> {
  const venue = (opts?.venue ?? "").trim();
  const path = venue ? `/v1/defi/pools?venue=${encodeURIComponent(venue)}` : "/v1/defi/pools";
  const j = await gwJson<{ pools?: DefiPool[] }>(path);
  if (j && Array.isArray(j.pools)) return sortDefiPools(j.pools);
  return [];
}

export type AgeUsdEvent = {
  txId: string;
  height: number | null;
  time: number | null;
  side: string;
  tokenId: string;
  tokenAmount: number;
  baseAmount: number;
  trader: string | null;
  baseId?: string | null;
};

export type AgeUsdTrader = {
  trader: string;
  erg: number;
  deals: number;
};

export type AgeUsdBank = {
  ok?: boolean;
  protocol?: string;
  bankAddress?: string;
  nft?: string;
  sigUsdToken?: string;
  sigRsvToken?: string;
  boxId?: string | null;
  height?: number | null;
  reserveNano?: string | null;
  sigUsdInBank?: number | null;
  sigRsvInBank?: number | null;
  ergUsd?: number | null;
  reserveRatio?: number | null;
  band?: "below" | "in" | "above" | null;
  circUsd?: number | null;
  circRsv?: number | null;
  mintUsd?: boolean;
  redeemUsd?: boolean;
  mintRsv?: boolean;
  redeemRsv?: boolean;
  sigUsdUsd?: number | null;
  sigUsdErg?: number | null;
  sigRsvUsd?: number | null;
  sigRsvErg?: number | null;
  eventsCount?: number | null;
  tradersCount?: number | null;
  eventsOffset?: number;
  tradersOffset?: number;
  events?: AgeUsdEvent[];
  topTraders?: AgeUsdTrader[];
};

export async function fetchAgeUsdBank(): Promise<AgeUsdBank | null> {
  return gwJson<AgeUsdBank>("/v1/defi/ageusd");
}

export type BasisCollateral = {
  tokenId: string;
  amount: string;
  decimals: number;
  name: string | null;
};

export type BasisReserve = {
  boxId: string;
  kind: "erg" | "token";
  nano: string;
  height: number | null;
  /** Block time in ms. Null when the header is not in the index yet. */
  createdAt?: number | null;
  owner: string | null;
  /** Address that funded the creation transaction. Not the key inside the safe. */
  creator?: string | null;
  /** This lockbox priced in nanoERG. Token rows are null when no pool price exists. */
  ergValueNano?: string | null;
  trackerNft: string | null;
  trackerBoxId: string | null;
  trackerHeight: number | null;
  refundHeight: string | null;
  status: "open" | "quiet" | "refund" | "refundReady" | "noTracker";
  blocksLeft: string | null;
  collateral: BasisCollateral | null;
};

export type BasisSnap = {
  ok?: boolean;
  protocol?: string;
  tipHeight?: number | null;
  reserveCount?: number;
  ergLockedNano?: string;
  /** ERG safes plus token collateral that has an ERG pool price. */
  totalErgNano?: string;
  unpricedCount?: number;
  tokenReserveCount?: number;
  trackerCount?: number;
  reserves?: BasisReserve[];
};

export async function fetchBasis(): Promise<BasisSnap | null> {
  return gwJson<BasisSnap>("/v1/defi/basis");
}

export type LithosDexSnap = {
  ok?: boolean;
  protocol?: string;
  venue?: string;
  tvlErg?: number | null;
  volErg?: number | null;
  tradesCount?: number | null;
  tradersCount?: number | null;
  eventsOffset?: number;
  tradersOffset?: number;
  events?: AgeUsdEvent[];
  topTraders?: AgeUsdTrader[];
  pools?: DefiPool[];
};

export type SpectrumTapeRow = {
  tokenId: string;
  symbol: string;
  priceUsd: number;
  changePct?: number | null;
};

export type SpectrumDexSnap = LithosDexSnap & {
  minTvlErg?: number | null;
  eventsCount?: number | null;
  listedBy?: "tvl" | "fills" | null;
  tape?: SpectrumTapeRow[] | null;
};

export async function fetchLithosDex(opts?: {
  eventsOffset?: number;
  tradersOffset?: number;
  eventsSort?: string;
  eventsDir?: string;
  tokenId?: string;
  limit?: number;
}): Promise<LithosDexSnap | null> {
  const qs = new URLSearchParams({
    limit: String(Math.min(25, Math.max(1, opts?.limit ?? 25))),
    eventsOffset: String(opts?.eventsOffset ?? 0),
    tradersOffset: String(opts?.tradersOffset ?? 0),
    eventsSort: opts?.eventsSort ?? "time",
    eventsDir: opts?.eventsDir ?? "desc",
  });
  const tokenId = (opts?.tokenId ?? "").trim();
  if (tokenId) qs.set("tokenId", tokenId);
  return gwJson<LithosDexSnap>(`/v1/defi/lithos?${qs}`);
}

export async function fetchSpectrumDex(opts?: {
  eventsOffset?: number;
  tradersOffset?: number;
  eventsSort?: string;
  eventsDir?: string;
  tokenId?: string;
  limit?: number;
}): Promise<SpectrumDexSnap | null> {
  const qs = new URLSearchParams({
    limit: String(Math.min(25, Math.max(1, opts?.limit ?? 25))),
    eventsOffset: String(opts?.eventsOffset ?? 0),
    tradersOffset: String(opts?.tradersOffset ?? 0),
    eventsSort: opts?.eventsSort ?? "time",
    eventsDir: opts?.eventsDir ?? "desc",
  });
  const tokenId = (opts?.tokenId ?? "").trim();
  if (tokenId) qs.set("tokenId", tokenId);
  return gwJson<SpectrumDexSnap>(`/v1/defi/spectrum?${qs}`);
}

export type PoolBoardSnap = {
  ok?: boolean;
  rolled?: boolean;
  minTvlErg?: number | null;
  tvlErg?: number | null;
  volErg?: number | null;
  tradesCount?: number | null;
  tradersCount?: number | null;
  pools?: PoolBoardRow[];
};

export async function fetchPoolBoard(): Promise<PoolBoardSnap | null> {
  return gwJson<PoolBoardSnap>("/v1/defi/pool-board");
}

async function gwJson<T>(path: string): Promise<T | null> {
  const gw = getGateway();
  try {
    const r = await fetch(`${gw}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function finiteNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseSparkSeries(raw: unknown): { t: number; v: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { t: number; v: number }[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const t = finiteNum((p as { t?: unknown }).t);
    const v = finiteNum((p as { v?: unknown }).v);
    if (t == null || v == null || v <= 0) continue;
    out.push({ t, v });
  }
  return out;
}

function parseTxActivity(raw: unknown): { t: number; txs: number; feesErg: number; feesKnown?: boolean }[] {
  if (!Array.isArray(raw)) return [];
  const out: { t: number; txs: number; feesErg: number; feesKnown?: boolean }[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const r = p as { t?: unknown; txs?: unknown; feesErg?: unknown; feesKnown?: unknown };
    const t = finiteNum(r.t);
    const txs = finiteNum(r.txs);
    const feesErg = finiteNum(r.feesErg);
    if (t == null || txs == null || txs < 0 || feesErg == null || feesErg < 0) continue;
    out.push({ t, txs, feesErg, feesKnown: r.feesKnown !== false });
  }
  return out;
}

/** Circulating for KPI: ERG units. Nano strings go through bigint, never Number(nano). */
function circulatingErg(v: unknown): number | null {
  if (typeof v === "string") {
    const nano = toBigIntAmt(v);
    if (nano <= 0n) return null;
    const erg = nano / 1_000_000_000n;
    if (erg > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(erg);
  }
  const n = finiteNum(v);
  if (n == null || n <= 0) return null;
  return n;
}

function parsePools(raw: unknown): PoolShare[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const pools: PoolShare[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; blocks?: unknown; share?: unknown; address?: unknown };
    const blocks = finiteNum(r.blocks);
    if (blocks == null || blocks <= 0) continue;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "—";
    const share = finiteNum(r.share);
    const address =
      typeof r.address === "string" && r.address.trim() ? r.address.trim() : undefined;
    pools.push({
      name,
      blocks,
      share: share != null && share >= 0 ? share : 0,
      ...(address ? { address } : {}),
    });
  }
  if (!pools.length) return undefined;
  const total = pools.reduce((s, p) => s + p.blocks, 0);
  if (pools.every((p) => p.share === 0) && total > 0) {
    return pools.map((p) => ({ ...p, share: p.blocks / total }));
  }
  return pools;
}

function parseStats24h(raw: unknown): Partial<ChainStats24h> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<ChainStats24h> = {};
  const keys: (keyof ChainStats24h)[] = [
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
    const n = finiteNum(r[k]);
    if (n != null) {
      out[k] = n;
      any = true;
    }
  }
  return any ? out : undefined;
}

export async function fetchHomeSnapshot(): Promise<HomePageSnapshot> {
  const j = await gwJson<{
    height?: number | null;
    blocks?: BlockListItem[];
    txs?: TxListItem[];
    mempool?: { count?: number };
    updatedAt?: string | null;
    stale?: boolean;
    hashRate?: unknown;
    circulating?: unknown;
    txPerDay?: unknown;
    txTotal?: unknown;
    avgBlockMs?: unknown;
    maxSupply?: unknown;
    protocol?: unknown;
    pools?: unknown;
    stats24h?: unknown;
    hashRateSeries?: unknown;
    txPerDaySeries?: unknown;
    txActivity?: unknown;
    holderCount?: unknown;
    scriptCount?: unknown;
    holdersMonth?: unknown;
    minerCount?: unknown;
    ergUsd?: unknown;
    ergUsdSource?: unknown;
    priceSeries?: unknown;
    rank?: unknown;
    volume24h?: unknown;
    change24h?: unknown;
    rentTape?: unknown;
    rentEpochBoxes?: unknown;
    rentEpochNano?: unknown;
    rentDanger?: unknown;
  }>("/v1/page/home");
  if (!j || j.stale) {
    return { height: null, blocks: [], txs: [], mempoolCount: null, updatedAt: null };
  }
  const mempoolCount = finiteNum(j.mempool?.count);
  return {
    height: finiteNum(j.height),
    blocks: Array.isArray(j.blocks) ? j.blocks : [],
    txs: Array.isArray(j.txs) ? j.txs : [],
    mempoolCount,
    updatedAt: j.updatedAt ?? null,
    hashRate: finiteNum(j.hashRate),
    circulating: circulatingErg(j.circulating),
    txPerDay: finiteNum(j.txPerDay),
    txTotal: finiteNum(j.txTotal),
    avgBlockMs: finiteNum(j.avgBlockMs),
    maxSupply: finiteNum(j.maxSupply),
    protocol: finiteNum(j.protocol),
    pools: parsePools(j.pools),
    stats24h: parseStats24h(j.stats24h),
    hashRateSeries: parseSparkSeries(j.hashRateSeries),
    txPerDaySeries: parseSparkSeries(j.txPerDaySeries),
    txActivity: parseTxActivity(j.txActivity),
    holderCount: finiteNum(j.holderCount),
    scriptCount: (() => {
      const n = finiteNum(j.scriptCount);
      return n != null && n >= 0 ? Math.round(n) : null;
    })(),
    holdersMonth: finiteNum(j.holdersMonth),
    minerCount: finiteNum(j.minerCount),
    ergUsd: finiteNum(j.ergUsd),
    ergUsdSource: typeof j.ergUsdSource === "string" ? j.ergUsdSource : null,
    priceSeries: parseSparkSeries(j.priceSeries),
    rank: (() => {
      const r = finiteNum(j.rank);
      return r != null && r >= 1 ? Math.round(r) : null;
    })(),
    volume24h: (() => {
      const v = finiteNum(j.volume24h);
      return v != null && v > 0 ? v : null;
    })(),
    change24h: finiteNum(j.change24h),
    rentTape: parseRentTape(j.rentTape),
    rentEpochBoxes: parseRentEpochBoxes(j.rentEpochBoxes),
    rentEpochNano: parseRentEpochNano(j.rentEpochNano),
    rentDanger: parseRentDanger(j.rentDanger),
  };
}

/** Home KPI from `/v1/page/home` only — no explorer. */
export function homeToChainStats(home: HomePageSnapshot): ChainStats {
  const pools = home.pools ?? [];
  const s24 = home.stats24h ?? {};
  return {
    ok: home.hashRate != null || home.txPerDay != null || home.height != null || home.circulating != null,
    source: "page-home",
    maxSupply: home.maxSupply && home.maxSupply > 0 ? home.maxSupply : CHAIN_MAX_SUPPLY,
    hashRate: home.hashRate ?? null,
    circulating: home.circulating ?? null,
    txPerDay: home.txPerDay ?? null,
    txTotal: home.txTotal ?? null,
    protocol: home.protocol ?? null,
    height: home.height,
    mempool: home.mempoolCount,
    stats24h: {
      blocks: s24.blocks ?? null,
      avgBlockMs: home.avgBlockMs ?? s24.avgBlockMs ?? null,
      coinsMined: s24.coinsMined ?? null,
      txs: s24.txs ?? home.txPerDay ?? null,
      feesErg: s24.feesErg ?? null,
      outputErg: s24.outputErg ?? null,
      minerRevenueErg: s24.minerRevenueErg ?? null,
      feeSharePct: s24.feeSharePct ?? null,
    },
    pools,
    poolBlocks: pools.reduce((s, p) => s + p.blocks, 0),
    holderCount: home.holderCount ?? null,
    scriptCount: home.scriptCount ?? null,
    holdersMonth: home.holdersMonth ?? null,
    minerCount: home.minerCount ?? null,
    lastBlockSize: home.blocks[0]?.size ?? null,
    at: Date.now(),
  };
}

export const BLOCK_PACK = 25;
/** Snapshot width for `/block/:id` neighbor prefetch — not the `/blocks` tape ceiling. */
export const BLOCK_WINDOW = 50;

export type BlocksPack = {
  items: BlockListItem[];
  updatedAt: string | null;
  hasMore: boolean;
  nextCursor: string | null;
  /** Block just older than this page, already on the pack. */
  olderTs: number | null;
};

export function isBlocksPackBody(
  j: unknown
): j is {
  items: BlockListItem[];
  hasMore?: boolean;
  nextCursor?: string | null;
  olderTs?: unknown;
  updatedAt?: string | null;
  stale?: boolean;
} {
  return !!j && typeof j === "object" && !Array.isArray(j) && Array.isArray((j as { items?: unknown }).items);
}

/** SSR + pager: first pack from snapshot, then ?cursor= on the table. */
export async function fetchBlocksPack(cursor?: string | null): Promise<BlocksPack> {
  const q = new URLSearchParams({ limit: String(BLOCK_PACK) });
  if (cursor) q.set("cursor", cursor);
  else q.set("offset", "0");
  const packed = await gwJson<unknown>(`/v1/blocks?${q}`);
  if (isBlocksPackBody(packed) && !packed.stale) {
    const last = packed.items[packed.items.length - 1];
    const hasMore =
      typeof packed.hasMore === "boolean" ? packed.hasMore : packed.items.length >= BLOCK_PACK;
    const nextCursor =
      typeof packed.nextCursor === "string" && packed.nextCursor.length
        ? packed.nextCursor
        : hasMore && last
          ? String(last.height)
          : null;
    return {
      items: packed.items,
      updatedAt: packed.updatedAt ?? null,
      hasMore,
      nextCursor: hasMore ? nextCursor : null,
      olderTs: finiteNum(packed.olderTs),
    };
  }
  return { items: [], updatedAt: null, hasMore: false, nextCursor: null, olderTs: null };
}

export async function fetchBlocksList(): Promise<BlockListItem[]> {
  const j = await gwJson<unknown>(`/v1/blocks?limit=${BLOCK_WINDOW}`);
  if (!j) return [];
  if (isBlocksPackBody(j)) return j.stale ? [] : j.items;
  if (Array.isArray(j)) return j as BlockListItem[];
  if (typeof j === "object" && (j as { stale?: boolean }).stale) return [];
  return (j as { blocks?: BlockListItem[] }).blocks ?? [];
}

function ioCount(raw: unknown, named: unknown): number {
  const n = finiteNum(raw);
  if (n != null) return n;
  const namedN = finiteNum(named);
  if (namedN != null) return namedN;
  return Array.isArray(raw) ? raw.length : 0;
}

function tokenCountOf(r: Record<string, unknown>): number | null {
  const n = finiteNum(r.tokenCount);
  if (n != null) return n;
  return Array.isArray(r.tokenMeta) ? r.tokenMeta.length : null;
}

function asTxListItem(row: unknown, i: number): TxListItem | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const feeN = finiteNum(r.fee) ?? 0;
  const sizeN = finiteNum(r.size) ?? 0;
  return {
    id: r.id,
    index: finiteNum(r.index) ?? finiteNum(r.indexInBlock) ?? i,
    inclusionHeight: finiteNum(r.inclusionHeight),
    timestamp: finiteNum(r.timestamp),
    size: sizeN,
    fee: feeN,
    feeRate: finiteNum(r.feeRate) ?? (sizeN > 0 ? feeN / sizeN : 0),
    category: typeof r.category === "string" && r.category.length ? r.category : "unknown",
    color: typeof r.color === "string" && r.color.length ? r.color : "#64748B",
    platform: typeof r.platform === "string" && r.platform.length ? r.platform : null,
    action: typeof r.action === "string" && r.action.length ? r.action : null,
    inputs: ioCount(r.inputs, r.inputCount),
    outputs: ioCount(r.outputs, r.outputCount),
    value:
      r.value == null && r.valueNano == null
        ? null
        : finiteNum(r.value) ?? finiteNum(r.valueNano) ?? 0,
    confirmed: r.confirmed !== false,
    tokenCount: tokenCountOf(r),
  };
}

export function parseTxListItems(rows: unknown[] | undefined): TxListItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(asTxListItem).filter((x): x is TxListItem => x != null);
}

export function parseBlockCard(raw: unknown): BlockCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const height = finiteNum(r.height);
  if (height == null) return null;
  const txs = Array.isArray(r.txs)
    ? r.txs.map(asTxListItem).filter((x): x is TxListItem => x != null)
    : [];
  const pag =
    r.pagination && typeof r.pagination === "object"
      ? (r.pagination as Record<string, unknown>)
      : null;
  const total = finiteNum(pag?.total) ?? finiteNum(r.txCount) ?? txs.length;
  const offset = finiteNum(pag?.offset) ?? 0;
  const limit = finiteNum(pag?.limit) ?? txs.length;
  const minerAddress =
    typeof r.minerAddress === "string" && r.minerAddress.length ? r.minerAddress : null;
  return {
    id: r.id,
    height,
    timestamp: finiteNum(r.timestamp) ?? 0,
    size: finiteNum(r.size) ?? 0,
    parentId: typeof r.parentId === "string" && r.parentId.length ? r.parentId : null,
    nextId: typeof r.nextId === "string" && r.nextId.length ? r.nextId : null,
    txCount: finiteNum(r.txCount) ?? total,
    minerAddress,
    minerName: typeof r.minerName === "string" && r.minerName.length ? r.minerName : null,
    feeNano: r.feeNano != null ? String(r.feeNano) : "0",
    valueNano: r.valueNano != null ? String(r.valueNano) : "0",
    userValueNano: r.userValueNano != null ? String(r.userValueNano) : undefined,
    lithos: r.lithos === true,
    prevTimestamp: finiteNum(r.prevTimestamp),
    tipHeight: finiteNum(r.tipHeight),
    payingTxCount: finiteNum(r.payingTxCount),
    header: parseBlockHeader(r.header),
    transactions: Array.isArray(r.transactions)
      ? r.transactions.filter((x): x is string => typeof x === "string")
      : txs.map((t) => t.id),
    txs,
    pagination: {
      offset,
      limit,
      total,
      hasMore: typeof pag?.hasMore === "boolean" ? pag.hasMore : offset + txs.length < total,
    },
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

export async function fetchBlockCard(
  id: string,
  offset = 0,
  limit = BLOCK_TX_PACK
): Promise<BlockCard | null> {
  const q = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  const j = await gwJson<unknown>(`/v1/blocks/${encodeURIComponent(id)}?${q}`);
  return parseBlockCard(j);
}

export const TX_PACK = 25;

export async function fetchRecentTxs(cursor?: string | null): Promise<{
  items: TxListItem[];
  updatedAt: string | null;
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const q = new URLSearchParams({
    limit: String(TX_PACK),
    mempool: "0",
  });
  if (cursor) q.set("cursor", cursor);
  else q.set("offset", "0");
  const j = await gwJson<{
    items?: TxListItem[];
    stale?: boolean;
    updatedAt?: string | null;
    hasMore?: boolean;
    nextCursor?: string | null;
  }>(`/v1/transactions/recent?${q}`);
  if (!j || j.stale || !Array.isArray(j.items)) {
    return { items: [], updatedAt: null, hasMore: false, nextCursor: null };
  }
  const items = parseTxListItems(j.items);
  const last = items[items.length - 1];
  const hasMore = typeof j.hasMore === "boolean" ? j.hasMore : items.length >= TX_PACK;
  const nextCursor =
    typeof j.nextCursor === "string" && j.nextCursor.length
      ? j.nextCursor
      : hasMore && last
        ? `${last.inclusionHeight ?? -1}:${last.index ?? -1}:${last.id}`
        : null;
  return {
    items,
    updatedAt: j.updatedAt ?? null,
    hasMore,
    nextCursor: hasMore ? nextCursor : null,
  };
}

export type TxTokenMeta = {
  tokenId: string;
  name: string | null;
  decimals: number | null;
};

/** Confirmed or mempool tx item. Same `/v1/transactions/:id` body the island refetches. */
export type TxPageSnapshot = {
  id: string;
  confirmed: boolean;
  blockId?: string | null;
  inclusionHeight: number | null;
  numConfirmations: number | null;
  timestamp?: number | null;
  size: number;
  fee: number | string;
  category: string;
  shape?: string;
  protocol?: string | null;
  action?: string | null;
  /** rent | rent-renew when the rent writer has a protocol row. Null otherwise. */
  rent?: string | null;
  source?: string;
  inputs: unknown[];
  outputs: unknown[];
  dataInputs?: unknown[];
  /** Additive: locator hops, output-sum, token names from `tokens`. */
  indexInBlock?: number | null;
  gix?: number | null;
  prevId?: string | null;
  nextId?: string | null;
  valueNano?: string | number | null;
  inputCount?: number | null;
  outputCount?: number | null;
  /** False when box_assets could not be read for this response. */
  assetsComplete?: boolean;
  tokenMeta?: TxTokenMeta[];
  ball?: {
    feeRate: number;
    inputCount: number;
    outputCount: number;
    platform?: string;
    color?: string;
    category?: string;
  };
};

export async function fetchTransaction(id: string): Promise<TxPageSnapshot | null> {
  const txId = id?.trim();
  if (!txId) return null;
  const gw = getGateway();
  try {
    const r = await fetch(`${gw}/v1/transactions/${encodeURIComponent(txId)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as TxPageSnapshot;
    return j?.id ? paintTxSnapshot(j) : null;
  } catch {
    return null;
  }
}

export type BoxAsset = {
  tokenId: string;
  amount: number | string;
  name?: string | null;
  decimals?: number | null;
  emission?: number | null;
};

export type BoxRegisterTyped = {
  serializedValue: string;
  sigmaType: string;
  renderedValue: string;
};

export type BoxTreeConstant = {
  index: number;
  sigmaType: string;
  renderedValue: string;
  hex: string;
};

export type BoxSnapshot = {
  boxId: string;
  value: number | string;
  ergoTree: string;
  registers: Record<string, string | null>;
  registersTyped?: Record<string, BoxRegisterTyped>;
  assets?: BoxAsset[];
  creationHeight?: number | null;
  inclusionHeight?: number | null;
  settlementHeight?: number | null;
  blockId?: string | null;
  ergoTreeConstants?: string;
  ergoTreeScript?: string;
  ergoTreeTemplateHash?: string | null;
  treeConstants?: BoxTreeConstant[];
  spentHeight?: number | null;
  createdTs?: number | null;
  spentTs?: number | null;
  address?: string | null;
  transactionId?: string | null;
  spentTransactionId?: string | null;
  index?: number | null;
  gix?: number | null;
  source?: string;
  sizeBytes?: number;
  rentAsOf?: "spend" | "tip" | null;
  rent?: {
    creationHeight: number | null;
    currentHeight: number;
    ageBlocks: number | null;
    storagePeriodBlocks: number;
    blocksUntilRent: number | null;
    rentDue: boolean;
    periodsElapsed: number;
    sizeBytes: number | null;
    estimatedRentNano: number | null;
    minValueNano: number | null;
    boxValueNano: number | null;
    belowMinValue: boolean | null;
    ageYears: number | null;
    note: string;
  } | null;
};

export async function fetchBox(id: string): Promise<BoxSnapshot | null> {
  const boxId = id?.trim();
  if (!boxId) return null;
  const j = await gwJson<BoxSnapshot>(`/v1/boxes/${encodeURIComponent(boxId)}`);
  return j?.boxId ? j : null;
}

export async function fetchDefiRanks(): Promise<DefiRanks | null> {
  return gwJson<DefiRanks>("/v1/defi/ranks");
}

export async function fetchErgUsd(): Promise<number | null> {
  const m = await fetchErgMarket();
  return m?.usd ?? null;
}

export const MEMPOOL_PACK = 25;

export const TOKEN_PACK = 25;

export type TokenListSort = "last" | "first" | "holders" | "supply" | "txs" | "name";
export type TokenListDir = "asc" | "desc";

export type TokenListItem = {
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

export type TokensPageData = {
  items: TokenListItem[];
  total: number;
  offset: number;
  sort: TokenListSort;
  dir: TokenListDir;
  q: string;
  kpis: TokenCatalogKpis;
  updatedAt: string | null;
};

export async function fetchTokensCatalog(opts?: {
  offset?: number;
  sort?: TokenListSort;
  dir?: TokenListDir;
  q?: string;
}): Promise<TokensPageData> {
  const offset = Math.max(0, opts?.offset ?? 0);
  const sort = opts?.sort ?? "holders";
  const dir = opts?.dir ?? "desc";
  const q = (opts?.q ?? "").trim();
  const params = new URLSearchParams({
    limit: String(TOKEN_PACK),
    offset: String(offset),
    sort,
    dir,
  });
  if (q) params.set("q", q);
  const j = await gwJson<TokensPageData>(`/v1/tokens?${params}`);
  if (!j || !Array.isArray(j.items)) {
    return {
      items: [],
      total: 0,
      offset,
      sort,
      dir,
      q,
      kpis: {
        tokenCount: null,
        holderCount: null,
        txCount: null,
        namedCount: null,
        nftLike: null,
      },
      updatedAt: null,
    };
  }
  return {
    items: j.items,
    total: typeof j.total === "number" && Number.isFinite(j.total) ? j.total : j.items.length,
    offset: typeof j.offset === "number" ? j.offset : offset,
    sort: j.sort ?? sort,
    dir: j.dir ?? dir,
    q: j.q ?? q,
    kpis: j.kpis ?? {
      tokenCount: null,
      holderCount: null,
      txCount: null,
      namedCount: null,
      nftLike: null,
    },
    updatedAt: j.updatedAt ?? null,
  };
}

/** One catalog row by token id — snapshot path, not the node token card. */
export async function fetchTokenListItem(tokenId: string): Promise<TokenListItem | null> {
  const q = tokenId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(q)) return null;
  const params = new URLSearchParams({
    limit: "1",
    offset: "0",
    q,
    names: "0",
  });
  const j = await gwJson<TokensPageData>(`/v1/tokens?${params}`);
  const hit = (j?.items ?? []).find((row) => row.tokenId.toLowerCase() === q);
  return hit ?? null;
}

export type TokenHolderRow = {
  rank: number;
  address: string;
  amount: number | string;
  amountUi: number;
  boxes: number;
  sharePct: number | null;
  nanoerg?: string | null;
  txCount?: number | null;
  tokenCount?: number | null;
  firstTs?: number | null;
  lastTs?: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
};

export type TokenHoldersPage = {
  holders: TokenHolderRow[];
  uniqueAddresses: number;
  pagination?: {
    offset: number;
    limit: number;
    hasMore: boolean;
    total: number;
    nextCursor?: string | null;
  };
};

/** First holders pack for the token page — indexer snapshot, same 25 as the sheet. */
export async function fetchTokenHolders(tokenId: string): Promise<TokenHoldersPage | null> {
  const id = tokenId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const params = new URLSearchParams({
    limit: String(TOKEN_PACK),
    offset: "0",
    dir: "desc",
  });
  const j = await gwJson<TokenHoldersPage>(`/v1/tokens/${id}/holders?${params}`);
  if (!j || !Array.isArray(j.holders)) return null;
  return j;
}

export const RENT_PACK = 25;

export type RentTab = "upcoming" | "oldest" | "due";

export type RentWindow = {
  blocks: number;
  boxCount: number;
  rentNano: string;
  valueNano: string;
  inIndex?: boolean;
};

export type RentBoxRow = {
  boxId: string;
  address: string | null;
  valueNano: string;
  creationHeight: number;
  creationTs: number | null;
  tokenCount: number;
  tokens?: { tokenId: string; name: string | null; priceUsd?: number | null }[];
  sizeBytes: number;
  rentNano: string;
  blocksUntilRent: number;
  rentDue: boolean;
};

export type RentPageData = {
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
  items: RentBoxRow[];
  pagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
    total: number | null;
  };
  tab: RentTab;
  danger?: RentDangerRow[];
  source: string;
  updatedAt: string | null;
  collected?: {
    boxCount: number;
    rentNano: string;
    lastHeight: number | null;
    catchingUp: boolean;
    series?: { t: number; boxes: number; rentNano: string }[];
    daily?: { t: number; boxes: number; rentNano: string }[];
    hourly?: { t: number; boxes: number; rentNano: string }[];
    forecast?: { t: number; boxes: number; rentNano: string }[];
    miners?: RentMinersPack;
    minersDay?: RentMinersPack;
    minersMonth?: RentMinersPack;
    recent?: {
      boxId: string;
      collector: string | null;
      owner?: string | null;
      valueNano?: string | null;
      spentTxId?: string | null;
      rentNano: string;
      spentHeight: number;
      spentTs?: number | null;
      tokens?: {
        tokenId: string;
        amount: string;
        name: string | null;
        decimals: number | null;
      }[];
    }[];
    recentTotal?: number;
    verifying?: boolean;
  } | null;
};

export async function fetchRentPage(opts?: {
  tab?: RentTab;
  offset?: number;
}): Promise<RentPageData | null> {
  const tab = opts?.tab === "oldest" ? "oldest" : "upcoming";
  const offset = Math.max(0, opts?.offset ?? 0);
  const params = new URLSearchParams({
    tab,
    limit: String(RENT_PACK),
    offset: String(offset),
  });
  const gw = getGateway();
  try {
    const r = await fetch(`${gw}/v1/page/rent?${params}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(14_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as RentPageData;
    return j?.tipHeight ? j : null;
  } catch {
    return null;
  }
}

export type MempoolBall = {
  id: string;
  txId?: string;
  size: number;
  fee: number;
  feeRate: number;
  category: string;
  color: string;
  platform?: string;
  action?: string | null;
  value: number;
  inputCount: number;
  outputCount: number;
  firstSeen: number;
  tokenIds?: string[];
};

export function mempoolBallToTx(b: MempoolBall): TxListItem {
  const tokens = Array.isArray(b.tokenIds) ? new Set(b.tokenIds.filter(Boolean)).size : 0;
  return {
    id: b.txId || b.id,
    index: null,
    inclusionHeight: null,
    timestamp: b.firstSeen,
    size: b.size ?? 0,
    fee: b.fee ?? 0,
    feeRate: b.feeRate ?? 0,
    category: b.category,
    color: b.color,
    platform: b.platform ?? null,
    action: b.action ?? null,
    inputs: b.inputCount ?? 0,
    outputs: b.outputCount ?? 0,
    value: b.value ?? null,
    confirmed: false,
    tokenCount: tokens,
  };
}

export async function fetchMempoolPage(): Promise<{
  balls: MempoolBall[];
  p50: number | null;
}> {
  const [mp, fees] = await Promise.all([
    gwJson<{ balls?: MempoolBall[] }>("/v1/mempool"),
    gwJson<{ p50?: number }>("/v1/fees/histogram"),
  ]);
  const balls = Array.isArray(mp?.balls) ? mp.balls : [];
  const p50 = typeof fees?.p50 === "number" && Number.isFinite(fees.p50) ? fees.p50 : null;
  return { balls, p50 };
}

export type ErgMarket = {
  usd: number;
  source: string;
  rank: number | null;
  volume24h: number | null;
  change24h: number | null;
};

export async function fetchErgMarket(): Promise<ErgMarket | null> {
  const j = await gwJson<{
    usd?: number;
    source?: string;
    rank?: number | null;
    volume24h?: number | null;
    change24h?: number | null;
  }>("/v1/prices/erg");
  if (!j?.usd || j.usd <= 0) return null;
  return {
    usd: j.usd,
    source: j.source ?? "unknown",
    rank: finiteNum(j.rank),
    volume24h: finiteNum(j.volume24h),
    change24h: finiteNum(j.change24h),
  };
}

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
  firstTxId?: string | null;
  lastTxId?: string | null;
  isContract: boolean;
};

export const ADDRESS_PACK = 25;

export type AddressListSort = "erg" | "tokens" | "txs" | "address" | "first" | "last";
export type AddressListDir = "asc" | "desc";

export type AddressesPageData = {
  items: AddressListItem[];
  source: string;
  height: number | null;
  updatedAt: string | null;
  offset?: number;
  limit?: number;
  sort?: AddressListSort;
  dir?: AddressListDir;
  band?: string | null;
  kind?: string | null;
  total?: number | null;
  bands?: { p2pk?: unknown; all?: unknown; kinds?: unknown };
};

export function parseAddressListBands(raw: unknown): HolderBandId[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const hit = new Set(
    list
      .map((v) => String(v ?? "").trim().toLowerCase())
      .filter((s) => (HOLDER_BAND_IDS as readonly string[]).includes(s))
  );
  return HOLDER_BAND_IDS.filter((id) => hit.has(id));
}

export function parseAddressListKinds(raw: unknown): ListEntityId[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const hit = new Set(
    list
      .map((v) => String(v ?? "").trim().toLowerCase())
      .filter((s) => (LIST_ENTITY_IDS as readonly string[]).includes(s))
  );
  return LIST_ENTITY_IDS.filter((id) => hit.has(id));
}

export function joinAddressListFilter(ids: readonly string[]): string | null {
  return ids.length ? ids.join(",") : null;
}

/** Five bands already partition nanoERG>0; ∪ kind is the catalog. */
export function normalizeAddressListFilter(
  bands: HolderBandId[],
  kinds: ListEntityId[]
): { bands: HolderBandId[]; kinds: ListEntityId[] } {
  if (bands.length === HOLDER_BAND_IDS.length) return { bands: [], kinds: [] };
  return { bands, kinds };
}

export async function fetchAddressesList(opts?: {
  p2pkOnly?: boolean;
  offset?: number;
  bands?: string[] | null;
  kinds?: string[] | null;
  band?: string | null;
  kind?: string | null;
}): Promise<AddressesPageData> {
  const p2pkOnly = !!opts?.p2pkOnly;
  const offset = Math.max(0, opts?.offset ?? 0);
  const { bands, kinds } = normalizeAddressListFilter(
    parseAddressListBands(opts?.bands ?? opts?.band ?? null),
    parseAddressListKinds(opts?.kinds ?? opts?.kind ?? null)
  );
  const q = new URLSearchParams({
    limit: String(ADDRESS_PACK),
    offset: String(offset),
  });
  if (p2pkOnly) q.set("p2pk", "1");
  const bandQ = joinAddressListFilter(bands);
  const kindQ = joinAddressListFilter(kinds);
  if (bandQ) q.set("band", bandQ);
  if (kindQ) q.set("kind", kindQ);
  const j = await gwJson<AddressesPageData & { stale?: boolean }>(`/v1/page/addresses?${q.toString()}`);
  if (!j || j.stale || !Array.isArray(j.items)) {
    return { items: [], source: "lumen", height: null, updatedAt: null };
  }
  return {
    items: j.items,
    source: j.source ?? "lumen",
    height: j.height ?? null,
    updatedAt: j.updatedAt ?? null,
    offset: j.offset,
    limit: j.limit,
    band: j.band ?? bandQ,
    kind: j.kind ?? kindQ,
    total: typeof j.total === "number" ? j.total : null,
    bands: j.bands,
  };
}

/** Name from the ergo-names registry: exact address, NFT anchor, or ErgoTree template. */
export type AddressRegistryName = {
  name: string;
  kind: string;
  project: { id: string; name: string; category: string };
  by: "project" | "ergoscan";
  via: "address" | "token" | "template";
  current: boolean;
  until: number | null;
  file: string;
  fileUrl: string;
};

export type AddressPageData = {
  address: string;
  name?: AddressRegistryName | null;
  balance: {
    confirmedNanoErg: number | string;
    unconfirmedNanoErg: number | string;
    tokens: Array<{
      tokenId: string;
      amount: number | string;
      amountUi: number | null;
      name: string | null;
      decimals: number;
      priceUsd: number | null;
      valueUsd: number | null;
    }>;
  };
  unspentBoxes: Array<{
    boxId: string;
    value: number | string;
    assets?: { tokenId: string; amount: number | string }[];
    transactionId?: string | null;
    index?: number | null;
  }>;
  recentTxs: Array<{
    id: string;
    inclusionHeight: number | null;
    timestamp: number | null;
    numConfirmations?: number | null;
    size?: number | null;
    fee?: number | string | null;
    mempool?: boolean;
  }>;
  mempoolTxs?: Array<{
    id: string;
    inclusionHeight: number | null;
    timestamp: number | null;
    numConfirmations?: number | null;
    size?: number | null;
    fee?: number | string | null;
    mempool?: boolean;
  }>;
  tokenCount?: number;
  firstTs?: number | null;
  lastTs?: number | null;
  activity?: Record<
    string,
    {
      kind: AddrFlowKind;
      erg: string;
      tokens: {
        tokenId: string;
        amount: string;
        name?: string | null;
        decimals?: number;
      }[];
    }
  >;
  pagination?: {
    txs: {
      offset: number;
      limit: number;
      total: number;
      hasMore: boolean;
      nextCursor?: string | null;
    };
    boxes: {
      offset: number;
      limit: number;
      returned: number;
      total?: number;
      hasMore: boolean;
      nextCursor?: string | null;
    };
  };
  sources?: {
    balance?: string;
    boxes?: string;
    txs?: string;
    activity?: string;
    tokens?: string;
  };
};

/** `bad` is a failed address checksum from the gateway — a typo, not a missing row. */
export type AddressPageResult = { data: AddressPageData | null; bad: boolean };

export async function fetchAddressPageResult(address: string): Promise<AddressPageResult> {
  const gw = getGateway();
  try {
    const r = await fetch(
      `${gw}/v1/page/address/${encodeURIComponent(address)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (r.status === 400) {
      const e = (await r.json().catch(() => null)) as { error?: string } | null;
      return { data: null, bad: e?.error === "bad_address" };
    }
    if (!r.ok) return { data: null, bad: false };
    const j = (await r.json()) as AddressPageData;
    if (!j || typeof j.address !== "string") return { data: null, bad: false };
    return { data: j, bad: false };
  } catch {
    return { data: null, bad: false };
  }
}

export async function fetchAddressPage(address: string): Promise<AddressPageData | null> {
  return (await fetchAddressPageResult(address)).data;
}

export const NFT_PACK = 24;

export type NftCardSnap = {
  tokenId: string;
  name: string | null;
  artworkUrl: string | null;
  kind?: string | null;
  mediaUrl?: string | null;
  firstHeight: number | null;
  height?: number | null;
  issuerAddress?: string | null;
  collection?: string | null;
  slug?: string | null;
  txId?: string | null;
  source?: string;
  confirmed?: boolean;
};

export type NftSeriesSnap = {
  rank: number;
  slug: string;
  name: string;
  count: number;
  coverUrl: string | null;
  sample: { tokenId: string; name: string | null; artworkUrl: string | null }[];
  latestHeight: number | null;
};

export type NftIssuerSnap = {
  rank: number;
  address: string;
  count: number;
  coverUrl: string | null;
  sampleName: string | null;
  latestHeight: number | null;
};

export type NftWindowSnap = {
  minHeight: number | null;
  lastHeight: number | null;
  span: number | null;
};

export type NftKindCounts = {
  image: number;
  audio: number;
  video: number;
  collection: number;
  file: number;
  membership: number;
};

export type NftHomeSnap = {
  ready: boolean;
  catalog: NftCardSnap[];
  catalogTotal: number;
  named: number;
  withArt: number;
  kinds: NftKindCounts;
  kindReady: boolean;
  series: NftSeriesSnap[];
  issuers: NftIssuerSnap[];
  feed: NftCardSnap[];
  window: NftWindowSnap;
};

const EMPTY_KINDS: NftKindCounts = {
  image: 0,
  audio: 0,
  video: 0,
  collection: 0,
  file: 0,
  membership: 0,
};

function parseKindCounts(raw: unknown): NftKindCounts {
  if (!raw || typeof raw !== "object") return { ...EMPTY_KINDS };
  const r = raw as Record<string, unknown>;
  const n = (k: keyof NftKindCounts) =>
    typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : 0;
  return {
    image: n("image"),
    audio: n("audio"),
    video: n("video"),
    collection: n("collection"),
    file: n("file"),
    membership: n("membership"),
  };
}

function parseNftCard(raw: unknown): NftCardSnap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tokenId = typeof r.tokenId === "string" ? r.tokenId : "";
  if (!tokenId) return null;
  return {
    tokenId,
    name: typeof r.name === "string" ? r.name : null,
    artworkUrl: typeof r.artworkUrl === "string" ? r.artworkUrl : null,
    kind: typeof r.kind === "string" ? r.kind : null,
    mediaUrl: typeof r.mediaUrl === "string" ? r.mediaUrl : null,
    firstHeight: finiteNum(r.firstHeight),
    height: finiteNum(r.height),
    issuerAddress: typeof r.issuerAddress === "string" ? r.issuerAddress : null,
    collection: typeof r.collection === "string" ? r.collection : null,
    slug: typeof r.slug === "string" ? r.slug : null,
    txId: typeof r.txId === "string" ? r.txId : null,
    source: typeof r.source === "string" ? r.source : undefined,
    confirmed: typeof r.confirmed === "boolean" ? r.confirmed : undefined,
  };
}

function parseNftCards(raw: unknown): NftCardSnap[] {
  if (!Array.isArray(raw)) return [];
  const out: NftCardSnap[] = [];
  for (const it of raw) {
    const row = parseNftCard(it);
    if (row) out.push(row);
  }
  return out;
}

export async function fetchNftHome(): Promise<NftHomeSnap> {
  // Catalog tab is the first paint. Do not wait on /nfts/issuers: that GROUP BY
  // hits the 4s statement_timeout, and q() lastFail then blanks the catalog.
  const [cat, seriesJ, feedJ] = await Promise.all([
    gwJson<{
      items?: unknown;
      total?: number;
      named?: number;
      withArt?: number;
      ready?: boolean;
      kindReady?: boolean;
      kinds?: unknown;
      window?: NftWindowSnap;
    }>(`/v1/nfts/catalog?limit=${NFT_PACK}`),
    gwJson<{ collections?: NftSeriesSnap[]; ready?: boolean }>(
      `/v1/nfts/collections?limit=${NFT_PACK}`
    ),
    gwJson<{ items?: unknown; ready?: boolean }>(`/v1/nfts/recent?limit=${NFT_PACK}`),
  ]);
  const ready = cat != null && cat.ready !== false;
  return {
    ready,
    catalog: parseNftCards(cat?.items),
    catalogTotal: finiteNum(cat?.total) ?? 0,
    named: finiteNum(cat?.named) ?? 0,
    withArt: finiteNum(cat?.withArt) ?? 0,
    kinds: parseKindCounts(cat?.kinds),
    kindReady: cat?.kindReady !== false,
    series: Array.isArray(seriesJ?.collections) ? seriesJ.collections : [],
    issuers: [],
    feed: parseNftCards(feedJ?.items),
    window: {
      minHeight: finiteNum(cat?.window?.minHeight),
      lastHeight: finiteNum(cat?.window?.lastHeight),
      span: finiteNum(cat?.window?.span),
    },
  };
}

export async function fetchNftSeries(
  slug: string,
  offset = 0
): Promise<{
  name: string;
  items: NftCardSnap[];
  total: number;
  ready: boolean;
  coverUrl: string | null;
} | null> {
  const j = await gwJson<{
    name?: string;
    items?: unknown;
    total?: number;
    count?: number;
    ready?: boolean;
    coverUrl?: string | null;
  }>(
    `/v1/nfts/collections/${encodeURIComponent(slug)}?limit=${NFT_PACK}&offset=${Math.max(0, offset)}`
  );
  if (!j) return null;
  return {
    name: typeof j.name === "string" ? j.name : slug,
    items: parseNftCards(j.items),
    total: finiteNum(j.total) ?? finiteNum(j.count) ?? 0,
    ready: j.ready !== false,
    coverUrl: typeof j.coverUrl === "string" ? j.coverUrl : null,
  };
}

export async function fetchNftIssuer(
  address: string,
  offset = 0
): Promise<{
  address: string;
  items: NftCardSnap[];
  total: number;
  ready: boolean;
  coverUrl: string | null;
} | null> {
  const j = await gwJson<{
    address?: string;
    items?: unknown;
    total?: number;
    count?: number;
    ready?: boolean;
    coverUrl?: string | null;
  }>(
    `/v1/nfts/issuers/${encodeURIComponent(address)}?limit=${NFT_PACK}&offset=${Math.max(0, offset)}`
  );
  if (!j) return null;
  return {
    address: typeof j.address === "string" ? j.address : address,
    items: parseNftCards(j.items),
    total: finiteNum(j.total) ?? finiteNum(j.count) ?? 0,
    ready: j.ready !== false,
    coverUrl: typeof j.coverUrl === "string" ? j.coverUrl : null,
  };
}
