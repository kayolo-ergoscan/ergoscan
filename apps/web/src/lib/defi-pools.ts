export type DefiPool = {
  poolId: string;
  tokenId: string;
  symbol: string;
  baseId?: string | null;
  baseSymbol?: string | null;
  tvlErg: number;
  vol24h?: number;
  lastTs?: number;
  venue?: string | null;
};

/** /defi/pool row. `traders` is the distinct swap addresses on that pool. */
export type PoolBoardRow = DefiPool & {
  volErg: number | null;
  priceErg: number | null;
  trades: number | null;
  firstTs: number | null;
  traders: number | null;
};

export type PoolBoardSort = "tvl" | "vol" | "vol24" | "trades" | "first" | "last";
export type PoolBoardDir = "asc" | "desc";

function boardNum(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/** Missing numbers stay at the bottom in both directions. */
function cmpBoard(a: number | null, b: number | null, dir: PoolBoardDir): number {
  const an = a != null;
  const bn = b != null;
  if (an !== bn) return an ? -1 : 1;
  if (a == null || b == null || a === b) return 0;
  return dir === "asc" ? a - b : b - a;
}

export function sortPoolBoard(
  rows: readonly PoolBoardRow[],
  key: PoolBoardSort,
  dir: PoolBoardDir
): PoolBoardRow[] {
  return [...rows].sort((a, b) => {
    let c = 0;
    if (key === "tvl") c = cmpBoard(boardNum(a.tvlErg > 0 ? a.tvlErg : null), boardNum(b.tvlErg > 0 ? b.tvlErg : null), dir);
    else if (key === "vol") c = cmpBoard(boardNum(a.volErg), boardNum(b.volErg), dir);
    else if (key === "vol24")
      c = cmpBoard(
        boardNum(a.vol24h && a.vol24h > 0 ? a.vol24h : null),
        boardNum(b.vol24h && b.vol24h > 0 ? b.vol24h : null),
        dir
      );
    else if (key === "trades") c = cmpBoard(boardNum(a.trades), boardNum(b.trades), dir);
    else if (key === "first")
      c = cmpBoard(
        boardNum(a.firstTs && a.firstTs > 0 ? a.firstTs : null),
        boardNum(b.firstTs && b.firstTs > 0 ? b.firstTs : null),
        dir
      );
    else
      c = cmpBoard(
        boardNum(a.lastTs && a.lastTs > 0 ? a.lastTs : null),
        boardNum(b.lastTs && b.lastTs > 0 ? b.lastTs : null),
        dir
      );
    if (c !== 0) return c;
    return (a.poolId || "").localeCompare(b.poolId || "");
  });
}

const ERG_ZERO = "0".repeat(64);

export function isErgBase(baseId?: string | null, baseSymbol?: string | null): boolean {
  const id = (baseId ?? "").toLowerCase();
  return !id || id === ERG_ZERO || baseSymbol === "ERG";
}

export function defiVenueCaption(
  venue: string | null | undefined,
  t: (k: string) => string
): string | null {
  const v = String(venue || "spectrum_cfmm").trim().toLowerCase();
  if (v === "lithos_dex") return t("defi.venue.lithos");
  if (v === "spectrum_n2n") return t("defi.venue.spectrumN2n");
  if (v === "ageusd_bank") return null;
  const key = "defi.venue.spectrum";
  const loc = t(key);
  return loc !== key ? loc : "ErgoDex";
}

export function isLivePool(row: Pick<DefiPool, "lastTs" | "vol24h">): boolean {
  return (row.lastTs ?? 0) > 0 || (row.vol24h ?? 0) > 0;
}

export function lithosPoolsOnly(rows: DefiPool[]): DefiPool[] {
  return rows.filter((p) => String(p.venue || "").trim().toLowerCase() === "lithos_dex");
}

/** Deepest TVL first — Lithos reserve tile. */
export function sortDefiPoolsByTvl(rows: DefiPool[]): DefiPool[] {
  return [...rows].sort((a, b) => {
    const atv = a.tvlErg > 0 ? a.tvlErg : 0;
    const btv = b.tvlErg > 0 ? b.tvlErg : 0;
    if (btv !== atv) return btv - atv;
    const av = a.vol24h && a.vol24h > 0 ? a.vol24h : 0;
    const bv = b.vol24h && b.vol24h > 0 ? b.vol24h : 0;
    if (bv !== av) return bv - av;
    return (a.tokenId || "").localeCompare(b.tokenId || "");
  });
}

/** Spectrum page: only pools with indexed TVL at/above the ERG floor. */
export function poolsWithMinTvl(rows: DefiPool[], minErg: number): DefiPool[] {
  const floor = Number.isFinite(minErg) && minErg > 0 ? minErg : 0;
  return rows.filter((p) => (p.tvlErg > 0 ? p.tvlErg : 0) >= floor);
}

/**
 * Prefer TVL ≥ floor. If the writer has not seated any, show fill-gated pools
 * so the page is not empty while snaps are still 0.
 */
export function spectrumListedPools(rows: DefiPool[], minErg: number): DefiPool[] {
  const deep = sortDefiPoolsByTvl(poolsWithMinTvl(rows, minErg));
  if (deep.length) return deep;
  return sortDefiPools(rows.filter(isLivePool));
}

/** Newest fill first, then 24h vol. Dead zeros stay at the bottom. */
export function sortDefiPools(rows: DefiPool[]): DefiPool[] {
  return [...rows].sort((a, b) => {
    const at = a.lastTs && a.lastTs > 0 ? a.lastTs : 0;
    const bt = b.lastTs && b.lastTs > 0 ? b.lastTs : 0;
    if (bt !== at) return bt - at;
    const av = a.vol24h && a.vol24h > 0 ? a.vol24h : 0;
    const bv = b.vol24h && b.vol24h > 0 ? b.vol24h : 0;
    if (bv !== av) return bv - av;
    const atv = a.tvlErg > 0 ? a.tvlErg : 0;
    const btv = b.tvlErg > 0 ? b.tvlErg : 0;
    if (btv !== atv) return btv - atv;
    return (a.tokenId || "").localeCompare(b.tokenId || "");
  });
}
