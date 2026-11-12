import { KpiMark, type KpiMarkId } from "@/components/kpi-marks";
import type { HolderBandId } from "@/lib/holder-bands";

type MarkProps = {
  id: HolderBandId;
  size?: number;
  className?: string;
};

/** Holder tiers: a square spiral around the holder's box, one more turn per tier. */
const TIER: Record<HolderBandId, KpiMarkId> = {
  dust: "tier-dust",
  stacker: "tier-stacker",
  believer: "tier-believer",
  guardian: "tier-guardian",
  overlord: "tier-overlord",
};

export function HolderMark({ id, size, className }: MarkProps) {
  const tier = TIER[id];
  if (!tier) return null;
  if (size == null) return <KpiMark id={tier} className={className} />;
  return (
    <span className="inline-flex" style={{ width: size, height: size }}>
      <KpiMark id={tier} className={className} />
    </span>
  );
}
