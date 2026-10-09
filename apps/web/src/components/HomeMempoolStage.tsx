"use client";

/**
 * Home mempool card — Seal Well (mouth left, inhale on tip).
 * Physics in `@/lib/seal-well`. Canvas in TxBallPit.
 */
import { TxBallPit, type TxBallSeed } from "@/components/TxBallPit";
import type { PourSeed } from "@/lib/seal-well";

export type { PourSeed };

export type HomePitSeed = {
  id: string;
  size: number;
  color: string;
  fee?: number;
  feeRate?: number;
  firstSeen?: number;
  category?: string;
  platform?: string | null;
  action?: string | null;
  value?: number;
};

export function HomeMempoolStage({
  balls,
  ariaLabel,
  moreTitle,
  onDyingCount,
  onSealStart,
  onSealPour,
  onSealArrive,
}: {
  balls: HomePitSeed[];
  ariaLabel: string;
  moreTitle?: (n: number) => string;
  onDyingCount?: (n: number) => void;
  onSealStart?: () => void;
  onSealPour?: (seeds: PourSeed[]) => void;
  onSealArrive?: (hit: { id: string; color: string; n: number; total: number }) => void;
}) {
  const txs: TxBallSeed[] = balls.map((b) => ({
    id: b.id,
    size: b.size,
    color: b.color,
    fee: b.fee,
    feeRate: b.feeRate,
    category: b.category,
    action: b.action,
    platform: b.platform,
    firstSeen: b.firstSeen,
    value: b.value,
  }));
  return (
    <TxBallPit
      well
      scale="home"
      txs={txs}
      ariaLabel={ariaLabel}
      emptyHref="/mempool"
      moreTitle={moreTitle}
      onDyingCount={onDyingCount}
      onSealStart={onSealStart}
      onSealPour={onSealPour}
      onSealArrive={onSealArrive}
    />
  );
}
