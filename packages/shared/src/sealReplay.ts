/**
 * Deterministic seed when an ordering block seals — Stage canvas climax.
 */

export type SealEvent = {
  blockId: string;
  height: number;
  /**
   * Header time, ms: when the miner started this block's template, not when the block was found
   * (median about a minute before the block reaches us, up to ten). Block pages show this time.
   */
  timestamp: number;
  txIds: string[];
  replaySeed: string;
  size?: number;
  txCount: number;
  /**
   * ms, gateway clock: when the gateway saw the node's best full block become this one. «Since the
   * last block» and «next block in» count from here. Absent from gateways before 14 Nov 2026.
   */
  seenAt?: number;
  /**
   * The node did not give the block's body: `blockId` and `height` only, no `txIds`, `txCount` 0,
   * `timestamp` is `seenAt`. Not full data: read the block later for its txs.
   */
  partial?: true;
  /**
   * Boxes in this block spent by the storage-rent rule (empty proof + extension 127): a miner
   * collected rent from them. Counted from the block the seal already read. Absent when none, or
   * from gateways before the rent moment.
   */
  rentBoxes?: number;
};

/** Stable string from header id + height (not a cryptographic hash). */
export function replaySeed(blockId: string, height: number): string {
  let h = 2166136261;
  const s = `${blockId}:${height}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `s${(h >>> 0).toString(16)}:${height}`;
}
