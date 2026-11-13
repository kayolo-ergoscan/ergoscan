"use client";

import { Tip } from "@/components/Tip";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { chooseHome, chooseKey, chooseMode, currentMode, onChoice } from "@/lib/kayolo/body";
import { readHome, readKeyOn, type Home, type Mode } from "@/lib/kayolo/memory";
import { REDUCE_QUERY } from "@/lib/kayolo/motion";
import { KAYOLO_LAYER } from "@/lib/kayolo/thresholds";

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
        {KAYOLO_LAYER ? <KayoloSettings /> : null}
      </div>
    </Shell>
  );
}

function local() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const MODES: Mode[] = ["live", "calm", "asleep", "hidden", "off"];
const HOMES: Home[] = ["r", "l", "p"];

/**
 * Kayolo (design/brand/kayolo-life.md §10): the mode (WCAG 2.2.2: calmer, asleep, hidden, and off
 * only here), his home on desktop, and the Shift+K switch (WCAG 2.1.4). A choice applies at once,
 * in every tab (`storage`).
 */
function KayoloSettings() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("live");
  const [home, setHome] = useState<Home>("r");
  const [keyOn, setKeyOn] = useState(true);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const read = () => {
      setMode(currentMode());
      setHome(readHome(local) ?? "r");
      setKeyOn(readKeyOn(local));
      setReduce(window.matchMedia(REDUCE_QUERY).matches);
    };
    read();
    return onChoice(read);
  }, []);
  return (
    <section
      className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-2 sm:px-5"
      style={{ "--enter": 1 } as CSSProperties}
      aria-label={t("settings.kayolo")}
    >
      <TumblerRow
        label={t("settings.kayolo")}
        note={reduce ? t("settings.kayoloReduce") : null}
      >
        <Tumbler
          label={t("settings.kayoloMode")}
          value={mode}
          options={MODES.map((m) => ({
            id: m,
            label: t(`settings.kayolo.${m}`),
            title: m === "live" && reduce ? t("settings.kayoloReduce") : undefined,
          }))}
          onChange={chooseMode}
          className="kayolo-modes"
        />
      </TumblerRow>
      <TumblerRow label={t("settings.kayoloHome")} className="max-lg:hidden">
        <Tumbler
          label={t("settings.kayoloHome")}
          value={home}
          options={HOMES.map((h) => ({ id: h, label: t(`settings.kayoloHome.${h}`) }))}
          onChange={chooseHome}
          wide
        />
      </TumblerRow>
      <TumblerRow label={t("settings.kayoloKey")}>
        <Tumbler
          label={t("settings.kayoloKey")}
          value={keyOn ? "on" : "off"}
          options={[
            { id: "on", label: t("settings.kayoloKey.on") },
            { id: "off", label: t("settings.kayoloKey.off") },
          ]}
          onChange={(v) => chooseKey(v === "on")}
        />
      </TumblerRow>
    </section>
  );
}

function TumblerRow({
  label,
  note,
  className,
  children,
}: {
  label: string;
  note?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-3 border-b border-[var(--border-soft)] py-4 last:border-b-0 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 text-[15px] font-semibold tracking-tight text-[var(--text)]">{label}</p>
        {note ? <p className="m-0 text-[13px] leading-[18px] text-[var(--muted)]">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Tumbler<T extends string>({
  label,
  value,
  options,
  onChange,
  wide = false,
  className,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; title?: string; swatch?: string }[];
  onChange: (id: T) => void;
  /** Longer labels («Справа от заголовка»): the chips size to them. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx("flex flex-wrap justify-end gap-1 max-lg:grid max-lg:w-full", className)}
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
              "chip-press inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium",
              wide ? "min-w-[6.75rem] whitespace-nowrap px-3" : "w-[6.75rem]",
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
