/**
 * What a click on a link or a history step means for Kayolo (design/brand/kayolo-life.md §7.2):
 *
 * - `go`: an internal link to another URL (the arrival act follows);
 * - `here`: the URL already open (Next does nothing, so nothing else would answer): «уже здесь»;
 * - `aside`: Ctrl/Cmd/Shift or the middle button, or `target=_blank`: the page opens elsewhere, he
 *   looks at the link and up toward the tabs;
 * - Back/Forward (`popstate` to another URL): which way, and whether that page was already seen.
 *
 * The classifiers and the trail are pure (tests drive them); `startNavSense` only listens, passive,
 * and never prevents anything: every click still reaches its link.
 */

import { locKey, parseInternalHref } from "@/lib/route-nav";
import { say } from "./events";

export type ClickKind = "go" | "here" | "aside";

export type ClickInput = {
  button: number;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /**
   * Already prevented when it is first heard. At window capture that is rare (Next's <Link> prevents
   * later, in its own handler); a click swallowed later is caught by the end-of-dispatch check.
   */
  prevented: boolean;
  href: string | null;
  target: string | null;
  download: boolean;
};

export type Here = { origin: string; path: string; search: string; hash: string };

/** What a click on a link means, or null for nothing to answer (a hash jump, alt-click, mailto…). */
export function clickKind(c: ClickInput, here: Here): ClickKind | null {
  if (!c.href || c.download || c.alt) return null;
  if (c.button !== 0 && c.button !== 1) return null;
  const to = parseInternalHref(c.href, here.origin);
  const external = !to && /^https?:/i.test(c.href.trim());
  if (!to && !external) return null;
  if (c.button === 1 || c.ctrl || c.meta || c.shift || (c.target != null && c.target !== "" && c.target !== "_self")) return "aside";
  if (external) return null;
  if (c.prevented) return null;
  if (!to) return null;
  if (locKey(to.path, to.search) !== locKey(here.path, here.search)) return "go";
  // Only the hash differs: an in-page jump, not «already here».
  if (to.hash && to.hash !== here.hash) return null;
  return "here";
}

/**
 * The tab's own trail of URLs (Next keeps no index in history.state): pushes cut the forward part,
 * a pop moves along it. A pop to a URL that is not next to us looks for it on either side; not found
 * at all counts as Back (the common case after a reload).
 */
export function createTrail(start: string) {
  let stack = [start];
  let pos = 0;
  const seen = new Set<string>([start]);
  return {
    /** A new URL opened by a link or a push (the same URL again changes nothing). */
    push(key: string) {
      if (stack[pos] === key) return;
      stack = stack.slice(0, pos + 1);
      stack.push(key);
      if (stack.length > 64) stack.shift();
      pos = stack.length - 1;
      seen.add(key);
    },
    /** History moved to `key`. Null when it did not leave the URL (a sheet's entry, a hash). */
    pop(key: string): { dir: -1 | 1; seen: boolean } | null {
      if (stack[pos] === key) return null;
      const was = seen.has(key);
      let dir: -1 | 1 = -1;
      if (stack[pos - 1] === key) pos -= 1;
      else if (stack[pos + 1] === key) {
        pos += 1;
        dir = 1;
      } else {
        // lastIndexOf(key, -1) would search the whole trail: at the start nothing is behind.
        const back = pos > 0 ? stack.lastIndexOf(key, pos - 1) : -1;
        const fwd = stack.indexOf(key, pos + 1);
        if (fwd > pos && (back < 0 || fwd - pos < pos - back)) {
          pos = fwd;
          dir = 1;
        } else if (back >= 0) pos = back;
        else {
          // Unknown (after a reload): Back, and the trail starts again here.
          stack = [key];
          pos = 0;
        }
      }
      seen.add(key);
      return { dir, seen: was };
    },
    current() {
      return stack[pos];
    },
  };
}

export type Trail = ReturnType<typeof createTrail>;

const hereNow = (): Here => ({
  origin: window.location.origin,
  path: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
});

/** HopNav's neighbour links: a side step, not a full arrival (§7.2). */
function hopOf(a: Element): -1 | 1 | undefined {
  if (!a.classList.contains("block-hop")) return undefined;
  const d = a.getAttribute("data-dir");
  return d === "back" ? -1 : d === "fwd" ? 1 : undefined;
}

/**
 * Listens for link clicks (capture, passive) and history steps, and tells the bus. `note(key)` is
 * called by the layer after every arrival (2 rAF later, so a `popstate` has been seen first), so
 * pushes made by the router are on the trail too.
 */
export function startNavSense(): { note(key: string): void; stop(): void } {
  const here = () => locKey(window.location.pathname, window.location.search);
  const trail = createTrail(here());
  /** A «here» or «aside» click waits for the end of its own dispatch (see onClickEnd). */
  let held: { e: MouseEvent; a: Element; kind: ClickKind } | null = null;
  const onClick = (e: MouseEvent) => {
    held = null;
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a) return;
    const kind = clickKind(
      {
        button: e.button,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        prevented: e.defaultPrevented,
        href: a.getAttribute("href"),
        target: a.getAttribute("target"),
        download: a.hasAttribute("download"),
      },
      hereNow()
    );
    if (!kind) return;
    // «go» is told at once: the route progress says nav:start inside this same dispatch, and a
    // swallowed «go» costs nothing (no navigation follows, so no lean and no arrival).
    if (kind === "go") say({ k: "nav:click", kind, el: a, hop: hopOf(a) });
    else held = { e, a, kind };
  };
  /**
   * The click's last stop (window, bubble): it got through. A handler that swallowed it (a Tip that
   * shows itself on the first tap stops it in capture) never lets it reach here, so «уже здесь» and
   * «aside» are not played for a click that did nothing. (defaultPrevented cannot tell: Next's
   * <Link> prevents every click it routes.)
   */
  const onClickEnd = (e: MouseEvent) => {
    const h = held;
    held = null;
    if (!h || h.e !== e) return;
    say({ k: "nav:click", kind: h.kind, el: h.a });
  };
  const onPop = () => {
    const to = here();
    const step = trail.pop(to);
    if (step) say({ k: "nav:pop", dir: step.dir, seen: step.seen, to });
  };
  // Window capture, the first stop of the click: Next's <Link> prevents the default in its own handler
  // (it routes itself), so by the bubble phase every internal link looks prevented; and the route
  // progress (document capture) says `nav:start` from its listener, which must come after this one.
  window.addEventListener("click", onClick, { passive: true, capture: true });
  window.addEventListener("auxclick", onClick, { passive: true, capture: true });
  window.addEventListener("click", onClickEnd, { passive: true });
  window.addEventListener("auxclick", onClickEnd, { passive: true });
  window.addEventListener("popstate", onPop);
  return {
    note(key: string) {
      if (trail.current() !== key) trail.push(key);
    },
    stop() {
      window.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("auxclick", onClick, { capture: true });
      window.removeEventListener("click", onClickEnd);
      window.removeEventListener("auxclick", onClickEnd);
      window.removeEventListener("popstate", onPop);
    },
  };
}
