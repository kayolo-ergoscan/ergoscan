"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiMark } from "@/components/kpi-marks";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { Shell } from "@/components/Shell";
import { publicGatewayHref } from "@/lib/config";
import { INK } from "@/lib/palette";
import {
  fetchTrustBoard,
  type TrustBoard,
  type TrustMetric,
  type TrustSlice,
} from "@/lib/trust-board";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { formatStamp } from "@/lib/format";
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
            <StatePill state={board.state} />
          </div>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-[var(--muted-2)]">
            {t("status.lead")}
          </p>
        </AddrFactCard>

        <div
          className={clsx(
            "grid gap-3 transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] md:grid-cols-2",
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
            />
          ))}
        </div>

        <ApiUseCard api={api} locale={locale} enter={board.slices.length + 1} />

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
}: {
  api: ApiUse | null;
  locale: string;
  enter: number;
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
  return (
    <article
      className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3.5"
      style={{ "--enter": enter } as CSSProperties}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted-2)]">
            {t("status.api.eyebrow")}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-[var(--text)]">{t("status.api.title")}</h2>
        </div>
        <StatePill state={api?.ok ? "operational" : "unavailable"} />
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
        <div className="mt-3 border-t border-[var(--border-soft)] pt-2.5">
          <p className="text-[11px] text-[var(--muted-2)]">{t("status.api.paths")}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {hour.paths.map((row) => (
              <li key={row.path} className="flex min-w-0 items-baseline justify-between gap-3 text-[12px]">
                <span className="truncate font-mono text-[var(--text)]">{row.path}</span>
                <span className="shrink-0 font-mono tabular-nums text-[var(--muted)]">
                  {row.hits.toLocaleString(loc)}
                </span>
              </li>
            ))}
          </ul>
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
    </article>
  );
}

function ServiceCard({
  slice,
  locale,
  wide = false,
  enter,
}: {
  slice: TrustSlice;
  locale: string;
  wide?: boolean;
  enter: number;
}) {
  const t = useT();
  return (
    <article
      className={clsx(
        "home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3.5",
        wide && "md:col-span-2"
      )}
      style={{ "--enter": enter } as CSSProperties}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted-2)]">
            {t(`status.service.${slice.id}.eyebrow`)}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-[var(--text)]">
            {t(`status.service.${slice.id}`)}
          </h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatePill state={slice.state} />
        </div>
      </div>

      {slice.feeds?.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {slice.feeds.map((feed) => {
            const live = feed.live != null && Number.isFinite(feed.live);
            const ok = live && feed.live! > 0 && feed.hasPool;
            return (
              <Link
                prefetch={false}
                key={feed.slug}
                href={`/oracles/${feed.slug}`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] bg-[var(--wash)] px-3 py-2.5 transition-colors duration-[400ms] ease-[var(--ease)] hover:bg-[var(--wash-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={clsx(
                      "size-1.5 shrink-0 rounded-full",
                      ok ? "bg-[var(--up)]" : "bg-[var(--warning)]"
                    )}
                    aria-hidden
                  />
                  <span className="truncate text-[13px] font-medium text-[var(--text)]">
                    {t(`status.feed.${feed.slug}`)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-[var(--muted)]">
                  {live
                    ? t("status.feed.live").replace("{n}", String(feed.live))
                    : "—"}
                </span>
              </Link>
            );
          })}
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
    </article>
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
          ? `${metric.value.toLocaleString(localeId(locale), {
              maximumFractionDigits: 2,
            })}%`
          : metric.value.toLocaleString(localeId(locale));
  } else if (typeof metric.value === "string") {
    value = metric.value;
  }
  return (
    <div>
      <dt className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-2)]">
        <span>{t(`status.metric.${metric.id}`)}</span>
        <EvidenceBadge kind={metric.evidence} compact />
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

