/**
 * tokens.decimals + emission from the issuance box (box_id = token_id).
 * Known Rosen/Spectrum decimals win over R6. Transfer amounts never become
 * emission. No node, no official HTTP, no ENRICH. Batched PK joins only.
 */
import type pg from "pg";
import { eip4DecimalsFromRegs, ergoTokenDecimals } from "@ergoscan/shared";
import type { TokenUpsertRow } from "./batchSql.js";
import { capStatements, releaseCapped } from "./db.js";
import { slidePassFrom } from "./tokenPassWindow.js";

const BATCH = 80;
/** Several PK batches per tick; stop before the tip loop waits. */
const MAX_BATCHES = 12;
const BUDGET_MS = 2500;
const CURSOR_KEY = "token_issuance_cursor";
const DONE_KEY = "token_issuance_v1";
const FROM_H_KEY = "token_issuance_from_height";

type Queryable = { query: pg.Pool["query"] };

let running = false;

export function pickTokenDecimals(
  tokenId: string,
  regs?: unknown
): number | null {
  const known = ergoTokenDecimals(tokenId);
  if (known != null) return known;
  return eip4DecimalsFromRegs(regs ?? null);
}

/**
 * Catch-up patch. Known map may overwrite; R6 only fills NULL.
 * `emissionRaw` is non-null only when a mint output holding the token was found, so the
 * registers are that output's: no R6 (or an unreadable one) then means 0 decimals, as in
 * EIP-4 and the node's own token index.
 */
export function issuancePatch(
  tokenId: string,
  regs: unknown,
  emissionRaw: string | null
): {
  emission: string | null;
  decimals: number | null;
  forceDecimals: boolean;
} {
  const known = ergoTokenDecimals(tokenId);
  const mintFound = Boolean(emissionRaw && emissionRaw !== "0");
  return {
    emission: mintFound ? emissionRaw : null,
    decimals: known ?? eip4DecimalsFromRegs(regs) ?? (mintFound ? 0 : null),
    forceDecimals: known != null,
  };
}

/**
 * Tip / deepen row: emission + R6 only in the tx that spends the issuer box. A mint output
 * without R6 gets 0 decimals (EIP-4, as the node does); a transfer leaves decimals unknown.
 */
export function tokenRowFromOutputAsset(input: {
  tokenId: string;
  boxId: string;
  height: number;
  amount: string;
  registers?: unknown;
  /** True when this tx spends `box_id = token_id` (Ergo mint). */
  issuance?: boolean;
}): TokenUpsertRow {
  const issuance = Boolean(input.issuance);
  const amt = input.amount;
  return {
    tokenId: input.tokenId,
    nftBoxId: issuance ? input.boxId : amt === "1" ? input.boxId : null,
    firstHeight: input.height,
    lastHeight: input.height,
    emission: issuance && amt !== "0" ? amt : null,
    decimals: issuance
      ? (pickTokenDecimals(input.tokenId, input.registers) ?? 0)
      : pickTokenDecimals(input.tokenId, undefined),
  };
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

async function pickTokenIds(
  client: Queryable,
  sql: string,
  params: unknown[]
): Promise<string[]> {
  const r = await client.query<{ token_id: string }>(sql, params);
  return r.rows.map((row) => row.token_id);
}

async function issuanceTruthForIds(
  client: Queryable,
  ids: string[]
): Promise<
  {
    token_id: string;
    additional_registers: unknown;
    emission: string | null;
  }[]
> {
  if (!ids.length) return [];
  return (
    await client.query<{
      token_id: string;
      additional_registers: unknown;
      emission: string | null;
    }>(
      `SELECT t.token_id,
              SUM(a.amount)::text AS emission,
              -- EIP-4 registers of the first mint output that holds the token (as the node's
              -- token index). Another output of the mint tx may carry an unrelated R6.
              (ARRAY_AGG(o.additional_registers ORDER BY o.output_index NULLS LAST, a.amount DESC)
                 FILTER (WHERE a.box_id IS NOT NULL))[1] AS additional_registers
         FROM unnest($1::text[]) AS t(token_id)
         LEFT JOIN packed.boxes spent ON spent.box_id = packed.hex32(t.token_id)
         LEFT JOIN packed.boxes o ON o.creation_tx_id = spent.spent_tx_id
         LEFT JOIN packed.box_assets a
           ON a.box_id = o.box_id AND a.token_id = packed.hex32(t.token_id)
        GROUP BY t.token_id`,
      [ids]
    )
  ).rows;
}

/**
 * Several PK-join batches per call, time-capped so tip still runs.
 * Overwrites first-seen emission lies. After the first pass, only tokens
 * minted at/after the tip we marked.
 */
export async function maybeBackfillTokenIssuance(pool: pg.Pool): Promise<void> {
  if (running) return;
  running = true;
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await capStatements(client, 8000);
    const done = await getState(client, DONE_KEY);
    let cursor = (await getState(client, CURSOR_KEY)) || "";
    const fromH = Number((await getState(client, FROM_H_KEY)) || 0);

    let written = 0;
    let scanned = 0;
    let batches = 0;
    let empty = false;

    while (batches < MAX_BATCHES && Date.now() - t0 < BUDGET_MS) {
      const ids = done
        ? await pickTokenIds(
            client,
            `SELECT token_id FROM tokens
              WHERE first_height IS NOT NULL
                AND first_height >= $1
                AND token_id > $2
              ORDER BY token_id
              LIMIT $3`,
            [fromH, cursor, BATCH]
          )
        : await pickTokenIds(
            client,
            `SELECT token_id FROM tokens
              WHERE token_id > $1
              ORDER BY token_id
              LIMIT $2`,
            [cursor, BATCH]
          );

      if (!ids.length) {
        empty = true;
        break;
      }

      const rows = await issuanceTruthForIds(client, ids);
      const byId = new Map(rows.map((r) => [r.token_id, r]));
      const tokenIds: string[] = [];
      const emissions: (string | null)[] = [];
      const decimals: (number | null)[] = [];
      const forceDec: boolean[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        const patch = issuancePatch(
          id,
          row?.additional_registers ?? null,
          row?.emission ?? null
        );
        if (patch.decimals == null && patch.emission == null) continue;
        tokenIds.push(id);
        emissions.push(patch.emission);
        decimals.push(patch.decimals);
        forceDec.push(patch.forceDecimals);
      }

      if (tokenIds.length) {
        const u = await client.query(
          `UPDATE tokens t
              SET emission = COALESCE(u.emission::numeric, t.emission),
                  decimals = CASE
                    WHEN u.force THEN u.decimals
                    WHEN t.decimals IS NULL THEN u.decimals
                    ELSE t.decimals
                  END
             FROM unnest($1::text[], $2::text[], $3::int[], $4::boolean[])
               AS u(token_id, emission, decimals, force)
            WHERE t.token_id = u.token_id
              AND (
                t.emission IS DISTINCT FROM COALESCE(u.emission::numeric, t.emission)
                OR t.decimals IS DISTINCT FROM CASE
                  WHEN u.force THEN u.decimals
                  WHEN t.decimals IS NULL THEN u.decimals
                  ELSE t.decimals
                END
              )`,
          [tokenIds, emissions, decimals, forceDec]
        );
        written += u.rowCount ?? 0;
      }

      cursor = ids[ids.length - 1]!;
      scanned += ids.length;
      batches += 1;
      await setState(client, CURSOR_KEY, cursor);
      if (ids.length < BATCH) {
        empty = true;
        break;
      }
    }

    if (empty && !done) {
      const tip = await client.query<{ h: string }>(
        `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
      );
      await setState(client, DONE_KEY, String(Date.now()));
      await setState(client, FROM_H_KEY, tip.rows[0]?.h || "0");
      await setState(client, CURSOR_KEY, "");
      console.log("[indexer] token issuance pass done");
    } else if (empty && done) {
      if (cursor) await setState(client, CURSOR_KEY, "");
      const tip = await client.query<{ h: string }>(
        `SELECT value AS h FROM indexer_state WHERE key = 'last_height'`
      );
      const next = slidePassFrom(fromH, Number(tip.rows[0]?.h));
      if (next > fromH) await setState(client, FROM_H_KEY, String(next));
    }

    if (written > 0 || scanned > 0) {
      console.log(
        `[indexer] token issuance wrote+=${written} scanned=${scanned} batches=${batches} ${Date.now() - t0}ms`
      );
    }
  } catch (e) {
    console.warn("[indexer] token issuance", String(e));
  } finally {
    await releaseCapped(client);
    running = false;
  }
}
