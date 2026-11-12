"use client";

/**
 * /mempool live well: the same ball pit as on home. Txs gather here and fly out of the left
 * mouth into their block the moment the node seals it; a tag at the mouth names that block.
 * Data: the site stream (page-sync), so it matches home ball for ball.
 */
import { useEffect, useMemo, useState } from "react";
import { HomeMempoolStage, type HomePitSeed } from "@/components/HomeMempoolStage";
import { ReelText } from "@/components/ReelText";
import { usePageSync, useStreamMempool } from "@/lib/page-sync";
import { HOME } from "@/lib/palette";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MempoolLastSeal } from "@/lib/useMempool";

/** How long the «→ block N» tag stays at the mouth after a seal. */
const TAG_MS = 7_000;

export function MempoolLiveWell({ lastSeal }: { lastSeal: MempoolLastSeal | null }) {
  const { t, locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const { tip } = usePageSync();
  const stream = useStreamMempool();
  const [tag, setTag] = useState<MempoolLastSeal | null>(null);

  useEffect(() => {
    if (!lastSeal) return;
    setTag(lastSeal);
    const id = window.setTimeout(() => setTag(null), Math.max(0, lastSeal.at + TAG_MS - Date.now()));
    return () => window.clearTimeout(id);
  }, [lastSeal]);

  const balls: HomePitSeed[] = useMemo(
    () =>
      stream.balls.map((b) => ({
        id: b.id,
        size: b.size,
        fee: b.fee,
        feeRate: b.feeRate > 0 ? b.feeRate : b.size > 0 ? b.fee / b.size : 0,
        color: b.color || HOME.txs,
        firstSeen: b.firstSeen,
        category: b.category,
        platform: b.platform,
        action: b.action ?? null,
        value: b.value,
      })),
    [stream.balls]
  );
  const forming = Math.max(tip?.height ?? 0, stream.seal?.height ?? 0) + 1;

  return (
    <section className="mod mb-3 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3 sm:px-5">
      <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <h2 className="m-0 shrink-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
            {t("mempool.wellTitle")}
          </h2>
          <span
            className="cadence-live-dot mb-px inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: HOME.forming }}
          />
          <span className="min-w-0 truncate text-[13px] font-semibold tabular-nums leading-none tracking-tight text-[var(--text)]">
            <ReelText text={forming > 1 ? forming.toLocaleString(loc) : "—"} />
          </span>
        </div>
        <span className="min-w-0 truncate text-[12px] leading-none text-[var(--muted)] max-sm:hidden">{t("mempool.wellHint")}</span>
      </div>
      <div className="home-pit relative h-[140px] sm:h-[176px]">
        <HomeMempoolStage
          balls={balls}
          ariaLabel={t("home.mempoolPit")}
          moreTitle={(n) => t("mempool.more").replace("{n}", String(n))}
        />
        {tag ? (
          <span
            key={`${tag.height}:${tag.at}`}
            className="mempool-well-tag pointer-events-none absolute left-1 top-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-tight"
          >
            ← {tag.height.toLocaleString(loc)} · {tag.took.toLocaleString(loc)} {t("mempool.wellTook")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
