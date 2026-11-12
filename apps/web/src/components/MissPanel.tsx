"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { useT } from "@/lib/i18n/I18nProvider";
import { PixelMascot } from "@/components/PixelMascot";

export function MissPanel({
  looked,
  copy,
}: {
  looked: string;
  copy: "route" | "index" | "empty";
}) {
  const t = useT();
  const body =
    copy === "index" ? t("search.miss") : copy === "empty" ? t("search.empty") : t("notFound.body");
  return (
    <div className="max-w-lg">
      <PixelMascot mood="sad" size={40} className="-ml-3" />
      <h1 className="text-[28px] font-semibold tracking-tight">{t("notFound.title")}</h1>
      {looked ? (
        <p className="mt-3 text-[14px] text-[var(--muted)]">
          {t("notFound.looked")}{" "}
          <span className="break-all font-mono text-[13px] tabular-nums text-[var(--text)]">
            {looked}
          </span>
        </p>
      ) : null}
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{body}</p>
      {copy === "index" ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted-2)]">
          {t("search.missHint")}
        </p>
      ) : null}
      <nav className="mt-6 flex flex-wrap gap-2">
        <Exit href="/" label={t("nav.home")} />
        <Exit href="/blocks" label={t("nav.blocks")} />
        <Exit href="/transactions" label={t("nav.txs")} />
      </nav>
    </div>
  );
}

function Exit({ href, label }: { href: string; label: string }) {
  return (
    <Link
      prefetch={false}
      href={href}
      className="chip-press overflow-hidden rounded-[10px] bg-[var(--wash)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
    >
      {label}
    </Link>
  );
}

export function MissShell(props: { looked: string; copy: "route" | "index" | "empty" }) {
  return (
    <Shell>
      <MissPanel {...props} />
    </Shell>
  );
}
