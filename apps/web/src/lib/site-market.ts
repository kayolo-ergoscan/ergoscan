import { getGateway } from "./config";
import type { SpectrumTapeRow } from "./list-snapshots";

export type SiteMarket = {
  usd: number | null;
  tape: SpectrumTapeRow[];
};

export function parseSiteTape(raw: unknown): SpectrumTapeRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SpectrumTapeRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const tokenId = String((row as { tokenId?: unknown }).tokenId || "").toLowerCase();
    const symbol = String((row as { symbol?: unknown }).symbol || "").trim();
    const priceUsd = Number((row as { priceUsd?: unknown }).priceUsd);
    const changeRaw = (row as { changePct?: unknown }).changePct;
    const changePct = changeRaw == null ? null : Number(changeRaw);
    if (!/^[0-9a-f]{64}$/.test(tokenId) || !symbol || !(priceUsd > 0)) continue;
    out.push({
      tokenId,
      symbol,
      priceUsd,
      changePct: changePct != null && Number.isFinite(changePct) ? changePct : null,
    });
  }
  return out;
}

/** Header price and the site ticker. Cached with the page for about 45s. */
export async function loadSiteMarket(): Promise<SiteMarket> {
  try {
    const r = await fetch(`${getGateway()}/v1/prices/erg`, {
      next: { revalidate: 45 },
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return { usd: null, tape: [] };
    const p = (await r.json()) as { usd?: unknown; tape?: unknown };
    const usd = typeof p.usd === "number" && p.usd > 0 ? p.usd : null;
    return { usd, tape: parseSiteTape(p.tape) };
  } catch {
    return { usd: null, tape: [] };
  }
}
