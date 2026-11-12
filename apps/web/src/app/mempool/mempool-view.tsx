"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import {
  KpiMarkBatteryMedium,
  KpiMarkChartColumn,
  KpiMarkListEnd,
  KpiMarkReceiptText,
} from "@/components/kpi-marks";
import { INK } from "@/lib/palette";
import { RankWindow } from "@/components/RankWindow";
import { Feed, FeedCount, FeedDays, FeedEmpty } from "@/components/feed/Feed";
import { FeedTxRow } from "@/components/feed/FeedTxRow";
import { useMempool } from "@/lib/useMempool";
import { formatBytes, formatErgPrecise, formatFeeRate, toBigIntAmt, toEpochMs } from "@/lib/format";
import { ERGO_MAX_BLOCK_SIZE } from "@/lib/ergo-emission";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { ENTER_MS, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import {
  MEMPOOL_PACK,
  mempoolBallToTx,
  type MempoolBall,
} from "@/lib/list-snapshots";
import type { BallProps } from "@ergoscan/shared";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function asBalls(rows: MempoolBall[]): BallProps[] {
  return rows as BallProps[];
}

function loadPct(size: number): number | null {
  if (size <= 0) return 0;
  return Math.min(100, (size / ERGO_MAX_BLOCK_SIZE) * 100);
}

function formatEta(sec: number | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function MempoolView({
  initialBalls,
  initialP50 = null,
}: {
  initialBalls: MempoolBall[];
  initialP50?: number | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { balls, leaving, lastSeal, fees } = useMempool(asBalls(initialBalls), initialP50);
  const [offset, setOffset] = useState(0);
  const miss = t("home.unavailable");

  // Txs that just went into a block keep their place for a moment: tile fills, block number, fold.
  const rows = useMemo(() => {
    const into = new Map(leaving.map((l) => [l.ball.id, l.height]));
    const have = new Set(balls.map((b) => b.id));
    return [...balls, ...leaving.filter((l) => !have.has(l.ball.id)).map((l) => l.ball)]
      .sort((a, b) => {
        const dt = (b.firstSeen ?? 0) - (a.firstSeen ?? 0);
        if (dt !== 0) return dt;
        return String(a.id).localeCompare(String(b.id));
      })
      .map((b) => {
        const tx = mempoolBallToTx(b);
        const h = into.get(b.id);
        return h == null ? tx : { ...tx, confirmed: true, inclusionHeight: h };
      });
  }, [balls, leaving]);
  const total = balls.length;
  const listed = rows.length;
  const cap = listed <= 0 ? 0 : Math.max(0, Math.floor((listed - 1) / MEMPOOL_PACK) * MEMPOOL_PACK);
  const liveOffset = Math.min(offset, cap);
  const page = rows.slice(liveOffset, liveOffset + MEMPOOL_PACK);
  const pageKey = page.map((b) => b.id).join(",");
  // The server's first page goes into the first HTML, with the same entry animation.
  const seedIds = useRef<string[] | null>(null);
  if (seedIds.current == null) seedIds.current = pageKey ? pageKey.split(",") : [];
  const enter = useEnterIds(ENTER_MS, seedIds.current);
  const packEnter = useEnterIds(ENTER_MS, seedIds.current.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seedIds.current.length > 0);

  useEffect(() => {
    if (offset !== liveOffset) setOffset(liveOffset);
  }, [offset, liveOffset]);

  const prevIds = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = pageKey ? pageKey.split(",") : [];
    if (prevIds.current == null) {
      prevIds.current = ids;
      enter.mark(ids);
      if (ids.length) packEnter.mark(["pack"]);
      setListReady(true);
      return;
    }
    enter.mark(
      enteringIds(
        prevIds.current.map((id) => ({ id })),
        ids.map((id) => ({ id }))
      )
    );
    prevIds.current = ids;
  }, [pageKey, enter.mark, packEnter.mark]);

  const totalSize = balls.reduce((s, b) => s + (b.size ?? 0), 0);
  const totalFees = balls.reduce((s, b) => s + toBigIntAmt(b.fee), 0n);
  const fill = loadPct(totalSize);
  const p50 = fees?.p50 ?? initialP50;
  // Count down every second from the last block; past the average interval the block is due.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const etaInfo = fees?.eta;
  const etaLeft =
    etaInfo && etaInfo.lastBlockTs > 0 && etaInfo.avgIntervalMs > 0
      ? Math.max(0, (etaInfo.lastBlockTs + etaInfo.avgIntervalMs - now) / 1000)
      : etaInfo?.nextEtaSec;
  const eta = etaLeft != null && etaLeft < 1 ? null : formatEta(etaLeft);
  const etaDue = etaLeft != null && etaLeft < 1;

  const kpis = [
    {
      label: t("mempool.kpiCount"),
      value: total.toLocaleString(loc(locale)),
      sub: lastSeal
        ? t("mempool.kpiSealed")
            .replace("{h}", lastSeal.height.toLocaleString(loc(locale)))
            .replace("{n}", lastSeal.took.toLocaleString(loc(locale)))
        : t("mempool.kpiWaitSub"),
      mark: <KpiMarkListEnd tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 0,
    },
    {
      label: t("mempool.kpiLoad"),
      value: fill != null ? `${Math.round(fill)}%` : miss,
      unavailable: fill == null,
      sub: totalSize > 0 ? formatBytes(totalSize) : t("mempool.kpiLoadSub"),
      mark: <KpiMarkBatteryMedium tone={INK.gold} />,
      ink: INK.gold,
      enter: 1,
    },
    {
      label: t("mempool.kpiFees"),
      value: formatErgPrecise(totalFees, locale),
      sub: t("mempool.kpiFeesSub"),
      mark: <KpiMarkReceiptText tone={INK.gold} />,
      ink: INK.gold,
      enter: 2,
    },
    {
      label: t("mempool.kpiP50"),
      value: p50 != null ? formatFeeRate(p50) : miss,
      unavailable: p50 == null,
      sub: etaDue ? t("mempool.kpiEtaDue") : eta != null ? t("mempool.kpiEta").replace("{n}", eta) : t("fees.kpiEta"),
      mark: <KpiMarkChartColumn tone={INK.teal} />,
      ink: INK.teal,
      enter: 3,
    },
  ];

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-3 sm:grid-cols-4" />

      {!listReady ? null : !rows.length ? (
        <Feed>
          <FeedEmpty k="transfer" title={t("mempool.empty")} />
        </Feed>
      ) : null}

      {listReady && rows.length > 0 && (
        <div className="feed-sheet">
          <Feed enterClass={packEnter.enterClass("pack")}>
            <FeedDays
              items={page}
              seconds
              msOf={(row) => toEpochMs(row.timestamp)}
              pendingOf={() => true}
              countOf={() => <FeedCount k="feed.txCount" n={total} />}
              render={(row, lead) =>
                row.confirmed ? (
                  <FeedTxRow
                    key={row.id}
                    row={row}
                    lead={{ ...lead, same: false }}
                    showHeight
                    enterClass="mp-sealed"
                  />
                ) : (
                  <FeedTxRow
                    key={row.id}
                    row={row}
                    lead={lead}
                    queue={liveOffset + page.indexOf(row)}
                    enterClass={enter.enterClass(row.id)}
                  />
                )
              }
            />
          </Feed>
          <RankWindow
            offset={liveOffset}
            pageSize={MEMPOOL_PACK}
            shown={page.length}
            total={listed}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("mempool.packTape")}
            hint={t("mempool.packHint")}
            onOffset={setOffset}
          />
        </div>
      )}
    </Shell>
  );
}
