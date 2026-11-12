// ErgoScan icon set — 24 grid, one 2 px stroke, miter joins, butt caps.
// Rule: every glyph is line work plus (at most) one solid square «unit» — the eUTXO box.
// The unit carries the entity colour; the line stays neutral (#c6c6c6 in the nav).
//   l = stroked line work, u = solid unit in the accent colour, f = solid parts in line colour

const ICON_LIST = [
  // ---- nav ----
  { id: "home", label: "Home", group: "nav", acc: "white",
    l: `<path d="M4 11 12 4.5 20 11v9H4z"/>`,
    u: `<rect x="10" y="14" width="4" height="6"/>` },
  { id: "blocks", label: "Blocks", group: "nav", acc: "block",
    l: `<rect x="6" y="6" width="12" height="12"/><path d="M1 12h5M18 12h5"/>`,
    u: `<rect x="9" y="9" width="6" height="6"/>` },
  { id: "mempool", label: "Mempool", group: "nav", acc: "tx",
    l: `<path d="M5 3h14M5 21h14M7 3v3.5l5 5.5-5 5.5V21M17 3v3.5L12 12l5 5.5V21"/>`,
    u: `<rect x="9" y="15" width="6" height="5"/>` },
  { id: "transactions", label: "Transactions", group: "nav", acc: "tx",
    l: `<rect x="2" y="9" width="6" height="6"/><path d="M10 12h3.5M11.5 9.5 14 12l-2.5 2.5"/>`,
    u: `<rect x="16" y="8" width="7" height="8"/>` },
  { id: "addresses", label: "Addresses", group: "nav", acc: "addr",
    l: `<rect x="2" y="5" width="20" height="14"/><path d="M14 10h5M14 14h3"/>`,
    u: `<rect x="5" y="9" width="6" height="6"/>` },
  { id: "names", label: "Names", group: "nav", acc: "addr",
    l: `<path d="M3 6h11l6 6-6 6H3z"/>`,
    u: `<rect x="6" y="9" width="6" height="6"/>` },
  { id: "favorites", label: "Favorites", group: "nav", acc: "down",
    l: `<path d="M12 20s-8-5-8-10.5A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.5C20 15 12 20 12 20z"/>`,
    u: `` },
  { id: "tokens", label: "Tokens", group: "nav", acc: "token",
    l: `<circle cx="12" cy="12" r="8.5"/>`,
    u: `<rect x="9" y="9" width="6" height="6"/>` },
  { id: "nfts", label: "NFTs", group: "nav", acc: "token",
    l: `<rect x="3" y="3" width="18" height="18"/><path d="M3 17l5-5 4 4 3-3 6 6"/>`,
    u: `<rect x="13" y="6" width="5" height="5"/>` },
  { id: "rent", label: "Rent", group: "nav", acc: "box",
    l: `<rect x="3" y="4" width="18" height="4"/><path d="M4 8v12h16V8"/><circle cx="12" cy="14" r="3.5"/>`,
    u: `<path d="M12 10.5V14h3.5a3.5 3.5 0 0 0-3.5-3.5z"/>` },
  { id: "defi", label: "DeFi", group: "nav", acc: "token",
    l: `<path d="M4 3v17h17"/><path d="M7.5 4c.8 7.5 4.5 12 13.5 12.5"/>`,
    u: `<rect x="8" y="9" width="6" height="6"/>` },
  { id: "oracles", label: "Oracles", group: "nav", acc: "white",
    l: `<path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.6 4.6a10.2 10.2 0 0 0 0 14.8M19.4 4.6a10.2 10.2 0 0 1 0 14.8"/>`,
    u: `<rect x="9" y="9" width="6" height="6"/>` },
  { id: "rosen", label: "Rosen bridge", group: "nav", acc: "white",
    l: `<path d="M1 14h22M6 3v18M18 3v18M6 4c2 3 10 3 12 0M1 10c2.5 0 4-2.5 5-6M23 10c-2.5 0-4-2.5-5-6"/>`,
    u: `<rect x="9" y="8" width="6" height="5"/>` },
  { id: "lithos", label: "Lithos protocol", group: "nav", acc: "block",
    l: `<path d="M4 20 14 10M8.5 4.5c5 0 10 4 11 11"/>`,
    u: `<rect x="15" y="16" width="5" height="5"/>` },
  { id: "guide", label: "Guide", group: "nav", acc: "white",
    l: `<path d="M2 5h7l3 2 3-2h7v14h-7l-3 2-3-2H2zM12 7v14"/>`,
    u: `<path d="M16 5h3v7l-1.5-1.3L16 12z"/>` },
  { id: "settings", label: "Settings", group: "nav", acc: "white",
    l: `<path d="M3 6h18M3 12h18M3 18h18"/>`,
    f: `<rect x="13" y="4" width="4" height="4"/><rect x="14" y="16" width="4" height="4"/>`,
    u: `<rect x="6" y="10" width="4" height="4"/>` },
  { id: "about", label: "About", group: "nav", acc: "white",
    l: `<rect x="3" y="3" width="18" height="18"/><path d="M12 11v6"/>`,
    u: `<rect x="11" y="6.5" width="2" height="2.5"/>` },
  { id: "api", label: "API", group: "nav", acc: "white",
    l: `<path d="M8 4H6v6l-3 2 3 2v6h2M16 4h2v6l3 2-3 2v6h-2"/>`,
    u: `<rect x="9" y="9" width="6" height="6"/>` },
  { id: "status", label: "Status", group: "nav", acc: "box",
    l: `<path d="M1 12h4l2.5-5 4 10 2.5-5h1"/>`,
    u: `<rect x="17" y="9" width="6" height="6"/>` },

  // ---- entity marks ----
  { id: "block", label: "Block", group: "entity", acc: "block", same: "blocks" },
  { id: "tx", label: "Transaction", group: "entity", acc: "tx", same: "transactions" },
  { id: "address", label: "Address", group: "entity", acc: "addr", same: "addresses" },
  { id: "token", label: "Token", group: "entity", acc: "token", same: "tokens" },
  { id: "box", label: "Box", group: "entity", acc: "box",
    l: `<path d="M4 9v11h16V9M10 13h4"/>`,
    u: `<rect x="2" y="4" width="20" height="5"/>` },
  { id: "nft", label: "NFT", group: "entity", acc: "token", same: "nfts" },
  { id: "fee", label: "Fee", group: "entity", acc: "tx",
    l: `<path d="M5 3h14v18l-2.3-1.5-2.4 1.5-2.3-1.5-2.3 1.5-2.4-1.5L5 21zM9 14h6M9 17h4"/>`,
    u: `<rect x="9" y="6" width="6" height="4"/>` },
  { id: "size", label: "Size", group: "entity", acc: "tx",
    l: `<path d="M3 3v4M21 3v4M3 5h18"/><rect x="3" y="10" width="18" height="10"/>`,
    u: `<rect x="6" y="13" width="7" height="4"/>` },
  { id: "time", label: "Time", group: "entity", acc: "tx",
    l: `<circle cx="12" cy="12" r="9"/>`,
    u: `<path d="M12 6v6h6a6 6 0 0 0-6-6z"/>` },
  { id: "holders", label: "Holders", group: "entity", acc: "addr",
    l: `<path d="M3 21v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3M17 15h1a3 3 0 0 1 3 3v3"/><rect x="15" y="5" width="4" height="5"/>`,
    u: `<rect x="6" y="5" width="6" height="6"/>` },
];

// resolve aliases
const byId = Object.fromEntries(ICON_LIST.map((i) => [i.id, i]));
for (const i of ICON_LIST) if (i.same) Object.assign(i, { l: byId[i.same].l, u: byId[i.same].u, f: byId[i.same].f });

function render(ic, o) {
  const sw = o.sw || 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">` +
    `<g stroke="${o.line}" stroke-width="${sw}" stroke-linejoin="miter" stroke-linecap="butt" stroke-miterlimit="10">${ic.l}</g>` +
    (ic.f ? `<g fill="${o.line}">${ic.f}</g>` : "") +
    (ic.u ? `<g fill="${o.acc}">${ic.u}</g>` : "") +
    `</svg>`
  );
}

function accColor(ic) {
  const m = { white: "#ffffff", block: "#ffd23c", tx: "#ff6a2b", addr: "#ff7ab8", token: "#5b8dff", box: "#2fd27f", down: "#ff5468" };
  return m[ic.acc] || "#ffffff";
}

export const ICONS = { list: ICON_LIST, render, accColor };
