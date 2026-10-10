import { longFromRegister } from "@ergoscan/shared";

const FEE_DENOM = 1000n;

export type CfmmMove = {
  eventKind: "swap" | "mint" | "redeem";
  side: "buy" | "sell" | "mint" | "redeem";
};

/** Swap when the reserves move apart. Mint/redeem when they move together. */
export function classifyCfmmMove(dYraw: number, dErg: number): CfmmMove | null {
  if (!(dYraw !== 0 && dErg !== 0) || !Number.isFinite(dYraw) || !Number.isFinite(dErg)) {
    return null;
  }
  if (dYraw < 0 && dErg > 0) return { eventKind: "swap", side: "buy" };
  if (dYraw > 0 && dErg < 0) return { eventKind: "swap", side: "sell" };
  if (dYraw > 0 && dErg > 0) return { eventKind: "mint", side: "mint" };
  if (dYraw < 0 && dErg < 0) return { eventKind: "redeem", side: "redeem" };
  return null;
}

function wholeFromRaw(raw: string, decimals: number): number {
  const s = raw.split(".")[0] ?? "";
  if (!/^\d+$/.test(s)) return 0;
  const dec = Math.max(0, Math.min(18, decimals));
  if (dec === 0) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const base = 10n ** BigInt(dec);
  const qty = BigInt(s);
  return Number(qty / base) + Number(qty % base) / Number(base);
}

/**
 * ERG per one whole quote token, from the pool box itself.
 * This is the Spectrum price. A last trade is a print, not this mark.
 */
export function reserveMarkErg(
  ergSide: number,
  quoteRaw: string | number | null | undefined,
  decimals: number | null | undefined
): number | null {
  if (!(ergSide > 0) || !Number.isFinite(ergSide)) return null;
  const whole = wholeFromRaw(String(quoteRaw ?? ""), Math.trunc(Number(decimals) || 0));
  if (!(whole > 0) || !Number.isFinite(whole)) return null;
  const px = ergSide / whole;
  if (!(px > 0) || px >= 1e12 || !Number.isFinite(px)) return null;
  return px;
}

/** Spectrum R4 is feeNum out of 1000. 995 → LPs keep 0.5% of each swap. */
export function spectrumFeeRate(regs: unknown): number | null {
  if (!regs || typeof regs !== "object" || Array.isArray(regs)) return null;
  const feeNum = longFromRegister((regs as Record<string, unknown>).R4);
  if (feeNum == null || feeNum <= 0n || feeNum >= FEE_DENOM) return null;
  return Number(FEE_DENOM - feeNum) / Number(FEE_DENOM);
}
