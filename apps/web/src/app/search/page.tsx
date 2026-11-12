import { redirect } from "next/navigation";
import { getGateway } from "@/lib/config";
import { listPageMeta } from "@/lib/page-meta";
import { rankTokenHits } from "@/lib/token-hit-rank";
import { SearchHits, type ResolveHit } from "./search-hits";

export const dynamic = "force-dynamic";

export const metadata = listPageMeta("/search");

async function resolveQuery(q: string): Promise<ResolveHit[]> {
  const gw = getGateway();
  try {
    const r = await fetch(`${gw}/v1/resolve?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { hits?: ResolveHit[] };
    return Array.isArray(j.hits) ? j.hits : [];
  } catch {
    return [];
  }
}

const HIT_TYPES = new Set<ResolveHit["type"]>(["block", "tx", "box", "token", "address"]);

/** Index plus mempool RAM. Used only when the index alone found nothing. */
async function wideQuery(q: string): Promise<ResolveHit[]> {
  const gw = getGateway();
  try {
    const r = await fetch(`${gw}/v1/search?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { hits?: { type?: string; id?: string; path?: string; label?: string }[] };
    return (j.hits ?? []).flatMap((h) =>
      h.type && HIT_TYPES.has(h.type as ResolveHit["type"]) && h.id && h.path
        ? [{ type: h.type as ResolveHit["type"], id: h.id, path: h.path, label: h.label }]
        : []
    );
  } catch {
    return [];
  }
}

function isTokenNameList(hits: ResolveHit[]): boolean {
  return hits.length > 1 && hits.every((h) => h.type === "token");
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = sp.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const gw = getGateway();
  const ranked: { hits: ResolveHit[]; holders: Record<string, number> } = q
    ? await rankTokenHits(q, await resolveQuery(q), gw)
    : { hits: [], holders: {} };
  let hits = ranked.hits;
  if (q && !hits.length) hits = await wideQuery(q);
  if (!isTokenNameList(hits) && hits[0]?.path) redirect(hits[0].path);
  return <SearchHits q={q} hits={hits} holders={ranked.holders} />;
}
