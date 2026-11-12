/**
 * Token passes after their first full run rescan only tokens minted since `from_height`.
 * Mint registers do not change once indexed, so that set only needs the fork window. Before
 * 12 Nov 2026 `from_height` stayed where the first run ended and the set grew without end:
 * 1 568 tokens per lap for issuance, 1 079 for names, every tick (audit: idle passes).
 */
export const TOKEN_PASS_WINDOW = 720;

/** After a full lap: raise `from` to tip − window (never lower it). */
export function slidePassFrom(fromH: number, tip: number, window = TOKEN_PASS_WINDOW): number {
  const from = Number.isFinite(fromH) && fromH > 0 ? Math.floor(fromH) : 0;
  if (!Number.isFinite(tip) || tip <= window) return from;
  return Math.max(from, Math.floor(tip) - window);
}
