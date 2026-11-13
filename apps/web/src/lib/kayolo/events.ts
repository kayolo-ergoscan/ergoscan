/**
 * Kayolo's bus (design/brand/kayolo-life.md §9.2): a window event `kayolo` whose detail is a
 * KayoloEvent. Only what is live today is in the union; later stages add to it. Sources only tell;
 * none of them waits for him, and nothing on the page changes when nobody listens.
 */

/** E20 kinds (§8.2). Э0 celebrates only "10k". */
export type RareKind = "10k" | "100k" | "emission-step" | "emission-end";

/**
 * Where the body is when Kayolo holds it: his niche, the phone park, the address door, a note, the
 * palette edge (§3.3; the layer only, never handed to the scout).
 */
export type BodyWhere = "nook" | "park" | "door" | "note" | "edge";

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
  | { k: "ui:notice"; on: boolean }
  /** «Погладить» in his panel. */
  | { k: "ui:pet" }
  /** The introduction is over; `tour`: it ran to the end, so the tour follows. */
  | { k: "kayolo:intro-done"; tour: boolean }
  /* ---- Э3: what the person does on the page (§6.2, §9.2). `el` is the control, read once. ---- */
  /** Text went to the clipboard (a copy button, Ctrl+C) / the clipboard refused it. */
  | { k: "ui:copy"; el?: Element | null }
  | { k: "ui:copy-fail"; el?: Element | null }
  /** A heart: saved / taken off. */
  | { k: "ui:fav-on"; el?: Element | null }
  | { k: "ui:fav-off"; el?: Element | null }
  /** A tab, a sort chip, a filter chip. */
  | { k: "ui:tab"; el?: Element | null }
  | { k: "ui:sort"; el?: Element | null; dir?: "asc" | "desc" }
  | { k: "ui:filter"; el?: Element | null }
  /** RankWindow: «Показать ещё» (more) or a step ‹ ›. */
  | { k: "ui:page"; el?: Element | null; step: "more" | "prev" | "next" }
  /** A list row opened or closed (desktop). */
  | { k: "ui:expand"; el?: Element | null; open: boolean }
  /** The search: open, typing (the field), hits (the list), no matches, a paste (found or not), closed. */
  | { k: "ui:search-open"; el?: Element | null }
  | { k: "ui:search-type"; el?: Element | null }
  | { k: "ui:search-hits"; el?: Element | null }
  | { k: "ui:search-miss"; el?: Element | null; q: string }
  | { k: "ui:search-paste"; ok: boolean; el?: Element | null }
  | { k: "ui:search-close" }
  /** A phone sheet (MoreSheet, PriceSheet, …). */
  | { k: "ui:sheet-open"; el?: Element | null }
  | { k: "ui:sheet-close" }
  /** The site's one Tip: shown over `el` (or a rect), or gone. */
  | { k: "ui:tip-open"; el?: Element | null; rect?: { left: number; top: number; width: number; height: number } }
  | { k: "ui:tip-close" }
  /** An in-page wait (the first pack of an address tab). */
  | { k: "ui:wait"; on: boolean }
  /* ---- Э3: transitions (§7.1, §7.2) ---- */
  /** A route navigation is pending (the old page stays until the new one is ready). */
  | { k: "nav:start"; to: string }
  /** The pending navigation ended: arrived, or given up after 15 s (`ok` false). */
  | { k: "nav:end"; ok: boolean }
  /** A click on a link: `go` leaves, `here` is the same URL, `aside` opens elsewhere (Ctrl/Cmd/middle). */
  | { k: "nav:click"; kind: "go" | "here" | "aside"; el?: Element | null; hop?: -1 | 1 }
  /**
   * Back (−1) or Forward (+1) to another URL (`to`, a locKey); `seen`: that page was already shown
   * in this session. The arrival counts it only when it lands on `to` (a sheet's own history entry
   * pops too, and a query the router replaced is not on the trail).
   */
  | { k: "nav:pop"; dir: -1 | 1; seen: boolean; to: string };

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
