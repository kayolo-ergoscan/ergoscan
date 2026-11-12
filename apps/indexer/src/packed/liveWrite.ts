/**
 * Live height rows into packed, from the in-memory batch.
 * Must run before token_tx_move_upsert: that function reads packed.boxes.
 * Idempotent. Does not touch tokens, token_balances, or address_summary.
 */
import type pg from "pg";

type Queryable = { query: pg.Pool["query"] };

type SpendRow = {
  boxId: string;
  spentTxId: string;
  spentHeight: number;
  proofHex?: string | null;
};

type BoxRow = {
  boxId: string;
  creationHeight: number;
  valueNano: string;
  ergoTree: string | null;
  address: string | null;
  creationTxId: string;
  outputIndex: number;
  registers: string | null;
  gix?: number | null;
};

type AssetRow = { boxId: string; tokenId: string; amount: string; index?: number | null };

type TxRow = {
  id: string;
  height: number;
  timestampMs: number;
  size: number | null;
  fee: number | null;
  indexInBlock: number;
  inputCount: number;
  outputCount: number;
  valueNano: number | string | null;
  shape: string | null;
  protocol: string | null;
  ruleId: string | null;
  rulesVersion: number;
  gix?: number | null;
};

export async function writePackedTransactions(
  client: Queryable,
  rows: TxRow[]
): Promise<void> {
  if (!rows.length) return;
  await client.query(
    `INSERT INTO packed.transactions (
       id, height, timestamp_ms, size, fee, index_in_block, input_count, output_count,
       value_nano, shape, protocol, rule_id, rules_version, gix
     )
     SELECT packed.hex32(u.id), u.height, u.timestamp_ms, u.size, u.fee, u.index_in_block,
            u.input_count, u.output_count, u.value_nano, u.shape, u.protocol,
            u.rule_id, u.rules_version, u.gix
       FROM unnest(
         $1::text[], $2::bigint[], $3::bigint[], $4::int[], $5::bigint[],
         $6::int[], $7::int[], $8::int[], $9::bigint[], $10::text[],
         $11::text[], $12::text[], $13::int[], $14::bigint[]
       ) AS u(
         id, height, timestamp_ms, size, fee, index_in_block,
         input_count, output_count, value_nano, shape, protocol, rule_id, rules_version, gix
       )
      WHERE u.id ~ '^[0-9a-fA-F]{64}$'
     ON CONFLICT (id) DO UPDATE SET
       height = EXCLUDED.height,
       timestamp_ms = EXCLUDED.timestamp_ms,
       size = EXCLUDED.size,
       fee = COALESCE(EXCLUDED.fee, packed.transactions.fee),
       index_in_block = EXCLUDED.index_in_block,
       input_count = EXCLUDED.input_count,
       output_count = EXCLUDED.output_count,
       value_nano = COALESCE(EXCLUDED.value_nano, packed.transactions.value_nano),
       shape = EXCLUDED.shape,
       protocol = EXCLUDED.protocol,
       rule_id = EXCLUDED.rule_id,
       rules_version = EXCLUDED.rules_version,
       gix = COALESCE(packed.transactions.gix, EXCLUDED.gix)`,
    [
      rows.map((r) => r.id),
      rows.map((r) => r.height),
      rows.map((r) => r.timestampMs),
      rows.map((r) => r.size),
      rows.map((r) => r.fee),
      rows.map((r) => r.indexInBlock),
      rows.map((r) => r.inputCount),
      rows.map((r) => r.outputCount),
      rows.map((r) => r.valueNano),
      rows.map((r) => r.shape),
      rows.map((r) => r.protocol),
      rows.map((r) => r.ruleId),
      rows.map((r) => r.rulesVersion),
      rows.map((r) => r.gix ?? null),
    ]
  );
}

export async function writePackedSpends(
  client: Queryable,
  spends: SpendRow[]
): Promise<void> {
  if (!spends.length) return;
  await client.query(
    `INSERT INTO packed.tx_inputs (box_id, spent_tx_id, spent_height, proof_bytes)
     SELECT packed.hex32(u.box_id), packed.hex32(u.spent_tx_id), u.spent_height,
            CASE
              WHEN u.proof ~ '^[0-9a-fA-F]{2,}$' AND length(u.proof) % 2 = 0
              THEN decode(u.proof, 'hex')
              ELSE NULL
            END
       FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[])
         AS u(box_id, spent_tx_id, spent_height, proof)
      WHERE u.box_id ~ '^[0-9a-fA-F]{64}$'
        AND u.spent_tx_id ~ '^[0-9a-fA-F]{64}$'
     ON CONFLICT (box_id) DO UPDATE SET
       spent_tx_id = EXCLUDED.spent_tx_id,
       spent_height = EXCLUDED.spent_height,
       proof_bytes = CASE
         WHEN EXCLUDED.spent_height > packed.tx_inputs.spent_height THEN EXCLUDED.proof_bytes
         ELSE COALESCE(EXCLUDED.proof_bytes, packed.tx_inputs.proof_bytes)
       END
      WHERE EXCLUDED.spent_height >= packed.tx_inputs.spent_height`,
    [
      spends.map((s) => s.boxId),
      spends.map((s) => s.spentTxId),
      spends.map((s) => s.spentHeight),
      spends.map((s) => s.proofHex ?? ""),
    ]
  );
  const groups = new Map<string, SpendRow[]>();
  for (const s of spends) {
    if (!s.boxId) continue;
    const k = `${s.spentTxId}\0${s.spentHeight}`;
    const list = groups.get(k);
    if (list) list.push(s);
    else groups.set(k, [s]);
  }
  for (const group of groups.values()) {
    const spentTxId = group[0].spentTxId;
    const spentHeight = group[0].spentHeight;
    const ids = [...new Set(group.map((s) => s.boxId))];
    await client.query(
      `UPDATE packed.boxes b
          SET spent_tx_id = packed.hex32($2),
              spent_height = $3
        WHERE b.box_id IN (
                SELECT decode(lower(x), 'hex')
                  FROM unnest($1::text[]) AS x
                 WHERE x ~ '^[0-9a-fA-F]{64}$'
              )
          AND (b.spent_height IS NULL OR $3 >= b.spent_height)`,
      [ids, spentTxId, spentHeight]
    );
  }
}

export async function writePackedBoxes(
  client: Queryable,
  rows: BoxRow[]
): Promise<void> {
  if (!rows.length) return;
  await client.query(
    `INSERT INTO packed.addr (address, addr_md5)
     SELECT DISTINCT u.address, md5(u.address)
       FROM unnest($1::text[]) AS u(address)
      WHERE u.address IS NOT NULL AND u.address <> ''
     ON CONFLICT (addr_md5) DO NOTHING`,
    [rows.map((r) => r.address)]
  );
  await client.query(
    `INSERT INTO packed.script (ergo_tree, tree_md5)
     SELECT DISTINCT u.ergo_tree, md5(u.ergo_tree)
       FROM unnest($1::text[]) AS u(ergo_tree)
      WHERE u.ergo_tree IS NOT NULL AND u.ergo_tree <> ''
     ON CONFLICT (tree_md5) DO NOTHING`,
    [rows.map((r) => r.ergoTree)]
  );
  await client.query(
    `INSERT INTO packed.boxes (
       box_id, creation_height, value_nano, addr_id, script_id, creation_tx_id,
       spent_tx_id, spent_height, output_index, additional_registers, gix, tree_bytes
     )
     SELECT packed.hex32(u.box_id),
            u.creation_height,
            u.value_nano::bigint,
            ad.id,
            sc.id,
            packed.hex32(u.creation_tx_id),
            t.spent_tx_id,
            t.spent_height,
            u.output_index,
            CASE WHEN u.regs IS NULL OR u.regs = '' THEN NULL ELSE u.regs::jsonb END,
            u.gix,
            CASE WHEN u.ergo_tree IS NULL OR u.ergo_tree = '' THEN 0
                 ELSE length(u.ergo_tree) / 2 END
       FROM unnest(
         $1::text[], $2::int[], $3::text[], $4::text[], $5::text[],
         $6::text[], $7::int[], $8::text[], $9::bigint[]
       ) AS u(
         box_id, creation_height, value_nano, ergo_tree, address,
         creation_tx_id, output_index, regs, gix
       )
       LEFT JOIN packed.addr ad
         ON ad.addr_md5 = md5(u.address) AND ad.address = u.address
       LEFT JOIN packed.script sc
         ON sc.tree_md5 = md5(u.ergo_tree) AND sc.ergo_tree = u.ergo_tree
       LEFT JOIN packed.tx_inputs t ON t.box_id = packed.hex32(u.box_id)
      WHERE u.box_id ~ '^[0-9a-fA-F]{64}$'
        AND (u.creation_tx_id IS NULL OR u.creation_tx_id ~ '^[0-9a-fA-F]{64}$')
     ON CONFLICT (box_id) DO UPDATE SET
       addr_id = COALESCE(EXCLUDED.addr_id, packed.boxes.addr_id),
       script_id = COALESCE(EXCLUDED.script_id, packed.boxes.script_id),
       value_nano = EXCLUDED.value_nano,
       creation_height = EXCLUDED.creation_height,
       creation_tx_id = COALESCE(EXCLUDED.creation_tx_id, packed.boxes.creation_tx_id),
       output_index = COALESCE(EXCLUDED.output_index, packed.boxes.output_index),
       additional_registers = COALESCE(EXCLUDED.additional_registers, packed.boxes.additional_registers),
       tree_bytes = COALESCE(packed.boxes.tree_bytes, EXCLUDED.tree_bytes),
       spent_tx_id = CASE
         WHEN packed.boxes.spent_height IS NULL THEN EXCLUDED.spent_tx_id
         WHEN EXCLUDED.spent_height IS NULL THEN packed.boxes.spent_tx_id
         WHEN EXCLUDED.spent_height >= packed.boxes.spent_height THEN EXCLUDED.spent_tx_id
         ELSE packed.boxes.spent_tx_id
       END,
       spent_height = CASE
         WHEN packed.boxes.spent_height IS NULL THEN EXCLUDED.spent_height
         WHEN EXCLUDED.spent_height IS NULL THEN packed.boxes.spent_height
         ELSE GREATEST(packed.boxes.spent_height, EXCLUDED.spent_height)
       END,
       gix = COALESCE(packed.boxes.gix, EXCLUDED.gix)`,
    [
      rows.map((r) => r.boxId),
      rows.map((r) => r.creationHeight),
      rows.map((r) => r.valueNano),
      rows.map((r) => r.ergoTree),
      rows.map((r) => r.address),
      rows.map((r) => r.creationTxId),
      rows.map((r) => r.outputIndex),
      rows.map((r) => r.registers),
      rows.map((r) => r.gix ?? null),
    ]
  );
}

/** Rows that landed (new PK). boxId/tokenId keep the caller's spelling. */
export async function writePackedAssets(
  client: Queryable,
  rows: AssetRow[]
): Promise<AssetRow[]> {
  if (!rows.length) return [];
  const ins = await client.query<{ box_id: string; token_id: string }>(
    `INSERT INTO packed.box_assets (box_id, token_id, amount, asset_index)
     SELECT packed.hex32(u.box_id), packed.hex32(u.token_id), u.amount::numeric, u.idx::smallint
       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS u(box_id, token_id, amount, idx)
      WHERE u.box_id ~ '^[0-9a-fA-F]{64}$'
        AND u.token_id ~ '^[0-9a-fA-F]{64}$'
     ON CONFLICT (box_id, token_id) DO NOTHING
     RETURNING encode(box_id, 'hex') AS box_id, encode(token_id, 'hex') AS token_id`,
    [
      rows.map((r) => r.boxId),
      rows.map((r) => r.tokenId),
      rows.map((r) => r.amount),
      rows.map((r) => (Number.isInteger(r.index) && r.index! >= 0 && r.index! < 32768 ? r.index! : null)),
    ]
  );
  if (!ins.rows.length) return [];
  const landed = new Set(ins.rows.map((r) => `${r.box_id}\0${r.token_id}`));
  const fresh: AssetRow[] = [];
  for (const row of rows) {
    if (!landed.has(`${row.boxId.toLowerCase()}\0${row.tokenId.toLowerCase()}`)) continue;
    fresh.push(row);
  }
  return fresh;
}

export async function writePackedAddressTx(
  client: Queryable,
  rows: { address: string; txId: string; height: number }[]
): Promise<{ address: string; height: number | string; neu: boolean }[]> {
  if (!rows.length) return [];
  await client.query(
    `INSERT INTO packed.addr (address, addr_md5)
     SELECT DISTINCT u.address, md5(u.address)
       FROM unnest($1::text[]) AS u(address)
      WHERE u.address IS NOT NULL AND u.address <> ''
     ON CONFLICT (addr_md5) DO NOTHING`,
    [rows.map((r) => r.address)]
  );
  const ins = await client.query<{
    address: string;
    height: number | string;
    neu: boolean;
  }>(
    `WITH src AS (
       SELECT ad.id AS addr_id, packed.hex32(u.tx_id) AS tx_id, u.height
         FROM unnest($1::text[], $2::text[], $3::bigint[]) AS u(address, tx_id, height)
         JOIN packed.addr ad
           ON ad.addr_md5 = md5(u.address) AND ad.address = u.address
        WHERE u.tx_id ~ '^[0-9a-fA-F]{64}$'
     ),
     ins AS (
       INSERT INTO packed.address_tx (addr_id, tx_id, height)
       SELECT addr_id, tx_id, height FROM src
       ON CONFLICT (addr_id, tx_id) DO UPDATE SET
         height = COALESCE(EXCLUDED.height, packed.address_tx.height)
       RETURNING addr_id, height, (xmax = 0) AS neu
     )
     SELECT ad.address, ins.height, ins.neu
       FROM ins
       JOIN packed.addr ad ON ad.id = ins.addr_id`,
    [
      rows.map((r) => r.address),
      rows.map((r) => r.txId),
      rows.map((r) => r.height),
    ]
  );
  return ins.rows;
}
