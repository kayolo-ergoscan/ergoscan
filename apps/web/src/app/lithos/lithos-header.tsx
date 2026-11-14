"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { LithosProtocolStats } from "@ergoscan/shared";
import { EvidenceBadge, EvidenceDot, EVIDENCE_TONE } from "@/components/EvidenceBadge";
import { KpiLabelMark, KpiNum, KpiTileRail, Segmented } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { Tip } from "@/components/Tip";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { formatDottedDay, formatGroupedNumber, formatH24, formatInt } from "@/lib/format";
import { LITHOS_LINKS } from "@/lib/lithos-links";
import {
  blocksToMs,
  ergText,
  formatShare,
  formatSpan,
  formatWindowDays,
  hashrateText,
  joinAnd,
  lithosPipeline,
  splitHashrate,
  type PipelineMark,
} from "@/lib/lithos-header";
import { HOME, INK } from "@/lib/palette";
import type { EvidenceKind } from "@/lib/trust-board";
import { LithosDailyChart, type LithosChartView } from "./lithos-chart";
import type { LithosFindItem } from "./lithos-view";

export type LithosClientRelease = { version: string; publishedAt: string | null; url: string };

const LEGEND: EvidenceKind[] = ["chain", "decoded", "heuristic", "telemetry", "external"];
const ROLLUP_INK = { collect: "var(--c-block, #ebcb71)", check: "var(--k-nft, #c19fe9)", pay: "var(--up, #88d9a5)" };

function litWhole(raw: string | undefined): number {
  const s = (raw ?? "0").split(".")[0] ?? "0";
  return /^\d+$/.test(s) ? Number(BigInt(s) / 1_000_000_000n) : 0;
}

/** Relative times tick once a minute. */
function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

function LithosKpi({
  label,
  value,
  sub,
  ink,
  enter,
  mark,
  ev,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  ink: string;
  enter: number;
  mark: ReactNode;
  ev: EvidenceKind;
}) {
  const t = useT();
  return (
    <div
      className="kpi-tile kpi-tile--dense flex h-auto min-w-0 overflow-visible rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3 py-1.5"
      style={{ "--kpi-ink": ink, "--enter": enter } as CSSProperties}
    >
      <KpiTileRail />
      <div className="kpi-tile-row flex w-full min-w-0 flex-1 justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="kpi-label-row">
            <KpiLabelMark mark={mark} />
            <p className="text-[13px] leading-[1.15]" style={{ color: HOME.forming }}>
              {label}
            </p>
          </div>
          <p className="kpi-value mt-0.5 truncate text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>{value}</KpiNum>
            <Tip content={t(`trust.evidence.${ev}`)}>
              <span className="ml-2 inline-flex align-middle" suppressHydrationWarning>
                <EvidenceDot kind={ev} className="!h-[7px] !w-[7px]" />
              </span>
            </Tip>
          </p>
          <p className="kpi-sub mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]" suppressHydrationWarning>
            {sub}
          </p>
        </div>
        <div className="kpi-tile-mark">{mark}</div>
      </div>
    </div>
  );
}

/** A class word on a wide screen, its dot alone on a phone (the legend explains the dots). */
function Ev({ kind, className }: { kind: EvidenceKind; className?: string }) {
  return (
    <>
      <EvidenceBadge kind={kind} compact className={clsx("hidden sm:inline-flex", className)} />
      <EvidenceDot kind={kind} className={clsx("ml-0.5 sm:hidden", className)} />
    </>
  );
}

function Fig({
  value,
  unit,
  label,
  labelShort,
  hint,
  ev,
  sub,
  extra,
  first = false,
}: {
  value: string;
  unit: string;
  label: string;
  labelShort?: string;
  hint?: string;
  ev: EvidenceKind;
  sub: ReactNode;
  extra?: ReactNode;
  first?: boolean;
}) {
  return (
    <div className={clsx("min-w-0 px-2 py-0.5 sm:px-3.5", first ? "!pl-0" : "border-l border-[var(--border)]")}>
      <p className="whitespace-nowrap font-mono text-[19px] font-semibold leading-[1.05] tracking-[-0.06em] sm:text-[26px]">
        {value}
        <small className="ml-0.5 text-[12px] font-medium tracking-[-0.03em] text-[var(--muted)] sm:ml-1 sm:text-[15px]">
          {unit}
        </small>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] leading-[1.2] text-[var(--muted)] sm:text-[12px]">
        <Tip content={hint}>
          <span className={clsx(hint && "cursor-help")}>
            {labelShort ? (
              <>
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{labelShort}</span>
              </>
            ) : (
              label
            )}
          </span>
        </Tip>
        <Ev kind={ev} className="sm:ml-1" />
      </div>
      <p className="mt-0.5 text-[10.5px] leading-[1.3] text-[var(--muted-2)] sm:whitespace-nowrap sm:text-[11px]">{sub}</p>
      {extra}
    </div>
  );
}

function StageLabel({ at, children }: { at: number; children: ReactNode }) {
  // Centred under its dot, kept inside the column at the ends.
  const style: CSSProperties =
    at < 0.25 ? { left: 0 } : at > 0.75 ? { right: 0 } : { left: `${at * 100}%`, transform: "translateX(-50%)" };
  return (
    <div className="absolute top-0 whitespace-nowrap text-center" style={style}>
      {children}
    </div>
  );
}

function Pipeline({ stats }: { stats: LithosProtocolStats }) {
  const t = useT();
  const { locale, tn } = useI18n();
  const p = lithosPipeline(stats);
  const newest: PipelineMark | undefined = p.collect[0];
  const checkBank = p.check.reduce((s, m) => s + m.bank, 0);
  const lefts = p.check.map((m) => m.left);
  const listText = joinAnd(lefts.map((n) => formatInt(n, locale)), locale);
  const lastLeft = lefts[lefts.length - 1] ?? 0;
  const primary = "font-mono text-[11.5px] font-semibold leading-[1.3] tracking-[-0.04em] text-[var(--text)]";
  const second = "text-[10.5px] leading-[1.3] text-[var(--muted-2)]";
  const track = "absolute inset-x-0 top-[8px] h-[6px] rounded-full bg-[var(--wash-mid)]";
  return (
    <div className="lithos-pipe rounded-[8px] bg-[var(--wash-faint)] px-3 pb-2 pt-2.5">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--muted)]">
        <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-[var(--up)]">
          <i className="inline-block h-2 w-2 rounded-full bg-[var(--up)] shadow-[0_0_0_3px_rgb(var(--up-rgb)/0.18)]" />
          {t("lithosH.now")}
        </span>
        <Tip content={t("lithosH.pipeHint")}>
          <span className="min-w-0 cursor-help truncate">
            {t("lithosH.inFlight")}
            {newest && newest.left > 0 ? (
              <span className="hidden sm:inline">
                {" · "}
                {t("lithosH.collectLeft").replace("{t}", formatSpan(blocksToMs(newest.left), locale))}
              </span>
            ) : null}
          </span>
        </Tip>
        <span className="ml-auto shrink-0">
          <EvidenceBadge kind="decoded" compact />
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-x-2">
        {/* Collect */}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold leading-[1.2] text-[var(--text)]">{t("lithosH.stageCollect")}</p>
          <p className={clsx(second, "truncate")}>
            <span className="hidden sm:inline">{t("lithosH.stageSub")}</span>
            <span className="sm:hidden">{t("lithosH.stageSubShort")}</span>
          </p>
          <div className="relative mt-1.5 h-[22px]">
            <span className={track} />
            {newest ? (
              <span
                className="absolute left-0 top-[8px] h-[6px] rounded-full"
                style={{ width: `${newest.at * 100}%`, background: ROLLUP_INK.collect, opacity: 0.5 }}
              />
            ) : null}
            {p.collect.map((m, i) => (
              <span
                key={m.h}
                className="absolute top-[11px] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${m.at * 100}%` }}
              >
                {i === 0 ? (
                  <span
                    className="absolute left-1/2 top-1/2 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ background: ROLLUP_INK.collect, opacity: 0.16 }}
                  />
                ) : null}
                <span
                  className="relative block rounded-full border-2 border-[var(--module)]"
                  style={{ width: i === 0 ? 15 : 11, height: i === 0 ? 15 : 11, background: ROLLUP_INK.collect }}
                />
              </span>
            ))}
          </div>
          <div className="relative mt-1 h-[30px]">
            {newest ? (
              <StageLabel at={newest.at}>
                <Link prefetch={false} href={`/block/${newest.h}`} className={clsx(primary, "block hover:underline")}>
                  {formatInt(newest.h, locale)}
                </Link>
                <p className={second}>
                  {t("lithosH.roundMiners").replace("{n}", formatInt(newest.miners, locale))}
                  <span className="hidden sm:inline"> · {ergText(newest.bank, locale)} ERG</span>
                  {newest.left === 0 ? <span className="hidden sm:inline"> · {t("lithosH.awaiting")}</span> : null}
                </p>
              </StageLabel>
            ) : (
              <p className={second}>{t("lithosH.noRound")}</p>
            )}
          </div>
        </div>
        {/* Check */}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold leading-[1.2] text-[var(--text)]">
            <span className="hidden sm:inline">{t("lithosH.stageCheck")}</span>
            <span className="sm:hidden">{t("lithosH.stageCheckShort")}</span>
          </p>
          <p className={clsx(second, "truncate")}>
            <span className="hidden sm:inline">{t("lithosH.stageSub")}</span>
            <span className="sm:hidden">{t("lithosH.stageSubShort")}</span>
          </p>
          <div className="relative mt-1.5 h-[22px]">
            <span className={track} />
            {p.check.map((m) => (
              <span
                key={m.h}
                className="absolute top-[11px] block h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--module)]"
                style={{ left: `${m.at * 100}%`, background: ROLLUP_INK.check }}
              />
            ))}
          </div>
          <div className="mt-1 h-[30px] min-w-0">
            {p.check.length ? (
              <>
                <p className={clsx(primary, "truncate")}>
                  {tn("lithosH.rounds", p.check.length, formatInt(p.check.length, locale))}
                  <span className="hidden sm:inline"> · {ergText(checkBank, locale, 1)} ERG</span>
                </p>
                <p className={clsx(second, "truncate")}>
                  <span className="hidden sm:inline">
                    {tn("lithosH.toPayout", lastLeft).replace("{list}", listText)}
                  </span>
                  <span className="sm:hidden">{t("lithosH.toPayoutShort").replace("{list}", listText)}</span>
                </p>
              </>
            ) : (
              <p className={second}>{t("lithosH.noRound")}</p>
            )}
          </div>
        </div>
        {/* Payout */}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold leading-[1.2] text-[var(--text)]">{t("lithosH.stagePay")}</p>
          <p className={clsx(second, "truncate")}>
            <span className="hidden sm:inline">{t("lithosH.stagePaySub")}</span>
            <span className="sm:hidden">{t("lithosH.stagePaySubShort")}</span>
          </p>
          <div className="relative mt-1.5 h-[22px]">
            <span className={track} />
            <span className="absolute left-[3px] top-[11px] flex -translate-y-1/2 gap-[2px]">
              {Array.from({ length: Math.min(5, p.payoutN) }, (_, i) => (
                <span
                  key={i}
                  className="block h-[7px] w-[7px] rounded-full"
                  style={{ background: ROLLUP_INK.pay, opacity: 0.95 - i * 0.15 }}
                />
              ))}
            </span>
          </div>
          <div className="mt-1 h-[30px] min-w-0">
            <p className={clsx(primary, "truncate")}>{tn("lithosH.rounds", p.payoutN, formatInt(p.payoutN, locale))}</p>
            <p className={clsx(second, "truncate")}>
              {t("lithosH.remain").replace("{v}", ergText(p.payoutNano, locale))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="hidden sm:inline">{t("lithosH.classes")}</span>
      {LEGEND.map((k) => (
        <Tip key={k} content={t(`trust.evidence.${k}.hint`)}>
          <span className={clsx("inline-flex cursor-help items-center gap-1", k === "telemetry" && "hidden sm:inline-flex")}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: EVIDENCE_TONE[k] }} />
            {t(`trust.evidence.${k}.short`)}
          </span>
        </Tip>
      ))}
    </span>
  );
}

function EconStat({
  label,
  value,
  sub,
  hint,
  ev,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  ev?: EvidenceKind;
}) {
  return (
    <div className="min-w-0 border-l border-[var(--border)] px-2.5 max-lg:[&:nth-child(even)]:border-l-0 max-lg:[&:nth-child(even)]:pl-0 lg:px-3.5">
      <div className="flex min-w-0 items-center gap-1 text-[11.5px] text-[var(--muted)]">
        <Tip content={hint}>
          <span className={clsx("truncate", hint && "cursor-help")}>{label}</span>
        </Tip>
        {ev ? <Ev kind={ev} /> : null}
      </div>
      <p className="mt-[3px] whitespace-nowrap font-mono text-[15px] font-semibold leading-[1.2] tracking-[-0.04em]">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[10.5px] leading-[1.3] text-[var(--muted-2)]">{sub}</p> : null}
    </div>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return <small className="text-[12px] font-medium tracking-normal text-[var(--muted)]">{children}</small>;
}

export function LithosHeader({
  stats,
  latest,
  finds,
  holdingLit,
  client,
  updatedAt,
}: {
  stats: LithosProtocolStats | null;
  latest: LithosFindItem | null;
  finds: number | null;
  holdingLit: string | null;
  client: LithosClientRelease | null;
  updatedAt: string | null;
}) {
  const t = useT();
  const { locale, tn } = useI18n();
  const now = useNow();
  const [view, setView] = useState<LithosChartView>("blocks");
  const hash = stats?.hash ?? null;
  const hs = splitHashrate(hash?.hs);
  const windowMs = hash ? hash.to - hash.from : 0;
  const days = hash ? formatWindowDays(windowMs, locale) : "";
  const launch = stats?.blocks.launch ?? null;
  const launchText = launch != null ? formatDottedDay(launch, "UTC") : "";
  const series = stats?.series ?? [];
  const litErg = stats?.litErg ?? null;

  // Economics: the newest find's outputs.
  const round = litWhole(latest?.holdingLit);
  const finder = litWhole(latest?.finderLit);
  const team = litWhole(latest?.teamLit);
  const inv = litWhole(latest?.investorLit);
  const aud = litWhole(latest?.auditorLit);
  const founders = team + inv + aud;
  const perBlock = round + finder + founders;
  const totalLit = litWhole(holdingLit ?? undefined);

  const snapTs = updatedAt ? Date.parse(updatedAt) : stats?.tip.ts ?? null;
  const lastTs = latest?.ts ?? null;
  const collateral = stats?.collateral ?? null;

  const tiles: ReactNode[] = [];
  const blocksTotal = stats?.blocks.total || finds || 0;
  if (blocksTotal) {
    tiles.push(
      <LithosKpi
        key="blocks"
        label={t("lithosH.blocks")}
        value={formatInt(blocksTotal, locale)}
        sub={
          stats
            ? t("lithosH.blocksSub")
                .replace("{d1}", formatInt(stats.blocks.d1, locale))
                .replace("{d7}", formatInt(stats.blocks.d7, locale))
                .replace("{launch}", launchText)
            : t("lithosH.blocksAll")
        }
        ink={INK.violet}
        enter={0}
        mark={<KpiMark id="block" tone={INK.violet} />}
        ev="decoded"
      />
    );
  }
  if (latest && lastTs != null) {
    tiles.push(
      <LithosKpi
        key="last"
        label={t("lithosH.last")}
        value={formatSpan(now - lastTs, locale)}
        sub={t("lithosH.lastSub").replace("{h}", formatInt(latest.height, locale))}
        ink={INK.teal}
        enter={1}
        mark={<KpiMark id="time" tone={INK.teal} />}
        ev="decoded"
      />
    );
  }
  if (hash) {
    tiles.push(
      <LithosKpi
        key="next"
        label={t("lithosH.next")}
        value={`≈ ${formatSpan(windowMs / hash.n, locale, true)}`}
        sub={t("lithosH.nextSub").replace("{days}", days)}
        ink={INK.coral}
        enter={2}
        mark={<KpiMark id="interval" tone={INK.coral} />}
        ev="heuristic"
      />
    );
  }
  if (collateral) {
    tiles.push(
      <LithosKpi
        key="collateral"
        label={t("lithosH.collateral")}
        value={`${formatInt(collateral.active, locale)} / ${formatInt(collateral.max, locale)}`}
        sub={t("lithosH.collateralSub").replace("{n}", formatInt(collateral.queue, locale))}
        ink={INK.gold}
        enter={3}
        mark={<KpiMark id="locked" tone={INK.gold} />}
        ev="chain"
      />
    );
  }

  const chartTitle =
    view === "blocks" ? t("lithosH.chartBlocks") : view === "hash" ? t("lithosH.chartHash") : t("lithosH.chartShare");
  const chartNote = (view === "blocks" ? t("lithosH.noteBlocks") : view === "hash" ? t("lithosH.noteHash") : t("lithosH.noteShare")).replace(
    "{launch}",
    launchText
  );
  const inErg = (lit: number, nano: number) =>
    litErg != null ? t("lithosH.inErg").replace("{v}", formatGroupedNumber(nano / 1e9 + lit * litErg, 2, 2, locale)) : null;

  return (
    <section className="addr-drop lithos-head mb-3 grid gap-2">
      <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <article className="flex min-w-0 flex-col gap-2.5 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <img src="/lithos-mark.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
              <h2 className="text-[16px] font-semibold leading-none">{t("nav.lithosProtocol")}</h2>
              <span
                className="whitespace-nowrap rounded-[4px] px-[7px] py-[3px] text-[12px] font-semibold leading-[1.1] tracking-[0.01em]"
                style={{ background: "var(--f-block)", color: "var(--k-ink)" }}
              >
                {t("lithosH.badge")}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-none">
              {LITHOS_LINKS.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {t(link.key)}
                </a>
              ))}
              <Link prefetch={false} href="/defi/lithos" className="text-accent hover:underline">
                LithosDex
              </Link>
              {client ? (
                <span className="hidden items-center gap-1.5 text-[var(--muted)] sm:inline-flex">
                  <Tip content={t("lithosH.clientHint")}>
                    <a href={client.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {t("lithosH.client")}{" "}
                      <b className="font-mono font-semibold text-[var(--text)]">{client.version}</b>
                      {client.publishedAt ? ` · ${formatDottedDay(Date.parse(client.publishedAt), "UTC")}` : ""}
                    </a>
                  </Tip>
                  <EvidenceBadge kind="external" compact />
                </span>
              ) : null}
            </div>
          </div>
          <p className="text-[13px] leading-[1.45] text-[var(--text)]">
            <span className="hidden sm:inline">{t("lithosH.tagline")}</span>
            <span className="sm:hidden">{t("lithosH.taglineShort")}</span>
          </p>

          {stats && (hs || stats.miners.round != null) ? (
            <div className="grid grid-cols-3">
              <Fig
                first
                value={hs?.value ?? "—"}
                unit={hs?.unit ?? "GH/s"}
                label={t("lithosH.hash")}
                labelShort={t("lithosH.hashShort")}
                hint={t("lithosH.hashHint")}
                ev="heuristic"
                sub={
                  hash ? (
                    <>
                      {t("lithosH.hashSub")
                        .replace("{days}", days)
                        .replace("{err}", formatInt(Math.round(hash.err * 100), locale))}
                      <span className="hidden sm:inline"> · {tn("lithosH.hashBlocks", hash.n, formatInt(hash.n, locale))}</span>
                    </>
                  ) : (
                    "—"
                  )
                }
                extra={
                  stats.nisp ? (
                    <Tip
                      content={t("lithosH.nispHint")
                        .replace("{miners}", formatInt(stats.nisp.miners, locale))
                        .replace("{round}", formatInt(stats.nisp.h, locale))}
                    >
                      <p className="mt-0.5 flex w-fit cursor-help items-center gap-1 text-[10.5px] leading-[1.3] text-[var(--muted)] sm:text-[11px]">
                        <span className="hidden sm:inline">{t("lithosH.nisp").replace("{v}", hashrateText(stats.nisp.hs))}</span>
                        <span className="sm:hidden">
                          {t("lithosH.nispShort").replace("{v}", splitHashrate(stats.nisp.hs)?.value ?? "—")}
                        </span>
                        <EvidenceDot kind="heuristic" />
                      </p>
                    </Tip>
                  ) : null
                }
              />
              <Fig
                value={hash && hash.netN > 0 ? formatShare((hash.n / hash.netN) * 100, locale) : "—"}
                unit="%"
                label={t("lithosH.share")}
                labelShort={t("lithosH.shareShort")}
                ev="decoded"
                sub={
                  hash ? (
                    <>
                      {t("lithosH.shareSub")
                        .replace("{n}", formatInt(hash.n, locale))
                        .replace("{total}", formatInt(hash.netN, locale))}
                      <span className="hidden sm:inline"> · {t("lithosH.hashSub").split(" · ")[0]!.replace("{days}", days)}</span>
                    </>
                  ) : (
                    "—"
                  )
                }
                extra={
                  stats.netHs ? (
                    <Tip content={t("lithosH.netHint")}>
                      <p className="mt-0.5 flex w-fit cursor-help items-center gap-1 text-[10.5px] leading-[1.3] text-[var(--muted)] sm:text-[11px]">
                        {t("lithosH.net").replace("{v}", hashrateText(stats.netHs))}
                        <EvidenceDot kind="heuristic" />
                      </p>
                    </Tip>
                  ) : null
                }
              />
              <Fig
                value={stats.miners.round != null ? formatInt(stats.miners.round, locale) : "—"}
                unit={stats.miners.registry != null ? `/ ${formatInt(stats.miners.registry, locale)}` : ""}
                label={t("lithosH.miners")}
                hint={t("lithosH.minersHint")}
                ev="decoded"
                sub={
                  <>
                    <span className="hidden sm:inline">{t("lithosH.minersSub")}</span>
                    <span className="sm:hidden">{t("lithosH.minersSubShort")}</span>
                  </>
                }
                extra={
                  stats.rounds.holding[0] ? (
                    <Link
                      prefetch={false}
                      href={`/block/${stats.rounds.holding[0].h}`}
                      className="mt-0.5 block truncate text-[10.5px] leading-[1.3] hover:underline sm:text-[11px]"
                    >
                      {t("lithosH.minersRound").replace("{h}", formatInt(stats.rounds.holding[0].h, locale))}
                    </Link>
                  ) : null
                }
              />
            </div>
          ) : null}

          {stats ? <Pipeline stats={stats} /> : null}

          {stats ? (
            <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-[1.35] text-[var(--muted-2)]">
              <span suppressHydrationWarning>
                {t("lithosH.snapshot")
                  .replace("{h}", formatInt(stats.tip.height, locale))
                  .replace("{time}", snapTs != null ? formatH24(snapTs, "UTC", false) : "—")}
              </span>
              <EvidenceBadge kind="telemetry" compact />
              <span className="mx-1 hidden h-3 w-px bg-[var(--border)] sm:inline-block" aria-hidden />
              <Legend />
            </div>
          ) : null}
        </article>

        {tiles.length || series.length ? (
          <div className="grid min-w-0 content-start gap-2 lg:grid-rows-[auto_1fr]">
            {tiles.length ? <div className="grid grid-cols-2 gap-2">{tiles}</div> : null}
            {series.length > 1 ? (
              <div className="flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px]" style={{ color: HOME.forming }}>
                    {chartTitle}
                  </span>
                  <EvidenceBadge kind={view === "hash" ? "heuristic" : "decoded"} compact />
                  <span className="w-full sm:ml-auto sm:w-auto">
                    <Segmented<LithosChartView>
                      value={view}
                      onChange={setView}
                      options={[
                        { id: "blocks", label: t("lithosH.tabBlocks") },
                        { id: "hash", label: t("lithosH.tabHash") },
                        { id: "share", label: t("lithosH.tabShare") },
                      ]}
                    />
                  </span>
                </div>
                <div className="mt-1.5 min-h-0 flex-1">
                  <LithosDailyChart series={series} view={view} height={132} />
                </div>
                <p className="mt-1 text-[11px] leading-[1.35] text-[var(--muted-2)]">{chartNote}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {perBlock > 0 ? (
        <div className="lithos-econ grid items-center gap-y-3 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-2.5 max-lg:grid-cols-2 lg:grid-cols-[minmax(0,1.7fr)_repeat(4,minmax(0,1fr))]">
          <div className="min-w-0 max-lg:col-span-2 lg:pr-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Tip content={t("lithosH.econHint")}>
                <span className="cursor-help text-[13px]" style={{ color: HOME.forming }}>
                  {t("lithosH.econ")}
                </span>
              </Tip>
              <EvidenceBadge kind="decoded" compact />
              <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-[var(--muted-2)]">
                <span>
                  <b className="font-mono font-semibold text-[var(--text)]">{formatInt(perBlock, locale)}</b> LIT
                </span>
                {litErg != null ? (
                  <Tip content={t("lithosH.litHint")}>
                    <span className="inline-flex cursor-help items-center gap-1">
                      ≈ {formatGroupedNumber(perBlock * litErg, 2, 2, locale)} ERG
                      <EvidenceDot kind="heuristic" />
                    </span>
                  </Tip>
                ) : null}
              </span>
            </div>
            <div className="mt-2 flex h-2.5 gap-[2px]" aria-hidden>
              <span className="rounded-[3px]" style={{ flex: `${round} 1 0`, background: "var(--econ-round)", minWidth: 4 }} />
              <span className="rounded-[3px]" style={{ flex: `${finder} 1 0`, background: "var(--econ-finder)", minWidth: 4 }} />
              <span className="rounded-[3px]" style={{ flex: `${founders} 1 0`, background: "var(--econ-founders)", minWidth: 4 }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-[var(--muted)]">
              {(
                [
                  [round, "var(--econ-round)", t("lithosH.econRound"), null],
                  [finder, "var(--econ-finder)", t("lithosH.econFinder"), null],
                  [
                    founders,
                    "var(--econ-founders)",
                    t("lithosH.econFounders"),
                    `${t("lithosP.team")} ${formatInt(team, locale)} · ${t("lithosP.investors")} ${formatInt(inv, locale)} · ${t("lithosP.auditor")} ${formatInt(aud, locale)} LIT`,
                  ],
                ] as const
              ).map(([v, c, label, hint]) => (
                <Tip key={label} content={hint}>
                  <span className={clsx("inline-flex items-center gap-[5px]", hint && "cursor-help")}>
                    <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: c }} />
                    <b className="font-mono font-semibold text-[var(--text)]">{formatInt(v, locale)}</b> {label}
                  </span>
                </Tip>
              ))}
            </div>
          </div>
          {stats?.bank.genesisNano != null ? (
            <EconStat
              label={t("lithosH.genesis")}
              hint={t("lithosH.genesisHint")}
              value={
                <>
                  {ergText(stats.bank.genesisNano, locale, 3)} <Unit>ERG</Unit>
                </>
              }
              sub={latest ? t("lithosH.genesisSub").replace("{h}", formatInt(latest.height, locale)) : undefined}
            />
          ) : null}
          {stats?.bank.avgNano != null ? (
            <EconStat
              label={t("lithosH.bankAvg").replace("{days}", days)}
              hint={t("lithosH.bankAvgHint")}
              value={
                <>
                  {ergText(stats.bank.avgNano, locale)} <Unit>ERG + {formatInt(round, locale)} LIT</Unit>
                </>
              }
              sub={
                inErg(round, stats.bank.avgNano) ? (
                  <span className="inline-flex items-center gap-1">
                    {inErg(round, stats.bank.avgNano)}
                    <EvidenceDot kind="heuristic" />
                  </span>
                ) : undefined
              }
            />
          ) : null}
          {stats && stats.bank.totalN > 0 ? (
            <EconStat
              label={t("lithosH.bankTotal")}
              value={
                <>
                  {formatInt(stats.bank.totalNano / 1e9, locale)} <Unit>ERG</Unit>
                  {totalLit ? (
                    <span className="hidden sm:inline">
                      {" "}
                      <Unit>+ {formatInt(totalLit, locale)} LIT</Unit>
                    </span>
                  ) : null}
                </>
              }
              sub={
                <span className="inline-flex items-center gap-1">
                  {litErg != null
                    ? t("lithosH.bankTotalSub")
                        .replace("{n}", tn("lithosH.rounds", stats.bank.totalN, formatInt(stats.bank.totalN, locale)))
                        .replace("{v}", formatInt(stats.bank.totalNano / 1e9 + totalLit * litErg, locale))
                    : tn("lithosH.rounds", stats.bank.totalN, formatInt(stats.bank.totalN, locale))}
                  {litErg != null ? <EvidenceDot kind="heuristic" /> : null}
                </span>
              }
            />
          ) : null}
          {collateral ? (
            <EconStat
              label={t("lithosH.queue")}
              ev="chain"
              value={
                <>
                  {formatInt(collateral.queue, locale)} <Unit>· {formatInt(collateral.queueNano / 1e9, locale)} ERG</Unit>
                </>
              }
              sub={t("lithosH.queueSub").replace("{n}", formatInt(collateral.max, locale))}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

