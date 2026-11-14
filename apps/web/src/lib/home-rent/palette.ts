/**
 * The harbour's colours, one place. Two palettes: «Ночь» for the dark inks and «Сумерки» (a dusk
 * harbour) for the light ink. The scene never reads CSS for its own colours; text and fonts come
 * from the site tokens (readInks). To follow the light theme's tokens later, change `harbourInk`
 * or derive a palette from them here: the painters only see `HarbourPalette`.
 */
/** The site's gold and coral as hex: a canvas paints only real colours, never a CSS var(). */
const GOLD = "#ebcb71";
const CORAL = "#ff8a65";

export type HarbourPalette = {
  name: "night" | "dusk";
  /** Sky above the horizon, top → horizon; null: the card itself is the sky. */
  sky: readonly string[] | null;
  /** Sea bands, horizon → near shore. */
  sea: readonly string[];
  ripple: string;
  rippleHi: string;
  /** The horizon line and its haze. */
  horizon: string;
  haze: string;
  rock: readonly [string, string, string, string, string];
  foam: string;
  foamDim: string;
  lighthouse: { wall: string; wallSh: string; wallHi: string; band: string; bandSh: string; roof: string; glass: string; frame: string; door: string };
  hull: { side: string; stripe: string; rail: string; keel: string; cabin: string; cabinSh: string; roof: string; mast: string; yard: string; port: string; window: string };
  tug: { hull: string; hullHi: string; hullLo: string; house: string; houseSh: string; frame: string; fender: string; crane: string; post: string; hook: string };
  waterline: string;
  wake: string;
  /** Under the water: the tint over a hull that sits low. */
  deep: string;
  /** Lights on the water (porthole, cohort lights, the lantern). */
  light: string;
  lightHot: string;
  coin: string;
  coinHi: string;
  /** Plates behind canvas labels drawn over the water. */
  plate: string;
  plateText: string;
  plateMuted: string;
  gold: string;
  coral: string;
  /** The sea fades out under the text columns of the reef (light card: text must sit on the card). */
  reefTextFade: boolean;
};

const NIGHT: HarbourPalette = {
  name: "night",
  sky: null,
  sea: ["#1d2935", "#1a2530", "#17212b", "#151e27", "#131b23", "#11181f", "#10161c"],
  ripple: "#283849",
  rippleHi: "#3a5068",
  horizon: "#2c3c4d",
  haze: "rgba(120,150,180,0.10)",
  rock: ["#24201c", "#332d27", "#433a32", "#57493b", "#6c5a48"],
  foam: "rgba(200,214,226,0.75)",
  foamDim: "rgba(169,188,205,0.5)",
  lighthouse: { wall: "#e2dacb", wallSh: "#b8ae9c", wallHi: "#f3eee4", band: "#d9775b", bandSh: "#ad5d47", roof: "#2b2622", glass: "#ffe2a0", frame: "#3b342d", door: "#2a231d" },
  hull: { side: "#5e4838", stripe: "#7a5e48", rail: "#9a8064", keel: "#352a21", cabin: "#c9c1b0", cabinSh: "#9d9585", roof: "#3f3830", mast: "#a39a88", yard: "#7d7466", port: "#8a7552", window: "#6d675c" },
  tug: { hull: "#2e3641", hullHi: "#56606f", hullLo: "#1c2128", house: "#cdc5b4", houseSh: "#a69e8e", frame: "#3b342d", fender: "#15181d", crane: GOLD, post: "#8a7a52", hook: "#9d9585" },
  waterline: "#33475c",
  wake: "#24364a",
  deep: "rgba(20,40,60,0.45)",
  light: GOLD,
  lightHot: "#fff2c4",
  coin: "#c9a24e",
  coinHi: "#fff2c4",
  plate: "rgba(16,20,26,0.74)",
  plateText: "rgba(255,255,255,0.92)",
  plateMuted: "rgba(255,255,255,0.6)",
  gold: GOLD,
  coral: CORAL,
  reefTextFade: false,
};

/** «Сумерки»: the same harbour at dusk — lavender water under a peach sky, lamps just lit. */
const DUSK: HarbourPalette = {
  name: "dusk",
  sky: ["#f4dcc8", "#ead2cf", "#d9cbe0", "#c3c3e0"],
  sea: ["#8e9cc4", "#8190b9", "#7485ad", "#6979a2", "#5f6f97", "#56658c", "#4e5c82"],
  ripple: "#9daad0",
  rippleHi: "#e9c9b4",
  horizon: "#a9b4d6",
  haze: "rgba(250,226,210,0.35)",
  rock: ["#4a4250", "#5b5160", "#6d6270", "#837684", "#9b8d98"],
  foam: "rgba(250,246,242,0.9)",
  foamDim: "rgba(236,232,240,0.6)",
  lighthouse: { wall: "#f6efe4", wallSh: "#cfc3b4", wallHi: "#ffffff", band: "#d9694c", bandSh: "#b0533d", roof: "#3c3440", glass: "#ffe7a8", frame: "#4b4250", door: "#3a3240" },
  hull: { side: "#6b5446", stripe: "#8a6c56", rail: "#ab9076", keel: "#3f3129", cabin: "#efe6d8", cabinSh: "#c4b8a6", roof: "#4b4250", mast: "#5d5560", yard: "#6d6470", port: "#e8c27a", window: "#8d8590" },
  tug: { hull: "#3a4352", hullHi: "#66718a", hullLo: "#262c37", house: "#efe6d8", houseSh: "#c4b8a6", frame: "#4b4250", fender: "#20242c", crane: "#d9a640", post: "#7a6a48", hook: "#5d5560" },
  waterline: "#a8b5d8",
  wake: "#6d7ca3",
  deep: "rgba(40,50,90,0.4)",
  light: "#ffd98a",
  lightHot: "#fff6dc",
  coin: "#c9962e",
  coinHi: "#fff2c4",
  plate: "rgba(44,42,66,0.82)",
  plateText: "rgba(255,255,255,0.95)",
  plateMuted: "rgba(255,255,255,0.7)",
  gold: "#d9a640",
  coral: "#e0603e",
  reefTextFade: true,
};

/** Which palette an ink takes: the light ink («Сумерки», `light`; `day` on older builds) → dusk. */
export function harbourInk(ink: string | null | undefined): HarbourPalette {
  return ink === "light" || ink === "day" ? DUSK : NIGHT;
}

export function harbourPalette(el: Element | null = typeof document !== "undefined" ? document.documentElement : null): HarbourPalette {
  return harbourInk((el as HTMLElement | null)?.dataset?.ink ?? null);
}

export const HARBOUR_PALETTES = { night: NIGHT, dusk: DUSK } as const;
