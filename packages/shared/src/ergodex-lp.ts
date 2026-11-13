/**
 * ErgoDex liquidity tokens on ErgoScan: a V3 position key, a CP pool's LP token and its pool NFT
 * carry no picture of their own, so the explorer shows the ErgoDex logo in their place. Decided at
 * read time from the contract the token sits in (never from its name); nothing is stored, and a
 * token's own on-chain artwork always wins.
 */

/** Same-origin path of the logo on the website (apps/web/public). */
export const ERGODEX_LP_ART_PATH = "/ergodex-lp-640.webp";

/** The logo as the API hands it out: an absolute URL any wallet can load. */
export const ERGODEX_LP_ART_URL = `https://ergoscan.me${ERGODEX_LP_ART_PATH}`;

/** `artworkSource` on a token whose picture ErgoScan substituted. */
export const ERGODEX_LP_ART_SOURCE = "ergoscan:ergodex-lp";

/** V3 position key; CP pool LP token; CP pool NFT. */
export type ErgodexLpKind = "cl-key" | "cp-lp" | "cp-pool-nft";

/** Slug of the /nfts gallery group that lists every ErgoDex V3 position key. */
export const ERGODEX_V3_GROUP_SLUG = "ergodex-v3-positions";

export function isErgodexLpArt(url: string | null | undefined): boolean {
  const t = String(url ?? "").trim();
  return t === ERGODEX_LP_ART_URL || t === ERGODEX_LP_ART_PATH;
}
