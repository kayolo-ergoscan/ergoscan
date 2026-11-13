/**
 * Phone tab strip on the detail pages (address, token, block): the pure arithmetic.
 * The strip sticks under the header pill; a switch brings the start of the new
 * content up to the strip, and the open tab is kept inside the scrolling rail.
 */

/**
 * How far to scroll the page after a tab switch so the strip sits at its pin and
 * the new content starts right under it. `markTop` is the viewport top the strip
 * would have if it did not stick (read off a zero-height mark before it), `pin`
 * the strip's sticky top. Null when the strip is not stuck yet: the content start
 * is already in view and the page stays where it is.
 */
export function tabJumpDelta(markTop: number, pin: number): number | null {
  if (!Number.isFinite(markTop) || !Number.isFinite(pin)) return null;
  const d = markTop - pin;
  return d < -0.5 ? Math.round(d) : null;
}

/**
 * Where the rail should scroll so the open tab is wholly visible. `start` and
 * `end` are the tab's edges in the rail's content coordinates, `pad` the page
 * gutter the rail keeps at each side. Null when the tab is already in view.
 * A cut tab is brought to the left gutter: that is its snap point, so the rail
 * does not snap away from it (the browser stops at the end of the rail anyway).
 */
export function railScrollTarget(
  start: number,
  end: number,
  scrollLeft: number,
  viewWidth: number,
  pad: number
): number | null {
  if (![start, end, scrollLeft, viewWidth, pad].every(Number.isFinite) || viewWidth <= 0) return null;
  const left = scrollLeft + pad;
  const right = scrollLeft + viewWidth - pad;
  if (start >= left - 0.5 && end <= right + 0.5) return null;
  return Math.max(0, Math.round(start - pad));
}

/**
 * The height the strip's box needs so the strip can always scroll up to its pin,
 * however short (or still loading) the open tab is: from the box's top to one
 * screen below the strip's resting place. `markTop` is the strip's unstuck viewport
 * top (as above), `boxTop` the box's, `viewHeight` the viewport height. Null when
 * there is nothing to keep. It is a minimum height: a tall tab is untouched.
 */
export function tabRoom(markTop: number, pin: number, viewHeight: number, boxTop: number): number | null {
  if (![markTop, pin, viewHeight, boxTop].every(Number.isFinite) || viewHeight <= 0) return null;
  const room = markTop - boxTop - pin + viewHeight;
  return room > 0 ? Math.ceil(room) : null;
}
