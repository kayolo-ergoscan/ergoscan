/**
 * Public API host usage. Counts come from the visitor snapshot
 * (Caddy access log for api.ergoscan.me). Health is the API process.
 * No client IPs leave this module.
 */

export type ApiUseWindow = {
  requests: number;
  clients: number;
  bots: number;
  botHits: number;
  errors: number;
  limited: number;
  graphql: number;
  rest: number;
  paths: { path: string; hits: number }[];
};

export type ApiUse = {
  ok: boolean;
  height: number | null;
  generatedAt: string | null;
  hour: ApiUseWindow | null;
  day: ApiUseWindow | null;
};

/**
 * Only our own API routes are shown by name. Scanners probe the host for files such as
 * `/.env` or `/api-keys.txt`; those hits still count in the totals but never appear as paths.
 */
export function isApiRoute(path: string): boolean {
  if (!/^\/(api\/)?v1(\/|$)/.test(path) && path !== "/api/graphql") return false;
  return !path.split("/").some((seg) => seg.startsWith("."));
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function parseApiWindow(raw: unknown): ApiUseWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const paths = Array.isArray(w.paths)
    ? w.paths
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const path = typeof r.path === "string" ? r.path : "";
          if (!path) return null;
          return { path, hits: num(r.hits) };
        })
        .filter((row): row is { path: string; hits: number } => row != null && isApiRoute(row.path))
        .slice(0, 6)
    : [];
  return {
    requests: num(w.requests),
    clients: num(w.clients),
    bots: num(w.bots),
    botHits: num(w.botHits),
    errors: num(w.errors),
    limited: num(w.limited),
    graphql: num(w.graphql),
    rest: num(w.rest),
    paths,
  };
}

export function parseApiUse(snapshot: unknown, health: unknown): ApiUse {
  const snap = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : {};
  const host = snap.apiHost && typeof snap.apiHost === "object" ? (snap.apiHost as Record<string, unknown>) : {};
  const windows =
    host.windows && typeof host.windows === "object" ? (host.windows as Record<string, unknown>) : {};
  const live = health && typeof health === "object" ? (health as Record<string, unknown>) : {};
  const height = num(live.height);
  return {
    ok: live.ok === true,
    height: height > 0 ? height : null,
    generatedAt: typeof snap.generatedAt === "string" ? snap.generatedAt : null,
    hour: parseApiWindow(windows["1h"]),
    day: parseApiWindow(windows["24h"]),
  };
}
