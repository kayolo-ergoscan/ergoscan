/**
 * `rent.collected` from the stream, for the harbour's moment. PageSync hands every message here
 * (like the Kayolo feeds): no React state, no renders for pages that do not listen.
 */
import { parseRentCollected, type RentCollectedEvent } from "@ergoscan/shared";

type Listener = (ev: RentCollectedEvent) => void;

const listeners = new Set<Listener>();

/** Browser only; never throws. */
export function feedRent(msg: unknown): void {
  if (typeof window === "undefined" || !listeners.size) return;
  try {
    if (!msg || typeof msg !== "object" || (msg as { type?: unknown }).type !== "rent.collected") return;
    const ev = parseRentCollected((msg as { data?: unknown }).data);
    if (!ev) return;
    for (const fn of listeners) fn(ev);
  } catch {
    /* a moment is never worth a broken stream */
  }
}

/** Subscribe; returns the cleanup. */
export function onRentCollected(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
