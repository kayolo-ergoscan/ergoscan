/**
 * Nautilus / Fleet reads. Index only, except check and submit, which post to the node.
 * Amounts stay decimal strings. No gix scan.
 */
import { graphql, parse, specifiedRules, validate, buildSchema, type GraphQLSchema } from "graphql";
import { isMinerFeeBox, type RawTx } from "@ergoscan/shared";
import { getIndexPool } from "../lib/indexDb.js";
import { validateSignedTx } from "../lib/submit-tx.js";
import { depthError, documentDepth } from "./depth.js";
import { GRAPHQL_MAX_BODY } from "./schema.js";
import { NAUTILUS_SDL, NAUTILUS_VERSION } from "./nautilusSchema.js";

export type NautilusCtx = {
  getRawMempool: () => Map<string, RawTx>;
  getFullHeight: () => number | null | undefined;
  submitTx: (body: unknown) => Promise<unknown>;
  checkTx?: (body: unknown) => Promise<unknown>;
  network: string;
};

type Row = Record<string, unknown>;
type Sql = (text: string, params?: unknown[]) => Promise<Row[]>;

const ADDR_MAX = 20;
const ID_MAX = 20;
const TREE_MAX = 20;
const TAKE_CAP = 50;
/**
 * Nautilus walks `skip += take` until a short page.
 * Clamping skip repeated the page at 2000, so a fat address never summed to its balance.
 * 100000 covers the fattest unspent stack in the index (~78000) with room to grow.
 * Past the cap the page is empty and the walk stops.
 */
const SKIP_CAP = 100_000;
const ASSET_CAP = 400;

let schema: GraphQLSchema | null = null;

export function nautilusSchema(): GraphQLSchema {
  if (!schema) schema = buildSchema(NAUTILUS_SDL);
  return schema;
}

/** A failed index read must not look like an empty wallet (12 Nov 2026 audit). */
export const INDEX_UNAVAILABLE = "index_unavailable";

async function defaultSql(text: string, params: unknown[] = []): Promise<Row[]> {
  const pool = getIndexPool();
  if (!pool) throw new Error(INDEX_UNAVAILABLE);
  try {
    const r = await pool.query<Row>(text, params);
    return r.rows;
  } catch (e) {
    console.warn("[graphql] nautilus", String(e).slice(0, 240));
    throw new Error(INDEX_UNAVAILABLE);
  }
}

function digits(v: unknown): string {
  if (typeof v === "bigint") return v >= 0n ? v.toString() : "0";
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return "0";
}

export function nautilusPage(
  args: { skip?: unknown; take?: unknown },
  fallback: number
): { skip: number; take: number } {
  const takeRaw = args.take == null ? fallback : Number(args.take);
  const skipRaw = args.skip == null ? 0 : Number(args.skip);
  const take = Number.isFinite(takeRaw) ? Math.max(0, Math.min(TAKE_CAP, Math.floor(takeRaw))) : fallback;
  if (!Number.isFinite(skipRaw) || skipRaw <= 0) return { skip: 0, take };
  const skip = Math.floor(skipRaw);
  if (skip > SKIP_CAP) return { skip: 0, take: 0 };
  return { skip, take };
}

function texts(v: unknown, max: number, maxLen: number): string[] {
  const list = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s || s.length > maxLen) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function hexIds(v: unknown, max = ID_MAX): string[] {
  return texts(v, max, 64).filter((s) => /^[0-9a-fA-F]{64}$/.test(s)).map((s) => s.toLowerCase());
}

function oneHex(v: unknown): string | null {
  return hexIds(v, 1)[0] ?? null;
}

export function votesFromHex(hex: unknown): number[] {
  if (typeof hex !== "string" || !/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return [];
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function powD(raw: unknown): string {
  const s = raw == null ? "" : String(raw);
  if (!/^\d+$/.test(s)) return "0";
  return s;
}

export function headerFromRow(row: Row): Row {
  const pk = typeof row.miner_pk === "string" ? row.miner_pk.toLowerCase() : "";
  return {
    headerId: String(row.id ?? ""),
    parentId: String(row.parent ?? ""),
    version: Number(row.version) || 0,
    height: Number(row.height) || 0,
    nBits: digits(row.n_bits),
    difficulty: digits(row.difficulty),
    timestamp: digits(row.ts),
    stateRoot: String(row.state_root ?? ""),
    adProofsRoot: String(row.ad ?? ""),
    transactionsRoot: String(row.txr ?? ""),
    extensionHash: String(row.ext ?? ""),
    powSolutions: {
      pk,
      w: String(row.w ?? ""),
      n: String(row.n ?? ""),
      d: powD(row.d),
    },
    votes: votesFromHex(row.votes),
  };
}

function registersOf(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* not json */
    }
  }
  return {};
}

function shapeBox(row: Row, assets: { tokenId: string; amount: string; index?: number }[], spent: Set<string>): Row {
  const boxId = String(row.boxId ?? "");
  return {
    boxId,
    transactionId: String(row.transactionId ?? ""),
    index: Number(row.index) || 0,
    value: digits(row.value),
    creationHeight: Number(row.creationHeight) || 0,
    ergoTree: String(row.ergoTree ?? ""),
    address: String(row.address ?? ""),
    assets,
    additionalRegisters: registersOf(row.registers),
    beingSpent: spent.has(boxId),
  };
}

function mempoolSpent(txs: Iterable<RawTx>): Set<string> {
  const spent = new Set<string>();
  for (const tx of txs) {
    for (const input of tx.inputs ?? []) {
      if (input.boxId) spent.add(input.boxId.toLowerCase());
    }
  }
  return spent;
}

function assetList(
  raw: { tokenId?: string; amount?: number | string }[] | undefined
): { tokenId: string; amount: string; index: number }[] {
  const out: { tokenId: string; amount: string; index: number }[] = [];
  for (const asset of raw ?? []) {
    if (!asset.tokenId) continue;
    out.push({ tokenId: asset.tokenId.toLowerCase(), amount: digits(asset.amount), index: out.length });
  }
  return out;
}

function boxFromMempool(
  box: {
    boxId?: string;
    value?: number | string;
    ergoTree?: string;
    address?: string;
    additionalRegisters?: Record<string, string>;
    creationHeight?: number;
    transactionId?: string;
    index?: number;
    assets?: { tokenId?: string; amount?: number | string }[];
  },
  txId: string,
  spent: Set<string>
): Row {
  const boxId = (box.boxId ?? "").toLowerCase();
  return {
    boxId,
    transactionId: (box.transactionId ?? txId).toLowerCase(),
    index: box.index ?? 0,
    value: digits(box.value),
    creationHeight: box.creationHeight ?? 0,
    ergoTree: box.ergoTree ?? "",
    address: box.address ?? "",
    assets: assetList(box.assets),
    additionalRegisters: box.additionalRegisters ?? {},
    beingSpent: spent.has(boxId),
  };
}

async function addrIds(sql: Sql, addresses: string[]): Promise<Map<string, number>> {
  if (!addresses.length) return new Map();
  const rows = await sql(
    `SELECT a.id::text AS id, a.address
       FROM unnest($1::text[]) AS u(address)
       JOIN packed.addr a ON a.addr_md5 = md5(u.address) AND a.address = u.address`,
    [addresses]
  );
  const out = new Map<string, number>();
  for (const row of rows) out.set(String(row.address), Number(row.id));
  return out;
}

async function scriptIds(sql: Sql, trees: string[]): Promise<number[]> {
  if (!trees.length) return [];
  const rows = await sql(
    `SELECT s.id::text AS id
       FROM unnest($1::text[]) AS u(tree)
       JOIN packed.script s ON s.tree_md5 = md5(u.tree) AND s.ergo_tree = u.tree`,
    [trees]
  );
  return rows.map((row) => Number(row.id)).filter((n) => Number.isFinite(n));
}

const BOX_SELECT = `
SELECT encode(b.box_id, 'hex') AS "boxId",
       COALESCE(encode(b.creation_tx_id, 'hex'), '') AS "transactionId",
       COALESCE(b.output_index, 0) AS "index",
       b.value_nano::text AS value,
       COALESCE(b.creation_height, 0) AS "creationHeight",
       COALESCE(sc.ergo_tree, '') AS "ergoTree",
       COALESCE(ad.address, '') AS address,
       b.additional_registers AS registers
  FROM packed.boxes b
  LEFT JOIN packed.script sc ON sc.id = b.script_id
  LEFT JOIN packed.addr ad ON ad.id = b.addr_id`;

async function attachAssets(sql: Sql, rows: Row[], spent: Set<string>): Promise<Row[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.boxId));
  const assets = await sql(
    `SELECT encode(box_id, 'hex') AS box_id,
            encode(token_id, 'hex') AS token_id,
            amount::text AS amount
       FROM packed.box_assets
      WHERE box_id IN (SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)
      ORDER BY box_id, asset_index NULLS LAST, token_id`,
    [ids]
  );
  const byBox = new Map<string, { tokenId: string; amount: string; index: number }[]>();
  for (const asset of assets) {
    const id = String(asset.box_id);
    const list = byBox.get(id) ?? [];
    list.push({ tokenId: String(asset.token_id), amount: digits(asset.amount), index: list.length });
    byBox.set(id, list);
  }
  return rows.map((row) => shapeBox(row, byBox.get(String(row.boxId)) ?? [], spent));
}

async function loadBoxes(sql: Sql, args: Row, spent: Set<string>): Promise<Row[]> {
  const { skip, take } = nautilusPage(args, 50);
  if (take === 0) return [];
  const boxIds = hexIds([...(hexIds(args.boxIds)), ...(oneHex(args.boxId) ? [oneHex(args.boxId)!] : [])]);
  const trees = texts([...(texts(args.ergoTrees, TREE_MAX, 20_000)), ...(texts(args.ergoTree, 1, 20_000))], TREE_MAX, 20_000);
  const addresses = texts(
    [...texts(args.addresses, ADDR_MAX, 8000), ...texts(args.address, 1, 8000)],
    ADDR_MAX,
    8000
  );
  const tokenId = oneHex(args.tokenId);
  const txId = oneHex(args.transactionId);
  const headerId = oneHex(args.headerId);
  const template = oneHex(args.ergoTreeTemplateHash);
  const spentFlag = args.spent === true ? true : args.spent === false ? false : null;
  const minH = Number.isFinite(Number(args.minHeight)) ? Math.floor(Number(args.minHeight)) : null;
  const maxH = Number.isFinite(Number(args.maxHeight)) ? Math.floor(Number(args.maxHeight)) : null;

  const where: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (boxIds.length) {
    where.push(`b.box_id IN (SELECT decode(x, 'hex') FROM unnest(${bind(boxIds)}::text[]) AS x)`);
  }
  if (trees.length) {
    const ids = await scriptIds(sql, trees);
    if (!ids.length) return [];
    where.push(`b.script_id = ANY(${bind(ids)}::bigint[])`);
    where.push(`b.creation_height IS NOT NULL`);
  }
  if (addresses.length) {
    const ids = [...(await addrIds(sql, addresses)).values()];
    if (!ids.length) return [];
    where.push(`b.addr_id = ANY(${bind(ids)}::bigint[])`);
    where.push(`b.creation_height IS NOT NULL`);
  }
  if (tokenId) {
    where.push(
      `EXISTS (SELECT 1 FROM packed.box_assets a WHERE a.box_id = b.box_id AND a.token_id = decode(${bind(tokenId)}, 'hex'))`
    );
  }
  if (txId) where.push(`b.creation_tx_id = decode(${bind(txId)}, 'hex')`);
  if (headerId) {
    where.push(
      `b.creation_height = (SELECT height FROM packed.blocks WHERE id = decode(${bind(headerId)}, 'hex') LIMIT 1)`
    );
  }
  if (template) {
    where.push(
      `b.box_id IN (SELECT box_id FROM packed.box_template WHERE template_hash = decode(${bind(template)}, 'hex'))`
    );
  }
  if (!where.length) return [];
  if (spentFlag === false) where.push(`b.spent_tx_id IS NULL`);
  if (spentFlag === true) where.push(`b.spent_tx_id IS NOT NULL`);
  if (minH != null) where.push(`b.creation_height >= ${bind(minH)}`);
  if (maxH != null) where.push(`b.creation_height <= ${bind(maxH)}`);

  params.push(take, skip);
  const rows = await sql(
    `${BOX_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY b.creation_height DESC NULLS LAST, b.box_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return attachAssets(sql, rows, spent);
}

function filterMempoolBoxes(txs: RawTx[], args: Row, spent: Set<string>): Row[] {
  const { skip, take } = nautilusPage(args, 50);
  const ids = new Set(hexIds([...(hexIds(args.boxIds)), ...(oneHex(args.boxId) ? [oneHex(args.boxId)!] : [])]));
  const trees = new Set(texts([...(texts(args.ergoTrees, TREE_MAX, 20_000)), ...texts(args.ergoTree, 1, 20_000)], TREE_MAX, 20_000));
  const addresses = new Set(
    texts([...texts(args.addresses, ADDR_MAX, 8000), ...texts(args.address, 1, 8000)], ADDR_MAX, 8000)
  );
  const token = oneHex(args.tokenId);
  const txId = oneHex(args.transactionId);
  const found: Row[] = [];
  for (const tx of txs) {
    if (txId && tx.id.toLowerCase() !== txId) continue;
    for (const box of tx.outputs ?? []) {
      const id = (box.boxId ?? "").toLowerCase();
      if (ids.size && !ids.has(id)) continue;
      if (trees.size && !trees.has(box.ergoTree ?? "")) continue;
      if (addresses.size && !addresses.has(box.address ?? "")) continue;
      if (token && !(box.assets ?? []).some((asset) => asset.tokenId?.toLowerCase() === token)) continue;
      found.push(boxFromMempool(box, tx.id, spent));
    }
  }
  return found.slice(skip, skip + take);
}

async function loadState(sql: Sql, ctx: NautilusCtx): Promise<Row> {
  const rows = await sql(
    `SELECT height, encode(id, 'hex') AS id, difficulty
       FROM packed.blocks
      ORDER BY height DESC
      LIMIT 1`
  );
  const row = rows[0];
  const height = Number(row?.height ?? ctx.getFullHeight() ?? 0) || 0;
  const heightText = String(height);
  return {
    network: ctx.network || "mainnet",
    blockId: String(row?.id ?? ""),
    height,
    boxGlobalIndex: heightText,
    transactionGlobalIndex: heightText,
    difficulty: digits(row?.difficulty),
    params: { height },
  };
}

async function loadHeaders(sql: Sql, args: Row): Promise<Row[]> {
  const { skip, take } = nautilusPage(args, 10);
  if (take === 0) return [];
  const headerIds = hexIds([...(hexIds(args.headerIds)), ...(oneHex(args.headerId) ? [oneHex(args.headerId)!] : [])]);
  const parentId = oneHex(args.parentId);
  const height = Number.isFinite(Number(args.height)) ? Math.floor(Number(args.height)) : null;
  const where = ["state_root IS NOT NULL"];
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (headerIds.length) {
    where.push(`id IN (SELECT decode(x, 'hex') FROM unnest(${bind(headerIds)}::text[]) AS x)`);
  }
  if (parentId) where.push(`parent_id = decode(${bind(parentId)}, 'hex')`);
  if (height != null) where.push(`height = ${bind(height)}`);
  params.push(take, skip);
  const rows = await sql(
    `SELECT height,
            encode(id, 'hex') AS id,
            COALESCE(encode(parent_id, 'hex'), '') AS parent,
            timestamp_ms::text AS ts,
            version,
            n_bits::text AS n_bits,
            encode(votes, 'hex') AS votes,
            encode(state_root, 'hex') AS state_root,
            encode(ad_proofs_root, 'hex') AS ad,
            encode(transactions_root, 'hex') AS txr,
            encode(extension_hash, 'hex') AS ext,
            miner_pk,
            encode(pow_w, 'hex') AS w,
            encode(pow_n, 'hex') AS n,
            pow_d::text AS d,
            difficulty
       FROM packed.blocks
      WHERE ${where.join(" AND ")}
      ORDER BY height DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(headerFromRow);
}

async function loadAddresses(sql: Sql, args: Row): Promise<Row[]> {
  const addresses = texts(args.addresses, ADDR_MAX, 8000);
  if (!addresses.length) return [];
  const short = addresses.filter((address) => address.length <= 2000);
  const long = addresses.filter((address) => address.length > 2000);
  const [shortRows, longRows, assetRows] = await Promise.all([
    short.length
      ? sql(
          `SELECT address, nanoerg::text AS nano, tx_count, box_count
             FROM address_summary
            WHERE address = ANY($1::text[])`,
          [short]
        )
      : Promise.resolve([]),
    long.length
      ? sql(
          `SELECT address, nanoerg::text AS nano, tx_count, box_count
             FROM address_summary_long
            WHERE addr_md5 = ANY(SELECT md5(x) FROM unnest($1::text[]) AS x)
              AND address = ANY($1::text[])`,
          [long]
        )
      : Promise.resolve([]),
    sql(
      `SELECT address, token_id, amount::text AS amount
         FROM token_balances
        WHERE address = ANY($1::text[]) AND amount > 0
        LIMIT ${ASSET_CAP}`,
      [addresses]
    ),
  ]);
  const summary = new Map<string, Row>();
  for (const row of [...shortRows, ...longRows]) summary.set(String(row.address), row);
  const assets = new Map<string, { tokenId: string; amount: string }[]>();
  for (const row of assetRows) {
    const address = String(row.address);
    const list = assets.get(address) ?? [];
    list.push({ tokenId: String(row.token_id), amount: digits(row.amount) });
    assets.set(address, list);
  }
  return addresses.map((address) => {
    const row = summary.get(address);
    const held = assets.get(address) ?? [];
    const nano = digits(row?.nano);
    const used = Number(row?.tx_count) > 0 || Number(row?.box_count) > 0 || nano !== "0";
    return {
      address,
      used,
      balance: {
        nanoErgs: nano,
        assets(filter?: { tokenId?: string }) {
          const id = filter?.tokenId?.toLowerCase();
          return id ? held.filter((asset) => asset.tokenId === id) : held;
        },
      },
    };
  });
}

async function boxesByTx(sql: Sql, column: "creation_tx_id" | "spent_tx_id", ids: string[], spent: Set<string>): Promise<Map<string, Row[]>> {
  const grouped = new Map<string, Row[]>();
  if (!ids.length) return grouped;
  const rows = await sql(
    `${BOX_SELECT}
      WHERE b.${column} IN (SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`,
    [ids]
  );
  const shaped = await attachAssets(sql, rows, spent);
  const txKey = column === "creation_tx_id" ? "transactionId" : null;
  if (txKey) {
    for (const box of shaped) {
      const id = String(box.transactionId);
      const list = grouped.get(id) ?? [];
      list.push(box);
      grouped.set(id, list);
    }
    return grouped;
  }
  const spentRows = await sql(
    `SELECT encode(box_id, 'hex') AS box_id, encode(spent_tx_id, 'hex') AS tx_id
       FROM packed.boxes
      WHERE spent_tx_id IN (SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`,
    [ids]
  );
  const owner = new Map(spentRows.map((row) => [String(row.box_id), String(row.tx_id)]));
  for (const box of shaped) {
    const id = owner.get(String(box.boxId));
    if (!id) continue;
    const list = grouped.get(id) ?? [];
    list.push(box);
    grouped.set(id, list);
  }
  return grouped;
}

/** Wallet history asks for its own outputs plus the miner-fee box. Nautilus reads the fee from that box's ergoTree. */
export function relevantOutputs(outputs: Row[], addresses: Set<string>): Row[] {
  return outputs.filter((box) => {
    const address = String(box.address ?? "");
    if (addresses.has(address)) return true;
    const ergoTree = typeof box.ergoTree === "string" ? box.ergoTree : "";
    return isMinerFeeBox({ address, ergoTree });
  });
}

/** Even hex from the index or a node proof. Empty and junk stay "". */
export function proofText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const hex = raw.trim().toLowerCase();
  if (hex.length < 2 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return "";
  return hex;
}

async function inputProofs(sql: Sql, boxIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(boxIds.filter((id) => /^[0-9a-f]{64}$/.test(id)))];
  if (!ids.length) return new Map();
  const rows = await sql(
    `SELECT encode(box_id, 'hex') AS box_id, encode(proof_bytes, 'hex') AS proof
       FROM packed.tx_inputs
      WHERE box_id IN (SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)
        AND proof_bytes IS NOT NULL`,
    [ids]
  );
  return new Map(rows.map((row) => [String(row.box_id), proofText(row.proof)]));
}

function txObject(
  row: Row,
  inputs: Row[],
  outputs: Row[],
  addresses: Set<string>,
  dataInputs: { boxId: string }[] = [],
  proofs: Map<string, string> = new Map()
): Row {
  return {
    transactionId: String(row.id ?? ""),
    timestamp: digits(row.ts),
    inclusionHeight: Number(row.height) || 0,
    headerId: String(row.header ?? ""),
    index: Number(row.index) || 0,
    inputs: inputs.map((box, index) => ({
      proofBytes: proofs.get(String(box.boxId ?? "").toLowerCase()) ?? "",
      extension: {},
      index,
      box,
    })),
    dataInputs,
    outputs(filter?: { relevantOnly?: boolean }) {
      if (filter?.relevantOnly && addresses.size) return relevantOutputs(outputs, addresses);
      return outputs;
    },
  };
}

async function loadTransactions(sql: Sql, args: Row, spent: Set<string>): Promise<Row[]> {
  const { skip, take } = nautilusPage(args, 50);
  if (take === 0) return [];
  const ids = hexIds([...(hexIds(args.transactionIds)), ...(oneHex(args.transactionId) ? [oneHex(args.transactionId)!] : [])]);
  const addresses = texts(
    [...texts(args.addresses, ADDR_MAX, 8000), ...texts(args.address, 1, 8000)],
    ADDR_MAX,
    8000
  );
  const headerId = oneHex(args.headerId);
  const minH = Number.isFinite(Number(args.minHeight)) ? Math.floor(Number(args.minHeight)) : null;
  const maxH = Number.isFinite(Number(args.maxHeight)) ? Math.floor(Number(args.maxHeight)) : null;
  let idRows: Row[] = [];
  if (ids.length) {
    idRows = ids.map((id) => ({ id }));
  } else if (addresses.length) {
    const addr = await addrIds(sql, addresses);
    const addrList = [...addr.values()];
    if (!addrList.length) return [];
    const params: unknown[] = [addrList];
    const where = ["addr_id = ANY($1::bigint[])"];
    if (minH != null) {
      params.push(minH);
      where.push(`height >= $${params.length}`);
    }
    if (maxH != null) {
      params.push(maxH);
      where.push(`height <= $${params.length}`);
    }
    if (headerId) {
      params.push(headerId);
      where.push(`height = (SELECT height FROM packed.blocks WHERE id = decode($${params.length}, 'hex') LIMIT 1)`);
    }
    params.push(take, skip);
    idRows = await sql(
      `SELECT encode(tx_id, 'hex') AS id, MAX(height) AS height
         FROM packed.address_tx
        WHERE ${where.join(" AND ")}
        GROUP BY tx_id
        ORDER BY MAX(height) DESC, tx_id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
  } else if (headerId) {
    idRows = await sql(
      `SELECT encode(t.id, 'hex') AS id, t.height
         FROM packed.transactions t
         JOIN packed.blocks b ON b.height = t.height
        WHERE b.id = decode($1, 'hex')
        ORDER BY t.index_in_block ASC NULLS LAST, t.id
        LIMIT $2 OFFSET $3`,
      [headerId, take, skip]
    );
  } else {
    return [];
  }
  const pageIds = idRows.map((row) => String(row.id)).filter((id) => /^[0-9a-f]{64}$/.test(id));
  const sliced = ids.length ? pageIds.slice(skip, skip + take) : pageIds;
  if (!sliced.length) return [];
  const [txs, outputs, inputs] = await Promise.all([
    sql(
      `SELECT encode(t.id, 'hex') AS id,
              t.height,
              COALESCE(t.timestamp_ms, b.timestamp_ms)::text AS ts,
              COALESCE(t.index_in_block, 0) AS index,
              COALESCE(encode(b.id, 'hex'), '') AS header
         FROM packed.transactions t
         LEFT JOIN packed.blocks b ON b.height = t.height
        WHERE t.id IN (SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`,
      [sliced]
    ),
    boxesByTx(sql, "creation_tx_id", sliced, spent),
    boxesByTx(sql, "spent_tx_id", sliced, spent),
  ]);
  const boxIds: string[] = [];
  for (const list of inputs.values()) {
    for (const box of list) {
      const id = String(box.boxId ?? "").toLowerCase();
      if (id) boxIds.push(id);
    }
  }
  const proofs = await inputProofs(sql, boxIds);
  const byId = new Map(txs.map((row) => [String(row.id), row]));
  const wanted = new Set(addresses);
  return sliced.map((id) =>
    txObject(
      byId.get(id) ?? { id, height: 0, ts: "0", index: 0, header: "" },
      inputs.get(id) ?? [],
      outputs.get(id) ?? [],
      wanted,
      [],
      proofs
    )
  );
}

async function loadTokens(sql: Sql, args: Row, spent: Set<string>): Promise<Row[]> {
  const { skip, take } = nautilusPage(args, 50);
  if (take === 0) return [];
  const ids = hexIds([...(hexIds(args.tokenIds)), ...(oneHex(args.tokenId) ? [oneHex(args.tokenId)!] : [])]);
  const boxId = oneHex(args.boxId);
  const name = texts(args.name, 1, 200)[0] ?? "";
  let rows: Row[] = [];
  if (ids.length) {
    rows = await sql(
      `SELECT token_id, name, description, decimals, emission::text AS emission, box_id
         FROM tokens
        WHERE token_id = ANY($1::text[])`,
      [ids.slice(skip, skip + take)]
    );
  } else if (boxId) {
    rows = await sql(
      `SELECT token_id, name, description, decimals, emission::text AS emission, box_id
         FROM tokens
        WHERE box_id = $1
        LIMIT $2 OFFSET $3`,
      [boxId, take, skip]
    );
  } else if (name) {
    rows = await sql(
      `SELECT token_id, name, description, decimals, emission::text AS emission, box_id
         FROM tokens
        WHERE lower(name) = lower($1)
        ORDER BY token_id
        LIMIT $2 OFFSET $3`,
      [name, take, skip]
    );
  } else {
    return [];
  }
  const boxIds = rows.map((row) => String(row.box_id ?? "")).filter((id) => /^[0-9a-f]{64}$/.test(id));
  const boxes = boxIds.length
    ? await attachAssets(
        sql,
        await sql(`${BOX_SELECT} WHERE b.box_id IN (SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`, [boxIds]),
        spent
      )
    : [];
  const byBox = new Map(boxes.map((box) => [String(box.boxId), box]));
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(String(a.token_id)) ?? 0) - (order.get(String(b.token_id)) ?? 0));
  return rows.map((row) => {
    const id = String(row.box_id ?? "");
    const box =
      byBox.get(id) ??
      shapeBox(
        {
          boxId: id,
          transactionId: "",
          index: 0,
          value: "0",
          creationHeight: 0,
          ergoTree: "",
          address: "",
          registers: {},
        },
        [],
        spent
      );
    return {
      tokenId: String(row.token_id),
      boxId: id,
      emissionAmount: digits(row.emission),
      name: row.name == null ? null : String(row.name),
      description: row.description == null ? null : String(row.description),
      type: "EIP-004",
      decimals: row.decimals == null ? null : Number(row.decimals),
      box,
    };
  });
}

function mempoolTransactions(txs: RawTx[], args: Row, spent: Set<string>): Row[] {
  const { skip, take } = nautilusPage(args, 50);
  const ids = new Set(hexIds([...(hexIds(args.transactionIds)), ...(oneHex(args.transactionId) ? [oneHex(args.transactionId)!] : [])]));
  const addresses = new Set(
    texts([...texts(args.addresses, ADDR_MAX, 8000), ...texts(args.address, 1, 8000)], ADDR_MAX, 8000)
  );
  const found: Row[] = [];
  for (const tx of txs) {
    const id = tx.id.toLowerCase();
    if (ids.size && !ids.has(id)) continue;
    const inputs = (tx.inputs ?? []).map((input, index) => ({
      proofBytes: proofText((input as { spendingProof?: { proofBytes?: unknown } }).spendingProof?.proofBytes),
      extension: {},
      index: input.index ?? index,
      box: input.boxId ? boxFromMempool(input, input.transactionId ?? "", spent) : null,
    }));
    const outputs = (tx.outputs ?? []).map((output) => boxFromMempool(output, id, spent));
    if (addresses.size) {
      const hit = [...inputs, ...outputs].some((row) => addresses.has(String((row as { box?: Row; address?: string }).box?.address ?? (row as { address?: string }).address ?? "")));
      const outHit = outputs.some((box) => addresses.has(String(box.address ?? "")));
      const inHit = inputs.some((input) => addresses.has(String(input.box?.address ?? "")));
      if (!hit && !outHit && !inHit) continue;
    }
    found.push({
      transactionId: id,
      timestamp: digits((tx as { timestamp?: unknown }).timestamp ?? Date.now()),
      inclusionHeight: 0,
      headerId: "",
      index: 0,
      inputs,
      dataInputs: (tx.dataInputs ?? []).map((input) => ({ boxId: (input.boxId ?? "").toLowerCase() })).filter((input) => input.boxId),
      outputs(filter?: { relevantOnly?: boolean }) {
        if (filter?.relevantOnly && addresses.size) return relevantOutputs(outputs, addresses);
        return outputs;
      },
    });
  }
  return found.slice(skip, skip + take);
}

async function broadcast(ctx: NautilusCtx, signed: unknown, check: boolean): Promise<string> {
  const verdict = validateSignedTx(signed);
  if (!verdict.ok) throw new Error(verdict.reason);
  const send = check ? ctx.checkTx : ctx.submitTx;
  if (!send) throw new Error(check ? "check unavailable" : "submit unavailable");
  const out = await send(signed);
  if (typeof out === "string" && out.trim()) return out.trim();
  const id = signed && typeof signed === "object" ? (signed as { id?: string }).id : "";
  if (id) return id;
  throw new Error("node returned no id");
}

export function nautilusRoot(sql: Sql = defaultSql) {
  return {
    info() {
      return { version: NAUTILUS_VERSION };
    },
    state(_args: Row, ctx: NautilusCtx) {
      return loadState(sql, ctx);
    },
    addresses(args: Row) {
      return loadAddresses(sql, args);
    },
    blockHeaders(args: Row) {
      return loadHeaders(sql, args);
    },
    boxes(args: Row, ctx: NautilusCtx) {
      return loadBoxes(sql, args, mempoolSpent(ctx.getRawMempool().values()));
    },
    tokens(args: Row, ctx: NautilusCtx) {
      return loadTokens(sql, args, mempoolSpent(ctx.getRawMempool().values()));
    },
    transactions(args: Row, ctx: NautilusCtx) {
      return loadTransactions(sql, args, mempoolSpent(ctx.getRawMempool().values()));
    },
    mempool(_args: Row, ctx: NautilusCtx) {
      const txs = [...ctx.getRawMempool().values()];
      const spent = mempoolSpent(txs);
      return {
        boxes(args: Row) {
          return filterMempoolBoxes(txs, args, spent);
        },
        transactions(args: Row) {
          return mempoolTransactions(txs, args, spent);
        },
      };
    },
    checkTransaction(args: { signedTransaction: unknown }, ctx: NautilusCtx) {
      return broadcast(ctx, args.signedTransaction, true);
    },
    submitTransaction(args: { signedTransaction: unknown }, ctx: NautilusCtx) {
      return broadcast(ctx, args.signedTransaction, false);
    },
  };
}

export async function runNautilus(
  query: string,
  variables: Record<string, unknown> | undefined,
  operationName: string | undefined,
  ctx: NautilusCtx,
  sql: Sql = defaultSql
) {
  let doc;
  try {
    doc = parse(query);
  } catch (e) {
    return { errors: [{ message: String(e).slice(0, 240) }] };
  }
  const deep = depthError(documentDepth(doc));
  if (deep) return { errors: [{ message: deep }] };
  const schemaNow = nautilusSchema();
  const problems = validate(schemaNow, doc, specifiedRules);
  if (problems.length) return { errors: problems.map((error) => ({ message: error.message })) };
  if (query.length > GRAPHQL_MAX_BODY) return { errors: [{ message: "query too large" }] };
  return graphql({
    schema: schemaNow,
    source: query,
    rootValue: nautilusRoot(sql),
    contextValue: ctx,
    variableValues: variables,
    operationName,
  });
}
