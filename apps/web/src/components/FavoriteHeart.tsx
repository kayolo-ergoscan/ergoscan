"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useFloatTip, useTip } from "@/components/Tip";
import { useT } from "@/lib/i18n/I18nProvider";
import { say } from "@/lib/kayolo/events";

const HEART = "#e25563";
const POP_MS = 480;
/** How long «Saved to Favorites» stays after a press. */
const SAID_MS = 1600;

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
  const t = useT();
  const [pop, setPop] = useState(false);
  const timer = useRef<number | null>(null);
  const saidTimer = useRef<number | null>(null);
  // Hover and keyboard: what a press will do. A tap is the action itself, so no tip on tap.
  const tip = useTip(title, { tap: false });
  // After a press, on mouse and on touch alike: what it did.
  const said = useFloatTip();

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      if (saidTimer.current != null) window.clearTimeout(saidTimer.current);
    },
    []
  );

  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={on}
      disabled={!ready}
      {...tip}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !on;
        onToggle();
        say({ k: next ? "ui:fav-on" : "ui:fav-off", el: e.currentTarget });
        const r = e.currentTarget.getBoundingClientRect();
        said.show(
          { left: r.left, top: r.top, width: r.width, height: r.height },
          t(next ? "favorites.added" : "favorites.removed"),
          { tapped: true }
        );
        if (saidTimer.current != null) window.clearTimeout(saidTimer.current);
        saidTimer.current = window.setTimeout(() => said.hide(), SAID_MS);
        if (!next) return;
        if (timer.current != null) window.clearTimeout(timer.current);
        setPop(true);
        timer.current = window.setTimeout(() => setPop(false), POP_MS);
      }}
      className={clsx(
        "fav-heart chip-press relative inline-flex shrink-0 items-center justify-center transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)]",
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
