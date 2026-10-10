/**
 * Site price ticker. One cached read of the Spectrum reserve marks.
 * Dollar price is applied by the caller from the ERG/USD snap.
 */
import { cacheGet, cacheSet } from "./cache.js";
import { getIndexPool } from "./indexDb.js";

export type PriceTapeErg = {
  tokenId: string;
  symbol: string;
  priceErg: number;
  changePct: number | null;
};

type TapeRaw = {
  token_id: string;
  symbol: string | null;
  price_erg: number | null;
  vol24: number | null;
  tvl_erg: number | null;
  prev_erg: number | null;
};

const KEY = "defi:price-tape";
const TTL_MS = 45_000;
const TAPE_N = 18;

const TAPE_SQL = `
SELECT DISTINCT ON (r.quote_token)
       r.quote_token AS token_id,
       coalesce(nullif(ps.symbol, '?'), nullif(tok.name, '')) AS symbol,
       ps.price_erg::float8 AS price_erg,
       ps.volume_erg_24h::float8 AS vol24,
       ps.tvl_erg::float8 AS tvl_erg,
       y.price_erg::float8 AS prev_erg
FROM defi.pool_registry r
JOIN defi.pool_snap ps ON ps.pool_id = r.pool_id
LEFT JOIN tokens tok ON tok.token_id = r.quote_token
LEFT JOIN defi.price_day y
  ON y.token_id = r.quote_token
 AND y.day = (CURRENT_DATE - 1)
WHERE r.venue = 'spectrum_cfmm'
  AND ps.price_erg > 0
  AND ps.price_erg < 100000
ORDER BY r.quote_token, ps.volume_erg_24h DESC NULLS LAST, ps.tvl_erg DESC NULLS LAST
`;

/**
 * Traded today, in this order: day gain (strongest first), then day loss,
 * then the busiest names that have no day move. A quiet pool stays off.
 */
export function rankPriceTape(rows: TapeRaw[]): PriceTapeErg[] {
  const priced = rows
    .map((row) => {
      const priceErg = Number(row.price_erg);
      const prev = Number(row.prev_erg);
      const vol24 = Number(row.vol24);
      const tvl = Number(row.tvl_erg);
      const symbol = String(row.symbol || "").trim();
      const tokenId = String(row.token_id || "").toLowerCase();
      if (!symbol || !(priceErg > 0) || priceErg >= 100000 || !/^[0-9a-f]{64}$/.test(tokenId)) return null;
      const change = prev > 0 ? ((priceErg - prev) / prev) * 100 : null;
      return {
        tokenId,
        symbol,
        priceErg,
        changePct: change != null && Number.isFinite(change) && Math.abs(change) < 1e6 ? change : null,
        vol24: Number.isFinite(vol24) ? vol24 : 0,
        tvl: Number.isFinite(tvl) ? tvl : 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  const movers = priced
    .filter((row) => row.vol24 > 0 && row.changePct != null && row.changePct !== 0)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0) || b.vol24 - a.vol24);
  const seen = new Set(movers.map((row) => row.tokenId));
  const traded = priced
    .filter((row) => row.vol24 > 0 && !seen.has(row.tokenId))
    .sort((a, b) => b.vol24 - a.vol24 || b.tvl - a.tvl);
  return [...movers, ...traded].slice(0, TAPE_N).map(({ tokenId, symbol, priceErg, changePct }) => ({
    tokenId,
    symbol,
    priceErg,
    changePct,
  }));
}

export async function loadPriceTapeErg(): Promise<PriceTapeErg[]> {
  const hit = cacheGet<PriceTapeErg[]>(KEY);
  if (hit) return hit;
  const pool = getIndexPool();
  if (!pool) return [];
  try {
    const r = await pool.query<TapeRaw>(TAPE_SQL);
    const tape = rankPriceTape(r.rows);
    if (tape.length >= 2) cacheSet(KEY, tape, TTL_MS);
    return tape;
  } catch {
    return [];
  }
}
