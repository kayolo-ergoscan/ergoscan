/*
 * Home rent tile mockups. Injected into the live home page for screenshots only.
 * It rebuilds the tile in place and moves the live crate yard (its canvas host) into the
 * new markup, so the crates and Pixel keep running. Nothing here ships.
 *
 *   window.__rentMock("v1" | "v2" | "v3", data)
 *   data = { height, epochBoxes, epochNano, tape: RentTapeRow[], danger: RentDangerRow[] }
 */
(() => {
  const EPOCH = 1024;
  const WEEK = 5040;
  const css = `
  .rm { display:flex; flex-direction:column; height:100%; min-height:0; padding:12px 20px 12px; gap:10px;
        font-size:13px; line-height:1.25; color:var(--text); }
  .rm h2 { margin:0; flex:none; white-space:nowrap; }
  .rm-head > span { text-align:right; }
  .rm-foot a { white-space:nowrap; }
  .rm a { text-decoration:none; }
  .rm-mono { font-family: var(--font-mono), ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .rm-head { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:22px; }
  .rm-sub { color: var(--muted-2); font-size:12px; line-height:1.3; }
  .rm-lab { color: var(--muted); font-size:12px; line-height:1.3; }
  .rm-big { font-family: var(--font-mono), ui-monospace, monospace; font-variant-numeric: tabular-nums;
            font-size:26px; font-weight:600; line-height:1; letter-spacing:-0.02em; color: var(--k-rent); }
  .rm-big.is-usd { color: var(--text); }
  .rm-cols { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 0 36px; flex:1; min-height:0; }
  .rm-col { display:flex; flex-direction:column; min-width:0; min-height:0; }
  .rm-belt { position:relative; flex:1; min-height:132px; }
  .rm-belt > div { position:absolute !important; inset:0; }
  .rm-cap { display:flex; gap:6px; align-items:baseline; font-size:12px; white-space:nowrap; overflow:hidden; color: var(--muted); }
  .rm-cap .k { color: var(--muted-2); }
  .rm-capbox { display:flex; flex-direction:column; gap:3px; }
  .rm-big small { font-size:15px; font-weight:500; color: var(--muted-2); margin-right:6px; letter-spacing:0; }
  .rm-split > :last-child { white-space:nowrap; }
  .rm-cap .v { color: var(--text); }
  .rm-cap .r { color: var(--k-rent); }
  .rm-split { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
  .rm-t { width:100%; border-collapse:collapse; table-layout:fixed; }
  .rm-t th { font-weight:500; color:var(--muted-2); font-size:11px; text-align:right; padding:0 0 3px; }
  .rm-t th:first-child, .rm-t td:first-child { text-align:left; }
  .rm-t td { height:25px; text-align:right; padding:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rm-t tr + tr td { box-shadow: inset 0 1px 0 var(--border-soft); }
  .rm-t .c-amt { color: var(--muted); }
  .rm-t .c-usd { color: var(--text); }
  .rm-t .c-when { color: var(--muted); }
  .rm-t .c-when.is-soon { color: var(--k-rent); }
  .rm-tok { display:inline-flex; align-items:center; gap:7px; min-width:0; max-width:100%; vertical-align:middle; }
  .rm-tok img { width:16px; height:16px; border-radius:50%; flex:none; background:#262626; }
  .rm-tok span { overflow:hidden; text-overflow:ellipsis; }
  .rm-x { color: var(--muted-2); font-size:11px; margin-left:4px; }
  .rm-note { color: var(--muted-2); font-size:11.5px; line-height:1.35; margin-top:auto; padding-top:8px; }
  .rm-foot { display:flex; justify-content:space-between; align-items:baseline; gap:12px; font-size:13px; }
  .rm-foot a { color: var(--muted) !important; }
  .rm-foot a:hover { color: var(--text) !important; }
  /* v2: one time axis */
  .rm-v2-top { display:grid; grid-template-columns: minmax(0,1.05fr) minmax(0,1fr); gap: 0 28px; flex:1; min-height:0; }
  .rm-facts { display:flex; flex-direction:column; justify-content:center; gap:16px; }
  .rm-axis { position:relative; height:96px; flex:none; }
  .rm-axis .base { position:absolute; left:0; right:0; top:58px; height:1px; background: var(--border); }
  .rm-axis .ep { position:absolute; left:0; top:57px; height:3px; background: var(--k-rent); border-radius:2px; }
  .rm-axis .tick { position:absolute; top:54px; width:1px; height:9px; background: var(--hair); }
  .rm-axis .tl { position:absolute; top:66px; font-size:11px; color: var(--muted-2); transform:translateX(-50%); white-space:nowrap; }
  .rm-axis .tl.is-ep { color: var(--k-rent); top:81px; }
  .rm-axis .tl.is-0 { transform:none; }
  .rm-axis .tl.is-end { transform:translateX(-100%); }
  .rm-axis .mk { position:absolute; width:16px; height:16px; border-radius:50%; box-shadow: 0 0 0 2px var(--module); }
  .rm-axis .mk.is-top { box-shadow: 0 0 0 2px var(--module), 0 0 0 3.5px var(--text); }
  .rm-axis .pin { position:absolute; width:1px; background: var(--hair); }
  .rm-axis .call { position:absolute; top:0; font-size:11px; white-space:nowrap; color: var(--text); }
  .rm-axis .call b { font-weight:600; }
  /* v3: two tiles */
  .rm-two { display:grid !important; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 8px; }
  .rm-list { display:flex; flex-direction:column; }
  .rm-li { display:grid; grid-template-columns: minmax(0,1fr) 64px 48px; align-items:center; height:26px; gap:8px; }
  .rm-li + .rm-li { box-shadow: inset 0 1px 0 var(--border-soft); }
  .rm-li .c-usd { text-align:right; color: var(--text); }
  .rm-li .c-when { text-align:right; color: var(--muted); }
  .rm-li .c-when.is-soon { color: var(--k-rent); }
  @media (max-width: 639px) {
    .rm { padding:12px 16px; }
    .rm-cols, .rm-v2-top { grid-template-columns: minmax(0,1fr); gap: 18px; }
    .rm-belt { min-height:176px; flex:none; }
    .rm-two { grid-template-columns: minmax(0,1fr); }
  }
  `;

  const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const num = (x, d) => {
    const [i, f] = Number(x).toFixed(d).split(".");
    return grp(i) + (f ? "." + f : "");
  };
  const erg = (nano, d = 2) => num(Number(nano) / 1e9, d);
  const when = (b) => {
    if (b <= 0) return "уже";
    const m = b * 2;
    if (m < 60) return `${m} мин`;
    const h = m / 60;
    if (h < 48) return `${Math.round(h)} ч`;
    return `${Math.round(h / 24)} дн`;
  };
  const compact = (a) => {
    if (a >= 1e6) return num(a / 1e6, 1) + "M";
    if (a >= 1e4) return num(a / 1e3, 0) + "K";
    if (a >= 100) return num(a, 0);
    return num(a, 2).replace(/\.?0+$/, "");
  };
  const usd = (u) => (u >= 0.01 ? "$" + num(u, 2) : u > 0 ? "<$0.01" : "—");
  const short = (a, n = 4) => (a.length > 2 * n + 1 ? a.slice(0, n) + "…" + a.slice(-n) : a);
  const boxes = (n) => {
    const m10 = n % 10, m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? "бокс" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "бокса" : "боксов";
    return `${grp(String(n))} ${w}`;
  };
  const boxesIn = (n) => {
    const m10 = n % 10, m100 = n % 100;
    return `${grp(String(n))} ${m10 === 1 && m100 !== 11 ? "боксе" : "боксах"}`;
  };
  const logo = (id) => `<img alt="" src="/token-logos/${id}.png" onerror="this.style.visibility='hidden'">`;
  const tag = (text) => `<h2 style="color: var(--tile-label, #ff8a65)">${text}</h2>`;

  function groups(danger) {
    const by = new Map();
    for (const r of danger) {
      const dec = r.decimals || 0;
      const g = by.get(r.tokenId) || {
        tokenId: r.tokenId, name: r.name || short(r.tokenId), boxes: 0, amt: 0, usd: 0, soon: Infinity,
      };
      const a = Number(r.amount) / 10 ** dec;
      g.amt += a;
      g.usd += a * (r.priceUsd || 0);
      g.boxes += 1;
      g.soon = Math.min(g.soon, r.blocksUntilRent);
      by.set(r.tokenId, g);
    }
    return [...by.values()].sort((a, b) => a.soon - b.soon);
  }

  function facts(D) {
    const slot = D.height % EPOCH;
    const left = EPOCH - slot;
    const epoch = Math.floor(D.height / EPOCH);
    const G = groups(D.danger);
    const total = G.reduce((s, g) => s + g.usd, 0);
    const lead = D.tape[0];
    return { slot, left, epoch, G, total, lead };
  }

  function caption(lead) {
    if (!lead) return "";
    return `<div class="rm-capbox">
      <div class="rm-cap"><span class="k">На очереди</span>
        <a class="rm-mono" href="/address/${lead.address}">${short(lead.address)}</a></div>
      <div class="rm-cap rm-mono"><span>через ${when(lead.blocksUntilRent)}</span>
        <span>· ${boxes(lead.boxCount)}</span>
        <span>· рента <span class="r">${erg(lead.rentNano)} ERG</span></span></div></div>`;
  }

  function v1(D) {
    const F = facts(D);
    const rows = F.G.map((g) => `<tr>
        <td><a class="rm-tok" href="/token/${g.tokenId}">${logo(g.tokenId)}<span>${g.name}</span></a>${g.boxes > 1 ? `<span class="rm-x">×${g.boxes}</span>` : ""}</td>
        <td class="rm-mono c-amt">${compact(g.amt)}</td>
        <td class="rm-mono c-usd">${usd(g.usd)}</td>
        <td class="rm-mono c-when${g.soon <= 720 ? " is-soon" : ""}">${when(g.soon)}</td></tr>`).join("");
    return `<div class="rm rm-v1">
      <div class="rm-head">${tag("Рента хранения")}
        <span class="rm-sub rm-mono">эпоха ${grp(String(F.epoch))} · ещё ${when(F.left)}</span></div>
      <div class="rm-cols">
        <div class="rm-col">
          <div class="rm-lab">Майнеры могут собрать до конца эпохи</div>
          <div class="rm-big" style="margin-top:6px"><small>до</small>${erg(D.epochNano)} ERG</div>
          <div class="rm-sub" style="margin-top:5px">с ${boxes(D.epochBoxes)}, которым исполняется 4 года</div>
          <div class="rm-belt" data-slot="belt"></div>
          ${caption(F.lead)}
        </div>
        <div class="rm-col">
          <div class="rm-split"><span class="rm-lab">Могут уйти вместе с боксом · 7 дней</span>
            <span class="rm-mono">≈ ${usd(F.total)}</span></div>
          <table class="rm-t rm-mono" style="margin-top:8px">
            <colgroup><col><col style="width:64px"><col style="width:60px"><col style="width:48px"></colgroup>
            <thead><tr><th>Токен</th><th>Сколько</th><th>≈ $</th><th>Через</th></tr></thead>
            <tbody>${rows}</tbody></table>
          <div class="rm-note">В этих боксах ERG меньше ренты: майнер забирает такой бокс целиком, вместе с токенами.</div>
        </div>
      </div>
      <div class="rm-foot"><a href="/rent">Вся рента →</a></div>
    </div>`;
  }

  function v2(D) {
    const F = facts(D);
    // Axis 0 → 7 days. Width is read after layout.
    return `<div class="rm rm-v2">
      <div class="rm-head">${tag("Рента хранения")}
        <span class="rm-sub">бокс без движения 4 года → майнер может взять с него ренту</span></div>
      <div class="rm-v2-top">
        <div class="rm-col"><div class="rm-belt" data-slot="belt"></div>${caption(F.lead)}</div>
        <div class="rm-facts">
          <div><div class="rm-big"><small>до</small>${erg(D.epochNano)} ERG</div>
            <div class="rm-sub" style="margin-top:5px">соберут до конца эпохи ${grp(String(F.epoch))} · ${boxes(D.epochBoxes)}</div></div>
          <div><div class="rm-big is-usd">≈ ${usd(F.total)}</div>
            <div class="rm-sub" style="margin-top:5px">в токенах могут уйти вместе с боксом за 7 дней: ERG в боксе меньше ренты</div></div>
        </div>
      </div>
      <div class="rm-axis" data-axis></div>
      <div class="rm-foot"><a href="/rent">Вся рента →</a><span class="rm-sub">● токен в боксе, который майнер может забрать целиком</span></div>
    </div>`;
  }

  function drawAxis(root, D) {
    const ax = root.querySelector("[data-axis]");
    if (!ax) return;
    const F = facts(D);
    const W = ax.clientWidth;
    const x = (b) => Math.round((Math.min(WEEK, Math.max(0, b)) / WEEK) * (W - 16));
    let h = `<div class="base"></div><div class="ep" style="width:${x(F.left)}px"></div>`;
    h += `<span class="tl is-0" style="left:0">сейчас</span>`;
    h += `<span class="tl is-0 is-ep" style="left:0">▬ эта эпоха: ещё ${when(F.left)}, до ${erg(D.epochNano, 0)} ERG</span>`;
    for (let d = 2; d <= 7; d++) {
      const xb = x(d * 720);
      h += `<span class="tick" style="left:${xb}px"></span>`;
      if (W > 500 || d % 2 === 1) h += `<span class="tl${d === 7 ? " is-end" : ""}" style="left:${d === 7 ? W : xb}px">${d} дн</span>`;
    }
    // One marker per box; three lanes stacked upward.
    const sz = W < 500 ? 12 : 16;
    const lanes = [-1e9, -1e9, -1e9];
    const rows = [...D.danger].sort((a, b) => a.blocksUntilRent - b.blocksUntilRent);
    let top = null;
    for (const r of D.danger) {
      const u = (Number(r.amount) / 10 ** (r.decimals || 0)) * (r.priceUsd || 0);
      if (!top || u > top.u) top = { r, u };
    }
    for (const r of rows) {
      const xm = x(r.blocksUntilRent);
      let li = lanes.findIndex((end) => xm >= end + 3);
      if (li < 0) li = lanes.indexOf(Math.min(...lanes));
      lanes[li] = xm + sz;
      const y = 40 - li * (sz - 3);
      const isTop = top && top.r === r;
      h += `<img class="mk${isTop ? " is-top" : ""}" alt="" src="/token-logos/${r.tokenId}.png" style="left:${xm}px;top:${y + 16 - sz}px;width:${sz}px;height:${sz}px;z-index:${3 - li}">`;
      if (isTop) {
        h += `<span class="pin" style="left:${xm + sz / 2}px;top:12px;height:${y - 12}px"></span>`;
        h += `<span class="call" style="left:${Math.min(xm + sz / 2 - 2, W - 150)}px;top:-4px"><b>${r.name}</b> <span class="rm-mono">${usd(top.u)} · ${when(r.blocksUntilRent)}</span></span>`;
      }
    }
    ax.innerHTML = h;
  }

  function tileRent(D) {
    const F = facts(D);
    return `<div class="rm rm-v3a">
      <div class="rm-head">${tag("Рента этой эпохи")}<span class="rm-sub rm-mono">до конца ≈ ${when(F.left)}</span></div>
      <div><div class="rm-big"><small>до</small>${erg(D.epochNano)} ERG</div>
        <div class="rm-sub" style="margin-top:5px">майнеры могут собрать с ${boxes(D.epochBoxes)}: им исполняется 4 года</div></div>
      <div class="rm-belt" data-slot="belt"></div>
      ${caption(F.lead)}
      <div class="rm-foot"><a href="/rent">Вся рента →</a></div>
    </div>`;
  }

  function tileDanger(D) {
    const F = facts(D);
    const list = F.G.slice(0, 7).map((g) => `<div class="rm-li rm-mono">
        <span><a class="rm-tok" href="/token/${g.tokenId}">${logo(g.tokenId)}<span>${g.name}</span></a>${g.boxes > 1 ? `<span class="rm-x">×${g.boxes}</span>` : ""}</span>
        <span class="c-usd">${usd(g.usd)}</span>
        <span class="c-when${g.soon <= 720 ? " is-soon" : ""}">${when(g.soon)}</span></div>`).join("");
    return `<div class="rm rm-v3b">
      <div class="rm-head">${tag("Токены под угрозой")}<span class="rm-sub rm-mono">7 дней</span></div>
      <div><div class="rm-big is-usd">≈ ${usd(F.total)}</div>
        <div class="rm-sub" style="margin-top:5px">в ${boxesIn(D.danger.length)} ERG меньше ренты — майнер может забрать их целиком, с токенами</div></div>
      <div class="rm-list" style="margin-top:2px">
        <div class="rm-li rm-mono rm-sub" style="height:18px"><span>Токен</span><span class="c-usd" style="color:var(--muted-2)">≈ $</span><span class="c-when" style="color:var(--muted-2)">через</span></div>
        ${list}</div>
      <div class="rm-foot" style="margin-top:auto"><a href="/rent">Все ${boxes(D.danger.length)} →</a></div>
    </div>`;
  }

  window.__rentMock = (v, D) => {
    if (!document.getElementById("rm-css")) {
      const s = document.createElement("style");
      s.id = "rm-css";
      s.textContent = css;
      document.head.appendChild(s);
    }
    const h = [...document.querySelectorAll("main h2")].find((e) => /Рента хранения|Storage rent/.test(e.textContent));
    const art = h && h.closest("article");
    if (!art) return "no tile";
    const belt = art.querySelector("canvas")?.parentElement;
    const inner = art.firstElementChild;
    inner.style.display = "none";
    const host = document.createElement("div");
    host.style.cssText = "height:100%;min-height:0;display:flex;flex-direction:column";
    if (v === "v3") {
      const sec = art.parentElement;
      sec.classList.add("rm-two");
      const art2 = document.createElement("article");
      art2.className = art.className;
      art2.style.setProperty("--tag", "var(--c-token)");
      art2.innerHTML = tileDanger(D);
      sec.appendChild(art2);
      host.innerHTML = tileRent(D);
    } else {
      host.innerHTML = v === "v1" ? v1(D) : v2(D);
    }
    art.appendChild(host);
    const slot = host.querySelector("[data-slot=belt]");
    if (belt && slot) slot.appendChild(belt);
    if (v === "v2") requestAnimationFrame(() => drawAxis(host, D));
    return "ok";
  };
})();
