/**
 * KPI tile icons. One concept, one glyph: a tile about blocks always shows the
 * block, a tile about fees always shows the fee receipt, on every page.
 *
 * Same rules as the rail set (nav-icons.tsx, design/brand/src/icons.mjs):
 * 24 grid, one 2 px stroke, miter joins, butt caps, square corners; line work
 * plus at most one solid "unit" (the eUTXO box the glyph is about). Where a
 * concept has a rail glyph, the tile uses the same drawing.
 *
 * Straight strokes sit on whole pixels, so the glyph stays crisp at 24 px on a
 * 1× screen and at 48 device px on a 2× one. The tile sizes it (globals.css,
 * `.kpi-ico`); colour is `currentColor` for line and unit alike, set by the
 * tile (`tone`, the card ink, or the site look).
 */
import clsx from "clsx";
import type { ReactNode } from "react";

type Glyph = {
  /** English name for the icon sheet. */
  name: string;
  /** Stroked line work. */
  l: ReactNode;
  /** Solid unit. */
  u?: ReactNode;
};

/** Square spiral around the holder's box, outward. Tiers take more of it. */
const TIER_PTS: [number, number][] = [
  [17, 13],
  [17, 7],
  [7, 7],
  [7, 17],
  [21, 17],
  [21, 3],
  [3, 3],
  [3, 21],
  [21, 21],
];

function tierPath(segments: number): string {
  return TIER_PTS.slice(0, segments + 1)
    .map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`)
    .join("");
}

const TIER_UNIT = <rect x="10" y="10" width="4" height="4" />;

/** The calendar of the rent horizons; the unit is how far ahead. */
const CAL = <path d="M3 5h18v16H3zM3 10h18M8 2v5M16 2v5" />;

const GLYPHS = {
  // ── chain ────────────────────────────────────────────────
  block: {
    name: "Block",
    l: <path d="M6 6h12v12H6zM1 12h5M18 12h5" />,
    u: <rect x="9" y="9" width="6" height="6" />,
  },
  height: {
    name: "Height",
    l: <path d="M2 4h4M4 4v17M2 21h4M11 13h10v8H11z" />,
    u: <rect x="10" y="3" width="12" height="7" />,
  },
  interval: {
    name: "Interval",
    l: <path d="M3 4h6v6H3zM6 14v6M18 14v6M6 17h12" />,
    u: <rect x="14" y="3" width="8" height="8" />,
  },
  tx: {
    name: "Transaction",
    l: <path d="M2 9h6v6H2zM10 12h3.5M11.5 9.5 14 12l-2.5 2.5" />,
    u: <rect x="16" y="8" width="7" height="8" />,
  },
  "tx-total": {
    name: "All transactions",
    l: <path d="M2 4h6v6H2zM10 7h3.5M11.5 4.5 14 7l-2.5 2.5M2 15h20M2 20h20" />,
    u: <rect x="16" y="3" width="7" height="8" />,
  },
  "per-block": {
    name: "Per block",
    l: <path d="M6 6h12v12H6zM1 12h5M18 12h5" />,
    u: (
      <>
        <rect x="9" y="9" width="6" height="2" />
        <rect x="9" y="13" width="6" height="2" />
      </>
    ),
  },
  mempool: {
    name: "Mempool",
    l: <path d="M5 3h14M5 21h14M7 3v3.5l5 5.5-5 5.5V21M17 3v3.5L12 12l5 5.5V21" />,
    u: <rect x="9" y="15" width="6" height="5" />,
  },
  load: {
    name: "Load",
    l: <path d="M2 7h18v10H2zM22 10v4" />,
    u: <rect x="5" y="10" width="5" height="4" />,
  },
  fee: {
    name: "Fee",
    l: <path d="M5 3h14v18l-2.3-1.5-2.4 1.5-2.3-1.5-2.3 1.5-2.4-1.5L5 21zM9 14h6M9 17h4" />,
    u: <rect x="9" y="6" width="6" height="4" />,
  },
  "fee-rate": {
    name: "Fee rate",
    l: <path d="M3 18a9 9 0 0 1 18 0M12 17l5-6M1 21h22" />,
    u: <rect x="10" y="15" width="4" height="4" />,
  },
  size: {
    name: "Size",
    l: <path d="M3 3v4M21 3v4M3 5h18M3 10h18v10H3z" />,
    u: <rect x="6" y="13" width="7" height="4" />,
  },
  time: {
    name: "Time",
    l: <circle cx="12" cy="12" r="9" />,
    u: <path d="M12 6v6h6a6 6 0 0 0-6-6z" />,
  },
  miner: {
    name: "Miner",
    l: <path d="M4 20 14 10M8.5 4.5c5 0 10 4 11 11" />,
    u: <rect x="15" y="16" width="5" height="5" />,
  },
  erg: {
    name: "ERG",
    l: <path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7zM15 8H9l3 4-3 4h6" />,
  },

  // ── who and what ─────────────────────────────────────────
  address: {
    name: "Address",
    l: <path d="M2 5h20v14H2zM14 10h5M14 14h3" />,
    u: <rect x="5" y="9" width="6" height="6" />,
  },
  wallet: {
    name: "Wallet",
    l: <path d="M3 7h18v13H3zM6 7V3h11v4" />,
    u: <rect x="14" y="11" width="8" height="5" />,
  },
  holders: {
    name: "Holders",
    l: (
      <>
        <path d="M3 21v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3M17 15h1a3 3 0 0 1 3 3v3" />
        <rect x="15" y="5" width="4" height="5" />
      </>
    ),
    u: <rect x="6" y="5" width="6" height="6" />,
  },
  trader: {
    name: "Trader",
    l: <path d="M2 21v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3M16 5h6M20 3l2 2-2 2M22 11h-6M18 9l-2 2 2 2" />,
    u: <rect x="5" y="5" width="6" height="6" />,
  },
  activity: {
    name: "Activity",
    l: <path d="M1 12c3-4.5 7-6.5 11-6.5s8 2 11 6.5c-3 4.5-7 6.5-11 6.5S4 16.5 1 12z" />,
    u: <rect x="9" y="9" width="6" height="6" />,
  },
  name: {
    name: "Name",
    l: <path d="M3 6h11l6 6-6 6H3z" />,
    u: <rect x="6" y="9" width="6" height="6" />,
  },
  protocol: {
    name: "Protocol",
    l: (
      <>
        <circle cx="12" cy="12" r="6" />
        <path d="M12 1v5M12 18v5M1 12h5M18 12h5M4.2 4.2l3.5 3.5M16.3 16.3l3.5 3.5M4.2 19.8l3.5-3.5M16.3 7.7l3.5-3.5" />
      </>
    ),
    u: <rect x="10" y="10" width="4" height="4" />,
  },
  exchange: {
    name: "Exchange",
    l: <path d="M2 21h20M3 10h18M6 12v6M12 12v6M18 12v6" />,
    u: <path d="M12 2 22 8H2z" />,
  },
  contract: {
    name: "Contract",
    l: <path d="M4 2h11l5 5v15H4zM10 11l-3 3.5 3 3.5M14 11l3 3.5-3 3.5" />,
    u: <path d="M15 2v5h5z" />,
  },
  "tier-dust": { name: "Tier 1 · dust", l: <path d={tierPath(2)} />, u: TIER_UNIT },
  "tier-stacker": { name: "Tier 2 · stack", l: <path d={tierPath(3)} />, u: TIER_UNIT },
  "tier-believer": { name: "Tier 3 · believer", l: <path d={tierPath(4)} />, u: TIER_UNIT },
  "tier-guardian": { name: "Tier 4 · guardian", l: <path d={tierPath(6)} />, u: TIER_UNIT },
  "tier-overlord": { name: "Tier 5 · overlord", l: <path d={tierPath(8)} />, u: TIER_UNIT },

  // ── boxes and assets ─────────────────────────────────────
  box: {
    name: "Box",
    l: <path d="M4 9v11h16V9M10 13h4" />,
    u: <rect x="2" y="4" width="20" height="5" />,
  },
  token: {
    name: "Token",
    l: <circle cx="12" cy="12" r="8.5" />,
    u: <rect x="9" y="9" width="6" height="6" />,
  },
  nft: {
    name: "NFT",
    l: <path d="M3 3h18v18H3zM3 17l5-5 4 4 3-3 6 6" />,
    u: <rect x="13" y="6" width="5" height="5" />,
  },
  picture: {
    name: "With a picture",
    l: (
      <>
        <path d="M3 7h18v14H3zM8 7l2-3h4l2 3" />
        <circle cx="12" cy="14" r="4" />
      </>
    ),
    u: <rect x="16" y="9" width="3" height="2" />,
  },
  collection: {
    name: "Collection",
    l: <path d="M7 3h14v14M3 7h14v14H3z" />,
    u: <rect x="6" y="10" width="5" height="5" />,
  },
  info: {
    name: "Info",
    l: <path d="M3 3h18v18H3zM12 11v6" />,
    u: <rect x="11" y="6" width="2" height="3" />,
  },

  // ── storage rent ─────────────────────────────────────────
  rent: {
    name: "Storage rent",
    l: (
      <>
        <path d="M3 4h18v4H3zM4 8v12h16V8" />
        <circle cx="12" cy="14" r="3.5" />
      </>
    ),
    u: <path d="M12 10.5V14h3.5a3.5 3.5 0 0 0-3.5-3.5z" />,
  },
  "due-day": { name: "Due in a day", l: CAL, u: <rect x="6" y="13" width="4" height="4" /> },
  "due-week": { name: "Due in a week", l: CAL, u: <rect x="6" y="13" width="12" height="3" /> },
  "due-month": { name: "Due in a month", l: CAL, u: <rect x="6" y="13" width="12" height="6" /> },
  collected: {
    name: "Collected",
    l: <path d="M3 12v9h18v-9M12 2v6M9 5l3 3 3-3" />,
    u: <rect x="7" y="15" width="10" height="3" />,
  },
  claim: {
    name: "Claim",
    l: <path d="M4 12v9h16v-9M12 18V8M9 11l3-3 3 3" />,
    u: <rect x="9" y="1" width="6" height="4" />,
  },
  leader: {
    name: "Top share",
    l: <path d="M3 13h5v8H3zM16 16h5v5h-5z" />,
    u: <rect x="9" y="5" width="6" height="17" />,
  },

  // ── markets ──────────────────────────────────────────────
  pool: {
    name: "Pool",
    l: <path d="M3 3v17h18V3M3 10h18" />,
    u: <rect x="6" y="13" width="12" height="4" />,
  },
  swap: {
    name: "Swap",
    l: <path d="M15 14h6v6h-6zM11 7h7v4M15.5 9 18 11.5 20.5 9M13 17H6v-4M3.5 15 6 12.5 8.5 15" />,
    u: <rect x="3" y="4" width="6" height="6" />,
  },
  volume: {
    name: "Volume",
    l: <path d="M3 14h4v7H3zM10 9h4v12h-4z" />,
    u: <rect x="16" y="3" width="6" height="19" />,
  },
  price: {
    name: "Price",
    l: <path d="M2 20l6-6 4 4 7-7M1 22h22" />,
    u: <rect x="17" y="3" width="5" height="5" />,
  },
  percent: {
    name: "Percent",
    l: <path d="M20 3 4 21M3 3h6v6H3z" />,
    u: <rect x="15" y="15" width="6" height="6" />,
  },
  since: {
    name: "First seen",
    l: <path d="M5 2v20" />,
    u: <path d="M6 3h13l-3 4 3 4H6z" />,
  },
  vault: {
    name: "Vault",
    l: <path d="M3 3h18v16H3zM6 19v2M18 19v2M17 8v6" />,
    u: <rect x="7" y="8" width="6" height="6" />,
  },
  locked: {
    name: "Locked",
    l: <path d="M4 11h16v10H4zM8 11V4h8v7" />,
    u: <rect x="10" y="14" width="4" height="4" />,
  },
  mint: {
    name: "Bank events",
    l: <path d="M3 13h18v8H3zM9 13v8M15 13v8M12 9v4" />,
    u: <rect x="9" y="2" width="6" height="6" />,
  },
  "top-up": {
    name: "Top-up",
    l: <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />,
    u: <rect x="9" y="9" width="6" height="6" />,
  },
  returned: {
    name: "Returned",
    l: <path d="M20 3v9H9M12 9l-3 3 3 3" />,
    u: <rect x="2" y="9" width="5" height="6" />,
  },
  tracker: {
    name: "Tracker",
    l: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
      </>
    ),
    u: <rect x="10" y="10" width="4" height="4" />,
  },

  // ── network ──────────────────────────────────────────────
  oracle: {
    name: "Oracle",
    l: (
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.6 4.6a10.2 10.2 0 0 0 0 14.8M19.4 4.6a10.2 10.2 0 0 1 0 14.8" />
    ),
    u: <rect x="9" y="9" width="6" height="6" />,
  },
  node: {
    name: "Node",
    l: <path d="M3 2h18v8H3zM3 13h18v8H3zM6 6h5M6 17h5" />,
    u: <rect x="15" y="15" width="3" height="3" />,
  },
  bridge: {
    name: "Bridge",
    l: <path d="M1 14h22M6 3v18M18 3v18M6 4c2 3 10 3 12 0M1 10c2.5 0 4-2.5 5-6M23 10c-2.5 0-4-2.5-5-6" />,
    u: <rect x="9" y="8" width="6" height="5" />,
  },
  done: {
    name: "Done",
    l: <path d="M3 3h18v18H3zM7 12l3.5 3.5L17 9" />,
  },
  transit: {
    name: "In transit",
    l: <path d="M1 11h6M3 15h4M1 19h6M11 9v11h10V9" />,
    u: <rect x="10" y="5" width="12" height="4" />,
  },
  route: {
    name: "Route",
    l: <path d="M2 2h6v6H2zM5 9v4h14v3" />,
    u: <rect x="16" y="16" width="6" height="6" />,
  },
  status: {
    name: "Status",
    l: <path d="M1 12h4l2.5-5 4 10 2.5-5h1" />,
    u: <rect x="17" y="9" width="6" height="6" />,
  },
  network: {
    name: "Network",
    l: <path d="M3 3h5v5H3zM16 3h5v5h-5zM9 5.5h6M5.5 9 10 16M18.5 9 14 16" />,
    u: <rect x="9" y="16" width="6" height="6" />,
  },
  guide: {
    name: "Guide",
    l: <path d="M2 5h7l3 2 3-2h7v14h-7l-3 2-3-2H2zM12 7v14" />,
    u: <path d="M16 5h3v7l-1.5-1.3L16 12z" />,
  },
  api: {
    name: "API",
    l: <path d="M8 4H6v6l-3 2 3 2v6h2M16 4h2v6l3 2-3 2v6h-2" />,
    u: <rect x="9" y="9" width="6" height="6" />,
  },
} satisfies Record<string, Glyph>;

export type KpiMarkId = keyof typeof GLYPHS;

/** Every concept in sheet order, with its English name. */
export const KPI_MARKS: { id: KpiMarkId; name: string }[] = (
  Object.keys(GLYPHS) as KpiMarkId[]
).map((id) => ({ id, name: GLYPHS[id].name }));

export function KpiMark({
  id,
  tone,
  className,
}: {
  id: KpiMarkId;
  /** For grids that do not colour the mark themselves (KpiGrid). */
  tone?: string;
  className?: string;
}) {
  const g: Glyph = GLYPHS[id];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      focusable="false"
      className={clsx("kpi-ico", className)}
      style={tone ? { color: tone } : undefined}
    >
      <g stroke="currentColor" strokeWidth={2} strokeLinejoin="miter" strokeLinecap="butt" strokeMiterlimit={10}>
        {g.l}
      </g>
      {g.u ? (
        <g className="kpi-ico-u" fill="currentColor" stroke="none">
          {g.u}
        </g>
      ) : null}
    </svg>
  );
}
