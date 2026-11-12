/*
 * Seam prototype (design only, injected into a page in a headless browser).
 * Marks the stuck list plate and hands CSS the numbers a variant needs:
 *   html[data-seam="a|b|c"]      which variant is on
 *   html[data-plate-stuck]       some list plate is pinned under the header
 *   .feed-plate[data-stuck]      this plate is pinned
 *   --seam-ink                   entity colour of the page (block / tx / token / addr)
 *   --seam-pin                   where the plate pins (px from the viewport top)
 *   --seam-p                     0…1 how far the plate has travelled through its card
 *   --dock-l / --dock-r          card inset against the header (to dock at header width)
 * In the product this is the one plate observer the lists work owns.
 */
(() => {
  const root = document.documentElement;
  const variant = window.__seam || "";
  const css = window.__seamCss || "";
  const gap = window.__seamGap ?? 10;
  const path = location.pathname;
  const ink = path.startsWith("/transactions")
    ? "tx"
    : path.startsWith("/tokens")
      ? "token"
      : path.startsWith("/address")
        ? "addr"
        : "block";
  root.style.setProperty("--seam-ink", `var(--c-${ink})`);
  if (variant) root.dataset.seam = variant;
  if (css) {
    const st = document.createElement("style");
    st.id = "seam-proto";
    st.textContent = css;
    document.head.append(st);
  }
  const header = document.querySelector(".stage-col > header.sticky");
  const phone = () => innerWidth < 1024;
  // The visible bar: the header itself on desktop, the pill inside it on a phone.
  const bar = () => {
    if (!header || !phone()) return header;
    return header.querySelector(".phone-toolbar") || header;
  };
  let barEl = null;
  const tick = () => {
    if (!barEl || !barEl.isConnected) barEl = bar();
    if (barEl) {
      barEl.dataset.seamBar = "";
      const hb = barEl.getBoundingClientRect();
      const hh = header.getBoundingClientRect();
      // Variant b docks flush to the bar; a and c leave a black gutter.
      const flush = variant === "b";
      const pin = phone() ? (flush ? hb.bottom : hh.bottom) : flush ? hb.bottom : hb.bottom + gap;
      root.style.setProperty("--seam-pin", `${Math.round(pin)}px`);
      root.style.setProperty("--seam-bar-gap", `${Math.max(0, hh.bottom - hb.bottom)}px`);
      root.style.setProperty("--seam-bar-l", `${hb.left}px`);
      root.style.setProperty("--seam-bar-r", `${innerWidth - hb.right}px`);
    }
    let any = false;
    for (const p of document.querySelectorAll(".feed-plate")) {
      const pinTop = parseFloat(getComputedStyle(p).top) || 0;
      const r = p.getBoundingClientRect();
      const card = p.closest(".feed-day") || p.parentElement;
      const cr = card.getBoundingClientRect();
      const stuck = scrollY > 2 && r.top <= pinTop + 0.75 && cr.bottom > r.bottom + 4;
      if (stuck) {
        any = true;
        p.dataset.stuck = "";
      } else delete p.dataset.stuck;
      const travel = Math.max(1, cr.height - r.height);
      p.style.setProperty("--seam-p", Math.max(0, Math.min(1, (r.top - cr.top) / travel)).toFixed(4));
      if (barEl) {
        const hb = barEl.getBoundingClientRect();
        p.style.setProperty("--dock-l", `${Math.max(0, cr.left - hb.left)}px`);
        p.style.setProperty("--dock-r", `${Math.max(0, hb.right - cr.right)}px`);
      }
    }
    if (any) root.dataset.plateStuck = "";
    else delete root.dataset.plateStuck;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
