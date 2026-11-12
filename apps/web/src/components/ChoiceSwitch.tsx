"use client";

import clsx from "clsx";
import { Tip } from "./Tip";
import type { CSSProperties, ReactNode } from "react";

/** Shared chrome for Settings switches — same cell, same press, same type size. */
export function ChoiceSwitch({
  label,
  cols,
  children,
}: {
  label: string;
  cols: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx("grid gap-1", cols === 3 ? "grid-cols-3" : "grid-cols-2")}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function ChoiceCell({
  pressed,
  onClick,
  title,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Tip content={title} tap={false}>
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={clsx(
        "chip-press flex min-w-0 flex-col items-center gap-1 rounded-[10px] px-1 py-1.5 text-[11px] font-medium transition-colors duration-[400ms] ease-[var(--ease)]",
        pressed
          ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]"
          : "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
      )}
    >
      {children}
    </button>
    </Tip>
  );
}

export function ChoiceSwatch({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-[7px] ring-1 ring-inset ring-[var(--border)]"
      style={style}
      aria-hidden
    >
      {children}
    </span>
  );
}
