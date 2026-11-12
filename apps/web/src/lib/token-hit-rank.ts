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

/** Same-name hits plus their holder counts (for telling the names apart). */
export async function rankTokenHits<T extends { type: string; id: string }>(
  q: string,
  hits: T[],
  gateway: string,
  signal?: AbortSignal
): Promise<{ hits: T[]; holders: Record<string, number> }> {
  const holders: Record<string, number> = {};
  if (hits.filter((h) => h.type === "token").length < 2) return { hits, holders };
  const query = q.trim();
  if (query.length < 2) return { hits, holders };
  try {
    const r = await fetch(
      `${gateway}/v1/tokens?q=${encodeURIComponent(query)}&sort=holders&dir=desc&limit=50`,
      { signal, cache: "no-store", headers: { Accept: "application/json" } }
    );
    if (!r.ok) return { hits, holders };
    const j = (await r.json()) as { items?: { tokenId?: unknown; holders?: unknown }[] };
    const ids: string[] = [];
    for (const it of Array.isArray(j.items) ? j.items : []) {
      if (typeof it.tokenId !== "string") continue;
      ids.push(it.tokenId);
      if (typeof it.holders === "number" && Number.isFinite(it.holders) && it.holders >= 0) {
        holders[it.tokenId] = it.holders;
      }
    }
    return { hits: orderByHolderRank(hits, ids), holders };
  } catch {
    return { hits, holders };
  }
}

export async function orderTokenHitsByHolders<T extends { type: string; id: string }>(
  q: string,
  hits: T[],
  gateway: string,
  signal?: AbortSignal
): Promise<T[]> {
  return (await rankTokenHits(q, hits, gateway, signal)).hits;
}
