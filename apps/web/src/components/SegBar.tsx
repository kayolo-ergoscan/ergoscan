import clsx from "clsx";
import type { ReactNode } from "react";

/** Same paper strip as `/docs` tabs. Equal cells when `cols` is set. */
export function SegBar({
  cols,
  children,
  className,
}: {
  cols?: 2 | 3 | 4 | 5 | 7;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      className={clsx(
        "seg-paper w-full min-w-0 rounded-[14px] bg-[var(--wash)] p-1",
        cols ? "grid" : "flex",
        cols === 2 && "grid-cols-2",
        cols === 3 && "grid-cols-3",
        cols === 4 && "grid-cols-4",
        cols === 5 && "grid-cols-3 sm:grid-cols-5",
        cols === 7 && "grid-cols-7",
        className
      )}
    >
      {children}
    </nav>
  );
}

export function segItem(on: boolean, opts?: { press?: boolean }) {
  const press = opts?.press !== false;
  return clsx(
    "flex min-w-0 flex-1 items-center justify-center truncate rounded-[10px] px-1.5 py-1.5 max-lg:min-h-10 text-center text-[12px] font-medium transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] sm:px-3 sm:text-[13px]",
    press && "chip-press",
    on
      ? clsx("seg-on bg-[var(--wash-strong)] text-[var(--text)]", press && "is-pressed")
      : "text-[var(--muted)] hover:text-[var(--text)]"
  );
}
