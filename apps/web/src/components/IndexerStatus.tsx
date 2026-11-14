"use client";

import { useEffect, useState } from "react";
import { Tip, TipRow, TipRows } from "./Tip";
import Link from "next/link";
import { getGateway } from "@/lib/config";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { formatInt } from "@/lib/format";
import { chainIndexer } from "@/lib/kayolo/chain-sense";

type St = {
  ok?: boolean;
  mode?: string | null;
  lag?: number | null;
  span?: number | null;
  minHeight?: number | null;
  lastHeight?: number | null;
  boxCount?: number | null;
  tokenCount?: number | null;
};

export function IndexerStatus() {
  const { t, locale } = useI18n();
  const [st, setSt] = useState<St | null>(null);

  useEffect(() => {
    let dead = false;
    const load = () => {
      void fetch(`${getGateway()}/v1/indexer/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (dead || !d) return;
          setSt(d as St);
          // Kayolo E19 reads the same poll (no request of its own).
          const lag = (d as St).lag;
          chainIndexer(typeof lag === "number" && Number.isFinite(lag) ? lag : null);
        })
        .catch(() => {
          /* offline */
        });
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, []);

  if (!st) {
    return (
      <span className="font-mono text-[10px] text-[var(--muted-2)]">
        {t("status.indexer.loading")}
      </span>
    );
  }

  const lag = st.lag ?? 0;
  const ok = st.ok !== false && lag <= 5;
  const mode = st.mode || "—";
  const span = st.span != null ? formatInt(st.span, locale) : "—";

  const windowText =
    st.minHeight != null && st.lastHeight != null ? `h${st.minHeight}–${st.lastHeight}` : null;

  return (
    <Tip
      side="top"
      peek
      content={
        windowText
          ? () => (
              <TipRows>
                <TipRow label={t("status.indexer.window")}>{windowText}</TipRow>
              </TipRows>
            )
          : null
      }
    >
    <Link
      prefetch={false}
      href="/status"
      data-kayolo="indexer"
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-[var(--muted-2)] transition-colors duration-[400ms] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <span
        className={
          ok ? "text-[var(--up)]" : "text-[var(--warning)]"
        }
      >
        ●
      </span>
      <span>
        {t("status.indexer.label")}: {mode}
        {lag != null ? ` · ${t("ux.scope.lag")} ${lag}` : ""}
      </span>
      <span className="hidden sm:inline">
        {t("status.indexer.window")}: {span}
      </span>
      {st.boxCount != null && (
        <span className="hidden md:inline">
          {t("status.indexer.boxes")}: {formatInt(st.boxCount, locale)}
        </span>
      )}
    </Link>
    </Tip>
  );
}
