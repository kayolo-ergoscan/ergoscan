/** Explorer inks: Paper / Epoch / Lykos. Same hue family as OLED A — not a white/black invert. */

import { LOOK_BG, currentLook } from "./look";

export const SKIN_INKS = ["day", "dim", "oled"] as const;

/**
 * Neutral light inks under the site look (prototype, `?ink=light-a|light-b|light-c`): A «Бумага»,
 * B «Камень», C «Сумерки». Only a build with NEXT_PUBLIC_INK_PREVIEW=1 takes them; the live site
 * stays on the look's OLED until the operator picks one.
 */
export const LIGHT_INKS = ["light-a", "light-b", "light-c"] as const;
export type LightInk = (typeof LIGHT_INKS)[number];
export type SkinInk = (typeof SKIN_INKS)[number] | LightInk;

export const INK_PREVIEW = process.env.NEXT_PUBLIC_INK_PREVIEW === "1";

export function isLightInk(v: string | null | undefined): boolean {
  return v === "day" || (typeof v === "string" && (LIGHT_INKS as readonly string[]).includes(v));
}

export const INK_STORAGE = "ergoscan.ink";
export const INK_EVENT = "ergoscan-ink";

/** Canvas (`--bg`) + theme-color. */
export const INK_BG: Record<SkinInk, string> = {
  day: "#eceaf0",
  dim: "#2e2d35",
  oled: "#1c1b22",
  "light-a": "#e3dfda",
  "light-b": "#d3d8dd",
  "light-c": "#c3c2c0",
};

/** Paper module — swatch chip on the picker. */
export const INK_MODULE: Record<SkinInk, string> = {
  day: "#ffffff",
  dim: "#35343d",
  oled: "#26252d",
  "light-a": "#f2efe9",
  "light-b": "#e4e9ee",
  "light-c": "#d4d3d1",
};

export function parseSkinInk(v: string | null | undefined): SkinInk {
  if (INK_PREVIEW && (LIGHT_INKS as readonly string[]).includes(v ?? "")) return v as LightInk;
  return v === "day" || v === "dim" || v === "oled" ? v : "oled";
}

export function colorSchemeFor(ink: SkinInk): "light" | "dark" {
  return isLightInk(ink) ? "light" : "dark";
}

/**
 * Inline head script — paint the chosen ink before React. Keep in lockstep with applyInk.
 * Under the site look (`data-look`) the ink is always OLED and the bar takes the look's black.
 */
export const INK_BOOT = INK_PREVIEW
  ? `(function(){try{var r=document.documentElement;var look=r.hasAttribute("data-look");var L=${JSON.stringify(LIGHT_INKS)};var q=new URLSearchParams(location.search).get("ink");var s=localStorage.getItem("${INK_STORAGE}");var v=q||s||"oled";var lt=L.indexOf(v)>=0;if(look&&!lt)v="oled";if(!lt&&v!=="day"&&v!=="dim"&&v!=="oled")v="oled";var light=v==="day"||lt;r.setAttribute("data-ink",v);r.classList.toggle("dark",!light);r.style.colorScheme=light?"light":"dark";var bg=${JSON.stringify(INK_BG)}[v];if(look&&!lt)bg="${LOOK_BG}";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",bg);}catch(e){}})();`
  : `(function(){try{var r=document.documentElement;var look=r.hasAttribute("data-look");var q=new URLSearchParams(location.search).get("ink");var v=look?"oled":q||localStorage.getItem("${INK_STORAGE}")||"oled";if(v!=="day"&&v!=="dim"&&v!=="oled")v="oled";r.setAttribute("data-ink",v);r.classList.toggle("dark",v!=="day");r.style.colorScheme=v==="day"?"light":"dark";var bg=look?"${LOOK_BG}":{day:"${INK_BG.day}",dim:"${INK_BG.dim}",oled:"${INK_BG.oled}"}[v];var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",bg);}catch(e){}})();`;

export function applyInk(ink: SkinInk, persist = true): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const look = currentLook();
  const lightPreview = INK_PREVIEW && (LIGHT_INKS as readonly string[]).includes(ink);
  if (look && !lightPreview) {
    ink = "oled";
    persist = false;
  }
  root.dataset.ink = ink;
  root.classList.toggle("dark", !isLightInk(ink));
  root.style.colorScheme = colorSchemeFor(ink);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", look && !lightPreview ? LOOK_BG : INK_BG[ink]);
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
