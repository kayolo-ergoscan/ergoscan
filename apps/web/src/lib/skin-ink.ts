/**
 * Site theme: the dark «Сигнал» ink (`data-ink="oled"`, the default) or its light twin «Сумерки»
 * (`data-ink="light"`, light.css). The reader picks Dark, Light or «as the system» in Settings; the
 * choice lives in localStorage and a head script paints it before the first frame.
 */

import { LOOK_BG } from "./look";

export const SKIN_INKS = ["oled", "light"] as const;
export type SkinInk = (typeof SKIN_INKS)[number];

/** What the reader chose. «system» follows the OS and changes with it. */
export const INK_CHOICES = ["oled", "light", "system"] as const;
export type InkChoice = (typeof INK_CHOICES)[number];

export const INK_STORAGE = "ergoscan.ink";
export const INK_EVENT = "ergoscan-ink";
/** A choice was made (also in another tab): Settings re-reads it. */
export const INK_CHOICE_EVENT = "ergoscan-ink-choice";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Page ground of each ink: theme-color and the first frame. */
export const INK_BG: Record<SkinInk, string> = {
  oled: LOOK_BG,
  light: "#c3c2c0",
};

export function isLightInk(v: string | null | undefined): boolean {
  return v === "light";
}

export function parseSkinInk(v: string | null | undefined): SkinInk {
  return v === "light" ? "light" : "oled";
}

/** Old stored values (day, dim) came from inks the site no longer has: they read as the default. */
export function parseInkChoice(v: string | null | undefined): InkChoice {
  return v === "light" || v === "system" ? v : "oled";
}

/** A choice the site knows. An unknown `?ink=` (an old `?ink=day` link) is not one: it is never kept. */
export function isInkChoice(v: string | null | undefined): v is InkChoice {
  return v === "oled" || v === "light" || v === "system";
}

export function colorSchemeFor(ink: SkinInk): "light" | "dark" {
  return ink === "light" ? "light" : "dark";
}

function systemLight(): boolean {
  try {
    return window.matchMedia(LIGHT_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveInk(choice: InkChoice): SkinInk {
  if (choice === "system") return systemLight() ? "light" : "oled";
  return choice;
}

/**
 * Inline head script: paint the chosen ink before the first frame. Keep in lockstep with paintInk.
 * The metas may come later in the document, so they are set again once it is parsed.
 * `?ink=` (oled, light, system) is taken and kept, so a link can open the site in a theme; an unknown
 * value paints the default and is not kept. It paints first and stores after: a storage that throws
 * (blocked, private mode) never costs the page its ink.
 */
export const INK_BOOT = `(function(){var r=document.documentElement,q=null,s=null;try{q=new URLSearchParams(location.search).get("ink")}catch(e){}var k=q==="oled"||q==="light"||q==="system";if(!q)try{s=localStorage.getItem("${INK_STORAGE}")}catch(e){}var c=k?q:q?"oled":s;if(c!=="light"&&c!=="system")c="oled";try{var v=c==="system"?(matchMedia("${LIGHT_QUERY}").matches?"light":"oled"):c;var l=v==="light";r.setAttribute("data-ink",v);r.classList.toggle("dark",!l);r.style.colorScheme=l?"light":"dark";var bg=l?"${INK_BG.light}":"${INK_BG.oled}";var m=function(){document.querySelectorAll('meta[name="theme-color"]').forEach(function(t){t.setAttribute("content",bg)});document.querySelectorAll('meta[name="color-scheme"]').forEach(function(t){t.setAttribute("content",l?"light":"dark")})};m();document.addEventListener("DOMContentLoaded",m)}catch(e){}if(k)try{localStorage.setItem("${INK_STORAGE}",q)}catch(e){}})();`;

/** Paint an ink. The event goes out on every call (SkinSwitch calls on each page): listeners re-read. */
function paintInk(ink: SkinInk): void {
  const root = document.documentElement;
  root.dataset.ink = ink;
  root.classList.toggle("dark", ink !== "light");
  root.style.colorScheme = colorSchemeFor(ink);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", INK_BG[ink]));
  document.querySelectorAll('meta[name="color-scheme"]').forEach((m) => m.setAttribute("content", colorSchemeFor(ink)));
  window.dispatchEvent(new Event(INK_EVENT));
}

/** Apply a choice now (and keep it). */
export function applyInk(choice: InkChoice, persist = true): void {
  if (typeof document === "undefined") return;
  if (persist) {
    try {
      localStorage.setItem(INK_STORAGE, choice);
    } catch {
      /* */
    }
  }
  paintInk(resolveInk(choice));
  window.dispatchEvent(new Event(INK_CHOICE_EVENT));
}

export function readInkChoice(): InkChoice {
  try {
    return parseInkChoice(localStorage.getItem(INK_STORAGE));
  } catch {
    return "oled";
  }
}

export function readDocumentInk(): SkinInk {
  if (typeof document === "undefined") return "oled";
  return parseSkinInk(document.documentElement.dataset.ink);
}

/**
 * Keep the page on the stored choice: the OS turning light or dark («system»), and a choice made in
 * another tab. Returns the unsubscribe.
 */
export function followInk(): () => void {
  const mq = window.matchMedia(LIGHT_QUERY);
  const onOs = () => {
    if (readInkChoice() === "system") paintInk(resolveInk("system"));
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== INK_STORAGE) return;
    paintInk(resolveInk(readInkChoice()));
    window.dispatchEvent(new Event(INK_CHOICE_EVENT));
  };
  mq.addEventListener("change", onOs);
  window.addEventListener("storage", onStorage);
  return () => {
    mq.removeEventListener("change", onOs);
    window.removeEventListener("storage", onStorage);
  };
}
