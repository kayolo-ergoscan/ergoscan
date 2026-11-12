import type express from "express";
import { isHex64 } from "./packedRead.js";

/**
 * Honest offset paging (12 Nov 2026 audit). Before, an offset above a route's ceiling was
 * clamped to the ceiling, so a client asking for page 11, 12, 13 … got page 10 again with
 * hasMore:true and looped forever; the address history ignored offset altogether.
 * Now an offset is used as given up to `max`, and above it the client gets 400 with a hint
 * to page by `cursor` (keyset, no depth limit).
 */

/** Address-scoped lists walk one (addr_id, height) index: 100 000 rows deep is cheap. */
export const ADDRESS_OFFSET_MAX = 100_000;

/** Offset from the query: 0 when absent or not a number, null when above `max`. */
export function pageOffset(v: unknown, max: number): number | null {
  const n = Number(Array.isArray(v) ? v[0] : v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const off = Math.trunc(n);
  return off > max ? null : off;
}

export function offsetTooLarge(res: express.Response, max: number): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(400).json({
    error: "offset_too_large",
    maxOffset: max,
    reason: `offset above ${max}: page with cursor (nextCursor from the previous page) instead`,
  });
}

/**
 * Box-list keyset cursor `height:boxId` (nextCursor of the previous page).
 * undefined: no cursor given; null: given but malformed (400, never silently page 1 again).
 */
export function boxCursor(v: unknown): { height: number; id: string } | null | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw == null || String(raw).trim() === "") return undefined;
  const m = /^(\d{1,10}):([0-9a-fA-F]{64})$/.exec(String(raw).trim());
  if (!m) return null;
  const height = Number(m[1]);
  return Number.isSafeInteger(height) && isHex64(m[2]) ? { height, id: m[2].toLowerCase() } : null;
}

export function badCursor(res: express.Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(400).json({
    error: "bad_cursor",
    reason: "cursor must be the nextCursor of the previous page (height:boxId)",
  });
}
