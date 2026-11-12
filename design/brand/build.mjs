// Writes the SVG deliverables and sheets/assets.js from src/*.mjs.
// node design/brand/build.mjs
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { C, MARKS, EXPLORED } from "./src/marks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = (p, s) => {
  const f = join(here, p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, s.endsWith("\n") ? s : s + "\n");
};

const DARK_INK = C.text;
const LIGHT_INK = C.page;

const assets = { C, marks: {}, icons: {}, mascots: {} };

for (const [k, m] of Object.entries(MARKS)) {
  assets.marks[k] = {
    name: m.name,
    s16: { dark: m.s16(DARK_INK), light: m.s16(LIGHT_INK) },
    s48: { dark: m.s48(DARK_INK), light: m.s48(LIGHT_INK) },
  };
}
// colour options for B (the solid box)
assets.bColors = {};
for (const [n, col] of Object.entries({ tx: C.tx, block: C.block, box: C.box })) {
  assets.bColors[n] = { s16: MARKS.b.s16(DARK_INK, col), s48: MARKS.b.s48(DARK_INK, col) };
}
assets.explored = Object.fromEntries(Object.entries(EXPLORED).map(([k, m]) => [k, { name: m.name, s16: m.s16(DARK_INK) }]));

let ICONS = null;
if (existsSync(join(here, "src/icons.mjs"))) ({ ICONS } = await import("./src/icons.mjs"));
if (ICONS) assets.icons = ICONS;

let MASCOTS = null;
if (existsSync(join(here, "src/mascots.mjs"))) ({ MASCOTS } = await import("./src/mascots.mjs"));
if (MASCOTS) assets.mascots = MASCOTS;

// --- files -----------------------------------------------------------------
const dirs = { a: "logo/a-ramka", b: "logo/b-trata", c: "logo/c-stupeni" };
for (const [k, d] of Object.entries(dirs)) {
  const m = MARKS[k];
  out(`${d}/mark-16-dark.svg`, m.s16(DARK_INK));
  out(`${d}/mark-16-light.svg`, m.s16(LIGHT_INK));
  out(`${d}/mark-48-dark.svg`, m.s48(DARK_INK));
  out(`${d}/mark-48-light.svg`, m.s48(LIGHT_INK));
  // favicon.svg follows the browser theme
  // presentation attributes do not take var(); the neutral parts get a class instead
  const inner16 = m.s16("INK").replace(/fill="INK"/g, 'class="ink"').replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  out(
    `${d}/favicon.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><style>.ink{fill:${LIGHT_INK}}@media (prefers-color-scheme: dark){.ink{fill:${DARK_INK}}}</style>${inner16}</svg>`
  );
  // app icon: mark on the page-black tile, 512 grid, 20% inset
  const inner48 = m.s48(DARK_INK).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  out(
    `${d}/app-icon.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><rect width="512" height="512" fill="${C.page}"/><g transform="translate(96 96) scale(6.6667)">${inner48}</g></svg>`
  );
}

if (ICONS) {
  for (const ic of ICONS.list) {
    out(`icons/${ic.id}.svg`, ICONS.render(ic, { line: "currentColor", acc: "currentColor" }));
    out(`icons/color/${ic.id}.svg`, ICONS.render(ic, { line: C.t2, acc: ICONS.accColor(ic) }));
  }
}

if (MASCOTS) {
  for (const [k, v] of Object.entries(MASCOTS.files)) out(`mascot/${k}.svg`, v);
}

// sheets read window.BRAND
const ser = JSON.stringify(
  assets,
  (key, val) => (typeof val === "function" ? undefined : val)
);
let js = `window.BRAND=${ser};\n`;
if (ICONS) js += `window.BRAND.renderIcon=${ICONS.render.toString()};\nwindow.BRAND.accColor=${ICONS.accColor.toString()};\n`;
out("sheets/assets.js", js);
console.log("ok", Object.keys(assets.marks).join(","), ICONS ? ICONS.list.length + " icons" : "", MASCOTS ? "mascots" : "");
