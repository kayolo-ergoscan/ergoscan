/**
 * Which Э4 beat and background the city Kayolo shows on home (design/brand/kayolo-life.md §8.3,
 * §2.4). Pure, for the tests. The city keeps E1–E4 (its seal moment), E7 (its doze at 8 min) and E20
 * (rare heights); here are the rest. «Тихий» keeps the looks and drops the hops.
 */
import type { KayoloEvent } from "@/lib/kayolo/events";
import type { NetState } from "@/lib/kayolo/chain-sense";
import { DOWN_DOZE_MS, REJOIN_MS } from "@/lib/kayolo/thresholds";
import type { CityBeatKind, CityBg } from "./beats";

export type HomeChainState = { net: NetState; downAt: number | null; behind: boolean; wait: 0 | 1 | 2 | 3 };

export type HomeBeat = { kind: CityBeatKind; to: "tip" | "yard" | "price" | "epoch" | null };

const LOOKS = new Set<CityBeatKind>(["look-tip", "look", "price", "nod", "tilt-tail", "surge"]);

export function homeBeat(ev: KayoloEvent, o: { calm: boolean; epochShown: boolean }): HomeBeat | null {
  let b: HomeBeat | null = null;
  switch (ev.k) {
    case "chain:tip-wait":
      b = ev.level === 1 ? { kind: "look-tip", to: "tip" } : ev.level === 2 ? { kind: "tilt-tail", to: null } : null;
      break;
    case "chain:fee":
      b = ev.state === "spike" ? { kind: "fee", to: "yard" } : null;
      break;
    case "chain:pool":
      b = ev.state === "surge" ? { kind: "surge", to: "yard" } : null;
      break;
    case "price:move":
      b = { kind: "price", to: "price" };
      break;
    case "net:state":
      if (ev.state === "live" && ev.cheer) b = ev.flapping || ev.downMs <= REJOIN_MS ? { kind: "nod", to: null } : { kind: "rejoin", to: "tip" };
      break;
    case "chain:epoch":
      b = o.epochShown ? { kind: "epoch", to: "epoch" } : null;
      break;
    default:
      return null;
  }
  if (!b) return null;
  if (o.calm && !LOOKS.has(b.kind)) return b.kind === "rejoin" ? { kind: "nod", to: null } : { kind: "look", to: b.to };
  return b;
}

/** The background by importance: offline / the feed down (≥ 60 s: dozing; lost: none) → behind / waiting → none. */
export function homeBg(s: HomeChainState, now: number): CityBg {
  if (s.net === "offline") return "sit";
  if (s.net === "down") return s.downAt != null && now - s.downAt >= DOWN_DOZE_MS ? "sit-doze" : "sit";
  if (s.behind) return "think";
  // ≥ 3× the average: a still think; ≥ 8 min the city's own doze takes over.
  if (s.wait === 2) return "think";
  return null;
}
