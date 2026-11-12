import clsx from "clsx";
import { Tip } from "@/components/Tip";
import { EntityMark } from "@/components/EntityMark";
import { HolderMark } from "@/components/HolderMark";
import {
  KpiMarkCpu,
  KpiMarkFileCode,
  KpiMarkPickaxe,
  KpiMarkStore,
} from "@/components/kpi-marks";
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

function KindGlyph({ id }: { id: ListEntityId }) {
  const common = "h-full w-full";
  if (id === "protocol") return <KpiMarkCpu spin className={common} />;
  if (id === "exchange") return <KpiMarkStore spin className={common} />;
  if (id === "pool") return <KpiMarkPickaxe spin className={common} />;
  return <KpiMarkFileCode spin className={common} />;
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
  /** List row and the address card: same mark as the kind tile, still orbiting. */
  kindGlyph?: boolean;
}) {
  const pip = listPip(address, nanoerg);
  const hint = [pip.name, pip.note].filter(Boolean).join(" · ") || kindLabel;
  const color =
    pip.id === "holder" ? BAND_INK[pip.band ?? "dust"] : LIST_ENTITY_INK[pip.id];

  return (
    <Tip content={hint}>
    <span
      className={clsx("inline-flex shrink-0", className)}
      style={{ color }}
      role="img"
      aria-label={hint}
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
    </Tip>
  );
}
