import type { Express, NextFunction, Request, Response } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all"] as const;

/**
 * Express 4 never sees a rejected async route handler: the rejection is unhandled and Node 20
 * exits the process. One bad request then took both gateways down. Every handler registered
 * through app.get/post/… after this call hands its rejection to next(err) instead.
 */
export function catchAsyncRoutes(app: Express): void {
  const methods = app as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const m of ROUTE_METHODS) {
    const orig = methods[m].bind(app);
    methods[m] = (...args: unknown[]) => orig(...args.map(wrapHandler));
  }
}

export function wrapHandler(a: unknown): unknown {
  // Error middleware (4 args) and mounted sub-apps keep their own shape.
  if (typeof a !== "function" || a.length >= 4 || "handle" in a) return a;
  const fn = a as Handler;
  return function wrapped(this: unknown, req: Request, res: Response, next: NextFunction) {
    const out = fn.call(this, req, res, next);
    if (out && typeof (out as Promise<unknown>).then === "function") {
      (out as Promise<unknown>).catch(next);
    }
    return out;
  };
}

export function errorStatus(err: unknown): number {
  const s = (err as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" && s >= 400 && s < 600 ? s : 500;
}

function errText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Last middleware: a failed request gets a JSON error, the process keeps serving. */
export function jsonErrorHandler(tag: string) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const status = errorStatus(err);
    if (status >= 500) console.error(`[${tag}] ${req.method} ${req.path} → ${status}: ${errText(err)}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json({ error: status >= 500 ? "internal" : "bad_request" });
  };
}

/** A stray rejection outside a route is logged instead of ending the process. */
export function logUnhandledRejections(tag: string): void {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${tag}] unhandled rejection: ${errText(reason)}`);
  });
}
