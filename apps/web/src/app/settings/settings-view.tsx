"use client";

import { Tip } from "@/components/Tip";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

export function SettingsView() {
  const t = useT();
  const { locale, setLocale, locales } = useI18n();
  const { markSynced } = usePageSync();

  useKeepFresh(() => markSynced());
  useEffect(() => {
    markSynced();
  }, [markSynced]);

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <h1 className="m-0 text-[28px] font-semibold leading-none tracking-tight">{t("nav.settings")}</h1>
        <section
          className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-2 sm:px-5"
          style={{ "--enter": 0 } as CSSProperties}
        >
          <TumblerRow label={t("locale.switch")}>
            <Tumbler
              label={t("locale.switch")}
              value={locale}
              options={locales.map((l) => ({ id: l.id, label: l.native, title: l.label }))}
              onChange={setLocale}
            />
          </TumblerRow>
        </section>
      </div>
    </Shell>
  );
}

function TumblerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border-soft)] py-4 last:border-b-0 lg:flex-row lg:items-center lg:justify-between">
      <p className="m-0 text-[15px] font-semibold tracking-tight text-[var(--text)]">{label}</p>
      {children}
    </div>
  );
}

function Tumbler<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; title?: string; swatch?: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div
      className="flex flex-wrap justify-end gap-1 max-lg:grid max-lg:w-full"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Tip key={o.id} content={o.title && o.title !== o.label ? o.title : null} tap={false}>
          <button
            type="button"
            role="radio"
            aria-checked={on}
            className={clsx(
              "chip-press inline-flex h-8 w-[6.75rem] items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium",
              // Phone: full-width switch, 44 px rows.
              "max-lg:h-11 max-lg:w-full max-lg:rounded-[12px] max-lg:text-[15px]",
              "transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
              on
                ? "is-pressed bg-[var(--panel-hover)] text-[var(--text)]"
                : "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
            )}
            onClick={() => onChange(o.id)}
          >
            {o.swatch ? <span className="set-tumbler-swatch" style={{ background: o.swatch }} aria-hidden /> : null}
            {o.label}
          </button>
          </Tip>
        );
      })}
    </div>
  );
}
