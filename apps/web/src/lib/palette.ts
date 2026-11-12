/**
 * Miner-share donut slices — reused on the home dashboard.
 * Pages also print figures and marks in these inks inline, so they sit in the look's calm band
 * (OKLCH C ≤ 0.12, ≥ 7:1 on the panel). Coral stays: looks.css keys its coral rule on this value.
 */
export const INK = {
  cyan: "#6db0f4", // oklch(0.74 0.12 250)
  green: "#84deaf", // oklch(0.83 0.11 160)
  gold: "#ebcb71", // oklch(0.85 0.115 90), the look's block colour
  coral: "#ff8a65",
  sky: "#97c1f7", // oklch(0.80 0.09 255)
  violet: "#c4b5fd",
  teal: "#69d3c6", // oklch(0.80 0.10 185)
  /** Sequential gix — not height, not ERG. Unused elsewhere. */
  gix: "#e879f9",
} as const;

/**
 * Address entity marks. Hues not used in INK or holder-band spirals.
 * rose / khaki / olive / indigo.
 */
export const KIND = {
  protocol: "#eda4c0",
  exchange: "#dcc08a",
  pool: "#bdd86e",
  contract: "#9aa6e0",
} as const;

/** Home rent crates, small → large rent. Coral stays the taken ghost. */
export const RENT_CRATE_INK = [
  INK.violet,
  INK.sky,
  INK.cyan,
  INK.teal,
  INK.green,
  INK.gold,
] as const;

export const DONUT_SLICES: string[] = [
  INK.cyan,
  INK.green,
  INK.gold,
  INK.coral,
  INK.sky,
  INK.violet,
  INK.teal,
  "rgba(255,255,255,0.28)",
];

/** Home charts: one donut ink each, forming block shares txs. */
export const HOME = {
  erg: INK.green,
  epoch: INK.cyan,
  txs: INK.cyan,
  fees: INK.violet,
  /** Tile labels. A token, so a look can restyle every label at once. */
  forming: "var(--tile-label, #ff8a65)",
  hashrate: "#82a0ff",
} as const;
