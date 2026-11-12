/** Explorer inks: Paper / Epoch / Lykos. Same hue family as OLED A — not a white/black invert. */

import { LOOK_BG, currentLook } from "./look";

export const SKIN_INKS = ["day", "dim", "oled"] as const;
export type SkinInk = (typeof SKIN_INKS)[number];

export const INK_STORAGE = "ergoscan.ink";
export const INK_EVENT = "ergoscan-ink";

/** Canvas (`--bg`) + theme-color. */
export const INK_BG: Record<SkinInk, string> = {
  day: "#eceaf0",
  dim: "#2e2d35",
  oled: "#1c1b22",
};

/** Paper module — swatch chip on the picker. */
export const INK_MODULE: Record<SkinInk, string> = {
  day: "#ffffff",
  dim: "#35343d",
  oled: "#26252d",
};

export function parseSkinInk(v: string | null | undefined): SkinInk {
  return v === "day" || v === "dim" || v === "oled" ? v : "oled";
}

export function colorSchemeFor(ink: SkinInk): "light" | "dark" {
  return ink === "day" ? "light" : "dark";
}

/**
 * Inline head script — paint the chosen ink before React. Keep in lockstep with applyInk.
 * Under the site look (`data-look`) the ink is always OLED and the bar takes the look's black.
 */
export const INK_BOOT = `(function(){try{var r=document.documentElement;var look=r.hasAttribute("data-look");var q=new URLSearchParams(location.search).get("ink");var v=look?"oled":q||localStorage.getItem("${INK_STORAGE}")||"oled";if(v!=="day"&&v!=="dim"&&v!=="oled")v="oled";r.setAttribute("data-ink",v);r.classList.toggle("dark",v!=="day");r.style.colorScheme=v==="day"?"light":"dark";var bg=look?"${LOOK_BG}":{day:"${INK_BG.day}",dim:"${INK_BG.dim}",oled:"${INK_BG.oled}"}[v];var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",bg);}catch(e){}})();`;

export function applyInk(ink: SkinInk, persist = true): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const look = currentLook();
  if (look) {
    ink = "oled";
    persist = false;
  }
  root.dataset.ink = ink;
  root.classList.toggle("dark", ink !== "day");
  root.style.colorScheme = colorSchemeFor(ink);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", look ? LOOK_BG : INK_BG[ink]);
  if (persist) {
    try {
      localStorage.setItem(INK_STORAGE, ink);
    } catch {
      /* */
    }
  }
  window.dispatchEvent(new Event(INK_EVENT));
}

export function readStoredInk(): SkinInk {
  try {
    return parseSkinInk(localStorage.getItem(INK_STORAGE));
  } catch {
    return "oled";
  }
}

export function readDocumentInk(): SkinInk {
  if (typeof document === "undefined") return "oled";
  return parseSkinInk(document.documentElement.dataset.ink);
}
