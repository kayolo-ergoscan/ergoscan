import type pg from "pg";
import { ensurePackedSchema } from "./schema.js";

type Queryable = { query: pg.Pool["query"] };

/**
 * Remove one height from the packed copy.
 * Does not delete addr/script rows and does not move gix counters.
 * Spend marks on boxes created at another height are cleared, not the boxes.
 */
export async function unwindPackedHeight(db: Queryable, height: number): Promise<void> {
  await ensurePackedSchema(db);
  await db.query(
    `DELETE FROM packed.box_assets ba
      USING packed.boxes b, packed.transactions t
      WHERE t.height = $1
        AND b.creation_tx_id = t.id
        AND ba.box_id = b.box_id`,
    [height]
  );
  await db.query(
    `DELETE FROM packed.token_tx_move m
      USING packed.transactions t
      WHERE t.height = $1 AND m.tx_id = t.id`,
    [height]
  );
  await db.query(
    `DELETE FROM packed.token_tx_seen s
      USING packed.transactions t
      WHERE t.height = $1 AND s.tx_id = t.id`,
    [height]
  );
  await db.query(`DELETE FROM packed.address_tx WHERE height = $1`, [height]);
  // A Lithos find is keyed by its block height; a fork that drops the block drops the find
  // (audit 12 Nov: it stayed). The table belongs to lithosFind.ts and may not exist yet.
  const lithos = await db.query<{ t: string | null }>(`SELECT to_regclass('packed.lithos_find')::text AS t`);
  if (lithos.rows[0]?.t) {
    await db.query(`DELETE FROM packed.lithos_find WHERE height = $1`, [height]);
  }
  await db.query(
    `UPDATE packed.boxes
        SET spent_tx_id = NULL, spent_height = NULL
      WHERE spent_height = $1
        AND creation_tx_id NOT IN (
          SELECT id FROM packed.transactions WHERE height = $1
        )`,
    [height]
  );
  await db.query(`DELETE FROM packed.tx_inputs WHERE spent_height = $1`, [height]);
  await db.query(
    `DELETE FROM packed.boxes b
      USING packed.transactions t
      WHERE t.height = $1 AND b.creation_tx_id = t.id`,
    [height]
  );
  await db.query(`DELETE FROM packed.transactions WHERE height = $1`, [height]);
  await db.query(`DELETE FROM packed.blocks WHERE height = $1`, [height]);
}
