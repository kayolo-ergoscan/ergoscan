import type pg from "pg";
import { packedTablespace } from "./flags.js";

type Queryable = { query: pg.Pool["query"] };

let ready: Promise<void> | null = null;

function tablespaceClause(): string {
  const name = packedTablespace();
  return name ? ` TABLESPACE ${name}` : "";
}

// Primary keys stay in the database default tablespace. Inline PRIMARY KEY
// ignores the table tablespace, and the volume is slow for those random pages.

/**
 * Packed chain. No foreign keys yet: those are added NOT VALID after the copy.
 * Dictionaries are not deleted on unwind. gix counters are not touched here.
 */
export function packedSchemaSql(): string {
  const ts = tablespaceClause();
  return `
CREATE SCHEMA IF NOT EXISTS packed;

CREATE OR REPLACE FUNCTION packed.hex32(t text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
BEGIN
  IF t IS NULL OR btrim(t) = '' THEN
    RETURN NULL;
  END IF;
  IF t !~ '^[0-9a-fA-F]{64}$' THEN
    RETURN NULL;
  END IF;
  RETURN decode(lower(t), 'hex');
END
$fn$;

CREATE TABLE IF NOT EXISTS packed.addr (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address  text NOT NULL,
  addr_md5 text NOT NULL
)${ts};
CREATE UNIQUE INDEX IF NOT EXISTS packed_addr_md5_uk ON packed.addr (addr_md5)${ts};

CREATE TABLE IF NOT EXISTS packed.script (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ergo_tree text NOT NULL,
  tree_md5  text NOT NULL,
  template_hash bytea
)${ts};
ALTER TABLE packed.script ADD COLUMN IF NOT EXISTS template_hash bytea;
CREATE UNIQUE INDEX IF NOT EXISTS packed_script_md5_uk ON packed.script (tree_md5)${ts};

-- Narrow template index. Hashes live on script; this table is the paged read.
-- Built by scripts/fill-script-template-hash.ts. Boot does not index 50M rows.
CREATE TABLE IF NOT EXISTS packed.box_template (
  box_id bytea PRIMARY KEY,
  template_hash bytea NOT NULL,
  creation_height bigint NOT NULL
)${ts};

CREATE TABLE IF NOT EXISTS packed.blocks (
  height         bigint PRIMARY KEY,
  id             bytea NOT NULL UNIQUE,
  parent_id      bytea,
  timestamp_ms   bigint NOT NULL,
  size           int,
  tx_count       int,
  difficulty     text,
  miner_pk       text,
  miner_address  text,
  fee_nano       numeric NOT NULL DEFAULT 0,
  value_nano     numeric NOT NULL DEFAULT 0,
  version            smallint,
  n_bits             bigint,
  votes              bytea,
  state_root         bytea,
  ad_proofs_root     bytea,
  transactions_root  bytea,
  extension_hash     bytea,
  pow_w              bytea,
  pow_n              bytea,
  pow_d              numeric,
  extension          bytea,
  ad_proofs          bytea
)${ts};
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS version smallint;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS n_bits bigint;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS votes bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS state_root bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS ad_proofs_root bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS transactions_root bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS extension_hash bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS pow_w bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS pow_n bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS pow_d numeric;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS extension bytea;
ALTER TABLE packed.blocks ADD COLUMN IF NOT EXISTS ad_proofs bytea;
ALTER TABLE packed.tx_inputs ADD COLUMN IF NOT EXISTS proof_bytes bytea;

CREATE TABLE IF NOT EXISTS packed.transactions (
  id             bytea PRIMARY KEY,
  height         bigint NOT NULL,
  timestamp_ms   bigint,
  size           int,
  fee            bigint,
  index_in_block int,
  input_count    int,
  output_count   int,
  value_nano     numeric,
  shape          text,
  protocol       text,
  rule_id        text,
  rules_version  int,
  gix            bigint
)${ts};
CREATE TABLE IF NOT EXISTS packed.boxes (
  box_id               bytea PRIMARY KEY,
  creation_height      bigint,
  value_nano           bigint NOT NULL DEFAULT 0,
  addr_id              bigint,
  script_id            bigint,
  creation_tx_id       bytea,
  spent_tx_id          bytea,
  spent_height         bigint,
  output_index         int,
  additional_registers jsonb,
  gix                  bigint,
  tree_bytes           integer
)${ts};
CREATE TABLE IF NOT EXISTS packed.tx_inputs (
  box_id       bytea PRIMARY KEY,
  spent_tx_id  bytea NOT NULL,
  spent_height bigint NOT NULL
)${ts};
CREATE TABLE IF NOT EXISTS packed.box_assets (
  box_id   bytea NOT NULL,
  token_id bytea NOT NULL,
  amount   numeric NOT NULL,
  PRIMARY KEY (box_id, token_id))${ts};
ALTER TABLE packed.box_assets ADD COLUMN IF NOT EXISTS asset_index smallint;
CREATE TABLE IF NOT EXISTS packed.address_tx (
  addr_id bigint NOT NULL,
  tx_id   bytea NOT NULL,
  height  bigint,
  PRIMARY KEY (addr_id, tx_id))${ts};
CREATE TABLE IF NOT EXISTS packed.token_tx_seen (
  token_id bytea NOT NULL,
  tx_id    bytea NOT NULL,
  height   bigint,
  PRIMARY KEY (token_id, tx_id))${ts};
CREATE TABLE IF NOT EXISTS packed.token_tx_move (
  token_id   bytea NOT NULL,
  tx_id      bytea NOT NULL,
  height     bigint,
  created    numeric NOT NULL DEFAULT 0,
  spent      numeric NOT NULL DEFAULT 0,
  moved      numeric NOT NULL DEFAULT 0,
  from_addrs text[] NOT NULL DEFAULT '{}',
  to_addrs   text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (token_id, tx_id))${ts};
`;
}

/** Non-unique indexes. Built after the historical heap, not on the copy path. */
export function packedSecondaryIndexSql(): string {
  const ts = tablespaceClause();
  return `
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_tx_height_idx ON packed.transactions (height)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_creation_tx_idx ON packed.boxes (creation_tx_id)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_creation_height_idx
  ON packed.boxes (creation_height, box_id) WHERE creation_height IS NOT NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_unspent_creation_idx
  ON packed.boxes (creation_height, box_id) WHERE spent_tx_id IS NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_unspent_id_idx
  ON packed.boxes (box_id) WHERE spent_tx_id IS NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_unspent_addr_idx
  ON packed.boxes (addr_id, creation_height DESC, box_id DESC)
  WHERE spent_tx_id IS NULL AND creation_height IS NOT NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_script_template_idx
  ON packed.script (template_hash)
  WHERE octet_length(template_hash) = 32${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_script_template_missing_idx
  ON packed.script (id)
  WHERE template_hash IS NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_box_template_hash_idx
  ON packed.box_template (template_hash, creation_height DESC, box_id DESC)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_script_idx
  ON packed.boxes (script_id, creation_height DESC, box_id DESC)
  WHERE script_id IS NOT NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_unspent_script_idx
  ON packed.boxes (script_id, creation_height DESC, box_id DESC)
  WHERE spent_tx_id IS NULL AND script_id IS NOT NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_unspent_rent_idx
  ON packed.boxes (creation_height) INCLUDE (value_nano, tree_bytes)
  WHERE spent_tx_id IS NULL AND creation_height IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_unspent_addr_value_idx
  ON packed.boxes (addr_id) INCLUDE (value_nano)
  WHERE spent_tx_id IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_addr_idx
  ON packed.boxes (addr_id, creation_height DESC, box_id DESC)
  WHERE creation_height IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_blocks_timestamp_idx
  ON packed.blocks (timestamp_ms);
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_tx_timestamp_idx
  ON packed.transactions (timestamp_ms);
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_spent_height_idx ON packed.boxes (spent_height)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_boxes_spent_tx_idx ON packed.boxes (spent_tx_id)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_address_tx_addr_height_idx
  ON packed.address_tx (addr_id, height DESC, tx_id)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_address_tx_tx_id_idx
  ON packed.address_tx (tx_id)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_tx_inputs_spent_height_idx ON packed.tx_inputs (spent_height)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_box_assets_token_idx ON packed.box_assets (token_id)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_box_assets_nft_idx
  ON packed.box_assets (token_id, box_id) WHERE amount = 1;
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_address_tx_height_idx ON packed.address_tx (height)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_token_tx_move_token_height_idx
  ON packed.token_tx_move (token_id, height DESC NULLS LAST, tx_id DESC)
  WHERE height IS NOT NULL${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_token_tx_seen_tx_idx ON packed.token_tx_seen (tx_id)${ts};
CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_token_tx_move_tx_idx ON packed.token_tx_move (tx_id)${ts};
`;
}

/** One row per Lithos-mined block. Ids are bytea. Addresses and LIT amounts are not. */
export function lithosFindSchemaSql(): string {
  const ts = tablespaceClause();
  return `
CREATE TABLE IF NOT EXISTS packed.lithos_find (
  height           bigint PRIMARY KEY,
  block_id         bytea NOT NULL,
  tx_id            bytea NOT NULL,
  finder_address   text NOT NULL,
  finder_lit       numeric NOT NULL,
  finder_nano      numeric NOT NULL,
  lender_address   text NOT NULL,
  permit_lit       numeric NOT NULL,
  holding_address  text NOT NULL,
  holding_lit      numeric NOT NULL,
  team_lit         numeric NOT NULL DEFAULT 0,
  investor_lit     numeric NOT NULL DEFAULT 0,
  auditor_lit      numeric NOT NULL DEFAULT 0
)${ts};
`;
}

export async function ensurePackedSchema(db: Queryable): Promise<void> {
  if (!ready) {
    ready = db
      .query(packedSchemaSql() + lithosFindSchemaSql())
      .then(() => undefined)
      .catch((err: unknown) => {
        ready = null;
        throw err;
      });
  }
  await ready;
}

/** Autocommit. CREATE INDEX CONCURRENTLY cannot run inside the copy transaction. */
export async function ensurePackedSecondaryIndexes(db: Queryable): Promise<void> {
  await ensurePackedSchema(db);
  const statements = packedSecondaryIndexSql()
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sql of statements) {
    await db.query(sql);
  }
}
