import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { FAMILY } from "./look";
import {
  INK_BG,
  INK_BOOT,
  INK_CHOICES,
  colorSchemeFor,
  isInkChoice,
  isLightInk,
  parseInkChoice,
  parseSkinInk,
} from "./skin-ink";

test("two inks: dark is the default, «Сумерки» is light", () => {
  assert.equal(parseSkinInk("oled"), "oled");
  assert.equal(parseSkinInk("light"), "light");
  assert.equal(parseSkinInk(null), "oled");
  assert.equal(parseSkinInk("day"), "oled");
  assert.equal(parseSkinInk("light-c"), "oled");
  assert.equal(isLightInk("light"), true);
  assert.equal(isLightInk("oled"), false);
  assert.equal(colorSchemeFor("light"), "light");
  assert.equal(colorSchemeFor("oled"), "dark");
});

test("the choice: dark, light or the system; old stored inks read as dark", () => {
  assert.deepEqual([...INK_CHOICES], ["oled", "light", "system"]);
  assert.equal(parseInkChoice("system"), "system");
  assert.equal(parseInkChoice("light"), "light");
  assert.equal(parseInkChoice("oled"), "oled");
  assert.equal(parseInkChoice("day"), "oled");
  assert.equal(parseInkChoice("dim"), "oled");
  assert.equal(parseInkChoice(undefined), "oled");
});

test("a `?ink=` is kept only when the site knows it", () => {
  for (const v of ["oled", "light", "system"]) assert.equal(isInkChoice(v), true);
  for (const v of ["day", "dim", "", null, undefined, "LIGHT"]) assert.equal(isInkChoice(v), false);
});

/** Run the head script against a stub document: what it paints and what it stores. */
function boot(o: { search?: string; stored?: string | null; storage?: "ok" | "throws"; osLight?: boolean }) {
  const attrs = new Map<string, string>();
  const classes = new Set<string>(["dark"]);
  const style: Record<string, string> = {};
  const metas = [
    { name: "theme-color", content: "#0e0e0e" },
    { name: "theme-color", content: "#0e0e0e" },
    { name: "color-scheme", content: "dark" },
    { name: "color-scheme", content: "dark" },
  ];
  const store = new Map<string, string>(o.stored == null ? [] : [["ergoscan.ink", o.stored]]);
  const writes: string[] = [];
  const throws = o.storage === "throws";
  const localStorage = {
    getItem(k: string) {
      if (throws) throw new Error("SecurityError");
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (throws) throw new Error("SecurityError");
      writes.push(v);
      store.set(k, v);
    },
  };
  const document = {
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
      style,
    },
    querySelectorAll(sel: string) {
      const name = /name="([^"]+)"/.exec(sel)?.[1];
      return metas
        .filter((m) => m.name === name)
        .map((m) => ({ setAttribute: (_k: string, v: string) => void (m.content = v) }));
    },
    addEventListener() {},
  };
  runInNewContext(INK_BOOT, {
    document,
    localStorage,
    location: { search: o.search ?? "" },
    URLSearchParams,
    matchMedia: () => ({ matches: Boolean(o.osLight) }),
  });
  return {
    ink: attrs.get("data-ink"),
    dark: classes.has("dark"),
    scheme: style.colorScheme,
    metas: metas.map((m) => `${m.name}=${m.content}`),
    stored: store.get("ergoscan.ink") ?? null,
    writes,
  };
}

test("boot script: paints the stored choice, a known `?ink=` wins and is kept", () => {
  assert.equal(boot({}).ink, "oled");
  assert.equal(boot({ stored: "light" }).ink, "light");
  assert.equal(boot({ stored: "system", osLight: true }).ink, "light");
  assert.equal(boot({ stored: "system", osLight: false }).ink, "oled");
  const linked = boot({ search: "?ink=light", stored: "oled" });
  assert.equal(linked.ink, "light");
  assert.equal(linked.stored, "light");
  assert.equal(linked.dark, false);
  assert.equal(linked.scheme, "light");
});

test("boot script: every theme-color and color-scheme meta follows the ink", () => {
  const light = boot({ stored: "light" });
  assert.deepEqual(light.metas, [
    `theme-color=${INK_BG.light}`,
    `theme-color=${INK_BG.light}`,
    "color-scheme=light",
    "color-scheme=light",
  ]);
  assert.deepEqual(boot({}).metas, [`theme-color=${INK_BG.oled}`, `theme-color=${INK_BG.oled}`, "color-scheme=dark", "color-scheme=dark"]);
});

test("boot script: a storage that throws still gets the linked ink painted", () => {
  const r = boot({ search: "?ink=light", storage: "throws" });
  assert.equal(r.ink, "light");
  assert.equal(r.scheme, "light");
  assert.equal(boot({ storage: "throws" }).ink, "oled");
});

test("boot script: an unknown `?ink=` paints dark and leaves the saved choice alone", () => {
  for (const stored of ["light", "system", null]) {
    const r = boot({ search: "?ink=day", stored, osLight: true });
    assert.equal(r.ink, "oled");
    assert.equal(r.stored, stored);
    assert.deepEqual(r.writes, []);
  }
});

test("boot script paints both grounds and follows the system", () => {
  assert.equal(INK_BG.oled, "#0e0e0e");
  assert.match(INK_BOOT, /data-ink/);
  assert.match(INK_BOOT, /ergoscan\.ink/);
  assert.match(INK_BOOT, /prefers-color-scheme: light/);
  assert.ok(INK_BOOT.includes(INK_BG.oled));
  assert.ok(INK_BOOT.includes(INK_BG.light));
  assert.match(INK_BOOT, /theme-color/);
  assert.match(INK_BOOT, /color-scheme/);
});

/* ───────────── contrast: every token pair of both inks holds WCAG AA ───────────── */

type Rgba = [number, number, number, number];
type Tokens = Map<string, string>;

const css = (f: string) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");

/** Custom properties of every top-level rule whose selector is exactly `selector`. */
function block(src: string, selector: string): Tokens {
  const out: Tokens = new Map();
  let at = -1;
  while ((at = src.indexOf(`\n${selector} {`, at + 1)) >= 0) {
    const body = src.slice(src.indexOf("{", at) + 1, src.indexOf("\n}", at));
    const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  assert.ok(out.size > 0, `no rule ${selector}`);
  return out;
}

/**
 * Declarations of the rule whose selector is exactly `selector`, at any depth (a rule inside
 * @media counts). Empty when the sheet has no such rule.
 */
function rule(src: string, selector: string): Tokens {
  const out: Tokens = new Map();
  const at = new RegExp(`(^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`).exec(src);
  if (!at) return out;
  const open = src.indexOf("{", at.index + at[0].length - 1);
  const body = src.slice(open + 1, src.indexOf("}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  return out;
}

const globals = css("globals.css");
const looks = css("looks.css");
const light = css("light.css");
const feed = css("feed.css");
const tip = css("tip.css");
const phone = css("detail-phone.css");
/** A rule of the light ink in light.css. */
const LIGHT_AT = 'html[data-look="c"][data-ink="light"]';
const BASE: Tokens = new Map([...block(globals, ":root"), ...block(globals, ':root,\nhtml[data-ink="oled"]')]);
const DARK: Tokens = new Map([...BASE, ...block(looks, 'html[data-look="c"][data-ink]')]);
const LIGHT: Tokens = new Map([...DARK, ...block(light, 'html[data-look="c"][data-ink="light"]')]);
const DUSK: Tokens = new Map([...LIGHT, ...block(light, 'html[data-look="c"][data-ink="light"] canvas[data-scene]')]);

/** Split on top-level commas. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The inside of the call that opens at `open` (the index of its "("). */
function inner(s: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")" && --depth === 0) return { body: s.slice(open + 1, i), end: i + 1 };
  }
  throw new Error(`unbalanced: ${s}`);
}

function substitute(expr: string, t: Tokens, seen = 0): string {
  assert.ok(seen < 12, `var() loop in ${expr}`);
  const at = expr.indexOf("var(");
  if (at < 0) return expr;
  const { body, end } = inner(expr, at + 3);
  const [name, ...fb] = args(body);
  const value = t.get(name) ?? (fb.length ? fb.join(", ") : undefined);
  assert.ok(value !== undefined, `undefined token ${name}`);
  return substitute(expr.slice(0, at) + substitute(value, t, seen + 1) + expr.slice(end), t, seen + 1);
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: Rgba): [number, number, number] {
  const [R, G, B] = [r, g, b].map((v) => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number], alpha: number): Rgba {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(gam(Math.min(1, Math.max(0, v))) * 255));
  return [rgb[0], rgb[1], rgb[2], alpha];
}

function parse(raw: string): Rgba {
  const s = raw.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = /^(rgba?|color-mix)\(/.exec(s);
  assert.ok(fn, `not a colour: ${raw}`);
  const body = inner(s, fn[1].length).body;
  if (fn[1] !== "color-mix") {
    const n = body.split(/[\s,/]+/).filter(Boolean).map(Number);
    return [n[0], n[1], n[2], n[3] ?? 1];
  }
  const [space, a, b] = args(body);
  const part = (p: string): [Rgba, number | null] => {
    const m = /^(.*?)\s+([\d.]+)%$/.exec(p);
    return m ? [parse(m[1]), Number(m[2]) / 100] : [parse(p), null];
  };
  const [ca, pa] = part(a);
  const [cb, pb] = part(b);
  const p = pa ?? (pb == null ? 0.5 : 1 - pb);
  const alpha = ca[3] * p + cb[3] * (1 - p);
  if (space === "in oklab") {
    const [la, lb] = [toOklab(ca), toOklab(cb)];
    return fromOklab([0, 1, 2].map((i) => la[i] * p + lb[i] * (1 - p)) as [number, number, number], alpha);
  }
  assert.equal(space, "in srgb", `colour space ${space}`);
  if (alpha === 0) return [0, 0, 0, 0];
  const ch = (i: number) => (ca[i] * ca[3] * p + cb[i] * cb[3] * (1 - p)) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as Rgba;
}

const lum = (c: Rgba) => {
  const [r, g, b] = c.slice(0, 3).map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast of `fg` on `bg` (both CSS expressions), each laid over `ground` when see-through. */
function ratio(t: Tokens, fg: string, bg: string, ground = "var(--module)"): number {
  const base = parse(substitute(ground, t));
  const b = over(parse(substitute(bg, t)), base);
  const f = over(parse(substitute(fg, t)), b);
  const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const v = (n: string) => `var(--${n})`;
const ENT = ["block", "tx", "addr", "token", "box", "net"];
const INKS = ["cyan", "green", "gold", "coral", "sky", "violet", "teal", "gix"];
const KINDS = ["transfer", "token", "nft", "defi", "oracle", "bridge", "reward", "rent", "box", "contract", "mixer"];
const CARDS = ["module", "bg", "bg-elevated", "row-hover", "row-open", "detail-bg"];
const TEXT = 4.5;
const MARK = 3;

type Pair = [fg: string, bg: string, min: number, ground?: string];
type Ink = "dark" | "light";

/** `expr` printed at `opacity` (an opacity on the element is an alpha on its ink). */
const faded = (expr: string, opacity: string | number) =>
  Number(opacity) >= 1 ? expr : `color-mix(in srgb, ${expr} ${Math.round(Number(opacity) * 1000) / 10}%, transparent)`;

/** A property of `selector` as the page has it on `theme`: the light.css rule wins on the light ink. */
function prop(theme: Ink, base: string, selector: string, name: string, lightSelector?: string): string | undefined {
  const own = theme === "light" ? rule(light, lightSelector ?? `${LIGHT_AT} ${selector}`).get(name) : undefined;
  return own ?? rule(base, selector).get(name);
}

/** Every foreground the pages print on every ground it sits on. */
function pairs(theme: Ink): Pair[] {
  const out: Pair[] = [];
  for (const card of CARDS) {
    for (const ink of ["text", "muted", "muted-2", "link", "up", "down", "warning", "accent", "soft"]) out.push([v(ink), v(card), TEXT]);
    for (const e of ENT) out.push([v(`c-${e}-text`), v(card), TEXT], [v(`c-${e}`), v(card), MARK]);
  }
  for (const chip of ["chip-bg", "chip-hover", "tag"]) out.push([v("text"), v(chip), TEXT], [v("muted"), v(chip), TEXT]);
  out.push([v("tag-ink"), v("tag"), TEXT], [v("invert-fg"), v("invert"), TEXT], [v("plate-now-ink"), v("plate-now"), TEXT]);
  // Page tags: a tint of the page's entity under its text tier; home tiles: the fill under the tile ink.
  for (const e of ENT) {
    out.push([v(`c-${e}-text`), `color-mix(in srgb, var(--f-${e}) var(--tint), var(--module))`, TEXT]);
    out.push([v("k-ink"), v(`f-${e}`), TEXT]);
    out.push([v(`c-${e}`), `color-mix(in srgb, var(--c-${e}) 16%, transparent)`, MARK]);
  }
  for (const k of KINDS) {
    out.push([v("k-ink"), v(`k-${k}`), TEXT]);
    for (const card of ["module", "row-hover", "row-open"])
      out.push([`color-mix(in oklab, var(--k-${k}) var(--kind-mix), var(--text))`, v(card), TEXT]);
  }
  out.push([v("k-quiet-ink"), v("k-quiet"), TEXT], [v("k-ink"), v("selection"), TEXT]);
  for (const k of ["nft", "rent", "reward"]) for (const card of CARDS) out.push([v(`k-${k}-text`), v(card), TEXT]);
  for (const ink of INKS) {
    out.push([v(`ink-${ink}-text`), v("module"), TEXT], [v(`ink-${ink}-text`), v("row-hover"), TEXT]);
    out.push([v(`ink-${ink}`), v("module"), MARK], [v(`ink-${ink}`), v("row-hover"), MARK]);
  }
  for (const k of ["protocol", "exchange", "pool", "contract"]) out.push([v(`kind-${k}`), v("module"), MARK]);
  for (const k of ["chain", "decoded", "telemetry", "live", "heuristic", "external"]) out.push([v(`ev-${k}`), v("module"), MARK]);
  for (const k of ["heart", "mint", "party", "econ-round", "econ-finder", "econ-founders", "brand-new", "bar-rest"])
    out.push([v(k), v("module"), MARK]);
  for (const e of ["block", "tx", "addr", "token", "box", "down"]) out.push([v(`ent-${e}`), v("module"), MARK]);
  // Words on a wash.
  out.push(
    [v("ink-teal-text"), "color-mix(in srgb, var(--api-get) 16%, transparent)", TEXT],
    [v("ink-gold-text"), "color-mix(in srgb, var(--api-post) 16%, transparent)", TEXT],
    [v("lithos-chip-ink"), "color-mix(in srgb, var(--lithos-chip) 24%, transparent)", TEXT],
    [v("lithos-chip-hover"), "color-mix(in srgb, var(--lithos-chip) 36%, transparent)", TEXT],
    [v("twin-ink"), v("twin-bg"), TEXT],
    [v("twin-ink"), v("twin-bg"), TEXT, v("row-hover")],
    [v("ink-gix-text"), v("gix-wash"), TEXT],
    [v("ink-gix-text"), v("gix-wash-hover"), TEXT],
    [v("tag-ink"), "color-mix(in srgb, var(--k-nft) 16%, transparent)", TEXT],
    [v("text"), v("wash-strong"), TEXT],
    [v("muted"), v("wash-mid"), TEXT],
    [v("accent"), v("accent-soft"), TEXT],
  );
  out.push(...pagePairs(theme));
  return out;
}

/**
 * What the pages do with the tokens, read off their rules: a word dimmed by opacity, a mark printed
 * as words, a pressed tile over the page ground, a tip chip on whatever ink its caller passes, a gain
 * on its own wash. The old rules (opacity on the light card, marks as words, a wash on the page
 * ground, the tile ink on a light mark) fail here.
 */
function pagePairs(theme: Ink): Pair[] {
  const out: Pair[] = [];
  const grounds = ["module", "row-hover", "row-open"];
  const dim = `${LIGHT_AT} :is(.word-dim, .feed-unit)`;
  // Dimmed words: the feed's units (feed.css) and `word-dim` spans (opacity-70/80/90 in the TSX).
  const words: [string, string | undefined, string | undefined, string[]][] = [
    [".feed-unit", prop(theme, feed, ".feed-unit", "opacity", dim), prop(theme, feed, ".feed-unit", "color", dim), ["text", "up", "down", "muted"]],
    ...[0.7, 0.8, 0.9].map((op): [string, string | undefined, string | undefined, string[]] => [
      `.word-dim ${op}`,
      prop(theme, "", ".word-dim", "opacity", dim) ?? String(op),
      prop(theme, "", ".word-dim", "color", dim),
      ["text", "up", "down", "c-block-text", "c-net-text", "ink-gold-text"],
    ]),
  ];
  for (const [, opacity, color, parents] of words)
    for (const parent of parents)
      for (const card of grounds) {
        const fg = (color ?? "currentColor").replace(/currentColor/gi, v(parent));
        out.push([faded(fg, opacity ?? 1), v(card), TEXT]);
      }
  // The count on the chosen phone tab (the inverse plate), dimmed.
  const tab = ".detail-tab.seg-on .detail-tab-n";
  const tabFg = (prop(theme, phone, tab, "color") ?? "inherit").replace(/inherit|currentColor/gi, v("invert-fg"));
  out.push([faded(tabFg, prop(theme, phone, tab, "opacity") ?? 1), v("invert"), TEXT, v("invert")]);
  // A mark as words: a block's header facts (on their tint) and stat rows.
  for (const tone of ["violet", "sky", "gold", "teal"]) {
    const fg = rule(globals, `.hdr-fact.is-${tone} dt`).get("color");
    const bg = rule(globals, `.hdr-fact.is-${tone}`).get("background");
    assert.ok(fg && bg, `.hdr-fact.is-${tone}`);
    out.push([fg, bg, TEXT]);
  }
  for (const tone of ["violet", "sky", "cyan", "teal", "green", "gold", "coral"]) {
    const fg = rule(globals, `.hdr-row.is-${tone} .hdr-k`).get("color");
    assert.ok(fg, `.hdr-row.is-${tone}`);
    for (const card of ["module", "row-hover"]) out.push([fg, v(card), TEXT]);
  }
  // A press-tile, pressed or hovered: its fill is replaced, so it lies on the page ground.
  const pressed = rule(globals, ".kpi-tile--press.is-pressed").get("background-color");
  const hovered = rule(globals, ".kpi-tile--press:hover:not(.is-pressed):not(:active):not(.is-armed)").get("background-color");
  assert.ok(pressed && hovered, "press-tile rules");
  for (const bg of [pressed, hovered])
    for (const word of ["text", "muted", "muted-2", "tile-label", "k-nft-text", "k-rent-text", ...ENT.map((e) => `c-${e}-text`)])
      out.push([v(word), bg, TEXT, v("bg")]);
  // A box's life nodes lie on the page ground.
  const node = rule(globals, ".box-life-node").get("background");
  assert.ok(node, ".box-life-node");
  for (const word of ["text", "muted", "muted-2", "accent", ...ENT.map((e) => `c-${e}-text`)]) out.push([v(word), node, TEXT, v("bg")]);
  // Numbered steps: the ink's text tier on a wash of its mark (oracle buyback).
  for (const i of INKS) out.push([v(`ink-${i}-text`), `color-mix(in srgb, var(--ink-${i}) 14%, transparent)`, TEXT]);
  // Tip chips: every ink a caller passes (entity marks, fills, --up, canvas families of lookInk).
  const chipBg = prop(theme, tip, ".tip-chip.is-ink", "background");
  const chipFg = prop(theme, tip, ".tip-chip.is-ink", "color");
  assert.ok(chipBg && chipFg, ".tip-chip.is-ink");
  const callers = [
    ...ENT.map((e) => v(`c-${e}`)),
    ...["up", "down", "warning", "brand-new", "k-rent", "k-nft", "accent"].map(v),
    ...INKS.map((i) => v(`ink-${i}`)),
    ...(theme === "light" ? Object.keys(FAMILY).map((f) => v(`lk-${f}`)) : Object.values(FAMILY)),
  ];
  for (const c of callers) out.push([chipFg.replace(/var\(--tip-ink\)/g, c), chipBg.replace(/var\(--tip-ink\)/g, c), TEXT, v("chip-bg")]);
  // Gains, losses and a box's «out» on their own wash (a price chip, the holders month, box io).
  for (const card of ["module", "row-hover"])
    for (const [fg, rgb] of [["up", "up-rgb"], ["down", "down-rgb"]]) {
      out.push([v(fg), `rgb(var(--${rgb}) / 0.15)`, TEXT, v(card)]);
      out.push([v(fg), `rgb(var(--${rgb}) / 0.16)`, TEXT, v(card)]);
    }
  for (const io of ["in", "out"]) {
    const r = rule(globals, `.box-io.is-${io}`);
    assert.ok(r.get("color") && r.get("background"), `.box-io.is-${io}`);
    out.push([r.get("color")!, r.get("background")!, TEXT]);
  }
  return out;
}

function failures(t: Tokens, list: Pair[]): string[] {
  return list
    .map(([fg, bg, min, ground]) => ({ fg, bg, min, r: ratio(t, fg, bg, ground) }))
    .filter((p) => p.r < p.min)
    .map((p) => `${p.fg} on ${p.bg}: ${p.r.toFixed(2)} < ${p.min}`);
}

test("«Сумерки»: every pair holds AA (text 4.5:1, marks 3:1)", () => {
  assert.deepEqual(failures(LIGHT, pairs("light")), []);
});

test("«Сумерки»: hollow tiles keep their ring and glyph", () => {
  const list: Pair[] = [];
  for (const k of KINDS)
    for (const p of [40, 50]) list.push([`color-mix(in oklab, var(--k-${k}) ${p}%, var(--text))`, v("module"), MARK]);
  assert.deepEqual(failures(LIGHT, list), []);
});

/**
 * Dark stays prod's pixels: a loss dimmed by opacity sits a hair under AA on these grounds (the
 * feed's unit on a hovered or open row, a tx/address amount's «ERG»), and so does the dimmed count
 * on the chosen phone tab. Known, not the light theme's; any other dark miss fails.
 */
const DARK_KNOWN = [
  "color-mix(in srgb, var(--invert-fg) 55%, transparent) on var(--invert): 4.27 < 4.5",
  "color-mix(in srgb, var(--down) 72%, transparent) on var(--row-hover): 4.43 < 4.5",
  "color-mix(in srgb, var(--down) 72%, transparent) on var(--row-open): 4.39 < 4.5",
  "color-mix(in srgb, var(--down) 70%, transparent) on var(--module): 4.41 < 4.5",
  "color-mix(in srgb, var(--down) 70%, transparent) on var(--row-hover): 4.26 < 4.5",
  "color-mix(in srgb, var(--down) 70%, transparent) on var(--row-open): 4.23 < 4.5",
];

test("dark ink: every pair holds AA", () => {
  assert.deepEqual(failures(DARK, pairs("dark")).filter((f) => !DARK_KNOWN.includes(f)), []);
});

test("dusk scenes: the night inks read on every stop of the sky", () => {
  const sky = /canvas\[data-scene\] \{[^}]*linear-gradient\(([^;]+)\);/.exec(light);
  assert.ok(sky, "no dusk sky");
  const stops = [...sky[1].matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
  assert.ok(stops.length >= 3);
  const list: Pair[] = [];
  for (const stop of stops) {
    for (const ink of ["text", "muted", "muted-2"]) list.push([v(ink), stop, TEXT]);
    for (const ink of ["c-block", "k-nft", "k-rent", "up", "brand-new", "ent-box"]) list.push([v(ink), stop, MARK]);
  }
  assert.deepEqual(failures(DUSK, list), []);
});

/** Every .tsx under src (the pages' own class strings). */
function sources(dir = new URL("..", import.meta.url).pathname, out: [string, string][] = []): [string, string][] {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) sources(f, out);
    else if (f.endsWith(".tsx")) out.push([f.slice(f.indexOf("/src/") + 5), readFileSync(f, "utf8")]);
  }
  return out;
}

test("pages hook their dimmed words and print no mark as words", () => {
  // States, not words: a pending list, a disabled step.
  const states = new Set(["app/status/status-view.tsx", "components/CommandPalette.tsx", "components/HopNav.tsx"]);
  const bare: string[] = [];
  const marks: string[] = [];
  for (const [file, src] of sources()) {
    for (const m of src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
      const cls = m[1] ?? m[2] ?? "";
      // An opacity on a word drops it under AA on the light card: `word-dim` lets light.css swap it for a solid ink.
      if (/(^|\s)opacity-[1-9]0(\s|$)/.test(cls) && !/(^|\s)word-dim(\s|$)/.test(cls) && !states.has(file)) bare.push(`${file}: ${cls}`);
      // A mark as a text colour: words take the -word (or -text) tier.
      if (/(^|\s)text-\[var\(--c-(block|tx|addr|token|box|net)[,)]/.test(cls)) marks.push(`${file}: ${cls}`);
    }
  }
  assert.deepEqual(bare, []);
  assert.deepEqual(marks, []);
});

test("light ink answers every colour token the dark look sets", () => {
  const own = block(light, 'html[data-look="c"][data-ink="light"]');
  // A literal colour; a value built only from other tokens follows them.
  const colour = /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i;
  const missing = [...DARK]
    .filter(([name, value]) => colour.test(value) && !own.has(name))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
});
