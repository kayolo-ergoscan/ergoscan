/** Tile glyphs for feed rows. One stroke weight, 16px, ink comes from the tile. */

export type FeedGlyphId =
  | "block"
  | "transfer"
  | "token"
  | "nft"
  | "defi"
  | "stable"
  | "oracle"
  | "bridge"
  | "reward"
  | "rent"
  | "contract"
  | "mixer"
  | "in"
  | "out"
  | "self"
  | "swap"
  | "mint"
  | "burn"
  | "holder"
  | "exchange"
  | "pool"
  | "protocol"
  | "box"
  | "fee"
  | "name"
  | "none";

const PATHS: Record<FeedGlyphId, string> = {
  block: "M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7zM4.5 7.7 12 12l7.5-4.3M12 12v8.5",
  transfer: "M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5",
  token: "M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM9 12h6",
  nft: "M5 4.5h14a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM7.5 16l3.5-4 3 3 1.8-1.8L18 16",
  defi: "M7.5 4 4 7.5 7.5 11M4 7.5h14M16.5 13l3.5 3.5-3.5 3.5M20 16.5H6",
  stable: "M5.5 9.5h13M5.5 14.5h13",
  oracle: "M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2",
  bridge: "M3.5 17.5h17M5.5 17.5V14a6.5 6.5 0 0 1 13 0v3.5M9.5 17.5v-3M14.5 17.5v-3",
  reward: "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6",
  rent: "M7 4h10M7 20h10M8 4c0 4.5 8 5 8 8s-8 3.5-8 8M16 4c0 4.5-8 5-8 8s8 3.5 8 8",
  contract: "M9 4.5c-2 0-2.5 1-2.5 3v1.5c0 1.5-.8 2.3-2 3 1.2.7 2 1.5 2 3V16.5c0 2 .5 3 2.5 3M15 4.5c2 0 2.5 1 2.5 3v1.5c0 1.5.8 2.3 2 3-1.2.7-2 1.5-2 3V16.5c0 2-.5 3-2.5 3",
  mixer: "M4 7.5h3.5l9 9H20M4 16.5h3.5l2.6-2.6M13.9 10.1l2.6-2.6H20M17.5 5 20 7.5 17.5 10M17.5 14 20 16.5 17.5 19",
  in: "M17 7 7 17M7 8.5V17h8.5",
  out: "M7 17 17 7M8.5 7H17v8.5",
  self: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6",
  swap: "M7.5 4 4 7.5 7.5 11M4 7.5h14M16.5 13l3.5 3.5-3.5 3.5M20 16.5H6",
  mint: "M12 5v14M5 12h14",
  burn: "M12 3.5c.8 3.2 3.2 5 4.4 7.2 1.6 3 .2 7.3-4.4 7.3s-6-4.3-4.4-7.3c.5-1 1.3-1.8 2-2.6.2 1.7 1 2.6 2 2.9-.5-2.6-.2-5.2.4-7.5z",
  holder: "M12 5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 19.5c.9-3.4 3.7-5.5 7-5.5s6.1 2.1 7 5.5",
  exchange: "M4 9.5 12 4.5l8 5M5.5 9.5v8M10 9.5v8M14 9.5v8M18.5 9.5v8M4 19.5h16",
  pool: "M3.5 10c2.8 0 2.8-2 5.6-2s2.8 2 5.6 2 2.8-2 5.8-2M3.5 16c2.8 0 2.8-2 5.6-2s2.8 2 5.6 2 2.8-2 5.8-2",
  protocol: "M12 3.5 19.5 8v8L12 20.5 4.5 16V8zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  box: "M4.5 9h15v10.5h-15zM3.5 4.5h17V9h-17zM10 13h4",
  fee: "M5 7.5h14v9H5zM9 12h6M5 10h2M17 14h2",
  name: "M4.5 6.5h9l6 5.5-6 5.5h-9zM8 12h.01",
  none: "M6.5 12h11",
};

export function FeedGlyph({ g, size = 16 }: { g: FeedGlyphId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={PATHS[g]}
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
