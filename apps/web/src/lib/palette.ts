/**
 * Shared inks. Pages print them inline as CSS tokens (`INK`, `INK_TEXT`, `KIND`), answered by the
 * dark look (looks.css) and the light ink (light.css). Canvas and chart code cannot read a token: it
 * takes the raw dark inks (`INK_HEX`, `RENT_CRATE_INK`, `DONUT_SLICES`, `HOME`) and maps them with
 * lookInk (look.ts), which answers for the page's ink.
 *
 * On black the inks sit in the look's calm band (OKLCH C ≤ 0.12, ≥ 7:1 on the panel), so marks and
 * words share one value. On the light ink a word needs more contrast than a mark: words take
 * `INK_TEXT`. Coral stays: looks.css keys its coral rule on the `--ink-coral` token.
 */
export const INK_HEX = {
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

type InkName = keyof typeof INK_HEX;

/** Marks: glyphs, swatches, bars, tile inks. */
export const INK: Record<InkName, string> = {
  cyan: "var(--ink-cyan)",
  green: "var(--ink-green)",
  gold: "var(--ink-gold)",
  coral: "var(--ink-coral)",
  sky: "var(--ink-sky)",
  violet: "var(--ink-violet)",
  teal: "var(--ink-teal)",
  gix: "var(--ink-gix)",
};

/** Words and figures printed in an ink. */
export const INK_TEXT: Record<InkName, string> = {
  cyan: "var(--ink-cyan-text)",
  green: "var(--ink-green-text)",
  gold: "var(--ink-gold-text)",
  coral: "var(--ink-coral-text)",
  sky: "var(--ink-sky-text)",
  violet: "var(--ink-violet-text)",
  teal: "var(--ink-teal-text)",
  gix: "var(--ink-gix-text)",
};

/**
 * Address entity marks. Hues not used in INK or holder-band spirals.
 * rose / khaki / olive / indigo.
 */
export const KIND = {
  protocol: "var(--kind-protocol)",
  exchange: "var(--kind-exchange)",
  pool: "var(--kind-pool)",
  contract: "var(--kind-contract)",
} as const;

/** Home rent crates, small → large rent (canvas). Coral stays the taken ghost. */
export const RENT_CRATE_INK = [
  INK_HEX.violet,
  INK_HEX.sky,
  INK_HEX.cyan,
  INK_HEX.teal,
  INK_HEX.green,
  INK_HEX.gold,
] as const;

/** Miner-share donut slices (chart canvas), reused on the home dashboard. The last is «the rest». */
export const DONUT_SLICES: string[] = [
  INK_HEX.cyan,
  INK_HEX.green,
  INK_HEX.gold,
  INK_HEX.coral,
  INK_HEX.sky,
  INK_HEX.violet,
  INK_HEX.teal,
  "rgba(255,255,255,0.28)",
];

/** Home charts (canvas): one ink each, forming block shares txs. */
export const HOME = {
  erg: INK_HEX.green,
  epoch: INK_HEX.cyan,
  txs: INK_HEX.cyan,
  fees: INK_HEX.violet,
  /** Tile labels. A token, so a look can restyle every label at once. */
  forming: "var(--tile-label, #ff8a65)",
  hashrate: "#82a0ff",
} as const;
