"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
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
import { TxLaneRow } from "@/components/TxLaneRow";
import { useMempool } from "@/lib/useMempool";
import { formatBytes, formatErgPrecise, formatFeeRate, toBigIntAmt } from "@/lib/format";
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
  const { balls, fees } = useMempool(asBalls(initialBalls), initialP50);
  const [offset, setOffset] = useState(0);
  const [stuck, setStuck] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);
  const miss = t("home.unavailable");

  const rows = useMemo(
    () =>
      [...balls]
        .sort((a, b) => {
          const dt = (b.firstSeen ?? 0) - (a.firstSeen ?? 0);
          if (dt !== 0) return dt;
          return String(a.id).localeCompare(String(b.id));
        })
        .map((b) => mempoolBallToTx(b)),
    [balls]
  );
  const total = rows.length;
  const cap = total <= 0 ? 0 : Math.max(0, Math.floor((total - 1) / MEMPOOL_PACK) * MEMPOOL_PACK);
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

  useEffect(() => {
    const el = pinRef.current;
    if (!el || !page.length) {
      setStuck(false);
      return;
    }
    const chrome = document.querySelector(".stage-frame header.sticky");
    const pin =
      (chrome instanceof HTMLElement ? chrome.getBoundingClientRect().height : 64) + 8;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 1, rootMargin: `-${pin}px 0px 0px 0px` }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [page.length]);

  const totalSize = balls.reduce((s, b) => s + (b.size ?? 0), 0);
  const totalFees = balls.reduce((s, b) => s + toBigIntAmt(b.fee), 0n);
  const fill = loadPct(totalSize);
  const p50 = fees?.p50 ?? initialP50;
  const eta = formatEta(fees?.eta?.nextEtaSec);

  const kpis = [
    {
      label: t("mempool.kpiCount"),
      value: total.toLocaleString(loc(locale)),
      sub: t("mempool.kpiWaitSub"),
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
      sub: eta != null ? t("mempool.kpiEta").replace("{n}", eta) : t("fees.kpiEta"),
      mark: <KpiMarkChartColumn tone={INK.teal} />,
      ink: INK.teal,
      enter: 3,
    },
  ];

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-3 sm:grid-cols-4" />

      {!listReady ? null : !rows.length ? (
        <p className="text-[var(--muted)]">{t("mempool.empty")}</p>
      ) : null}

      {listReady && rows.length > 0 && (
        <div className="addr-sheet">
          <div ref={pinRef} className="h-px w-full" aria-hidden />
          <div className={packEnter.enterClass("pack")}>
            <div className="addr-pan kpi-tape">
            <div
              className={clsx(
                "addr-head addr-lane addr-lane-x block-tx-pairs text-[12px] font-medium",
                stuck && "is-stuck"
              )}
            >
              <div className="block-lane-pair">
                <div className="min-w-0">{t("detail.tx")}</div>
                <div className="min-w-0 justify-end">{t("blocks.txIo")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("block.col.tokens")}</div>
                <div className="min-w-0 justify-end">{t("blocks.time")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("tx.fee")}</div>
                <div className="min-w-0 justify-end">{t("txs.outputSum")}</div>
              </div>
              <div className="block-lane-pair is-triple">
                <div className="min-w-0 tabular-nums">{t("blocks.txIndex")}</div>
                <div className="min-w-0 justify-center text-center">{t("blocks.size")}</div>
                <div className="min-w-0 justify-end">{t("txs.mempool")}</div>
              </div>
            </div>
            {page.map((row, i) => (
              <TxLaneRow
                key={row.id}
                row={row}
                index={liveOffset + i}
                locale={locale}
                t={t}
                showHeight
                hidePending
                enterClass={enter.enterClass(row.id)}
              />
            ))}
            </div>
          </div>
          <RankWindow
            offset={liveOffset}
            pageSize={MEMPOOL_PACK}
            shown={page.length}
            total={total}
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
