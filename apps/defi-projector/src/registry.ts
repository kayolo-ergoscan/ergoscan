import { isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";

const HEX64 = /^[0-9a-f]{64}$/;

export type PoolReg = {
  poolId: string;
  quoteToken: string;
  symbol: string | null;
  decimals: number | null;
  /** Issuance box creation_height, else tokens.first_height. Null = keep in every window. */
  existedFrom: number | null;
};

/** Window [fromH, toH] only sees NFTs that already existed at toH. Missing height → keep. */
export function registryForWindow(registry: PoolReg[], toH: number): PoolReg[] {
  return registry.filter(
    (r) => r.existedFrom == null || r.existedFrom <= toH
  );
}

/**
 * Detect only NFTs that had a spent pool box in the height window.
 * `active == null` = prefilter failed → keep the full live list (do not drop history).
 */
export function nftsForDetect(allNfts: string[], active: string[] | null): string[] {
  if (active == null) return allNfts;
  const set = new Set(active);
  return allNfts.filter((id) => set.has(id));
}

export async function listRegistryNfts(db: Db): Promise<PoolReg[]> {
  const r = await db.query<{
    pool_id: string;
    quote_token: string;
    symbol: string | null;
    decimals: number | null;
    existed_from: string | number | null;
  }>(
    `SELECT
       r.pool_id,
       r.quote_token,
       r.symbol,
       r.decimals,
       COALESCE(b.creation_height, t.first_height) AS existed_from
     FROM defi.pool_registry r
     LEFT JOIN tokens t ON t.token_id = r.pool_id
     LEFT JOIN packed.boxes b ON b.box_id = packed.hex32(r.pool_id)
     WHERE r.venue = 'spectrum_cfmm'`
  );
  return r.rows
    .filter(
      (row) =>
        HEX64.test(row.pool_id) &&
        HEX64.test(row.quote_token) &&
        !isAgeUsdBankNft(row.pool_id)
    )
    .map((row) => {
      const raw = row.existed_from;
      const n = raw == null || raw === "" ? NaN : Number(raw);
      return {
        poolId: row.pool_id.toLowerCase(),
        quoteToken: row.quote_token.toLowerCase(),
        symbol: row.symbol,
        decimals: row.decimals,
        existedFrom: Number.isFinite(n) && n > 0 ? n : null,
      };
    });
}
