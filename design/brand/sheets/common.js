// Shared helpers for the brand sheets (rendered by headless chromium).
window.H = (() => {
  const B = window.BRAND;
  const url = (svg) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  let pending = 0;
  const done = () => {
    if (--pending === 0) document.title = "ready";
  };
  // true-pixel preview: rasterise at `px`, then scale with nearest neighbour
  function pix(svg, px, scale, bg) {
    const c = document.createElement("canvas");
    c.width = px * scale;
    c.height = px * scale;
    c.style.width = px * scale + "px";
    c.style.height = px * scale + "px";
    c.style.imageRendering = "pixelated";
    pending++;
    const img = new Image();
    img.onload = () => {
      const s = document.createElement("canvas");
      s.width = px;
      s.height = px;
      const g = s.getContext("2d");
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, px, px);
      }
      g.drawImage(img, 0, 0, px, px);
      const x = c.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.drawImage(s, 0, 0, px * scale, px * scale);
      done();
    };
    img.src = url(svg);
    return c;
  }
  // real-size raster (what a browser tab shows)
  function img(svg, px) {
    const i = new Image();
    i.src = url(svg);
    i.width = px;
    i.height = px;
    return i;
  }
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  }
  const raw = (svg, px) => {
    const d = document.createElement("span");
    d.innerHTML = svg;
    const s = d.firstChild;
    s.setAttribute("width", px);
    s.setAttribute("height", px);
    s.style.display = "block";
    return s;
  };
  const q = new URLSearchParams(location.search);
  return { B, url, pix, img, el, raw, q };
})();
