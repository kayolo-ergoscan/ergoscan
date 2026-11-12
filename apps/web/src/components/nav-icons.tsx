/**
 * Rail and entity glyphs, ErgoScan's own set (sources: design/brand/src/icons.mjs).
 *
 * One rule for every glyph: 24 grid, 2 px stroke, miter joins, butt caps; the line
 * is `currentColor`, and one solid "unit" (the box the glyph is about) carries the
 * entity colour from CSS (`.ico-u--block|tx|addr|token|box|down`, or the text ink).
 */
import clsx from "clsx";
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Which entity colour the unit takes. `ink` follows the text colour. */
type Ent = "ink" | "block" | "tx" | "addr" | "token" | "box" | "down";

function glyph(
  props: IconProps,
  ent: Ent,
  line: ReactNode,
  unit?: ReactNode,
  fill?: ReactNode
) {
  const { className, ...rest } = props;
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" className={clsx("ico", className)} {...rest}>
      <g stroke="currentColor" strokeWidth={2} strokeLinejoin="miter" strokeLinecap="butt" strokeMiterlimit={10}>
        {line}
      </g>
      {fill ? <g fill="currentColor">{fill}</g> : null}
      {unit ? <g className={`ico-u ico-u--${ent}`}>{unit}</g> : null}
    </svg>
  );
}

/** Home: the house, its door is the unit. */
export function IconHome(props: IconProps) {
  return glyph(props, "ink", <path d="M4 11 12 4.5 20 11v9H4z" />, <rect x="10" y="14" width="4" height="6" />);
}

/** Blocks: one block on the chain line. */
export function IconBlocks(props: IconProps) {
  return glyph(
    props,
    "block",
    <>
      <rect x="6" y="6" width="12" height="12" />
      <path d="M1 12h5M18 12h5" />
    </>,
    <rect x="9" y="9" width="6" height="6" />
  );
}

/** Mempool: an hourglass, the waiting box settled at the bottom. */
export function IconMempool(props: IconProps) {
  return glyph(
    props,
    "tx",
    <path d="M5 3h14M5 21h14M7 3v3.5l5 5.5-5 5.5V21M17 3v3.5L12 12l5 5.5V21" />,
    <rect x="9" y="15" width="6" height="5" />
  );
}

/** Transactions: a spent box, an arrow, the new box. */
export function IconTxs(props: IconProps) {
  return glyph(
    props,
    "tx",
    <>
      <rect x="2" y="9" width="6" height="6" />
      <path d="M10 12h3.5M11.5 9.5 14 12l-2.5 2.5" />
    </>,
    <rect x="16" y="8" width="7" height="8" />
  );
}

/** Addresses: a card, the owner square and two lines of what it holds. */
export function IconHolders(props: IconProps) {
  return glyph(
    props,
    "addr",
    <>
      <rect x="2" y="5" width="20" height="14" />
      <path d="M14 10h5M14 14h3" />
    </>,
    <rect x="5" y="9" width="6" height="6" />
  );
}

/** Names: a tag with the owner square. */
export function IconNames(props: IconProps) {
  return glyph(props, "addr", <path d="M3 6h11l6 6-6 6H3z" />, <rect x="6" y="9" width="6" height="6" />);
}

/** Favorites: a heart. The only glyph without a unit. */
export function IconFavorites(props: IconProps) {
  return glyph(
    props,
    "down",
    <path d="M12 20s-8-5-8-10.5A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.5C20 15 12 20 12 20z" />
  );
}

/** Tokens: a coin with a square hole. */
export function IconTokens(props: IconProps) {
  return glyph(props, "token", <circle cx="12" cy="12" r="8.5" />, <rect x="9" y="9" width="6" height="6" />);
}

/** NFTs: a picture, the sun is the unit. */
export function IconNfts(props: IconProps) {
  return glyph(
    props,
    "token",
    <>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </>,
    <rect x="13" y="6" width="5" height="5" />
  );
}

/** Storage rent: a box with a lid and a clock quarter. */
export function IconRent(props: IconProps) {
  return glyph(
    props,
    "box",
    <>
      <rect x="3" y="4" width="18" height="4" />
      <path d="M4 8v12h16V8" />
      <circle cx="12" cy="14" r="3.5" />
    </>,
    <path d="M12 10.5V14h3.5a3.5 3.5 0 0 0-3.5-3.5z" />
  );
}

/** Rent, upcoming: a calendar, the due day is the unit. */
export function IconRentSoon(props: IconProps) {
  return glyph(
    props,
    "box",
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 2v5M16 2v5" />
    </>,
    <rect x="12" y="13" width="5" height="5" />
  );
}

/** Rent, history: a dial turning back, the past quarter is the unit. */
export function IconRentHist(props: IconProps) {
  return glyph(
    props,
    "box",
    <path d="M4.3 8.5A8.5 8.5 0 1 1 3.5 12M3 3.5V9h5.5" />,
    <path d="M12 7v5H7a5 5 0 0 1 5-5z" />
  );
}

/** DeFi: a price curve on axes. */
export function IconDefi(props: IconProps) {
  return glyph(
    props,
    "token",
    <path d="M4 3v17h17M7.5 4c.8 7.5 4.5 12 13.5 12.5" />,
    <rect x="8" y="9" width="6" height="6" />
  );
}

/** DEX: two boxes trading places. */
export function IconTape(props: IconProps) {
  return glyph(
    props,
    "token",
    <>
      <rect x="15" y="14" width="6" height="6" />
      <path d="M11 7h7v4M15.5 9 18 11.5 20.5 9M13 17H6v-4M3.5 15 6 12.5 8.5 15" />
    </>,
    <rect x="3" y="4" width="6" height="6" />
  );
}

/** ErgoDex: a pool tray holding a pair. */
export function IconSpectrum(props: IconProps) {
  return glyph(
    props,
    "token",
    <>
      <path d="M2 10v10h20V10" />
      <rect x="14" y="13" width="4" height="4" />
    </>,
    <rect x="6" y="12" width="6" height="6" />
  );
}

/** Pools: a tank and its level. */
export function IconPool(props: IconProps) {
  return glyph(props, "token", <path d="M3 3v17h18V3M3 10h18" />, <rect x="6" y="13" width="12" height="4" />);
}

/** LithosDex: two candles, the live one solid. */
export function IconLithos(props: IconProps) {
  return glyph(
    props,
    "token",
    <>
      <rect x="5" y="7" width="4" height="10" />
      <path d="M7 2v5M7 17v5M17 4v5M17 18v3" />
    </>,
    <rect x="14" y="9" width="6" height="9" />
  );
}

/** Lithos protocol: a pick and its arc, the ore is the unit. */
export function IconLithosProtocol(props: IconProps) {
  return glyph(props, "block", <path d="M4 20 14 10M8.5 4.5c5 0 10 4 11 11" />, <rect x="15" y="16" width="5" height="5" />);
}

/** Stable coins: a note with the coin square. */
export function IconStable(props: IconProps) {
  return glyph(
    props,
    "token",
    <>
      <rect x="2" y="6" width="20" height="12" />
      <path d="M5.5 9v6M18.5 9v6" />
    </>,
    <rect x="9" y="9" width="6" height="6" />
  );
}

/** AgeUSD: the reserve below, the minted coin above. */
export function IconAgeusd(props: IconProps) {
  return glyph(props, "token", <path d="M3 13h18v8H3zM9 13v8M15 13v8M12 9v4" />, <rect x="9" y="2" width="6" height="6" />);
}

/** Basis: a vault on feet with its handle. */
export function IconBasis(props: IconProps) {
  return glyph(
    props,
    "box",
    <>
      <rect x="3" y="3" width="18" height="16" />
      <path d="M6 19v2M18 19v2M17 8v6" />
    </>,
    <rect x="7" y="8" width="6" height="6" />
  );
}

/** USE: a mint works, its window is the unit. */
export function IconUse(props: IconProps) {
  return glyph(props, "token", <path d="M2 21h20M4 21V11l5 3v-3l5 3V4h5v17" />, <rect x="7" y="16" width="4" height="3" />);
}

/** Oracles: a square broadcasting both ways. */
export function IconOracles(props: IconProps) {
  return glyph(
    props,
    "ink",
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.6 4.6a10.2 10.2 0 0 0 0 14.8M19.4 4.6a10.2 10.2 0 0 1 0 14.8" />,
    <rect x="9" y="9" width="6" height="6" />
  );
}

const FEED_ARCS = <path d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13" />;

/** USD v1 feed: the broadcast with a pixel 1. */
export function IconOracleUsd(props: IconProps) {
  return glyph(props, "ink", FEED_ARCS, <path d="M9 7h4v8h2v2H9v-2h2V9H9z" />);
}

/** USD v2 feed: the broadcast with a pixel 2. */
export function IconOracleUsdV2(props: IconProps) {
  return glyph(props, "ink", FEED_ARCS, <path d="M9 7h6v6h-4v2h4v2H9v-6h4V9H9z" />);
}

/** XAU feed: the broadcast with a gold ingot. */
export function IconOracleXau(props: IconProps) {
  return glyph(props, "block", FEED_ARCS, <path d="M6 16l2-6h8l2 6z" />);
}

const BUYBACK = (
  <>
    <path d="M3 13v7h18v-7" />
    <path d="M12 11v5M9.5 13.5 12 16l2.5-2.5" />
  </>
);

/** GORT buyback: the token drops into the tray (gold, from the XAU feed). */
export function IconGort(props: IconProps) {
  return glyph(props, "block", BUYBACK, <rect x="9" y="3" width="6" height="6" />);
}

/** DORT buyback: the token drops into the tray. */
export function IconDort(props: IconProps) {
  return glyph(props, "token", BUYBACK, <rect x="9" y="3" width="6" height="6" />);
}

/** Rosen bridge: two pylons and the deck, the crossing box on it. */
export function IconRosen(props: IconProps) {
  return glyph(
    props,
    "ink",
    <path d="M1 14h22M6 3v18M18 3v18M6 4c2 3 10 3 12 0M1 10c2.5 0 4-2.5 5-6M23 10c-2.5 0-4-2.5-5-6" />,
    <rect x="9" y="8" width="6" height="5" />
  );
}

/** Guide: an open book with a bookmark. */
export function IconLearn(props: IconProps) {
  return glyph(props, "ink", <path d="M2 5h7l3 2 3-2h7v14h-7l-3 2-3-2H2zM12 7v14" />, <path d="M16 5h3v7l-1.5-1.3L16 12z" />);
}

/** Network: three peers linked, one of them solid. */
export function IconGlobe(props: IconProps) {
  return glyph(
    props,
    "ink",
    <>
      <rect x="3" y="3" width="5" height="5" />
      <rect x="16" y="3" width="5" height="5" />
      <path d="M9 5.5h6M5.5 9 10 16M18.5 9 14 16" />
    </>,
    <rect x="9" y="16" width="6" height="6" />
  );
}

/** Nodes: two machines, one status light. */
export function IconNodes(props: IconProps) {
  return glyph(
    props,
    "box",
    <>
      <rect x="3" y="3" width="18" height="7" />
      <rect x="3" y="14" width="18" height="7" />
      <path d="M6 6.5h5M6 17.5h5" />
    </>,
    <rect x="15" y="16" width="3" height="3" />
  );
}

/** Settings: three sliders, the moved knob is the unit. */
export function IconSettings(props: IconProps) {
  return glyph(
    props,
    "ink",
    <path d="M3 6h18M3 12h18M3 18h18" />,
    <rect x="6" y="10" width="4" height="4" />,
    <>
      <rect x="13" y="4" width="4" height="4" />
      <rect x="14" y="16" width="4" height="4" />
    </>
  );
}

/** About: a square "i". */
export function IconAbout(props: IconProps) {
  return glyph(
    props,
    "ink",
    <>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M12 11v6" />
    </>,
    <rect x="11" y="6.5" width="2" height="2.5" />
  );
}

/** API: braces around a box. */
export function IconApi(props: IconProps) {
  return glyph(props, "ink", <path d="M8 4H6v6l-3 2 3 2v6h2M16 4h2v6l3 2-3 2v6h-2" />, <rect x="9" y="9" width="6" height="6" />);
}

/** Status: the index pulse running into a healthy box. */
export function IconStatus(props: IconProps) {
  return glyph(props, "box", <path d="M1 12h4l2.5-5 4 10 2.5-5h1" />, <rect x="17" y="9" width="6" height="6" />);
}

/** More: a grid of four boxes, one of them solid. */
export function IconMore(props: IconProps) {
  return glyph(
    props,
    "ink",
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>,
    <rect x="13" y="13" width="9" height="9" />
  );
}

export const NAV_ICONS = {
  home: IconHome,
  tokens: IconTokens,
  blocks: IconBlocks,
  txs: IconTxs,
  holders: IconHolders,
  names: IconNames,
  favorites: IconFavorites,
  defi: IconDefi,
  tape: IconTape,
  spectrum: IconSpectrum,
  pool: IconPool,
  lithos: IconLithos,
  lithosProtocol: IconLithosProtocol,
  stable: IconStable,
  ageusd: IconAgeusd,
  basis: IconBasis,
  use: IconUse,
  nfts: IconNfts,
  rent: IconRent,
  rentSoon: IconRentSoon,
  rentHist: IconRentHist,
  mempool: IconMempool,
  rosen: IconRosen,
  learn: IconLearn,
  globe: IconGlobe,
  about: IconAbout,
  settings: IconSettings,
  api: IconApi,
  status: IconStatus,
  nodes: IconNodes,
  oracles: IconOracles,
  oracleUsd: IconOracleUsd,
  oracleUsdV2: IconOracleUsdV2,
  oracleXau: IconOracleXau,
  gort: IconGort,
  dort: IconDort,
} as const;

export type NavIconId = keyof typeof NAV_ICONS;

export function NavIcon({ id, className }: { id: NavIconId; className?: string }) {
  const Cmp = NAV_ICONS[id];
  if (!Cmp) return null;
  return <Cmp className={className} />;
}
