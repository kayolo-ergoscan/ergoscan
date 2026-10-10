import { ergoTokenDecimals, isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";
import type { DetectedSwap, DetectResult } from "./detect.js";
import { nftsForDetect } from "./registry.js";
import { classifyT2tMove } from "./t2t-pair.js";
import { registryForWindow, type T2tPoolReg } from "./t2t-registry.js";

const DETECT_TIMEOUT_MS = Number(process.env.DETECT_TIMEOUT_MS || 8_000);
const NFT_CHUNK = Number(process.env.DETECT_NFT_CHUNK || 80);

export async function detectT2tSwaps(
  db: Db,
  fromH: number,
  toH: number,
  registry: T2tPoolReg[]
): Promise<DetectResult> {
  if (fromH > toH || !registry.length) return { ok: true, swaps: [] };

  const windowed = registryForWindow(registry, toH) as T2tPoolReg[];
  const live = windowed.filter(
    (r) =>
      !isAgeUsdBankNft(r.poolId) &&
      r.tokenA &&
      r.tokenB &&
      r.tokenA !== r.tokenB
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
        pair: "t2t",
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
        pair: "t2t",
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

async function detectChunkSplit(
  db: Db,
  fromH: number,
  toH: number,
  nfts: string[],
  byNft: Map<string, T2tPoolReg>
): Promise<DetectResult> {
  if (!nfts.length) return { ok: true, swaps: [] };
  const part = await detectChunk(db, fromH, toH, nfts, byNft);
  if (part.ok) return part;
  if (nfts.length === 1) {
    console.warn(
      JSON.stringify({
        type: "detect_nft_skip",
        pair: "t2t",
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
  byNft: Map<string, T2tPoolReg>
): Promise<DetectResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${DETECT_TIMEOUT_MS}`);
    const r = await client.query<{
      tx_id: string;
      height: string | number;
      pool_id: string;
      out_box: string;
      timestamp_ms: string | number | null;
      trader: string | null;
      a_in: string | null;
      a_out: string | null;
      b_in: string | null;
      b_out: string | null;
      lp_in: string | null;
      lp_out: string | null;
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
          b.box_id
        FROM packed.boxes b
        JOIN packed.box_assets ba ON ba.box_id = b.box_id AND ba.amount = 1
        JOIN pools p ON ba.token_id = decode(lower(p.pool_id), 'hex')
        WHERE b.spent_height >= $2 AND b.spent_height <= $3
          AND b.spent_tx_id IS NOT NULL
      ),
      created AS (
        SELECT
          b.creation_tx_id AS tx_id,
          encode(ba.token_id, 'hex') AS pool_id,
          b.box_id
        FROM packed.boxes b
        JOIN packed.box_assets ba ON ba.box_id = b.box_id AND ba.amount = 1
        JOIN pools p ON ba.token_id = decode(lower(p.pool_id), 'hex')
        WHERE b.creation_height >= $2 - 2 AND b.creation_height <= $3
          AND b.creation_tx_id IS NOT NULL
      ),
      paired AS (
        SELECT DISTINCT ON (s.tx_id, s.pool_id)
          s.tx_id, s.height, s.pool_id, s.box_id AS in_box, c.box_id AS out_box
        FROM spent s
        JOIN created c ON c.tx_id = s.tx_id AND c.pool_id = s.pool_id
        ORDER BY s.tx_id, s.pool_id
      )
      SELECT
        encode(p.tx_id, 'hex') AS tx_id, p.height, p.pool_id,
        encode(p.out_box, 'hex') AS out_box,
        t.timestamp_ms,
        trader.address AS trader,
        ain.amount::text AS a_in,
        aout.amount::text AS a_out,
        bin.amount::text AS b_in,
        bout.amount::text AS b_out,
        (
          SELECT ba.amount::text FROM packed.box_assets ba
          WHERE ba.box_id = p.in_box
            AND encode(ba.token_id, 'hex') NOT IN (p.pool_id, COALESCE(reg.quote_token, ''), COALESCE(reg.base_token, ''))
          ORDER BY ba.amount DESC
          LIMIT 1
        ) AS lp_in,
        (
          SELECT ba.amount::text FROM packed.box_assets ba
          WHERE ba.box_id = p.out_box
            AND encode(ba.token_id, 'hex') NOT IN (p.pool_id, COALESCE(reg.quote_token, ''), COALESCE(reg.base_token, ''))
          ORDER BY ba.amount DESC
          LIMIT 1
        ) AS lp_out
      FROM paired p
      LEFT JOIN packed.transactions t ON t.id = p.tx_id
      LEFT JOIN defi.pool_registry reg ON reg.pool_id = p.pool_id
      LEFT JOIN packed.box_assets ain
        ON ain.box_id = p.in_box AND ain.token_id = packed.hex32(reg.quote_token)
      LEFT JOIN packed.box_assets aout
        ON aout.box_id = p.out_box AND aout.token_id = packed.hex32(reg.quote_token)
      LEFT JOIN packed.box_assets bin
        ON bin.box_id = p.in_box AND bin.token_id = packed.hex32(reg.base_token)
      LEFT JOIN packed.box_assets bout
        ON bout.box_id = p.out_box AND bout.token_id = packed.hex32(reg.base_token)
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
      if (!reg) continue;
      const tokenA = reg.tokenA;
      const tokenB = reg.tokenB;
      const aIn = num(row.a_in);
      const aOut = num(row.a_out);
      const bIn = num(row.b_in);
      const bOut = num(row.b_out);
      if (!(aIn > 0 && aOut > 0 && bIn > 0 && bOut > 0)) continue;
      const dA = aOut - aIn;
      const dB = bOut - bIn;
      const dLp = num(row.lp_out) - num(row.lp_in);
      const kind = classifyT2tMove(dA, dB, dLp);
      if (!kind) continue;

      if (kind === "swap") {
        const poolA = Math.max(aIn, aOut);
        const poolB = Math.max(bIn, bOut);
        if (poolA > 1000 && Math.abs(dA) / poolA > 0.5) continue;
        if (poolB > 1000 && Math.abs(dB) / poolB > 0.5) continue;
      }

      const ts = Number(row.timestamp_ms) || Date.now();
      const height = Number(row.height) || fromH;
      const trader =
        typeof row.trader === "string" && row.trader.startsWith("9")
          ? row.trader
          : null;
      const outBox = String(row.out_box);
      const [symA, symB] = splitPairSymbol(reg.symbol);

      out.push(
        ...pairRows({
          txId: String(row.tx_id).toLowerCase(),
          height,
          tsMs: ts,
          poolId: nft,
          tokenA,
          tokenB,
          dA,
          dB,
          trader,
          outBox,
          symbolA: symA,
          symbolB: symB,
          decimalsA: reg.decimals,
          decimalsB: null,
          eventKind: kind,
        })
      );
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
        pair: "t2t",
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

function pairRows(opts: {
  txId: string;
  height: number;
  tsMs: number;
  poolId: string;
  tokenA: string;
  tokenB: string;
  dA: number;
  dB: number;
  trader: string | null;
  outBox: string;
  symbolA: string | null;
  symbolB: string | null;
  decimalsA: number | null;
  decimalsB: number | null;
  eventKind: "swap" | "mint" | "redeem";
}): DetectedSwap[] {
  const decA = decOf(opts.tokenA, opts.decimalsA);
  const decB = decOf(opts.tokenB, opts.decimalsB);
  const amtA = Math.abs(opts.dA) / 10 ** decA;
  const amtB = Math.abs(opts.dB) / 10 ** decB;
  if (!(amtA > 0 && amtB > 0) || amtA > 1e12 || amtB > 1e12) return [];
  const sideA: DetectedSwap["side"] =
    opts.eventKind === "swap" ? (opts.dA < 0 ? "buy" : "sell") : opts.eventKind;
  const sideB: DetectedSwap["side"] =
    opts.eventKind === "swap" ? (opts.dB < 0 ? "buy" : "sell") : opts.eventKind;
  return [
    {
      txId: opts.txId,
      height: opts.height,
      tsMs: opts.tsMs,
      poolId: opts.poolId,
      tokenId: opts.tokenA,
      baseId: opts.tokenB,
      side: sideA,
      tokenAmount: amtA,
      baseAmount: amtB,
      price: amtA > 0 ? amtB / amtA : null,
      trader: opts.trader,
      outBox: opts.outBox,
      decimals: decA,
      symbol: opts.symbolA,
      eventKind: opts.eventKind,
    },
    {
      txId: opts.txId,
      height: opts.height,
      tsMs: opts.tsMs,
      poolId: opts.poolId,
      tokenId: opts.tokenB,
      baseId: opts.tokenA,
      side: sideB,
      tokenAmount: amtB,
      baseAmount: amtA,
      price: amtB > 0 ? amtA / amtB : null,
      trader: opts.trader,
      outBox: opts.outBox,
      decimals: decB,
      symbol: opts.symbolB,
      eventKind: opts.eventKind,
    },
  ];
}

function splitPairSymbol(raw: string | null): [string | null, string | null] {
  const s = (raw || "").trim();
  const i = s.indexOf("/");
  if (i < 1) return [s || null, null];
  return [s.slice(0, i) || null, s.slice(i + 1) || null];
}

function decOf(tokenId: string, fallback: number | null): number {
  const known = ergoTokenDecimals(tokenId);
  if (known != null) return Math.max(0, Math.min(18, known));
  if (fallback != null && Number.isFinite(fallback)) {
    return Math.max(0, Math.min(18, Number(fallback)));
  }
  return 0;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
