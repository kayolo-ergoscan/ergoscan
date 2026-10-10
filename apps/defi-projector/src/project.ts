import { isAgeUsdBankNft } from "@ergoscan/shared";
import type { Db } from "./db.js";
import type { DetectedSwap } from "./detect.js";
import { applyPoolRoll, poolVolMaxErg } from "./pool-roll.js";

const N2T_VENUE = "spectrum_cfmm";

/**
 * Write canonical swaps + project into live defi.trades (source=projector).
 * Gateway /v1/defi/* unchanged — tokenId= already reads any source; global tape
 * includes leftover spectrum_detect + projector.
 */
export async function persistSwaps(
  db: Db,
  swaps: DetectedSwap[]
): Promise<{ ok: boolean; n: number }> {
  if (!swaps.length) return { ok: true, n: 0 };
  const client = await db.connect();
  let n = 0;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = 8000`);
    const volMax = poolVolMaxErg();
    for (const s of swaps) {
      if (isAgeUsdBankNft(s.poolId)) continue;
      const kind = s.eventKind === "mint" || s.eventKind === "redeem" ? s.eventKind : "swap";
      const inserted = await client.query(
        `INSERT INTO defi.swaps
          (tx_id, height, ts_ms, venue, pool_id, token_id, base_id, side,
           token_amount, base_amount, price, trader, event_kind, status)
         VALUES ($1,$2,$3,'spectrum_cfmm',$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed')
         ON CONFLICT (tx_id, pool_id, event_kind) DO NOTHING
         RETURNING tx_id`,
        [
          s.txId,
          s.height,
          s.tsMs,
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
            venue: N2T_VENUE,
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
             token_id = $10
           WHERE tx_id = $1 AND pool_id = $2 AND event_kind = $11`,
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
            kind,
          ]
        );
      }

      n += 1;
      if (kind !== "swap") continue;

      // Projection into frozen `/v1/defi` trade path
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
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn(JSON.stringify({ type: "persist_skip", err: String(e) }));
    return { ok: false, n: 0 };
  } finally {
    client.release();
  }
  return { ok: true, n };
}
