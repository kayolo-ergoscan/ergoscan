/**
 * Token holders / txs: increment on indexHeight, catch-up seed for the
 * already-indexed window. Catalog KPIs are unique addresses and unique txs
 * (AdaStat), not SUM(tokens.holders).
 *
 * `tokens.tx_count` is the #txs tape: a row in token_tx_move that is not a
 * mint, a burn, or a swap. A box rewrite that carries the token unchanged
 * is token_tx_seen only and does not move this counter.
 *
 * Seed window is [minHeight, tip] captured at first catch-up tick so deepen
 * (lower) and new tip (higher) never overlap the seed inserts.
 */
import type pg from "pg";
import { capStatements, releaseCapped } from "./db.js";
import { packedWriteEnabled, textChainBoxesEnabled, textChainHeadersEnabled } from "./packed/flags.js";

type Queryable = { query: pg.Pool["query"] };

/** Same cap as address_summary btree rows. */
const ADDRESS_MAX = 2000;

const SEED_BOXES = Math.max(
  20,
  Math.min(2000, Number(process.env.TOKEN_SEED_BOXES || 80))
);

const BALANCES_SQL = `
CREATE TABLE IF NOT EXISTS token_balances (
  token_id TEXT NOT NULL,
  address  TEXT NOT NULL,
  amount   NUMERIC NOT NULL DEFAULT 0,
  first_height BIGINT,
  last_height BIGINT,
  PRIMARY KEY (token_id, address)
)
`;
const BALANCES_FIRST_HEIGHT_SQL = `
ALTER TABLE token_balances ADD COLUMN IF NOT EXISTS first_height BIGINT
`;
const BALANCES_LAST_HEIGHT_SQL = `
ALTER TABLE token_balances ADD COLUMN IF NOT EXISTS last_height BIGINT
`;
const BALANCES_TX_COUNT_SQL = `
ALTER TABLE token_balances ADD COLUMN IF NOT EXISTS tx_count INT
`;
const BALANCES_LAST_TX_SQL = `
ALTER TABLE token_balances ADD COLUMN IF NOT EXISTS last_tx_id TEXT
`;

const BALANCES_ADDR_IDX_SQL = `
CREATE INDEX IF NOT EXISTS token_balances_addr_idx
  ON token_balances (address)
  WHERE amount > 0
`;

const BALANCES_TOKEN_AMOUNT_IDX_SQL = `
CREATE INDEX IF NOT EXISTS token_balances_token_amount_idx
  ON token_balances (token_id, amount DESC, address)
  WHERE amount > 0
`;

const TX_SEEN_SQL = `
CREATE TABLE IF NOT EXISTS token_tx_seen (
  token_id TEXT NOT NULL,
  tx_id    TEXT NOT NULL,
  height   BIGINT,
  PRIMARY KEY (token_id, tx_id)
)
`;
const TX_SEEN_HEIGHT_SQL = `
ALTER TABLE token_tx_seen ADD COLUMN IF NOT EXISTS height BIGINT
`;
const TX_SEEN_HEIGHT_IDX_SQL = `
CREATE INDEX IF NOT EXISTS token_tx_seen_height_idx
  ON token_tx_seen (token_id, height DESC NULLS LAST, tx_id DESC)
`;
const TX_SEEN_HEIGHT_FN_SQL = `
CREATE OR REPLACE FUNCTION token_tx_seen_fill_height()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.height IS NULL AND NEW.tx_id IS NOT NULL THEN
    SELECT t.height INTO NEW.height FROM transactions t WHERE t.id = NEW.tx_id;
  END IF;
  RETURN NEW;
END;
$$
`;
const TX_SEEN_HEIGHT_TG_SQL = `
DO $tg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'token_tx_seen_height_tg') THEN
    CREATE TRIGGER token_tx_seen_height_tg
    BEFORE INSERT OR UPDATE OF tx_id ON token_tx_seen
    FOR EACH ROW
    EXECUTE FUNCTION token_tx_seen_fill_height();
  END IF;
END
$tg$;
`;

const TX_MOVE_SQL = `
CREATE TABLE IF NOT EXISTS token_tx_move (
  token_id   TEXT NOT NULL,
  tx_id      TEXT NOT NULL,
  height     BIGINT,
  created    NUMERIC NOT NULL DEFAULT 0,
  spent      NUMERIC NOT NULL DEFAULT 0,
  moved      NUMERIC NOT NULL DEFAULT 0,
  from_addrs TEXT[] NOT NULL DEFAULT '{}',
  to_addrs   TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (token_id, tx_id),
  FOREIGN KEY (token_id, tx_id) REFERENCES token_tx_seen (token_id, tx_id) ON DELETE CASCADE
)
`;
const TX_MOVE_SYNC_SQL = `
CREATE TABLE IF NOT EXISTS token_tx_move_sync (
  token_id  TEXT PRIMARY KEY,
  filled_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
`;
const TX_MOVE_FN_SQL = `
CREATE OR REPLACE FUNCTION token_tx_move_upsert(p_token text, p_tx text, p_height bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_created numeric := 0;
  v_spent numeric := 0;
  v_moved numeric := 0;
  v_from text[];
  v_to text[];
  v_height bigint;
BEGIN
  IF to_regclass('packed.boxes') IS NOT NULL THEN
    WITH created_by AS (
      SELECT ad.address, SUM(a.amount) AS got
      FROM packed.boxes b
      JOIN packed.box_assets a ON a.box_id = b.box_id AND a.token_id = packed.hex32(p_token)
      JOIN packed.addr ad ON ad.id = b.addr_id
      WHERE b.creation_tx_id = packed.hex32(p_tx) AND ad.address IS NOT NULL
      GROUP BY 1
    ),
    spent_by AS (
      SELECT ad.address, SUM(a.amount) AS gave
      FROM packed.boxes b
      JOIN packed.box_assets a ON a.box_id = b.box_id AND a.token_id = packed.hex32(p_token)
      JOIN packed.addr ad ON ad.id = b.addr_id
      WHERE b.spent_tx_id = packed.hex32(p_tx) AND ad.address IS NOT NULL
      GROUP BY 1
    ),
    nets AS (
      SELECT COALESCE(c.address, s.address) AS address,
             COALESCE(c.got, 0) - COALESCE(s.gave, 0) AS net
      FROM created_by c
      FULL JOIN spent_by s ON s.address = c.address
    )
    SELECT
      COALESCE((SELECT SUM(got) FROM created_by), 0),
      COALESCE((SELECT SUM(gave) FROM spent_by), 0),
      COALESCE((SELECT SUM(net) FROM nets WHERE net > 0), 0),
      COALESCE(ARRAY(SELECT n.address FROM nets n WHERE n.net < 0 ORDER BY n.address LIMIT 8), ARRAY[]::text[]),
      COALESCE(ARRAY(
        SELECT n.address FROM nets n
        WHERE n.net > 0
          AND n.address <> '2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe'
        ORDER BY n.address LIMIT 8
      ), ARRAY[]::text[])
    INTO v_created, v_spent, v_moved, v_from, v_to;
  ELSE
    WITH created_by AS (
      SELECT b.address, SUM(a.amount) AS got
      FROM boxes b
      JOIN box_assets a ON a.box_id = b.box_id AND a.token_id = p_token
      WHERE b.creation_tx_id = p_tx AND b.address IS NOT NULL
      GROUP BY 1
    ),
    spent_by AS (
      SELECT b.address, SUM(a.amount) AS gave
      FROM boxes b
      JOIN box_assets a ON a.box_id = b.box_id AND a.token_id = p_token
      WHERE b.spent_tx_id = p_tx AND b.address IS NOT NULL
      GROUP BY 1
    ),
    nets AS (
      SELECT COALESCE(c.address, s.address) AS address,
             COALESCE(c.got, 0) - COALESCE(s.gave, 0) AS net
      FROM created_by c
      FULL JOIN spent_by s ON s.address = c.address
    )
    SELECT
      COALESCE((SELECT SUM(got) FROM created_by), 0),
      COALESCE((SELECT SUM(gave) FROM spent_by), 0),
      COALESCE((SELECT SUM(net) FROM nets WHERE net > 0), 0),
      COALESCE(ARRAY(SELECT n.address FROM nets n WHERE n.net < 0 ORDER BY n.address LIMIT 8), ARRAY[]::text[]),
      COALESCE(ARRAY(
        SELECT n.address FROM nets n
        WHERE n.net > 0
          AND n.address <> '2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe'
        ORDER BY n.address LIMIT 8
      ), ARRAY[]::text[])
    INTO v_created, v_spent, v_moved, v_from, v_to;
  END IF;

  IF v_moved = 0 AND v_created = v_spent AND cardinality(v_from) = 0 AND cardinality(v_to) = 0 THEN
    RETURN;
  END IF;

  IF to_regclass('packed.transactions') IS NOT NULL THEN
    v_height := COALESCE(
      p_height,
      (SELECT t.height FROM packed.transactions t WHERE t.id = packed.hex32(p_tx))
    );
  ELSIF to_regclass('public.transactions') IS NOT NULL THEN
    v_height := COALESCE(p_height, (SELECT height FROM transactions WHERE id = p_tx));
  ELSE
    v_height := p_height;
  END IF;
  IF to_regclass('packed.token_tx_move') IS NOT NULL THEN
    IF packed.hex32(p_token) IS NULL OR packed.hex32(p_tx) IS NULL THEN
      RETURN;
    END IF;
    INSERT INTO packed.token_tx_move (token_id, tx_id, height, created, spent, moved, from_addrs, to_addrs)
    VALUES (packed.hex32(p_token), packed.hex32(p_tx), v_height, v_created, v_spent, v_moved, v_from, v_to)
    ON CONFLICT (token_id, tx_id) DO UPDATE SET
      height = COALESCE(EXCLUDED.height, packed.token_tx_move.height),
      created = EXCLUDED.created,
      spent = EXCLUDED.spent,
      moved = EXCLUDED.moved,
      from_addrs = EXCLUDED.from_addrs,
      to_addrs = EXCLUDED.to_addrs;
  ELSE
    INSERT INTO token_tx_move (token_id, tx_id, height, created, spent, moved, from_addrs, to_addrs)
    VALUES (p_token, p_tx, v_height, v_created, v_spent, v_moved, v_from, v_to)
    ON CONFLICT (token_id, tx_id) DO UPDATE SET
      height = COALESCE(EXCLUDED.height, token_tx_move.height),
      created = EXCLUDED.created,
      spent = EXCLUDED.spent,
      moved = EXCLUDED.moved,
      from_addrs = EXCLUDED.from_addrs,
      to_addrs = EXCLUDED.to_addrs;
  END IF;
END;
$$
`;
const TX_MOVE_FILL_SQL = `
CREATE OR REPLACE FUNCTION token_tx_move_fill()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM token_tx_move_upsert(NEW.token_id, NEW.tx_id, NEW.height);
  RETURN NEW;
END;
$$
`;
const TX_MOVE_TG_SQL = `
DO $tg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'token_tx_move_tg') THEN
    CREATE TRIGGER token_tx_move_tg
    AFTER INSERT ON token_tx_seen
    FOR EACH ROW
    EXECUTE FUNCTION token_tx_move_fill();
  END IF;
END
$tg$;
`;

const TX_IDS_SQL = `
CREATE TABLE IF NOT EXISTS token_tx_ids (
  tx_id TEXT PRIMARY KEY
)
`;

const CATALOG_STATS_SQL = `
CREATE TABLE IF NOT EXISTS token_catalog_stats (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  unique_holders  INT NOT NULL DEFAULT 0,
  unique_txs      BIGINT NOT NULL DEFAULT 0,
  seed_phase      TEXT NOT NULL DEFAULT 'balances',
  seed_lo         BIGINT,
  seed_hi         BIGINT,
  seed_height     BIGINT NOT NULL DEFAULT 0,
  seed_box_id     TEXT NOT NULL DEFAULT ''
)
`;

const CATALOG_ROW_SQL = `
INSERT INTO token_catalog_stats (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING
`;

export async function ensureTokenStatsSchema(db: Queryable): Promise<void> {
  await db.query(BALANCES_SQL);
  await db.query(BALANCES_FIRST_HEIGHT_SQL);
  await db.query(BALANCES_LAST_HEIGHT_SQL);
  await db.query(BALANCES_TX_COUNT_SQL);
  await db.query(BALANCES_LAST_TX_SQL);
  await db.query(BALANCES_ADDR_IDX_SQL);
  await db.query(BALANCES_TOKEN_AMOUNT_IDX_SQL);
  const packedTape = await db.query<{ c: string | null }>(
    `SELECT to_regclass('packed.token_tx_move')::text AS c`
  );
  if (!packedTape.rows[0]?.c) {
    await db.query(TX_SEEN_SQL);
    await db.query(TX_SEEN_HEIGHT_SQL);
    await db.query(TX_SEEN_HEIGHT_FN_SQL);
    await db.query(TX_SEEN_HEIGHT_TG_SQL);
    await db.query(TX_MOVE_SQL);
    await db.query(TX_MOVE_SYNC_SQL);
    await db.query(TX_MOVE_TG_SQL);
  }
  await db.query(TX_MOVE_FN_SQL);
  await db.query(TX_MOVE_FILL_SQL);
  await db.query(TX_IDS_SQL);
  await db.query(CATALOG_STATS_SQL);
  await db.query(CATALOG_ROW_SQL);
}

const UTXO_SYNC_PAGE = 20;
const UTXO_SYNC_FAT_BOXES = 4000;

/**
 * Replace one address's token_balances from live unspent boxes (idempotent).
 * Also writes address_summary.token_count = DISTINCT ledger rows.
 */
const BOX_ADDR_BTREE = 200;
const HEIGHT_FILL_PAGE = 8;

/** Tip credit/debit rule for this address. Null height leaves the row as-is. */
export function mergeActivityHeights(
  prevFirst: number | null,
  prevLast: number | null,
  height: number | null,
  kind: "credit" | "debit"
): { first: number | null; last: number | null } {
  if (height == null || !Number.isFinite(height) || height < 0) {
    return { first: prevFirst, last: prevLast };
  }
  const h = Math.trunc(height);
  const last = prevLast == null ? h : Math.max(prevLast, h);
  if (kind === "debit") return { first: prevFirst, last };
  return { first: prevFirst == null ? h : prevFirst, last };
}

/** After token_balances_tx_count_v1, tip +1. During fill, only stamp last_tx_id. */
let holderTxCountLive = false;

export function enableHolderTxCountLive(): void {
  holderTxCountLive = true;
}

export async function loadHolderTxCountLive(db: Queryable): Promise<void> {
  const r = await db.query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = 'token_balances_tx_count_v1'`
  );
  holderTxCountLive = Boolean(r.rows[0]?.value);
}

export function holderTxCountLiveEnabled(): boolean {
  return holderTxCountLive;
}

async function bumpHolderTokenTxs(
  client: Queryable,
  pairs: { tokenId: string; address: string | null }[],
  txId: string,
  height: number | null | undefined,
  dir: 1 | -1
): Promise<void> {
  const uniq = new Map<string, { tokenId: string; address: string }>();
  for (const p of pairs) {
    if (!p.tokenId || !okAddr(p.address)) continue;
    uniq.set(`${p.tokenId}\0${p.address}`, { tokenId: p.tokenId, address: p.address });
  }
  const list = [...uniq.values()];
  if (!list.length || !txId) return;
  const h = height != null && Number.isFinite(height) ? Math.trunc(height) : null;
  const tokens = list.map((p) => p.tokenId);
  const addrs = list.map((p) => p.address);
  if (dir === 1) {
    await client.query(
      `UPDATE token_balances b
          SET last_tx_id = $3,
              first_height = CASE
                WHEN $4::bigint IS NULL THEN b.first_height
                ELSE LEAST(COALESCE(b.first_height, $4::bigint), $4::bigint)
              END,
              last_height = CASE
                WHEN $4::bigint IS NULL THEN b.last_height
                ELSE GREATEST(COALESCE(b.last_height, $4::bigint), $4::bigint)
              END,
              tx_count = CASE
                WHEN NOT $5::boolean THEN b.tx_count
                WHEN b.last_tx_id IS DISTINCT FROM $3 THEN COALESCE(b.tx_count, 0) + 1
                ELSE COALESCE(b.tx_count, 0)
              END
         FROM unnest($1::text[], $2::text[]) AS v(token_id, address)
        WHERE b.token_id = v.token_id AND b.address = v.address`,
      [tokens, addrs, txId, h, holderTxCountLive]
    );
    return;
  }
  if (!holderTxCountLive) return;
  await client.query(
    `UPDATE token_balances b
        SET tx_count = CASE
              WHEN b.tx_count IS NULL THEN NULL
              ELSE GREATEST(0, b.tx_count - 1)
            END,
            last_tx_id = CASE WHEN b.last_tx_id = $3 THEN NULL ELSE b.last_tx_id END
       FROM unnest($1::text[], $2::text[]) AS v(token_id, address)
      WHERE b.token_id = v.token_id AND b.address = v.address`,
    [tokens, addrs, txId]
  );
}

function unspentHeightFillSql(short: boolean): string {
  if (packedWriteEnabled() && !textChainBoxesEnabled()) {
    return `UPDATE token_balances tb
       SET first_height = COALESCE(tb.first_height, s.first_h),
           last_height = COALESCE(tb.last_height, s.last_h)
      FROM (
        SELECT encode(ba.token_id, 'hex') AS token_id,
               MIN(b.creation_height) AS first_h,
               MAX(b.creation_height) AS last_h
          FROM packed.addr ad
          JOIN packed.boxes b ON b.addr_id = ad.id AND b.spent_tx_id IS NULL
          JOIN packed.box_assets ba ON ba.box_id = b.box_id
         WHERE ad.addr_md5 = md5($1) AND ad.address = $1
         GROUP BY ba.token_id
      ) s
     WHERE tb.address = $1
       AND tb.token_id = s.token_id
       AND (tb.first_height IS NULL OR tb.last_height IS NULL)`;
  }
  const where = short
    ? `b.spent_tx_id IS NULL AND b.address = $1 AND length(b.address) <= ${BOX_ADDR_BTREE}`
    : `b.spent_tx_id IS NULL AND length(b.address) > ${BOX_ADDR_BTREE} AND md5(b.address) = md5($1) AND b.address = $1`;
  return `UPDATE token_balances tb
     SET first_height = COALESCE(tb.first_height, s.first_h),
         last_height = COALESCE(tb.last_height, s.last_h)
    FROM (
      SELECT ba.token_id,
             MIN(b.creation_height) AS first_h,
             MAX(b.creation_height) AS last_h
        FROM boxes b
        JOIN box_assets ba ON ba.box_id = b.box_id
       WHERE ${where}
       GROUP BY ba.token_id
    ) s
   WHERE tb.address = $1
     AND tb.token_id = s.token_id
     AND (tb.first_height IS NULL OR tb.last_height IS NULL)`;
}

function unspentTokenTruthSql(short: boolean): string {
  if (packedWriteEnabled() && !textChainBoxesEnabled()) {
    return `WITH truth AS (
       SELECT encode(ba.token_id, 'hex') AS token_id,
              SUM(ba.amount) AS amount,
              MIN(b.creation_height) AS first_height,
              MAX(b.creation_height) AS last_height
         FROM packed.addr ad
         JOIN packed.boxes b ON b.addr_id = ad.id AND b.spent_tx_id IS NULL
         JOIN packed.box_assets ba ON ba.box_id = b.box_id
        WHERE ad.addr_md5 = md5($1) AND ad.address = $1
        GROUP BY ba.token_id
     ),
     upserted AS (
       INSERT INTO token_balances (token_id, address, amount, first_height, last_height)
       SELECT token_id, $1, amount, first_height, last_height FROM truth
       ON CONFLICT (token_id, address) DO UPDATE
         SET amount = EXCLUDED.amount,
             first_height = CASE
               WHEN token_balances.first_height IS NULL THEN EXCLUDED.first_height
               WHEN EXCLUDED.first_height IS NULL THEN token_balances.first_height
               ELSE LEAST(token_balances.first_height, EXCLUDED.first_height)
             END,
             last_height = CASE
               WHEN token_balances.last_height IS NULL THEN EXCLUDED.last_height
               WHEN EXCLUDED.last_height IS NULL THEN token_balances.last_height
               ELSE GREATEST(token_balances.last_height, EXCLUDED.last_height)
             END
       RETURNING token_id
     ),
     gone AS (
       DELETE FROM token_balances t
        WHERE t.address = $1
          AND NOT EXISTS (SELECT 1 FROM truth x WHERE x.token_id = t.token_id)
       RETURNING token_id
     )
     SELECT COUNT(*)::int::text AS n FROM truth`;
  }
  const where = short
    ? `b.spent_tx_id IS NULL AND b.address = $1 AND length(b.address) <= ${BOX_ADDR_BTREE}`
    : `b.spent_tx_id IS NULL AND length(b.address) > ${BOX_ADDR_BTREE} AND md5(b.address) = md5($1) AND b.address = $1`;
  return `WITH truth AS (
       SELECT ba.token_id,
              SUM(ba.amount) AS amount,
              MIN(b.creation_height) AS first_height,
              MAX(b.creation_height) AS last_height
         FROM boxes b
         JOIN box_assets ba ON ba.box_id = b.box_id
        WHERE ${where}
        GROUP BY ba.token_id
     ),
     upserted AS (
       INSERT INTO token_balances (token_id, address, amount, first_height, last_height)
       SELECT token_id, $1, amount, first_height, last_height FROM truth
       ON CONFLICT (token_id, address) DO UPDATE
         SET amount = EXCLUDED.amount,
             first_height = CASE
               WHEN token_balances.first_height IS NULL THEN EXCLUDED.first_height
               WHEN EXCLUDED.first_height IS NULL THEN token_balances.first_height
               ELSE LEAST(token_balances.first_height, EXCLUDED.first_height)
             END,
             last_height = CASE
               WHEN token_balances.last_height IS NULL THEN EXCLUDED.last_height
               WHEN EXCLUDED.last_height IS NULL THEN token_balances.last_height
               ELSE GREATEST(token_balances.last_height, EXCLUDED.last_height)
             END
       RETURNING token_id
     ),
     gone AS (
       DELETE FROM token_balances t
        WHERE t.address = $1
          AND NOT EXISTS (SELECT 1 FROM truth x WHERE x.token_id = t.token_id)
       RETURNING token_id
     )
     SELECT COUNT(*)::int::text AS n FROM truth`;
}

export async function replaceTokenBalancesForAddress(
  db: Queryable,
  address: string
): Promise<number> {
  if (!okAddr(address)) return 0;
  const r = await db.query<{ n: string }>(
    unspentTokenTruthSql(address.length <= BOX_ADDR_BTREE),
    [address]
  );
  const n = Number(r.rows[0]?.n || 0);
  await db.query(
    `UPDATE address_summary
        SET token_count = $2, updated_at = now()
      WHERE address = $1`,
    [address, n]
  );
  return n;
}

/** One page of addresses that still have unspent boxes. Empty = UTXO sync done. */
export async function syncTokenBalancesUtxoPage(
  db: Queryable,
  afterAddress: string
): Promise<{ last: string | null; rows: number; done: boolean; slow: boolean }> {
  const fat = await db.query<{ address: string; box_count: string }>(
    `SELECT address, box_count::text
       FROM address_summary
      WHERE box_count >= $1
        AND length(address) <= $2
        AND token_count = 0
        AND updated_at < now() - interval '15 minutes'
      ORDER BY nanoerg DESC
      LIMIT 1`,
    [UTXO_SYNC_FAT_BOXES, ADDRESS_MAX]
  );
  if (fat.rows[0]) {
    const row = fat.rows[0];
    try {
      await replaceTokenBalancesForAddress(db, row.address);
    } catch (e) {
      console.warn(`[indexer] token_balances UTXO fat ${row.address.slice(0, 12)}…`, String(e));
      await db.query(`UPDATE address_summary SET updated_at = now() WHERE address = $1`, [
        row.address,
      ]);
    }
    return { last: afterAddress, rows: 1, done: false, slow: true };
  }
  const page = await db.query<{ address: string; box_count: string }>(
    `SELECT address, box_count::text
       FROM address_summary
      WHERE box_count > 0
        AND length(address) <= $1
        AND address > $2
      ORDER BY address
      LIMIT $3`,
    [ADDRESS_MAX, afterAddress, UTXO_SYNC_PAGE]
  );
  if (!page.rows.length) return { last: afterAddress || null, rows: 0, done: true, slow: false };
  let last = afterAddress;
  let n = 0;
  let slow = false;
  for (const row of page.rows) {
    try {
      await replaceTokenBalancesForAddress(db, row.address);
    } catch (e) {
      console.warn(`[indexer] token_balances UTXO ${row.address.slice(0, 12)}…`, String(e));
    }
    last = row.address;
    n += 1;
    if (Number(row.box_count) >= UTXO_SYNC_FAT_BOXES) {
      slow = true;
      break;
    }
  }
  return { last, rows: n, done: false, slow };
}

function okAddr(address: string | null | undefined): address is string {
  return !!address && address.length <= ADDRESS_MAX;
}

/**
 * One-shot seed: fill NULL first/last from live unspent boxes.
 * Does not change amount. Does not delete. Not the UTXO walker.
 */
export async function fillTokenBalanceHeightsForAddress(
  db: Queryable,
  address: string
): Promise<void> {
  if (!okAddr(address)) return;
  await db.query(unspentHeightFillSql(address.length <= BOX_ADDR_BTREE), [address]);
}

/** Addresses that still need a height seed. Empty page = fill done. */
export async function syncTokenBalanceHeightsPage(
  db: Queryable,
  afterAddress: string
): Promise<{ last: string | null; rows: number; done: boolean }> {
  const page = await db.query<{ address: string }>(
    `SELECT DISTINCT address
       FROM token_balances
      WHERE amount > 0
        AND length(address) <= $1
        AND address > $2
        AND (first_height IS NULL OR last_height IS NULL)
      ORDER BY address
      LIMIT $3`,
    [ADDRESS_MAX, afterAddress, HEIGHT_FILL_PAGE]
  );
  if (!page.rows.length) return { last: afterAddress || null, rows: 0, done: true };
  let last = afterAddress;
  let n = 0;
  for (const row of page.rows) {
    try {
      await fillTokenBalanceHeightsForAddress(db, row.address);
    } catch (e) {
      console.warn(`[indexer] token_balances heights ${row.address.slice(0, 12)}…`, String(e));
    }
    last = row.address;
    n += 1;
  }
  return { last, rows: n, done: false };
}

const TX_COUNT_FILL_PAGE = 40;
const TX_COUNT_SOLO_LEN = 200;
const TX_COUNT_SOLO_TXS = 25_000;

export function encodeTokenBalanceTxCountCursor(tokenId: string, address: string): string {
  return `${tokenId}\t${address}`;
}

export function parseTokenBalanceTxCountCursor(raw: string): { tokenId: string; address: string } {
  const i = raw.indexOf("\t");
  if (i < 0) return { tokenId: "", address: raw };
  return { tokenId: raw.slice(0, i), address: raw.slice(i + 1) };
}

async function fillTokenBalanceTxCountSolo(
  db: Queryable,
  tokenId: string,
  address: string
): Promise<void> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL enable_seqscan = off");
    await db.query("SET LOCAL jit = off");
    await fillTokenBalanceTxCountPack(db, tokenId, [address]);
    await db.query("COMMIT");
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* */
    }
    throw e;
  }
}

async function fillTokenBalanceTxCountPack(
  db: Queryable,
  tokenId: string,
  addresses: string[]
): Promise<void> {
  if (!tokenId || !addresses.length) return;
  await db.query(
    `UPDATE token_balances tb
        SET tx_count = s.n,
            first_height = CASE
              WHEN s.first_h IS NULL THEN tb.first_height
              ELSE LEAST(COALESCE(tb.first_height, s.first_h), s.first_h)
            END,
            last_height = CASE
              WHEN s.last_h IS NULL THEN tb.last_height
              ELSE GREATEST(COALESCE(tb.last_height, s.last_h), s.last_h)
            END
       FROM (
         SELECT ad.address, count(*)::int AS n,
                min(x.height) AS first_h, max(x.height) AS last_h
           FROM packed.address_tx x
           JOIN packed.addr ad ON ad.id = x.addr_id
           JOIN packed.token_tx_seen s
             ON s.token_id = packed.hex32($1) AND s.tx_id = x.tx_id
          WHERE ad.address = ANY($2::text[])
          GROUP BY ad.address
       ) s
      WHERE tb.token_id = $1
        AND tb.address = s.address
        AND tb.tx_count IS NULL`,
    [tokenId, addresses]
  );
  await db.query(
    `UPDATE token_balances
        SET tx_count = 0
      WHERE token_id = $1
        AND address = ANY($2::text[])
        AND tx_count IS NULL
        AND amount > 0`,
    [tokenId, addresses]
  );
}

/**
 * One page of current holders still missing tx_count.
 * Short addresses: one join pack. Long P2S / fat address_tx: one address.
 * Never enable_nestloop=off (that seq-scans address_tx).
 */
export async function syncTokenBalanceTxCountPage(
  db: Queryable,
  after: string
): Promise<{ last: string | null; rows: number; done: boolean; slow: boolean }> {
  const { tokenId: afterT, address: afterA } = parseTokenBalanceTxCountCursor(after);
  const page = await db.query<{
    token_id: string;
    address: string;
    addr_txs: string | null;
  }>(
    `SELECT b.token_id, b.address, s.tx_count::text AS addr_txs
       FROM token_balances b
       LEFT JOIN address_summary s ON s.address = b.address
      WHERE b.amount > 0
        AND b.tx_count IS NULL
        AND (b.token_id, b.address) > ($1, $2)
      ORDER BY b.token_id, b.address
      LIMIT $3`,
    [afterT, afterA, TX_COUNT_FILL_PAGE]
  );
  if (!page.rows.length) return { last: after || null, rows: 0, done: true, slow: false };

  const byToken = new Map<string, { address: string; addr_txs: string | null }[]>();
  for (const row of page.rows) {
    const list = byToken.get(row.token_id) ?? [];
    list.push(row);
    byToken.set(row.token_id, list);
  }
  let slow = false;
  for (const [tokenId, rows] of byToken) {
    const batch: string[] = [];
    const solo: string[] = [];
    for (const r of rows) {
      const n = r.addr_txs != null ? Number(r.addr_txs) : 0;
      if (r.address.length > TX_COUNT_SOLO_LEN || n >= TX_COUNT_SOLO_TXS) solo.push(r.address);
      else batch.push(r.address);
    }
    if (batch.length) {
      try {
        await fillTokenBalanceTxCountPack(db, tokenId, batch);
      } catch (e) {
        console.warn(`[indexer] token_balances tx_count pack ${tokenId.slice(0, 12)}…`, String(e));
        for (const addr of batch) {
          try {
            await fillTokenBalanceTxCountPack(db, tokenId, [addr]);
          } catch (e2) {
            console.warn(
              `[indexer] token_balances tx_count ${addr.slice(0, 12)}…`,
              String(e2)
            );
            await db.query(
              `UPDATE token_balances SET tx_count = 0
                WHERE token_id = $1 AND address = $2 AND tx_count IS NULL`,
              [tokenId, addr]
            );
          }
        }
      }
    }
    for (const addr of solo) {
      try {
        await fillTokenBalanceTxCountSolo(db, tokenId, addr);
      } catch (e) {
        console.warn(`[indexer] token_balances tx_count p2s ${addr.slice(0, 12)}…`, String(e));
        await db.query(
          `UPDATE token_balances SET tx_count = 0
            WHERE token_id = $1 AND address = $2 AND tx_count IS NULL`,
          [tokenId, addr]
        );
      }
      slow = true;
    }
  }
  const lastRow = page.rows[page.rows.length - 1]!;
  return {
    last: encodeTokenBalanceTxCountCursor(lastRow.token_id, lastRow.address),
    rows: page.rows.length,
    done: false,
    slow,
  };
}

/**
 * Long contracts and fat wallets missed the one-shot count: a timeout stored 0,
 * and that pass does not run again. This pass writes the real
 * address_tx ∩ token_tx_seen total. It does not write 0 on failure, and it
 * does not touch short addresses that already counted.
 * Live +1 stays on. The row lock covers the count, so a tip bump cannot land
 * in the middle and get added twice.
 */
export const LONG_HOLDER_TX_COUNT_KEY = "token_balances_tx_count_long_v1";
const LONG_HOLDER_TX_CURSOR = "token_balances_tx_count_long_cursor";
export const LONG_HOLDER_ADDR_LEN = 200;
export const FAT_HOLDER_ADDR_TXS = 25_000;
export const HOLDER_TX_COUNT_WINDOW = 100_000;
const LONG_HOLDER_WAKE_MS = 800;
const LONG_HOLDER_WAKE_N = 4;

export type LongHolderTxPhase = "L" | "S";

export function holderTxCountNeedsFullHistory(addressLen: number, addrTxs: number | null): boolean {
  if (addressLen > LONG_HOLDER_ADDR_LEN) return true;
  return addrTxs != null && addrTxs >= FAT_HOLDER_ADDR_TXS;
}

export function encodeLongHolderTxCursor(
  phase: LongHolderTxPhase,
  tokenId: string,
  address: string
): string {
  return `${phase}\t${tokenId}\t${address}`;
}

export function parseLongHolderTxCursor(raw: string): {
  phase: LongHolderTxPhase;
  tokenId: string;
  address: string;
} {
  const phase: LongHolderTxPhase = raw.startsWith("S\t") ? "S" : "L";
  const body = raw.startsWith("L\t") || raw.startsWith("S\t") ? raw.slice(2) : raw;
  const i = body.indexOf("\t");
  if (i < 0) return { phase, tokenId: body, address: "" };
  return { phase, tokenId: body.slice(0, i), address: body.slice(i + 1) };
}

export function heightWindows(tip: number, window = HOLDER_TX_COUNT_WINDOW): Array<[number, number]> {
  const end = Math.max(0, Math.trunc(tip)) + 1;
  const out: Array<[number, number]> = [];
  const step = Math.max(1, Math.trunc(window));
  for (let h = 0; h < end; h += step) out.push([h, h + step]);
  return out;
}

export function foldHolderTxSlice(
  acc: { n: number; first: number | null; last: number | null },
  slice: { n: number; lo: number | null; hi: number | null }
): { n: number; first: number | null; last: number | null } {
  const lo = slice.lo != null && Number.isFinite(slice.lo) ? slice.lo : null;
  const hi = slice.hi != null && Number.isFinite(slice.hi) ? slice.hi : null;
  return {
    n: acc.n + (Number.isFinite(slice.n) ? slice.n : 0),
    first: lo == null ? acc.first : acc.first == null ? lo : Math.min(acc.first, lo),
    last: hi == null ? acc.last : acc.last == null ? hi : Math.max(acc.last, hi),
  };
}

const HOLDER_TX_SLICE_SQL = `
SELECT count(*)::int AS n,
       min(x.height)::bigint AS lo,
       max(x.height)::bigint AS hi
  FROM packed.addr ad
  JOIN packed.address_tx x
    ON x.addr_id = ad.id
   AND x.height >= $3
   AND x.height < $4
  JOIN packed.token_tx_seen s
    ON s.tx_id = x.tx_id
   AND s.token_id = decode($2, 'hex')
 WHERE ad.addr_md5 = md5($1)
   AND ad.address = $1
`;

const HOLDER_TX_NULL_HEIGHT_SQL = `
SELECT count(*)::int AS n
  FROM packed.addr ad
  JOIN packed.address_tx x
    ON x.addr_id = ad.id
   AND x.height IS NULL
  JOIN packed.token_tx_seen s
    ON s.tx_id = x.tx_id
   AND s.token_id = decode($2, 'hex')
 WHERE ad.addr_md5 = md5($1)
   AND ad.address = $1
`;

async function stateValue(db: Queryable, key: string): Promise<string | null> {
  const r = await db.query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = $1`,
    [key]
  );
  return r.rows[0]?.value ?? null;
}

async function putState(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO indexer_state (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

async function countHolderTokenTx(
  db: Queryable,
  tokenId: string,
  address: string,
  tip: number,
  addrTxs: number | null
): Promise<{ n: number; first: number | null; last: number | null }> {
  const ranges =
    addrTxs != null && addrTxs < 8_000 ? [[0, Math.max(0, tip) + 1] as [number, number]] : heightWindows(tip);
  let acc = { n: 0, first: null as number | null, last: null as number | null };
  for (const [lo, hi] of ranges) {
    const r = await db.query<{ n: number; lo: string | null; hi: string | null }>(HOLDER_TX_SLICE_SQL, [
      address,
      tokenId,
      lo,
      hi,
    ]);
    const row = r.rows[0];
    acc = foldHolderTxSlice(acc, {
      n: Number(row?.n || 0),
      lo: row?.lo != null ? Number(row.lo) : null,
      hi: row?.hi != null ? Number(row.hi) : null,
    });
  }
  const missing = await db.query<{ n: number }>(HOLDER_TX_NULL_HEIGHT_SQL, [address, tokenId]);
  acc = foldHolderTxSlice(acc, { n: Number(missing.rows[0]?.n || 0), lo: null, hi: null });
  return acc;
}

/** Replace the stored total. Caller holds the row lock for this address. */
async function writeHolderTokenTxCount(
  db: Queryable,
  tokenId: string,
  address: string,
  counted: { n: number; first: number | null; last: number | null }
): Promise<void> {
  await db.query(
    `UPDATE token_balances
        SET tx_count = $3,
            first_height = CASE
              WHEN $4::bigint IS NULL THEN first_height
              ELSE LEAST(COALESCE(first_height, $4::bigint), $4::bigint)
            END,
            last_height = CASE
              WHEN $5::bigint IS NULL THEN last_height
              ELSE GREATEST(COALESCE(last_height, $5::bigint), $5::bigint)
            END
      WHERE token_id = $1
        AND address = $2
        AND amount > 0`,
    [tokenId, address, counted.n, counted.first, counted.last]
  );
}

async function recountHolderTokenTx(
  db: Queryable,
  tokenId: string,
  address: string,
  addrTxs: number | null
): Promise<void> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL statement_timeout = 8000");
    await db.query("SET LOCAL enable_seqscan = off");
    await db.query("SET LOCAL jit = off");
    const locked = await db.query<{ ok: number }>(
      `SELECT 1 AS ok FROM token_balances
        WHERE token_id = $1 AND address = $2 AND amount > 0
        FOR UPDATE`,
      [tokenId, address]
    );
    if (!locked.rows.length) {
      await db.query("COMMIT");
      return;
    }
    const tipRow = await db.query<{ h: string | null }>(
      `SELECT height::text AS h FROM packed.blocks ORDER BY height DESC LIMIT 1`
    );
    const tip = Number(tipRow.rows[0]?.h || 0);
    const counted = await countHolderTokenTx(db, tokenId, address, tip, addrTxs);
    await writeHolderTokenTxCount(db, tokenId, address, counted);
    await db.query("COMMIT");
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* aborted */
    }
    throw e;
  }
}

type LongHolderRow = { token_id: string; address: string; addr_txs: string | null };

async function nextLongHolder(db: Queryable, tokenId: string, address: string): Promise<LongHolderRow | null> {
  const r = await db.query<LongHolderRow>(
    `SELECT b.token_id, b.address, s.tx_count::text AS addr_txs
       FROM token_balances b
       LEFT JOIN address_summary s ON s.address = b.address
      WHERE b.amount > 0
        AND length(b.address) > $3
        AND (b.token_id, b.address) > ($1, $2)
      ORDER BY b.token_id, b.address
      LIMIT 1`,
    [tokenId, address, LONG_HOLDER_ADDR_LEN]
  );
  return r.rows[0] ?? null;
}

async function nextFatHolder(
  db: Queryable,
  tokenId: string,
  address: string
): Promise<LongHolderRow | null> {
  const r = await db.query<LongHolderRow>(
    `SELECT b.token_id, b.address, s.tx_count::text AS addr_txs
       FROM address_summary s
       JOIN token_balances b ON b.address = s.address AND b.amount > 0
      WHERE s.tx_count >= $3
        AND length(s.address) <= $4
        AND (b.token_id, b.address) > ($1, $2)
      ORDER BY b.token_id, b.address
      LIMIT 1`,
    [tokenId, address, FAT_HOLDER_ADDR_TXS, LONG_HOLDER_ADDR_LEN]
  );
  return r.rows[0] ?? null;
}

let longHolderTxRunning = false;

export async function maybeFillLongHolderTxCounts(pool: pg.Pool): Promise<void> {
  if (longHolderTxRunning) return;
  if (!packedWriteEnabled()) return;
  longHolderTxRunning = true;
  if (await stateValue(pool, LONG_HOLDER_TX_COUNT_KEY)) {
    longHolderTxRunning = false;
    return;
  }
  void (async () => {
    const client = await pool.connect();
    let capped = false;
    let wrote = 0;
    try {
      await capStatements(client, 8000);
      capped = true;
      const t0 = Date.now();
      let cursor = (await stateValue(client, LONG_HOLDER_TX_CURSOR)) ?? encodeLongHolderTxCursor("L", "", "");
      while (Date.now() - t0 < LONG_HOLDER_WAKE_MS && wrote < LONG_HOLDER_WAKE_N) {
        const pos = parseLongHolderTxCursor(cursor);
        const row =
          pos.phase === "S"
            ? await nextFatHolder(client, pos.tokenId, pos.address)
            : await nextLongHolder(client, pos.tokenId, pos.address);
        if (!row) {
          if (pos.phase === "L") {
            cursor = encodeLongHolderTxCursor("S", "", "");
            await putState(client, LONG_HOLDER_TX_CURSOR, cursor);
            continue;
          }
          await putState(client, LONG_HOLDER_TX_COUNT_KEY, String(Date.now()));
          console.log(`[indexer] long holder tx_count done wrote=${wrote}`);
          return;
        }
        const addrTxs = row.addr_txs != null ? Number(row.addr_txs) : null;
        try {
          await recountHolderTokenTx(client, row.token_id, row.address, addrTxs);
        } catch (e) {
          const msg = String(e);
          console.warn(
            `[indexer] long holder tx_count ${row.address.slice(0, 12)}…`,
            msg.slice(0, 220)
          );
          if (!/statement timeout/i.test(msg)) throw e;
          // Leave the stored number. One slow contract must not freeze the pass.
          cursor = encodeLongHolderTxCursor(pos.phase, row.token_id, row.address);
          await putState(client, LONG_HOLDER_TX_CURSOR, cursor);
          continue;
        }
        cursor = encodeLongHolderTxCursor(pos.phase, row.token_id, row.address);
        await putState(client, LONG_HOLDER_TX_CURSOR, cursor);
        wrote += 1;
      }
      if (wrote > 0) {
        console.log(`[indexer] long holder tx_count wrote=${wrote} at=${cursor.slice(0, 24)}`);
      }
    } catch (e) {
      console.warn("[indexer] long holder tx_count", String(e).slice(0, 300));
    } finally {
      longHolderTxRunning = false;
      if (capped) await releaseCapped(client);
      else client.release();
    }
  })();
}

function addCount(map: Map<string, number>, key: string, n: number) {
  if (!n) return;
  map.set(key, (map.get(key) ?? 0) + n);
}

/**
 * Same shape as the gateway tape (`TOKEN_MINTBURN_SQL`, swap excluded).
 * Alias the move row as `m`.
 */
export const TAPE_NOT_MINTBURN_SQL = `NOT (
  (m.spent = 0 AND m.created > 0)
  OR (
    m.spent > m.created
    AND NOT (
      GREATEST(m.created, m.spent) > 9007199254740991
      AND abs(m.created - m.spent) <= CASE
        WHEN GREATEST(m.created, m.spent) > 0
        THEN 4 * power(2::numeric, floor(log(2::numeric, GREATEST(m.created, m.spent))) - 52)
        ELSE -1
      END
    )
  )
)`;

export const TAPE_NOT_SWAP_PACKED_SQL = `NOT EXISTS (
  SELECT 1 FROM defi.trades tr
  WHERE tr.tx_id = encode(m.tx_id, 'hex')
    AND tr.token_id = encode(m.token_id, 'hex')
    AND tr.side IN ('buy', 'sell')
)`;

const TAPE_NOT_SWAP_TEXT_SQL = `NOT EXISTS (
  SELECT 1 FROM defi.trades tr
  WHERE tr.tx_id = m.tx_id
    AND tr.token_id = m.token_id
    AND tr.side IN ('buy', 'sell')
)`;

/** +1 when a tx joins the #txs tape, -1 when it leaves, 0 when it stays. */
export function transferCountDelta(wasOnTape: boolean, isOnTape: boolean): number {
  return (isOnTape ? 1 : 0) - (wasOnTape ? 1 : 0);
}

const TAPE_TX_COUNT_KEY = "token_tx_count_tape_v1";
let tokenTapeRecountRunning = false;

async function tapeTransferIds(
  client: Queryable,
  txId: string,
  tokenIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(tokenIds.map((id) => id.toLowerCase()).filter(Boolean))];
  if (!txId || !ids.length) return new Set();
  const packed = packedWriteEnabled();
  const r = await client.query<{ token_id: string }>(
    packed
      ? `SELECT encode(m.token_id, 'hex') AS token_id
           FROM packed.token_tx_move m
          WHERE m.tx_id = decode(lower($1), 'hex')
            AND m.token_id IN (
              SELECT decode(lower(x), 'hex')
                FROM unnest($2::text[]) AS x
               WHERE x ~ '^[0-9a-fA-F]{64}$'
            )
            AND m.height IS NOT NULL
            AND ${TAPE_NOT_MINTBURN_SQL}
            AND ${TAPE_NOT_SWAP_PACKED_SQL}`
      : `SELECT m.token_id
           FROM token_tx_move m
          WHERE m.tx_id = $1
            AND m.token_id = ANY($2::text[])
            AND m.height IS NOT NULL
            AND ${TAPE_NOT_MINTBURN_SQL}
            AND ${TAPE_NOT_SWAP_TEXT_SQL}`,
    [txId, ids]
  );
  return new Set(r.rows.map((row) => row.token_id.toLowerCase()));
}

async function tapeTransferDeltasAtTxs(
  client: Queryable,
  txIds: string[]
): Promise<Map<string, number>> {
  const delta = new Map<string, number>();
  const ids = [...new Set(txIds.filter(Boolean))];
  if (!ids.length) return delta;
  const packed = packedWriteEnabled();
  const r = await client.query<{ token_id: string; n: string }>(
    packed
      ? `SELECT encode(m.token_id, 'hex') AS token_id, count(*)::text AS n
           FROM packed.token_tx_move m
          WHERE m.tx_id IN (
                  SELECT decode(lower(x), 'hex')
                    FROM unnest($1::text[]) AS x
                   WHERE x ~ '^[0-9a-fA-F]{64}$'
                )
            AND m.height IS NOT NULL
            AND ${TAPE_NOT_MINTBURN_SQL}
            AND ${TAPE_NOT_SWAP_PACKED_SQL}
          GROUP BY m.token_id`
      : `SELECT m.token_id, count(*)::text AS n
           FROM token_tx_move m
          WHERE m.tx_id = ANY($1::text[])
            AND m.height IS NOT NULL
            AND ${TAPE_NOT_MINTBURN_SQL}
            AND ${TAPE_NOT_SWAP_TEXT_SQL}
          GROUP BY m.token_id`,
    [ids]
  );
  for (const row of r.rows) {
    if (!row.token_id) continue;
    addCount(delta, row.token_id.toLowerCase(), -Number(row.n || 0));
  }
  return delta;
}

async function bumpTokenInts(
  client: Queryable,
  col: "holders" | "unspent_boxes" | "tx_count",
  deltas: Map<string, number>
): Promise<void> {
  if (!deltas.size) return;
  const ids: string[] = [];
  const ns: number[] = [];
  for (const [id, n] of deltas) {
    if (!n) continue;
    ids.push(id);
    ns.push(n);
  }
  if (!ids.length) return;
  await client.query(
    `UPDATE tokens t SET ${col} = GREATEST(0, COALESCE(t.${col}, 0) + v.n)
     FROM unnest($1::text[], $2::int[]) AS v(token_id, n)
     WHERE t.token_id = v.token_id`,
    [ids, ns]
  );
}

async function bumpCatalog(
  client: Queryable,
  holders: number,
  txs: number
): Promise<void> {
  if (!holders && !txs) return;
  await client.query(
    `UPDATE token_catalog_stats
     SET unique_holders = GREATEST(0, unique_holders + $1),
         unique_txs = GREATEST(0, unique_txs + $2)
     WHERE id = TRUE`,
    [holders, txs]
  );
}

async function noteTokenTxs(
  client: Queryable,
  tokenIds: string[],
  txId: string
): Promise<void> {
  const uniq = [...new Set(tokenIds.filter(Boolean))];
  if (!uniq.length || !txId) return;
  const txIds = uniq.map(() => txId);
  const before = await tapeTransferIds(client, txId, uniq);
  if (packedWriteEnabled()) {
    await client.query(
      `INSERT INTO packed.token_tx_seen (token_id, tx_id, height)
       SELECT packed.hex32(t.token_id), packed.hex32(t.tx_id), pt.height
         FROM unnest($1::text[], $2::text[]) AS t(token_id, tx_id)
         LEFT JOIN packed.transactions pt ON pt.id = packed.hex32(t.tx_id)
        WHERE t.token_id ~ '^[0-9a-fA-F]{64}$'
          AND t.tx_id ~ '^[0-9a-fA-F]{64}$'
       ON CONFLICT (token_id, tx_id) DO NOTHING`,
      [uniq, txIds]
    );
  } else {
    await client.query(
      `INSERT INTO token_tx_seen (token_id, tx_id)
       SELECT t.token_id, t.tx_id
       FROM unnest($1::text[], $2::text[]) AS t(token_id, tx_id)
       ON CONFLICT DO NOTHING`,
      [uniq, txIds]
    );
  }
  // Spend path records the pair before outputs exist, so the first call
  // often stores nothing. Refresh after every note, including conflicts.
  await client.query(
    `SELECT token_tx_move_upsert(t.token_id, t.tx_id, NULL)
     FROM unnest($1::text[], $2::text[]) AS t(token_id, tx_id)`,
    [uniq, txIds]
  );
  const after = await tapeTransferIds(client, txId, uniq);
  const txDelta = new Map<string, number>();
  for (const id of new Set([...before, ...after])) {
    addCount(txDelta, id, transferCountDelta(before.has(id), after.has(id)));
  }
  await bumpTokenInts(client, "tx_count", txDelta);
  const idIns = await client.query(
    `INSERT INTO token_tx_ids (tx_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [txId]
  );
  if ((idIns.rowCount ?? 0) > 0) await bumpCatalog(client, 0, 1);
}

type AggMove = { tokenId: string; address: string; amount: string };

function aggregateMoves(
  rows: { tokenId: string; address: string | null; amount: string }[]
): AggMove[] {
  const map = new Map<string, { tokenId: string; address: string; amount: bigint }>();
  for (const row of rows) {
    if (!okAddr(row.address)) continue;
    const amt = row.amount && /^-?\d+$/.test(row.amount) ? row.amount : "0";
    if (amt === "0") continue;
    const key = `${row.tokenId}\0${row.address}`;
    const cur = map.get(key);
    if (cur) cur.amount += BigInt(amt);
    else
      map.set(key, {
        tokenId: row.tokenId,
        address: row.address,
        amount: BigInt(amt),
      });
  }
  const out: AggMove[] = [];
  for (const v of map.values()) {
    if (v.amount === 0n) continue;
    out.push({ tokenId: v.tokenId, address: v.address, amount: v.amount.toString() });
  }
  return out;
}

async function balanceCounts(
  client: Queryable,
  addresses: string[]
): Promise<Map<string, number>> {
  if (!addresses.length) return new Map();
  const uniq = [...new Set(addresses)];
  const r = await client.query<{ address: string; n: string }>(
    `SELECT address, COUNT(*)::text AS n
     FROM token_balances
     WHERE address = ANY($1::text[]) AND amount > 0
     GROUP BY address`,
    [uniq]
  );
  return new Map(r.rows.map((row) => [row.address, Number(row.n)]));
}

/** Unique catalog holders: +1 when an address's first token-balance row appears. */
async function uniqueHoldersGained(
  client: Queryable,
  inserted: { address: string }[]
): Promise<number> {
  if (!inserted.length) return 0;
  const added = new Map<string, number>();
  for (const row of inserted) addCount(added, row.address, 1);
  const counts = await balanceCounts(client, [...added.keys()]);
  let n = 0;
  for (const [addr, k] of added) {
    if ((counts.get(addr) ?? 0) === k) n += 1;
  }
  return n;
}

/** Unique catalog holders: -1 when an address has no remaining token-balance rows. */
async function uniqueHoldersLost(
  client: Queryable,
  addresses: string[]
): Promise<number> {
  if (!addresses.length) return 0;
  const uniq = [...new Set(addresses)];
  const counts = await balanceCounts(client, uniq);
  let n = 0;
  for (const addr of uniq) {
    if ((counts.get(addr) ?? 0) === 0) n += 1;
  }
  return n;
}

function isInsertedFlag(v: boolean | string | null | undefined): boolean {
  return v === true || v === "t";
}

async function creditBalances(
  client: Queryable,
  moves: AggMove[],
  height?: number | null
): Promise<void> {
  if (!moves.length) return;
  const h = height != null && Number.isFinite(height) ? Math.trunc(height) : null;
  const ins = await client.query<{
    token_id: string;
    address: string;
    inserted: boolean | string;
  }>(
    `INSERT INTO token_balances (token_id, address, amount, first_height, last_height)
     SELECT t.token_id, t.address, t.amount, $4::bigint, $4::bigint
     FROM unnest($1::text[], $2::text[], $3::numeric[]) AS t(token_id, address, amount)
     ON CONFLICT (token_id, address) DO UPDATE
       SET amount = token_balances.amount + EXCLUDED.amount,
           first_height = COALESCE(token_balances.first_height, EXCLUDED.first_height),
           last_height = CASE
             WHEN EXCLUDED.last_height IS NULL THEN token_balances.last_height
             ELSE GREATEST(COALESCE(token_balances.last_height, EXCLUDED.last_height), EXCLUDED.last_height)
           END
     RETURNING token_id, address, (xmax = 0) AS inserted`,
    [
      moves.map((m) => m.tokenId),
      moves.map((m) => m.address),
      moves.map((m) => m.amount),
      h,
    ]
  );
  const inserted = ins.rows.filter((row) => isInsertedFlag(row.inserted));
  const holderDelta = new Map<string, number>();
  for (const row of inserted) addCount(holderDelta, row.token_id, 1);
  await bumpTokenInts(client, "holders", holderDelta);
  await bumpCatalog(client, await uniqueHoldersGained(client, inserted), 0);
}

async function debitBalances(
  client: Queryable,
  moves: AggMove[],
  height?: number | null
): Promise<void> {
  if (!moves.length) return;
  const h = height != null && Number.isFinite(height) ? Math.trunc(height) : null;
  const upd = await client.query<{ token_id: string; address: string; amount: string }>(
    `UPDATE token_balances b
     SET amount = b.amount - v.amount,
         last_height = CASE
           WHEN $4::bigint IS NULL THEN b.last_height
           ELSE GREATEST(COALESCE(b.last_height, $4::bigint), $4::bigint)
         END
     FROM unnest($1::text[], $2::text[], $3::numeric[]) AS v(token_id, address, amount)
     WHERE b.token_id = v.token_id AND b.address = v.address
     RETURNING b.token_id, b.address, b.amount::text AS amount`,
    [
      moves.map((m) => m.tokenId),
      moves.map((m) => m.address),
      moves.map((m) => m.amount),
      h,
    ]
  );
  const gone: { token_id: string; address: string }[] = [];
  for (const row of upd.rows) {
    try {
      if (BigInt(row.amount) <= 0n) gone.push(row);
    } catch {
      gone.push(row);
    }
  }
  if (gone.length) {
    await client.query(
      `DELETE FROM token_balances
       WHERE (token_id, address) IN (
         SELECT t.token_id, t.address
         FROM unnest($1::text[], $2::text[]) AS t(token_id, address)
       )`,
      [gone.map((g) => g.token_id), gone.map((g) => g.address)]
    );
    const holderDelta = new Map<string, number>();
    for (const row of gone) addCount(holderDelta, row.token_id, -1);
    await bumpTokenInts(client, "holders", holderDelta);
    const lost = await uniqueHoldersLost(
      client,
      gone.map((g) => g.address)
    );
    await bumpCatalog(client, -lost, 0);
  }
}

/**
 * Debit unspent boxes about to be marked spent. Call before markSpent.
 */
export async function applyTokenSpends(
  client: Queryable,
  boxIds: string[],
  spentTxId: string,
  height?: number | null
): Promise<void> {
  if (!boxIds.length || !spentTxId) return;
  const r = await client.query<{
    box_id: string;
    address: string | null;
    spent_tx_id: string | null;
    token_id: string | null;
    amount: string | null;
  }>(
    packedWriteEnabled()
      ? `SELECT encode(b.box_id, 'hex') AS box_id, ad.address,
                encode(b.spent_tx_id, 'hex') AS spent_tx_id,
                encode(a.token_id, 'hex') AS token_id, a.amount::text AS amount
           FROM packed.boxes b
           LEFT JOIN packed.addr ad ON ad.id = b.addr_id
           LEFT JOIN packed.box_assets a ON a.box_id = b.box_id
          WHERE b.box_id IN (
                  SELECT decode(lower(x), 'hex')
                    FROM unnest($1::text[]) AS x
                   WHERE x ~ '^[0-9a-fA-F]{64}$'
                )`
      : `SELECT b.box_id, b.address, b.spent_tx_id, a.token_id, a.amount::text AS amount
           FROM boxes b
           LEFT JOIN box_assets a ON a.box_id = b.box_id
          WHERE b.box_id = ANY($1::text[])`,
    [boxIds]
  );
  const moves: { tokenId: string; address: string | null; amount: string }[] = [];
  const tokenIds: string[] = [];
  const unspentByToken = new Map<string, number>();
  const seenBoxToken = new Set<string>();
  for (const row of r.rows) {
    if (row.spent_tx_id) continue;
    if (!row.token_id) continue;
    tokenIds.push(row.token_id);
    const k = `${row.box_id}\0${row.token_id}`;
    if (!seenBoxToken.has(k)) {
      seenBoxToken.add(k);
      addCount(unspentByToken, row.token_id, -1);
    }
    moves.push({
      tokenId: row.token_id,
      address: row.address,
      amount: row.amount ?? "0",
    });
  }
  await debitBalances(client, aggregateMoves(moves), height);
  await bumpTokenInts(client, "unspent_boxes", unspentByToken);
  await noteTokenTxs(client, tokenIds, spentTxId);
  await bumpHolderTokenTxs(
    client,
    moves.map((m) => ({ tokenId: m.tokenId, address: m.address })),
    spentTxId,
    height,
    1
  );
}

/**
 * Credit new unspent outputs. `fresh` = box_assets rows inserted this tx (xmax=0).
 * Already-spent boxes (deepen of a later-spent create) skip credit but record txs.
 */
export async function applyTokenCredits(
  client: Queryable,
  fresh: { boxId: string; tokenId: string; amount: string }[],
  creationTxId: string,
  height?: number | null
): Promise<void> {
  if (!fresh.length || !creationTxId) return;
  const boxIds = [...new Set(fresh.map((f) => f.boxId))];
  const boxes = await client.query<{
    box_id: string;
    address: string | null;
    spent_tx_id: string | null;
  }>(
    packedWriteEnabled()
      ? `SELECT encode(b.box_id, 'hex') AS box_id, ad.address,
                encode(b.spent_tx_id, 'hex') AS spent_tx_id
           FROM packed.boxes b
           LEFT JOIN packed.addr ad ON ad.id = b.addr_id
          WHERE b.box_id IN (
                  SELECT decode(lower(x), 'hex')
                    FROM unnest($1::text[]) AS x
                   WHERE x ~ '^[0-9a-fA-F]{64}$'
                )`
      : `SELECT box_id, address, spent_tx_id FROM boxes WHERE box_id = ANY($1::text[])`,
    [boxIds]
  );
  const byId = new Map(
    boxes.rows.map((b) => [
      packedWriteEnabled() ? b.box_id.toLowerCase() : b.box_id,
      b,
    ])
  );
  const credits: { tokenId: string; address: string | null; amount: string }[] = [];
  const tokenIds: string[] = [];
  const unspentByToken = new Map<string, number>();
  const extraSpendTx = new Map<string, string[]>();
  for (const row of fresh) {
    tokenIds.push(row.tokenId);
    const box = byId.get(packedWriteEnabled() ? row.boxId.toLowerCase() : row.boxId);
    if (!box) continue;
    if (box.spent_tx_id) {
      const list = extraSpendTx.get(box.spent_tx_id) ?? [];
      list.push(row.tokenId);
      extraSpendTx.set(box.spent_tx_id, list);
      continue;
    }
    credits.push({
      tokenId: row.tokenId,
      address: box.address,
      amount: row.amount,
    });
    addCount(unspentByToken, row.tokenId, 1);
  }
  await creditBalances(client, aggregateMoves(credits), height);
  await bumpTokenInts(client, "unspent_boxes", unspentByToken);
  await noteTokenTxs(client, tokenIds, creationTxId);
  await bumpHolderTokenTxs(
    client,
    credits.map((m) => ({ tokenId: m.tokenId, address: m.address })),
    creationTxId,
    height,
    1
  );
  for (const [txId, ids] of extraSpendTx) {
    await noteTokenTxs(client, ids, txId);
  }
}

type BoxAssetRow = {
  box_id: string;
  address: string | null;
  spent_tx_id: string | null;
  creation_tx_id: string | null;
  token_id: string | null;
  amount: string | null;
};

async function forgetTokenTxsAtHeight(
  client: Queryable,
  height: number
): Promise<void> {
  const txs = textChainHeadersEnabled()
    ? await client.query<{ id: string }>(
        `SELECT id FROM transactions WHERE height = $1`,
        [height]
      )
    : { rows: [] as { id: string }[] };
  let txIds = txs.rows.map((r) => r.id).filter(Boolean);
  if (!txIds.length && packedWriteEnabled()) {
    const packed = await client.query<{ id: string }>(
      `SELECT encode(id, 'hex') AS id FROM packed.transactions WHERE height = $1`,
      [height]
    );
    txIds = packed.rows.map((r) => r.id).filter(Boolean);
  }
  if (!txIds.length) return;
  const txDelta = await tapeTransferDeltasAtTxs(client, txIds);
  if (packedWriteEnabled()) {
    await client.query(
      `DELETE FROM packed.token_tx_seen
        WHERE tx_id IN (
          SELECT decode(lower(x), 'hex')
            FROM unnest($1::text[]) AS x
           WHERE x ~ '^[0-9a-fA-F]{64}$'
        )`,
      [txIds]
    );
  } else {
    await client.query(
      `DELETE FROM token_tx_seen
        WHERE tx_id = ANY($1::text[])`,
      [txIds]
    );
  }
  await bumpTokenInts(client, "tx_count", txDelta);
  const gone = await client.query(
    `DELETE FROM token_tx_ids WHERE tx_id = ANY($1::text[])`,
    [txIds]
  );
  const n = gone.rowCount ?? 0;
  if (n > 0) await bumpCatalog(client, 0, -n);
}

/**
 * Undo applyTokenSpends / applyTokenCredits for one indexed height.
 * Same order as writes: spends then creates. Not a catalog recount.
 */
export async function invertTokenStatsAtHeight(
  client: Queryable,
  height: number
): Promise<void> {
  await forgetTokenTxsAtHeight(client, height);

  const fromPacked = packedWriteEnabled() && !textChainBoxesEnabled();
  const created = await client.query<BoxAssetRow>(
    fromPacked
      ? `SELECT encode(b.box_id, 'hex') AS box_id, ad.address,
                encode(b.spent_tx_id, 'hex') AS spent_tx_id,
                encode(b.creation_tx_id, 'hex') AS creation_tx_id,
                encode(a.token_id, 'hex') AS token_id, a.amount::text AS amount
           FROM packed.transactions t
           JOIN packed.boxes b ON b.creation_tx_id = t.id
           LEFT JOIN packed.addr ad ON ad.id = b.addr_id
           LEFT JOIN packed.box_assets a ON a.box_id = b.box_id
          WHERE t.height = $1`
      : `SELECT b.box_id, b.address, b.spent_tx_id, b.creation_tx_id,
                a.token_id, a.amount::text AS amount
           FROM boxes b
           JOIN transactions t ON t.id = b.creation_tx_id
           LEFT JOIN box_assets a ON a.box_id = b.box_id
          WHERE t.height = $1`,
    [height]
  );
  const spent = await client.query<BoxAssetRow>(
    fromPacked
      ? `SELECT encode(b.box_id, 'hex') AS box_id, ad.address,
                encode(b.spent_tx_id, 'hex') AS spent_tx_id,
                encode(b.creation_tx_id, 'hex') AS creation_tx_id,
                encode(a.token_id, 'hex') AS token_id, a.amount::text AS amount
           FROM packed.boxes b
           LEFT JOIN packed.addr ad ON ad.id = b.addr_id
           LEFT JOIN packed.box_assets a ON a.box_id = b.box_id
          WHERE b.spent_height = $1`
      : `SELECT b.box_id, b.address, b.spent_tx_id, b.creation_tx_id,
                a.token_id, a.amount::text AS amount
           FROM boxes b
           LEFT JOIN box_assets a ON a.box_id = b.box_id
          WHERE b.spent_height = $1`,
    [height]
  );
  const createdSet = new Set(created.rows.map((r) => r.box_id));

  const spendMoves: { tokenId: string; address: string | null; amount: string }[] =
    [];
  const unspentUp = new Map<string, number>();
  const seenSpend = new Set<string>();
  for (const row of spent.rows) {
    if (!row.token_id) continue;
    spendMoves.push({
      tokenId: row.token_id,
      address: row.address,
      amount: row.amount ?? "0",
    });
    if (createdSet.has(row.box_id)) continue;
    const k = `${row.box_id}\0${row.token_id}`;
    if (seenSpend.has(k)) continue;
    seenSpend.add(k);
    addCount(unspentUp, row.token_id, 1);
  }
  await creditBalances(client, aggregateMoves(spendMoves));
  await bumpTokenInts(client, "unspent_boxes", unspentUp);
  const byTx = new Map<string, { tokenId: string; address: string | null }[]>();
  const addPair = (txId: string | null, tokenId: string | null, address: string | null) => {
    if (!txId || !tokenId) return;
    const list = byTx.get(txId) ?? [];
    list.push({ tokenId, address });
    byTx.set(txId, list);
  };
  for (const row of spent.rows) addPair(row.spent_tx_id, row.token_id, row.address);
  for (const row of created.rows) addPair(row.creation_tx_id, row.token_id, row.address);
  for (const [txId, pairs] of byTx) {
    await bumpHolderTokenTxs(client, pairs, txId, height, -1);
  }

  const creditMoves: { tokenId: string; address: string | null; amount: string }[] =
    [];
  const unspentDown = new Map<string, number>();
  const seenCreate = new Set<string>();
  for (const row of created.rows) {
    if (!row.token_id) continue;
    creditMoves.push({
      tokenId: row.token_id,
      address: row.address,
      amount: row.amount ?? "0",
    });
    if (row.spent_tx_id) continue;
    const k = `${row.box_id}\0${row.token_id}`;
    if (seenCreate.has(k)) continue;
    seenCreate.add(k);
    addCount(unspentDown, row.token_id, -1);
  }
  await debitBalances(client, aggregateMoves(creditMoves));
  await bumpTokenInts(client, "unspent_boxes", unspentDown);
}

type CatalogRow = {
  unique_holders: number;
  unique_txs: string;
  seed_phase: string;
  seed_lo: string | null;
  seed_hi: string | null;
  seed_height: string;
  seed_box_id: string;
};

async function catalog(client: Queryable): Promise<CatalogRow> {
  const r = await client.query<CatalogRow>(
    `SELECT unique_holders, unique_txs::text AS unique_txs, seed_phase,
            seed_lo::text, seed_hi::text, seed_height::text, seed_box_id
     FROM token_catalog_stats WHERE id = TRUE`
  );
  return (
    r.rows[0] ?? {
      unique_holders: 0,
      unique_txs: "0",
      seed_phase: "balances",
      seed_lo: null,
      seed_hi: null,
      seed_height: "0",
      seed_box_id: "",
    }
  );
}

async function recountHolders(client: Queryable): Promise<void> {
  await client.query(`
    WITH s AS (
      SELECT token_id, COUNT(*)::int AS n
      FROM token_balances
      WHERE amount > 0
      GROUP BY token_id
    )
    UPDATE tokens t SET holders = COALESCE(s.n, 0)
    FROM s WHERE t.token_id = s.token_id
  `);
  await client.query(`UPDATE tokens SET holders = 0 WHERE holders IS NULL`);
  const u = await client.query<{ n: string }>(
    `SELECT COUNT(DISTINCT address)::text AS n FROM token_balances WHERE amount > 0`
  );
  await client.query(
    `UPDATE token_catalog_stats SET unique_holders = $1 WHERE id = TRUE`,
    [Number(u.rows[0]?.n || 0)]
  );
}

async function recountUnspent(client: Queryable): Promise<void> {
  await client.query(`
    WITH s AS (
      SELECT a.token_id, COUNT(*)::int AS n
      FROM box_assets a
      JOIN boxes b ON b.box_id = a.box_id
      WHERE b.spent_tx_id IS NULL
      GROUP BY a.token_id
    )
    UPDATE tokens t SET unspent_boxes = COALESCE(s.n, 0)
    FROM s WHERE t.token_id = s.token_id
  `);
  await client.query(
    `UPDATE tokens SET unspent_boxes = 0 WHERE unspent_boxes IS NULL`
  );
}

/** One pass: tokens.tx_count = #txs tape. Caller owns the transaction. */
export async function recountTokenTapeCounts(client: Queryable): Promise<number> {
  const packed = packedWriteEnabled();
  const moveFrom = packed ? "packed.token_tx_move" : "token_tx_move";
  const tokenExpr = packed ? "encode(m.token_id, 'hex')" : "lower(m.token_id)";
  const swapJoin = packed
    ? "m.token_id = decode(lower(tr.token_id), 'hex') AND m.tx_id = decode(lower(tr.tx_id), 'hex')"
    : "m.token_id = tr.token_id AND m.tx_id = tr.tx_id";
  await client.query(`
    CREATE TEMP TABLE token_tape_n ON COMMIT DROP AS
    SELECT ${tokenExpr} AS token_id,
           count(*) FILTER (WHERE ${TAPE_NOT_MINTBURN_SQL})::int AS n
      FROM ${moveFrom} m
     WHERE m.height IS NOT NULL
     GROUP BY m.token_id
  `);
  await client.query(`
    CREATE TEMP TABLE token_swap_n ON COMMIT DROP AS
    SELECT lower(tr.token_id) AS token_id,
           count(DISTINCT lower(tr.tx_id))::int AS n
      FROM defi.trades tr
      JOIN ${moveFrom} m ON ${swapJoin}
     WHERE tr.side IN ('buy', 'sell')
       AND tr.token_id ~ '^[0-9a-fA-F]{64}$'
       AND tr.tx_id ~ '^[0-9a-fA-F]{64}$'
       AND m.height IS NOT NULL
       AND ${TAPE_NOT_MINTBURN_SQL}
     GROUP BY lower(tr.token_id)
  `);
  const updated = await client.query(`
    UPDATE tokens t
       SET tx_count = u.n
      FROM (
        SELECT t2.token_id,
               GREATEST(0, COALESCE(p.n, 0) - COALESCE(s.n, 0)) AS n
          FROM tokens t2
          LEFT JOIN token_tape_n p ON p.token_id = t2.token_id
          LEFT JOIN token_swap_n s ON s.token_id = t2.token_id
      ) u
     WHERE t.token_id = u.token_id
       AND t.tx_count IS DISTINCT FROM u.n
  `);
  return updated.rowCount ?? 0;
}

/**
 * Once: rewrite tokens.tx_count from the tape. A second pass catches a
 * transfer that landed during the first write. Does not touch the tip loop.
 */
export async function maybeRecountTokenTapeCounts(pool: pg.Pool): Promise<void> {
  if (tokenTapeRecountRunning) return;
  const done = await pool.query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = $1`,
    [TAPE_TX_COUNT_KEY]
  );
  if (done.rows[0]?.value) return;
  tokenTapeRecountRunning = true;
  void (async () => {
    const t0 = Date.now();
    try {
      let updated = 0;
      for (let pass = 0; pass < 3; pass++) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL statement_timeout = 0");
          updated = await recountTokenTapeCounts(client);
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
        if (updated === 0) break;
      }
      await pool.query(
        `INSERT INTO indexer_state (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [TAPE_TX_COUNT_KEY, String(Date.now())]
      );
      console.log(
        `[indexer] token tx_count tape recount updated=${updated} ${Date.now() - t0}ms`
      );
    } catch (e) {
      console.warn("[indexer] token tx_count tape recount", String(e).slice(0, 300));
    } finally {
      tokenTapeRecountRunning = false;
    }
  })();
}

async function recountTxs(client: Queryable): Promise<void> {
  await recountTokenTapeCounts(client);
  const u = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM token_tx_ids`
  );
  await client.query(
    `UPDATE token_catalog_stats SET unique_txs = $1 WHERE id = TRUE`,
    [Number(u.rows[0]?.n || 0)]
  );
}

async function seedBalancesBatch(
  client: Queryable,
  lo: number,
  hi: number,
  curH: number,
  curId: string
): Promise<{ n: number; lastH: number; lastId: string }> {
  const boxes = await client.query<{ box_id: string; creation_height_text: string }>(
    `SELECT box_id, creation_height::text AS creation_height_text
     FROM boxes
     WHERE spent_tx_id IS NULL
       AND address IS NOT NULL
       AND length(address) <= $5
       AND creation_height IS NOT NULL
       AND creation_height >= $1 AND creation_height <= $2
       AND (creation_height, box_id) > ($3, $4)
     ORDER BY creation_height, box_id
     LIMIT $6`,
    [lo, hi, curH, curId, ADDRESS_MAX, SEED_BOXES]
  );
  if (!boxes.rows.length) return { n: 0, lastH: curH, lastId: curId };
  const ids = boxes.rows.map((b) => b.box_id);
  const last = boxes.rows[boxes.rows.length - 1]!;
  const ins = await client.query<{
    token_id: string;
    address: string;
    inserted: boolean | string;
  }>(
    `INSERT INTO token_balances (token_id, address, amount, first_height, last_height)
     SELECT a.token_id, b.address, SUM(a.amount),
            MIN(b.creation_height), MAX(b.creation_height)
     FROM box_assets a
     JOIN boxes b ON b.box_id = a.box_id
     WHERE a.box_id = ANY($1::text[])
       AND b.spent_tx_id IS NULL
       AND b.address IS NOT NULL
     GROUP BY a.token_id, b.address
     ON CONFLICT (token_id, address) DO UPDATE
       SET amount = token_balances.amount + EXCLUDED.amount,
           first_height = CASE
             WHEN token_balances.first_height IS NULL THEN EXCLUDED.first_height
             WHEN EXCLUDED.first_height IS NULL THEN token_balances.first_height
             ELSE LEAST(token_balances.first_height, EXCLUDED.first_height)
           END,
           last_height = CASE
             WHEN token_balances.last_height IS NULL THEN EXCLUDED.last_height
             WHEN EXCLUDED.last_height IS NULL THEN token_balances.last_height
             ELSE GREATEST(token_balances.last_height, EXCLUDED.last_height)
           END
     RETURNING token_id, address, (xmax = 0) AS inserted`,
    [ids]
  );
  const inserted = ins.rows.filter((row) => isInsertedFlag(row.inserted));
  const holderDelta = new Map<string, number>();
  for (const row of inserted) addCount(holderDelta, row.token_id, 1);
  await bumpTokenInts(client, "holders", holderDelta);
  await bumpCatalog(client, await uniqueHoldersGained(client, inserted), 0);
  const unspent = await client.query<{ token_id: string; n: string }>(
    `SELECT a.token_id, COUNT(*)::text AS n
     FROM box_assets a
     WHERE a.box_id = ANY($1::text[])
     GROUP BY a.token_id`,
    [ids]
  );
  const uMap = new Map<string, number>();
  for (const row of unspent.rows) addCount(uMap, row.token_id, Number(row.n || 0));
  await bumpTokenInts(client, "unspent_boxes", uMap);
  return {
    n: boxes.rows.length,
    lastH: Number(last.creation_height_text),
    lastId: last.box_id,
  };
}

async function seedTxsBatch(
  client: Queryable,
  lo: number,
  hi: number,
  curH: number,
  curId: string
): Promise<{ n: number; lastH: number; lastId: string }> {
  const boxes = await client.query<{ box_id: string; creation_height_text: string }>(
    `SELECT box_id, creation_height::text AS creation_height_text
     FROM boxes
     WHERE creation_height IS NOT NULL
       AND creation_height >= $1 AND creation_height <= $2
       AND (creation_height, box_id) > ($3, $4)
     ORDER BY creation_height, box_id
     LIMIT $5`,
    [lo, hi, curH, curId, SEED_BOXES]
  );
  if (!boxes.rows.length) return { n: 0, lastH: curH, lastId: curId };
  const ids = boxes.rows.map((b) => b.box_id);
  const last = boxes.rows[boxes.rows.length - 1]!;
  await client.query(
    `INSERT INTO token_tx_seen (token_id, tx_id)
     SELECT token_id, tx_id FROM (
       SELECT a.token_id, b.creation_tx_id AS tx_id
       FROM box_assets a
       JOIN boxes b ON b.box_id = a.box_id
       WHERE a.box_id = ANY($1::text[]) AND b.creation_tx_id IS NOT NULL
       UNION
       SELECT a.token_id, b.spent_tx_id
       FROM box_assets a
       JOIN boxes b ON b.box_id = a.box_id
       WHERE a.box_id = ANY($1::text[]) AND b.spent_tx_id IS NOT NULL
     ) s
     ON CONFLICT DO NOTHING`,
    [ids]
  );
  const idIns = await client.query<{ tx_id: string }>(
    `INSERT INTO token_tx_ids (tx_id)
     SELECT DISTINCT tx_id FROM (
       SELECT b.creation_tx_id AS tx_id
       FROM boxes b
       JOIN box_assets a ON a.box_id = b.box_id
       WHERE b.box_id = ANY($1::text[]) AND b.creation_tx_id IS NOT NULL
       UNION
       SELECT b.spent_tx_id
       FROM boxes b
       JOIN box_assets a ON a.box_id = b.box_id
       WHERE b.box_id = ANY($1::text[]) AND b.spent_tx_id IS NOT NULL
     ) s
     WHERE tx_id IS NOT NULL
     ON CONFLICT DO NOTHING
     RETURNING tx_id`,
    [ids]
  );
  if ((idIns.rowCount ?? 0) > 0) await bumpCatalog(client, 0, idIns.rowCount ?? 0);
  return {
    n: boxes.rows.length,
    lastH: Number(last.creation_height_text),
    lastId: last.box_id,
  };
}

/**
 * Small batch per tick (tip or backfill). Does not use statement_timeout.
 */
export async function maybeCatchupTokenStats(pool: pg.Pool): Promise<boolean> {
  const client = await pool.connect();
  const t0 = Date.now();
  let did = false;
  try {
    await client.query("BEGIN");
    let st = await catalog(client);
    if (st.seed_phase === "done") {
      await client.query("COMMIT");
      return false;
    }
    if (st.seed_lo == null || st.seed_hi == null) {
      const mm = await client.query<{ lo: string | null; hi: string | null }>(
        `SELECT MIN(height)::text AS lo, MAX(height)::text AS hi FROM blocks`
      );
      const lo = Number(mm.rows[0]?.lo || 0);
      const hi = Number(mm.rows[0]?.hi || 0);
      if (!lo || !hi) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `UPDATE token_catalog_stats
         SET seed_lo = $1, seed_hi = $2, seed_phase = 'balances',
             seed_height = 0, seed_box_id = ''
         WHERE id = TRUE`,
        [lo, hi]
      );
      st = {
        ...st,
        seed_lo: String(lo),
        seed_hi: String(hi),
        seed_phase: "balances",
        seed_height: "0",
        seed_box_id: "",
      };
    }
    const lo = Number(st.seed_lo);
    const hi = Number(st.seed_hi);
    const curH = Number(st.seed_height || 0);
    const curId = st.seed_box_id || "";

    if (st.seed_phase === "balances") {
      const batch = await seedBalancesBatch(client, lo, hi, curH, curId);
      if (batch.n === 0) {
        await recountHolders(client);
        await recountUnspent(client);
        await client.query(
          `UPDATE token_catalog_stats
           SET seed_phase = 'txs', seed_height = 0, seed_box_id = ''
           WHERE id = TRUE`
        );
      } else {
        await client.query(
          `UPDATE token_catalog_stats
           SET seed_height = $1, seed_box_id = $2
           WHERE id = TRUE`,
          [batch.lastH, batch.lastId]
        );
      }
      did = true;
    } else if (st.seed_phase === "txs") {
      const batch = await seedTxsBatch(client, lo, hi, curH, curId);
      if (batch.n === 0) {
        await recountTxs(client);
        await client.query(
          `UPDATE token_catalog_stats SET seed_phase = 'done' WHERE id = TRUE`
        );
        did = true;
      } else {
        await client.query(
          `UPDATE token_catalog_stats
           SET seed_height = $1, seed_box_id = $2
           WHERE id = TRUE`,
          [batch.lastH, batch.lastId]
        );
        did = true;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    did = false;
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn("[indexer] token stats catch-up", String(e));
  } finally {
    client.release();
  }
  const ms = Date.now() - t0;
  if (ms > 400) console.warn(`[indexer] token stats catch-up ${ms}ms`);
  return did;
}

export async function writeTokenKpis(
  pool: pg.Pool,
  height: number
): Promise<void> {
  const k = await pool.query<{
    tokens: string;
    named: string;
    nft_like: string;
  }>(
    `SELECT
       COUNT(*)::text AS tokens,
       COUNT(*) FILTER (WHERE name IS NOT NULL AND name <> '')::text AS named,
       COUNT(*) FILTER (WHERE emission = 1)::text AS nft_like
     FROM tokens`
  );
  const st = await catalog(pool);
  const row = k.rows[0];
  const holders = st.unique_holders;
  const txs = Number(st.unique_txs || 0);
  const holdersReady = st.seed_phase !== "balances" || holders > 0;
  const txsReady = st.seed_phase === "done" || txs > 0;
  await pool.query(
    `INSERT INTO snapshot_kv (key, payload, height, updated_at)
     VALUES ('tokens_kpis', $1::jsonb, $2, now())
     ON CONFLICT (key) DO UPDATE SET
       payload = EXCLUDED.payload,
       height = EXCLUDED.height,
       updated_at = now()`,
    [
      JSON.stringify({
        tokenCount: Number(row?.tokens || 0),
        namedCount: Number(row?.named || 0),
        nftLike: Number(row?.nft_like || 0),
        holderCount: holdersReady ? holders : null,
        txCount: txsReady ? txs : null,
      }),
      Number.isFinite(height) ? height : 0,
    ]
  );
}
