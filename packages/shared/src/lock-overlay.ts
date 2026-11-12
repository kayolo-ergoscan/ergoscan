/**
 * Display overlay: which lock a tx belongs to.
 * Display overlay only. Monetary fee/88 boxes stay unnamed here;
 * tx-shape v4 names fee-collect / reward-unlock / emission separately.
 */
import { isAgeUsdBankNft } from "./ageusd.js";
import { ORACLE_POOL_NFTS } from "./registers.js";
import { LOCK_BY_ADDRESS, type LockId } from "./lock-addresses.js";
import { isRosenContractAddress, RWT_TO_CHAIN } from "./rosen-chains.js";
import {
  isMinerFeeBox,
  isMiningRewardLock,
  isP2pkBox,
  type ShapeBox,
} from "./tx-shape.js";

export type { LockId };
export {
  LOCK_BY_ADDRESS,
  ROSEN_LOCK_ADDRESS,
  SIGMAUSD_BANK_ADDRESS,
} from "./lock-addresses.js";

export type LockHit = {
  id: LockId;
};

export type LockHints = {
  /** Spectrum pool NFT ids (`defi.pool_registry` venue spectrum_*). */
  poolNftIds?: ReadonlySet<string>;
  /** LithosDex pool NFT ids (`defi.pool_registry` venue lithos_dex). */
  lithosNftIds?: ReadonlySet<string>;
};

const ORACLE_NFT = new Set(ORACLE_POOL_NFTS.map((id) => id.toLowerCase()));

function tokenIds(box: ShapeBox): string[] {
  const out: string[] = [];
  for (const a of box.assets ?? []) {
    const id = String(a.tokenId ?? "")
      .trim()
      .toLowerCase();
    if (id.length === 64) out.push(id);
  }
  return out;
}

/** One box. Fee, 88… reward lock, and P2PK never name a dApp. */
export function classifyBoxLock(
  box: ShapeBox,
  hints: LockHints = {}
): LockHit | null {
  if (isMinerFeeBox(box) || isMiningRewardLock(box)) return null;

  const ids = tokenIds(box);
  for (const id of ids) {
    if (ORACLE_NFT.has(id)) return { id: "oracle" };
  }
  for (const id of ids) {
    if (isAgeUsdBankNft(id)) return { id: "sigmausd" };
  }
  const lithos = hints.lithosNftIds;
  if (lithos && lithos.size) {
    for (const id of ids) {
      if (lithos.has(id)) return { id: "lithos" };
    }
  }
  const pools = hints.poolNftIds;
  if (pools && pools.size) {
    for (const id of ids) {
      if (pools.has(id)) return { id: "spectrum" };
    }
  }

  const addr = box.address?.trim() ?? "";
  if (addr) {
    const named = LOCK_BY_ADDRESS.get(addr);
    if (named) return { id: named };
    if (isRosenContractAddress(addr)) return { id: "rosen" };
  }
  for (const id of ids) {
    if (RWT_TO_CHAIN.has(id)) return { id: "rosen" };
  }

  if (isP2pkBox(box) === true) return null;
  return null;
}

/**
 * Spent boxes first, then outputs. Data inputs are only read, so they never name the lock:
 * a Dexy mint or a name registration that reads an oracle box is not an oracle tx.
 */
export function pickTxLock(
  tx: {
    inputs?: ShapeBox[] | null;
    outputs?: ShapeBox[] | null;
    /** Accepted for callers that pass the whole tx; never used. */
    dataInputs?: ShapeBox[] | null;
  },
  hints: LockHints = {}
): LockHit | null {
  for (const boxes of [tx.inputs, tx.outputs]) {
    for (const box of boxes ?? []) {
      const hit = classifyBoxLock(box, hints);
      if (hit) return hit;
    }
  }
  return null;
}
