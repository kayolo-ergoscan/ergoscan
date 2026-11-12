"use client";

import { useCallback, useId } from "react";
import { Tip } from "./Tip";
import clsx from "clsx";
import { useT } from "@/lib/i18n/I18nProvider";
import { usePaperPress } from "@/lib/use-paper-press";
import {
  rankWindowNav,
  type RankWindowMode,
} from "@/lib/rank-window";

/** Lucide chevrons, same 24 box and 1.7 stroke as the rail catalog. */
function Chevron({ dir }: { dir: "left" | "right" | "down" }) {
  const d =
    dir === "left" ? "m15 18-6-6 6-6" : dir === "right" ? "m9 18 6-6-6-6" : "m6 9 6 6 6-6";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const stepBtn =
  "chip-press flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-30";

export function RankWindow({
  offset,
  pageSize,
  shown,
  total,
  loc,
  ofLabel,
  prevLabel,
  nextLabel,
  tapeLabel,
  hint,
  disabled,
  hasMore,
  mode = "page",
  scrub,
  onOffset,
}: {
  offset: number;
  pageSize: number;
  shown: number;
  total: number | null;
  loc: string;
  ofLabel: string;
  prevLabel: string;
  nextLabel: string;
  tapeLabel: string;
  hint: string;
  disabled?: boolean;
  /** When `total` is null: Next follows this, not `shown >= pageSize`. */
  hasMore?: boolean;
  /** `loaded`: 1–N of total, Next appends, no OFFSET scrub. */
  mode?: RankWindowMode;
  /** When false, Next/Prev only — no OFFSET jump. */
  scrub?: boolean;
  onOffset: (next: number) => void;
}) {
  const t = useT();
  const labelId = useId();
  const paper = usePaperPress(true);
  const nav = rankWindowNav({
    mode,
    offset,
    pageSize,
    shown,
    total,
    hasMore,
    disabled,
    scrub,
  });
  const { from, to, cap, canPrev, canNext } = nav;

  const commit = useCallback(
    (next: number) => {
      if (mode === "loaded") {
        if (next <= 0) {
          if (shown > pageSize) onOffset(0);
          return;
        }
        if (canNext) onOffset(Math.max(shown, pageSize));
        return;
      }
      if (scrub === false || total == null) {
        if (next > offset) {
          if (canNext) onOffset(offset + pageSize);
          return;
        }
        if (next < offset && canPrev) onOffset(Math.max(0, offset - pageSize));
        return;
      }
      const clamped = Math.max(0, Math.min(cap, Math.round(next / pageSize) * pageSize));
      if (clamped !== offset) onOffset(clamped);
    },
    [canNext, canPrev, cap, mode, offset, onOffset, pageSize, scrub, shown, total]
  );

  if (nav.hide) return null;

  const range = `${from.toLocaleString(loc)}–${to.toLocaleString(loc)}`;
  const ofText =
    total != null && total > 0 ? ofLabel.replace("{n}", total.toLocaleString(loc)) : null;

  return (
    <section className="list-more">
      <div className="list-more-grid">
      {canNext ? (
        <button
          type="button"
          className={clsx("list-more-btn chip-press", paper.armed && "is-armed")}
          disabled={disabled}
          onClick={() => commit(offset + pageSize)}
          {...paper.bind}
        >
          {t("address.showMore")}
          <Chevron dir="down" />
        </button>
      ) : (
        <span />
      )}
      <div className="list-more-page">
        <span className="text-[12px] text-[var(--muted)]">{t("list.page")}</span>
        <button type="button" className={stepBtn} aria-label={prevLabel} disabled={!canPrev} onClick={() => commit(offset - pageSize)}>
          <Chevron dir="left" />
        </button>
        <Tip content={hint}>
          <p id={labelId} className="m-0 text-[12px] font-medium tabular-nums text-[var(--text)]">
            <span className="sr-only">{tapeLabel} </span>
            {range}
            {ofText ? <span className="font-normal text-[var(--muted)]"> {ofText}</span> : null}
          </p>
        </Tip>
        <button type="button" className={stepBtn} aria-label={nextLabel} disabled={!canNext} onClick={() => commit(offset + pageSize)}>
          <Chevron dir="right" />
        </button>
      </div>
      </div>
    </section>
  );
}
