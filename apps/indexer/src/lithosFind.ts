/**
 * One row per block that spends 1 LITHOS-COLLAT from the collateral contract.
 * The return from the park address is not a find. No node walk, no height cursor.
 * Ids go in through packed.hex32. LIT amounts stay numeric.
 */
import type pg from "pg";
import {
  LITHOS_COLLAT_ADDRESS,
  LITHOS_COLLAT_TOKEN_ID,
  LIT_TOKEN_ID_MAINNET,
  classifyLithosFind,
  type LithosFindParts,
  type LithosLitOut,
} from "@ergoscan/shared";

const PER_TICK = 4;

type Queryable = { query: pg.Pool["query"] };

const failedHeights = new Set<number>();
let granted = false;
/**
 * The pass ran on every indexer tick (~5 s) with or without a block. It now runs when the tip
 * (height + block id) moved, and at least once a minute (audit 12 Nov: Lithos only on a new tip).
 */
const SAME_TIP_RERUN_MS = 60_000;
let lastTipKey: string | null = null;
let lastRunAt = 0;

async function grantLithosFindRead(db: Queryable): Promise<void> {
  if (granted) return;
  granted = true;
  for (const role of ["ergoscan_gateway", "ergoscan_api"]) {
    try {
      await db.query(`GRANT SELECT ON packed.lithos_find TO ${role}`);
    } catch {
      /* role missing outside production */
    }
  }
}

type Candidate = {
  height: string;
  block_id: string;
  tx_id: string;
  r5: string | null;
};

type OutRow = {
  address: string;
  nano: string;
  lit: string | null;
};

async function loadOutputs(db: Queryable, txId: string): Promise<OutRow[] | null> {
  const rows = await db.query<OutRow>(
    `SELECT a.address,
            b.value_nano::text AS nano,
            ba.amount::text AS lit
       FROM packed.boxes b
       JOIN packed.addr a ON a.id = b.addr_id
       LEFT JOIN packed.box_assets ba
         ON ba.box_id = b.box_id
        AND ba.token_id = packed.hex32($2)
      WHERE b.creation_tx_id = packed.hex32($1)`,
    [txId, LIT_TOKEN_ID_MAINNET]
  );
  return rows.rows;
}

function litOutputs(rows: OutRow[]): LithosLitOut[] {
  const out: LithosLitOut[] = [];
  for (const row of rows) {
    if (!row.lit) continue;
    const raw = row.lit.split(".")[0] ?? "";
    if (!/^\d+$/.test(raw) || raw === "0") continue;
    out.push({ address: row.address, litRaw: raw });
  }
  return out;
}

function finderNano(rows: OutRow[], finder: string): string | null {
  const hit = rows.find((row) => row.address === finder);
  if (!hit || !/^\d+$/.test(hit.nano)) return null;
  return hit.nano;
}

async function insertFind(
  db: Queryable,
  row: Candidate,
  parts: LithosFindParts,
  nano: string
): Promise<void> {
  await db.query(
    `INSERT INTO packed.lithos_find (
       height, block_id, tx_id,
       finder_address, finder_lit, finder_nano,
       lender_address, permit_lit,
       holding_address, holding_lit,
       team_lit, investor_lit, auditor_lit
     ) VALUES (
       $1, packed.hex32($2), packed.hex32($3),
       $4, $5::numeric, $6::numeric,
       $7, $8::numeric,
       $9, $10::numeric,
       $11::numeric, $12::numeric, $13::numeric
     )
     ON CONFLICT (height) DO NOTHING`,
    [
      Number(row.height),
      row.block_id,
      row.tx_id,
      parts.finderAddress,
      parts.finderLit,
      nano,
      parts.lenderAddress,
      parts.permitLit,
      parts.holdingAddress,
      parts.holdingLit,
      parts.teamLit,
      parts.investorLit,
      parts.auditorLit,
    ]
  );
}

const SNAP_ROWS = 25;

type SnapRow = {
  height: string;
  block_id: string;
  tx_id: string;
  ts: string | null;
  finder_address: string;
  finder_lit: string;
  finder_nano: string;
  lender_address: string;
  permit_lit: string;
  holding_address: string;
  holding_lit: string;
  team_lit: string;
  investor_lit: string;
  auditor_lit: string;
};

function litInt(raw: string): string {
  const head = raw.split(".")[0] ?? "0";
  return /^\d+$/.test(head) ? head : "0";
}

async function writeLithosSnapshot(db: Queryable): Promise<void> {
  const sums = await db.query<{
    finds: string;
    finders: string;
    finder_lit: string;
    holding_lit: string;
    team_lit: string;
    investor_lit: string;
    auditor_lit: string;
  }>(
    `SELECT count(*)::text AS finds,
            count(DISTINCT finder_address)::text AS finders,
            COALESCE(sum(finder_lit), 0)::text AS finder_lit,
            COALESCE(sum(holding_lit), 0)::text AS holding_lit,
            COALESCE(sum(team_lit), 0)::text AS team_lit,
            COALESCE(sum(investor_lit), 0)::text AS investor_lit,
            COALESCE(sum(auditor_lit), 0)::text AS auditor_lit
       FROM packed.lithos_find`
  );
  const list = await db.query<SnapRow>(
    `SELECT f.height::text AS height,
            encode(f.block_id, 'hex') AS block_id,
            encode(f.tx_id, 'hex') AS tx_id,
            b.timestamp_ms::text AS ts,
            f.finder_address, f.finder_lit::text AS finder_lit, f.finder_nano::text AS finder_nano,
            f.lender_address, f.permit_lit::text AS permit_lit,
            f.holding_address, f.holding_lit::text AS holding_lit,
            f.team_lit::text AS team_lit,
            f.investor_lit::text AS investor_lit,
            f.auditor_lit::text AS auditor_lit
       FROM packed.lithos_find f
       LEFT JOIN packed.blocks b ON b.height = f.height
      ORDER BY f.height DESC
      LIMIT $1`,
    [SNAP_ROWS + 1]
  );
  const more = list.rows.length > SNAP_ROWS;
  const items = (more ? list.rows.slice(0, SNAP_ROWS) : list.rows).map(mapSnapRow);
  const last = items[items.length - 1];
  const sum = sums.rows[0];
  const payload = {
    finds: Number(sum?.finds ?? 0),
    finders: Number(sum?.finders ?? 0),
    finderLit: litInt(sum?.finder_lit ?? "0"),
    holdingLit: litInt(sum?.holding_lit ?? "0"),
    teamLit: litInt(sum?.team_lit ?? "0"),
    investorLit: litInt(sum?.investor_lit ?? "0"),
    auditorLit: litInt(sum?.auditor_lit ?? "0"),
    items,
    hasMore: more,
    nextCursor: more && last ? String(last.height) : null,
  };
  const height = items[0]?.height ?? 0;
  await db.query(
    `INSERT INTO snapshot_kv (key, payload, height, updated_at)
     VALUES ('lithos_protocol', $1::jsonb, $2, now())
     ON CONFLICT (key) DO UPDATE SET
       payload = EXCLUDED.payload,
       height = EXCLUDED.height,
       updated_at = now()`,
    [JSON.stringify(payload), height]
  );
}

function mapSnapRow(row: SnapRow) {
  return {
    height: Number(row.height),
    blockId: row.block_id,
    txId: row.tx_id,
    ts: row.ts != null ? Number(row.ts) : null,
    finderAddress: row.finder_address,
    finderLit: litInt(row.finder_lit),
    finderNano: litInt(row.finder_nano),
    lenderAddress: row.lender_address,
    permitLit: litInt(row.permit_lit),
    holdingAddress: row.holding_address,
    holdingLit: litInt(row.holding_lit),
    teamLit: litInt(row.team_lit),
    investorLit: litInt(row.investor_lit),
    auditorLit: litInt(row.auditor_lit),
  };
}

export async function maybeWriteLithosFinds(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const head = await client.query<{ k: string }>(
      `SELECT height::text || ':' || encode(id, 'hex') AS k FROM packed.blocks ORDER BY height DESC LIMIT 1`
    );
    const tipKey = head.rows[0]?.k ?? "";
    if (tipKey && tipKey === lastTipKey && Date.now() - lastRunAt < SAME_TIP_RERUN_MS) return;
    await grantLithosFindRead(client);
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '8s'`);
    const found = await client.query<Candidate>(
      `SELECT i.spent_height::text AS height,
              encode(b.id, 'hex') AS block_id,
              encode(i.spent_tx_id, 'hex') AS tx_id,
              bx.additional_registers->>'R5' AS r5
         FROM packed.box_assets ba
         JOIN packed.boxes bx ON bx.box_id = ba.box_id
         JOIN packed.tx_inputs i ON i.box_id = ba.box_id
         JOIN packed.addr a ON a.id = bx.addr_id
         JOIN packed.blocks b ON b.height = i.spent_height
        WHERE ba.token_id = packed.hex32($1)
          AND ba.amount = 1
          AND a.address = $2
          -- NOT IN over the key is one hashed subplan. NOT EXISTS became a nested anti join that
          -- seq-scanned lithos_find once per collateral spend (813 × 814 rows, ~23 k scans a minute).
          AND i.spent_height NOT IN (SELECT f.height FROM packed.lithos_find f)
        ORDER BY i.spent_height
        LIMIT $3`,
      [LITHOS_COLLAT_TOKEN_ID, LITHOS_COLLAT_ADDRESS, PER_TICK]
    );
    for (const row of found.rows) {
      const height = Number(row.height);
      if (failedHeights.has(height)) continue;
      const outputs = await loadOutputs(client, row.tx_id);
      const parts = outputs ? classifyLithosFind(row.r5, litOutputs(outputs)) : null;
      const nano = parts && outputs ? finderNano(outputs, parts.finderAddress) : null;
      if (!parts || !nano) {
        failedHeights.add(height);
        console.warn(`[indexer] lithos find skip ${height}`);
        continue;
      }
      await insertFind(client, row, parts, nano);
      console.log(
        `[indexer] lithos find ${height} finder=${parts.finderLit} holding=${parts.holdingLit}`
      );
    }
    await writeLithosSnapshot(client);
    await client.query("COMMIT");
    lastTipKey = tipKey;
    lastRunAt = Date.now();
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn("[indexer] lithos find", String(e));
  } finally {
    client.release();
  }
}
