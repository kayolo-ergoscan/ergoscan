import clsx from "clsx";
import { EntityMark } from "@/components/EntityMark";
import { HolderMark } from "@/components/HolderMark";
import { KpiMark } from "@/components/kpi-marks";
import { listPip, LIST_ENTITY_INK, type ListEntityId } from "@/lib/address-pips";
import { INK } from "@/lib/palette";
import type { HolderBandId } from "@/lib/holder-bands";

const BAND_INK: Record<HolderBandId, string> = {
  dust: INK.sky,
  stacker: INK.cyan,
  believer: INK.green,
  guardian: INK.gold,
  overlord: INK.coral,
};

/** Same concept icons as the kind tiles on /addresses. */
function KindGlyph({ id }: { id: ListEntityId }) {
  const common = "h-full w-full";
  if (id === "protocol") return <KpiMark id="protocol" className={common} />;
  if (id === "exchange") return <KpiMark id="exchange" className={common} />;
  if (id === "pool") return <KpiMark id="miner" className={common} />;
  return <KpiMark id="contract" className={common} />;
}

export function AddressPip({
  address,
  nanoerg,
  kindLabel,
  className,
  kindGlyph = false,
}: {
  address: string;
  nanoerg: string;
  kindLabel: string;
  className?: string;
  /** List row and the address card: same mark as the kind tile. */
  kindGlyph?: boolean;
}) {
  const pip = listPip(address, nanoerg);
  const hint = [pip.name, pip.note].filter(Boolean).join(" · ") || kindLabel;
  const color =
    pip.id === "holder" ? BAND_INK[pip.band ?? "dust"] : LIST_ENTITY_INK[pip.id];

  return (
    <span
      className={clsx("inline-flex shrink-0", className)}
      style={{ color }}
      title={hint}
    >
      {pip.id === "holder" && pip.band ? (
        <HolderMark id={pip.band} className="h-full w-full" />
      ) : pip.id !== "holder" ? (
        kindGlyph ? (
          <KindGlyph id={pip.id} />
        ) : (
          <EntityMark id={pip.id} className="h-full w-full" />
        )
      ) : null}
    </span>
  );
}
