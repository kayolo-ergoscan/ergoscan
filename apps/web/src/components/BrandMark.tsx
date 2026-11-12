import clsx from "clsx";
import type { CSSProperties } from "react";

/**
 * The ErgoScan mark «Трата»: a spent box (outline) and the box the transaction creates
 * (solid, in front). Three drawings, each snapped to its own pixel grid:
 * 16-grid up to 20 px, 24-grid up to 40 px, 48-grid above. Colours come from CSS
 * (`.brand-mark-spent` follows the text ink, `.brand-mark-new` is the brand orange).
 * Source sheets: design/brand.
 */
export function BrandMark({
  size = 24,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const grid = size <= 20 ? 16 : size <= 40 ? 24 : 48;
  return (
    <svg
      viewBox={`0 0 ${grid} ${grid}`}
      width={size}
      height={size}
      className={clsx("brand-mark", className)}
      style={style}
      aria-hidden
      focusable="false"
    >
      {grid === 16 ? (
        <>
          <path className="brand-mark-spent" fillRule="evenodd" d="M1 1h9v9H1zM3 3v5h5V3z" />
          <rect className="brand-mark-new" x="7" y="7" width="8" height="8" />
        </>
      ) : grid === 24 ? (
        <>
          <path className="brand-mark-spent" fillRule="evenodd" d="M2 2h13v13H2zM5 5v7h7V5z" />
          <rect className="brand-mark-new" x="10" y="10" width="12" height="12" />
        </>
      ) : (
        <>
          <path className="brand-mark-spent" fillRule="evenodd" d="M4 4h26v26H4zM9 9v16h16V9z" />
          <rect className="brand-mark-new" x="20" y="20" width="24" height="24" />
        </>
      )}
    </svg>
  );
}

/** «ergoscan.me» as live text in the site face; `.me` sits a step quieter. */
export function BrandWord({ className }: { className?: string }) {
  return (
    <span className={clsx("brand-word", className)}>
      ergoscan<span className="brand-word-tld">.me</span>
    </span>
  );
}
