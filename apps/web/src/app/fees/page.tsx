"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { useMempool } from "@/lib/useMempool";
import { formatFeeRate } from "@/lib/format";
import { useT } from "@/lib/i18n/I18nProvider";

function formatEta(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function FeesPage() {
  const t = useT();
  const { fees, balls } = useMempool();
  const max = Math.max(1, ...(fees?.buckets.map((b) => b.count) ?? [1]));

  const kpis = [
    { label: t("fees.kpiTxs"), value: balls.length.toLocaleString(), enter: 0 },
    { label: t("fees.kpiP50"), value: fees ? formatFeeRate(fees.p50) : "—", enter: 1 },
    { label: t("fees.kpiP90"), value: fees ? formatFeeRate(fees.p90) : "—", enter: 2 },
    { label: t("fees.kpiEta"), value: formatEta(fees?.eta?.nextEtaSec), enter: 3 },
  ];

  return (
    <Shell>
      <div className="mb-5 flex justify-end">
        <Link
          prefetch={false}
          href="/mempool"
          className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--wash)]"
        >
          {t("live.openMempool")}
        </Link>
      </div>
      <KpiGrid items={kpis} className="mb-6" />

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        <Rec label={t("fees.economy")} v={fees?.recommend.economy} />
        <Rec label={t("fees.normal")} v={fees?.recommend.normal} highlight />
        <Rec label={t("fees.turbo")} v={fees?.recommend.turbo} />
      </div>

      <div className="glass-static rounded-[20px] p-6">
        <p className="mb-4 text-[12px] uppercase tracking-wider text-[var(--muted)]">
          {t("fees.distribution")} · {balls.length} {t("home.txUnit")} · p50{" "}
          {fees ? formatFeeRate(fees.p50) : "—"} · p90 {fees ? formatFeeRate(fees.p90) : "—"}
        </p>
        <div className="flex h-40 items-end gap-1">
          {(fees?.buckets ?? []).map((b, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-accent/80"
                style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 4 : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Rec({ label, v, highlight }: { label: string; v?: number; highlight?: boolean }) {
  return (
    <div className={`glass-static rounded-[20px] p-5 ${highlight ? "ring-1 ring-accent/40" : ""}`}>
      <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
        {v != null ? formatFeeRate(v) : "—"}
      </p>
    </div>
  );
}
