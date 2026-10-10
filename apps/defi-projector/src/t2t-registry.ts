import { AGEUSD_BANK_NFTS, isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";
import { pickT2tPair } from "./t2t-pair.js";
import { registryForWindow, type PoolReg } from "./registry.js";
import { SPECTRUM_N2N_TEMPLATE } from "./spectrum-pools.js";

const HEX64 = /^[0-9a-f]{64}$/;
const BANK_NFTS = [...AGEUSD_BANK_NFTS];
export const T2T_VENUE = "spectrum_n2n";

export type T2tPoolReg = PoolReg & {
  tokenA: string;
  tokenB: string;
};

export { registryForWindow };

export async function seedT2tFromUnspent(db: Db): Promise<number> {
  const client = await db.connect();
  let r: { rows: Array<{
    pool_id: string;
    nft_name: string | null;
    first_height: string | number | null;
    box_id: string;
    token_id: string;
    amount: string;
    token_name: string | null;
    decimals: number | null;
  }> };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 30000");
    r = await client.query<{
    pool_id: string;
    nft_name: string | null;
    first_height: string | number | null;
    box_id: string;
    token_id: string;
    amount: string;
    token_name: string | null;
    decimals: number | null;
  }>(
    `
    SELECT
      lower(n.token_id) AS pool_id,
      n.name AS nft_name,
      n.first_height,
      encode(b.box_id, 'hex') AS box_id,
      encode(ba.token_id, 'hex') AS token_id,
      ba.amount::text,
      tok.name AS token_name,
      tok.decimals
    FROM tokens n
    JOIN packed.box_assets nft ON nft.token_id = packed.hex32(n.token_id) AND nft.amount = 1
    JOIN packed.boxes b ON b.box_id = nft.box_id AND b.spent_tx_id IS NULL
    JOIN packed.script sc ON sc.id = b.script_id AND sc.template_hash = decode($2, 'hex')
    JOIN packed.box_assets ba ON ba.box_id = b.box_id
    LEFT JOIN tokens tok ON tok.token_id = encode(ba.token_id, 'hex')
    WHERE n.emission = 1
      AND n.name ~* '_LP$'
      AND n.name !~* '^ERG_'
      AND lower(n.token_id) <> ALL($1::text[])
    `,
    [BANK_NFTS, SPECTRUM_N2N_TEMPLATE]
  );
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  const byPool = new Map<
    string,
    {
      first: number | null;
      nftName: string | null;
      assets: { tokenId: string; amount: number; name: string | null; decimals: number | null }[];
    }
  >();
  for (const row of r.rows) {
    const pool = String(row.pool_id || "").toLowerCase();
    if (!HEX64.test(pool) || isAgeUsdBankNft(pool)) continue;
    let g = byPool.get(pool);
    if (!g) {
      const raw = row.first_height;
      const n = raw == null || raw === "" ? NaN : Number(raw);
      g = {
        first: Number.isFinite(n) && n > 0 ? n : null,
        nftName: row.nft_name,
        assets: [],
      };
      byPool.set(pool, g);
    }
    g.assets.push({
      tokenId: String(row.token_id || "").toLowerCase(),
      amount: Number(row.amount),
      name: row.token_name,
      decimals: row.decimals,
    });
  }

  const rows: Array<{
    poolId: string;
    tokenA: string;
    tokenB: string;
    symbol: string | null;
    decimals: number | null;
    height: number | null;
  }> = [];
  for (const [poolId, g] of byPool) {
    const pair = pickT2tPair(
      g.assets.map((a) => ({
        tokenId: a.tokenId,
        amount: a.amount,
        name: a.tokenId === poolId ? g.nftName : a.name,
      })),
      poolId
    );
    if (!pair) continue;
    const a = g.assets.find((x) => x.tokenId === pair.tokenA);
    const b = g.assets.find((x) => x.tokenId === pair.tokenB);
    const sa = (a?.name || "").trim();
    const sb = (b?.name || "").trim();
    const symbol = sa && sb ? `${sa}/${sb}` : sa || sb || null;
    rows.push({
      poolId,
      tokenA: pair.tokenA,
      tokenB: pair.tokenB,
      symbol,
      decimals: a?.decimals ?? null,
      height: g.first,
    });
  }
  if (!rows.length) return 0;

  const ins = await db.query(
    `
    INSERT INTO defi.pool_registry (pool_id, venue, quote_token, base_token, symbol, decimals, updated_height, updated_at)
    SELECT
      x.pool_id, $1, x.quote_token, x.base_token, x.symbol, x.decimals, x.updated_height, now()
    FROM unnest(
      $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[]
    ) AS x(pool_id, quote_token, base_token, symbol, decimals, updated_height)
    ON CONFLICT (pool_id) DO UPDATE SET
      venue = EXCLUDED.venue,
      quote_token = EXCLUDED.quote_token,
      base_token = EXCLUDED.base_token,
      symbol = COALESCE(EXCLUDED.symbol, defi.pool_registry.symbol),
      decimals = COALESCE(EXCLUDED.decimals, defi.pool_registry.decimals),
      updated_height = GREATEST(COALESCE(defi.pool_registry.updated_height, 0), COALESCE(EXCLUDED.updated_height, 0)),
      updated_at = now()
    WHERE defi.pool_registry.venue IS DISTINCT FROM EXCLUDED.venue
       OR defi.pool_registry.quote_token IS DISTINCT FROM EXCLUDED.quote_token
       OR defi.pool_registry.base_token IS DISTINCT FROM EXCLUDED.base_token
       OR defi.pool_registry.symbol IS DISTINCT FROM EXCLUDED.symbol
    `,
    [
      T2T_VENUE,
      rows.map((x) => x.poolId),
      rows.map((x) => x.tokenA),
      rows.map((x) => x.tokenB),
      rows.map((x) => x.symbol),
      rows.map((x) => x.decimals),
      rows.map((x) => x.height),
    ]
  );
  return ins.rowCount ?? 0;
}

export async function listT2tRegistry(db: Db): Promise<T2tPoolReg[]> {
  const r = await db.query<{
    pool_id: string;
    quote_token: string;
    base_token: string | null;
    symbol: string | null;
    decimals: number | null;
    existed_from: string | number | null;
  }>(
    `SELECT
       r.pool_id,
       r.quote_token,
       r.base_token,
       r.symbol,
       r.decimals,
       COALESCE(t.first_height, r.updated_height) AS existed_from
     FROM defi.pool_registry r
     LEFT JOIN tokens t ON t.token_id = r.pool_id
     WHERE r.venue = $1`,
    [T2T_VENUE]
  );
  return r.rows
    .filter(
      (row) =>
        HEX64.test(row.pool_id) &&
        HEX64.test(row.quote_token) &&
        HEX64.test(String(row.base_token || "")) &&
        !isAgeUsdBankNft(row.pool_id)
    )
    .map((row) => {
      const raw = row.existed_from;
      const n = raw == null || raw === "" ? NaN : Number(raw);
      return {
        poolId: row.pool_id.toLowerCase(),
        quoteToken: row.quote_token.toLowerCase(),
        tokenA: row.quote_token.toLowerCase(),
        tokenB: String(row.base_token).toLowerCase(),
        symbol: row.symbol,
        decimals: row.decimals,
        existedFrom: Number.isFinite(n) && n > 0 ? n : null,
      };
    });
}
