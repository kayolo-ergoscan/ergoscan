import type { Metadata } from "next";
import { headers } from "next/headers";
import { ApiSite } from "@/components/ApiSite";
import { HomeExplorer } from "@/components/HomeExplorer";
import { JsonLd } from "@/components/JsonLd";
import type { ChainStats, PoolShare } from "@/lib/chain-stats";
import { homeToChainStats, type ErgMarket } from "@/lib/list-snapshots";
import { cachedHome, DEFAULT_OG_IMAGE, websiteJsonLd } from "@/lib/page-meta";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site-meta";
import type { RentTapeRow } from "@ergoscan/shared";

export const dynamic = "force-dynamic";

const CADENCE = 8;

/** Local `/?preview=share` only — stage has no miner snapshot yet. */
const SHARE_PREVIEW: PoolShare[] = [
  {
    name: "2miners",
    blocks: 312,
    share: 0.433,
    address: "88dhgzEuTXaRQTX5KNdnaWTTX7fEZVEQRn6qP4MJotPuRnS3QpoJxYpSaXoU1y7SHp8ZXMp92TH22DBY",
  },
  {
    name: "Hero Miners",
    blocks: 148,
    share: 0.206,
    address: "88dhgzEuTXaSuf5QC1TJDgdxqJMQEQAM6YaTTRqmUDrmPoVky1b16WAK5zMrq3p2mYqpUNKCyi5CLS9V",
  },
  {
    name: "Sigmanauts",
    blocks: 91,
    share: 0.126,
    address: "88dhgzEuTXaQDYikoEkCMEPRxDiYnVRfiqhf3uLcMhbTPrTrrc7wkyF5LFMmgJyT4mPa6ucnmk3QTeUo",
  },
  {
    name: "Wooly Pooly",
    blocks: 64,
    share: 0.089,
    address: "88dhgzEuTXaQ2HPUskY3hvgMA5uCbQWwZNPbMC1Hem9zM2V9U7KMah7LYWS4Hm4WECGuc22nofdQbHbY",
  },
  {
    name: "Kryptex",
    blocks: 41,
    share: 0.057,
    address: "88dhgzEuTXaTnTZomXPfuJ67oYJPbrv17yNkLjN6Nj8HxZEUf2iAdiv9gTqmnKKa2i75zmUtDnPQovBb",
  },
  {
    name: "Getblok",
    blocks: 22,
    share: 0.031,
    address: "88dhgzEuTXaQ9HG2rDCmirsSGWEva3yZTXfjAB4ZBb3D1o3XH66qpndNUYqXzXiYnUUb2h9qZrzdZ6UA",
  },
  { name: "88…TH22DBY", blocks: 14, share: 0.019 },
  { name: "other", blocks: 28, share: 0.039 },
];

/** Local `/?preview=share` — live `/v1/page/home` has no rentTape until the stack ships. */
const RENT_PREVIEW: RentTapeRow[] = [
  {
    address: "88dhgzEuTXaRQTX5KNdnaWTTX7fEZVEQRn6qP4MJotPuRnS3QpoJxYpSaXoU1y7SHp8ZXMp92TH22DBY",
    boxCount: 3,
    oldestCreationHeight: 1_800_000,
    blocksUntilRent: 0,
    rentNano: "3750000",
    valueNano: "2500000000",
  },
  {
    address: "88dhgzEuTXaSuf5QC1TJDgdxqJMQEQAM6YaTTRqmUDrmPoVky1b16WAK5zMrq3p2mYqpUNKCyi5CLS9V",
    boxCount: 2,
    oldestCreationHeight: 1_800_200,
    blocksUntilRent: 0,
    rentNano: "1250000",
    valueNano: "800000000",
  },
  {
    address: "88dhgzEuTXaQDYikoEkCMEPRxDiYnVRfiqhf3uLcMhbTPrTrrc7wkyF5LFMmgJyT4mPa6ucnmk3QTeUo",
    boxCount: 1,
    oldestCreationHeight: 1_801_000,
    blocksUntilRent: 180,
    rentNano: "625000",
    valueNano: "400000000",
  },
  {
    address: "88dhgzEuTXaQ2HPUskY3hvgMA5uCbQWwZNPbMC1Hem9zM2V9U7KMah7LYWS4Hm4WECGuc22nofdQbHbY",
    boxCount: 4,
    oldestCreationHeight: 1_802_000,
    blocksUntilRent: 480,
    rentNano: "2500000",
    valueNano: "1200000000",
  },
  {
    address: "88dhgzEuTXaTnTZomXPfuJ67oYJPbrv17yNkLjN6Nj8HxZEUf2iAdiv9gTqmnKKa2i75zmUtDnPQovBb",
    boxCount: 1,
    oldestCreationHeight: 1_810_000,
    blocksUntilRent: 1440,
    rentNano: "625000",
    valueNano: "300000000",
  },
  {
    address: "88dhgzEuTXaQ9HG2rDCmirsSGWEva3yZTXfjAB4ZBb3D1o3XH66qpndNUYqXzXiYnUUb2h9qZrzdZ6UA",
    boxCount: 2,
    oldestCreationHeight: 1_811_000,
    blocksUntilRent: 90,
    rentNano: "1250000",
    valueNano: "500000000",
  },
];

/** Local preview KPI — indexer `thisEpoch.rentNano` is the live source. */
const RENT_PREVIEW_EPOCH_NANO = "128750000000";

function withSharePreview(stats: ChainStats, preview?: string): ChainStats {
  if (process.env.NODE_ENV !== "development" || preview !== "share") return stats;
  if (stats.pools.length) return stats;
  const poolBlocks = SHARE_PREVIEW.reduce((s, p) => s + p.blocks, 0);
  return { ...stats, pools: SHARE_PREVIEW, poolBlocks };
}

function marketFromHome(home: {
  ergUsd?: number | null;
  ergUsdSource?: string | null;
  rank?: number | null;
  volume24h?: number | null;
  change24h?: number | null;
}): ErgMarket | null {
  const usd = home.ergUsd;
  if (usd == null || !(usd > 0)) return null;
  return {
    usd,
    source: home.ergUsdSource || "coingecko",
    rank: home.rank != null && home.rank >= 1 ? home.rank : null,
    volume24h: home.volume24h != null && home.volume24h > 0 ? home.volume24h : null,
    change24h: home.change24h != null && Number.isFinite(home.change24h) ? home.change24h : null,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const host = ((await headers()).get("host") ?? "").split(":")[0];
  if (host === "api.ergoscan.me") {
    return {
      title: "API",
      description:
        "ErgoScan wallet API. The same paths as the official Ergo explorer. Decimal string amounts. No key.",
      alternates: { canonical: "https://api.ergoscan.me/" },
      openGraph: { url: "https://api.ergoscan.me/", images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }] },
    };
  }
  const home = await cachedHome();
  const height = home.height;
  return {
    description:
      height != null
        ? `${SITE_DESCRIPTION} Height ${height.toLocaleString("en-US")}.`
        : SITE_DESCRIPTION,
    alternates: { canonical: SITE_URL },
    openGraph: { url: SITE_URL, images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }] },
  };
}

/** Home = chain dashboard. First HTML is the indexer snapshot only (no CoinGecko). */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const host = ((await headers()).get("host") ?? "").split(":")[0];
  if (host === "api.ergoscan.me") return <ApiSite />;
  const [{ preview }, home] = await Promise.all([searchParams, cachedHome()]);
  const market = marketFromHome(home);
  const price = home.priceSeries ?? [];
  const rentTape =
    process.env.NODE_ENV === "development" && preview === "share"
      ? RENT_PREVIEW
      : (home.rentTape ?? []);
  return (
    <>
    <JsonLd data={websiteJsonLd()} />
    <HomeExplorer
      initialMempool={home.mempoolCount}
      initialBlocks={home.blocks.slice(0, CADENCE)}
      initialErgUsd={market?.usd ?? null}
      initialMarket={market}
      initialUpdatedAt={home.updatedAt}
      initialStats={withSharePreview(homeToChainStats(home), preview)}
      initialHashRateSeries={home.hashRateSeries ?? []}
      initialTxActivity={home.txActivity ?? []}
      initialPrice={price}
      initialVolume={[]}
      initialChartError={price.length < 2}
      initialRentTape={rentTape}
      initialRentDanger={home.rentDanger ?? null}
      initialRentEpochNano={
        process.env.NODE_ENV === "development" && preview === "share"
          ? RENT_PREVIEW_EPOCH_NANO
          : (home.rentEpochNano ?? null)
      }
      initialRentEpochBoxes={home.rentEpochBoxes ?? null}
      initialLithos={home.lithos ?? null}
      previewShare={process.env.NODE_ENV === "development" && preview === "share"}
    />
    </>
  );
}
