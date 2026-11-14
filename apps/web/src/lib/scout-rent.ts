import { getGateway } from "@/lib/config";

const cache = new Map<string, { at: number; blocks: number | null }>();

/** Sync read of the last lookup. `undefined` = not fetched yet. */
export function cachedScoutRent(address: string): number | null | undefined {
  const hit = cache.get(address.trim());
  return hit ? hit.blocks : undefined;
}

/**
 * Blocks until the soonest rent on this address.
 * Gateway reads the oldest unspent box (one index row). 0 = already due.
 * Null = nothing due within 90 days. Not the home tape.
 */
export async function lookupScoutRent(address: string, opts?: { fresh?: boolean }): Promise<number | null> {
  const key = address.trim();
  if (!key) return null;
  const hit = cache.get(key);
  // `fresh`: a seal spent rent boxes while the line says «now» — the cached answer may be the spent box.
  if (hit && !opts?.fresh && Date.now() - hit.at < 45_000) return hit.blocks;
  try {
    const r = await fetch(
      `${getGateway()}/v1/addresses/${encodeURIComponent(key)}/rent-due`,
      { cache: "no-store" }
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { blocksUntilRent?: unknown };
    const n = j.blocksUntilRent;
    const blocks = n == null ? null : Math.trunc(Number(n));
    const value = blocks != null && Number.isFinite(blocks) && blocks >= 0 ? blocks : null;
    cache.set(key, { at: Date.now(), blocks: value });
    return value;
  } catch {
    return null;
  }
}
