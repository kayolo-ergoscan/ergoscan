// Sheet-side builders: lockups, the C-look side nav replica, share cards.
window.BR = (() => {
  const { B, el, raw, img } = H;
  const C = B.C;

  // Wordmark per direction (fonts: IBM Plex via Google Fonts in each sheet)
  const WORD = {
    a: { text: "ERGOSCAN", tail: ".ME", font: "600 {s}px 'IBM Plex Mono'", ls: "0.02em", gap: 0.55, mk: 1.25 },
    b: { text: "ergoscan", tail: "", font: "700 {s}px 'IBM Plex Sans'", ls: "-0.035em", gap: 0.42, mk: 1.25 },
    c: { text: "ergoscan", tail: ".me", font: "500 {s}px 'IBM Plex Mono'", ls: "-0.03em", gap: 0.45, mk: 1.5 },
  };
  // which drawing of the mark a direction uses
  const MK = { a: "a", b: "b", c: "c" };
  const mark = (d, px, theme = "dark") => {
    const m = B.marks[MK[d]];
    const svg = px <= 32 ? m.s16[theme] : m.s48[theme];
    return raw(svg, px);
  };
  const markSvg = (d, px, theme = "dark") => {
    const m = B.marks[MK[d]];
    return px <= 32 ? m.s16[theme] : m.s48[theme];
  };

  function lockup(d, s, theme = "dark") {
    const w = WORD[d];
    const ink = theme === "dark" ? "#fff" : C.page;
    const dim = theme === "dark" ? C.t3 : "#6b6b6b";
    const mpx = Math.round(s * w.mk);
    const t = el("span", { style: { font: w.font.replace("{s}", s), letterSpacing: w.ls, color: ink, lineHeight: 1, whiteSpace: "nowrap" } }, w.text);
    if (w.tail) t.append(el("span", { style: { color: dim } }, w.tail));
    return el("span", { style: { display: "inline-flex", alignItems: "center", gap: Math.round(s * w.gap) + "px" } }, mark(d, mpx, theme), t);
  }

  function icon(id, px, line, acc) {
    const ic = B.icons.list.find((i) => i.id === id);
    return raw(B.renderIcon(ic, { line, acc: acc || B.accColor(ic), px }), px);
  }

  // side nav replica of the C look
  const NAV = [
    ["home", "Home"], ["blocks", "Blocks"], ["mempool", "Mempool"], ["transactions", "Transactions"],
    ["addresses", "Addresses"], ["names", "Names"], ["favorites", "Favorites"], ["tokens", "Tokens"],
    ["nfts", "NFTs"], ["rent", "Rent", 1], ["defi", "DeFi", 1], ["oracles", "Oracles", 1],
    ["rosen", "Rosen bridge"], ["lithos", "Lithos protocol"], null,
    ["guide", "Guide", 1], ["settings", "Settings"], ["about", "About"], ["api", "API"], ["status", "Status"],
  ];
  function nav(d, { active = "home", count = 99, width = 248, compact = false } = {}) {
    const p = el("div", { style: { width: width + "px", background: "#171717", borderRadius: "16px", padding: "0 0 14px", boxSizing: "border-box" } });
    p.append(el("div", { style: { height: "72px", display: "flex", alignItems: "center", justifyContent: "center" } }, compact ? mark(d, 28) : lockup(d, 17)));
    let n = 0;
    for (const it of NAV) {
      if (n >= count) break;
      if (!it) {
        p.append(el("div", { style: { height: "1px", background: "#2a2a2a", margin: "8px 18px" } }));
        continue;
      }
      n++;
      const on = it[0] === active;
      const row = el("div", {
        style: {
          display: "flex", alignItems: "center", gap: "12px", height: "40px", margin: "0 8px",
          padding: compact ? "0" : "0 12px", justifyContent: compact ? "center" : "flex-start",
          borderRadius: "8px", background: on ? "#fff" : "transparent", color: on ? "#0e0e0e" : "#e9e9e9",
          font: "500 16px 'IBM Plex Sans'",
        },
      }, icon(it[0], 20, on ? "#0e0e0e" : "#c6c6c6", on ? "#0e0e0e" : null));
      if (!compact) {
        row.append(el("span", {}, it[1]));
        if (it[2]) row.append(el("span", { style: { color: on ? "#0e0e0e" : "#8a8a8a", font: "400 15px 'IBM Plex Sans'", marginLeft: "-4px" } }, "›"));
      }
      p.append(row);
    }
    return p;
  }

  // browser tab strip with a favicon at real size
  function tabs(d, theme) {
    const dark = theme === "dark";
    const bar = el("div", { style: { background: dark ? "#202124" : "#dee1e6", padding: "8px 8px 0", display: "flex", gap: "2px", borderRadius: "10px 10px 0 0", width: "430px" } });
    const tab = (fav, title, on) =>
      el("div", {
        style: {
          display: "flex", alignItems: "center", gap: "8px", height: "34px", padding: "0 12px", width: "190px",
          borderRadius: "8px 8px 0 0", background: on ? (dark ? "#35363a" : "#fff") : "transparent",
          color: dark ? "#e8eaed" : "#202124", font: "400 13px system-ui, 'IBM Plex Sans'",
        },
      }, fav, el("span", { style: { whiteSpace: "nowrap", overflow: "hidden" } }, title));
    const fav = img(markSvg(d, 16, dark ? "dark" : "light"), 16);
    const other = el("span", { style: { width: "16px", height: "16px", borderRadius: "50%", background: dark ? "#5f6368" : "#9aa0a6", display: "inline-block" } });
    bar.append(tab(fav, "Tx fab5371d… · ErgoScan", true), tab(other, "Inbox (3)", false));
    const url = el("div", { style: { background: dark ? "#35363a" : "#fff", height: "36px", width: "430px", display: "flex", alignItems: "center", padding: "0 14px", boxSizing: "border-box", font: "400 13px system-ui", color: dark ? "#bdc1c6" : "#5f6368" } }, "ergoscan.me/tx/fab5371d6786…");
    return el("div", {}, bar, url);
  }

  // iOS-like app icon (mask radius 22.37%)
  function appIcon(d, px) {
    const m = B.marks[MK[d]];
    const t = el("div", { style: { width: px + "px", height: px + "px", borderRadius: px * 0.2237 + "px", background: C.page, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: "0 0 0 1px rgba(255,255,255,.06) inset" } });
    t.append(raw(m.s48.dark, Math.round(px * 0.62)));
    return t;
  }

  // default share card 1200x630
  function ogDefault(d) {
    const card = el("div", { style: { width: "1200px", height: "630px", background: C.page, position: "relative", overflow: "hidden", fontFamily: "'IBM Plex Sans'", color: "#fff" } });
    const inner = el("div", { style: { position: "absolute", inset: "0", padding: "72px 80px", display: "flex", flexDirection: "column" } });
    inner.append(lockup(d, 64));
    inner.append(el("div", { style: { font: "600 54px/1.1 'IBM Plex Sans'", letterSpacing: "-0.02em", marginTop: "64px" } }, "Ergo Mainnet Explorer"));
    inner.append(el("div", { style: { font: "400 26px/1.4 'IBM Plex Sans'", color: C.t2, marginTop: "16px", maxWidth: "820px" } }, "Blocks, transactions, addresses, tokens and boxes — every one in its own colour."));
    const row = el("div", { style: { display: "flex", gap: "12px", marginTop: "auto" } });
    for (const [id, lab, col] of [["block", "Block", C.block], ["tx", "Transaction", C.tx], ["address", "Address", C.addr], ["token", "Token", C.token], ["box", "Box", C.box]]) {
      row.append(el("div", { style: { display: "flex", alignItems: "center", gap: "10px", background: C.tile, borderRadius: "10px", padding: "12px 16px 12px 12px", font: "500 22px 'IBM Plex Sans'" } }, icon(id, 28, col, col), lab));
    }
    inner.append(row);
    inner.append(el("div", { style: { position: "absolute", right: "80px", top: "86px", font: "500 24px 'IBM Plex Mono'", color: C.t3 } }, "ergoscan.me"));
    card.append(inner);
    return card;
  }

  return { lockup, mark, markSvg, icon, nav, tabs, appIcon, ogDefault, MK, WORD };
})();
