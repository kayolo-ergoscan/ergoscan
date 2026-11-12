"use client";

import { useEffect, type CSSProperties } from "react";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiMark } from "@/components/kpi-marks";
import { Shell } from "@/components/Shell";
import { ABOUT_DEV, ABOUT_KUSHTI, ABOUT_LINKS, ABOUT_SUPPORT, type AboutCredit } from "@/lib/about-credits";
import { NAMES_REGISTRY_URL } from "@/lib/address-book";
import { INK } from "@/lib/palette";
import { useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

export function AboutView() {
  const t = useT();
  const { markSynced } = usePageSync();

  useKeepFresh(() => markSynced());
  useEffect(() => {
    markSynced();
  }, [markSynced]);

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <AddrFactCard
          className="min-h-0 h-auto"
          enter={0}
          label={t("about.eyebrow")}
          ink={INK.cyan}
          mark={<KpiMark id="info" />}
        >
          <h1 className="mt-0.5 text-[17px] font-semibold leading-none tracking-tight">
            {t("about.title")}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-[var(--muted-2)]">
            {t("about.lead")}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {ABOUT_LINKS.map((link) => (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={t(link.labelKey)}
                title={t(link.labelKey)}
                className="chip-press inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-[8px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                {link.id === "github" ? <GithubMark /> : <XMark />}
              </a>
            ))}
          </div>
        </AddrFactCard>

        <section className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4" style={enterAt(1)}>
          <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--text)]">{t("about.p1")}</p>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
            {t("about.p2")}
          </p>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
            {t("about.independent")}
          </p>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
            {t("about.names")}{" "}
            <a href={NAMES_REGISTRY_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              ergo-names
            </a>
          </p>
        </section>

        <section className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4" style={enterAt(2)}>
          <h2 className="text-[15px] font-semibold text-[var(--text)]">{t("about.next.title")}</h2>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
            {t("about.next.body")}
          </p>
        </section>

        <section className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4" style={enterAt(3)}>
          <h2 className="text-[15px] font-semibold text-[var(--text)]">{t("about.thanks.title")}</h2>
          <KushtiThanks text={t("about.thanks.kushti")} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <CreditList title={t("about.dev")} rows={ABOUT_DEV} t={t} />
            <CreditList title={t("about.support")} rows={ABOUT_SUPPORT} t={t} />
          </div>
          <p className="mt-4 text-[13px] font-medium text-[var(--text)]">{t("about.thanks.foot")}</p>
        </section>
      </div>
    </Shell>
  );
}

function enterAt(i: number): CSSProperties {
  return { "--enter": i } as CSSProperties;
}

function KushtiThanks({ text }: { text: string }) {
  const handle = `@${ABOUT_KUSHTI.handle}`;
  const i = text.indexOf(handle);
  return (
    <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
      {i < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, i)}
          <a
            href={ABOUT_KUSHTI.href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] text-[var(--accent)] transition-colors duration-[400ms] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {handle}
          </a>
          {text.slice(i + handle.length)}
        </>
      )}
    </p>
  );
}

function CreditList({
  title,
  rows,
  t,
}: {
  title: string;
  rows: readonly AboutCredit[];
  t: (key: string) => string;
}) {
  return (
    <div>
      <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--muted-2)]">
        {title}
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.nameKey} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="text-[var(--text)]">{t(row.nameKey)}</span>
            {row.handle && row.href ? (
              <a
                href={row.href}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] text-[var(--accent)] transition-colors duration-[400ms] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                @{row.handle}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

