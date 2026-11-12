/**
 * Same-name token hits from /v1/resolve are ordered by token id until the
 * gateway sort ships. The catalog already ranks exact names by holders.
 */

export function orderByHolderRank<T extends { type: string; id: string }>(
  hits: T[],
  rankedIds: readonly string[]
): T[] {
  if (hits.filter((h) => h.type === "token").length < 2) return hits;
  const rank = new Map<string, number>();
  for (let i = 0; i < rankedIds.length; i++) {
    const id = rankedIds[i];
    if (id && !rank.has(id)) rank.set(id, i);
  }
  if (!rank.size) return hits;
  const tokens = hits.filter((h) => h.type === "token");
  const sorted = [...tokens].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  });
  let i = 0;
  return hits.map((h) => (h.type === "token" ? sorted[i++]! : h));
}

/** Token hits keep the holder count the ranking request already returned. */
function withHolders<T extends { type: string; id: string }>(
  hits: T[],
  held: ReadonlyMap<string, number>
): Array<T & { holders?: number }> {
  if (!held.size) return hits;
  return hits.map((h) => {
    const n = h.type === "token" ? held.get(h.id) : undefined;
    return n != null ? { ...h, holders: n } : h;
  });
}

export async function orderTokenHitsByHolders<T extends { type: string; id: string }>(
  q: string,
  hits: T[],
  gateway: string,
  signal?: AbortSignal
): Promise<Array<T & { holders?: number }>> {
  if (hits.filter((h) => h.type === "token").length < 2) return hits;
  const query = q.trim();
  if (query.length < 2) return hits;
  try {
    const r = await fetch(
      `${gateway}/v1/tokens?q=${encodeURIComponent(query)}&sort=holders&dir=desc&limit=50`,
      { signal, cache: "no-store", headers: { Accept: "application/json" } }
    );
    if (!r.ok) return hits;
    const j = (await r.json()) as { items?: { tokenId?: unknown; holders?: unknown }[] };
    const items = Array.isArray(j.items) ? j.items : [];
    const ids = items.flatMap((it) => (typeof it.tokenId === "string" ? [it.tokenId] : []));
    const held = new Map<string, number>();
    for (const it of items) {
      if (typeof it.tokenId === "string" && typeof it.holders === "number" && Number.isFinite(it.holders)) {
        held.set(it.tokenId, it.holders);
      }
    }
    return withHolders(orderByHolderRank(hits, ids), held);
  } catch {
    return hits;
  }
}
