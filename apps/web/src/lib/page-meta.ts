/**
 * Per-route search / share metadata. Root layout is the fallback only.
 * Fetches go through React cache() so generateMetadata and the page share one GET.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { lookupAddress } from "@/lib/address-book";
import { formatErgFixed, shortId } from "@/lib/format";
import {
  fetchAddressPage,
  fetchAddressPageResult,
  fetchBlockCard,
  fetchBox,
  fetchHomeSnapshot,
  fetchNftIssuer,
  fetchNftSeries,
  fetchTokenListItem,
  fetchTransaction,
} from "@/lib/list-snapshots";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site-meta";
import { tokenSymbol } from "@/lib/token-meta";

export const cachedHome = cache(fetchHomeSnapshot);
export const cachedTx = cache(fetchTransaction);
export const cachedAddress = cache(fetchAddressPage);
export const cachedAddressResult = cache(fetchAddressPageResult);
export const cachedToken = cache(fetchTokenListItem);
export const cachedBox = cache(fetchBox);
export const cachedBlock = cache(fetchBlockCard);
export const cachedNftSeries = cache(fetchNftSeries);
export const cachedNftIssuer = cache(fetchNftIssuer);

export const NOINDEX: Metadata["robots"] = { index: false, follow: false };
export const INDEX: Metadata["robots"] = { index: true, follow: true };

export function absUrl(path: string): string {
  if (!path || path === "/") return SITE_URL;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${p}`;
}

export function pageMeta(opts: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}): Metadata {
  const url = absUrl(opts.path);
  const index = opts.index !== false;
  const robots = index ? INDEX : NOINDEX;
  return {
    title: opts.title,
    description: opts.description,
    robots,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title: `${opts.title} · ErgoScan`,
      description: opts.description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${opts.title} · ErgoScan`,
      description: opts.description,
    },
  };
}

export function missMeta(kind: string, id: string, path: string): Metadata {
  const shown = id ? shortId(id, 8) : "";
  return pageMeta({
    title: `${kind} not found`,
    description: shown
      ? `No ${kind.toLowerCase()} ${shown} in the ErgoScan index.`
      : `This ${kind.toLowerCase()} is not in the ErgoScan index.`,
    path,
    index: false,
  });
}

export const LIST_PAGES: Record<
  string,
  { title: string; description: string; index?: boolean }
> = {
  "/blocks": {
    title: "Blocks",
    description: "Latest Ergo mainnet blocks: height, miner, fees, size, transaction count.",
  },
  "/transactions": {
    title: "Transactions",
    description: "Recent confirmed Ergo transactions from the ErgoScan index.",
  },
  "/mempool": {
    title: "Mempool",
    description: "Unconfirmed Ergo transactions waiting to be included in a block.",
  },
  "/tokens": {
    title: "Tokens",
    description: "Ergo token catalog: holders, supply, mint height, last activity.",
  },
  "/addresses": {
    title: "Addresses",
    description: "Ergo addresses with the largest confirmed ERG balances.",
  },
  "/names": {
    title: "Names",
    description: "Named Ergo addresses: exchanges, miners, protocol boxes, known contracts.",
  },
  "/defi": {
    title: "ErgoDex",
    description: "Ergo AMM swaps on ErgoDex CFMM and N2N pools, indexed on-chain by ErgoScan.",
  },
  "/defi/spectrum": {
    title: "ErgoDex",
    description: "Ergo AMM swaps on ErgoDex CFMM and N2N pools, indexed on-chain by ErgoScan.",
  },
  "/defi/pool": {
    title: "Pools",
    description: "ErgoDex liquidity pools: TVL, indexed volume, and fills from the ErgoScan DeFi index.",
  },
  "/defi/lithos": {
    title: "Lithos",
    description: "LithosDex ERG↔LIT fills and pools from the ErgoScan DeFi index.",
  },
  "/lithos": {
    title: "Lithos protocol",
    description: "Blocks found through Lithos: who found them, the 4% finder share, and the LIT paid into the rollup.",
  },
  "/defi/stable": {
    title: "AgeUSD protocol",
    description: "AgeUSD bank on Ergo: SigUSD, SigRSV, reserve, and bank-box history.",
  },
  "/defi/basis": {
    title: "Basis",
    description: "Basis lockboxes on Ergo: ERG and token reserves, and the tracker fingerprint boxes they name.",
  },
  "/rosen": {
    title: "Rosen bridge",
    description: "Rosen bridge events on Ergo: processing, completed, fraud.",
  },
  "/oracles": {
    title: "Oracles",
    description: "ErgoScan oracle pools: USD v1, USD v2, and XAU/ERG.",
  },
  "/oracles/ergusd": {
    title: "USD v1 oracle",
    description: "USD v1 Erg-USD oracle pool on Ergo: live operators, epoch, tape.",
  },
  "/oracles/erg-usd": {
    title: "USD v2 oracle",
    description: "USD v2 ERG/USD oracle pool on Ergo: live operators, epoch, tape.",
  },
  "/oracles/xau-erg": {
    title: "XAU oracle",
    description: "XAU/ERG oracle pool on Ergo: live operators, epoch, tape.",
  },
  "/oracles/xau-erg/gort": {
    title: "GORT buyback",
    description:
      "GORT buyback box for the gold oracle: DexyGold fees, swaps against the ERG/GORT pool, and returns to the pool.",
  },
  "/oracles/erg-usd/dort": {
    title: "DORT buyback",
    description:
      "DORT buyback box for the USD v2 oracle: DexyUSD fees, swaps against the ERG/DORT pool, and returns to the pool.",
  },
  "/nfts": {
    title: "NFTs",
    description: "Ergo NFT gallery from the index: artwork and name series.",
  },
  "/learn": {
    title: "How to read ErgoScan",
    description:
      "How to read Ergo eUTXO transactions and verify ErgoScan evidence, sources, freshness, and limits.",
  },
  "/learn/network": {
    title: "Ergo network directory",
    description: "Public Ergo explorers, explorer APIs, and GraphQL endpoints outside ErgoScan.",
  },
  "/about": {
    title: "About",
    description:
      "Independent Ergo blockchain explorer: who builds ErgoScan, what it indexes, and what comes next.",
  },
  "/rent": {
    title: "Storage rent",
    description: "Ergo storage rent coming due: 24h, 7d, and 30d, plus tokens that cannot pay the fee.",
  },
  "/rent/history": {
    title: "Rent history",
    description: "Collected Ergo storage rent, the chart, and who took it.",
  },
  "/fees": {
    title: "Fees",
    description: "Ergo mempool fee rates and confirmation ETA from the live gateway.",
  },
  "/operators/nodes": {
    title: "Node operators",
    description: "Ergo node operators listed on ErgoScan.",
  },
  "/operators/oracles": {
    title: "Oracles",
    description: "Ergo oracle pools listed on ErgoScan.",
  },
  "/search": {
    title: "Search",
    description: "Resolve an Ergo address, transaction, block, token, or box id.",
    index: false,
  },
  "/favorites": {
    title: "Favorites",
    description: "Your saved ErgoScan addresses. Stored in this browser only.",
    index: false,
  },
  "/status": {
    title: "Status",
    description:
      "Live ErgoScan chain index, mempool, DeFi, and Rosen health with public verification endpoints.",
    index: false,
  },
};

export function listPageMeta(path: keyof typeof LIST_PAGES): Metadata {
  const row = LIST_PAGES[path];
  return pageMeta({
    title: row.title,
    description: row.description,
    path,
    index: row.index !== false,
  });
}

export function txPageMeta(id: string, tx: Awaited<ReturnType<typeof fetchTransaction>>): Metadata {
  const path = `/tx/${id}`;
  if (!tx) return missMeta("Transaction", id, path);
  const bits = [
    tx.confirmed
      ? tx.inclusionHeight != null
        ? `Confirmed at height ${tx.inclusionHeight}.`
        : "Confirmed on Ergo mainnet."
      : "In the mempool.",
  ];
  if (tx.valueNano != null) bits.push(`Value ${formatErgFixed(tx.valueNano)}.`);
  const ins = tx.inputCount ?? (Array.isArray(tx.inputs) ? tx.inputs.length : 0);
  const outs = tx.outputCount ?? (Array.isArray(tx.outputs) ? tx.outputs.length : 0);
  if (ins || outs) bits.push(`${ins} input${ins === 1 ? "" : "s"}, ${outs} output${outs === 1 ? "" : "s"}.`);
  return pageMeta({
    title: `${tx.confirmed ? "Tx" : "Mempool tx"} ${shortId(tx.id, 8)}`,
    description: `Ergo transaction ${tx.id}. ${bits.join(" ")}`,
    path,
  });
}

export function badAddressMeta(address: string): Metadata {
  return pageMeta({
    title: "Invalid address",
    description: `${shortId(address, 8)} fails the Ergo address checksum. It is most likely a typo.`,
    path: `/address/${address}`,
    index: false,
  });
}

export function addressPageMeta(
  address: string,
  data: Awaited<ReturnType<typeof fetchAddressPage>>
): Metadata {
  const path = `/address/${address}`;
  if (!data) return missMeta("Address", address, path);
  const book = lookupAddress(data.address);
  const label = book?.name || shortId(data.address, 8);
  const title = book?.name ? book.name : `Address ${shortId(data.address, 8)}`;
  const erg = formatErgFixed(data.balance?.confirmedNanoErg);
  const tokens = data.tokenCount ?? data.balance?.tokens?.length ?? 0;
  const kind = book?.kind && book.kind !== "unknown" ? ` ${book.kind}` : "";
  return pageMeta({
    title,
    description: `Ergo${kind} address ${data.address}${book ? ` (${label})` : ""}. Confirmed ${erg}, ${tokens} token${tokens === 1 ? "" : "s"}.`,
    path,
  });
}

export function tokenPageMeta(
  tokenId: string,
  row: Awaited<ReturnType<typeof fetchTokenListItem>>
): Metadata {
  const path = `/token/${tokenId}`;
  if (!row) return missMeta("Token", tokenId, path);
  const symbol = tokenSymbol(row.tokenId) || row.name || shortId(row.tokenId, 6);
  const holders = row.holders != null ? `${row.holders.toLocaleString("en-US")} holders` : "holders pending";
  return pageMeta({
    title: symbol,
    description: `Ergo token ${row.name || symbol} (${row.tokenId}). ${holders}.`,
    path,
  });
}

export function blockPageMeta(
  key: string,
  block: Awaited<ReturnType<typeof fetchBlockCard>>
): Metadata {
  const path = `/block/${key}`;
  if (!block) return missMeta("Block", key, path);
  const miner = block.minerName || (block.minerAddress ? shortId(block.minerAddress, 6) : "unknown miner");
  return pageMeta({
    title: `Block ${block.height.toLocaleString("en-US")}`,
    description: `Ergo block ${block.height} (${block.id}). ${block.txCount} transactions, mined by ${miner}.`,
    path: `/block/${block.id}`,
  });
}

export function boxPageMeta(id: string, box: Awaited<ReturnType<typeof fetchBox>>): Metadata {
  const path = `/box/${id}`;
  if (!box) return missMeta("Box", id, path);
  const spent = box.spentTransactionId ? "spent" : "unspent";
  return pageMeta({
    title: `Box ${shortId(box.boxId, 8)}`,
    description: `Ergo box ${box.boxId}, ${spent}. Value ${formatErgFixed(box.value)}, created ${box.creationHeight ?? "—"}${
      box.settlementHeight != null && box.settlementHeight !== box.creationHeight
        ? `, settled ${box.settlementHeight}`
        : ""
    }.`,
    path,
  });
}

export const ROBOTS_DISALLOW = [
  "/api/",
  "/v1/",
  "/_ops",
  "/_ops/",
  "/search",
  "/favorites",
  "/status",
] as const;

export const SITEMAP_STATIC = [
  "/",
  "/blocks",
  "/transactions",
  "/mempool",
  "/tokens",
  "/addresses",
  "/names",
  "/defi",
  "/defi/spectrum",
  "/defi/pool",
  "/defi/lithos",
  "/defi/stable",
  "/defi/basis",
  "/oracles",
  "/oracles/ergusd",
  "/oracles/erg-usd",
  "/oracles/xau-erg",
  "/oracles/xau-erg/gort",
  "/oracles/erg-usd/dort",
  "/rosen",
  "/lithos",
  "/nfts",
  "/learn",
  "/learn/network",
  "/about",
  "/rent",
  "/rent/history",
  "/fees",
  "/operators/nodes",
] as const;

export function websiteJsonLd(name = SITE_TITLE, url = SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ErgoScan",
    alternateName: SITE_NAME,
    url,
    description: SITE_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={query}`,
      "query-input": "required name=query",
    },
  };
}

export function webpageJsonLd(opts: { title: string; path: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.title,
    url: absUrl(opts.path),
    description: opts.description,
    isPartOf: { "@type": "WebSite", name: "ErgoScan", url: SITE_URL },
  };
}
