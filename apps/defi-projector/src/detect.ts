import { ergoTokenDecimals, isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";
import { classifyCfmmMove } from "./pool-mark.js";
import { nftsForDetect, registryForWindow, type PoolReg } from "./registry.js";

const ERG_ZERO = "0".repeat(64);
const DETECT_TIMEOUT_MS = Number(process.env.DETECT_TIMEOUT_MS || 8_000);
const MAX_TRADE_ERG = Number(process.env.MAX_TRADE_ERG || 25_000);

export type DetectedSwap = {
  txId: string;
  height: number;
  tsMs: number;
  poolId: string;
  tokenId: string;
  baseId: string;
  side: "buy" | "sell" | "mint" | "redeem";
  eventKind?: string;
  tokenAmount: number;
  baseAmount: number;
  price: number | null;
  trader: string | null;
  outBox: string;
  decimals: number;
  symbol: string | null;
};

/**
 * Spectrum CFMM N2T: spent pool NFT box + created pool NFT box in the same tx.
 * Pair by tx_id (creation_height often tip−1 vs spent_height). No HTTP.
 */
export type DetectResult = { ok: boolean; swaps: DetectedSwap[] };

const NFT_CHUNK = Number(process.env.DETECT_NFT_CHUNK || 60);

export async function detectSwaps(
  db: Db,
  fromH: number,
  toH: number,
  registry: PoolReg[]
): Promise<DetectResult> {
  if (fromH > toH || !registry.length) return { ok: true, swaps: [] };

  const live = registryForWindow(registry, toH).filter(
    (r) => !isAgeUsdBankNft(r.poolId)
  );
  if (!live.length) return { ok: true, swaps: [] };

  const byNft = new Map(live.map((r) => [r.poolId, r]));
  const liveIds = live.map((r) => r.poolId);
  const active = await activeNftsInWindow(db, fromH, toH, liveIds);
  const allNfts = nftsForDetect(liveIds, active);
  if (active != null) {
    console.log(
      JSON.stringify({
        type: "detect_active",
        from: fromH,
        to: toH,
        live: liveIds.length,
        active: allNfts.length,
      })
    );
  }
  const out: DetectedSwap[] = [];

  for (let i = 0; i < allNfts.length; i += NFT_CHUNK) {
    const nfts = allNfts.slice(i, i + NFT_CHUNK);
    const part = await detectChunkSplit(db, fromH, toH, nfts, byNft);
    if (!part.ok) return { ok: false, swaps: out };
    out.push(...part.swaps);
  }
  return { ok: true, swaps: out };
}

/** Spent pool-NFT boxes in [fromH, toH]. Null = timeout → caller keeps the full live list. */
async function activeNftsInWindow(
  db: Db,
  fromH: number,
  toH: number,
  nfts: string[]
): Promise<string[] | null> {
  if (!nfts.length) return [];
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${DETECT_TIMEOUT_MS}`);
    const r = await client.query<{ pool_id: string }>(
      `
      SELECT DISTINCT encode(ba.token_id, 'hex') AS pool_id
      FROM packed.boxes b
      JOIN packed.box_assets ba ON ba.box_id = b.box_id AND ba.amount = 1
      WHERE b.spent_height >= $2 AND b.spent_height <= $3
        AND b.spent_tx_id IS NOT NULL
        AND ba.token_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
      `,
      [nfts, fromH, toH]
    );
    await client.query("COMMIT");
    return r.rows.map((row) => row.pool_id).filter((id) => /^[0-9a-f]{64}$/.test(id));
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn(
      JSON.stringify({
        type: "detect_active_skip",
        from: fromH,
        to: toH,
        err: String(e),
      })
    );
    return null;
  } finally {
    client.release();
  }
}

/** Timeout on a 60-NFT bite: split. One pool still timing out: skip that pool this window. */
async function detectChunkSplit(
  db: Db,
  fromH: number,
  toH: number,
  nfts: string[],
  byNft: Map<string, PoolReg>
): Promise<DetectResult> {
  if (!nfts.length) return { ok: true, swaps: [] };
  const part = await detectChunk(db, fromH, toH, nfts, byNft);
  if (part.ok) return part;
  if (nfts.length === 1) {
    console.warn(
      JSON.stringify({
        type: "detect_nft_skip",
        from: fromH,
        to: toH,
        nft: nfts[0],
      })
    );
    return { ok: true, swaps: [] };
  }
  const mid = Math.ceil(nfts.length / 2);
  const left = await detectChunkSplit(db, fromH, toH, nfts.slice(0, mid), byNft);
  if (!left.ok) return left;
  const right = await detectChunkSplit(db, fromH, toH, nfts.slice(mid), byNft);
  if (!right.ok) return right;
  return { ok: true, swaps: [...left.swaps, ...right.swaps] };
}

async function detectChunk(
  db: Db,
  fromH: number,
  toH: number,
  nfts: string[],
  byNft: Map<string, PoolReg>
): Promise<DetectResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${DETECT_TIMEOUT_MS}`);

    const r = await client.query<{
      tx_id: string;
      height: string | number;
      pool_id: string;
      in_box: string;
      in_erg: string;
      out_box: string;
      out_erg: string;
      timestamp_ms: string | number | null;
      quote_token: string | null;
      y_in: string | null;
      y_out: string | null;
      trader: string | null;
      token_decimals: number | null;
    }>(
      `
      WITH pools AS (
        SELECT unnest($1::text[]) AS pool_id
      ),
      spent AS (
        SELECT
          b.spent_tx_id AS tx_id,
          b.spent_height AS height,
          encode(ba.token_id, 'hex') AS pool_id,
          b.box_id,
          b.value_nano
        FROM packed.boxes b
        JOIN packed.box_assets ba ON ba.box_id = b.box_id AND ba.amount = 1
        JOIN pools p ON ba.token_id = decode(lower(p.pool_id), 'hex')
        WHERE b.spent_height >= $2 AND b.spent_height <= $3
          AND b.spent_tx_id IS NOT NULL
      ),
      created AS (
        SELECT
          b.creation_tx_id AS tx_id,
          b.creation_height AS height,
          encode(ba.token_id, 'hex') AS pool_id,
          b.box_id,
          b.value_nano
        FROM packed.boxes b
        JOIN packed.box_assets ba ON ba.box_id = b.box_id AND ba.amount = 1
        JOIN pools p ON ba.token_id = decode(lower(p.pool_id), 'hex')
        WHERE b.creation_height >= $2 - 2 AND b.creation_height <= $3
          AND b.creation_tx_id IS NOT NULL
      ),
      paired AS (
        SELECT DISTINCT ON (s.tx_id, s.pool_id)
          s.tx_id,
          s.height,
          s.pool_id,
          s.box_id AS in_box,
          s.value_nano AS in_erg,
          c.box_id AS out_box,
          c.value_nano AS out_erg
        FROM spent s
        JOIN created c
          ON c.tx_id = s.tx_id AND c.pool_id = s.pool_id
        ORDER BY s.tx_id, s.pool_id, c.value_nano DESC
      )
      SELECT
        encode(p.tx_id, 'hex') AS tx_id,
        p.height,
        p.pool_id,
        encode(p.in_box, 'hex') AS in_box,
        p.in_erg,
        encode(p.out_box, 'hex') AS out_box,
        p.out_erg,
        t.timestamp_ms,
        COALESCE(reg.quote_token, ypick.token_id) AS quote_token,
        yin.amount::text AS y_in,
        yout.amount::text AS y_out,
        trader.address AS trader,
        tok.decimals AS token_decimals
      FROM paired p
      LEFT JOIN packed.transactions t ON t.id = p.tx_id
      LEFT JOIN defi.pool_registry reg ON reg.pool_id = p.pool_id
      LEFT JOIN LATERAL (
        SELECT encode(ba.token_id, 'hex') AS token_id
        FROM packed.box_assets ba
        WHERE ba.box_id = p.in_box
          AND ba.token_id <> decode(p.pool_id, 'hex')
        ORDER BY ba.amount ASC
        LIMIT 1
      ) ypick ON true
      LEFT JOIN packed.box_assets yin
        ON yin.box_id = p.in_box
       AND yin.token_id = decode(lower(COALESCE(reg.quote_token, ypick.token_id)), 'hex')
      LEFT JOIN LATERAL (
        SELECT encode(yin.token_id, 'hex') AS token_id
      ) yin_hex ON true
      LEFT JOIN packed.box_assets yout
        ON yout.box_id = p.out_box
       AND yout.token_id = decode(lower(COALESCE(reg.quote_token, ypick.token_id, yin_hex.token_id)), 'hex')
      LEFT JOIN tokens tok
        ON tok.token_id = COALESCE(reg.quote_token, ypick.token_id, yin_hex.token_id)
      LEFT JOIN LATERAL (
        SELECT ad.address
        FROM packed.address_tx a
        JOIN packed.addr ad ON ad.id = a.addr_id
        WHERE a.tx_id = p.tx_id
          AND ad.address LIKE '9%'
          AND length(ad.address) BETWEEN 50 AND 60
        ORDER BY length(ad.address) ASC, ad.address
        LIMIT 1
      ) trader ON true
      `,
      [nfts, fromH, toH]
    );

    await client.query("COMMIT");

    const out: DetectedSwap[] = [];
    for (const row of r.rows) {
      const nft = String(row.pool_id || "").toLowerCase();
      if (isAgeUsdBankNft(nft)) continue;
      const reg = byNft.get(nft);
      const tokenId = String(
        reg?.quoteToken || row.quote_token || ""
      ).toLowerCase();
      if (!HEX64(tokenId) || tokenId === nft) continue;

      const yIn = num(row.y_in);
      const yOut = num(row.y_out);
      if (!(yIn > 0 && yOut > 0)) continue;

      const dYraw = yOut - yIn;
      const dErg = num(row.out_erg) / 1e9 - num(row.in_erg) / 1e9;
      if (dYraw === 0 || dErg === 0) continue;

      const move = classifyCfmmMove(dYraw, dErg);
      if (!move) continue;

      const tokenRaw = Math.abs(dYraw);
      const baseAmount = Math.abs(dErg);
      if (tokenRaw < 1 || !(baseAmount > 0)) continue;
      if (move.eventKind === "swap") {
        if (baseAmount > MAX_TRADE_ERG) continue;
        const poolY = Math.max(yIn, yOut);
        if (poolY > 1000 && tokenRaw / poolY > 0.5) continue;
      } else if (baseAmount > 1e7) {
        continue;
      }
      const side = move.side;

      const known = ergoTokenDecimals(tokenId);
      const dec =
        known != null
          ? known
          : reg?.decimals != null && Number.isFinite(reg.decimals)
            ? Number(reg.decimals)
            : row.token_decimals != null
              ? Number(row.token_decimals)
              : 0;
      const tokenAmount = tokenRaw / 10 ** Math.max(0, Math.min(18, dec));
      if (!(tokenAmount > 0) || tokenAmount > 1e12) continue;

      const price =
        tokenAmount > 0 && baseAmount > 0 ? baseAmount / tokenAmount : null;
      const ts = Number(row.timestamp_ms) || Date.now();
      const height = Number(row.height) || fromH;
      const trader =
        typeof row.trader === "string" && row.trader.startsWith("9")
          ? row.trader
          : null;

      out.push({
        txId: String(row.tx_id).toLowerCase(),
        height,
        tsMs: ts,
        poolId: nft,
        tokenId,
        baseId: ERG_ZERO,
        side,
        tokenAmount,
        baseAmount,
        price,
        trader,
        outBox: String(row.out_box),
        decimals: dec,
        symbol: reg?.symbol ?? null,
        eventKind: move.eventKind,
      });
    }
    return { ok: true, swaps: out };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn(
      JSON.stringify({
        type: "detect_skip",
        from: fromH,
        to: toH,
        nfts: nfts.length,
        err: String(e),
      })
    );
    return { ok: false, swaps: [] };
  } finally {
    client.release();
  }
}

function HEX64(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export { ERG_ZERO };
