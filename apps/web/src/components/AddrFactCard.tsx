"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { KpiLabelMark, KpiTileRail } from "@/components/KpiGrid";
import { HOME } from "@/lib/palette";
import { usePaperPress } from "@/lib/use-paper-press";

/**
 * Entity / catalog lead tile. Mark slot is a corner stamp by default
 * (`data-stamp` on <html>: corner | old | rail). Aside (TxBallPit) is not a stamp.
 */
export function AddrFactCard({
  label,
  ink,
  mark,
  aside,
  asideLead = "tx",
  children,
  className,
  selected,
  onSelect,
  enter,
  beacon,
  end,
}: {
  label: string;
  ink: string;
  mark?: ReactNode;
  aside?: ReactNode;
  /** Block lead is a bit narrower so the pit keeps room. */
  asideLead?: "tx" | "block";
  children: ReactNode;
  className?: string;
  selected?: boolean;
  onSelect?: () => void;
  enter?: number;
  /** Radio rings from the top-right — storage rent on the balance tile. */
  beacon?: boolean;
  /** Extra slot (phone QR in the balance tile). */
  end?: ReactNode;
}) {
  const pressable = Boolean(onSelect);
  const { armed, arm, disarm, bind } = usePaperPress(pressable);

  return (
    <article
      role={pressable ? "button" : undefined}
      tabIndex={pressable ? 0 : undefined}
      aria-pressed={pressable ? selected : undefined}
      className={clsx(
        "kpi-tile relative flex min-h-0 min-w-0 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)]",
        aside
          ? "kpi-tile--aside items-stretch px-3 py-1.5 pr-1.5 max-lg:min-h-[9.5rem]"
          : "items-stretch gap-2 px-3 py-1.5",
        pressable && "kpi-tile--press",
        armed && "is-armed",
        selected && "is-pressed",
        enter != null && "home-tile-enter",
        className
      )}
      style={{
        ["--kpi-ink" as string]: ink,
        ...(enter != null ? { ["--enter" as string]: enter } : {}),
      }}
      {...bind}
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
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                arm();
                onSelect();
              }
            }
          : undefined
      }
      onKeyUp={pressable ? disarm : undefined}
    >
      {beacon ? (
        <span className="addr-rent-waves" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      ) : null}
      {aside ? null : <KpiTileRail />}
      <div
        className={clsx(
          "kpi-tile-body min-w-0",
          aside
            ? clsx(
                "relative z-10 shrink-0 pr-2",
                asideLead === "block" ? "w-[min(42%,11.5rem)]" : "w-[min(68%,16.5rem)] min-w-[12.5rem]"
              )
            : "relative z-[1] flex min-h-0 flex-1 flex-col"
        )}
      >
        <div className="kpi-label-row">
          {aside ? null : <KpiLabelMark mark={mark} color={ink} />}
          <p className="truncate text-[13px] leading-[1.15]" style={{ color: HOME.forming }}>
            {label}
          </p>
        </div>
        {children}
      </div>
      {aside ? (
        <div className="relative -my-1.5 -mr-1.5 min-h-0 min-w-0 flex-1 self-stretch">{aside}</div>
      ) : mark ? (
        <div className="kpi-tile-mark" style={{ color: ink }} aria-hidden>
          {mark}
        </div>
      ) : null}
      {end}
    </article>
  );
}
