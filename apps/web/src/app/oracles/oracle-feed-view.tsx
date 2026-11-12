"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import clsx from "clsx";
import {
  ORACLE_BLOCK_MS,
  ORACLE_FEEDS,
  oracleAgeBlocks,
} from "@ergoscan/shared";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import {
  KpiMarkBell,
  KpiMarkMetronome,
  KpiMarkQuote,
  KpiMarkScale,
  KpiMarkUserGroup,
} from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import { lookupAddress } from "@/lib/address-book";
import { formatErgPrecise, formatRelAge, formatUsd, shortId } from "@/lib/format";
import {
  oracleErgLow,
  oracleOperatorMarkSrc,
  oracleOperatorName,
  oracleOperatorSeed,
  oracleWhenLabel,
} from "@/lib/oracle-operator";
import { sortSilentOldest, splitOracleLens } from "@/lib/oracle-scene";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import {
  ORACLE_PACK,
  applyOracleFeed,
  emptyOracleFeed,
  fetchOracleFeed,
  ticksForChart,
  type OracleFeedPack,
  type OracleFeedSlug,
  type OracleOperator,
} from "@/lib/oracle-feed";
import { OracleCouncil } from "./oracle-council";

const DualLineChart = dynamic(() => import("@/components/DualLineChart"), {
  ssr: false,
});

const CHART_RANGES = [
  { id: "7d" as const, labelKey: "oracles.range7d" },
  { id: "30d" as const, labelKey: "oracles.range30d" },
];

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fmtQuote(slug: OracleFeedSlug, n: number | null, locale: string): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (slug === "erg-usd" || slug === "ergusd") return formatUsd(n, 4);
  return n.toLocaleString(loc(locale), { maximumFractionDigits: 6 });
}

function fmtHeight(h: number | null, locale: string): string {
  if (h == null) return "—";
  return `#${h.toLocaleString(loc(locale))}`;
}

export function OracleFeedView({
  slug,
  initial,
}: {
  slug: OracleFeedSlug;
  initial?: OracleFeedPack;
}) {
  const t = useT();
  const { locale } = useI18n();
  const def = ORACLE_FEEDS[slug];
  const { markSynced, tip } = usePageSync();
  const miss = "—";
  const [pack, setPack] = useState(initial ?? emptyOracleFeed(slug));
  const [pending, setPending] = useState(false);
  const [rangeId, setRangeId] = useState<(typeof CHART_RANGES)[number]["id"]>("7d");
  const [offset, setOffset] = useState(0);
  const [tapeLens, setTapeLens] = useState<"live" | "silent">("live");
  const [stuck, setStuck] = useState(false);
  const [listReady, setListReady] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const opened = useRef(false);
  const skipMount = useRef(!!initial);
  const packRef = useRef(pack);
  packRef.current = pack;

  const liveOps = useMemo(() => splitOracleLens(pack.operators).live, [pack.operators]);
  const silentOps = useMemo(
    () => sortSilentOldest(splitOracleLens(pack.operators).silent),
    [pack.operators]
  );
  const tapeOps = tapeLens === "silent" ? silentOps : liveOps;
  useEffect(() => {
    if (tapeLens === "silent" && !silentOps.length) setTapeLens("live");
  }, [silentOps.length, tapeLens]);
  const rows = tapeOps.slice(offset, offset + ORACLE_PACK);

  const markEnter = enter.mark;
  const gen = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      const my = ++gen.current;
      if (!silent && packRef.current.operators.length) setPending(true);
      try {
        const incoming = await fetchOracleFeed(slug, rangeId);
        if (my !== gen.current) return;
        const next = applyOracleFeed(packRef.current, incoming);
        const fresh = enteringIds(
          packRef.current.operators.map((o) => ({ id: o.id })),
          next.operators.map((o) => ({ id: o.id }))
        );
        if (opened.current) markEnter(fresh);
        setPack(next);
        if (!next.operators.length) setListReady(true);
      } catch {
        setListReady(true);
      } finally {
        if (my === gen.current) setPending(false);
        markSynced();
      }
    },
    [markEnter, markSynced, rangeId, slug]
  );

  useKeepFresh(() => void load(true));
  useEffect(() => {
    if (skipMount.current) {
      skipMount.current = false;
      markSynced();
      return;
    }
    void load(true);
  }, [load, markSynced]);

  useEffect(() => {
    if (opened.current) return;
    if (!pack.operators.length) return;
    opened.current = true;
    enter.mark(liveOps.slice(0, ORACLE_PACK).map((row) => row.id));
    packEnter.mark(["pack"]);
    setListReady(true);
  }, [pack.operators, liveOps, enter.mark, packEnter.mark]);

  const offsetSeen = useRef(offset);
  useEffect(() => {
    if (offset === 0) return;
    if (offset < tapeOps.length) return;
    setOffset(
      Math.max(0, Math.floor(Math.max(0, tapeOps.length - 1) / ORACLE_PACK) * ORACLE_PACK)
    );
  }, [offset, tapeOps.length]);

  useEffect(() => {
    if (offsetSeen.current === offset) return;
    offsetSeen.current = offset;
    const ids = tapeOps.slice(offset, offset + ORACLE_PACK).map((row) => row.id);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
  }, [offset, tapeOps, enter.mark, packEnter.mark]);

  const tapeLensSeen = useRef(tapeLens);
  useEffect(() => {
    if (tapeLensSeen.current === tapeLens) return;
    tapeLensSeen.current = tapeLens;
    const ids = tapeOps.slice(0, ORACLE_PACK).map((row) => row.id);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
  }, [tapeLens, tapeOps, enter.mark, packEnter.mark]);

  useEffect(() => {
    const el = pinRef.current;
    if (!el) return;
    const chrome = document.querySelector(".stage-frame header.sticky");
    const pin =
      (chrome instanceof HTMLElement ? chrome.getBoundingClientRect().height : 64) + 8;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 1, rootMargin: `-${pin}px 0px 0px 0px` }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [pack.operators.length, listReady]);

  const battle = Boolean(def.refreshNft);
  const answer = fmtQuote(slug, pack.quote, locale);
  const seated = pack.operators.length;
  const posting = liveOps.length;
  const quiet = silentOps.length;
  const idle = Number.isFinite(pack.idle) ? pack.idle : 0;
  const liveLabel = seated
    ? `${posting.toLocaleString(loc(locale))} / ${seated.toLocaleString(loc(locale))}`
    : "—";
  const oracleSub = [
    quiet > 0 ? t("oracles.kpiQuiet").replace("{n}", quiet.toLocaleString(loc(locale))) : "",
    idle > 0 ? t("oracles.kpiIdle").replace("{n}", idle.toLocaleString(loc(locale))) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const oracleShort = seated > 0 && posting < def.minDataPoints;
  const tipH = tip?.height ?? pack.tipHeight;
  const ageBlocks = oracleAgeBlocks(tipH, pack.height);
  const updated =
    ageBlocks == null
      ? pack.height != null
        ? fmtHeight(pack.height, locale)
        : miss
      : ageBlocks === 0
        ? t("oracles.kpiUpdatedNow")
        : formatRelAge(0, locale, ageBlocks * ORACLE_BLOCK_MS);
  const updatedSub =
    pack.height != null
      ? t("oracles.kpiUpdatedSub").replace("{h}", pack.height.toLocaleString(loc(locale)))
      : t("oracles.kpiUpdatedSubMiss");

  return (
    <Shell>
      <div className="flex flex-col">
        <KpiGrid
          dense
          items={[
              {
                label: t("oracles.kpiPair"),
                value: def.pair,
                sub: t(
                  slug === "ergusd"
                    ? "oracles.kpiPairSubOfficial"
                    : slug === "xau-erg"
                      ? "oracles.kpiPairSubXau"
                      : "oracles.kpiPairSub"
                ),
                mark: <KpiMarkScale tone={INK.cyan} />,
                ink: INK.cyan,
                enter: 0,
              },
              {
                label: t("oracles.kpiAnswer"),
                value: answer,
                unavailable: pack.quote == null,
                sub: t(slug === "xau-erg" ? "oracles.kpiAnswerSubXau" : "oracles.kpiAnswerSub"),
                mark: <KpiMarkQuote tone={INK.gold} />,
                ink: INK.gold,
                enter: 1,
              },
              {
                label: t("oracles.kpiUpdated"),
                value: updated,
                unavailable: pack.height == null,
                sub: updatedSub,
                mark: <KpiMarkBell tone={INK.sky} />,
                ink: INK.sky,
                enter: 2,
              },
              {
                label: t("oracles.kpiBeat"),
                value: t("oracles.kpiBeatVal").replace("{n}", String(def.epochLength)),
                sub: t("oracles.kpiBeatSub").replace("{m}", String(def.epochLength * 2)),
                mark: <KpiMarkMetronome tone={INK.violet} />,
                ink: INK.violet,
                enter: 3,
              },
              {
                label: t("oracles.kpiOracles"),
                value: liveLabel,
                unavailable: !pack.operators.length,
                sub: oracleSub,
                pulse: oracleShort,
                mark: <KpiMarkUserGroup tone={INK.teal} />,
                ink: INK.teal,
                enter: 4,
              },
            ]}
          />

        <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2 lg:items-stretch">
          <section
            className="home-tile-enter mod flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
            style={{ "--enter": 5 } as CSSProperties}
          >
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex h-[22px] min-w-0 items-center gap-3">
                  <h2 className="m-0 text-[17px] font-semibold leading-[1.15] tracking-tight">
                    {t("oracles.chartTitle")}
                  </h2>
                  <span className="truncate text-[13px] leading-[1.15] text-[var(--muted)]">
                    {t(rangeId === "7d" ? "oracles.chartHint7d" : "oracles.chartHint30d")}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[12px] text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: "#8ec8ff" }} />
                    {t("oracles.chartOracle")}
                  </span>
                  {def.market ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "#f472b6" }} />
                      {t("oracles.chartMarket")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid grid-cols-2 gap-1">
                {CHART_RANGES.map((r) => {
                  const on = rangeId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRangeId(r.id)}
                      className={clsx(
                        "chip-press inline-flex h-6 w-full items-center justify-center rounded-[9px] px-2.5 text-[12px] font-medium tabular-nums",
                        "transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                        on
                          ? "is-pressed bg-[var(--panel-hover)] text-[var(--text)]"
                          : "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
                      )}
                    >
                      {t(r.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
            {ticksForChart(pack.ticks, rangeId).length >= 2 ? (
              <div className="min-h-[168px] flex-1">
                <DualLineChart
                  points={ticksForChart(pack.ticks, rangeId)}
                  skipBin
                  binMs={0}
                  yRight
                  fillPlot
                  tipPulse
                  revealKey={rangeId}
                  nameTxs={t("oracles.chartOracle")}
                  nameFees={t("oracles.chartMarket")}
                  formatTxs={(v) => fmtQuote(slug, v, locale)}
                  formatFees={(v) =>
                    fmtQuote(slug === "xau-erg" ? "xau-erg" : "erg-usd", v, locale)
                  }
                  locale={loc(locale)}
                />
              </div>
            ) : (
              <p className="flex min-h-[168px] flex-1 items-center justify-center text-[13px] text-[var(--muted)]">
                {t("oracles.chartWait")}
              </p>
            )}
          </section>

          <section
            className="home-tile-enter mod flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
            style={{ "--enter": 6 } as CSSProperties}
          >
            <OracleCouncil
              title={t("oracles.council")}
              live={liveOps}
              silent={silentOps}
              emptyHint={t("oracles.councilEmpty")}
              liveLabel={t("oracles.councilLive")}
              staleLabel={t("oracles.councilStale")}
              liveChip={t("oracles.councilLiveN").replace("{n}", String(liveOps.length))}
              silentChip={t("oracles.councilSilentN").replace("{n}", String(silentOps.length))}
              onSettled={(next) => {
                setTapeLens(next);
                setOffset(0);
              }}
            />
          </section>
        </div>

        {listReady ? (
        <div className="addr-sheet">
          <div ref={pinRef} className="h-px w-full" aria-hidden />
          <div className="addr-pan">
            <div
              className={clsx(
                "addr-head addr-lane addr-lane-x oracle-lane text-[12px] font-medium",
                battle && "is-battle",
                stuck && "is-stuck"
              )}
            >
              <div className="oracle-col-name">{t("oracles.colName")}</div>
              {battle ? (
                <>
                  <div className="oracle-col-crown">{t("oracles.colWinner")}</div>
                  <div className="oracle-col-wins">{t("oracles.colWins")}</div>
                  <div className="oracle-col-id">{t("oracles.colAddress")}</div>
                  <div className="oracle-col-num">{t("oracles.colPrice")}</div>
                  <div className="oracle-col-num">{t("oracles.colEpoch")}</div>
                </>
              ) : (
              <div className="oracle-col-answer">
                <span>{t("oracles.colAddress")}</span>
                <span>{t("oracles.colPrice")}</span>
              </div>
              )}
              <div className="oracle-col-num">{t("oracles.colWhen")}</div>
              <div className="oracle-col-num">{t("oracles.colFeeder")}</div>
              <div className="oracle-col-num">{t("oracles.colFee")}</div>
            </div>
            <div className={packEnter.enterClass("pack")}>
              <div
                className={clsx(
                  "transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  pending && "opacity-60"
                )}
              >
                {!rows.length ? (
                  <p className="px-3 py-4 text-[13px] text-[var(--muted)]">{t("oracles.emptyTape")}</p>
                ) : (
                  rows.map((row) => (
                    <OracleTapeRow
                      key={row.id}
                      row={row}
                      slug={slug}
                      locale={locale}
                      tipHeight={tipH}
                      ancient={t("oracles.whenAncient")}
                      battle={battle}
                      wonLastLabel={t("oracles.wonLast")}
                      enterClass={enter.enterClass(row.id) ?? ""}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
          {(tapeOps.length > 0 || offset > 0) && (
            <RankWindow
              offset={offset}
              pageSize={ORACLE_PACK}
              shown={rows.length}
              total={tapeOps.length}
              loc={loc(locale)}
              ofLabel={t("addresses.packOf")}
              prevLabel={t("addresses.packPrev")}
              nextLabel={t("addresses.packNext")}
              tapeLabel={t("oracles.packTape")}
              hint={t("oracles.packHint")}
              disabled={pending}
              onOffset={setOffset}
            />
          )}
        </div>
        ) : null}
      </div>
    </Shell>
  );
}

function OracleWon({ label }: { label: string }) {
  return (
    <span className="oracle-won inline-flex" style={{ color: INK.gold }} role="img" aria-label={label}>
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="6.25" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

function OracleTapeRow({
  row,
  slug,
  locale,
  tipHeight,
  ancient,
  battle,
  wonLastLabel,
  enterClass,
}: {
  row: OracleOperator;
  slug: OracleFeedSlug;
  locale: string;
  tipHeight: number | null;
  ancient: string;
  battle: boolean;
  wonLastLabel: string;
  enterClass: string;
}) {
  const seed = oracleOperatorSeed(row);
  const book = lookupAddress(row.address);
  const name = book?.name || oracleOperatorName(seed);
  const low = oracleErgLow(row.addressErgNano);
  return (
    <div
      id={`oracle-op-${row.id}`}
      className={clsx(
        "addr-lane addr-lane-x oracle-lane border-t border-[var(--border-soft)] text-[13px]",
        battle && "is-battle",
        enterClass
      )}
    >
      <div className="oracle-col-name flex min-w-0 items-center gap-1.5">
        <span
          className={clsx(
            "size-1.5 shrink-0 rounded-full",
            row.live === true ? "bg-[var(--up)] oracle-live-pip" : "bg-[var(--warning)]"
          )}
          aria-hidden
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={oracleOperatorMarkSrc(seed)} alt="" className="size-6 shrink-0 rounded-[5px]" />
        {row.address ? (
          <Link prefetch={false} href={`/address/${row.address}`} className="min-w-0 truncate text-accent hover:underline">
            {name}
          </Link>
        ) : (
          <Link prefetch={false} href={`/box/${row.boxId}`} className="min-w-0 truncate text-accent hover:underline">
            {name}
          </Link>
        )}
      </div>
      {battle ? (
        <>
          <div className="oracle-col-crown">
            {row.wonLast ? <OracleWon label={wonLastLabel} /> : null}
          </div>
          <div
            className="oracle-col-wins tabular-nums"
            style={row.wins ? { color: INK.gold } : undefined}
          >
            <span className={row.wins ? undefined : "text-[var(--muted)]"}>
              {(row.wins ?? 0).toLocaleString(loc(locale))}
            </span>
          </div>
        </>
      ) : null}
      {battle ? (
        <>
          <div className="oracle-col-id">
            {row.address ? (
              <Link
                prefetch={false}
                href={`/address/${row.address}`}
                className="min-w-0 truncate font-mono text-[12px] text-accent hover:underline"
                title={row.address}
              >
                {shortId(row.address, 5)}
              </Link>
            ) : (
              <span className="text-[var(--muted)]">—</span>
            )}
          </div>
          <div className="oracle-col-num tabular-nums">{fmtQuote(slug, row.quote, locale)}</div>
          <div className="oracle-col-num tabular-nums">
            {row.postedEpoch != null ? String(row.postedEpoch) : "—"}
          </div>
        </>
      ) : (
      <div className="oracle-col-answer">
        {row.address ? (
          <Link
            prefetch={false}
            href={`/address/${row.address}`}
            className="min-w-0 truncate font-mono text-[12px] text-accent hover:underline"
            title={row.address}
          >
            {shortId(row.address, 5)}
          </Link>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
        <span className="min-w-0 truncate tabular-nums">{fmtQuote(slug, row.quote, locale)}</span>
      </div>
      )}
      <div className="oracle-col-num tabular-nums text-[var(--muted)]">
        {oracleWhenLabel({
          tsMs: row.tsMs,
          height: row.height,
          tipHeight,
          locale,
          ancient,
        })}
      </div>
      <div
        className={clsx(
          "oracle-col-num tabular-nums",
          low ? "oracle-erg-low" : row.addressErgNano != null && "text-[var(--up)]"
        )}
      >
        {row.addressErgNano != null ? formatErgPrecise(row.addressErgNano, locale) : "—"}
      </div>
      <div className="oracle-col-num tabular-nums" style={{ color: INK.gold }}>
        {row.feeNano != null ? formatErgPrecise(row.feeNano, locale) : "—"}
      </div>
    </div>
  );
}
