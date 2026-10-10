/**
 * TVL box pick + snap preserve. Last-fill box first; NFT walk only for
 * active misses. Never let a timeout write 0 over a previous snap.
 *
 * A leftover pool NFT in a P2PK wallet is not the AMM box — counting that
 * wallet's ERG as TVL is how dead Ergopad/ERG showed ~655k next to ~615.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/** Spectrum N2T/T2T and Lithos pool boxes hold NFT + LP + 1–2 reserves. */
export const TVL_POOL_ASSETS_MIN = 2;
export const TVL_POOL_ASSETS_MAX = 6;

export type PoolBoxRow = {
  pool_id: string;
  value_nano: string | null;
  additional_registers?: unknown;
  quote_raw: string | null;
  base_raw: string | null;
  ergo_tree?: string | null;
  address?: string | null;
  n_assets?: number | string | null;
};

export type PoolTvlBoxKind = "amm" | "wallet" | "unknown";

function isP2pkHolder(address?: string | null, ergoTree?: string | null): boolean {
  const tree = String(ergoTree || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");
  if (tree.startsWith("0008cd")) return true;
  const addr = String(address || "");
  return addr.startsWith("9") && addr.length >= 50 && addr.length < 70;
}

/** AMM / Lithos P2S with a handful of assets. P2PK or a junk drawer → wallet. */
export function classifyPoolTvlBox(row: Pick<PoolBoxRow, "ergo_tree" | "address" | "n_assets">): PoolTvlBoxKind {
  if (isP2pkHolder(row.address, row.ergo_tree)) return "wallet";
  const n = Number(row.n_assets);
  if (Number.isFinite(n) && n > 0) {
    if (n < TVL_POOL_ASSETS_MIN || n > TVL_POOL_ASSETS_MAX) return "wallet";
    return "amm";
  }
  if (row.ergo_tree || row.address) return "amm";
  return "unknown";
}

export type PoolBox = {
  valueNano: string;
  quoteRaw: string;
  baseRaw: string;
  regs: unknown;
};

export function absorbPoolBox(
  best: Map<string, PoolBox>,
  row: PoolBoxRow,
  allowZeroNano: boolean
): PoolTvlBoxKind {
  const kind = classifyPoolTvlBox(row);
  if (kind === "wallet") return "wallet";
  const nft = String(row.pool_id || "").toLowerCase();
  if (!HEX64.test(nft) || row.value_nano == null) return kind;
  const valueNano = String(row.value_nano || "0");
  let valueCmp = 0n;
  try {
    valueCmp = BigInt(valueNano);
  } catch {
    return kind;
  }
  if (!allowZeroNano && valueCmp <= 0n) return kind;
  const prev = best.get(nft);
  if (prev) {
    try {
      if (BigInt(prev.valueNano) >= valueCmp) return "amm";
    } catch {
      /* take this row */
    }
  }
  best.set(nft, {
    valueNano,
    quoteRaw: String(row.quote_raw || "0"),
    baseRaw: String(row.base_raw || "0"),
    regs: row.additional_registers,
  });
  return "amm";
}

/** Keep the previous snap when this cycle did not load a box. */
export function nextSnapTvl(
  computed: number,
  hadBox: boolean,
  previous: number
): number {
  if (hadBox) return Number.isFinite(computed) && computed > 0 ? computed : 0;
  return previous > 0 && Number.isFinite(previous) ? previous : 0;
}

/**
 * Walk the pool NFT when the last fill did not leave an unspent box.
 * A quiet pool still has a contract box. Stake keys are not in the registry.
 */
export function poolNeedsNftTvl(input: {
  hadBox: boolean;
  hadLastSwap: boolean;
  prevTvl: number;
  volumeErg: number;
}): boolean {
  void input.hadLastSwap;
  void input.prevTvl;
  void input.volumeErg;
  return !input.hadBox;
}

/**
 * A pool whose newest token box was a wallet stays withdrawn for `restMs` without a new NFT walk.
 * Those walks were 90% of the TVL work (pool tokens copied into dozens of wallets); a new swap
 * still revives the pool through the last-fill pass, which runs every cycle.
 */
export function keepWithdrawn(
  withdrawnAt: number | undefined,
  now: number,
  restMs: number,
  forceNft?: boolean
): boolean {
  return !forceNft && withdrawnAt != null && now - withdrawnAt < restMs;
}
