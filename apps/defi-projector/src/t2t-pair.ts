const HEX64 = /^[0-9a-f]{64}$/;

export type T2tAsset = {
  tokenId: string;
  amount: number;
  name?: string | null;
};

export type T2tPair = {
  lp: string;
  tokenA: string;
  tokenB: string;
};

/** Spectrum N2N box: NFT + LP + tokenA + tokenB. AgeUSD / N2T have 3 assets → null. */
export function pickT2tPair(assets: T2tAsset[], nftId: string): T2tPair | null {
  const nft = nftId.trim().toLowerCase();
  if (!HEX64.test(nft)) return null;
  const rest = assets
    .map((a) => ({
      tokenId: String(a.tokenId || "").trim().toLowerCase(),
      amount: Number(a.amount),
      name: a.name ?? null,
    }))
    .filter((a) => HEX64.test(a.tokenId) && a.tokenId !== nft && a.amount > 0);
  if (rest.length < 3) return null;

  const nftName = assets.find((a) => a.tokenId.trim().toLowerCase() === nft)?.name;
  let lp = rest.find((a) => nftName && a.name === nftName && a.amount > 1) ?? null;
  if (!lp) {
    lp = rest.reduce((best, a) => (a.amount > best.amount ? a : best));
  }
  const pair = rest.filter((a) => a.tokenId !== lp.tokenId);
  if (pair.length < 2) return null;
  const [tokenA, tokenB] = [...pair]
    .map((a) => a.tokenId)
    .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  if (tokenA === tokenB) return null;
  return { lp: lp.tokenId, tokenA, tokenB };
}

/** Swap: reserves move apart and LP stays. Mint/redeem: both reserves and LP move together. */
export function classifyT2tMove(
  dA: number,
  dB: number,
  dLp: number
): "swap" | "mint" | "redeem" | null {
  if (!(dA !== 0 && dB !== 0) || !Number.isFinite(dA) || !Number.isFinite(dB)) return null;
  if (dA > 0 !== dB > 0) {
    if (dLp !== 0) return null;
    return "swap";
  }
  if (dA > 0 && dB > 0 && dLp > 0) return "mint";
  if (dA < 0 && dB < 0 && dLp < 0) return "redeem";
  return null;
}

export function isT2tSwapDelta(dA: number, dB: number, dLp: number): boolean {
  return classifyT2tMove(dA, dB, dLp) === "swap";
}
