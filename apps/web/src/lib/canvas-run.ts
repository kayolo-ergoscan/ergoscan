/**
 * Shared rules for the always-moving canvases (live-blocks crates, the network
 * globe): sharpness capped on phones, and no frames while nobody can see them.
 */

let phoneMq: MediaQueryList | null = null;

/** Device pixel ratio for a canvas: at most 2, and at most 1.5 at ≤767 px. */
export function canvasDpr(): number {
  const raw = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  if (typeof window === "undefined") return Math.min(raw, 2);
  phoneMq ??= window.matchMedia("(max-width: 767px)");
  return Math.min(raw, phoneMq.matches ? 1.5 : 2);
}

/**
 * Calls `onChange(true)` while at least 10 % of `el` is on screen and the tab
 * is visible, `onChange(false)` otherwise. Starts as visible, so the first
 * frame is drawn before the observer reports. Returns the cleanup.
 */
export function watchOnScreen(el: Element, onChange: (on: boolean) => void): () => void {
  let seen = true;
  let last: boolean | null = null;
  const emit = () => {
    const on = seen && document.visibilityState === "visible";
    if (on === last) return;
    last = on;
    onChange(on);
  };
  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            const e = entries[entries.length - 1];
            if (!e) return;
            seen = e.isIntersecting && e.intersectionRatio >= 0.1;
            emit();
          },
          { threshold: [0, 0.1, 0.2] }
        );
  io?.observe(el);
  document.addEventListener("visibilitychange", emit);
  emit();
  return () => {
    io?.disconnect();
    document.removeEventListener("visibilitychange", emit);
  };
}
