/**
 * Versions and modes of the peers our node talks to, from the node's /peers/syncInfo.
 * Read on demand, kept in RAM for a minute. Nothing is stored.
 */

export type PeerSync = {
  version?: unknown;
  mode?: { state?: unknown; fullBlocksSuffix?: unknown } | null;
};

export type NodeVersionRow = { version: string; n: number };
export type NodeModeId = "full" | "pruned" | "digest";
export type NodeVersions = {
  updatedAt: number;
  total: number;
  versions: NodeVersionRow[];
  modes: { mode: NodeModeId; n: number }[];
};

function versionKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null;
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function modeOf(p: PeerSync): NodeModeId {
  const state = typeof p.mode?.state === "string" ? p.mode.state.toLowerCase() : "";
  if (state === "digest") return "digest";
  const suffix = Number(p.mode?.fullBlocksSuffix);
  return Number.isFinite(suffix) && suffix > 0 ? "pruned" : "full";
}

/** Newest version first. Peers without a readable version are counted in the total only. */
export function summarizeNodeVersions(peers: readonly PeerSync[], now = Date.now()): NodeVersions {
  const byVersion = new Map<string, number>();
  const byMode = new Map<NodeModeId, number>();
  for (const p of peers) {
    if (!p || typeof p !== "object") continue;
    const v = versionKey(p.version);
    if (v) byVersion.set(v, (byVersion.get(v) ?? 0) + 1);
    if (!p.mode || typeof p.mode !== "object") continue;
    const m = modeOf(p);
    byMode.set(m, (byMode.get(m) ?? 0) + 1);
  }
  const versions = [...byVersion]
    .map(([version, n]) => ({ version, n }))
    .sort((a, b) => cmpVersion(a.version, b.version));
  const modes = (["full", "pruned", "digest"] as const)
    .map((mode) => ({ mode, n: byMode.get(mode) ?? 0 }))
    .filter((r) => r.n > 0);
  return { updatedAt: now, total: peers.length, versions, modes };
}

const KEEP_MS = 60_000;

export function nodeVersionCache(fetchPeers: () => Promise<PeerSync[]>) {
  let last: NodeVersions | null = null;
  let inFlight: Promise<NodeVersions | null> | null = null;
  return async function get(): Promise<NodeVersions | null> {
    if (last && Date.now() - last.updatedAt < KEEP_MS) return last;
    if (!inFlight) {
      inFlight = fetchPeers()
        .then((peers) => {
          if (Array.isArray(peers) && peers.length) last = summarizeNodeVersions(peers);
          return last;
        })
        .catch(() => last)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}
