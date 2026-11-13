import { listPageMeta } from "@/lib/page-meta";
import { fetchOracleFeed, type OracleFeedSlug } from "@/lib/oracle-feed";
import { summarizeOracleFeed, type OracleDoorSummary } from "@/lib/oracle-door";
import { OraclesDoor } from "./oracles-door";

export const dynamic = "force-dynamic";
export const metadata = listPageMeta("/oracles");

const SLUGS: OracleFeedSlug[] = ["ergusd", "erg-usd", "xau-erg"];

/**
 * The three pools' packs are read here, on the server, and cut down to a value, its age and a
 * 7-day line per card: the packs carry every operator and tick, the page needs a few hundred bytes.
 */
export default async function OraclesPage() {
  const now = Date.now();
  const packs = await Promise.all(SLUGS.map((slug) => fetchOracleFeed(slug, "7d")));
  const summaries: Partial<Record<OracleFeedSlug, OracleDoorSummary>> = {};
  for (const pack of packs) {
    if (pack) summaries[pack.slug] = summarizeOracleFeed(pack, now);
  }
  return <OraclesDoor summaries={summaries} renderedAt={now} />;
}
