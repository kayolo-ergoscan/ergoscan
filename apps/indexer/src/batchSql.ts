/**
 * Multi-row SQL for one height (or one tx when BATCH_SQL=0).
 * Height order: tx_inputs → UPDATE existing spent → INSERT txs → boxes
 * (LEFT JOIN tx_inputs) → tokens/assets → address_tx.
 *
 * Postgres rejects two ON CONFLICT hits on the same key in one INSERT, so
 * callers may send duplicates; we collapse first.
 *
 * Do not stub-insert boxes for spends of not-yet-created ids. Deepen walks
 * down: creation comes later and insertBoxes already joins tx_inputs.
 */
import type pg from "pg";
import { packedWriteEnabled, textChainBoxesEnabled, textChainHeadersEnabled } from "./packed/flags.js";
import {
  writePackedAddressTx,
  writePackedAssets,
  writePackedBoxes,
  writePackedSpends,
  writePackedTransactions,
} from "./packed/liveWrite.js";

type Queryable = { query: pg.Pool["query"] };

export type SpendMark = {
  boxId: string;
  spentTxId: string;
  spentHeight: number;
  valueHint?: number;
  /** Even hex, or null when the spending proof is empty. */
  proofHex?: string | null;
};

export type BoxInsertRow = {
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

export type TokenUpsertRow = {
  tokenId: string;
  nftBoxId: string | null;
  firstHeight: number;
  lastHeight: number;
  emission: string | null;
  decimals?: number | null;
};

export type AssetInsertRow = {
  boxId: string;
  tokenId: string;
  amount: string;
  /** Position in the box's token list, node order (0-based). */
  index?: number | null;
};

export type AddressTxRow = {
  address: string;
  txId: string;
  height: number;
};

/** ON CONFLICT: live tx_count + first/last. Same CASE as token last_height. */
export const ADDRESS_SUMMARY_TX_BUMP_SET = `
       tx_count = address_summary.tx_count + EXCLUDED.tx_count,
       last_height = CASE
         WHEN address_summary.last_height IS NULL THEN EXCLUDED.last_height
         WHEN EXCLUDED.last_height IS NULL THEN address_summary.last_height
         ELSE GREATEST(address_summary.last_height, EXCLUDED.last_height)
       END,
       first_height = CASE
         WHEN address_summary.first_height IS NULL THEN EXCLUDED.first_height
         WHEN EXCLUDED.first_height IS NULL THEN address_summary.first_height
         ELSE LEAST(address_summary.first_height, EXCLUDED.first_height)
       END,
       updated_at = now()`;

export type TxInsertRow = {
  id: string;
  height: number;
  timestampMs: number;
  size: number | null;
  fee: number | null;
  indexInBlock: number;
  inputCount: number;
  outputCount: number;
  valueNano: number;
  shape: string;
  protocol: string | null;
  ruleId: string;
  rulesVersion: number;
  gix?: number | null;
};

function lastBy<T>(rows: T[], key: (row: T) => string): T[] {
  const m = new Map<string, T>();
  for (const row of rows) m.set(key(row), row);
  return [...m.values()];
}

function firstBy<T>(rows: T[], key: (row: T) => string): T[] {
  const m = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (!m.has(k)) m.set(k, row);
  }
  return [...m.values()];
}

function collapseBoxes(rows: BoxInsertRow[]): BoxInsertRow[] {
  const m = new Map<string, BoxInsertRow>();
  for (const row of rows) {
    const prev = m.get(row.boxId);
    if (!prev) {
      m.set(row.boxId, { ...row });
      continue;
    }
    // Same as sequential ON CONFLICT: last non-null for COALESCE columns,
    // last value_nano / creation_height / output_index.
    m.set(row.boxId, {
      boxId: row.boxId,
      creationHeight: row.creationHeight,
      valueNano: row.valueNano,
      ergoTree: row.ergoTree ?? prev.ergoTree,
      address: row.address ?? prev.address,
      creationTxId: row.creationTxId || prev.creationTxId,
      outputIndex: row.outputIndex,
      registers: row.registers ?? prev.registers,
    });
  }
  return [...m.values()];
}

function collapseTokens(rows: TokenUpsertRow[]): TokenUpsertRow[] {
  const m = new Map<string, TokenUpsertRow>();
  for (const row of rows) {
    const prev = m.get(row.tokenId);
    if (!prev) {
      m.set(row.tokenId, { ...row });
      continue;
    }
    prev.nftBoxId =
      prev.nftBoxId === prev.tokenId || row.nftBoxId === row.tokenId
        ? prev.tokenId
        : prev.nftBoxId ?? row.nftBoxId;
    prev.emission =
      prev.emission != null && row.emission != null
        ? (BigInt(prev.emission) + BigInt(row.emission)).toString()
        : prev.emission ?? row.emission;
    prev.decimals = prev.decimals ?? row.decimals;
    prev.firstHeight = Math.min(prev.firstHeight, row.firstHeight);
    prev.lastHeight = Math.max(prev.lastHeight, row.lastHeight);
  }
  return [...m.values()];
}

/** Record spends into tx_inputs; higher spent_height wins. Call before insertBoxes. */
export async function upsertTxInputs(
  client: Queryable,
  spends: SpendMark[]
): Promise<void> {
  const best = new Map<string, SpendMark>();
  for (const s of spends) {
    if (!s.boxId) continue;
    const prev = best.get(s.boxId);
    if (!prev || s.spentHeight > prev.spentHeight) best.set(s.boxId, s);
  }
  const rows = [...best.values()];
  if (!rows.length) return;
  await client.query(
    `INSERT INTO tx_inputs (box_id, spent_tx_id, spent_height)
     SELECT u.box_id, u.spent_tx_id, u.spent_height
     FROM unnest($1::text[], $2::text[], $3::bigint[])
       AS u(box_id, spent_tx_id, spent_height)
     ON CONFLICT (box_id) DO UPDATE SET
       spent_tx_id = CASE
         WHEN EXCLUDED.spent_height > tx_inputs.spent_height THEN EXCLUDED.spent_tx_id
         ELSE tx_inputs.spent_tx_id
       END,
       spent_height = GREATEST(tx_inputs.spent_height, EXCLUDED.spent_height)`,
    [
      rows.map((r) => r.boxId),
      rows.map((r) => r.spentTxId),
      rows.map((r) => r.spentHeight),
    ]
  );
}

/** Mark existing boxes spent. Missing ids stay in tx_inputs only — no stub row. */
export async function markSpentMany(
  client: Queryable,
  spends: SpendMark[]
): Promise<void> {
  if (!spends.length) return;
  if (textChainBoxesEnabled()) {
    await upsertTxInputs(client, spends);
    const groups = new Map<string, SpendMark[]>();
    for (const s of spends) {
      if (!s.boxId) continue;
      const k = `${s.spentTxId}\0${s.spentHeight}`;
      const list = groups.get(k);
      if (list) list.push(s);
      else groups.set(k, [s]);
    }
    for (const group of groups.values()) {
      const unique = lastBy(group, (s) => s.boxId);
      const ids = unique.map((s) => s.boxId);
      const spentTxId = unique[0].spentTxId;
      const spentHeight = unique[0].spentHeight;
      await client.query(
        `UPDATE boxes
         SET spent_tx_id = $2, spent_height = $3
         WHERE box_id = ANY($1::text[])`,
        [ids, spentTxId, spentHeight]
      );
    }
  }
  if (packedWriteEnabled()) await writePackedSpends(client, spends);
}

export async function insertTransactionsMany(
  client: Queryable,
  rows: TxInsertRow[]
): Promise<void> {
  const unique = lastBy(rows, (r) => r.id);
  if (!unique.length) return;
  if (packedWriteEnabled() && !textChainHeadersEnabled()) {
    await writePackedTransactions(client, unique);
    return;
  }
  await client.query(
    `INSERT INTO transactions (
       id, height, timestamp_ms, size, fee, index_in_block,
       input_count, output_count, value_nano, shape, protocol, rule_id, rules_version, gix
     )
     SELECT
       u.id, u.height, u.timestamp_ms, u.size, u.fee, u.index_in_block,
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
     ON CONFLICT (id) DO UPDATE SET
       height = EXCLUDED.height,
       timestamp_ms = EXCLUDED.timestamp_ms,
       size = EXCLUDED.size,
       fee = COALESCE(EXCLUDED.fee, transactions.fee),
       index_in_block = EXCLUDED.index_in_block,
       input_count = EXCLUDED.input_count,
       output_count = EXCLUDED.output_count,
       value_nano = COALESCE(EXCLUDED.value_nano, transactions.value_nano),
       shape = EXCLUDED.shape,
       protocol = EXCLUDED.protocol,
       rule_id = EXCLUDED.rule_id,
       rules_version = EXCLUDED.rules_version,
       gix = COALESCE(transactions.gix, EXCLUDED.gix)`,
    [
      unique.map((r) => r.id),
      unique.map((r) => r.height),
      unique.map((r) => r.timestampMs),
      unique.map((r) => r.size),
      unique.map((r) => r.fee),
      unique.map((r) => r.indexInBlock),
      unique.map((r) => r.inputCount),
      unique.map((r) => r.outputCount),
      unique.map((r) => r.valueNano),
      unique.map((r) => r.shape),
      unique.map((r) => r.protocol),
      unique.map((r) => r.ruleId),
      unique.map((r) => r.rulesVersion),
      unique.map((r) => r.gix ?? null),
    ]
  );
}

export async function bumpTokensForBoxes(
  client: Queryable,
  boxIds: string[],
  height: number
): Promise<void> {
  const ids = [...new Set(boxIds.filter(Boolean))];
  if (!ids.length) return;
  if (packedWriteEnabled()) {
    await client.query(
      `UPDATE tokens t
          SET last_height = CASE
            WHEN t.last_height IS NULL THEN $2
            ELSE GREATEST(t.last_height, $2)
          END
         FROM packed.box_assets a
        WHERE a.box_id IN (
                SELECT decode(lower(x), 'hex')
                  FROM unnest($1::text[]) AS x
                 WHERE x ~ '^[0-9a-fA-F]{64}$'
              )
          -- On tokens' text PK: hex32(t.token_id) walked all 140k tokens per block.
          AND t.token_id = encode(a.token_id, 'hex')`,
      [ids, height]
    );
    return;
  }
  await client.query(
    `UPDATE tokens t
     SET last_height = CASE
       WHEN t.last_height IS NULL THEN $2
       ELSE GREATEST(t.last_height, $2)
     END
     FROM box_assets a
     WHERE a.box_id = ANY($1::text[]) AND a.token_id = t.token_id`,
    [ids, height]
  );
}

export async function insertBoxesMany(
  client: Queryable,
  rows: BoxInsertRow[]
): Promise<void> {
  const unique = collapseBoxes(rows);
  if (!unique.length) return;
  if (packedWriteEnabled()) await writePackedBoxes(client, unique);
  if (!textChainBoxesEnabled()) return;
  await client.query(
    `INSERT INTO boxes (box_id, creation_height, value_nano, ergo_tree, address, creation_tx_id, output_index, additional_registers, spent_tx_id, spent_height, gix)
     SELECT
       u.box_id,
       u.creation_height,
       u.value_nano::bigint,
       u.ergo_tree,
       u.address,
       u.creation_tx_id,
       u.output_index,
       CASE WHEN u.regs IS NULL THEN NULL ELSE u.regs::jsonb END,
       t.spent_tx_id,
       t.spent_height,
       u.gix
     FROM unnest(
       $1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::bigint[]
     ) AS u(box_id, creation_height, value_nano, ergo_tree, address, creation_tx_id, output_index, regs, gix)
     LEFT JOIN tx_inputs t ON t.box_id = u.box_id
     ON CONFLICT (box_id) DO UPDATE SET
       address = COALESCE(EXCLUDED.address, boxes.address),
       value_nano = EXCLUDED.value_nano,
       creation_height = EXCLUDED.creation_height,
       creation_tx_id = COALESCE(EXCLUDED.creation_tx_id, boxes.creation_tx_id),
       ergo_tree = COALESCE(EXCLUDED.ergo_tree, boxes.ergo_tree),
       output_index = COALESCE(EXCLUDED.output_index, boxes.output_index),
       additional_registers = COALESCE(EXCLUDED.additional_registers, boxes.additional_registers),
       spent_tx_id = COALESCE(boxes.spent_tx_id, EXCLUDED.spent_tx_id),
       spent_height = COALESCE(boxes.spent_height, EXCLUDED.spent_height),
       gix = COALESCE(boxes.gix, EXCLUDED.gix)`,
    [
      unique.map((r) => r.boxId),
      unique.map((r) => r.creationHeight),
      unique.map((r) => r.valueNano),
      unique.map((r) => r.ergoTree),
      unique.map((r) => r.address),
      unique.map((r) => r.creationTxId),
      unique.map((r) => r.outputIndex),
      unique.map((r) => r.registers),
      unique.map((r) => r.gix ?? null),
    ]
  );
}

export async function upsertTokensMany(
  client: Queryable,
  rows: TokenUpsertRow[]
): Promise<void> {
  const unique = collapseTokens(rows);
  if (!unique.length) return;
  await client.query(
    `INSERT INTO tokens (token_id, box_id, first_height, last_height, emission, decimals)
     SELECT u.token_id, u.box_id, u.first_height, u.last_height, u.emission::numeric, u.decimals
     FROM unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::text[], $6::int[])
       AS u(token_id, box_id, first_height, last_height, emission, decimals)
     ON CONFLICT (token_id) DO UPDATE SET
       first_height = CASE
         WHEN tokens.first_height IS NULL THEN EXCLUDED.first_height
         WHEN EXCLUDED.first_height IS NULL THEN tokens.first_height
         ELSE LEAST(tokens.first_height, EXCLUDED.first_height)
       END,
       last_height = CASE
         WHEN tokens.last_height IS NULL THEN EXCLUDED.last_height
         WHEN EXCLUDED.last_height IS NULL THEN tokens.last_height
         ELSE GREATEST(tokens.last_height, EXCLUDED.last_height)
       END,
       box_id = COALESCE(
         CASE WHEN EXCLUDED.box_id = tokens.token_id THEN EXCLUDED.box_id END,
         tokens.box_id,
         EXCLUDED.box_id
       ),
       emission = COALESCE(EXCLUDED.emission, tokens.emission),
       decimals = COALESCE(EXCLUDED.decimals, tokens.decimals)`,
    [
      unique.map((r) => r.tokenId),
      unique.map((r) => r.nftBoxId),
      unique.map((r) => r.firstHeight),
      unique.map((r) => r.lastHeight),
      unique.map((r) => r.emission),
      unique.map((r) => r.decimals ?? null),
    ]
  );
}

/** Inserts new box_assets; returns rows that actually landed (xmax=0 equivalent). */
export async function insertBoxAssetsMany(
  client: Queryable,
  rows: AssetInsertRow[]
): Promise<AssetInsertRow[]> {
  const unique = firstBy(rows, (r) => `${r.boxId}\0${r.tokenId}`);
  if (!unique.length) return [];
  const packedFresh = packedWriteEnabled()
    ? await writePackedAssets(client, unique)
    : [];
  if (!textChainBoxesEnabled()) return packedFresh;
  const ins = await client.query<{ box_id: string; token_id: string }>(
    `INSERT INTO box_assets (box_id, token_id, amount)
     SELECT u.box_id, u.token_id, u.amount::numeric
     FROM unnest($1::text[], $2::text[], $3::text[]) AS u(box_id, token_id, amount)
     ON CONFLICT (box_id, token_id) DO NOTHING
     RETURNING box_id, token_id`,
    [
      unique.map((r) => r.boxId),
      unique.map((r) => r.tokenId),
      unique.map((r) => r.amount),
    ]
  );
  if (!ins.rows.length) return [];
  const amt = new Map(unique.map((r) => [`${r.boxId}\0${r.tokenId}`, r.amount]));
  const fresh: AssetInsertRow[] = [];
  for (const row of ins.rows) {
    const amount = amt.get(`${row.box_id}\0${row.token_id}`);
    if (amount == null) continue;
    fresh.push({ boxId: row.box_id, tokenId: row.token_id, amount });
  }
  return fresh;
}

async function bumpAddressTxCounts(
  client: Queryable,
  ins: { address: string; height: number | string; neu: boolean }[]
): Promise<void> {
  const bump = new Map<string, { n: number; minH: number; maxH: number }>();
  for (const row of ins) {
    if (!row.neu) continue;
    const h = Number(row.height);
    if (!Number.isFinite(h)) continue;
    const cur = bump.get(row.address);
    if (!cur) bump.set(row.address, { n: 1, minH: h, maxH: h });
    else {
      cur.n += 1;
      if (h < cur.minH) cur.minH = h;
      if (h > cur.maxH) cur.maxH = h;
    }
  }
  if (!bump.size) return;
  const short: string[] = [];
  const long: string[] = [];
  for (const address of bump.keys()) {
    if (address.length > 2000) long.push(address);
    else short.push(address);
  }
  const args = (addrs: string[]) => [
    addrs,
    addrs.map((a) => bump.get(a)?.n ?? 0),
    addrs.map((a) => bump.get(a)?.minH ?? 0),
    addrs.map((a) => bump.get(a)?.maxH ?? 0),
  ];
  if (short.length) {
    await client.query(
      `INSERT INTO address_summary (
         address, nanoerg, box_count, token_count, tx_count,
         first_height, last_height, updated_at
       )
       SELECT u.address, 0, 0, 0, u.n, u.min_h, u.max_h, now()
       FROM unnest($1::text[], $2::int[], $3::bigint[], $4::bigint[])
         AS u(address, n, min_h, max_h)
       ON CONFLICT (address) DO UPDATE SET
         ${ADDRESS_SUMMARY_TX_BUMP_SET}`,
      args(short)
    );
  }
  if (long.length) {
    await client.query(
      `INSERT INTO address_summary_long (
         addr_md5, address, nanoerg, box_count, token_count, tx_count,
         first_height, last_height, updated_at
       )
       SELECT md5(u.address), u.address, 0, 0, 0, u.n, u.min_h, u.max_h, now()
       FROM unnest($1::text[], $2::int[], $3::bigint[], $4::bigint[])
         AS u(address, n, min_h, max_h)
       ON CONFLICT (addr_md5) DO UPDATE SET
         tx_count = address_summary_long.tx_count + EXCLUDED.tx_count,
         last_height = CASE
           WHEN address_summary_long.last_height IS NULL THEN EXCLUDED.last_height
           WHEN EXCLUDED.last_height IS NULL THEN address_summary_long.last_height
           ELSE GREATEST(address_summary_long.last_height, EXCLUDED.last_height)
         END,
         first_height = CASE
           WHEN address_summary_long.first_height IS NULL THEN EXCLUDED.first_height
           WHEN EXCLUDED.first_height IS NULL THEN address_summary_long.first_height
           ELSE LEAST(address_summary_long.first_height, EXCLUDED.first_height)
         END,
         updated_at = now()`,
      args(long)
    );
  }
}

export async function upsertAddressTxMany(
  client: Queryable,
  rows: AddressTxRow[]
): Promise<void> {
  const unique = lastBy(rows, (r) => `${r.address}\0${r.txId}`);
  if (!unique.length) return;
  if (packedWriteEnabled()) {
    const packedRows = await writePackedAddressTx(client, unique);
    if (!textChainBoxesEnabled()) {
      await bumpAddressTxCounts(client, packedRows);
      return;
    }
  }
  const ins = await client.query<{
    address: string;
    height: number | string;
    neu: boolean;
  }>(
    `INSERT INTO address_tx (address, tx_id, height)
     SELECT u.address, u.tx_id, u.height
     FROM unnest($1::text[], $2::text[], $3::int[]) AS u(address, tx_id, height)
     ON CONFLICT (address, tx_id) DO UPDATE SET
       height = COALESCE(EXCLUDED.height, address_tx.height)
     RETURNING address, height, (xmax = 0) AS neu`,
    [
      unique.map((r) => r.address),
      unique.map((r) => r.txId),
      unique.map((r) => r.height),
    ]
  );
  await bumpAddressTxCounts(client, ins.rows);
}

export async function addressesForBoxIds(
  client: Queryable,
  boxIds: string[]
): Promise<Map<string, string | null>> {
  const ids = [...new Set(boxIds.filter(Boolean))];
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  if (textChainBoxesEnabled()) {
    const r = await client.query<{ box_id: string; address: string | null }>(
      `SELECT box_id, address FROM boxes WHERE box_id = ANY($1::text[])`,
      [ids]
    );
    for (const row of r.rows) out.set(row.box_id, row.address);
  }
  const missing = ids.filter((id) => !out.has(id) && /^[0-9a-fA-F]{64}$/.test(id));
  if (missing.length) {
    const packed = await client.query<{ box_id: string; address: string | null }>(
      `SELECT encode(b.box_id, 'hex') AS box_id, ad.address
         FROM packed.boxes b
         LEFT JOIN packed.addr ad ON ad.id = b.addr_id
        WHERE b.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
      [missing]
    );
    for (const row of packed.rows) out.set(row.box_id, row.address);
  }
  return out;
}
