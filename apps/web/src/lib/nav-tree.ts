/**
 * The site map the desktop rail draws. The phone «More» sheet is checked
 * against it (more-menu.test.ts), so nothing the rail reaches gets lost on a phone.
 */
import type { NavIconId } from "@/components/nav-icons";

export type NavLeaf = {
  href: string;
  key: string;
  icon: NavIconId;
  match?: string[];
  exact?: boolean;
  /** Leaves the explorer. The wallet API lives on its own host. */
  external?: boolean;
};

export type NavItem = NavLeaf & {
  children?: NavItem[];
  /** Name opens the page. The chevron only opens children. */
  linkLabel?: boolean;
};

export const NAV_MAIN: NavItem[] = [
  { href: "/", key: "nav.home", icon: "home" },
  { href: "/blocks", key: "nav.blocks", icon: "blocks", match: ["/blocks", "/block/"] },
  { href: "/mempool", key: "nav.mempool", icon: "mempool", match: ["/mempool"] },
  { href: "/transactions", key: "nav.txs", icon: "txs", match: ["/transactions", "/tx/"] },
  { href: "/addresses", key: "nav.holders", icon: "holders", match: ["/addresses", "/richlist", "/address/"] },
  { href: "/names", key: "nav.names", icon: "names", match: ["/names"] },
  { href: "/favorites", key: "nav.favorites", icon: "favorites", match: ["/favorites"] },
  { href: "/tokens", key: "nav.tokens", icon: "tokens", match: ["/tokens", "/token/"] },
  { href: "/nfts", key: "nav.nfts", icon: "nfts", match: ["/nfts"] },
  {
    href: "/rent",
    key: "nav.rent",
    icon: "rent",
    match: ["/rent"],
    children: [
      { href: "/rent", key: "nav.rentUpcoming", icon: "rentSoon", exact: true },
      { href: "/rent/history", key: "nav.rentHistory", icon: "rentHist", exact: true },
    ],
  },
  {
    href: "/defi",
    key: "nav.defi",
    icon: "defi",
    match: ["/defi"],
    children: [
      {
        href: "/defi",
        key: "nav.defiDex",
        icon: "tape",
        match: ["/defi/lithos", "/defi/spectrum", "/defi/pool"],
        children: [
          { href: "/defi/lithos", key: "nav.defiLithos", icon: "lithos", exact: true },
          {
            href: "/defi/spectrum",
            key: "nav.defiSpectrum",
            icon: "spectrum",
            exact: true,
            linkLabel: true,
            children: [
              { href: "/defi/pool", key: "nav.defiPool", icon: "pool", match: ["/defi/pool"] },
            ],
          },
        ],
      },
      {
        href: "/defi/stable",
        key: "nav.defiStable",
        icon: "stable",
        match: ["/defi/stable"],
        children: [
          { href: "/defi/stable", key: "nav.defiAgeusd", icon: "ageusd", exact: true },
        ],
      },
      {
        href: "/defi/basis",
        key: "nav.defiBasis",
        icon: "basis",
        match: ["/defi/basis"],
      },
    ],
  },
  {
    href: "/oracles",
    key: "nav.oracles",
    icon: "oracles",
    match: ["/oracles"],
    children: [
      { href: "/oracles/ergusd", key: "nav.oraclesOfficial", icon: "oracleUsd", exact: true },
      {
        href: "/oracles/erg-usd",
        key: "nav.oraclesUsd",
        icon: "oracleUsdV2",
        exact: true,
        linkLabel: true,
        children: [{ href: "/oracles/erg-usd/dort", key: "nav.dort", icon: "dort", exact: true }],
      },
      {
        href: "/oracles/xau-erg",
        key: "nav.oraclesXau",
        icon: "oracleXau",
        exact: true,
        linkLabel: true,
        children: [{ href: "/oracles/xau-erg/gort", key: "nav.gort", icon: "gort", exact: true }],
      },
    ],
  },
  { href: "/rosen", key: "nav.rosen", icon: "rosen", match: ["/rosen"] },
  { href: "/lithos", key: "nav.lithosProtocol", icon: "lithosProtocol", match: ["/lithos"] },
];

export const NAV_FOOT: NavItem[] = [
  {
    href: "/learn",
    key: "nav.guide",
    icon: "learn",
    match: ["/learn"],
    children: [
      { href: "/learn", key: "nav.learn", icon: "learn", exact: true },
      { href: "/learn/network", key: "nav.network", icon: "globe", exact: true },
    ],
  },
  { href: "/settings", key: "nav.settings", icon: "settings", match: ["/settings"] },
  { href: "/about", key: "nav.about", icon: "about", match: ["/about"] },
  { href: "https://api.ergoscan.me/docs", key: "nav.api", icon: "api", external: true },
  { href: "/status", key: "nav.status", icon: "status", match: ["/status"] },
];
