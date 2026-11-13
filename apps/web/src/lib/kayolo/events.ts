/**
 * Kayolo's bus (design/brand/kayolo-life.md §9.2): a window event `kayolo` whose detail is a
 * KayoloEvent. Only what is live today is in the union; later stages add to it.
 */

/** E20 kinds (§8.2). Э0 celebrates only "10k". */
export type RareKind = "10k" | "100k" | "emission-step" | "emission-end";

/** Where the body is when Kayolo holds it: his niche, the phone park, the address door, a note. */
export type BodyWhere = "nook" | "park" | "door" | "note";

export type KayoloEvent =
  | { k: "chain:rare"; height: number; what: RareKind }
  /** E1–E3: one per height (seal and tip merged). txCount is null when only the tip came. */
  | { k: "chain:block"; height: number; txCount: number | null; size: number | null; kind: "empty" | "normal" | "big" }
  /** The header scout gave him the body (M1, §9.8). */
  | { k: "kayolo:took"; where: BodyWhere }
  /** He gave the body back to the header scout, from this point. */
  | { k: "kayolo:release"; x: number; y: number; face: 1 | -1; where: BodyWhere }
  /** His window while he is away: call him home. */
  | { k: "kayolo:call-home" }
  /** A click, a tap or Enter on his window. */
  | { k: "ui:poke" }
  /** The pointer rests on his window (250 ms), or it has focus. */
  | { k: "ui:notice"; on: boolean };

export const KAYOLO_EVENT = "kayolo";

/** Tells whoever draws him. Does nothing on the server and never throws. */
export function say(ev: KayoloEvent): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(KAYOLO_EVENT, { detail: ev }));
  } catch {
    /* a listener failed or CustomEvent is missing: the page goes on */
  }
}

/** Listens to the bus. Returns the cleanup. */
export function onKayolo(fn: (ev: KayoloEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (e: Event) => {
    const d = (e as CustomEvent<unknown>).detail as Partial<KayoloEvent> | null;
    if (d && typeof d === "object" && typeof d.k === "string") fn(d as KayoloEvent);
  };
  window.addEventListener(KAYOLO_EVENT, handle);
  return () => window.removeEventListener(KAYOLO_EVENT, handle);
}
