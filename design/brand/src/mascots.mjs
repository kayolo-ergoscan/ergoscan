// Mascot proposals that replace the old robot drawing. Flat shapes on a 64 grid, no robot parts,
// no binocular eyes, no treads. Eyes are vertical bars (the blinking text cursor of the search box).
const INK = "#0e0e0e";
const svg = (body, vb = "0 0 64 64") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none">${body}</svg>`;

// M1 «Ящик» — a crate with a lid; the lid is its hat, its mouth, its tool.
const crate = {
  idle: (c = "#2fd27f") =>
    svg(`<rect x="12" y="18" width="40" height="8" fill="${c}"/><rect x="15" y="28" width="34" height="26" fill="${c}"/>` +
      `<rect x="24" y="34" width="4" height="10" fill="${INK}"/><rect x="36" y="34" width="4" height="10" fill="${INK}"/>` +
      `<rect x="19" y="54" width="6" height="4" fill="${c}"/><rect x="39" y="54" width="6" height="4" fill="${c}"/>`),
  carry: (c = "#2fd27f", load = "#ffd23c") =>
    svg(`<rect x="21" y="3" width="22" height="15" fill="${load}"/><rect x="12" y="18" width="40" height="8" fill="${c}"/><rect x="15" y="28" width="34" height="26" fill="${c}"/>` +
      `<rect x="24" y="31" width="4" height="8" fill="${INK}"/><rect x="36" y="31" width="4" height="8" fill="${INK}"/>` +
      `<rect x="19" y="54" width="6" height="4" fill="${c}"/><rect x="39" y="54" width="6" height="4" fill="${c}"/>`),
  peek: (c = "#2fd27f") =>
    svg(`<g transform="rotate(-24 12 26)"><rect x="12" y="18" width="40" height="8" fill="${c}"/></g><rect x="15" y="28" width="34" height="26" fill="${c}"/>` +
      `<rect x="15" y="28" width="34" height="9" fill="#145c37"/>` +
      `<rect x="31" y="30" width="4" height="5" fill="#fff"/><rect x="40" y="30" width="4" height="5" fill="#fff"/>` +
      `<rect x="19" y="54" width="6" height="4" fill="${c}"/><rect x="39" y="54" width="6" height="4" fill="${c}"/>`),
  sleep: (c = "#2fd27f") =>
    svg(`<rect x="12" y="20" width="40" height="8" fill="${c}"/><rect x="15" y="30" width="34" height="24" fill="${c}"/>` +
      `<rect x="23" y="40" width="7" height="3" fill="${INK}"/><rect x="34" y="40" width="7" height="3" fill="${INK}"/>` +
      `<rect x="19" y="54" width="6" height="4" fill="${c}"/><rect x="39" y="54" width="6" height="4" fill="${c}"/>` +
      `<path d="M50 6h7l-7 8h7" stroke="#a3a3a3" stroke-width="2.4"/>`),
  hop: (c = "#2fd27f") =>
    svg(`<rect x="12" y="4" width="40" height="8" fill="${c}"/><rect x="15" y="20" width="34" height="26" fill="${c}"/>` +
      `<rect x="28" y="22" width="8" height="8" fill="#ff6a2b"/>` +
      `<rect x="24" y="32" width="4" height="9" fill="${INK}"/><rect x="36" y="32" width="4" height="9" fill="${INK}"/>` +
      `<rect x="21" y="46" width="6" height="3" fill="${c}"/><rect x="37" y="46" width="6" height="3" fill="${c}"/>`),
};

// M2 «Пиксель» — the solid square of the B mark, alive. Takes the colour of the page it is on.
const pixel = {
  idle: (c = "#ff6a2b") =>
    svg(`<rect x="20" y="28" width="24" height="24" fill="${c}"/><rect x="26" y="34" width="3" height="7" fill="${INK}"/><rect x="35" y="34" width="3" height="7" fill="${INK}"/>`),
  look: (c = "#ff6a2b") =>
    svg(`<rect x="20" y="28" width="24" height="24" fill="${c}"/><rect x="30" y="33" width="3" height="7" fill="${INK}"/><rect x="39" y="33" width="3" height="7" fill="${INK}"/>`),
  squash: (c = "#ff6a2b") =>
    svg(`<rect x="15" y="36" width="34" height="16" fill="${c}"/><rect x="25" y="40" width="3" height="4" fill="${INK}"/><rect x="36" y="40" width="3" height="4" fill="${INK}"/>`),
  stretch: (c = "#ff6a2b") =>
    svg(`<rect x="23" y="8" width="18" height="30" fill="${c}"/><rect x="27" y="13" width="3" height="8" fill="${INK}"/><rect x="34" y="13" width="3" height="8" fill="${INK}"/>`),
  blink: (c = "#ff6a2b") =>
    svg(`<rect x="20" y="28" width="24" height="24" fill="${c}"/><rect x="25" y="38" width="5" height="2" fill="${INK}"/><rect x="34" y="38" width="5" height="2" fill="${INK}"/>`),
};

export const MASCOTS = {
  crate: Object.fromEntries(Object.entries(crate).map(([k, f]) => [k, f()])),
  pixel: Object.fromEntries(Object.entries(pixel).map(([k, f]) => [k, f()])),
  pixelColors: Object.fromEntries(
    Object.entries({ block: "#ffd23c", tx: "#ff6a2b", addr: "#ff7ab8", token: "#5b8dff", box: "#2fd27f" }).map(([k, c]) => [k, { idle: pixel.idle(c), squash: pixel.squash(c), stretch: pixel.stretch(c), look: pixel.look(c) }])
  ),
  files: {
    ...Object.fromEntries(Object.entries(crate).map(([k, f]) => [`m1-yashchik-${k}`, f()])),
    ...Object.fromEntries(Object.entries(pixel).map(([k, f]) => [`m2-piksel-${k}`, f()])),
  },
};
