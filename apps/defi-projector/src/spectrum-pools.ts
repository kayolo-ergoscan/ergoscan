import { isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";
import { pickT2tPair } from "./t2t-pair.js";

/**
 * Spectrum AMM template hashes (packed.script.template_hash).
 * One hash per contract; each pool box still has its own tree constants.
 * Numeric script_id is local to this database and is not used.
 *
 * CFMM: NFT + LP + quote, ERG is the box value. N2N: NFT + LP + two tokens.
 */
export const SPECTRUM_CFMM_TEMPLATE =
  "2dcc7830afe8f355b945850c60ff2b41fdb3e8ade07fde0a7c8a3ec498e8c3f6";
export const SPECTRUM_N2N_TEMPLATE =
  "3c09deff3b5f49329149d18e02aab675ef6957bf6559a5c7dba817fee883fb3e";

const ERG_ZERO = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;
const MIN_CFMM = 200;
const MIN_N2N = 200;

export type SpectrumAsset = {
  tokenId: string;
  amount: bigint;
  name: string | null;
  decimals: number | null;
  emission: bigint | null;
};

export type CfmmParts = { nft: string; quote: string; lp: string };

export type LiveSpectrumPool = {
  poolId: string;
  venue: "spectrum_cfmm" | "spectrum_n2n";
  quoteToken: string;
  baseToken: string;
  symbol: string | null;
  decimals: number | null;
  height: number | null;
};

function cleanId(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

function whole(raw: bigint): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Live CFMM box: exactly three tokens. The NFT is the emission-1 unit.
 * The LP is the other token with the larger supply; the rest is the quote.
 */
export function pickCfmmPool(assets: SpectrumAsset[]): CfmmParts | null {
  if (assets.length !== 3) return null;
  const rows = assets
    .map((a) => ({ ...a, tokenId: cleanId(a.tokenId) }))
    .filter((a) => HEX64.test(a.tokenId) && a.amount > 0n);
  if (rows.length !== 3) return null;
  const nfts = rows.filter((a) => a.amount === 1n && (a.emission == null || a.emission === 1n));
  const minted = nfts.filter((a) => a.emission === 1n);
  const nft = (minted.length === 1 ? minted : nfts).length === 1
    ? (minted.length === 1 ? minted[0] : nfts[0])
    : null;
  if (!nft) return null;
  const rest = rows.filter((a) => a.tokenId !== nft.tokenId);
  if (rest.length !== 2) return null;
  const lp = rest.reduce((best, a) => {
    const be = best.emission ?? 0n;
    const ae = a.emission ?? 0n;
    if (ae !== be) return ae > be ? a : best;
    return a.amount > best.amount ? a : best;
  });
  const quote = rest.find((a) => a.tokenId !== lp.tokenId);
  if (!quote || quote.tokenId === lp.tokenId) return null;
  return { nft: nft.tokenId, quote: quote.tokenId, lp: lp.tokenId };
}

function asBig(raw: string | number | null | undefined): bigint | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).split(".")[0];
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

type BoxGroup = {
  venue: "spectrum_cfmm" | "spectrum_n2n";
  height: number | null;
  assets: SpectrumAsset[];
};

export function poolsFromBoxes(
  groups: BoxGroup[]
): { pools: LiveSpectrumPool[]; skipped: number } {
  const byId = new Map<string, LiveSpectrumPool>();
  let skipped = 0;
  for (const g of groups) {
    if (g.venue === "spectrum_cfmm") {
      if (g.assets.length !== 3) {
        skipped += 1;
        continue;
      }
      const parts = pickCfmmPool(g.assets);
      if (!parts || isAgeUsdBankNft(parts.nft)) {
        skipped += 1;
        continue;
      }
      const quote = g.assets.find((a) => cleanId(a.tokenId) === parts.quote);
      const symbol = (quote?.name || "").trim() || null;
      const prev = byId.get(parts.nft);
      if (prev && (prev.height ?? 0) > (g.height ?? 0)) continue;
      byId.set(parts.nft, {
        poolId: parts.nft,
        venue: "spectrum_cfmm",
        quoteToken: parts.quote,
        baseToken: ERG_ZERO,
        symbol,
        decimals: quote?.decimals ?? null,
        height: g.height,
      });
      continue;
    }
    if (g.assets.length !== 4) {
      skipped += 1;
      continue;
    }
    const nftRow = g.assets.find(
      (a) => a.amount === 1n && (a.emission == null || a.emission === 1n)
    );
    const minted = g.assets.filter((a) => a.amount === 1n && a.emission === 1n);
    const nft = minted.length === 1 ? minted[0] : nftRow;
    if (!nft || isAgeUsdBankNft(cleanId(nft.tokenId))) {
      skipped += 1;
      continue;
    }
    const pair = pickT2tPair(
      g.assets.map((a) => ({
        tokenId: a.tokenId,
        amount: whole(a.amount),
        name: cleanId(a.tokenId) === cleanId(nft.tokenId) ? nft.name : a.name,
      })),
      nft.tokenId
    );
    if (!pair) {
      skipped += 1;
      continue;
    }
    const a = g.assets.find((x) => cleanId(x.tokenId) === pair.tokenA);
    const b = g.assets.find((x) => cleanId(x.tokenId) === pair.tokenB);
    const sa = (a?.name || "").trim();
    const sb = (b?.name || "").trim();
    const prev = byId.get(cleanId(nft.tokenId));
    if (prev && (prev.height ?? 0) > (g.height ?? 0)) continue;
    byId.set(cleanId(nft.tokenId), {
      poolId: cleanId(nft.tokenId),
      venue: "spectrum_n2n",
      quoteToken: pair.tokenA,
      baseToken: pair.tokenB,
      symbol: sa && sb ? `${sa}/${sb}` : sa || sb || null,
      decimals: a?.decimals ?? null,
      height: g.height,
    });
  }
  return { pools: [...byId.values()], skipped };
}

export type SpectrumSync = {
  cfmm: number;
  n2n: number;
  removed: number;
  swaps: number;
  aborted: boolean;
};

/**
 * Registry becomes the unspent Spectrum boxes. Stake keys and picture NFTs
 * that shared a wallet with a quote token are removed, and so are the swaps
 * the detector wrote while those NFTs were registered. Lithos is left alone.
 * Aborts without deleting when the live set is implausibly small.
 */
export async function syncLiveSpectrumPools(db: Db): Promise<SpectrumSync> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = 120000`);
    const found = await client.query<{
      box_id: string;
      height: string | number | null;
      tpl: string;
      token_id: string;
      amount: string;
      name: string | null;
      decimals: number | null;
      emission: string | null;
    }>(
      `
      SELECT encode(b.box_id, 'hex') AS box_id,
             b.creation_height AS height,
             encode(sc.template_hash, 'hex') AS tpl,
             encode(ba.token_id, 'hex') AS token_id,
             ba.amount::text AS amount,
             tok.name,
             tok.decimals,
             tok.emission::text AS emission
      FROM packed.script sc
      JOIN packed.boxes b ON b.script_id = sc.id AND b.spent_tx_id IS NULL
      JOIN packed.box_assets ba ON ba.box_id = b.box_id
      LEFT JOIN tokens tok ON tok.token_id = encode(ba.token_id, 'hex')
      WHERE sc.template_hash IN (decode($1, 'hex'), decode($2, 'hex'))
      `,
      [SPECTRUM_CFMM_TEMPLATE, SPECTRUM_N2N_TEMPLATE]
    );
    const groups = new Map<string, BoxGroup>();
    for (const row of found.rows) {
      const box = String(row.box_id || "");
      const amount = asBig(row.amount);
      const tokenId = cleanId(row.token_id);
      if (!box || amount == null || !HEX64.test(tokenId)) continue;
      let g = groups.get(box);
      if (!g) {
        const h = Number(row.height);
        g = {
          venue:
            String(row.tpl || "") === SPECTRUM_CFMM_TEMPLATE
              ? "spectrum_cfmm"
              : "spectrum_n2n",
          height: Number.isFinite(h) && h > 0 ? h : null,
          assets: [],
        };
        groups.set(box, g);
      }
      g.assets.push({
        tokenId,
        amount,
        name: row.name,
        decimals: row.decimals,
        emission: asBig(row.emission),
      });
    }
    const { pools, skipped } = poolsFromBoxes([...groups.values()]);
    const cfmm = pools.filter((p) => p.venue === "spectrum_cfmm").length;
    const n2n = pools.filter((p) => p.venue === "spectrum_n2n").length;
    if (cfmm < MIN_CFMM || n2n < MIN_N2N) {
      await client.query("ROLLBACK");
      console.warn(
        JSON.stringify({
          type: "spectrum_sync_abort",
          cfmm,
          n2n,
          skipped,
          boxes: groups.size,
        })
      );
      return { cfmm, n2n, removed: 0, swaps: 0, aborted: true };
    }

    await client.query(
      `
      INSERT INTO defi.pool_registry
        (pool_id, venue, quote_token, base_token, symbol, decimals, updated_height, updated_at)
      SELECT x.pool_id, x.venue, x.quote_token, x.base_token, x.symbol, x.decimals, x.updated_height, now()
      FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[]
      ) AS x(pool_id, venue, quote_token, base_token, symbol, decimals, updated_height)
      ON CONFLICT (pool_id) DO UPDATE SET
        venue = EXCLUDED.venue,
        quote_token = EXCLUDED.quote_token,
        base_token = EXCLUDED.base_token,
        symbol = COALESCE(NULLIF(EXCLUDED.symbol, ''), defi.pool_registry.symbol),
        decimals = COALESCE(EXCLUDED.decimals, defi.pool_registry.decimals),
        updated_height = GREATEST(
          COALESCE(defi.pool_registry.updated_height, 0),
          COALESCE(EXCLUDED.updated_height, 0)
        ),
        updated_at = now()
      WHERE defi.pool_registry.venue IN ('spectrum_cfmm', 'spectrum_n2n')
      `,
      [
        pools.map((p) => p.poolId),
        pools.map((p) => p.venue),
        pools.map((p) => p.quoteToken),
        pools.map((p) => p.baseToken),
        pools.map((p) => p.symbol),
        pools.map((p) => p.decimals),
        pools.map((p) => p.height),
      ]
    );

    const gone = await client.query<{ pool_id: string }>(
      `
      DELETE FROM defi.pool_registry
      WHERE venue IN ('spectrum_cfmm', 'spectrum_n2n')
        AND pool_id <> ALL($1::text[])
      RETURNING pool_id
      `,
      [pools.map((p) => p.poolId)]
    );
    const removedIds = gone.rows.map((r) => r.pool_id).filter((id) => HEX64.test(id));
    let swaps = 0;
    if (removedIds.length) {
      const sw = await client.query(
        `DELETE FROM defi.swaps WHERE pool_id = ANY($1::text[])`,
        [removedIds]
      );
      swaps = sw.rowCount ?? 0;
      await client.query(`DELETE FROM defi.trades WHERE pool_id = ANY($1::text[])`, [removedIds]);
      await client.query(`DELETE FROM defi.pool_snap WHERE pool_id = ANY($1::text[])`, [removedIds]);
      await client.query(`DELETE FROM defi.pool_tick WHERE pool_id = ANY($1::text[])`, [removedIds]);
    }
    await client.query("COMMIT");
    if (skipped) {
      console.log(JSON.stringify({ type: "spectrum_sync_skip_boxes", skipped }));
    }
    return { cfmm, n2n, removed: removedIds.length, swaps, aborted: false };
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
}
