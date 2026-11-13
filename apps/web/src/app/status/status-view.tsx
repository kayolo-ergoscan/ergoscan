"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiMark } from "@/components/kpi-marks";
import { EvidenceBadge, EvidenceDot, EVIDENCE_TONE } from "@/components/EvidenceBadge";
import { Shell } from "@/components/Shell";
import { publicGatewayHref } from "@/lib/config";
import { INK } from "@/lib/palette";
import {
  fetchTrustBoard,
  type TrustBoard,
  type TrustFeedChip,
  type TrustMetric,
  type TrustSlice,
} from "@/lib/trust-board";
import {
  Feed,
  FeedAmount,
  FeedCount,
  FeedPhrase,
  FeedPlate,
  FeedRow,
  FeedSection,
} from "@/components/feed/Feed";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { formatGroupedNumber, formatH24, formatInt, formatPct, formatStamp } from "@/lib/format";
import { countText } from "@/lib/i18n/messages";
import type { EvidenceKind, TrustState } from "@/lib/trust-board";
import type { ApiUse } from "@/lib/api-use";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

function localeId(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function ageText(ms: number, locale: string): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return new Intl.NumberFormat(localeId(locale), { maximumFractionDigits: 0 }).format(
    hours / 24
  ) + "d";
}

function utcText(ms: number, _locale: string): string {
  const stamp = formatStamp(ms, "UTC");
  return stamp === "—" ? stamp : `${stamp} UTC`;
}

/** Status tokens: green when operational, amber while catching up or degraded, red when unreachable. */
function stateTone(state: TrustState): string {
  return state === "operational"
    ? "var(--up)"
    : state === "unavailable"
      ? "var(--down)"
      : "var(--warning)";
}

/** The worst of the states: one red system makes the whole banner red. */
function worstState(states: TrustState[]): TrustState {
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("catching-up")) return "catching-up";
  return "operational";
}

type SystemLine = { id: string; name: string; state: TrustState };

/** «All 7 systems operational · 23:24 UTC», or which systems are not. */
function StatusBanner({ systems, checkedAtMs }: { systems: SystemLine[]; checkedAtMs: number }) {
  const t = useT();
  const { locale } = useI18n();
  const off = systems.filter((s) => s.state !== "operational");
  const state = worstState(systems.map((s) => s.state));
  const tone = stateTone(state);
  const n = systems.length;
  const head = off.length
    ? countText(t, locale, "status.banner.some", off.length).replace("{total}", formatInt(n, locale))
    : countText(t, locale, "status.banner.ok", n);
  return (
    <div
      className="mt-2.5 flex min-h-[44px] flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[14px] px-3 py-2"
      style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}
      role="status"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tone }} aria-hidden />
      <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-[var(--text)]">
        {head}
        {off.length ? (
          <span className="block text-[12px] font-normal text-[var(--muted)]">
            {off.map((s) => `${s.name} · ${t(`status.state.${s.state}`)}`).join(", ")}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--muted)]">
        {formatH24(checkedAtMs, "UTC", false)} UTC
      </span>
    </div>
  );
}

/**
 * Phone: the row a system folds to — status dot, name, its key figure. A tap opens the card.
 * Desktop never shows it; the card is always open there.
 */
function SystemRow({
  name,
  state,
  figure,
  open,
  onToggle,
  controls,
}: {
  name: string;
  state: TrustState;
  figure: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left md:hidden"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: stateTone(state) }}
        role="img"
        aria-label={t(`status.state.${state}`)}
      />
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--text)]">{name}</span>
      <span className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--muted)]">{figure}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className={clsx(
          "shrink-0 text-[var(--muted-2)] transition-transform duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          open && "rotate-180"
        )}
      >
        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** A slice's figure for its phone row: the network height, or how many blocks it is behind. */
function sliceFigure(slice: TrustSlice, t: (k: string) => string, locale: string): string {
  const value = (id: string) => slice.metrics.find((m) => m.id === id)?.value;
  if (slice.id === "gateway") {
    const h = value("height");
    if (typeof h === "number") return `#${formatInt(h, locale)}`;
  }
  const lag = value("lag");
  if (typeof lag === "number") return t("status.row.behind").replace("{n}", formatInt(lag, locale));
  return t(`status.state.${slice.state}`);
}

/** Phone: the evidence badges become dots on each figure; this says once what each dot means. */
function EvidenceLegend({ kinds }: { kinds: EvidenceKind[] }) {
  const t = useT();
  if (!kinds.length) return null;
  return (
    <section className="mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 md:hidden">
      <h2 className="text-[12px] font-medium text-[var(--muted)]">{t("status.legend")}</h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-start gap-2 text-[12px] leading-snug">
            <span
              className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: EVIDENCE_TONE[kind] }}
              aria-hidden
            />
            <span>
              <span className="font-medium text-[var(--text)]">{t(`trust.evidence.${kind}`)}</span>
              <span className="text-[var(--muted)]"> — {t(`trust.evidence.${kind}.hint`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StatusView({
  initial,
  initialApi,
}: {
  initial: TrustBoard;
  initialApi: ApiUse | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const [board, setBoard] = useState(initial);
  const [api, setApi] = useState(initialApi);
  const [pending, setPending] = useState(false);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setPending(true);
      void Promise.all([
        fetchTrustBoard(),
        fetch("/status/usage", { cache: "no-store", headers: { Accept: "application/json" } })
          .then((r) => (r.ok ? (r.json() as Promise<ApiUse>) : null))
          .catch(() => null),
      ])
        .then(([next, usage]) => {
          setBoard(next);
          if (usage) setApi(usage);
          markSynced(next.checkedAtMs);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [markSynced]
  );

  useEffect(() => {
    markSynced(initial.checkedAtMs);
    const id = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(id);
  }, [initial.checkedAtMs, load, markSynced]);

  useKeepFresh(() => load(true));

  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const apiState: TrustState = api?.ok ? "operational" : "unavailable";
  const systems: SystemLine[] = [
    ...board.slices.map((slice) => ({
      id: slice.id,
      name: t(`status.service.${slice.id}`),
      state: slice.state,
    })),
    { id: "api", name: t("status.api.title"), state: apiState },
  ];
  const kinds = Array.from(
    new Set(board.slices.flatMap((slice) => slice.metrics.map((m) => m.evidence)))
  );

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <AddrFactCard
          className="min-h-0 h-auto"
          enter={0}
          label={t("status.eyebrow")}
          ink={board.state === "operational" ? INK.green : INK.gold}
          mark={<KpiMark id="status" />}
        >
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h1 className="text-[17px] font-semibold leading-none tracking-tight">
              {t("status.title")}
            </h1>
          </div>
          <StatusBanner systems={systems} checkedAtMs={board.checkedAtMs} />
          <p className="mt-2 max-w-3xl text-[12px] leading-snug text-[var(--muted-2)]">
            {t("status.lead")}
          </p>
        </AddrFactCard>

        <div
          className={clsx(
            "grid gap-2 transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] md:grid-cols-2 md:gap-3",
            pending && "opacity-60"
          )}
        >
          {board.slices.map((slice, i) => (
            <ServiceCard
              key={slice.id}
              slice={slice}
              locale={locale}
              wide={slice.id === "oracle"}
              enter={i + 1}
              open={openIds.has(slice.id)}
              onToggle={() => toggle(slice.id)}
            />
          ))}
          <ApiUseCard
            api={api}
            locale={locale}
            enter={board.slices.length + 1}
            open={openIds.has("api")}
            onToggle={() => toggle("api")}
          />
        </div>

        <EvidenceLegend kinds={kinds} />

        <section
          className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3.5"
          style={{ "--enter": board.slices.length + 2 } as CSSProperties}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium text-[var(--text)]">
                {t("status.verify.title")}
              </h2>
              <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
                {t("status.verify.body")}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => load(false)}
              className={clsx(
                "chip-press overflow-hidden rounded-[10px] bg-[var(--wash)] px-3 py-1.5 text-[12px] text-[var(--text)] transition-colors duration-[400ms] hover:bg-[var(--wash-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50",
                pending && "is-pressed"
              )}
            >
              {pending ? t("status.refreshing") : t("status.refresh")}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
            <Link prefetch={false} href="/learn#evidence" className="text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
              {t("status.method")}
            </Link>
            <span className="font-mono text-[11px] text-[var(--muted-2)]">
              {t("status.checked")}{" "}
              {utcText(board.checkedAtMs, locale)}
            </span>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function ApiUseCard({
  api,
  locale,
  enter,
  open,
  onToggle,
}: {
  api: ApiUse | null;
  locale: string;
  enter: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const loc = localeId(locale);
  const n = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString(loc);
  const hour = api?.hour;
  const day = api?.day;
  const rows: { label: string; value: string }[] = [
    { label: t("status.metric.height"), value: n(api?.height) },
    { label: t("status.api.requests1h"), value: n(hour?.requests) },
    { label: t("status.api.clients1h"), value: n(hour?.clients) },
    { label: t("status.api.graphql1h"), value: n(hour?.graphql) },
    { label: t("status.api.rest1h"), value: n(hour?.rest) },
    { label: t("status.api.errors1h"), value: n(hour?.errors) },
    { label: t("status.api.limited1h"), value: n(hour?.limited) },
    { label: t("status.api.requests24h"), value: n(day?.requests) },
    { label: t("status.api.clients24h"), value: n(day?.clients) },
  ];
  const state: TrustState = api?.ok ? "operational" : "unavailable";
  const bodyId = "status-card-api";
  return (
    <article
      className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] md:col-span-2 md:px-4 md:py-3.5"
      style={{ "--enter": enter } as CSSProperties}
    >
      <SystemRow
        name={t("status.api.title")}
        state={state}
        figure={
          hour?.requests != null
            ? t("status.row.requests").replace("{n}", formatInt(hour.requests, locale))
            : t(`status.state.${state}`)
        }
        open={open}
        onToggle={onToggle}
        controls={bodyId}
      />
      <div id={bodyId} className={clsx("max-md:px-4 max-md:pb-3.5", !open && "max-md:hidden")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted-2)]">
            {t("status.api.eyebrow")}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-[var(--text)] max-md:hidden">{t("status.api.title")}</h2>
        </div>
        <StatePill state={state} />
      </div>
      <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-[var(--muted)]">{t("status.api.lead")}</p>
      {hour || day ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[11px] text-[var(--muted-2)]">{row.label}</dt>
              <dd className="mt-0.5 font-mono text-[13px] font-medium text-[var(--text)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-[13px] text-[var(--muted)]">{t("status.api.empty")}</p>
      )}
      {hour?.paths.length ? (
        <div className="relative -mx-4 mt-3 min-w-0">
          <Feed className="is-rank">
            <FeedSection
              plate={
                <FeedPlate
                  tag={t("status.api.paths")}
                  count={<FeedCount k="feed.requests" n={hour.requests} />}
                />
              }
            >
              {hour.paths.map((row, i) => (
                <ApiPathRow key={row.path} row={row} rank={i + 1} total={hour.requests} />
              ))}
            </FeedSection>
          </Feed>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-soft)] pt-2.5 text-[11px] text-[var(--muted-2)]">
        <span>
          {t("status.source")}: <span className="font-mono">caddy</span>
          {api?.generatedAt ? (
            <span className="ml-3 font-mono">{api.generatedAt.replace("T", " ").slice(0, 16)} UTC</span>
          ) : null}
        </span>
        <a
          href="https://api.ergoscan.me/api/v1/info"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[var(--accent)] hover:underline"
        >
          /api/v1/info
        </a>
      </div>
      </div>
    </article>
  );
}

function ServiceCard({
  slice,
  locale,
  wide = false,
  enter,
  open,
  onToggle,
}: {
  slice: TrustSlice;
  locale: string;
  wide?: boolean;
  enter: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const bodyId = `status-card-${slice.id}`;
  return (
    <article
      className={clsx(
        "home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] md:px-4 md:py-3.5",
        wide && "md:col-span-2"
      )}
      style={{ "--enter": enter } as CSSProperties}
    >
      <SystemRow
        name={t(`status.service.${slice.id}`)}
        state={slice.state}
        figure={sliceFigure(slice, t, locale)}
        open={open}
        onToggle={onToggle}
        controls={bodyId}
      />
      <div id={bodyId} className={clsx("max-md:px-4 max-md:pb-3.5", !open && "max-md:hidden")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted-2)]">
            {t(`status.service.${slice.id}.eyebrow`)}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-[var(--text)] max-md:hidden">
            {t(`status.service.${slice.id}`)}
          </h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatePill state={slice.state} />
        </div>
      </div>

      {slice.feeds?.length ? (
        <div className="relative -mx-4 mt-3 min-w-0">
          <Feed className="is-rank">
            <FeedSection label={t(`status.service.${slice.id}`)}>
              {slice.feeds.map((feed, i) => (
                <OracleFeedRow key={feed.slug} feed={feed} rank={i + 1} locale={locale} />
              ))}
            </FeedSection>
          </Feed>
        </div>
      ) : null}

      <dl className={clsx("mt-3 grid gap-x-4 gap-y-3", wide ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
        {slice.metrics.map((metric) => (
          <Metric key={metric.id} metric={metric} locale={locale} />
        ))}
        {!slice.metrics.length ? (
          <div className="col-span-2 text-[13px] text-[var(--muted)]">
            {t("status.noResponse")}
          </div>
        ) : null}
      </dl>

      {slice.id === "oracle" || slice.id === "rent" ? (
        <p className="mt-3 text-[12px] leading-snug text-[var(--muted)]">
          {t(slice.id === "oracle" ? "status.service.oracle.hint" : "status.service.rent.hint")}
        </p>
      ) : null}

      {slice.notices.length ? (
        <div className="mt-3 flex flex-col gap-1 border-t border-[var(--border-soft)] pt-2.5">
          {slice.notices.map((notice) => (
            <p key={notice} className="text-[11px] leading-snug text-[var(--warning)]">
              {t(`trust.notice.${notice}`)}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-soft)] pt-2.5 text-[11px] text-[var(--muted-2)]">
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {t("status.source")}: <span className="font-mono">{slice.source}</span>
          </span>
          {slice.updatedAtMs != null ? (
            <span>
              {t("status.updated")}:{" "}
              <span className="font-mono">
                {utcText(slice.updatedAtMs, locale)}
              </span>
            </span>
          ) : null}
        </span>
        <a
          href={publicGatewayHref(slice.proofPath)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {slice.proofPath}
        </a>
      </div>
      </div>
    </article>
  );
}

/** One oracle pool: posting when its pool box is on chain and operators are live. */
function OracleFeedRow({ feed, rank, locale }: { feed: TrustFeedChip; rank: number; locale: string }) {
  const t = useT();
  const loc = localeId(locale);
  const live = feed.live != null && Number.isFinite(feed.live) ? feed.live : null;
  const ok = live != null && live > 0 && feed.hasPool;
  const state = ok ? t("feed.oracle.ok") : feed.hasPool ? t("feed.oracle.silent") : t("feed.oracle.noPool");
  const href = `/oracles/${feed.slug}`;
  return (
    <FeedRow
      k={ok ? "oracle" : "quiet"}
      glyph="oracle"
      hollow={!ok}
      tileTitle={state}
      lead={{ rank: rank.toLocaleString(loc) }}
      title={
        <Link prefetch={false} href={href} className="feed-name font-semibold hover:underline">
          {t(`status.feed.${feed.slug}`)}
        </Link>
      }
      facts={
        <>
          <span className="feed-kind">{state}</span>
          <span className="feed-mid font-mono">{href}</span>
        </>
      }
      value={
        <span className="feed-amt tabular-nums">
          {live != null ? <FeedPhrase text={t("status.feed.live")} value={live.toLocaleString(loc)} slot="{n}" /> : "—"}
        </span>
      }
    />
  );
}

/** One public API path of the last hour: its hits are the figure, its share of all requests a fact. */
function ApiPathRow({ row, rank, total }: { row: { path: string; hits: number }; rank: number; total: number }) {
  const t = useT();
  const { locale } = useI18n();
  const loc = localeId(locale);
  const graphql = row.path.toLowerCase().includes("graphql");
  const share = total > 0 ? Math.round((row.hits / total) * 100) : null;
  /* A plain path opens on the public API host; a templated one has nothing to open. */
  const href = /^\/[A-Za-z0-9/_.-]*$/.test(row.path) ? `https://api.ergoscan.me${row.path}` : null;
  return (
    <FeedRow
      k={graphql ? "contract" : "box"}
      glyph="protocol"
      lead={{ rank: rank.toLocaleString(loc) }}
      title={
        href ? (
          <a href={href} target="_blank" rel="noreferrer" title={row.path} className="feed-name font-mono hover:underline">
            {row.path}
          </a>
        ) : (
          <span className="feed-name font-mono" title={row.path}>
            {row.path}
          </span>
        )
      }
      facts={
        <>
          <span className="feed-kind">{graphql ? "GraphQL" : "REST"}</span>
          {share != null ? (
            <span className="tabular-nums">{t("feed.api.share").replace("{pct}", `${share}%`)}</span>
          ) : null}
        </>
      }
      value={<FeedAmount raw={BigInt(row.hits)} decimals={0} unit={null} />}
    />
  );
}

function Metric({ metric, locale }: { metric: TrustMetric; locale: string }) {
  const t = useT();
  let value = "—";
  if (typeof metric.value === "boolean") {
    value = metric.value ? t("status.yes") : t("status.no");
  } else if (typeof metric.value === "number") {
    value =
      metric.unit === "ms"
        ? ageText(metric.value, locale)
        : metric.id === "coverage"
          ? formatPct(metric.value, locale, 0, 2)
          : formatGroupedNumber(metric.value, 0, 2, locale);
  } else if (typeof metric.value === "string") {
    value = metric.value;
  }
  return (
    <div>
      <dt className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-2)]">
        <EvidenceDot kind={metric.evidence} className="md:hidden" />
        <span>{t(`status.metric.${metric.id}`)}</span>
        <EvidenceBadge kind={metric.evidence} compact className="max-md:hidden" />
      </dt>
      <dd className="mt-0.5 font-mono text-[13px] font-medium text-[var(--text)]">
        {value}
      </dd>
    </div>
  );
}

function StatePill({ state }: { state: TrustBoard["state"] }) {
  const t = useT();
  const tone =
    state === "operational"
      ? "text-[var(--up)]"
      : state === "unavailable"
        ? "text-[var(--down)]"
        : "text-[var(--warning)]";
  return (
    <span className={clsx("rounded-full bg-[var(--wash)] px-2 py-1 font-mono text-[10px]", tone)}>
      {t(`status.state.${state}`)}
    </span>
  );
}

