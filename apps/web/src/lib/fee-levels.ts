import { ERGO_MAX_BLOCK_SIZE } from "./ergo-emission";

/** Median of ascending sizes (the upper middle on an even count), or null. */
export function medianOf(sorted: readonly number[]): number | null {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
}

/** What a transaction of `size` bytes pays at `rate` nanoERG per byte. */
export function levelCostNano(rate: number | null | undefined, size: number | null | undefined): bigint | null {
  if (rate == null || size == null || !Number.isFinite(rate) || !Number.isFinite(size) || rate < 0 || size <= 0) {
    return null;
  }
  return BigInt(Math.round(rate * size));
}

/**
 * Blocks until a transaction paying `rate` is mined, if miners fill blocks by rate:
 * every byte that pays more goes first. 1 is the next block.
 */
export function blocksToWait(
  rate: number | null | undefined,
  txs: readonly { feeRate: number; size: number }[],
  ownBytes = 0,
  blockBytes = ERGO_MAX_BLOCK_SIZE
): number | null {
  if (rate == null || !Number.isFinite(rate) || !(blockBytes > 0)) return null;
  let ahead = 0;
  for (const tx of txs) {
    if (Number.isFinite(tx.feeRate) && tx.feeRate > rate && Number.isFinite(tx.size) && tx.size > 0) {
      ahead += tx.size;
    }
  }
  return Math.floor((ahead + Math.max(0, ownBytes)) / blockBytes) + 1;
}
