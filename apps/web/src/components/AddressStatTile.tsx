"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KpiTileRail } from "@/components/KpiGrid";
import clsx from "clsx";

const TIP_W = 220;
const TIP_PAD = 8;

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
}) {
  const tileRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => setMounted(true), []);

  const place = () => {
    const el = tileRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - TIP_W - TIP_PAD;
    const left = Math.max(TIP_PAD, Math.min(r.left + r.width / 2 - TIP_W / 2, maxLeft));
    setPos({ top: r.bottom + 6, left });
  };

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const show = () => {
    place();
    setOpen(true);
  };

  const arm = () => {
    if (!onSelect) return;
    setArmed(true);
  };

  const disarm = () => setArmed(false);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!onSelect) return;
    if (e.button !== 0) return;
    arm();
  };

  const onPointerUp = () => {
    requestAnimationFrame(disarm);
  };

  return (
    <article
      ref={tileRef}
      tabIndex={0}
      role={onSelect ? "button" : undefined}
      aria-pressed={onSelect ? selected : undefined}
      className={clsx(
        "kpi-tile kpi-tile--dense relative flex min-w-0 gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3 py-1.5",
        enter != null && "home-tile-enter",
        onSelect && "kpi-tile--press",
        armed && "is-armed",
        selected && "is-pressed"
      )}
      style={{
        ["--kpi-ink" as string]: ink,
        ...(enter != null ? { ["--enter" as string]: enter } : {}),
      }}
      onMouseEnter={show}
      onMouseLeave={() => {
        setOpen(false);
        disarm();
      }}
      onFocus={show}
      onBlur={() => {
        setOpen(false);
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
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                arm();
                onSelect();
              }
            }
          : undefined
      }
      onKeyUp={onSelect ? disarm : undefined}
    >
      <KpiTileRail />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-[1.15] text-[var(--muted)]">{label}</p>
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
      {mounted
        ? createPortal(
            <div
              role="tooltip"
              aria-hidden={!open}
              className={clsx("addr-stat-tip", open && "is-open")}
              style={{ top: pos.top, left: pos.left, width: TIP_W }}
            >
              <p className="text-[13px] font-medium tracking-tight">{label}</p>
              {detail ? (
                <p className="mt-0.5 text-[12px] tabular-nums text-[var(--muted)]">{detail}</p>
              ) : null}
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">{hint}</p>
            </div>,
            document.body
          )
        : null}
    </article>
  );
}
