"use client";

import Link from "next/link";
import { MissShell } from "@/components/MissPanel";
import { TokenLogo } from "@/components/TokenBadge";
import { shortId } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Feed, FeedBoard, FeedCount, FeedField, FeedFields, FeedIdLine, FeedPlate, FeedRow, feedLoc } from "@/components/feed/Feed";

export type ResolveHit = {
  type: "block" | "tx" | "box" | "token" | "address";
  id: string;
  path: string;
  label?: string;
  /** Set on token hits when the holder ranking answered. */
  holders?: number;
};

export function SearchHits({ q, hits }: { q: string; hits: ResolveHit[] }) {
  const { t } = useI18n();
  if (hits.length > 1 && hits.every((h) => h.type === "token")) {
    return (
      <div className="feed-sheet max-w-3xl">
        <Feed className="is-rank">
          <FeedBoard
            plate={<FeedPlate tag={q || t("search.hit.token")} count={<FeedCount k="feed.tokens" n={hits.length} />} />}
          >
            {hits.map((h, i) => (
              <TokenHitRow key={h.id} hit={h} rank={i + 1} />
            ))}
          </FeedBoard>
        </Feed>
        <p className="feed-note">{t("search.nameList")}</p>
      </div>
    );
  }
  if (!q) return <MissShell looked="" copy="empty" />;
  return <MissShell looked={q} copy="index" />;
}

/** One token that shares the searched name: holders decide the order and are the figure. */
function TokenHitRow({ hit, rank }: { hit: ResolveHit; rank: number }) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const name = hit.label?.trim() || null;
  return (
    <FeedRow
      k="token"
      tile={<TokenLogo tokenId={hit.id} size={22} />}
      tileTitle={name ?? undefined}
      lead={{ rank: rank.toLocaleString(tag) }}
      title={
        <Link
          prefetch={false}
          href={hit.path}
          title={hit.id}
          className={name ? "feed-name font-semibold hover:underline" : "feed-name font-mono tabular-nums hover:underline"}
        >
          {name ?? shortId(hit.id, 8)}
        </Link>
      }
      facts={
        <>
          <span className="feed-kind">{t("search.hit.token")}</span>
          <span className="font-mono tabular-nums" title={hit.id}>
            {shortId(hit.id, 6)}
          </span>
        </>
      }
      value={
        <span className="feed-amt tabular-nums">{hit.holders != null ? hit.holders.toLocaleString(tag) : "—"}</span>
      }
      sub={t("feed.sort.holders")}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("tokens.colPolicy")} wide>
            <FeedIdLine href={hit.path} id={hit.id} />
          </FeedField>
        </FeedFields>
      )}
    />
  );
}
