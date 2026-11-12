"use client";

/**
 * Home «Version nodes»: which node versions and modes the peers of our node run.
 * One line like the epoch tile beside it: name, peer count and the newest version's share,
 * then a split bar (newest version first). Data: GET /v1/network/versions (node, cached 1 min).
 */
import { useEffect, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { getGateway } from "@/lib/config";
import { HOME, INK } from "@/lib/palette";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Row = { version: string; n: number };
type Mode = { mode: "full" | "pruned" | "digest"; n: number };
type Versions = { total: number; versions: Row[]; modes: Mode[] };

const REFRESH_MS = 120_000;
const SHOWN = 4;
const TONES = [INK.teal, INK.cyan, INK.violet, INK.gold];
const OTHER = "var(--muted-2)";

function parse(raw: unknown): Versions | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as { total?: unknown; versions?: unknown; modes?: unknown };
  const versions = (Array.isArray(j.versions) ? j.versions : [])
    .filter((r): r is Row => !!r && typeof r.version === "string" && Number.isFinite(r.n) && r.n > 0);
  const modes = (Array.isArray(j.modes) ? j.modes : []).filter(
    (r): r is Mode => !!r && typeof r.mode === "string" && Number.isFinite(r.n) && r.n > 0
  );
  const total = Number(j.total);
  if (!versions.length || !Number.isFinite(total) || total <= 0) return null;
  return { total, versions, modes };
}

export function HomeVersionNodes({ className, style }: { className?: string; style?: CSSProperties }) {
  const { t, locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const [data, setData] = useState<Versions | null>(null);

  useEffect(() => {
    let dead = false;
    const load = () =>
      fetch(`${getGateway()}/v1/network/versions`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const got = parse(j);
          if (!dead && got) setData(got);
        })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  const known = data ? data.versions.reduce((s, r) => s + r.n, 0) : 0;
  const head = data?.versions.slice(0, SHOWN) ?? [];
  const rest = known - head.reduce((s, r) => s + r.n, 0);
  const parts = [
    ...head.map((r, i) => ({ key: r.version, label: r.version, n: r.n, color: TONES[i] ?? OTHER })),
    ...(rest > 0 ? [{ key: "other", label: t("home.versionOther"), n: rest, color: OTHER }] : []),
  ];
  const share = (n: number) => (known > 0 ? Math.round((n / known) * 100) : 0);
  const newest = head[0];
  const modeText = (data?.modes ?? [])
    .map((m) => `${t(`home.nodeMode.${m.mode}`)} ${m.n.toLocaleString(loc)}`)
    .join(" · ");

  return (
    <section
      className={clsx("mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3", className)}
      style={style}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="shrink-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
          {t("home.versionNodes")}
        </p>
        {data && newest ? (
          <div className="flex min-w-0 items-center gap-3 text-[12px] leading-none tabular-nums">
            <span className="inline-flex shrink-0 items-baseline gap-1 font-semibold" title={modeText || undefined}>
              {data.total.toLocaleString(loc)}
              <span className="font-medium opacity-70">{t("home.versionPeers")}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-semibold">
              <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: parts[0]?.color }} />
              {newest.version}
              <span className="font-medium opacity-70">{share(newest.n)}%</span>
            </span>
          </div>
        ) : null}
      </div>
      <div
        className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full bg-[var(--wash)]"
        role="img"
        aria-label={
          data
            ? parts.map((p) => `${p.label} ${p.n} (${share(p.n)}%)`).join(", ")
            : t("home.versionNodes")
        }
      >
        {parts.map((p) => (
          <span
            key={p.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(p.n / Math.max(1, known)) * 100}%`, background: p.color }}
            title={`${p.label} · ${p.n.toLocaleString(loc)} · ${share(p.n)}%`}
          />
        ))}
      </div>
    </section>
  );
}
