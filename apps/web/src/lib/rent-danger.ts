/** Priced or protocol tokens short on ERG. Written into snapshot_kv.rent. */

export type RentDangerRow = {
  boxId: string;
  address: string | null;
  tokenId: string;
  name: string | null;
  amount: string;
  decimals: number | null;
  priceUsd: number;
  valueNano: string;
  rentNano: string;
  shortfallNano: string;
  blocksUntilRent: number;
};

const HEX64 = /^[0-9a-f]{64}$/;

/** `null` when the field is missing. `[]` when the snapshot knows the list is empty. */
export function parseRentDanger(raw: unknown): RentDangerRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RentDangerRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const boxId = typeof rec.boxId === "string" ? rec.boxId.trim().toLowerCase() : "";
    const tokenId = typeof rec.tokenId === "string" ? rec.tokenId.trim().toLowerCase() : "";
    if (!HEX64.test(boxId) || !HEX64.test(tokenId)) continue;
    const amount = rec.amount == null ? "" : String(rec.amount);
    if (!/^\d+$/.test(amount)) continue;
    const blocks = Math.trunc(Number(rec.blocksUntilRent));
    const price = Number(rec.priceUsd);
    const decRaw = rec.decimals == null ? null : Math.trunc(Number(rec.decimals));
    const decimals =
      decRaw != null && Number.isFinite(decRaw) && decRaw >= 0 && decRaw <= 18 ? decRaw : null;
    out.push({
      boxId,
      address: typeof rec.address === "string" && rec.address.trim() ? rec.address.trim() : null,
      tokenId,
      name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : null,
      amount,
      decimals,
      priceUsd: Number.isFinite(price) && price > 0 ? price : 0,
      valueNano: typeof rec.valueNano === "string" ? rec.valueNano : "0",
      rentNano: typeof rec.rentNano === "string" ? rec.rentNano : "0",
      shortfallNano: typeof rec.shortfallNano === "string" ? rec.shortfallNano : "0",
      blocksUntilRent: Number.isFinite(blocks) && blocks >= 0 ? blocks : 0,
    });
  }
  return out;
}

/** Token amount × price. Zero when the row has no price. */
export function dangerHoldingUsd(row: Pick<RentDangerRow, "amount" | "decimals" | "priceUsd">): number {
  if (!(row.priceUsd > 0)) return 0;
  const dec = row.decimals != null && row.decimals > 0 ? Math.min(18, row.decimals) : 0;
  try {
    const raw = BigInt(row.amount || "0");
    const base = 10n ** BigInt(dec);
    return (Number(raw / base) + Number(raw % base) / Number(base || 1n)) * row.priceUsd;
  } catch {
    return 0;
  }
}

/** One token across its boxes in the danger list. */
export type RentDangerGroup = {
  tokenId: string;
  name: string | null;
  decimals: number | null;
  /** Boxes in the list that hold this token. */
  boxes: number;
  /** Raw token units summed over those boxes. */
  amount: bigint;
  /** Sum of each box's amount × price. Zero when the token has no price. */
  usd: number;
  /** Blocks until the first of those boxes can be taken. */
  soonest: number;
};

/**
 * Rows are boxes, so a token can show up many times. Fold them per token and put the
 * soonest box first. The snapshot caps the list, so sums are lower bounds.
 */
export function groupRentDanger(rows: readonly RentDangerRow[]): RentDangerGroup[] {
  const byToken = new Map<string, RentDangerGroup>();
  for (const row of rows) {
    let amount = 0n;
    try {
      amount = BigInt(row.amount || "0");
    } catch {
      amount = 0n;
    }
    const g = byToken.get(row.tokenId);
    if (g) {
      g.boxes += 1;
      g.amount += amount;
      g.usd += dangerHoldingUsd(row);
      g.soonest = Math.min(g.soonest, row.blocksUntilRent);
      if (!g.name && row.name) g.name = row.name;
      if (g.decimals == null && row.decimals != null) g.decimals = row.decimals;
    } else {
      byToken.set(row.tokenId, {
        tokenId: row.tokenId,
        name: row.name,
        decimals: row.decimals,
        boxes: 1,
        amount,
        usd: dangerHoldingUsd(row),
        soonest: row.blocksUntilRent,
      });
    }
  }
  return [...byToken.values()].sort(
    (a, b) => a.soonest - b.soonest || b.usd - a.usd || (a.tokenId < b.tokenId ? -1 : 1)
  );
}
