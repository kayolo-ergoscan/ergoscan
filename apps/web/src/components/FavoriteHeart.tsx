"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

const HEART = "#e25563";
const POP_MS = 480;

export function FavoriteHeart({
  on,
  title,
  onToggle,
  ready = true,
  size = "md",
}: {
  on: boolean;
  title: string;
  onToggle: () => void;
  ready?: boolean;
  size?: "md" | "sm";
}) {
  const [pop, setPop] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    []
  );

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={!ready}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !on;
        onToggle();
        if (!next) return;
        if (timer.current != null) window.clearTimeout(timer.current);
        setPop(true);
        timer.current = window.setTimeout(() => setPop(false), POP_MS);
      }}
      className={clsx(
        "chip-press tap-44 relative inline-flex shrink-0 items-center justify-center transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)]",
        size === "sm" ? "h-[18px] w-[18px] rounded-[5px]" : "h-8 w-8 rounded-[8px]",
        ready ? "" : "invisible",
        on ? "" : "text-[var(--muted)] hover:text-[#e25563]"
      )}
      style={on ? { color: HEART } : undefined}
    >
      {pop && (
        <span
          className="fav-heart-ring pointer-events-none absolute inset-0 rounded-full border-2"
          style={{ borderColor: HEART }}
          aria-hidden
        />
      )}
      <svg
        width={size === "sm" ? 12 : 20}
        height={size === "sm" ? 12 : 20}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className={pop ? "fav-heart-pop" : undefined}
      >
        <path
          d="M12 20.15S4.85 15.4 4.85 10.55A3.75 3.75 0 0 1 12 8.2a3.75 3.75 0 0 1 7.15 2.35C19.15 15.4 12 20.15 12 20.15Z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
