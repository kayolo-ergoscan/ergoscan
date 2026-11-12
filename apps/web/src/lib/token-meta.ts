/**
 * Client-side token names + logos for the explorer shell.
 * Logos we ship: `/public/token-logos/{id}.png` (64px). No jsDelivr / GitHub
 * on the list — missing file → monogram, not a 404 waterfall.
 */

import { KNOWN_TOKENS, knownErgoTokenName } from "@ergoscan/shared";
import { shortId } from "@/lib/format";
import { INK } from "@/lib/palette";
import { LOCAL_TOKEN_LOGOS } from "@/lib/token-logos.generated";

export { LOCAL_TOKEN_LOGOS };

const ERG_ZERO = "0".repeat(64);

/** Well-known mainnet ids → human symbol/name (display only) */
export const TOKEN_CATALOG: Record<
  string,
  { symbol: string; name: string; decimals?: number }
> = {
  [ERG_ZERO]: { symbol: "ERG", name: "Ergo", decimals: 9 },
  // SigmaUSD — EIP-4 decimals=2 (raw 200_000 → 2,000 SigUSD)
  "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04": {
    symbol: "SigUSD",
    name: "SigmaUSD",
    decimals: 2,
  },
  "003bd19d0187117f130b62e1bcab0939929ff5c7709f843c5c4dd158949285d0": {
    symbol: "SigRSV",
    name: "SigmaRSV",
    decimals: 0,
  },
  // USE — Dexy USD stable (raw market data sometimes says SEED)
  "a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669": {
    symbol: "USE",
    name: "USE",
    decimals: 3,
  },
  // Spectrum
  "9a06d9e545a41fd51eeffc5e20d818073bf820c700998e1dca01d4e448dac76c": {
    symbol: "SPF",
    name: "Spectrum Finance",
  },
  // LithosDex
  "c1980d829988229516430a47a5eca376060b6ce859616db0936e78ab25cb6de7": {
    symbol: "LIT",
    name: "Lithos",
    decimals: 9,
  },
  // Rosen
  "8b08cdd5449a9592a9e79711d7d79249d7a03c535d17efaee83e216e80a44c4b": {
    symbol: "RSN",
    name: "Rosen",
    decimals: 3,
  },
  "e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297": {
    symbol: "rsADA",
    name: "Rosen ADA",
    decimals: 6,
  },
  "e023c5f3c0a6e8d47a9d3128ed4cfab203f53a292b281bc7a93bc9869bbca29c": {
    symbol: "eRSN",
    name: "Ergo RSN",
  },
  // ErgoPad / Paideia / community
  "d71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413": {
    symbol: "Ergopad",
    name: "ErgoPad",
  },
  "1fd6e032e8476c4aa54c18c1a308dce83940e8f4a28f576440513ed7326ad489": {
    symbol: "Paideia",
    name: "Paideia",
  },
  "36aba4b4a97b65be491cf9ebddadeca3d1d3219b6b48e6f9b60d5ae4fbb07e86": {
    symbol: "Erdoge",
    name: "Erdoge",
  },
  "00bd762484086cf560d3127eb53f0769d76244d9737636bceafd96348dacc56d": {
    symbol: "GAU",
    name: "Gluon GAU",
  },
  // rsBTC / popular bridge assets (ids as commonly indexed)
  "7a51950e5f548549ec1aa63ffdc38279505b11e7e803d01bcf8347e0123c88b0": {
    symbol: "rsBTC",
    name: "Rosen BTC",
  },
  "472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e8": {
    symbol: "NETA",
    name: "anetaBTC NETA",
  },
  "7ba2a85fdb302a181578b1f64cb4a533d89b3f8de4159efece75da41041537f9": {
    symbol: "GORT",
    name: "Gold Oracle Token",
  },
  "d4f0192622b440afc09711aa0545eacd04d78ad3f8a063523f451e10d3d0e6ef": {
    symbol: "MEOW",
    name: "Ergo Meow",
  },
  "0779ec04f2fae64e87418a1ad917639d4668f78484f45df962b0dec14a2591d2": {
    symbol: "MiGoreng",
    name: "Mi Goreng",
  },
  "e91cbc48016eb390f8f872aa2962772863e2e840708517d1ab85e57451f91bed": {
    symbol: "COMET",
    name: "Comet",
  },
  "e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807": {
    symbol: "Flux",
    name: "Flux",
    decimals: 8,
  },
  "f0cac602d618081f46db086726d3c4da53006b646b50e382989054dcf3c93bd8": {
    symbol: "Faku",
    name: "Faku",
  },
  "ae399fcb751e8e247d0da8179a2bcca2aa5119fff9c85721ffab9cdc9a3cb2dd": {
    symbol: "DORT",
    name: "DORT",
  },
};

/** EIP-4 decimals for a known id, else indexer hint, else 0. */
export function tokenDecimals(
  tokenId: string | null | undefined,
  hint?: number | null
): number {
  const id = String(tokenId || "").toLowerCase();
  const cat = TOKEN_CATALOG[id]?.decimals;
  if (cat != null && cat > 0) return cat;
  if (hint != null && Number.isFinite(hint) && hint > 0) return Math.trunc(hint);
  if (cat != null) return cat;
  return 0;
}

export function tokenSymbol(
  tokenId: string | null | undefined,
  nameHint?: string | null
): string | null {
  const id = String(tokenId || "").toLowerCase();
  return (
    knownErgoTokenName(id) ||
    TOKEN_CATALOG[id]?.symbol ||
    (nameHint ? String(nameHint).trim() : null) ||
    null
  );
}

/**
 * Storage-rent "at risk" tickers: a live USD price, or a token we already
 * treat as protocol / bridge / catalog. A 1/1 NFT with no market does not qualify.
 */
export function tokenAtRisk(
  tokenId: string | null | undefined,
  priceUsd?: number | null
): boolean {
  const id = String(tokenId || "").trim().toLowerCase();
  if (!id || id === ERG_ZERO) return false;
  if (priceUsd != null && Number.isFinite(priceUsd) && priceUsd > 0) return true;
  if (TOKEN_CATALOG[id] || KNOWN_TOKENS[id]) return true;
  return knownErgoTokenName(id) != null;
}

/** A token the explorer already names (catalog or the shared known set). */
export function tokenKnown(tokenId: string | null | undefined): boolean {
  const id = String(tokenId || "").trim().toLowerCase();
  if (!id || id === ERG_ZERO) return false;
  return Boolean(TOKEN_CATALOG[id] || KNOWN_TOKENS[id] || knownErgoTokenName(id));
}

export const SIGRSV_ID =
  "003bd19d0187117f130b62e1bcab0939929ff5c7709f843c5c4dd158949285d0";

/** Every ticker, including SigRSV, uses the ERGO word orange. */
export function tokenTickerInk(_tokenId?: string | null): string {
  return INK.coral;
}

export function isErgId(id: string | null | undefined): boolean {
  if (!id) return true;
  const s = id.toLowerCase();
  return s === "erg" || /^0+$/.test(s) || s === ERG_ZERO;
}

export const ERG_LOGO = "/token-logos/erg.png";

/** Same-origin mark, or null → caller shows a monogram. Never a remote 404. */
export function tokenLogoSrc(tokenId: string | null | undefined): string | null {
  const id = String(tokenId || "").toLowerCase();
  if (!id || isErgId(id)) return ERG_LOGO;
  if (LOCAL_TOKEN_LOGOS.has(id)) return `/token-logos/${id}.png`;
  return null;
}

/** @deprecated list UI must use tokenLogoSrc — these hit jsDelivr / GitHub. */
export function spectrumLogoUrl(tokenId: string): string {
  return tokenLogoSrc(tokenId) ?? "";
}

export function spectrumLogoFallback(tokenId: string): string {
  return tokenLogoSrc(tokenId) ?? "";
}

export type ResolvedToken = {
  tokenId: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  isErg: boolean;
};

/**
 * Prefer catalog → API symbol/name → short id.
 * Never invent fake tickers from the first hex nybbles of the token id.
 */
export function resolveTokenMeta(
  tokenId: string | null | undefined,
  symbolHint?: string | null,
  nameHint?: string | null
): ResolvedToken {
  const id = String(tokenId || "").toLowerCase();
  if (!id || isErgId(id)) {
    return {
      tokenId: ERG_ZERO,
      symbol: "ERG",
      name: "Ergo",
      logoUrl: tokenLogoSrc(ERG_ZERO),
      isErg: true,
    };
  }
  const cat = TOKEN_CATALOG[id];
  const hint = cleanTicker(symbolHint, id);
  const nameIn = cleanTicker(nameHint, id);
  let symbol = knownErgoTokenName(id) || cat?.symbol || hint || null;
  if ((!symbol || symbol === "SEED") && cat?.symbol === "USE") symbol = "USE";
  if (!symbol) symbol = shortId(id, 4);
  const name = knownErgoTokenName(id) || cat?.name || nameIn || symbol;
  return {
    tokenId: id,
    symbol: clipChars(String(symbol), 16),
    name: clipChars(String(name), 48),
    logoUrl: tokenLogoSrc(id),
    isErg: false,
  };
}

/** Code points, so one emoji is not cut in half by String.slice. */
function clipChars(s: string, max: number): string {
  return [...s].slice(0, max).join("");
}

function cleanTicker(raw: string | null | undefined, tokenId: string): string | null {
  const s = String(raw || "").trim();
  if (!s || s === "?" || s === "SEED" || s.includes("\uFFFD")) return null;
  const id = tokenId.toLowerCase();
  if (id.startsWith(s.toLowerCase()) && /^[0-9a-f]+$/i.test(s) && s.length <= 8) return null;
  const chars = [...s];
  const visible = chars.some((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return cp >= 32 && cp !== 127 && (cp < 128 || cp > 160);
  });
  if (!visible) return null;
  return s;
}

export { ERG_ZERO };
