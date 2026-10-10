/**
 * Public IPFS gateways for NFT media. Not a cache we store — only URL rewrite.
 * `ipfs.io` is often 403/timeout; keep it last.
 */

export const IPFS_GATEWAYS = [
  "https://nftstorage.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://ipfs.blockfrost.dev/ipfs/",
  "https://gateway.lighthouse.storage/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://ipfs.io/ipfs/",
] as const;

const WEAK_IPFS_HOST = /^(ipfs\.io|gateway\.ipfs\.io)$/i;
const CID_HEAD = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{20,})$/i;
const CID_LOOSE = /^(Qm[1-9A-HJ-NP-Za-km-z]+|baf[a-z0-9]+)$/i;

/** Strict path for the same-origin fetch: CID + optional file segments. */
export function isSafeIpfsPath(path: string): boolean {
  if (!path || path.includes("..") || path.includes("//") || path.includes("\\")) {
    return false;
  }
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{20,})(\/[A-Za-z0-9._()%,+\-]+)*$/i.test(
    path
  );
}

export function ipfsPathFromHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (!t || /^data:/i.test(t) || /^javascript:/i.test(t)) return null;

  let path: string | null = null;
  const proto = t.match(/^ipfs:\/\/([^?#]+)/i);
  if (proto?.[1]) path = proto[1];
  const gate = t.match(/\/ipfs\/([^?#]+)/i);
  if (!path && gate?.[1]) path = gate[1];
  const sub = t.match(/^https?:\/\/([a-z0-9]+)\.ipfs\.[^/?#]+(?:\/([^?#]*))?/i);
  if (!path && sub?.[1]) path = sub[2] ? `${sub[1]}/${sub[2]}` : sub[1];
  if (!path && CID_LOOSE.test(t.split("/")[0] ?? "") && !t.includes("://")) {
    path = t;
  }
  if (!path) return null;
  path = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path || path.includes("..") || path.includes("//")) return null;
  const head = path.split("/")[0] ?? "";
  if (!CID_LOOSE.test(head)) return null;
  return path;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isWeakIpfsUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && WEAK_IPFS_HOST.test(host);
}

function looseIpfsRest(url: string): string | null {
  if (!/^ipfs:\/\//i.test(url)) return null;
  const rest = url.replace(/^ipfs:\/\//i, "").replace(/^\/+/, "");
  const head = rest.split("/")[0] ?? "";
  if (!rest || rest.includes("..") || !CID_LOOSE.test(head)) return null;
  return rest;
}

/** First usable IPFS https URL (keep a working gateway; rewrite ipfs.io). Null if not IPFS. */
export function preferIpfsUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const t = url.trim();
  if (!(ipfsPathFromHref(t) ?? looseIpfsRest(t))) return null;
  return ipfsUrlFallbacks(t)[0] ?? null;
}

export function ipfsUrlFallbacks(url: string | null | undefined): string[] {
  if (!url) return [];
  const t = url.trim();
  if (!t) return [];
  const path = ipfsPathFromHref(t) ?? looseIpfsRest(t);
  if (!path) return /^https?:\/\//i.test(t) ? [t] : [];
  const generated = IPFS_GATEWAYS.map((g) => `${g}${path}`);
  const original = /^https?:\/\//i.test(t) ? t : null;
  const strong: string[] = [];
  const weak: string[] = [];
  const seen = new Set<string>();
  const add = (u: string | null) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    (isWeakIpfsUrl(u) ? weak : strong).push(u);
  };
  add(original);
  for (const u of generated) add(u);
  return [...strong, ...weak];
}

/** API / writer: ipfs:// and dead public gates → a live gateway. Else leave http(s). */
export function publicArtworkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (!t) return null;
  return preferIpfsUrl(t) ?? t;
}

export function ipfsCidFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const head = path.split("/")[0] ?? "";
  return CID_HEAD.test(head) || CID_LOOSE.test(head) ? head : null;
}

/** Same-origin preview once the writer has stored this CID. Otherwise the public URL. */
export function previewArtworkUrl(
  url: string | null | undefined,
  ready: ReadonlySet<string> | null | undefined
): string | null {
  const cid = ipfsCidFromPath(ipfsPathFromHref(url));
  if (cid && ready?.has(cid)) return `https://ergoscan.me/nft/${cid}.webp`;
  return publicArtworkUrl(url);
}
