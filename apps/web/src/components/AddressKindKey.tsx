import { AddressStatTile } from "@/components/AddressStatTile";
import { KpiMark } from "@/components/kpi-marks";
import { LIST_ENTITY_INK, mergeKinds, type ListEntityId } from "@/lib/address-pips";
import { INK } from "@/lib/palette";
import type { ReactNode } from "react";

const ALL_INK = INK.cyan;

const KIND_MARK: Record<ListEntityId, ReactNode> = {
  protocol: <KpiMark id="protocol" />,
  exchange: <KpiMark id="exchange" />,
  pool: <KpiMark id="miner" />,
  contract: <KpiMark id="contract" />,
};

/** Phone chip names where the tile name is too long for a chip. */
const KIND_CHIP: Partial<Record<ListEntityId, string>> = {
  pool: "addresses.chip.pool",
  contract: "addresses.chip.contract",
};

export function AddressKindKey({
  raw,
  t,
  loc,
  allN,
  allSelected,
  selected,
  onAll,
  onSelect,
  enterFrom = 0,
}: {
  raw: unknown;
  t: (key: string) => string;
  loc: string;
  allN: number;
  allSelected?: boolean;
  selected?: readonly ListEntityId[] | null;
  onAll?: () => void;
  onSelect?: (id: ListEntityId) => void;
  enterFrom?: number;
}) {
  const rows = mergeKinds(raw);
  const on = new Set(selected ?? []);
  return (
    <>
      <AddressStatTile
        enter={enterFrom}
        className="kpi-chip-first"
        label={t("addresses.tileAll")}
        n={allN}
        caption={t("addresses.allCaption")}
        detail={t("addresses.allDetail")}
        hint={t("addresses.allHint")}
        ink={ALL_INK}
        loc={loc}
        mark={<KpiMark id="address" />}
        selected={allSelected}
        onSelect={onAll}
      />
      {rows.map((b, i) => (
        <AddressStatTile
          key={b.id}
          enter={enterFrom + 1 + i}
          label={t(`addresses.pip.${b.id}`)}
          chipLabel={KIND_CHIP[b.id] ? t(KIND_CHIP[b.id]!) : undefined}
          n={b.n}
          caption={t(`addresses.kind.${b.id}Range`)}
          detail={t(`addresses.kind.${b.id}RangeFull`)}
          hint={t(`addresses.kind.${b.id}Flavor`)}
          ink={LIST_ENTITY_INK[b.id]}
          loc={loc}
          mark={KIND_MARK[b.id]}
          selected={on.has(b.id)}
          onSelect={onSelect ? () => onSelect(b.id) : undefined}
        />
      ))}
    </>
  );
}
