/**
 * Ordering-block seals from the node's best full block.
 *
 * `seenAt` is the gateway's own clock when it saw the best full block move. The header `timestamp`
 * is when the miner started the block's template: a median minute (up to ten) before the block
 * reaches us. «Since the last block» counts from `seenAt`; block pages keep the header time.
 */
import { replaySeed, type SealEvent } from "@ergoscan/shared";
import type { NodeClient } from "./node.js";

/**
 * Most blocks sealed for one move of the tip: a body that stalled for a block or two. A longer jump
 * (a node catching up) seals only its newest few; the tape shows the rest from the index.
 */
export const SEAL_MAX_PER_MOVE = 3;
/** Heights whose block id is remembered: to tell a new block from a sealed one and see a fork switch. */
const KNOWN_DEPTH = 16;

type NodeBlock = {
  header: { id: string; height: number; timestamp: number; parentId?: string };
  blockTransactions?: { transactions?: { id: string }[] };
  size?: number;
};

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16;
}

export class SealWatcher {
  private lastHeight: number | null = null;
  private known = new Map<number, string>();
  private lastAsked = -Infinity;
  /** One check at a time: the live loop and the 10 s /info poll never emit out of order. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private node: Pick<NodeClient, "get">,
    private now: () => number = Date.now
  ) {}

  /**
   * Seals for a move of the best full block, oldest first; [] when nothing moved.
   * - One block up: that block.
   * - Several up at once (a stalled body): each skipped height in order, the newest SEAL_MAX_PER_MOVE.
   * - A new id at the same height, or a tip whose parent is not the block sealed there (a fork
   *   switch): the replacing block(s) as well, again within SEAL_MAX_PER_MOVE.
   * Older blocks come from walking `parentId` back from the tip: one `/blocks/{id}` per sealed block.
   * `headerId` is the node's bestFullHeaderId (no /blocks/at lookup). `asked` orders the /info
   * answers of the two pollers: an answer asked before the last one used is stale and ignored.
   */
  check(tipHeight: number | null | undefined, headerId?: string | null, asked?: number): Promise<SealEvent[]> {
    // Seen now, when the caller hands the /info answer in, not when an earlier check lets this one run.
    const seenAt = this.now();
    const run = this.chain.then(() => this.step(tipHeight, headerId, asked, seenAt));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async step(
    tipHeight: number | null | undefined,
    headerId: string | null | undefined,
    asked: number | undefined,
    seenAt: number
  ): Promise<SealEvent[]> {
    if (tipHeight == null || !Number.isFinite(tipHeight)) return [];
    if (asked != null) {
      if (asked < this.lastAsked) return [];
      this.lastAsked = asked;
    }
    const best = isId(headerId) ? headerId : null;
    const prev = this.lastHeight;
    if (prev == null) {
      this.lastHeight = tipHeight;
      if (best) this.known.set(tipHeight, best);
      return [];
    }
    if (tipHeight < prev) {
      // The node stepped back (a fork switch under way): the seal comes when it climbs again.
      this.lastHeight = tipHeight;
      return [];
    }
    const had = this.known.get(tipHeight);
    if (best && had === best) {
      this.lastHeight = tipHeight;
      return [];
    }
    if (tipHeight === prev && (!best || had == null)) {
      // Same height and nothing to compare with: remember the id, seal nothing.
      if (best) this.known.set(tipHeight, best);
      return [];
    }
    // A new tip.
    this.lastHeight = tipHeight;
    if (best) this.known.set(tipHeight, best);

    let id = best;
    if (!id) {
      const at = await this.node.get<string[]>(`/blocks/at/${tipHeight}`, 5000).catch(() => null);
      id = isId(at?.[0]) ? at[0] : null;
      if (id) this.known.set(tipHeight, id);
    }
    const out: SealEvent[] = [];
    let height = tipHeight;
    while (out.length < SEAL_MAX_PER_MOVE) {
      if (!id) {
        out.push(partialSeal(height, null, seenAt));
        break;
      }
      let full: NodeBlock;
      try {
        // The tip as before; an older block gets a shorter wait (the walk holds the live loop).
        full = await this.node.get<NodeBlock>(`/blocks/${id}`, out.length ? 5000 : 12000);
      } catch {
        out.push(partialSeal(height, id, seenAt));
        break;
      }
      out.push(fullSeal(full, seenAt));
      const parentId = full.header.parentId;
      const ph = full.header.height - 1;
      if (!isId(parentId) || ph < 1) break;
      const sealedThere = this.known.get(ph);
      // The parent is the block sealed at that height: the chain joins what was shown.
      if (sealedThere === parentId) break;
      // Below the watched height and never seen: nothing to say about it.
      if (ph <= prev && sealedThere == null) break;
      if (out.length >= SEAL_MAX_PER_MOVE) break;
      // A height the jump skipped, or a block the fork switch replaced.
      this.known.set(ph, parentId);
      id = parentId;
      height = ph;
    }
    this.prune(tipHeight);
    return out.reverse();
  }

  private prune(tip: number) {
    for (const h of this.known.keys()) {
      if (h < tip - KNOWN_DEPTH || h > tip + KNOWN_DEPTH) this.known.delete(h);
    }
  }
}

function fullSeal(full: NodeBlock, seenAt: number): SealEvent {
  const txs = full.blockTransactions?.transactions ?? [];
  return {
    blockId: full.header.id,
    height: full.header.height,
    timestamp: full.header.timestamp,
    txIds: txs.map((t) => t.id),
    replaySeed: replaySeed(full.header.id, full.header.height),
    size: full.size,
    txCount: txs.length,
    seenAt,
  };
}

/** The block read failed: its real id (from /info) and height, no txs, and marked as such. */
function partialSeal(height: number, id: string | null, seenAt: number): SealEvent {
  return {
    blockId: id ?? `height-${height}`,
    height,
    timestamp: seenAt,
    txIds: [],
    replaySeed: replaySeed(id ?? `h${height}`, height),
    txCount: 0,
    seenAt,
    partial: true,
  };
}

/** The newest block the gateway sealed and when it saw it (gateway clock). */
export type SeenTip = { height: number; seenAt: number };

/**
 * The tip after a seal, or null when the seal does not move it: only a higher block restarts the
 * countdown and the planner (a fork's block at the same height does not).
 */
export function nextSeenTip(prev: SeenTip | null, seal: Pick<SealEvent, "height" | "seenAt">): SeenTip | null {
  const at = seal.seenAt;
  if (typeof at !== "number" || !Number.isFinite(at) || !Number.isFinite(seal.height)) return null;
  if (prev && seal.height <= prev.height) return null;
  return { height: seal.height, seenAt: at };
}

/**
 * When the newest block came, for «next block in»: the gateway's sighting while that block is the
 * newest (or the headers are one block ahead, its body on the way). The header time only when the
 * gateway has not seen a block move yet (just started) or the headers ran further ahead.
 */
export function lastBlockClock(seen: SeenTip | null, newest: { height: number; timestamp: number }): number {
  if (seen && seen.height >= newest.height - 1) return seen.seenAt;
  return newest.timestamp;
}
