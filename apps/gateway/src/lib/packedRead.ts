/** Page reads from packed when PACKED_READ=1. Live gateway is on. The text branches point at dropped tables. */

export function packedReadEnabled(): boolean {
  const v = process.env.PACKED_READ;
  return v === "1" || v === "true";
}

export function isHex64(id: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(id.trim());
}

/** Boxes projected back to the text column names. `$1` is lower hex. */
export const PACKED_BOX_BY_ID_SQL = `
SELECT encode(b.box_id, 'hex') AS box_id,
       b.value_nano::text AS value_nano,
       s.ergo_tree,
       a.address,
       b.creation_height::text AS creation_height,
       encode(b.creation_tx_id, 'hex') AS creation_tx_id,
       encode(b.spent_tx_id, 'hex') AS spent_tx_id,
       b.spent_height::text AS spent_height,
       b.output_index::text AS output_index,
       b.additional_registers,
       b.gix::text AS gix
  FROM packed.boxes b
  LEFT JOIN packed.addr a ON a.id = b.addr_id
  LEFT JOIN packed.script s ON s.id = b.script_id
 WHERE b.box_id = decode(lower($1), 'hex')`;

export const PACKED_BOXES_BY_IDS_SQL = `
SELECT encode(b.box_id, 'hex') AS box_id,
       b.value_nano::text AS value_nano,
       s.ergo_tree,
       a.address
  FROM packed.boxes b
  LEFT JOIN packed.addr a ON a.id = b.addr_id
  LEFT JOIN packed.script s ON s.id = b.script_id
 WHERE b.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`;

export const PACKED_BOX_IO_SQL = `
SELECT encode(b.box_id, 'hex') AS box_id,
       b.value_nano::text AS value_nano,
       s.ergo_tree,
       a.address,
       b.creation_height::text AS creation_height,
       encode(b.creation_tx_id, 'hex') AS creation_tx_id,
       encode(b.spent_tx_id, 'hex') AS spent_tx_id,
       b.spent_height::text AS spent_height,
       b.output_index::text AS output_index,
       b.additional_registers,
       b.gix::text AS gix
  FROM packed.boxes b
  LEFT JOIN packed.addr a ON a.id = b.addr_id
  LEFT JOIN packed.script s ON s.id = b.script_id`;

export const PACKED_ASSETS_BY_IDS_SQL = `
SELECT encode(box_id, 'hex') AS box_id,
       encode(token_id, 'hex') AS token_id,
       amount::text AS amount
  FROM packed.box_assets
 WHERE box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
 ORDER BY box_id, asset_index NULLS LAST, token_id`;

export const PACKED_TX_HEADS_SQL = `
SELECT encode(t.id, 'hex') AS id,
       t.height::text AS height,
       t.timestamp_ms::text AS timestamp_ms,
       encode(b.id, 'hex') AS block_id
  FROM packed.transactions t
  LEFT JOIN packed.blocks b ON b.height = t.height
 WHERE t.id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`;

export const PACKED_TX_BY_ID_SQL = `
SELECT encode(t.id, 'hex') AS id,
       t.height::text AS height,
       t.timestamp_ms::text AS timestamp_ms,
       t.size::text AS size,
       t.fee::text AS fee,
       t.value_nano::text AS value_nano,
       t.input_count::text AS input_count,
       t.output_count::text AS output_count,
       t.index_in_block::text AS index_in_block,
       t.gix::text AS gix,
       encode(b.id, 'hex') AS block_id
  FROM packed.transactions t
  LEFT JOIN packed.blocks b ON b.height = t.height
 WHERE t.id = decode(lower($1), 'hex')`;

export const PACKED_TX_NEIGHBOR_SQL = `
SELECT
  (SELECT encode(id, 'hex') FROM packed.transactions
    WHERE height = $1 AND index_in_block = $2 LIMIT 1) AS prev_id,
  (SELECT encode(id, 'hex') FROM packed.transactions
    WHERE height = $1 AND index_in_block = $3 LIMIT 1) AS next_id`;

const PACKED_BLOCK_HEADER_COLS = `
       version,
       n_bits::text AS "nBits",
       encode(votes, 'hex') AS votes,
       encode(state_root, 'hex') AS "stateRoot",
       encode(ad_proofs_root, 'hex') AS "adProofsRoot",
       encode(transactions_root, 'hex') AS "transactionsRoot",
       encode(extension_hash, 'hex') AS "extensionHash",
       miner_pk AS "powPk",
       encode(pow_w, 'hex') AS "powW",
       encode(pow_n, 'hex') AS "powN",
       pow_d::text AS "powD"`;

export const PACKED_BLOCK_BY_HEIGHT_SQL = `
SELECT encode(id, 'hex') AS id, height, timestamp_ms AS timestamp,
       COALESCE(size, 0) AS size, tx_count AS "txCount",
       encode(parent_id, 'hex') AS "parentId",
       miner_address AS "minerAddress", difficulty,
       COALESCE(fee_nano, 0)::text AS "feeNano",
       COALESCE(value_nano, 0)::text AS "valueNano",
       ${PACKED_BLOCK_HEADER_COLS}
  FROM packed.blocks
 WHERE height = $1
 LIMIT 1`;

export const PACKED_BLOCK_BY_ID_SQL = `
SELECT encode(id, 'hex') AS id, height, timestamp_ms AS timestamp,
       COALESCE(size, 0) AS size, tx_count AS "txCount",
       encode(parent_id, 'hex') AS "parentId",
       miner_address AS "minerAddress", difficulty,
       COALESCE(fee_nano, 0)::text AS "feeNano",
       COALESCE(value_nano, 0)::text AS "valueNano",
       ${PACKED_BLOCK_HEADER_COLS}
  FROM packed.blocks
 WHERE id = decode(lower($1), 'hex')
 LIMIT 1`;

export const PACKED_BLOCK_ID_SQL = `
SELECT encode(id, 'hex') AS id, timestamp_ms AS timestamp
  FROM packed.blocks WHERE height = $1 LIMIT 1`;

export const PACKED_TXS_AT_HEIGHT_SQL = `
SELECT encode(id, 'hex') AS id, index_in_block, height, timestamp_ms, size, fee,
       input_count, output_count, value_nano, shape, protocol
  FROM packed.transactions
 WHERE height = $1
 ORDER BY index_in_block ASC NULLS LAST, id
 LIMIT $2 OFFSET $3`;

/** Swap check against text defi.trades. Packed keys are bytea. */
export const PACKED_TOKEN_IS_SWAP_SQL = `EXISTS (
  SELECT 1 FROM defi.trades tr
  WHERE tr.tx_id = encode(m.tx_id, 'hex')
    AND tr.token_id = encode(m.token_id, 'hex')
    AND tr.side IN ('buy', 'sell')
)`;
