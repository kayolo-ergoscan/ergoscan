/** Miner-share donut slices — reused on the home dashboard. */
export const INK = {
  cyan: "#3ca2ff",
  green: "#5ee0a0",
  gold: "#f0c14a",
  coral: "#ff8a65",
  sky: "#7eb6ff",
  violet: "#c4b5fd",
  teal: "#2dd4bf",
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
