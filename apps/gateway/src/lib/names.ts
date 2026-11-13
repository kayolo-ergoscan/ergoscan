/**
 * Names from the public ergo-names registry, loaded hourly into names_* by the indexer's namesSync.
 * Address → exact or NFT-anchor row; else a P2S address → its ErgoTree template.
 * Else the contract registry of the tx meaning (@ergoscan/shared roleByTemplate) names the
 * template: orders and positions get one address each, so no book can list them.
 * Read time only: nothing is stored, the caches are in memory.
 */
import { PROTOCOL_NAMES, roleByTemplate, type ProtocolId } from "@ergoscan/shared";
import { getIndexPool } from "./indexDb.js";
import { ergoTreeFromAddress } from "./ergoAddress.js";
import { ergoTreeTemplateHash } from "./ergoTree.js";
import { stampTemplateHashes } from "./txTemplateHash.js";

export const NAMES_REGISTRY_URL = "https://github.com/kayolo-ergoscan/ergo-names";

export type AddressName = {
  name: string;
  kind: string;
  project: { id: string; name: string; category: string };
  by: "project" | "ergoscan";
  via: "address" | "token" | "template";
  current: boolean;
  until: number | null;
  /** Project file in ergo-names; "" for a contract-registry name (no file). */
  file: string;
  fileUrl: string;
  /** "ergo-names": the public book. "contracts": ErgoScan's contract registry, by template hash. */
  source: "ergo-names" | "contracts";
};

type NameRow = {
  name: string;
  kind: string;
  project_id: string;
  project_name: string;
  category: string;
  by_whom: string;
  via: string;
  current: boolean | null;
  until_height: string | null;
  file: string;
};

export function registryFileUrl(file: string): string {
  return `${NAMES_REGISTRY_URL}/blob/main/projects/${encodeURIComponent(file)}`;
}

export function nameFromRow(r: NameRow): AddressName {
  return {
    name: r.name,
    kind: r.kind,
    project: { id: r.project_id, name: r.project_name, category: r.category },
    by: r.by_whom === "project" ? "project" : "ergoscan",
    via: r.via === "token" ? "token" : r.via === "template" ? "template" : "address",
    current: r.current !== false,
    until: r.until_height == null ? null : Number(r.until_height),
    file: r.file,
    fileUrl: registryFileUrl(r.file),
    source: "ergo-names",
  };
}

/**
 * The contract registry's name for a template (the label the tx meaning shows in «how»).
 * A guess is not a name. The registry has no catalogue category, so it is "other".
 */
export function contractNameByTemplate(hash: string | null | undefined): AddressName | null {
  const role = roleByTemplate(hash);
  if (!role || role.src === "guess") return null;
  const project = PROTOCOL_NAMES[role.p as ProtocolId]?.en ?? role.p;
  return {
    name: role.label,
    kind: "contract",
    project: { id: role.p, name: project, category: "other" },
    by: "ergoscan",
    via: "template",
    current: true,
    until: null,
    file: "",
    fileUrl: "",
    source: "contracts",
  };
}

/** P2PK trees share one template, so a wallet is never named by template. */
export function templateTreeOf(address: string): string | null {
  const tree = ergoTreeFromAddress(address);
  if (!tree || tree.startsWith("0008cd")) return null;
  return tree;
}

const ROW_COLS = `r.name, r.kind, r.project_id, r.project_name, r.category, r.by_whom,
                  r.until_height::text AS until_height, r.file`;

async function rows<T>(sql: string, params: unknown[]): Promise<T[]> {
  const pool = getIndexPool();
  if (!pool) return [];
  try {
    return (await pool.query(sql, params)).rows as T[];
  } catch {
    return [];
  }
}

export async function addressName(address: string): Promise<AddressName | null> {
  const direct = await rows<NameRow>(
    `SELECT ${ROW_COLS}, n.match_kind AS via, n.current
       FROM names_address n
       JOIN names_registry r ON r.match_kind = n.match_kind AND r.match_value = n.match_value
      WHERE n.addr_md5 = md5($1) AND n.address = $1`,
    [address]
  );
  if (direct[0]) return nameFromRow(direct[0]);
  const tree = templateTreeOf(address);
  if (!tree) return null;
  const hash = await ergoTreeTemplateHash(tree);
  if (!hash) return null;
  const tpl = await rows<NameRow>(
    `SELECT ${ROW_COLS}, 'template' AS via, true AS current
       FROM names_registry r
      WHERE r.match_kind = 'template' AND r.match_value = $1`,
    [hash.toLowerCase()]
  );
  return tpl[0] ? nameFromRow(tpl[0]) : contractNameByTemplate(hash);
}

/**
 * Contract-registry names for many addresses at once (list rows, search). Wallets and unknown
 * templates are left out; the names book is not read here (the site's book wins on its own).
 * Template hashes: packed.script by tree_md5 (unique index, pool statement_timeout), else
 * sigma, cached per tree in txTemplateHash.
 */
export async function contractNamesOf(addresses: Iterable<string>): Promise<Map<string, AddressName>> {
  const out = new Map<string, AddressName>();
  const boxes: Array<{ address: string; ergoTree: string; templateHash?: string | null }> = [];
  for (const address of new Set(addresses)) {
    const tree = address ? templateTreeOf(address) : null;
    if (tree) boxes.push({ address, ergoTree: tree });
  }
  if (!boxes.length) return out;
  await stampTemplateHashes(boxes);
  for (const b of boxes) {
    const name = contractNameByTemplate(b.templateHash);
    if (name) out.set(b.address, name);
  }
  return out;
}

/**
 * Names for one activity row's parties, in the order of `from` / `to` (null = no registry name).
 * Arrays instead of an address map: a P2S address runs to kilobytes and the row already has it.
 */
export function partyNames(
  row: { from: readonly string[]; to: readonly string[] },
  names: ReadonlyMap<string, AddressName>
): { fromNames?: (string | null)[]; toNames?: (string | null)[] } {
  const pick = (list: readonly string[]) => {
    const got = list.map((a) => names.get(a)?.name ?? null);
    return got.some((n) => n != null) ? got : undefined;
  };
  const fromNames = pick(row.from);
  const toNames = pick(row.to);
  return { ...(fromNames ? { fromNames } : {}), ...(toNames ? { toNames } : {}) };
}

export type NameStats = {
  address: string;
  nanoerg: string | null;
  tokenCount: number | null;
  txCount: number | null;
  lastTs: number | null;
  project: string;
  by: "project" | "ergoscan";
  fileUrl: string;
};

let statsCache: { at: number; items: NameStats[] } | null = null;

/** Balance and activity of every named address: one join over ~150 primary keys, cached a minute. */
export async function namesStats(): Promise<NameStats[] | null> {
  if (statsCache && Date.now() - statsCache.at < BOOK_TTL_MS) return statsCache.items;
  const pool = getIndexPool();
  if (!pool) return statsCache?.items ?? null;
  try {
    const r = await pool.query<{
      address: string;
      nanoerg: string | null;
      token_count: number | null;
      tx_count: number | null;
      last_ts: string | null;
      project_name: string;
      by_whom: string;
      file: string;
    }>(
      `SELECT n.address,
              COALESCE(s.nanoerg, sl.nanoerg)::text AS nanoerg,
              COALESCE(s.token_count, sl.token_count) AS token_count,
              COALESCE(s.tx_count, sl.tx_count) AS tx_count,
              b.timestamp_ms::text AS last_ts, r.project_name, r.by_whom, r.file
         FROM names_address n
         JOIN names_registry r ON r.match_kind = n.match_kind AND r.match_value = n.match_value
         LEFT JOIN address_summary s ON s.address = n.address
         LEFT JOIN address_summary_long sl ON sl.addr_md5 = n.addr_md5 AND sl.address = n.address
         LEFT JOIN packed.blocks b ON b.height = COALESCE(s.last_height, sl.last_height)`
    );
    const items = r.rows.map((x) => ({
      address: x.address,
      nanoerg: x.nanoerg,
      tokenCount: x.token_count,
      txCount: x.tx_count,
      lastTs: x.last_ts == null ? null : Number(x.last_ts),
      project: x.project_name,
      by: x.by_whom === "project" ? ("project" as const) : ("ergoscan" as const),
      fileUrl: registryFileUrl(x.file),
    }));
    statsCache = { at: Date.now(), items };
    return items;
  } catch {
    return statsCache?.items ?? null;
  }
}

export type NamesBook = {
  commit: string | null;
  syncedAt: string | null;
  items: (AddressName & { address: string })[];
};

let bookCache: { at: number; book: NamesBook } | null = null;
const BOOK_TTL_MS = 60_000;

/** Every named address (exact and anchor). Templates are not listed: they name unbounded sets. */
export async function namesBook(): Promise<NamesBook | null> {
  if (bookCache && Date.now() - bookCache.at < BOOK_TTL_MS) return bookCache.book;
  const pool = getIndexPool();
  if (!pool) return bookCache?.book ?? null;
  try {
    const [list, meta] = await Promise.all([
      pool.query<NameRow & { address: string }>(
        `SELECT n.address, ${ROW_COLS}, n.match_kind AS via, n.current
           FROM names_address n
           JOIN names_registry r ON r.match_kind = n.match_kind AND r.match_value = n.match_value
          ORDER BY n.address`
      ),
      pool.query<{ key: string; value: string | null; updated_at: Date }>(
        `SELECT key, value, updated_at FROM names_meta WHERE key = 'commit'`
      ),
    ]);
    const book: NamesBook = {
      commit: meta.rows[0]?.value ?? null,
      syncedAt: meta.rows[0]?.updated_at ? new Date(meta.rows[0].updated_at).toISOString() : null,
      items: list.rows.map((r) => ({ address: r.address, ...nameFromRow(r) })),
    };
    bookCache = { at: Date.now(), book };
    return book;
  } catch {
    return bookCache?.book ?? null;
  }
}
