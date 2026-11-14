export const CHAIN_MAX_SUPPLY = 97_739_924;

export type PoolShare = {
  name: string;
  blocks: number;
  share: number;
  address?: string;
};

export type ChainStats24h = {
  blocks: number | null;
  avgBlockMs: number | null;
  coinsMined: number | null;
  txs: number | null;
  feesErg: number | null;
  outputErg: number | null;
  minerRevenueErg: number | null;
  feeSharePct: number | null;
};

export type ChainStats = {
  ok: boolean;
  source: string;
  maxSupply: number;
  hashRate: number | null;
  circulating: number | null;
  txPerDay: number | null;
  /** Confirmed txs in the indexed window. Snapshot only — not a GET COUNT. */
  txTotal: number | null;
  protocol: number | null;
  height: number | null;
  mempool: number | null;
  stats24h: ChainStats24h;
  pools: PoolShare[];
  poolBlocks: number;
  holderCount: number | null;
  /** protocol + pool + contract with nanoERG > 0. Home snapshot only. */
  scriptCount: number | null;
  holdersMonth: number | null;
  minerCount: number | null;
  lastBlockSize: number | null;
  at: number;
};

const EMPTY_24H: ChainStats24h = {
  blocks: null,
  avgBlockMs: null,
  coinsMined: null,
  txs: null,
  feesErg: null,
  outputErg: null,
  minerRevenueErg: null,
  feeSharePct: null,
};

export function emptyChainStats(): ChainStats {
  return {
    ok: false,
    source: "page-home",
    maxSupply: CHAIN_MAX_SUPPLY,
    hashRate: null,
    circulating: null,
    txPerDay: null,
    txTotal: null,
    protocol: null,
    height: null,
    mempool: null,
    stats24h: { ...EMPTY_24H },
    pools: [],
    poolBlocks: 0,
    holderCount: null,
    scriptCount: null,
    holdersMonth: null,
    minerCount: null,
    lastBlockSize: null,
    at: Date.now(),
  };
}

/** Merge additive `/v1/page/home` fields. Null incoming does not wipe a painted KPI. */
export function patchHomeStats(
  prev: ChainStats | null,
  patch: {
    hashRate?: number | null;
    txPerDay?: number | null;
    txTotal?: number | null;
    pools?: PoolShare[] | null;
    holderCount?: number | null;
    scriptCount?: number | null;
    holdersMonth?: number | null;
    minerCount?: number | null;
    lastBlockSize?: number | null;
    height?: number | null;
    circulating?: number | null;
    avgBlockMs?: number | null;
    mempool?: number | null;
    maxSupply?: number | null;
    /** Fees of the rolling 24 h (`stats24h.feesErg`). */
    feesErg?: number | null;
  }
): ChainStats {
  const base = prev ?? emptyChainStats();
  const pools = patch.pools ?? base.pools;
  const hashRate = patch.hashRate ?? base.hashRate;
  const txPerDay = patch.txPerDay ?? base.txPerDay;
  const height = patch.height ?? base.height;
  const circulating = patch.circulating ?? base.circulating;
  return {
    ...base,
    source: "page-home",
    ok: hashRate != null || txPerDay != null || height != null || circulating != null,
    maxSupply: patch.maxSupply && patch.maxSupply > 0 ? patch.maxSupply : base.maxSupply,
    hashRate,
    circulating,
    txPerDay,
    txTotal: patch.txTotal ?? base.txTotal,
    height,
    mempool: patch.mempool ?? base.mempool,
    holderCount: patch.holderCount ?? base.holderCount,
    scriptCount: patch.scriptCount ?? base.scriptCount,
    holdersMonth: patch.holdersMonth ?? base.holdersMonth,
    minerCount: patch.minerCount ?? base.minerCount,
    lastBlockSize: patch.lastBlockSize ?? base.lastBlockSize,
    pools,
    poolBlocks: pools.reduce((s, p) => s + p.blocks, 0),
    stats24h: {
      ...base.stats24h,
      ...(patch.avgBlockMs != null ? { avgBlockMs: patch.avgBlockMs } : {}),
      ...(txPerDay != null ? { txs: txPerDay } : {}),
      ...(patch.feesErg != null ? { feesErg: patch.feesErg } : {}),
    },
    at: Date.now(),
  };
}

export async function fetchChainStats(): Promise<ChainStats | null> {
  try {
    const r = await fetch("/chain-stats", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainStats;
  } catch {
    return null;
  }
}
