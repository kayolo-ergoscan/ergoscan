"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BottomSheet, SheetNavLink, useSheetLeave } from "./BottomSheet";
import { NavIcon } from "./nav-icons";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { explorerHref, useSiteHost } from "@/lib/site-host";
import { MORE_FOOT, MORE_GROUPS, moreLinkActive, type MoreLink, type MoreTile } from "@/lib/more-menu";

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

function Chevron({ className, back = false }: { className?: string; back?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden className={className}>
      <path
        d={back ? "M7.8 2.4 4 6l3.8 3.6" : "M4.2 2.4 8 6l-3.8 3.6"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A destination inside the sheet: explorer page, API host page, or the API docs. */
function SheetLink({
  item,
  className,
  onDone,
  children,
}: {
  item: MoreLink;
  className: string;
  onDone: () => void;
  children: ReactNode;
}) {
  const path = usePathname();
  const { api } = useSiteHost();
  const leave = useSheetLeave();
  const href = api && item.key === "nav.api" ? "/" : explorerHref(item.href, api);
  const active = moreLinkActive(path, item);
  if (href.startsWith("http")) {
    return (
      <a
        href={href}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noreferrer" : undefined}
        className={className}
        onClick={() => {
          if (!item.external) leave();
          onDone();
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <SheetNavLink href={href} onDone={onDone} aria-current={active ? "page" : undefined} className={className}>
      {children}
    </SheetNavLink>
  );
}

const TILE =
  "more-tile chip-press relative flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[14px] px-1.5 py-2 text-center";

function Tile({ tile, onDone, onStep }: { tile: MoreTile; onDone: () => void; onStep: (t: MoreTile) => void }) {
  const { t } = useI18n();
  const path = usePathname();
  const body = (
    <>
      <NavIcon id={tile.icon} className="ico-line size-6 shrink-0" />
      <span className="more-tile-label">{t(tile.key)}</span>
    </>
  );
  if (tile.step?.length) {
    const under = moreLinkActive(path, tile);
    return (
      <button
        type="button"
        data-step={tile.href}
        onClick={() => onStep(tile)}
        className={clsx(TILE, under && "is-under")}
      >
        {body}
        <Chevron className="more-tile-more absolute right-1.5 top-1.5 size-3" />
      </button>
    );
  }
  return (
    <SheetLink item={tile} className={TILE} onDone={onDone}>
      {body}
      {tile.external ? (
        <svg viewBox="0 0 12 12" fill="none" aria-hidden className="more-tile-more absolute right-1.5 top-1.5 size-3">
          <path d="M4.5 2.5h5v5M9.5 2.5 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : null}
    </SheetLink>
  );
}

function StepRows({ tile, onDone }: { tile: MoreTile; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-1 px-3 pb-4 pt-1">
      {(tile.step ?? []).map((row) => (
        <li key={row.href + row.key}>
          <SheetLink
            item={row}
            onDone={onDone}
            className={clsx(
              "more-row chip-press flex min-h-[52px] items-center gap-3 overflow-hidden rounded-[12px] pr-3",
              row.nested ? "pl-10" : "pl-3"
            )}
          >
            <NavIcon id={row.icon} className={clsx("ico-line shrink-0", row.nested ? "size-[18px]" : "size-[22px]")} />
            <span className={clsx("min-w-0 flex-1 truncate font-medium", row.nested ? "text-[15px]" : "text-[16px]")}>
              {t(row.key)}
            </span>
          </SheetLink>
        </li>
      ))}
    </ul>
  );
}

function LocaleSeg() {
  const { locale, setLocale, locales, t } = useI18n();
  return (
    <div className="more-seg flex shrink-0 gap-0.5 rounded-[12px] p-0.5" role="radiogroup" aria-label={t("locale.switch")}>
      {locales.map((l) => {
        const on = locale === l.id;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={l.label}
            onClick={() => setLocale(l.id)}
            className={clsx(
              "chip-press flex h-11 min-w-[44px] items-center justify-center rounded-[10px] px-2.5 text-[13px] font-semibold tracking-[0.04em]",
              on ? "is-pressed more-seg-on" : "text-[var(--muted)]"
            )}
          >
            {l.native}
          </button>
        );
      })}
    </div>
  );
}

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<MoreTile | null>(null);
  const [dir, setDir] = useState(1);
  const rootBox = useRef<HTMLDivElement>(null);
  const [rootH, setRootH] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevStep = useRef<string | null>(null);

  useEffect(() => {
    if (open) return;
    setStep(null);
    setRootH(null);
  }, [open]);

  const go = (next: MoreTile | null) => {
    if (next && rootBox.current) setRootH(rootBox.current.offsetHeight);
    setDir(next ? 1 : -1);
    setStep(next);
    bodyRef.current?.scrollTo({ top: 0 });
    // The pressed control leaves the DOM: keep keyboard focus inside the sheet.
    window.requestAnimationFrame(() => {
      const root = bodyRef.current;
      if (!root) return;
      const target = next
        ? root.querySelector<HTMLElement>("a[href]")
        : root.querySelector<HTMLElement>(`[data-step="${prevStep.current ?? ""}"]`);
      target?.focus({ preventScroll: true });
    });
    prevStep.current = next?.href ?? null;
  };

  const head = step ? (
    <>
      <button
        type="button"
        onClick={() => go(null)}
        aria-label={t("more.back")}
        className="chip-press -ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)]"
      >
        <Chevron back className="size-4" />
      </button>
      <h2 className="m-0 min-w-0 truncate text-[17px] font-semibold tracking-tight">{t(step.key)}</h2>
    </>
  ) : (
    <h2 className="m-0 text-[17px] font-semibold tracking-tight">{t("nav.more")}</h2>
  );

  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { x: `${dir * 100}%`, opacity: 0.4 },
        animate: { x: 0, opacity: 1 },
        exit: { x: `${dir * -100}%`, opacity: 0.4 },
      };

  return (
    <BottomSheet open={open} onClose={onClose} label={step ? t(step.key) : t("nav.more")} head={head} bodyRef={bodyRef}>
      <div className="relative overflow-hidden" style={step && rootH ? { minHeight: rootH } : undefined}>
        <AnimatePresence initial={false} mode="popLayout">
          {step ? (
            <motion.div
              key={`step:${step.href}`}
              {...slide}
              transition={{ duration: reduce ? 0.12 : 0.26, ease: EASE }}
            >
              <StepRows tile={step} onDone={onClose} />
            </motion.div>
          ) : (
            <motion.div
              key="root"
              ref={rootBox}
              {...slide}
              transition={{ duration: reduce ? 0.12 : 0.26, ease: EASE }}
              className="px-3 pb-3"
            >
              {MORE_GROUPS.map((g) => (
                <section key={g.key} className="pt-1.5" aria-labelledby={`more-${g.key}`}>
                  <h3 id={`more-${g.key}`} className="more-group-head">
                    {t(g.key)}
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {g.tiles.map((tile) => (
                      <Tile key={tile.href + tile.key} tile={tile} onDone={onClose} onStep={(x) => go(x)} />
                    ))}
                  </div>
                </section>
              ))}
              <div className="more-foot mt-3 flex items-center gap-1.5 pt-3">
                <LocaleSeg />
                <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
                  {MORE_FOOT.map((f) => (
                    <SheetLink
                      key={f.href}
                      item={f}
                      onDone={onClose}
                      className="more-foot-link chip-press flex h-11 min-w-0 items-center gap-1.5 overflow-hidden rounded-[10px] px-2.5 text-[14px] font-medium"
                    >
                      <NavIcon id={f.icon} className="ico-line size-[18px] shrink-0" />
                      <span className="truncate">{t(f.key)}</span>
                    </SheetLink>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BottomSheet>
  );
}
