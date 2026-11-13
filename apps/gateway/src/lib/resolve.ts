/**
 * Canonical path from a query string. Index tables only — never the node.
 */
import { isErgoAddressChecksumValid } from "./ergoAddress.js";
import { getIndexPool } from "./indexDb.js";
import { contractNamesOf } from "./names.js";

export type ResolveHit = {
  type: "block" | "tx" | "box" | "token" | "address";
  id: string;
  path: string;
  label?: string;
};

export type ResolvePage = {
  q: string;
  hits: ResolveHit[];
  source: "index";
};

const HEIGHT = /^\d{1,10}$/;
const HEX64 = /^[0-9a-fA-F]{64}$/;
/** Same cap as the address checksum: the longest P2S in the index is 5260 chars. */
const Q_MAX = 8000;
/** Heights as the site prints them: `#1885000`, `#1 885 000`, `1,885,000`. Groups of three only, so `1.5` stays a name. */
const HEIGHT_SHOWN = /^#?\s*(?:\d+|\d{1,3}(?:[\s,.'_\u00a0\u202f]\d{3})+)$/;

/** A block height typed or copied in any of the forms the site shows; otherwise null. */
export function heightFromQuery(q: string): number | null {
  const s = q.trim();
  if (!HEIGHT_SHOWN.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (!HEIGHT.test(digits)) return null;
  const n = Number(digits);
  return Number.isInteger(n) && n > 0 ? n : null;
}
const TOKEN_NAME_LIMIT = 25;
/** Fuzzy LIKE is a seq scan. Do not run it on 1-char junk or a 2000-char leftover. */
const TOKEN_LIKE_MIN = 2;
const TOKEN_LIKE_MAX = 64;

async function oneId(sql: string, param: string | number): Promise<string | null> {
  const p = getIndexPool();
  if (!p) return null;
  try {
    const r = await p.query<{ id: string }>(sql, [param]);
    const id = r.rows[0]?.id;
    return typeof id === "string" && id.length ? id : null;
  } catch {
    return null;
  }
}

function hit(
  type: ResolveHit["type"],
  id: string,
  path: string,
  label?: string
): ResolveHit {
  return label ? { type, id, path, label } : { type, id, path };
}

/** An order or a position has no book name; the contract registry names it by its template. */
async function contractLabel(address: string): Promise<string | undefined> {
  try {
    return (await contractNamesOf([address])).get(address)?.name;
  } catch {
    return undefined;
  }
}

function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, "\\$&")}%`;
}

async function tokenNameHits(q: string): Promise<ResolveHit[]> {
  const p = getIndexPool();
  if (!p) return [];
  try {
    const exact = await p.query<{ id: string; label: string | null }>(
      `SELECT token_id AS id, name AS label
       FROM tokens
       WHERE lower(name) = lower($1)
       ORDER BY holders DESC NULLS LAST, length(name), lower(name), token_id
       LIMIT $2`,
      [q, TOKEN_NAME_LIMIT]
    );
    const rows =
      exact.rows.length > 0
        ? exact.rows
        : q.length < TOKEN_LIKE_MIN || q.length > TOKEN_LIKE_MAX
          ? []
          : (
              await p.query<{ id: string; label: string | null }>(
                `SELECT token_id AS id, name AS label
                 FROM tokens
                 WHERE lower(name) LIKE lower($1) ESCAPE '\\'
                 ORDER BY holders DESC NULLS LAST, length(name), lower(name), token_id
                 LIMIT $2`,
                [likePattern(q), TOKEN_NAME_LIMIT]
              )
            ).rows;
    return rows
      .filter((r) => typeof r.id === "string" && r.id.length)
      .map((r) =>
        hit("token", r.id, `/token/${r.id}`, r.label?.trim() || undefined)
      );
  } catch {
    return [];
  }
}

export async function resolveFromIndex(raw: string): Promise<ResolvePage> {
  const q = String(raw ?? "").trim().slice(0, Q_MAX);
  const hits: ResolveHit[] = [];
  if (!q) return { q, hits, source: "index" };

  const height = heightFromQuery(q);
  if (height != null || HEIGHT.test(q)) {
    if (height != null) {
      const id = await oneId(
        `SELECT height::text AS id FROM packed.blocks WHERE height = $1 LIMIT 1`,
        height
      );
      if (id) hits.push(hit("block", id, `/block/${id}`));
    }
    return { q, hits, source: "index" };
  }

  if (HEX64.test(q)) {
    const id = q.toLowerCase();
    const [tx, token, block, box] = await Promise.all([
      oneId(
        `SELECT encode(id, 'hex') AS id FROM packed.transactions WHERE id = decode($1, 'hex') LIMIT 1`,
        id
      ),
      oneId(`SELECT token_id AS id FROM tokens WHERE token_id = $1 LIMIT 1`, id),
      oneId(
        `SELECT encode(id, 'hex') AS id FROM packed.blocks WHERE id = decode($1, 'hex') LIMIT 1`,
        id
      ),
      oneId(
        `SELECT encode(box_id, 'hex') AS id FROM packed.boxes WHERE box_id = decode($1, 'hex') LIMIT 1`,
        id
      ),
    ]);
    // Token id == minting tx's first input box. Always prefer tx → token → block → box.
    if (tx) hits.push(hit("tx", tx, `/tx/${tx}`));
    if (token) hits.push(hit("token", token, `/token/${token}`));
    if (block) hits.push(hit("block", block, `/block/${block}`));
    if (box) hits.push(hit("box", box, `/box/${box}`));
    return { q, hits, source: "index" };
  }

  // Index is truth: a row in address_summary wins with no checksum.
  // Seed fixtures mostly fail checksum; checking hash first would miss them.
  const indexed = await oneId(
    `SELECT address AS id FROM address_summary WHERE address = $1 LIMIT 1`,
    q
  );
  if (indexed) {
    hits.push(hit("address", indexed, `/address/${encodeURIComponent(indexed)}`, await contractLabel(indexed)));
    return { q, hits, source: "index" };
  }
  if (isErgoAddressChecksumValid(q)) {
    hits.push(hit("address", q, `/address/${encodeURIComponent(q)}`, await contractLabel(q)));
    return { q, hits, source: "index" };
  }

  hits.push(...(await tokenNameHits(q)));
  return { q, hits, source: "index" };
}
