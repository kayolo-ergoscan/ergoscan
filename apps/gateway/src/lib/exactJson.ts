import type express from "express";

/**
 * Exact big integers in JSON numbers (12 Nov 2026). JSON.stringify can only print a JS
 * number, so 9223372036854774807 came out as 9223372036854775000. `exactInt(digits)` marks
 * the value; installExactJson() prints the marked digits as a bare JSON number. The field
 * stays a number for clients, and a client with a big-number parser gets every digit.
 * (Node 20 has no JSON.rawJSON without a flag.)
 */
const MARK = "\u0001exact:";
const MARK_RE = /"\\u0001exact:(-?\d+)\\u0001"/g;

export type ExactInt = { toJSON(): string };

/** Digits → a value that prints as an exact JSON number; anything else → fallback. */
export function exactInt<T>(digits: string | null | undefined, fallback: T): ExactInt | T {
  if (typeof digits !== "string" || !/^-?\d+$/.test(digits)) return fallback;
  const n = Number(digits);
  if (Number.isSafeInteger(n)) return n as unknown as T;
  return { toJSON: () => `${MARK}${digits}\u0001` };
}

export function exactJsonText(body: unknown, spaces?: number | string): string {
  const text = JSON.stringify(body, null, spaces) ?? "null";
  return text.includes("\\u0001exact:") ? text.replace(MARK_RE, "$1") : text;
}

/** Wrap res.json so marked values print exactly. Same headers as Express' own res.json. */
export function installExactJson(app: express.Express): void {
  app.use((_req, res, next) => {
    res.json = function exactJson(this: express.Response, body?: unknown) {
      if (!this.get("Content-Type")) this.set("Content-Type", "application/json; charset=utf-8");
      return this.send(exactJsonText(body, app.get("json spaces")));
    } as express.Response["json"];
    next();
  });
}
