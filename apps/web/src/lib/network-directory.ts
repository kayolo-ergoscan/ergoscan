/**
 * Public Ergo explorers and explorer-family APIs. Not ErgoScan.
 * 12 Nov 2026: dropped CodeUTXO (domain no longer resolves) and the Cornell backup
 * (certificate expired); check every link before adding one back.
 */

export type NetworkKind = "explorers" | "apis" | "graphql";

export type NetworkLink = {
  href: string;
  op: NetworkOp;
};

export type NetworkOp =
  | "ergoplatform"
  | "ergoplatformP2p"
  | "cornell"
  | "ergexplorer"
  | "sigmaspace";

export const NETWORK_OPS: Record<NetworkOp, `network.op.${NetworkOp}`> = {
  ergoplatform: "network.op.ergoplatform",
  ergoplatformP2p: "network.op.ergoplatformP2p",
  cornell: "network.op.cornell",
  ergexplorer: "network.op.ergexplorer",
  sigmaspace: "network.op.sigmaspace",
};

export const NETWORK_DIRECTORY: Record<NetworkKind, readonly NetworkLink[]> = {
  explorers: [
    { href: "https://explorer.ergoplatform.com/", op: "ergoplatform" },
    { href: "https://explorer-p2p.ergoplatform.com/", op: "ergoplatformP2p" },
    { href: "https://ergo.aap.cornell.edu/", op: "cornell" },
    { href: "https://ergexplorer.com/", op: "ergexplorer" },
    { href: "https://sigmaspace.io/", op: "sigmaspace" },
  ],
  apis: [
    { href: "https://api.ergoplatform.com/api/v1/docs/", op: "ergoplatform" },
    { href: "https://api-p2p.ergoplatform.com/api/v1/docs/", op: "ergoplatformP2p" },
    { href: "https://api.ergo.aap.cornell.edu/api/v1/docs/", op: "cornell" },
  ],
  graphql: [
    { href: "https://gql.ergoplatform.com/", op: "ergoplatform" },
    { href: "https://graphql-p2p.ergoplatform.com/", op: "ergoplatformP2p" },
    { href: "https://graphql.ergo.aap.cornell.edu/", op: "cornell" },
  ],
};

export const NETWORK_KINDS: readonly NetworkKind[] = ["explorers", "apis", "graphql"];

export function hrefHost(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

export function hrefPath(href: string): string {
  try {
    const u = new URL(href);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return path;
  } catch {
    return "";
  }
}
