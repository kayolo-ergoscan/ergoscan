"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useT } from "@/lib/i18n/I18nProvider";
import { explorerHref, useSiteHost } from "@/lib/site-host";
import { MOBILE_TABS, moreActive, pathActive } from "@/lib/mobile-tab";
import { IconMore, NavIcon, type NavIconId } from "./nav-icons";

const TAB_ICON: Record<string, NavIconId> = {
  "/": "home",
  "/blocks": "blocks",
  "/mempool": "mempool",
  "/transactions": "txs",
};

export function MobileTabBar({
  onMore,
  moreOpen,
}: {
  onMore: () => void;
  moreOpen: boolean;
}) {
  const path = usePathname();
  const t = useT();
  const { api } = useSiteHost();
  const moreOn = moreOpen || moreActive(path);

  return (
    <>
      <div className="phone-edge-haze lg:hidden" aria-hidden />
      <nav
        className="phone-tabbar lg:hidden"
        aria-label={t("nav.menu")}
      >
      <div className="grid h-14 grid-cols-5">
        {MOBILE_TABS.map((item) => {
          const active = pathActive(path, item);
          const href = explorerHref(item.href, api);
          const className = clsx(
            "chip-press mx-1 my-1 flex min-h-[44px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[10px] text-[10px] font-medium",
            active ? "is-pressed text-[var(--text)]" : "text-[var(--muted)]"
          );
          const inner = (
            <>
              <NavIcon id={TAB_ICON[item.href] ?? "home"} className="ico-line size-[22px]" />
              <span>{t(item.key)}</span>
            </>
          );
          if (href.startsWith("http")) {
            return (
              <a key={item.href} href={href} className={className}>
                {inner}
              </a>
            );
          }
          return (
            <Link
              prefetch={false}
              key={item.href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "chip-press mx-1 my-1 flex min-h-[44px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[10px] text-[10px] font-medium",
                active ? "is-pressed text-[var(--text)]" : "text-[var(--muted)]"
              )}
            >
              <NavIcon id={TAB_ICON[item.href] ?? "home"} className="ico-line size-[22px]" />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-label={t("nav.more")}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={clsx(
            "chip-press mx-1 my-1 flex min-h-[44px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[10px] text-[10px] font-medium",
            moreOn ? "is-pressed text-[var(--text)]" : "text-[var(--muted)]"
          )}
        >
          <IconMore className="ico-line size-[22px]" />
          <span>{t("nav.more")}</span>
        </button>
      </div>
    </nav>
    </>
  );
}
