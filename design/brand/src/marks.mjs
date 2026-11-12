// ErgoScan brand marks — three directions. Hand-written SVG, flat fills, no gradients.
// Each mark has a 16-grid drawing (pixel-snapped for 16/32/48 px) and a 48-grid
// drawing for app icons and large use. Colours are the «Сигнал» entity colours.

export const C = {
  page: "#0e0e0e",
  tile: "#1a1a1a",
  line: "#2a2a2a",
  text: "#ffffff",
  t2: "#c6c6c6",
  t3: "#a3a3a3",
  block: "#ffd23c",
  tx: "#ff6a2b",
  addr: "#ff7ab8",
  token: "#5b8dff",
  box: "#2fd27f",
  down: "#ff5468",
};

const svg = (vb, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" fill="none">${body}</svg>`;

// 5-cell staircase on a 3x3 grid: block → tx → address → token → box
const stairs = (p, w) => {
  const cell = (cx, cy, f) => `<rect x="${p[cx]}" y="${p[cy]}" width="${w}" height="${w}" fill="${f}"/>`;
  return cell(0, 2, C.block) + cell(1, 2, C.tx) + cell(1, 1, C.addr) + cell(2, 1, C.token) + cell(2, 0, C.box);
};

// ink = colour of the neutral parts (white on dark, near-black on light)
export const MARKS = {
  // A «Рамка» — the scan frame locks on one block. Evolves today's [ ] corners.
  a: {
    name: "Рамка",
    s16: (ink = C.text) =>
      svg(16, `<path fill="${ink}" d="M1 1h5v2H3v3H1zM15 1h-5v2h3v3h2zM1 15h5v-2H3v-3H1zM15 15h-5v-2h3v-3h2z"/><rect x="5" y="5" width="6" height="6" fill="${C.block}"/>`),
    s48: (ink = C.text) =>
      svg(48, `<path fill="${ink}" d="M4 4h13v4H8v9H4zM44 4H31v4h9v9h4zM4 44h13v-4H8v-9H4zM44 44H31v-4h9v-9h4z"/><rect x="16" y="16" width="16" height="16" fill="${C.block}"/>`),
  },

  // B «Трата» — a spent box (outline) and the box the transaction creates (solid, in front).
  b: {
    name: "Трата",
    s16: (ink = C.text, acc = C.tx) =>
      svg(16, `<path fill="${ink}" fill-rule="evenodd" d="M1 1h9v9H1zM3 3v5h5V3z"/><rect x="7" y="7" width="8" height="8" fill="${acc}"/>`),
    s48: (ink = C.text, acc = C.tx) =>
      svg(48, `<path fill="${ink}" fill-rule="evenodd" d="M4 4h26v26H4zM9 9v16h16V9z"/><rect x="20" y="20" width="24" height="24" fill="${acc}"/>`),
  },

  // C «Ступени» — five entity cells climb from block to box: the site's colour key as the mark.
  c: {
    name: "Ступени",
    s16: () => svg(16, stairs([1, 6, 11], 5)),
    s48: () => svg(48, stairs([4, 17, 30], 13)),
  },
};

// Variants tried and dropped (kept for the record; shown on sheets/compare.html)
export const EXPLORED = {
  vyemka: { name: "Выемка (читается как человечек)", s16: (ink = C.text) => svg(16, `<rect x="1" y="8" width="4" height="5" fill="${ink}"/><rect x="6" y="3" width="4" height="5" fill="${C.block}"/><rect x="11" y="8" width="4" height="5" fill="${ink}"/>`) },
  kartoteka: { name: "Картотека (похоже на «выравнивание»)", s16: (ink = C.text) => svg(16, `<rect x="1" y="1" width="11" height="4" fill="${ink}"/><rect x="4" y="6" width="11" height="4" fill="${C.block}"/><rect x="1" y="11" width="11" height="4" fill="${ink}"/>`) },
  stupeniGap: { name: "Ступени с зазором (рассыпаются на 16 px)", s16: () => svg(16, stairs([0, 6, 12], 4)) },
};
