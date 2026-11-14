/**
 * Ergo storage rent (~4 years / 1_051_200 blocks).
 * fee = storageFeeFactor * boxSizeBytes (nanoERG), once per rent spend: no age multiplier (the
 * node's ErgoInterpreter.checkExpiredBox, see storageFeeNano in rent-exact.ts). The miner takes
 * min(box value, fee); a box worth no more than the fee goes whole, tokens included.
 */

export type RentParams = {
  storagePeriodBlocks: number;
  storageFeeFactor: number;
  minValuePerByte: number;
};

export const DEFAULT_RENT_PARAMS: RentParams = {
  storagePeriodBlocks: 1_051_200,
  storageFeeFactor: 1_250_000,
  minValuePerByte: 360,
};

/** ~30 blocks/hour × 24 × 365.25 */
export const BLOCKS_PER_YEAR = 262_980;

export type BoxRentReport = {
  creationHeight: number | null;
  currentHeight: number;
  ageBlocks: number | null;
  storagePeriodBlocks: number;
  blocksUntilRent: number | null;
  rentDue: boolean;
  periodsElapsed: number;
  sizeBytes: number | null;
  estimatedRentNano: number | null;
  minValueNano: number | null;
  boxValueNano: number | null;
  belowMinValue: boolean | null;
  ageYears: number | null;
  note: string;
};

/** Serialized register payload (R4–R9 hex), not a flat 8 bytes per key. */
export function registerPayloadBytes(regs: unknown): number {
  if (!regs || typeof regs !== "object" || Array.isArray(regs)) return 0;
  let n = 0;
  for (const v of Object.values(regs as Record<string, unknown>)) {
    if (v == null) continue;
    const hex = String(v).replace(/^0x/i, "").trim();
    if (hex.length < 2 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) continue;
    n += hex.length / 2;
  }
  return n;
}

export function estimateBoxSizeBytes(input: {
  ergoTree?: string;
  assetsCount?: number;
  registersCount?: number;
  /** Real register bytes. When set, replaces registersCount × 8. */
  registerBytes?: number;
}): number {
  const treeHex = String(input.ergoTree ?? "").replace(/^0x/i, "");
  const treeBytes = Math.ceil(treeHex.length / 2);
  const assets = Math.max(0, Number(input.assetsCount ?? 0) || 0);
  const regs = Math.max(0, Number(input.registersCount ?? 0) || 0);
  const regBytes =
    input.registerBytes != null
      ? Math.max(0, Math.floor(input.registerBytes) || 0)
      : regs * 8;
  // value (8) + creationHeight (4) + extra (4) + assets + registers
  return treeBytes + 16 + assets * 40 + regBytes;
}

/** ERG a miner can actually take. The fee may exceed the box; the box cannot pay more than it holds. */
export function collectableRentNano(rentNano: string, valueNano: string): string {
  try {
    const rent = BigInt(String(rentNano || "0").split(".")[0] || "0");
    const value = BigInt(String(valueNano || "0").split(".")[0] || "0");
    if (rent <= 0n || value <= 0n) return "0";
    return (value < rent ? value : rent).toString();
  } catch {
    return "0";
  }
}

export function computeBoxRent(input: {
  creationHeight: number | null;
  currentHeight: number;
  valueNano: number;
  sizeBytes: number;
  params?: Partial<RentParams>;
}): BoxRentReport {
  const params: RentParams = { ...DEFAULT_RENT_PARAMS, ...input.params };
  const sizeBytes = Math.max(0, Math.floor(input.sizeBytes) || 0);
  const boxValueNano = Number.isFinite(input.valueNano) ? input.valueNano : 0;
  const minValueNano = params.minValuePerByte * sizeBytes;
  const belowMinValue = boxValueNano < minValueNano;

  const creation = Number(input.creationHeight);
  const hasAge = Number.isFinite(creation) && creation > 0;
  const ageBlocks = hasAge ? Math.max(0, input.currentHeight - creation) : null;
  const periodsElapsed =
    ageBlocks != null ? Math.floor(ageBlocks / params.storagePeriodBlocks) : 0;
  const rentDue = periodsElapsed > 0;
  const blocksUntilRent =
    ageBlocks == null
      ? null
      : rentDue
        ? 0
        : params.storagePeriodBlocks - (ageBlocks % params.storagePeriodBlocks);
  // One fee per rent spend, whatever the age (periodsElapsed is shown, never multiplied in).
  const estimatedRentNano = rentDue && sizeBytes > 0 ? params.storageFeeFactor * sizeBytes : null;
  const ageYears = ageBlocks != null ? ageBlocks / BLOCKS_PER_YEAR : null;

  let note = "Rent not due yet; countdown is blocks until storage period elapses.";
  if (!hasAge) note = "Creation height unknown — rent age not computed.";
  else if (rentDue) note = "Storage rent is due (one or more storage periods elapsed).";

  return {
    creationHeight: hasAge ? creation : null,
    currentHeight: input.currentHeight,
    ageBlocks,
    storagePeriodBlocks: params.storagePeriodBlocks,
    blocksUntilRent,
    rentDue,
    periodsElapsed,
    sizeBytes,
    estimatedRentNano,
    minValueNano,
    boxValueNano,
    belowMinValue,
    ageYears,
    note,
  };
}
