"use client";

import { useState, type PointerEvent, type ReactNode } from "react";
import { KpiTileRail } from "@/components/KpiGrid";
import { TipHead, TipNote, useTip } from "@/components/Tip";
import clsx from "clsx";
import { HOME } from "@/lib/palette";

export function AddressStatTile({
  label,
  n,
  caption,
  hint,
  detail,
  ink,
  loc,
  mark,
  selected,
  onSelect,
  enter,
  className,
}: {
  label: string;
  n: number;
  caption: string;
  hint: string;
  detail?: string;
  ink: string;
  loc: string;
  mark: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  /** Home-style sheet enter. Omit on pages that should stay still. */
  enter?: number;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const tip = useTip(
    () => (
      <>
        {/* The tile's label chip wears the address colour in the look; the tip's chip matches it. */}
        <TipHead chip={label} ink={`var(--c-addr, ${ink})`} mono>
          {detail}
        </TipHead>
        <TipNote>{hint}</TipNote>
      </>
    ),
    { side: "bottom" }
  );

  const arm = () => {
    if (!onSelect) return;
    setArmed(true);
  };

  const disarm = () => setArmed(false);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    tip.onPointerDown(e);
    if (!onSelect) return;
    if (e.button !== 0) return;
    arm();
  };

  const onPointerUp = () => {
    requestAnimationFrame(disarm);
  };

  return (
    <article
      tabIndex={0}
      role={onSelect ? "button" : undefined}
      aria-pressed={onSelect ? selected : undefined}
      className={clsx(
        "kpi-tile kpi-tile--dense relative flex min-w-0 gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3 py-1.5",
        enter != null && "home-tile-enter",
        onSelect && "kpi-tile--press",
        armed && "is-armed",
        selected && "is-pressed",
        className
      )}
      style={{
        ["--kpi-ink" as string]: ink,
        ...(enter != null ? { ["--enter" as string]: enter } : {}),
      }}
      onPointerEnter={tip.onPointerEnter}
      onPointerLeave={(e) => {
        tip.onPointerLeave(e);
        disarm();
      }}
      onFocus={tip.onFocus}
      onBlur={(e) => {
        tip.onBlur(e);
        disarm();
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={disarm}
      onClick={
        onSelect
          ? () => {
              onSelect();
              disarm();
            }
          : undefined
      }
      onKeyDown={
        onSelect
          ? (e) => {
              tip.onKeyDown(e);
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                arm();
                onSelect();
              }
            }
          : tip.onKeyDown
      }
      onKeyUp={onSelect ? disarm : undefined}
    >
      <KpiTileRail />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-[1.15]" style={{ color: HOME.forming }}>
          {label}
        </p>
        <p
          className={clsx(
            "mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight",
            n <= 0 && "text-[var(--muted)]"
          )}
        >
          {n > 0 ? n.toLocaleString(loc) : "—"}
        </p>
        <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">{caption}</p>
      </div>
      <div className="kpi-tile-mark" style={{ color: ink }}>
        {mark}
      </div>
    </article>
  );
}
