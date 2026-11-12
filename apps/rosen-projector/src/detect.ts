import {
  chainForRwt,
  extractEventFromRegisters,
  isRosenFraudAddress,
  isRosenPermitAddress,
  paymentTxIdFromRegisters,
  ROSEN_TRIGGER_ADDRESSES,
  tokenMetaForEvent,
  type ExtractedRosenEvent,
  type RosenEventStatus,
} from "@ergoscan/shared";
import type { Db } from "./db.js";

const DETECT_TIMEOUT_MS = Number(process.env.DETECT_TIMEOUT_MS || 8_000);

export type DetectedEvent = ExtractedRosenEvent & {
  triggerBoxId: string;
  triggerTxId: string;
  height: number;
  tsMs: number | null;
  rwtId: string | null;
  watcherChain: string | null;
  spentTxId: string | null;
  spentHeight: number | null;
  tokenName: string | null;
  tokenDecimals: number | null;
  ergoSideTokenId: string | null;
};

export type SpendUpdate = {
  boxId: string;
  spendTxId: string;
  spendHeight: number;
  status: RosenEventStatus;
  paymentTxId: string | null;
};

export type DetectResult = {
  ok: boolean;
  events: DetectedEvent[];
  spends: SpendUpdate[];
};

type TriggerRow = {
  box_id: string;
  address: string;
  creation_tx_id: string;
  height: string | number;
  additional_registers: unknown;
  spent_tx_id: string | null;
  spent_height: string | number | null;
  timestamp_ms: string | number | null;
  rwt_id: string | null;
};

const TRIGGER_SELECT = `
         encode(h.box_id, 'hex') AS box_id,
         h.address,
         encode(h.creation_tx_id, 'hex') AS creation_tx_id,
         h.creation_height AS height,
         h.additional_registers,
         encode(h.spent_tx_id, 'hex') AS spent_tx_id,
         h.spent_height,
         blk.timestamp_ms,
         (
           SELECT encode(ba.token_id, 'hex')
           FROM packed.box_assets ba
           WHERE ba.box_id = h.box_id
           ORDER BY ba.token_id
           LIMIT 1
         ) AS rwt_id
       FROM hits h
       LEFT JOIN packed.blocks blk ON blk.height = h.creation_height`;

function eventsFromRows(rows: TriggerRow[]): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  for (const row of rows) {
    const ev = extractEventFromRegisters(parseRegs(row.additional_registers));
    if (!ev) continue;
    const rwt = row.rwt_id?.trim() || null;
    const meta = tokenMetaForEvent(ev.fromChain, ev.sourceChainTokenId);
    events.push({
      ...ev,
      triggerBoxId: row.box_id,
      triggerTxId: row.creation_tx_id,
      height: Number(row.height) || 0,
      tsMs: row.timestamp_ms != null ? Number(row.timestamp_ms) : null,
      rwtId: rwt,
      watcherChain: chainForRwt(rwt) ?? ev.fromChain,
      spentTxId: row.spent_tx_id,
      spentHeight: row.spent_height != null ? Number(row.spent_height) : null,
      tokenName: meta?.name ?? null,
      tokenDecimals: meta?.decimals ?? null,
      ergoSideTokenId: meta?.ergoSideTokenId ?? null,
    });
  }
  return events;
}

function parseRegs(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      return j && typeof j === "object" && !Array.isArray(j)
        ? (j as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

export async function detectRosenWindow(
  db: Db,
  fromH: number,
  toH: number
): Promise<DetectResult> {
  if (fromH > toH) return { ok: true, events: [], spends: [] };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${DETECT_TIMEOUT_MS}`);
    await client.query(`SET LOCAL lock_timeout = '2s'`);

    // address_tx_addr_height_idx + boxes_creation_tx_id_idx / boxes_spent_tx_id_idx.
    // Long P2S often has only the spend row in address_tx (create was never written).
    // Do not filter boxes.address without a tx id — unspent index is length≤200.
    const created = await client.query<TriggerRow>(
      `WITH addrs AS (
         -- addr_md5 key, not address = ANY (no index on address: a 1 M-row seq scan per block).
         SELECT id, address FROM packed.addr
          WHERE addr_md5 = ANY (SELECT md5(x) FROM unnest($1::text[]) AS x)
            AND address = ANY($1::text[])
       ),
       hits AS (
         SELECT
           b.box_id,
           ad.address,
           b.creation_tx_id,
           b.creation_height,
           b.additional_registers,
           b.spent_tx_id,
           b.spent_height
         FROM packed.address_tx x
         JOIN addrs ad ON ad.id = x.addr_id
         JOIN packed.boxes b
           ON b.creation_tx_id = x.tx_id
          AND b.addr_id = ad.id
         WHERE x.height BETWEEN $2 AND $3
         UNION
         SELECT
           b.box_id,
           ad.address,
           b.creation_tx_id,
           b.creation_height,
           b.additional_registers,
           b.spent_tx_id,
           b.spent_height
         FROM packed.address_tx x
         JOIN addrs ad ON ad.id = x.addr_id
         JOIN packed.boxes b
           ON b.spent_tx_id = x.tx_id
          AND b.addr_id = ad.id
         WHERE x.height BETWEEN $2 AND $3
       )
       SELECT ${TRIGGER_SELECT}`,
      [ROSEN_TRIGGER_ADDRESSES, fromH, toH]
    );

    const events = eventsFromRows(created.rows);

    /**
     * Spends of boxes we just saw created. PK / creation_tx — not address.
     * Long P2S has no useful boxes(address) index (length≤200).
     */
    const alreadySpent = events.filter((e) => e.spentTxId);
    const spends = await classifySpends(
      client,
      alreadySpent.map((e) => ({
        boxId: e.triggerBoxId,
        spendTxId: e.spentTxId!,
        spendHeight: e.spentHeight ?? 0,
      }))
    );

    await client.query("COMMIT");
    return { ok: true, events, spends };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn(JSON.stringify({ type: "rosen_detect_skip", err: String(e) }));
    return { ok: false, events: [], spends: [] };
  } finally {
    client.release();
  }
}

/** PK lookup. Use after registers are filled; skip address_tx. */
export async function detectRosenBoxes(
  db: Db,
  boxIds: string[]
): Promise<DetectResult> {
  const ids = [...new Set(boxIds.filter((id) => id.trim()))];
  if (!ids.length) return { ok: true, events: [], spends: [] };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${DETECT_TIMEOUT_MS}`);
    await client.query(`SET LOCAL lock_timeout = '2s'`);
    const created = await client.query<TriggerRow>(
      `WITH hits AS (
         SELECT
           b.box_id,
           ad.address,
           b.creation_tx_id,
           b.creation_height,
           b.additional_registers,
           b.spent_tx_id,
           b.spent_height
         FROM packed.boxes b
         JOIN packed.addr ad ON ad.id = b.addr_id
         WHERE b.box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
           AND ad.address = ANY($2::text[])
       )
       SELECT ${TRIGGER_SELECT}`,
      [ids, ROSEN_TRIGGER_ADDRESSES]
    );
    const events = eventsFromRows(created.rows);
    const alreadySpent = events.filter((e) => e.spentTxId);
    const spends = await classifySpends(
      client,
      alreadySpent.map((e) => ({
        boxId: e.triggerBoxId,
        spendTxId: e.spentTxId!,
        spendHeight: e.spentHeight ?? 0,
      }))
    );
    await client.query("COMMIT");
    return { ok: true, events, spends };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn(JSON.stringify({ type: "rosen_detect_boxes_skip", err: String(e) }));
    return { ok: false, events: [], spends: [] };
  } finally {
    client.release();
  }
}

type SpendHint = {
  boxId: string;
  spendTxId: string;
  spendHeight: number;
};

async function classifySpends(
  db: { query: Db["query"] },
  hints: SpendHint[]
): Promise<SpendUpdate[]> {
  if (!hints.length) return [];
  const spendTxIds = [...new Set(hints.map((h) => h.spendTxId))];
  const outs = new Map<string, Array<{ address: string | null; regs: unknown }>>();
  const o = await db.query<{
    creation_tx_id: string;
    address: string | null;
    additional_registers: unknown;
  }>(
    `SELECT encode(b.creation_tx_id, 'hex') AS creation_tx_id,
            ad.address,
            b.additional_registers
     FROM packed.boxes b
     LEFT JOIN packed.addr ad ON ad.id = b.addr_id
     WHERE b.creation_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
     ORDER BY b.creation_tx_id, b.output_index NULLS LAST, b.box_id`,
    [spendTxIds]
  );
  for (const row of o.rows) {
    const list = outs.get(row.creation_tx_id) ?? [];
    list.push({ address: row.address, regs: row.additional_registers });
    outs.set(row.creation_tx_id, list);
  }

  const spends: SpendUpdate[] = [];
  for (const hint of hints) {
    const txOuts = outs.get(hint.spendTxId) ?? [];
    const first = txOuts[0];
    let status: RosenEventStatus = "completed";
    let paymentTxId: string | null = null;
    if (first && isRosenFraudAddress(first.address)) {
      status = "fraud";
    } else {
      const payBox = txOuts.find((b) => !isRosenPermitAddress(b.address));
      paymentTxId = paymentTxIdFromRegisters(
        parseRegs(payBox?.regs ?? first?.regs),
        hint.spendTxId
      );
    }
    spends.push({
      boxId: hint.boxId,
      spendTxId: hint.spendTxId,
      spendHeight: hint.spendHeight,
      status,
      paymentTxId,
    });
  }
  return spends;
}

/**
 * Later spends of already-inserted triggers. Join on boxes.box_id (PK).
 * Do not seq-scan boxes by 500-char P2S.
 */
export async function applyLateSpends(db: Db): Promise<SpendUpdate[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${DETECT_TIMEOUT_MS}`);
    await client.query(`SET LOCAL lock_timeout = '2s'`);
    const { rows } = await client.query<{
      trigger_box_id: string;
      spent_tx_id: string;
      spent_height: string | number;
    }>(
      `SELECT e.trigger_box_id,
              encode(b.spent_tx_id, 'hex') AS spent_tx_id,
              b.spent_height
       FROM rosen.events e
       JOIN packed.boxes b ON b.box_id = packed.hex32(e.trigger_box_id)
       WHERE e.status = 'processing'
         AND b.spent_tx_id IS NOT NULL
       LIMIT 400`
    );
    const spends = await classifySpends(
      client,
      rows.map((r) => ({
        boxId: r.trigger_box_id,
        spendTxId: r.spent_tx_id,
        spendHeight: Number(r.spent_height) || 0,
      }))
    );
    await client.query("COMMIT");
    return spends;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    console.warn(JSON.stringify({ type: "rosen_spend_skip", err: String(e) }));
    return [];
  } finally {
    client.release();
  }
}
