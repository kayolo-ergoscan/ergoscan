"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getGateway } from "@/lib/config";
import { useT } from "@/lib/i18n/I18nProvider";
import clsx from "clsx";

type St = {
  ok?: boolean;
  lag?: number | null;
  span?: number | null;
  minHeight?: number | null;
  lastHeight?: number | null;
  mode?: string | null;
};

/** Ambient trust: show indexed window next to partial data (NFT/holders/rent). */
export function IndexScopeChip({ className }: { className?: string }) {
  const t = useT();
  const [st, setSt] = useState<St | null>(null);

  useEffect(() => {
    let dead = false;
    void fetch(`${getGateway()}/v1/indexer/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead && d) setSt(d as St);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);

  if (st?.minHeight == null || st.lastHeight == null) return null;

  const lag = st.lag ?? 0;
  const ok = st.ok !== false && lag <= 5;
  const fullChain = st.minHeight === 0;

  return (
    <Link
      prefetch={false}
      href="/status"
      className={clsx(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border border-[var(--border)] bg-[var(--wash-faint)] px-3 py-1 font-mono text-[11px] text-[var(--muted)] transition-colors duration-[400ms] hover:bg-[var(--wash)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        ok
          ? "hover:text-[var(--text)]"
          : "border-amber-500/30 text-[var(--warning)]",
        className
      )}
      title={t(fullChain ? "trust.scope.fullHint" : "ux.scope.hint")}
    >
      <span className={ok ? "text-[var(--up)]" : "text-[var(--warning)]"}>●</span>
      <span>
        {fullChain ? t("trust.scope.full") : t("ux.scope.window")}: h{st.minHeight}–{st.lastHeight}
      </span>
      {st.span != null && (
        <span className="text-[var(--muted-2)]">
          ({st.span.toLocaleString()} {t("ux.scope.blocks")})
        </span>
      )}
      <span className="text-[var(--muted-2)]">
        {t("ux.scope.lag")} {lag}
        {st.mode ? ` · ${st.mode}` : ""}
      </span>
    </Link>
  );
}
