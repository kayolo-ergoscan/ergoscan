// Link-preview cards 1200x630 in the «Сигнал» look. Real data read 2026-11-12 ~17:20 UTC
// from api.ergoscan.me/api/v1/{transactions,addresses/../balance/confirmed,tokens} and the ergoscan.me
// tx/address/token pages (labels, holders, tx counts, ticker prices; ERG/USD 0.169443 coingecko).
window.CARDS = (() => {
  const { B, el, raw } = H;
  const C = B.C;
  const LOGO = (id) => "token-logos/" + id + ".png";
  const T = {
    sigusd: "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04",
    rsada: "e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297",
    lambo: "0fdb7ff8b37479b6eb7aab38d45af2cfeefabbefdc7eebc0348d25dd65bc2c91",
    cos: "f0d5bdf474fcbd4249608e6dc6e9cf34a327b218f66445ea545b4c711b4676e3",
    ergone: "fcfca7654fb0da57ecf9a3f489bcbeb1d43b56dce7e73b352f7bc6f2561d2a1b",
  };
  const mono = (w, s) => `${w} ${s}px 'IBM Plex Mono'`;
  const sans = (w, s) => `${w} ${s}px 'IBM Plex Sans'`;

  const frame = () =>
    el("div", { style: { width: "1200px", height: "630px", background: C.page, position: "relative", overflow: "hidden", color: "#fff", fontFamily: "'IBM Plex Sans'" } });
  const at = (parent, x, y, node, extra = {}) => {
    Object.assign(node.style, { position: "absolute", left: x + "px", top: y + "px" }, extra);
    parent.append(node);
    return node;
  };
  const chip = (text, bg, s = 22) =>
    el("span", { style: { font: sans(600, s), color: "#0e0e0e", background: bg, borderRadius: "6px", padding: "3px 11px 4px", lineHeight: 1.15, display: "inline-block", whiteSpace: "nowrap" } }, text);
  const tile = (w, h, extra = {}) =>
    el("div", { style: Object.assign({ width: w + "px", height: h + "px", background: C.tile, borderRadius: "20px", boxSizing: "border-box", position: "relative" }, extra) });
  const tokenChip = (logo, name, amount, s = 26) => {
    const ic = logo
      ? el("img", { src: LOGO(logo), style: { width: s + 10 + "px", height: s + 10 + "px", borderRadius: "50%" } })
      : el("span", { style: { width: s + 10 + "px", height: s + 10 + "px", borderRadius: "50%", background: "#2c2c2c", color: C.t2, font: mono(600, s * 0.55), display: "inline-flex", alignItems: "center", justifyContent: "center" } }, name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase());
    return el("span", { style: { display: "inline-flex", alignItems: "center", gap: "12px", background: "#232323", borderRadius: "999px", padding: "7px 18px 7px 7px", whiteSpace: "nowrap" } },
      ic, el("span", { style: { font: sans(600, s) } }, name), el("span", { style: { font: mono(500, s), color: C.t2 } }, amount));
  };
  const stat = (w, label, labelBg, value, valueColor = "#fff", sub = "", fs = 36) => {
    const t = tile(w, 112, { padding: "18px 22px" });
    t.append(chip(label, labelBg, 18));
    t.append(el("div", { style: { font: mono(600, fs), color: valueColor, marginTop: "10px", whiteSpace: "nowrap", letterSpacing: "-0.01em" } }, value,
      sub ? el("span", { style: { font: mono(500, 22), color: C.t3, marginLeft: "8px" } }, sub) : null));
    return t;
  };
  const header = (card, d, chipText, chipBg, id) => {
    at(card, 56, 50, BR.lockup(d, 30));
    const r = el("div", { style: { display: "flex", alignItems: "center", gap: "14px" } }, chip(chipText, chipBg, 24),
      id ? el("span", { style: { font: mono(500, 26), color: C.t2 } }, id) : null);
    at(card, 0, 52, r, { right: "56px", left: "auto" });
  };
  const bottom = (card, items) => {
    const w = Math.floor((1088 - 16 * (items.length - 1)) / items.length);
    items.forEach((it, i) => at(card, 56 + i * (w + 16), 462, stat(w, ...it)));
  };
  const big = (num, unit, s = 128) =>
    el("div", { style: { display: "flex", alignItems: "baseline", gap: "18px", whiteSpace: "nowrap" } },
      el("span", { style: { font: mono(600, s), letterSpacing: "-0.035em", lineHeight: 1 } }, num),
      unit ? el("span", { style: { font: mono(500, Math.round(s * 0.4)), color: C.t3 } }, unit) : null);

  // ---------------------------------------------------------------- transaction
  function tx(d) {
    const card = frame();
    header(card, d, "Transaction", C.tx, "fab5371d…5a4f6ee0");
    const m = tile(1088, 310, { padding: "28px 40px" });
    const arrow = raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><path d="M0 10h33M27 3l8 7-8 7" stroke="${C.tx}" stroke-width="3.5" fill="none"/></svg>`, 36);
    arrow.style.height = "18px";
    m.append(el("div", { style: { display: "flex", alignItems: "center", gap: "16px", font: mono(500, 28) } },
      chip("Sent", C.tx, 20),
      el("span", { style: { color: C.addr } }, "9eZ9v2jp…KWRVcnN6"), arrow,
      el("span", { style: { color: C.addr } }, "4EQTxw3M…Agicbq"),
      el("span", { style: { font: sans(500, 20), color: C.t2, background: "#2a2a2a", borderRadius: "6px", padding: "3px 10px" } }, "contract")));
    const row = el("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: "12px" } },
      big("100", "ERG", 132), el("span", { style: { font: mono(500, 40), color: C.t2 } }, "≈ $16.94"));
    m.append(row);
    at(card, 56, 128, m);
    const toks = el("div", { style: { display: "flex", gap: "12px", alignItems: "center" } },
      tokenChip(T.sigusd, "SigUSD", "0.11", 24), tokenChip(T.rsada, "rsADA", "0.0015", 24),
      el("span", { style: { font: mono(500, 24), color: C.t3, marginLeft: "4px" } }, "+21 tokens in boxes"));
    at(card, 96, 368, toks);
    bottom(card, [
      ["Block", C.tx, "1,915,260", C.block],
      ["Time · UTC", C.tx, "12.11 16:12", "#fff", "", 34],
      ["Fee", C.tx, "0.002", "#fff", "ERG"],
      ["Boxes in → out", C.tx, "2 → 3"],
    ]);
    return card;
  }

  // ---------------------------------------------------------------- address
  function address(d, named) {
    const card = frame();
    const A = named
      ? { chip: "Exchange", name: "Gate.io", addr: "9iKFBBrr…QzD4VykC", bal: "5 522 697", dec: ".94", usd: "≈ $935.8K",
          toks: [[T.cos, "COS", "1,234,321"], [null, "Satoshi", "45,179.57"], [T.ergone, "ErgOne", "1"]], more: "20 tokens",
          stats: [["Transactions", C.addr, "83,384"], ["Boxes", C.box, "25,313", "#fff", "unspent"], ["First seen", C.addr, "6y ago"], ["Last seen", C.addr, "1h ago"]] }
      : { chip: "Address", name: null, addr: "9hUhEkUX…L59PKQ27", bal: "910 001", dec: ".39", usd: "≈ $154.2K",
          toks: [[T.cos, "COS", "1,234,321"], [null, "rsHOSKY", "69,420"], [T.lambo, "$Lambo", "69"]], more: "8 tokens",
          stats: [["Transactions", C.addr, "11"], ["Boxes", C.box, "10", "#fff", "unspent"], ["First seen", C.addr, "3y ago"], ["Last seen", C.addr, "1y ago"]] };
    header(card, d, named ? "Address" : "Address", C.addr, named ? null : "P2PK");
    const m = tile(1088, 310, { padding: "28px 40px" });
    if (named) {
      m.append(el("div", { style: { display: "flex", alignItems: "baseline", gap: "18px" } },
        el("span", { style: { font: sans(700, 50), letterSpacing: "-0.02em" } }, A.name),
        chip(A.chip, "#fff", 18),
        el("span", { style: { font: mono(500, 26), color: C.addr } }, A.addr)));
    } else {
      m.append(el("div", { style: { display: "flex", alignItems: "baseline", gap: "18px" } },
        el("span", { style: { font: mono(600, 44), color: C.addr, letterSpacing: "-0.01em" } }, A.addr),
        el("span", { style: { font: sans(400, 22), color: C.t3 } }, "no name yet")));
    }
    const row = el("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: "14px" } },
      el("div", { style: { display: "flex", alignItems: "baseline", whiteSpace: "nowrap" } },
        el("span", { style: { font: mono(600, named ? 100 : 112), letterSpacing: "-0.04em", lineHeight: 1 } }, A.bal),
        el("span", { style: { font: mono(600, named ? 56 : 64), color: C.t2, letterSpacing: "-0.03em" } }, A.dec),
        el("span", { style: { font: mono(500, named ? 40 : 44), color: C.t3, marginLeft: "14px" } }, "ERG")),
      el("span", { style: { font: mono(500, 38), color: C.t2 } }, A.usd));
    m.append(row);
    at(card, 56, 128, m);
    const toks = el("div", { style: { display: "flex", gap: "12px", alignItems: "center" } },
      ...A.toks.map(([l, n, a]) => tokenChip(l, n, a, 24)),
      el("span", { style: { font: mono(500, 24), color: C.t3, marginLeft: "4px" } }, A.more));
    at(card, 96, 368, toks);
    bottom(card, A.stats);
    return card;
  }

  // ---------------------------------------------------------------- token
  function token(d) {
    const card = frame();
    header(card, d, "Token", C.token, "03faf2cb…4bfcbf04");
    const m = tile(1088, 310, { padding: "34px 40px" });
    const top = el("div", { style: { display: "flex", alignItems: "center", gap: "28px" } },
      el("img", { src: LOGO(T.sigusd), style: { width: "112px", height: "112px" } }),
      el("div", {},
        el("div", { style: { font: sans(700, 64), letterSpacing: "-0.02em", lineHeight: 1.05 } }, "SigUSD"),
        el("div", { style: { font: sans(400, 26), color: C.t2, marginTop: "6px" } }, "SigmaUSD – V2 · stablecoin · 2 decimals")));
    m.append(top);
    const row = el("div", { style: { display: "flex", alignItems: "baseline", gap: "26px", marginTop: "26px" } },
      big("$0.9830", "", 104),
      el("span", { style: { font: mono(600, 38), color: C.box } }, "+0.30%"),
      el("span", { style: { font: mono(500, 26), color: C.t3 } }, "24h"));
    m.append(row);
    at(card, 56, 128, m);
    bottom(card, [
      ["Holders", C.token, "1,140"],
      ["Transactions", C.token, "63,145"],
      ["Supply", C.token, "100B"],
      ["Pools", C.token, "12"],
    ]);
    return card;
  }

  // ---------------------------------------------------------------- default
  function deflt(d) {
    const card = frame();
    at(card, 64, 64, BR.lockup(d, 64));
    at(card, 0, 82, el("span", { style: { font: mono(500, 26), color: C.t3 } }, "ergoscan.me"), { right: "64px", left: "auto" });
    at(card, 64, 208, el("div", { style: { font: sans(700, 66), letterSpacing: "-0.025em", lineHeight: 1.05 } }, "Ergo Mainnet Explorer"));
    at(card, 64, 290, el("div", { style: { font: sans(400, 28), color: C.t2 } }, "Blocks, transactions, addresses, tokens and boxes."));
    const s = tile(1072, 84, { display: "flex", alignItems: "center", gap: "18px", padding: "0 28px", borderRadius: "16px" });
    s.append(raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="${C.block}" stroke-width="2.4"/><path d="M15.5 15.5 21 21" stroke="${C.block}" stroke-width="2.4"/></svg>`, 30));
    s.append(el("span", { style: { font: mono(500, 32), color: "#fff" } }, "block, tx, address, token, box",
      el("span", { style: { display: "inline-block", width: "18px", height: "4px", background: "#fff", marginLeft: "4px", verticalAlign: "baseline" } })));
    at(card, 64, 368, s);
    const row = el("div", { style: { display: "flex", gap: "12px" } });
    for (const [id, lab, col] of [["block", "Block", C.block], ["tx", "Transaction", C.tx], ["address", "Address", C.addr], ["token", "Token", C.token], ["box", "Box", C.box]]) {
      row.append(el("div", { style: { display: "flex", alignItems: "center", gap: "12px", background: C.tile, borderRadius: "12px", padding: "12px 20px 12px 14px", font: sans(600, 26) } }, BR.icon(id, 30, col, col), lab));
    }
    at(card, 64, 494, row);
    return card;
  }

  return { tx, address, token, deflt };
})();
if (window.BR) BR.ogDefault = (d) => CARDS.deflt(d);
