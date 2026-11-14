import { getGateway } from "@/lib/config";
import { chainNow } from "@/lib/kayolo/chain-sense";

/** A rent answer and the chain height it counts from (null: the stream had named none yet). */
export type ScoutRent = { blocks: number | null; atHeight: number | null };

const cache = new Map<string, { at: number } & ScoutRent>();

/** Sync read of the last lookup. `undefined` = not fetched yet. */
export function cachedScoutRent(address: string): number | null | undefined {
  return cachedScoutRentAt(address)?.blocks;
}

/** The last lookup with its height, for a line that counts down with the tip (no request per block). */
export function cachedScoutRentAt(address: string): ScoutRent | undefined {
  const hit = cache.get(address.trim());
  return hit ? { blocks: hit.blocks, atHeight: hit.atHeight } : undefined;
}

/**
 * Blocks until the soonest rent on this address.
 * Gateway reads the oldest unspent box (one index row). 0 = already due.
 * Null = nothing due within 90 days. Not the home tape.
 */
export async function lookupScoutRent(address: string, opts?: { fresh?: boolean }): Promise<number | null> {
  return (await lookupScoutRentAt(address, opts)).blocks;
}

/** lookupScoutRent with the height the answer counts from: the tip this tab knew when it came. */
export async function lookupScoutRentAt(address: string, opts?: { fresh?: boolean }): Promise<ScoutRent> {
  const key = address.trim();
  if (!key) return { blocks: null, atHeight: null };
  const hit = cache.get(key);
  // `fresh`: a seal spent rent boxes while the line says «now» — the cached answer may be the spent box.
  if (hit && !opts?.fresh && Date.now() - hit.at < 45_000) return { blocks: hit.blocks, atHeight: hit.atHeight };
  try {
    const r = await fetch(
      `${getGateway()}/v1/addresses/${encodeURIComponent(key)}/rent-due`,
      { cache: "no-store" }
    );
    if (!r.ok) return { blocks: null, atHeight: null };
    const j = (await r.json()) as { blocksUntilRent?: unknown };
    const n = j.blocksUntilRent;
    const blocks = n == null ? null : Math.trunc(Number(n));
    const value = blocks != null && Number.isFinite(blocks) && blocks >= 0 ? blocks : null;
    const atHeight = chainNow().height;
    cache.set(key, { at: Date.now(), blocks: value, atHeight });
    return { blocks: value, atHeight };
  } catch {
    return { blocks: null, atHeight: null };
  }
}
