import { ipfsPathFromHref, ipfsUrlFallbacks, preferIpfsUrl } from "@ergoscan/shared";
import { describeParty } from "./address-labels";
import { shortId } from "./format";

/** Address-book name, else sample, else short id. Not a proven artist field. */
export function issuerTitle(address: string, sampleName?: string | null): string {
  const party = describeParty(address);
  return party.known || sampleName || party.short || shortId(address, 8);
}

function kindOk(
  t: string,
  kind: "image" | "audio" | "video" | "any"
): boolean {
  if (/^javascript:/i.test(t) || /^data:text\//i.test(t)) return false;
  if (/^data:image\//i.test(t)) return kind === "image" || kind === "any";
  if (/^data:audio\//i.test(t)) return kind === "audio" || kind === "any";
  if (/^data:video\//i.test(t)) return kind === "video" || kind === "any";
  if (/^data:/i.test(t)) return false;
  return /^https?:\/\//i.test(t) || /^ipfs:\/\//i.test(t);
}

/** Safe href for NFT artwork. http(s), ipfs, on-chain data:image. */
export function safeArtUrl(url: string | null | undefined): string | null {
  return safeMediaUrl(url, "image");
}

/** Safe href for image / audio / video. Rejects javascript: and other schemes. */
export function safeMediaUrl(
  url: string | null | undefined,
  kind: "image" | "audio" | "video" | "any" = "any"
): string | null {
  if (!url) return null;
  const t = url.trim();
  if (!t || !kindOk(t, kind)) return null;
  if (/^data:/i.test(t)) return t;
  return preferIpfsUrl(t) ?? ( /^https?:\/\//i.test(t) ? t : null);
}

/** Same-origin `/v1/media/ipfs/` first, then public gates. A hung ipfs.io left the square empty. */
export function mediaUrlFallbacks(
  url: string | null | undefined,
  kind: "image" | "audio" | "video" | "any" = "image"
): string[] {
  if (!url?.trim()) return [];
  const path = ipfsPathFromHref(url);
  const raw = path ? ipfsUrlFallbacks(url) : [url.trim()];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of raw) {
    const t = u.trim();
    if (!kindOk(t, kind) || seen.has(t)) continue;
    if (/^ipfs:\/\//i.test(t)) {
      const href = preferIpfsUrl(t);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push(href);
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  if (path) {
    const proxy = `/v1/media/ipfs/${path}`;
    if (!seen.has(proxy)) out.unshift(proxy);
  }
  return out;
}
