"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { parseSkinFloat, type SkinFloat } from "@/lib/skin-float";
import { applyInk, followInk, isInkChoice, readInkChoice, type InkChoice } from "@/lib/skin-ink";

export const SKIN_FACES = ["t0", "t1", "t2"] as const;
export const SKIN_STAMPS = ["corner", "old", "rail"] as const;

export type SkinFace = (typeof SKIN_FACES)[number];
export type SkinStamp = (typeof SKIN_STAMPS)[number];

export function parseSkinFace(v: string | null | undefined): SkinFace {
  return v === "t0" || v === "t2" || v === "t1" ? v : "t1";
}

export function parseSkinStamp(v: string | null | undefined): SkinStamp {
  return v === "old" || v === "corner" || v === "rail" ? v : "rail";
}

function applySkin(face: SkinFace, stamp: SkinStamp, float: SkinFloat, ink: InkChoice, keepInk: boolean) {
  const root = document.documentElement;
  root.dataset.face = face;
  root.dataset.stamp = stamp;
  root.dataset.float = float;
  applyInk(ink, keepInk);
}

function readSkin(search: { get: (k: string) => string | null }): {
  face: SkinFace;
  stamp: SkinStamp;
  float: SkinFloat;
  ink: InkChoice;
  keepInk: boolean;
} {
  const faceQ = search.get("face");
  const stampQ = search.get("stamp");
  const floatQ = search.get("float");
  const inkQ = search.get("ink");
  let face = parseSkinFace(faceQ);
  let stamp = parseSkinStamp(stampQ);
  let float = parseSkinFloat(floatQ);
  // `?ink=` paints this page; only a choice the site knows is kept (an old `?ink=day` link stays dark
  // and leaves the reader's own choice alone).
  const asked = isInkChoice(inkQ);
  const ink: InkChoice = asked ? inkQ : inkQ ? "oled" : readInkChoice();
  try {
    if (!faceQ) face = parseSkinFace(sessionStorage.getItem("lumen.face"));
    else sessionStorage.setItem("lumen.face", face);
    if (!stampQ) stamp = parseSkinStamp(sessionStorage.getItem("lumen.stamp.v2"));
    else sessionStorage.setItem("lumen.stamp.v2", stamp);
    if (floatQ === "off" || floatQ === "ada") {
      sessionStorage.setItem("lumen.float", floatQ);
      float = floatQ;
    } else {
      const stored = sessionStorage.getItem("lumen.float");
      if (stored === "off" || stored === "ada") float = stored;
    }
  } catch {
    /* */
  }
  return { face, stamp, float, ink, keepInk: asked };
}

/** Optional `?face=` / `?stamp=` / `?float=` / `?ink=`. Default T1 + rail + AdaStat + the dark ink. */
export function SkinSwitch() {
  const path = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const next = readSkin(search);
    applySkin(next.face, next.stamp, next.float, next.ink, next.keepInk);
  }, [path, search]);

  useEffect(() => followInk(), []);

  return null;
}
