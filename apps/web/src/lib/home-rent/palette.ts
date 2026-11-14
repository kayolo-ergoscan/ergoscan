/**
 * The harbour's colours, one place: «Ночь» for every ink, like the other home scenes. The scene
 * never reads CSS for its own colours; text and fonts come from the canvas's tokens (readInks), which
 * under the light ink are the scene tokens of `canvas[data-scene]`. The painters only see
 * `HarbourPalette`.
 */
/** The site's gold and coral as hex: a canvas paints only real colours, never a CSS var(). */
const GOLD = "#ebcb71";
const CORAL = "#ff8a65";

export type HarbourPalette = {
  name: "night";
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

/**
 * The light ink: the home scenes keep their night inks under the theme's dusk sky
 * (`canvas[data-scene]` paints it and carries light text tokens), so the harbour is the night one
 * with a transparent sky. Only the reef differs: its text columns sit on the light card, so its
 * water fades out under them.
 */
const NIGHT_ON_LIGHT: HarbourPalette = { ...NIGHT, reefTextFade: true };

/** Which palette an ink takes: the light ink (`light`; `day` on older builds) → night on the dusk sky. */
export function harbourInk(ink: string | null | undefined): HarbourPalette {
  return ink === "light" || ink === "day" ? NIGHT_ON_LIGHT : NIGHT;
}

export function harbourPalette(el: Element | null = typeof document !== "undefined" ? document.documentElement : null): HarbourPalette {
  return harbourInk((el as HTMLElement | null)?.dataset?.ink ?? null);
}

export const HARBOUR_PALETTES = { night: NIGHT, nightOnLight: NIGHT_ON_LIGHT } as const;
