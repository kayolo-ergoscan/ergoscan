/**
 * Phone «More» sheet. The four tab-bar pages are not repeated here.
 * more-menu.test.ts checks that every page the desktop rail reaches is still
 * reachable on a phone (tab bar + this sheet).
 */
import type { NavIconId } from "@/components/nav-icons";

export type MoreLink = {
  href: string;
  key: string;
  icon: NavIconId;
  match?: readonly string[];
  exact?: boolean;
  /** Leaves the explorer (wallet API docs). */
  external?: boolean;
  /** Second step only: a sub-page of the row above. */
  nested?: boolean;
};

export type MoreTile = MoreLink & {
  /** Sub-pages open as a second step inside the same sheet. */
  step?: readonly MoreLink[];
};

export type MoreGroup = { key: string; tiles: readonly MoreTile[] };

export const MORE_GROUPS: readonly MoreGroup[] = [
  {
    key: "more.explore",
    tiles: [
      { href: "/addresses", key: "nav.holders", icon: "holders", match: ["/addresses", "/richlist", "/address/"] },
      { href: "/names", key: "nav.names", icon: "names", match: ["/names"] },
      { href: "/tokens", key: "nav.tokens", icon: "tokens", match: ["/tokens", "/token/"] },
      { href: "/nfts", key: "nav.nfts", icon: "nfts", match: ["/nfts"] },
      { href: "/favorites", key: "nav.favorites", icon: "favorites", match: ["/favorites"] },
    ],
  },
  {
    key: "more.protocols",
    tiles: [
      {
        href: "/defi",
        key: "nav.defi",
        icon: "defi",
        match: ["/defi"],
        step: [
          { href: "/defi", key: "nav.defiDex", icon: "tape", exact: true },
          { href: "/defi/lithos", key: "nav.defiLithos", icon: "lithos", exact: true, nested: true },
          { href: "/defi/spectrum", key: "nav.defiSpectrum", icon: "spectrum", exact: true, nested: true },
          { href: "/defi/pool", key: "nav.defiPool", icon: "pool", match: ["/defi/pool"], nested: true },
          { href: "/defi/stable", key: "nav.defiAgeusd", icon: "ageusd", match: ["/defi/stable"] },
          { href: "/defi/basis", key: "nav.defiBasis", icon: "basis", match: ["/defi/basis"] },
        ],
      },
      {
        href: "/oracles",
        key: "nav.oracles",
        icon: "oracles",
        match: ["/oracles"],
        step: [
          { href: "/oracles", key: "more.oraclesAll", icon: "oracles", exact: true },
          { href: "/oracles/ergusd", key: "nav.oraclesOfficial", icon: "oracleUsd", exact: true },
          { href: "/oracles/erg-usd", key: "nav.oraclesUsd", icon: "oracleUsdV2", exact: true },
          { href: "/oracles/erg-usd/dort", key: "nav.dort", icon: "dort", exact: true, nested: true },
          { href: "/oracles/xau-erg", key: "nav.oraclesXau", icon: "oracleXau", exact: true },
          { href: "/oracles/xau-erg/gort", key: "nav.gort", icon: "gort", exact: true, nested: true },
        ],
      },
      {
        href: "/rent",
        key: "nav.rent",
        icon: "rent",
        match: ["/rent"],
        step: [
          { href: "/rent", key: "nav.rentUpcoming", icon: "rentSoon", exact: true },
          { href: "/rent/history", key: "nav.rentHistory", icon: "rentHist", exact: true },
        ],
      },
      { href: "/rosen", key: "nav.rosen", icon: "rosen", match: ["/rosen"] },
      { href: "/lithos", key: "nav.lithosProtocol", icon: "lithosProtocol", match: ["/lithos"] },
    ],
  },
  {
    key: "more.tools",
    tiles: [
      { href: "/fees", key: "nav.fees", icon: "mempool", match: ["/fees"] },
      { href: "/status", key: "nav.status", icon: "status", match: ["/status"] },
      {
        href: "/learn",
        key: "nav.guide",
        icon: "learn",
        match: ["/learn"],
        step: [
          { href: "/learn", key: "nav.learn", icon: "learn", exact: true },
          { href: "/learn/network", key: "nav.network", icon: "globe", exact: true },
        ],
      },
      { href: "https://api.ergoscan.me/docs", key: "nav.api", icon: "api", external: true },
    ],
  },
];

/** Footer row, next to the language switch. */
export const MORE_FOOT: readonly MoreLink[] = [
  { href: "/about", key: "nav.about", icon: "about", match: ["/about"] },
  { href: "/settings", key: "nav.settings", icon: "settings", match: ["/settings"] },
];

export function moreLinkActive(path: string, item: Pick<MoreLink, "href" | "match" | "exact" | "external">): boolean {
  if (item.external) return false;
  if (item.exact) return path === item.href;
  if (path === item.href) return true;
  return (item.match ?? [item.href]).some(
    (m) => m !== "/" && (path === m || path.startsWith(m.endsWith("/") ? m : `${m}/`))
  );
}

/** Every page the sheet opens, in sheet order. Tiles with a step open their step, not a page. */
export function moreDestinations(): string[] {
  const out: string[] = [];
  for (const g of MORE_GROUPS) {
    for (const tile of g.tiles) {
      if (tile.step?.length) out.push(...tile.step.map((s) => s.href));
      else out.push(tile.href);
    }
  }
  out.push(...MORE_FOOT.map((f) => f.href));
  return out;
}
