"use client";

import { useEffect, useState } from "react";
import { Tip } from "./Tip";
import Link from "next/link";
import clsx from "clsx";

const hopCell =
  "block-hop chip-press flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[10px] py-1.5 text-[var(--muted)] hover:text-[var(--text)]";

function HopMark({ dir }: { dir: "back" | "fwd" }) {
  const cap = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className="block-hop-mark" aria-hidden>
      {dir === "back" ? (
        <>
          <rect x="3.4" y="6.8" width="9.4" height="10.4" rx="2.1" {...cap} />
          <path d="M21 7.4 14.8 12 21 16.6" {...cap} />
        </>
      ) : (
        <>
          <path d="M3 7.4 9.2 12 3 16.6" {...cap} />
          <rect x="11.2" y="6.8" width="9.4" height="10.4" rx="2.1" {...cap} />
        </>
      )}
    </svg>
  );
}

/** A plain chevron: the phone pair beside a block height («‹ 1 915 360 ›»). */
function StepMark({ dir }: { dir: "back" | "fwd" }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className="block-hop-mark" aria-hidden>
      <path
        d={dir === "back" ? "M14.5 6 8.5 12l6 6" : "M9.5 6l6 6-6 6"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const stepCell =
  "block-hop detail-step chip-press flex shrink-0 items-center justify-center rounded-[12px] text-[var(--muted)] hover:text-[var(--text)]";

const PRESS_MS = 280;

/** Neighbor hop. Press in on click, release after a short beat — no slide replay. */
export function HopNav({
  dir,
  pageId,
  href,
  label,
  hint,
  storageKey,
  onPrefetch,
  chevron = false,
}: {
  dir: "back" | "fwd";
  pageId: string;
  href: string | null;
  label: string;
  hint?: string;
  storageKey: string;
  onPrefetch?: (href: string) => void;
  /** 44 px chevron instead of the block-and-arrow cell (phone title row). */
  chevron?: boolean;
}) {
  const cell = chevron ? stepCell : hopCell;
  const [pressed, setPressed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(storageKey) === dir;
    } catch {
      return false;
    }
  });

  const remember = () => {
    try {
      sessionStorage.setItem(storageKey, dir);
    } catch {
      /* private mode */
    }
    setPressed(true);
  };

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) !== dir) return;
    } catch {
      return;
    }
    setPressed(true);
    const id = window.setTimeout(() => {
      setPressed(false);
      try {
        if (sessionStorage.getItem(storageKey) === dir) {
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        /* private mode */
      }
    }, PRESS_MS);
    return () => window.clearTimeout(id);
  }, [dir, pageId, storageKey]);

  const mark = chevron ? <StepMark dir={dir} /> : <HopMark dir={dir} />;
  if (!href) {
    return (
      <span
        data-dir={dir}
        className={clsx(cell, "cursor-default opacity-40")}
        aria-disabled
        aria-label={label}
      >
        {mark}
      </span>
    );
  }
  return (
    <Tip content={hint} side={dir === "back" ? "right" : "left"} tap={false}>
    <Link
      prefetch={false}
      href={href}
      data-dir={dir}
      aria-label={hint ?? label}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        remember();
      }}
      onClick={(e) => {
        if (e.detail === 0) remember();
      }}
      onPointerEnter={() => onPrefetch?.(href)}
      onFocus={() => onPrefetch?.(href)}
      className={clsx(cell, pressed && "is-pressed")}
    >
      {mark}
    </Link>
    </Tip>
  );
}
