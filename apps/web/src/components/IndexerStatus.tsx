"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getGateway } from "@/lib/config";
import { useT } from "@/lib/i18n/I18nProvider";

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
  const t = useT();
  const [st, setSt] = useState<St | null>(null);

  useEffect(() => {
    let dead = false;
    const load = () => {
      void fetch(`${getGateway()}/v1/indexer/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!dead && d) setSt(d as St);
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
  const span = st.span != null ? st.span.toLocaleString() : "—";

  return (
    <Link
      prefetch={false}
      href="/status"
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-[var(--muted-2)] transition-colors duration-[400ms] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      title={
        st.minHeight != null && st.lastHeight != null
          ? `h${st.minHeight}–${st.lastHeight}`
          : undefined
      }
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
          {t("status.indexer.boxes")}: {st.boxCount.toLocaleString()}
        </span>
      )}
    </Link>
  );
}
