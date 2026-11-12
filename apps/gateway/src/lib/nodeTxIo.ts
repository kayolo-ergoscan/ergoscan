/**
 * Input order and data inputs of a confirmed tx, read from our node's index on demand.
 * Postgres keeps neither (tx_inputs has no position, data inputs are not stored) and the
 * operator's rule is that the database must not grow (12 Nov 2026), so the node answers:
 * `/blockchain/transaction/byId` takes ~2–8 ms. Confirmed txs never change, so answers are
 * cached. When the node does not answer, callers keep the index order and an empty list.
 */

const NODE_URL = (process.env.ERGO_NODE_URL ?? "http://127.0.0.1:9053").replace(/\/$/, "");
const TIMEOUT_MS = 1500;
const CACHE_MAX = 4096;
const HEX64 = /^[0-9a-f]{64}$/;

export type NodeTxIo = {
  /** Input box ids in transaction order. */
  inputs: string[];
  /** Data-input box ids in transaction order. */
  dataInputs: string[];
};

const cache = new Map<string, NodeTxIo>();

function remember(id: string, io: NodeTxIo): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, io);
}

function boxIds(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const out: string[] = [];
  for (const it of list) {
    const id = it && typeof it === "object" ? (it as { boxId?: unknown }).boxId : null;
    if (typeof id !== "string" || !HEX64.test(id.toLowerCase())) return null;
    out.push(id.toLowerCase());
  }
  return out;
}

/** Parse the node's indexed tx JSON. Null when it is not the tx we asked for. */
export function parseNodeTxIo(txId: string, body: unknown): NodeTxIo | null {
  if (!body || typeof body !== "object") return null;
  const o = body as { id?: unknown; inputs?: unknown; dataInputs?: unknown };
  if (typeof o.id !== "string" || o.id.toLowerCase() !== txId) return null;
  const inputs = boxIds(o.inputs);
  const dataInputs = boxIds(o.dataInputs ?? []);
  if (!inputs || !dataInputs) return null;
  return { inputs, dataInputs };
}

/** Null when the node is down, slow, or does not know the tx. */
export async function nodeTxIo(txId: string): Promise<NodeTxIo | null> {
  const id = String(txId ?? "").trim().toLowerCase();
  if (!HEX64.test(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const res = await fetch(`${NODE_URL}/blockchain/transaction/byId/${id}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const io = parseNodeTxIo(id, await res.json());
    if (io) remember(id, io);
    return io;
  } catch {
    return null;
  }
}

/** Several txs, a few node calls at a time. Missing ids are simply absent from the map. */
export async function nodeTxIoMany(txIds: string[], concurrency = 8): Promise<Map<string, NodeTxIo>> {
  const ids = [...new Set(txIds.map((x) => String(x ?? "").toLowerCase()).filter((x) => HEX64.test(x)))];
  const out = new Map<string, NodeTxIo>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]!;
      const io = await nodeTxIo(id);
      if (io) out.set(id, io);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

/**
 * Rows in the node's order. Rows the node did not list keep their old relative order
 * at the end; ids with no row are skipped. Returns the input array when order is null.
 */
export function orderByBoxIds<T extends { boxId: string }>(rows: T[], order: string[] | null | undefined): T[] {
  if (!order || !order.length || rows.length < 2) return rows;
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    const key = id.toLowerCase();
    if (!rank.has(key)) rank.set(key, i);
  });
  return rows
    .map((row, i) => ({ row, i, r: rank.get(row.boxId.toLowerCase()) }))
    .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
    .map((x) => x.row);
}

/**
 * One row per id, in the ids' order, repeats kept: a tx may list the same data-input box
 * twice (seen 12 Nov 2026). Ids with no row are skipped.
 */
export function pickByBoxIds<T extends { boxId: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((r) => [r.boxId.toLowerCase(), r]));
  const out: T[] = [];
  for (const id of ids) {
    const row = byId.get(id.toLowerCase());
    if (row) out.push(row);
  }
  return out;
}
