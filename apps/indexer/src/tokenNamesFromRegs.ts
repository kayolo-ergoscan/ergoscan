/**
 * Fill tokens.name from EIP-4 R4 of the first mint *output* that holds the token
 * (lowest output_index, as the node's token index). Not the spent issuer box
 * (box_id = token_id): in chain mints that box is the previous mint output and
 * carries the previous NFT's R4 (12 Nov 2026: 13 550 names were one off).
 * Artwork from the mint output too — R7–R9 live there, not
 * on the spent input. Known ids win over leftover R4. Do not read watcher-box
 * R4 from the spend tx. No node, no ENRICH_TOKENS. Batched PK joins only.
 * Empty artwork_url '' is a "checked, none" sentinel and may be overwritten
 * when mint R9 is a real URL. Do not reset token_meta_r4_v2 / nft_kind_v1.
 */
import type pg from "pg";
import {
  decodeRegisterMap,
  eip4MediaFromRegs,
  eip4PreviewUrl,
  knownErgoTokenName,
  pickArtworkUrl,
} from "@ergoscan/shared";
import { capStatements, releaseCapped } from "./db.js";
import { slidePassFrom } from "./tokenPassWindow.js";

const BATCH = 40;
/** Node keeps any length; 128 covers 212 of 225 longer real names (12 Nov 2026). */
const NAME_MAX = 128;
const CURSOR_KEY = "token_meta_r4_cursor";
const DONE_KEY = "token_meta_r4_v2";
const FROM_H_KEY = "token_meta_r4_from_height";

type Queryable = { query: pg.Pool["query"] };

let running = false;

function registerHex(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.serializedValue === "string") return o.serializedValue;
  }
  return null;
}

function regsAsHex(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const strs: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const hex = registerHex(v);
    if (hex) strs[k] = hex;
  }
  return Object.keys(strs).length ? strs : null;
}

export function nameFromIssuanceRegs(raw: unknown): string | null {
  const strs = regsAsHex(raw);
  if (!strs) return null;
  const r4 = decodeRegisterMap(strs).R4;
  if (!r4 || r4.kind !== "text") return null;
  const text = (r4.text || "").trim();
  const n = [...text].length;
  if (n < 1 || n > NAME_MAX) return null;
  if (/^https?:\/\//i.test(text) || text.startsWith("ipfs://")) return null;
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) return null;
  return text;
}

export function artFromIssuanceRegs(raw: unknown): string | null {
  const media = eip4MediaFromRegs(raw);
  return eip4PreviewUrl(media) || pickArtworkUrl(decodeRegisterMap(regsAsHex(raw) ?? {}));
}

/** Mint output first (EIP-4 R9). Issuer only if mint has no URL. */
export function pickArtUrl(mintRegs: unknown, issuerRegs?: unknown): string | null {
  return artFromIssuanceRegs(mintRegs) || artFromIssuanceRegs(issuerRegs ?? null);
}

export function kindFromIssuanceRegs(raw: unknown): string | null {
  return eip4MediaFromRegs(raw).kind;
}

async function getState(db: Queryable, key: string): Promise<string | null> {
  const r = await db.query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = $1`,
    [key]
  );
  return r.rows[0]?.value ?? null;
}

async function setState(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO indexer_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

/**
 * One PK-join batch per call. Safe next to token-catalog balances seed.
 */
async function pickTokenIds(
  client: Queryable,
  sql: string,
  params: unknown[]
): Promise<string[]> {
  const r = await client.query<{ token_id: string }>(sql, params);
  return r.rows.map((row) => row.token_id);
}

async function mintRegsForIds(
  client: Queryable,
  ids: string[],
  prefer: "R4" | "R7" | "R9" = "R4"
): Promise<{ token_id: string; additional_registers: unknown }[]> {
  if (!ids.length) return [];
  const r = await client.query<{
    token_id: string;
    additional_registers: unknown;
  }>(
    `SELECT DISTINCT ON (t.token_id) t.token_id, o.additional_registers
       FROM unnest($1::text[]) AS t(token_id)
       JOIN packed.boxes spent ON spent.box_id = packed.hex32(t.token_id)
       JOIN packed.boxes o ON o.creation_tx_id = spent.spent_tx_id
       JOIN packed.box_assets a ON a.box_id = o.box_id AND a.token_id = packed.hex32(t.token_id)
      ORDER BY t.token_id,
               CASE WHEN o.additional_registers ? $2 THEN 0 ELSE 1 END`,
    [ids, prefer]
  );
  return r.rows;
}

/**
 * EIP-4 name: registers of the first output of the mint tx that holds the token
 * (same pick as tokenIssuance.ts and the node). Not a later watcher output.
 */
async function issuanceRegsForIds(
  client: Queryable,
  ids: string[]
): Promise<{ token_id: string; additional_registers: unknown }[]> {
  if (!ids.length) return [];
  const r = await client.query<{
    token_id: string;
    additional_registers: unknown;
  }>(
    `SELECT DISTINCT ON (t.token_id) t.token_id, o.additional_registers
       FROM unnest($1::text[]) AS t(token_id)
       JOIN packed.boxes spent ON spent.box_id = packed.hex32(t.token_id)
       JOIN packed.boxes o ON o.creation_tx_id = spent.spent_tx_id
       JOIN packed.box_assets a ON a.box_id = o.box_id AND a.token_id = spent.box_id
      ORDER BY t.token_id, o.output_index NULLS LAST, a.amount DESC`,
    [ids]
  );
  return r.rows;
}

/** The spent issuer box (box_id = token_id). Artwork fallback only, never the name. */
async function issuerBoxRegsForIds(
  client: Queryable,
  ids: string[]
): Promise<{ token_id: string; additional_registers: unknown }[]> {
  if (!ids.length) return [];
  const r = await client.query<{
    token_id: string;
    additional_registers: unknown;
  }>(
    `SELECT t.token_id, b.additional_registers
       FROM unnest($1::text[]) AS t(token_id)
       JOIN packed.boxes b ON b.box_id = packed.hex32(t.token_id)`,
    [ids]
  );
  return r.rows;
}

function pickTokenName(tokenId: string, regs: unknown): string | null {
  return knownErgoTokenName(tokenId) || nameFromIssuanceRegs(regs);
}

export async function maybeBackfillTokenNamesFromRegs(
  pool: pg.Pool
): Promise<void> {
  if (running) return;
  running = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await capStatements(client, 8000);
    const done = await getState(client, DONE_KEY);
    const cursor = (await getState(client, CURSOR_KEY)) || "";
    const fromH = Number((await getState(client, FROM_H_KEY)) || 0);

    const ids = done
      ? await pickTokenIds(
          client,
          `SELECT token_id FROM tokens
            WHERE (name IS NULL OR btrim(name) = '' OR artwork_url IS NULL)
              AND first_height IS NOT NULL
              AND first_height >= $1
              AND token_id > $2
            ORDER BY token_id
            LIMIT $3`,
          [fromH, cursor, BATCH]
        )
      : await pickTokenIds(
          client,
          `SELECT token_id FROM tokens
            WHERE (name IS NULL OR btrim(name) = '' OR artwork_url IS NULL)
              AND token_id > $1
            ORDER BY token_id
            LIMIT $2`,
          [cursor, BATCH]
        );

    if (!ids.length) {
      if (!done) {
        const tip = await client.query<{ h: string }>(
          `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
        );
        await setState(client, DONE_KEY, String(Date.now()));
        await setState(client, FROM_H_KEY, tip.rows[0]?.h || "0");
        await setState(client, CURSOR_KEY, "");
        console.log("[indexer] token meta r4 pass done");
      } else {
        if (cursor) await setState(client, CURSOR_KEY, "");
        const tip = await client.query<{ h: string }>(
          `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
        );
        const next = slidePassFrom(fromH, Number(tip.rows[0]?.h));
        if (next > fromH) await setState(client, FROM_H_KEY, String(next));
      }
      return;
    }

    const rows = await issuanceRegsForIds(client, ids);
    const mintRows = await mintRegsForIds(client, ids, "R9");
    const issuerRows = await issuerBoxRegsForIds(client, ids);
    const mintById = new Map(mintRows.map((r) => [r.token_id, r.additional_registers]));
    const issuerById = new Map(issuerRows.map((r) => [r.token_id, r.additional_registers]));
    let named = 0;
    let arted = 0;
    for (const row of rows) {
      const known = Boolean(knownErgoTokenName(row.token_id));
      const name = pickTokenName(row.token_id, row.additional_registers);
      const art = pickArtUrl(mintById.get(row.token_id), issuerById.get(row.token_id));
      const u = await client.query(
        // Write only a real change (12 Nov 2026 audit: ~1.2 M no-op UPDATEs a day, one per rescan).
        `UPDATE tokens t
            SET name = v.name, artwork_url = v.art
           FROM (
             SELECT CASE
                      WHEN $2::text IS NOT NULL AND (
                        $4::boolean OR name IS NULL OR btrim(name) = ''
                      ) THEN $2
                      ELSE name
                    END AS name,
                    CASE
                      WHEN $3::text IS NOT NULL AND (artwork_url IS NULL OR artwork_url = '') THEN $3
                      WHEN artwork_url IS NULL THEN ''
                      ELSE artwork_url
                    END AS art
               FROM tokens
              WHERE token_id = $1
           ) v
          WHERE t.token_id = $1
            AND (t.name IS DISTINCT FROM v.name OR t.artwork_url IS DISTINCT FROM v.art)`,
        [row.token_id, name, art, known]
      );
      if ((u.rowCount ?? 0) > 0) {
        if (name) named += 1;
        if (art) arted += 1;
      }
    }
    const last = ids[ids.length - 1]!;
    await setState(client, CURSOR_KEY, last);
    if (named > 0 || arted > 0 || ids.length === BATCH) {
      console.log(
        `[indexer] token meta r4 named+=${named} art+=${arted} scanned=${ids.length} ${Date.now() - t0}ms`
      );
    }
  } catch (e) {
    console.warn("[indexer] token meta r4", String(e));
  } finally {
    await releaseCapped(client);
    running = false;
  }
}

const KIND_CURSOR = "token_nft_kind_cursor";
const KIND_DONE = "token_nft_kind_v1";
const KIND_FROM = "token_nft_kind_from_height";

let kindRunning = false;

/**
 * EIP-4 R7 → tokens.nft_kind. Same mint-output join as name/art. Not ENRICH, not node.
 * Marks '' when issuance was seen but R7 is not a known type, so the cursor advances.
 */
export async function maybeBackfillNftKindFromRegs(pool: pg.Pool): Promise<void> {
  if (kindRunning) return;
  kindRunning = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await capStatements(client, 8000);
    const done = await getState(client, KIND_DONE);
    const cursor = (await getState(client, KIND_CURSOR)) || "";
    const fromH = Number((await getState(client, KIND_FROM)) || 0);

    const ids = done
      ? await pickTokenIds(
          client,
          `SELECT token_id FROM tokens
            WHERE emission = 1
              AND nft_kind IS NULL
              AND first_height IS NOT NULL
              AND first_height >= $1
              AND token_id > $2
            ORDER BY token_id
            LIMIT $3`,
          [fromH, cursor, BATCH]
        )
      : await pickTokenIds(
          client,
          `SELECT token_id FROM tokens
            WHERE emission = 1
              AND nft_kind IS NULL
              AND token_id > $1
            ORDER BY token_id
            LIMIT $2`,
          [cursor, BATCH]
        );

    if (!ids.length) {
      if (!done) {
        const tip = await client.query<{ h: string }>(
          `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
        );
        await setState(client, KIND_DONE, String(Date.now()));
        await setState(client, KIND_FROM, tip.rows[0]?.h || "0");
        await setState(client, KIND_CURSOR, "");
        console.log("[indexer] token nft_kind pass done");
      } else {
        if (cursor) await setState(client, KIND_CURSOR, "");
        const tip = await client.query<{ h: string }>(
          `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
        );
        const next = slidePassFrom(fromH, Number(tip.rows[0]?.h));
        if (next > fromH) await setState(client, KIND_FROM, String(next));
      }
      return;
    }

    const rows = await mintRegsForIds(client, ids, "R7");
    let typed = 0;
    for (const row of rows) {
      const kind = kindFromIssuanceRegs(row.additional_registers);
      const art = artFromIssuanceRegs(row.additional_registers);
      const u = await client.query(
        `UPDATE tokens
            SET nft_kind = COALESCE($2, ''),
                artwork_url = CASE
                  WHEN $3::text IS NOT NULL AND (artwork_url IS NULL OR artwork_url = '') THEN $3
                  ELSE artwork_url
                END
          WHERE token_id = $1 AND nft_kind IS NULL`,
        [row.token_id, kind, art]
      );
      if ((u.rowCount ?? 0) > 0 && kind) typed += 1;
    }
    const last = ids[ids.length - 1]!;
    await setState(client, KIND_CURSOR, last);
    if (typed > 0 || ids.length === BATCH) {
      console.log(
        `[indexer] token nft_kind typed+=${typed} scanned=${ids.length} ${Date.now() - t0}ms`
      );
    }
  } catch (e) {
    const msg = String(e);
    if (!/nft_kind|42703/.test(msg)) {
      console.warn("[indexer] token nft_kind", msg);
    }
  } finally {
    await releaseCapped(client);
    kindRunning = false;
  }
}

const ART_CURSOR = "token_art_mint_cursor";
const ART_DONE = "token_art_mint_v1";
const ART_FROM = "token_art_mint_from_height";
const ART_KINDS = ["image", "audio", "video", "collection"] as const;

let artRunning = false;

/**
 * One-shot + tip follow: overwrite artwork_url '' from mint-output R9.
 * Only typed NFTs — protocol pool/oracle/stake tokens stay empty.
 * Does not reset token_meta_r4_v2 / nft_kind_v1. No node.
 */
export async function maybeBackfillMintArtwork(pool: pg.Pool): Promise<void> {
  if (artRunning) return;
  artRunning = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await capStatements(client, 8000);
    const done = await getState(client, ART_DONE);
    const cursor = (await getState(client, ART_CURSOR)) || "";
    const fromH = Number((await getState(client, ART_FROM)) || 0);

    const ids = done
      ? await pickTokenIds(
          client,
          `SELECT token_id FROM tokens
            WHERE emission = 1
              AND artwork_url = ''
              AND nft_kind = ANY($1::text[])
              AND first_height IS NOT NULL
              AND first_height >= $2
              AND token_id > $3
            ORDER BY token_id
            LIMIT $4`,
          [ART_KINDS, fromH, cursor, BATCH]
        )
      : await pickTokenIds(
          client,
          `SELECT token_id FROM tokens
            WHERE emission = 1
              AND artwork_url = ''
              AND nft_kind = ANY($1::text[])
              AND token_id > $2
            ORDER BY token_id
            LIMIT $3`,
          [ART_KINDS, cursor, BATCH]
        );

    if (!ids.length) {
      if (!done) {
        const tip = await client.query<{ h: string }>(
          `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
        );
        await setState(client, ART_DONE, String(Date.now()));
        await setState(client, ART_FROM, tip.rows[0]?.h || "0");
        await setState(client, ART_CURSOR, "");
        console.log("[indexer] token art mint pass done");
      } else if (cursor) {
        await setState(client, ART_CURSOR, "");
      }
      return;
    }

    const mintRows = await mintRegsForIds(client, ids, "R9");
    const issuerRows = await issuerBoxRegsForIds(client, ids);
    const issuerById = new Map(issuerRows.map((r) => [r.token_id, r.additional_registers]));
    let arted = 0;
    for (const row of mintRows) {
      const art = pickArtUrl(row.additional_registers, issuerById.get(row.token_id));
      if (!art) continue;
      const u = await client.query(
        `UPDATE tokens
            SET artwork_url = $2
          WHERE token_id = $1
            AND (artwork_url IS NULL OR artwork_url = '')`,
        [row.token_id, art]
      );
      if ((u.rowCount ?? 0) > 0) arted += 1;
    }
    await setState(client, ART_CURSOR, ids[ids.length - 1]!);
    if (arted > 0 || ids.length === BATCH) {
      console.log(
        `[indexer] token art mint wrote+=${arted} scanned=${ids.length} ${Date.now() - t0}ms`
      );
    }
  } catch (e) {
    console.warn("[indexer] token art mint", String(e));
  } finally {
    await releaseCapped(client);
    artRunning = false;
  }
}

const RETRY_NAME_CURSOR = "token_meta_r4_retry_cursor";
const RETRY_NAME_DONE = "token_meta_r4_retry_v1";
const RETRY_KIND_CURSOR = "token_nft_kind_retry_cursor";
const RETRY_KIND_DONE = "token_nft_kind_retry_v1";
const RETRY_LO = 1_401_000;
const RETRY_HI = 1_854_799;

const RETRY_ON =
  process.env.TOKEN_META_RETRY === "1" || process.env.TOKEN_META_RETRY === "true";

let retryNameRunning = false;
let retryKindRunning = false;

/**
 * After regs bf: names still empty, and nft_kind='' written when mint regs
 * were NULL. Does not reset token_meta_r4_v2 / nft_kind_v1 (tip follow stays).
 * Not ENRICH, not node.
 */
export async function maybeRetryTokenMetaAfterRegs(pool: pg.Pool): Promise<boolean> {
  if (!RETRY_ON) return false;
  const a = await retryEmptyNames(pool);
  const b = await retryHoleKinds(pool);
  return a || b;
}

async function retryEmptyNames(pool: pg.Pool): Promise<boolean> {
  if (retryNameRunning) return false;
  retryNameRunning = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await capStatements(client, 8000);
    if (await getState(client, RETRY_NAME_DONE)) return false;
    const cursor = (await getState(client, RETRY_NAME_CURSOR)) || "";
    const ids = await pickTokenIds(
      client,
      `SELECT token_id FROM tokens
        WHERE (name IS NULL OR btrim(name) = '')
          AND token_id > $1
        ORDER BY token_id
        LIMIT $2`,
      [cursor, BATCH]
    );
    if (!ids.length) {
      await setState(client, RETRY_NAME_DONE, String(Date.now()));
      await setState(client, RETRY_NAME_CURSOR, "");
      console.log("[indexer] token meta r4 retry done");
      return false;
    }
    const rows = await issuanceRegsForIds(client, ids);
    let named = 0;
    let arted = 0;
    for (const row of rows) {
      const name = pickTokenName(row.token_id, row.additional_registers);
      const art = artFromIssuanceRegs(row.additional_registers);
      const u = await client.query(
        `UPDATE tokens t
            SET name = v.name, artwork_url = v.art
           FROM (
             SELECT CASE
                      WHEN $2::text IS NOT NULL AND (name IS NULL OR btrim(name) = '') THEN $2
                      ELSE name
                    END AS name,
                    CASE
                      WHEN $3::text IS NOT NULL AND (artwork_url IS NULL OR artwork_url = '') THEN $3
                      ELSE artwork_url
                    END AS art
               FROM tokens
              WHERE token_id = $1
           ) v
          WHERE t.token_id = $1
            AND (t.name IS DISTINCT FROM v.name OR t.artwork_url IS DISTINCT FROM v.art)`,
        [row.token_id, name, art]
      );
      if ((u.rowCount ?? 0) > 0) {
        if (name) named += 1;
        if (art) arted += 1;
      }
    }
    await setState(client, RETRY_NAME_CURSOR, ids[ids.length - 1]!);
    console.log(
      `[indexer] token meta r4 retry named+=${named} art+=${arted} scanned=${ids.length} ${Date.now() - t0}ms`
    );
    return true;
  } catch (e) {
    console.warn("[indexer] token meta r4 retry", String(e));
    return false;
  } finally {
    await releaseCapped(client);
    retryNameRunning = false;
  }
}

async function retryHoleKinds(pool: pg.Pool): Promise<boolean> {
  if (retryKindRunning) return false;
  retryKindRunning = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await capStatements(client, 8000);
    if (await getState(client, RETRY_KIND_DONE)) return false;
    const cursor = (await getState(client, RETRY_KIND_CURSOR)) || "";
    const ids = await pickTokenIds(
      client,
      `SELECT token_id FROM tokens
        WHERE emission = 1
          AND (nft_kind IS NULL OR nft_kind = '')
          AND first_height >= $1 AND first_height <= $2
          AND token_id > $3
        ORDER BY token_id
        LIMIT $4`,
      [RETRY_LO, RETRY_HI, cursor, BATCH]
    );
    if (!ids.length) {
      await setState(client, RETRY_KIND_DONE, String(Date.now()));
      await setState(client, RETRY_KIND_CURSOR, "");
      console.log("[indexer] token nft_kind retry done");
      return false;
    }
    const rows = await mintRegsForIds(client, ids, "R7");
    let typed = 0;
    for (const row of rows) {
      const kind = kindFromIssuanceRegs(row.additional_registers);
      const art = artFromIssuanceRegs(row.additional_registers);
      const u = await client.query(
        `UPDATE tokens
            SET nft_kind = COALESCE($2, ''),
                artwork_url = CASE
                  WHEN $3::text IS NOT NULL AND (artwork_url IS NULL OR artwork_url = '') THEN $3
                  ELSE artwork_url
                END
          WHERE token_id = $1
            AND (nft_kind IS NULL OR nft_kind = '')`,
        [row.token_id, kind, art]
      );
      if ((u.rowCount ?? 0) > 0 && kind) typed += 1;
    }
    await setState(client, RETRY_KIND_CURSOR, ids[ids.length - 1]!);
    console.log(
      `[indexer] token nft_kind retry typed+=${typed} scanned=${ids.length} ${Date.now() - t0}ms`
    );
    return true;
  } catch (e) {
    console.warn("[indexer] token nft_kind retry", String(e));
    return false;
  } finally {
    await releaseCapped(client);
    retryKindRunning = false;
  }
}
