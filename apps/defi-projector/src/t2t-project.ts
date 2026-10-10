import { isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";
import type { DetectedSwap } from "./detect.js";
import { applyPoolRoll, poolVolMaxErg } from "./pool-roll.js";
import { T2T_VENUE } from "./t2t-registry.js";

/**
 * One swap row per tx+pool (unique event_kind=swap). Two trade rows (each token).
 */
export async function persistT2tSwaps(
  db: Db,
  swaps: DetectedSwap[]
): Promise<{ ok: boolean; n: number }> {
  if (!swaps.length) return { ok: true, n: 0 };
  const client = await db.connect();
  let n = 0;
  const wroteSwap = new Set<string>();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = 8000`);
    const volMax = poolVolMaxErg();
    for (const s of swaps) {
      if (isAgeUsdBankNft(s.poolId)) continue;
      if (s.baseId === "0".repeat(64)) continue;
      const kind = s.eventKind === "mint" || s.eventKind === "redeem" ? s.eventKind : "swap";
      const swapKey = `${s.txId}:${s.poolId}:${kind}`;
      if (!wroteSwap.has(swapKey)) {
        const inserted = await client.query(
          `INSERT INTO defi.swaps
            (tx_id, height, ts_ms, venue, pool_id, token_id, base_id, side,
             token_amount, base_amount, price, trader, event_kind, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'confirmed')
           ON CONFLICT (tx_id, pool_id, event_kind) DO NOTHING
           RETURNING tx_id`,
          [
            s.txId,
            s.height,
            s.tsMs,
            T2T_VENUE,
            s.poolId,
            s.tokenId,
            s.baseId,
            s.side,
            s.tokenAmount,
            s.baseAmount,
            s.price,
            s.trader,
            kind,
          ]
        );
        if (kind === "swap" && (inserted.rowCount ?? 0) > 0) {
          await applyPoolRoll(
            client,
            {
              poolId: s.poolId,
              tokenId: s.tokenId,
              venue: T2T_VENUE,
              baseId: s.baseId,
              baseAmount: s.baseAmount,
              tokenAmount: s.tokenAmount,
              tsMs: s.tsMs,
            },
            volMax
          );
        } else {
          await client.query(
            `UPDATE defi.swaps SET
               height = $3,
               ts_ms = $4,
               side = $5,
               token_amount = $6,
               base_amount = $7,
               price = $8,
               trader = COALESCE($9, trader),
               token_id = $10,
               base_id = $11,
               venue = $12
             WHERE tx_id = $1 AND pool_id = $2 AND event_kind = $13`,
            [
              s.txId,
              s.poolId,
              s.height,
              s.tsMs,
              s.side,
              s.tokenAmount,
              s.baseAmount,
              s.price,
              s.trader,
              s.tokenId,
              s.baseId,
              T2T_VENUE,
              kind,
            ]
          );
        }
        wroteSwap.add(swapKey);
      }

      if (kind !== "swap") continue;

      await client.query(
        `INSERT INTO defi.trades
          (tx_id, box_id, token_id, base_id, side, token_amount, base_amount,
           price, trader, pool_id, height, ts_ms, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'projector')
         ON CONFLICT (tx_id, token_id, side) DO UPDATE SET
           token_amount = EXCLUDED.token_amount,
           base_amount = EXCLUDED.base_amount,
           price = EXCLUDED.price,
           trader = COALESCE(EXCLUDED.trader, defi.trades.trader),
           pool_id = EXCLUDED.pool_id,
           height = EXCLUDED.height,
           box_id = EXCLUDED.box_id,
           ts_ms = EXCLUDED.ts_ms,
           base_id = EXCLUDED.base_id,
           source = 'projector'`,
        [
          s.txId,
          s.outBox,
          s.tokenId,
          s.baseId,
          s.side,
          s.tokenAmount,
          s.baseAmount,
          s.price,
          s.trader,
          s.poolId,
          s.height,
          s.tsMs,
        ]
      );
      n += 1;
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn(JSON.stringify({ type: "persist_skip", pair: "t2t", err: String(e) }));
    return { ok: false, n: 0 };
  } finally {
    client.release();
  }
  return { ok: true, n };
}
