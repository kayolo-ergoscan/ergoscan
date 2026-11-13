"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { chromeFor } from "@/lib/chrome";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSiteHost } from "@/lib/site-host";

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

/** The title leaves 48 px on each side for Kayolo's niche (design/brand/kayolo-life.md §3.1). */
export function ChromeHeading() {
  const path = usePathname();
  const t = useT();
  const { api } = useSiteHost();
  const reduce = useReducedMotion();
  const chrome = chromeFor(path);
  const titleKey = api ? "nav.api" : chrome.titleKey;
  const heading = api ? false : chrome.heading;
  const title = t(titleKey);
  const Tag = heading ? "h1" : "p";

  return (
    <div className="pointer-events-none relative h-full w-[min(20rem,46vw)] shrink-0 overflow-hidden text-center">
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={titleKey}
          className="absolute inset-0 flex items-center justify-center"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
        >
          <Tag
            data-scout="title"
            className="m-0 max-w-[calc(100%-96px)] truncate text-[17px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]"
          >
            {title}
          </Tag>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
