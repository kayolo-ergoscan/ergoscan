/**
 * The live «rent collected in this block» moment.
 *
 * The seal already reads the full block from the node (`/blocks/{id}`); its inputs carry the
 * spending proof, so counting rent spends (empty proof + extension 127) is free: `rentBoxes` on
 * `block.sealed`. The ERG and the collector need the input values, which that JSON does not have:
 * the node's tx index (`/blockchain/transaction/byId`, ~2–8 ms) gives them for the rent txs of the
 * block (one or two is usual). Once per block that has rent spends, never per page view, no database.
 *
 * Then one `rent.collected` per such block. The node indexes a fresh block a moment after it
 * applies it, so the read retries for a few seconds; after that the event goes out with the count
 * only (`rentNano: null`).
 */
import {
  claimsFromTx,
  rentSpendsInBlock,
  summarizeRentClaims,
  type RentClaim,
  type RentCollectedEvent,
  type RentNodeTx,
  type SealEvent,
} from "@ergoscan/shared";

const NODE_URL = (process.env.ERGO_NODE_URL ?? "http://127.0.0.1:9053").replace(/\/$/, "");
const HEX64 = /^[0-9a-f]{64}$/;
/** Blocks whose rent txs wait for their read (a seal is followed by its lookup within seconds). */
const NOTED_MAX = 16;
/** Waits before each read of the node's tx index, ms: about 15 s in all. */
export const RENT_READ_DELAYS_MS = [400, 1500, 4000, 9000] as const;
/**
 * Most rent txs read for one block. One or two is usual; 7 and 12 happened in the last 30 days.
 * Above it the event carries the count alone (`rentNano: null`): summing only some of the block's
 * txs would show less rent than the block had. At most 32 reads of ~2–8 ms, once per such block.
 */
export const RENT_TXS_MAX = 32;

type BlockLike = {
  header?: { id?: string };
  blockTransactions?: { transactions?: unknown[] };
};

/** Per block: the rent txs to read, or `over` when there are more than RENT_TXS_MAX. */
const noted = new Map<string, { txIds: string[]; over: boolean }>();
let warned = false;

/**
 * Called once from the seal for a full block. Returns the rent count for `block.sealed` and
 * remembers which txs hold the spends, for `collect`. Never throws: a seal must not depend on rent
 * counting, so a block it cannot read just carries no count (one warning per process).
 */
export function noteRentSpends(full: BlockLike): { rentBoxes?: number } {
  try {
    const txs = (full.blockTransactions?.transactions ?? []) as RentNodeTx[];
    const { boxes, txIds } = rentSpendsInBlock(txs);
    if (!boxes) return {};
    const id = full.header?.id;
    if (typeof id === "string" && id) {
      if (noted.size >= NOTED_MAX) {
        const oldest = noted.keys().next().value;
        if (oldest !== undefined) noted.delete(oldest);
      }
      const over = txIds.length > RENT_TXS_MAX;
      noted.set(id, { txIds: over ? [] : txIds, over });
    }
    return { rentBoxes: boxes };
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn("[gateway] rent count skipped for a block", String(e));
    }
    return {};
  }
}

export type RentTxReader = (txId: string) => Promise<RentNodeTx | null>;

/** One tx from the node's index; null while the node has not indexed it yet, or on any failure. */
export async function readIndexedTx(txId: string): Promise<RentNodeTx | null> {
  const id = String(txId ?? "").trim().toLowerCase();
  if (!HEX64.test(id)) return null;
  try {
    const res = await fetch(`${NODE_URL}/blockchain/transaction/byId/${id}`, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const tx = (await res.json()) as RentNodeTx;
    if (!tx || typeof tx !== "object" || String(tx.id ?? "").toLowerCase() !== id) return null;
    // An indexed tx has input values; without them the claim parser would skip every input.
    if (!(tx.inputs ?? []).every((i) => i && i.value != null)) return null;
    return tx;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The block's rent in full: reads its rent txs (with retries) and sums the claims.
 * `delays` and `read` are for tests.
 */
export async function collectRent(
  seal: Pick<SealEvent, "blockId" | "height" | "rentBoxes">,
  read: RentTxReader = readIndexedTx,
  delays: readonly number[] = RENT_READ_DELAYS_MS
): Promise<RentCollectedEvent | null> {
  const boxes = seal.rentBoxes ?? 0;
  if (!boxes) return null;
  const note = noted.get(seal.blockId);
  noted.delete(seal.blockId);
  const base = { blockId: seal.blockId, height: seal.height, boxes };
  // Too many rent txs to read, or none remembered: the count alone, never a partial sum.
  const txIds = note?.txIds ?? [];
  if (note?.over || !txIds.length) return summarizeRentClaims(base, null);
  const have = new Map<string, RentClaim[]>();
  for (const wait of delays) {
    await sleep(wait);
    for (const id of txIds) {
      if (have.has(id)) continue;
      const tx = await read(id);
      if (tx) have.set(id, claimsFromTx(tx, seal.height));
    }
    if (have.size === txIds.length) break;
  }
  // Every rent tx or nothing: a part of the block's rent would be a wrong number.
  if (have.size !== txIds.length) return summarizeRentClaims(base, null);
  const claims = [...have.values()].flat();
  // Read in full and nothing paid: no rent was collected here, so no moment.
  return claims.length ? summarizeRentClaims(base, claims) : null;
}

/** For tests: forget remembered blocks. */
export function resetRentNotes(): void {
  noted.clear();
}

/**
 * The gateway's one call site: for each seal with rent spends, collect and broadcast once.
 * Runs in the background; a failure only means no moment for that block.
 */
export function announceRent(
  seals: readonly SealEvent[],
  send: (ev: { type: "rent.collected"; data: RentCollectedEvent }) => void
): void {
  for (const seal of seals) {
    if (!seal.rentBoxes) continue;
    void collectRent(seal)
      .then((data) => {
        if (data) send({ type: "rent.collected", data });
      })
      .catch(() => undefined);
  }
}
