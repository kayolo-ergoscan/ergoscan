/**
 * Phone search «Paste» chip. The clipboard is read only when the chip is tapped;
 * the text is taken only when it is a 64-hex id (tx, block, box, token) or an
 * Ergo address.
 */

const HEX64 = /^[0-9a-f]{64}$/i;
/** Base58 without 0 O I l. P2PK is 51 chars; P2SH and P2S are longer. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function pasteTarget(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 20_000) return null;
  if (HEX64.test(text)) return text.toLowerCase();
  if (text.length >= 40 && BASE58.test(text)) return text;
  return null;
}

/** Browsers without the async clipboard (or a refused read) get no chip. */
export function canReadClipboard(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";
}
