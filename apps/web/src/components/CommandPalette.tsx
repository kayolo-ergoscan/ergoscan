"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as InputKeyEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { noteRouteNavigation } from "@/lib/route-nav";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { getGateway } from "@/lib/config";
import { formatRelTime, shortId } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { explorerHref, useSiteHost } from "@/lib/site-host";
import { enteringIds, useEnterIds } from "@/lib/keyed-enter";
import {
  IconBlocks,
  IconHolders,
  IconTokens,
  IconTxs,
} from "@/components/nav-icons";
import { lookupAddress, searchAddressBook } from "@/lib/address-book";
import { rankTokenHits } from "@/lib/token-hit-rank";
import { usePaperPress } from "@/lib/use-paper-press";
import { tokenKnown } from "@/lib/token-meta";
import { canReadClipboard, pasteTarget } from "@/lib/search-paste";
import { say } from "@/lib/kayolo/events";
import { sheetOnTop, useSheetHistory } from "./BottomSheet";
import { KnownTokenMark } from "./KnownTokenMark";

interface Hit {
  type: string;
  id: string;
  label?: string;
  path?: string;
  layer?: "index" | "wide";
  /** Token hits that share a name: holder count from the catalog. */
  holders?: number;
}

type RecentHit = Hit & { ts?: number };

type Row = {
  key: string;
  hit: RecentHit;
  recent?: boolean;
  wide?: boolean;
};

const RECENTS_KEY = "lumen-stage-search-recents";
const HISTORY_SHOW = 6;
/** Phone search shows more of the history: there is no keyboard list to scroll. */
const HISTORY_SHOW_PHONE = 8;
const HISTORY_STORE = 12;
const GROUP_CAP = 6;
const TYPE_ORDER = ["block", "tx", "address", "token", "box"];
const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

function readRecents(): RecentHit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentHit[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((h) => h && typeof h.id === "string" && typeof h.type === "string")
      .map((h) => ({
        type: h.type,
        id: h.id,
        label: h.label,
        path: safePath(h.path),
        ts: typeof h.ts === "number" ? h.ts : undefined,
      }))
      .slice(0, HISTORY_STORE);
  } catch {
    return [];
  }
}

function writeRecents(hits: RecentHit[]) {
  try {
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(hits.slice(0, HISTORY_STORE))
    );
  } catch {
    /* private mode */
  }
}

function pushRecent(h: Hit) {
  const next = [
    {
      type: h.type,
      id: h.id,
      label: h.label,
      path: h.path,
      ts: Date.now(),
    },
    ...readRecents().filter((x) => !(x.type === h.type && x.id === h.id)),
  ];
  writeRecents(next);
}

function removeRecent(h: Hit) {
  writeRecents(
    readRecents().filter((x) => !(x.type === h.type && x.id === h.id))
  );
}

function safePath(p: unknown): string | undefined {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//")) {
    return undefined;
  }
  return p;
}

/** /v1/search has no path. Stamp one at ingest so go() never switches on type. */
function pathForSearchHit(type: string, id: string): string {
  if (type === "tx") return `/tx/${id}`;
  if (type === "box") return `/box/${id}`;
  if (type === "block") return `/block/${id}`;
  if (type === "address") return `/address/${encodeURIComponent(id)}`;
  if (type === "token") return `/token/${id}`;
  return `/search?q=${encodeURIComponent(id)}`;
}

function asHit(raw: unknown, layer: "index" | "wide"): Hit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== "string" || typeof o.id !== "string" || !o.id) return null;
  const path = safePath(o.path) ?? (layer === "wide" ? pathForSearchHit(o.type, o.id) : undefined);
  return decorateAddressHit({
    type: o.type,
    id: o.id,
    label: typeof o.label === "string" ? o.label : undefined,
    path,
    layer,
  });
}

function decorateAddressHit(h: Hit): Hit {
  if (h.type !== "address") return h;
  const book = lookupAddress(h.id);
  if (!book?.name) return h;
  return {
    ...h,
    label: book.name,
    path: h.path ?? `/address/${encodeURIComponent(h.id)}`,
  };
}

function mergeBookHits(q: string, remote: Hit[]): Hit[] {
  const extra: Hit[] = [];
  const seen = new Set(remote.map((h) => `${h.type}:${h.id}`));
  for (const e of searchAddressBook(q)) {
    const key = `address:${e.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(
      decorateAddressHit({
        type: "address",
        id: e.address,
        label: e.name,
        path: `/address/${encodeURIComponent(e.address)}`,
        layer: "index",
      })
    );
  }
  return [...extra, ...remote].map(decorateAddressHit);
}

function groupHits(hits: Hit[]): { type: string; items: Hit[] }[] {
  const buckets = new Map<string, Hit[]>();
  for (const h of hits) {
    const b = buckets.get(h.type);
    if (b) {
      if (b.length < GROUP_CAP) b.push(h);
    } else {
      buckets.set(h.type, [h]);
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      const ia = TYPE_ORDER.indexOf(a);
      const ib = TYPE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([type, items]) => ({ type, items }));
}

function typeLabel(type: string, t: (k: string) => string): string {
  const key = `search.hit.${type}`;
  const s = t(key);
  return s === key ? type : s;
}

function hitCaption(h: Hit): string {
  if (h.type === "query") return h.label || h.id;
  if (h.type === "token" && h.label) return h.label;
  if (h.type === "block") {
    if (/^\d+$/.test(h.id)) return h.id;
    return h.label || shortId(h.id, 8);
  }
  if (h.type === "address") {
    return lookupAddress(h.id)?.name || h.label || shortId(h.id, 8);
  }
  return shortId(h.id, 8);
}

function TypeGlyph({ type }: { type: string }) {
  const cls = "ico-line h-3.5 w-3.5 shrink-0";
  if (type === "block") return <IconBlocks className={cls} />;
  if (type === "tx") return <IconTxs className={cls} />;
  if (type === "address") return <IconHolders className={cls} />;
  if (type === "token") return <IconTokens className={cls} />;
  if (type === "box") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cls}>
        <path
          d="M4.4 8.2 12 4.4l7.6 3.8v7.6L12 19.6 4.4 15.8V8.2Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M12 19.6v-7.6M4.4 8.2 12 12l7.6-3.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cls}>
      <circle cx="11" cy="11" r="6.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M16.2 16.2 20 20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

const LIST_HEAD =
  "mb-1 mt-1 px-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-2)]";

function ListHead({
  id,
  hidden,
  children,
}: {
  id?: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <p id={id} aria-hidden={hidden || undefined} className={LIST_HEAD}>
      {children}
    </p>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const t = useT();
  const { locale, tn } = useI18n();
  const { api } = useSiteHost();
  const reduce = useReducedMotion();
  const enter = useEnterIds();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<RecentHit[]>([]);
  const [searched, setSearched] = useState(false);
  /** Below lg the search is a full-screen sheet with Cancel, clear and Paste. */
  const [phone, setPhone] = useState(false);
  const [canPaste, setCanPaste] = useState(false);
  const [pasteMiss, setPasteMiss] = useState(false);
  const uid = useId();
  const listId = `${uid}-list`;

  hitsRef.current = hits;

  const rememberTrigger = useCallback(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) triggerRef.current = el;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setPending(false);
    setSearched(false);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setPhone(mq.matches);
    sync();
    setCanPaste(canReadClipboard());
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Phone: Back closes the search like any other sheet.
  const { leave } = useSheetHistory(open && phone, close);

  useEffect(() => {
    setPasteMiss(false);
  }, [q, open]);

  const onPaste = useCallback(async () => {
    setPasteMiss(false);
    try {
      const hit = pasteTarget(await navigator.clipboard.readText());
      if (!hit) {
        setPasteMiss(true);
        say({ k: "ui:search-paste", ok: false, el: inputRef.current });
        return;
      }
      setQ(hit);
      inputRef.current?.focus();
      say({ k: "ui:search-paste", ok: true, el: inputRef.current });
    } catch {
      setPasteMiss(true);
      say({ k: "ui:search-paste", ok: false, el: inputRef.current });
    }
  }, []);

  /** Leave the search for a page. From the phone sheet the page replaces the sheet's history entry. */
  const navigate = useCallback(
    (dest: string) => {
      const fromSheet = sheetOnTop();
      if (fromSheet) leave();
      close();
      if (dest.startsWith("http")) {
        window.location.assign(dest);
        return;
      }
      noteRouteNavigation(dest);
      if (fromSheet) router.replace(dest);
      else router.push(dest);
    },
    [close, leave, router]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) rememberTrigger();
          return !v;
        });
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };
    const onOpen = () => {
      rememberTrigger();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("lumen:open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lumen:open-search", onOpen);
    };
  }, [close, open, rememberTrigger]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits([]);
    setPending(false);
    setSearched(false);
    setActive(0);
    setRecents(readRecents());
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Kayolo (§6.2): the search opened and closed, the field, the list, no matches.
  useEffect(() => {
    if (!open) return;
    let told = false;
    const id = window.requestAnimationFrame(() => {
      told = true;
      say({ k: "ui:search-open", el: inputRef.current });
    });
    return () => {
      window.cancelAnimationFrame(id);
      if (told) say({ k: "ui:search-close" });
    };
  }, [open]);

  useEffect(() => {
    if (open && q) say({ k: "ui:search-type", el: inputRef.current });
  }, [open, q]);

  // Once per answered query: `searched` turns true when the answer is in (q is read, not watched,
  // so typing on past an old answer does not tell him again).
  const askedRef = useRef(q);
  askedRef.current = q;
  useEffect(() => {
    const asked = askedRef.current.trim();
    if (!open || !searched || pending || !asked) return;
    if (hits.length) say({ k: "ui:search-hits", el: document.getElementById(listId) });
    else say({ k: "ui:search-miss", el: inputRef.current, q: asked });
  }, [open, searched, pending, hits.length, listId]);

  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setPending(false);
      setSearched(false);
      if (!q.trim()) setHits([]);
      return;
    }
    setSearched(false);
    const ac = new AbortController();
    let cancelled = false;
    const tmr = window.setTimeout(() => {
      setPending(true);
      const qEnc = encodeURIComponent(q.trim());
      const gw = getGateway();
      void (async () => {
        const apply = (next: Hit[]) => {
          const merged = mergeBookHits(q.trim(), next);
          enter.mark(
            enteringIds(
              hitsRef.current.map((h) => ({ id: `${h.type}:${h.id}` })),
              merged.map((h) => ({ id: `${h.type}:${h.id}` }))
            )
          );
          setHits(merged);
          setActive(0);
        };
        apply([]);
        try {
          const r = await fetch(`${gw}/v1/resolve?q=${qEnc}`, {
            signal: ac.signal,
          });
          const j = (await r.json()) as { hits?: unknown[] };
          if (cancelled) return;
          const indexHits = Array.isArray(j.hits)
            ? j.hits.flatMap((x) => {
                const h = asHit(x, "index");
                return h ? [h] : [];
              })
            : [];
          if (indexHits.length) {
            const ranked = await rankTokenHits(q.trim(), indexHits, gw, ac.signal);
            apply(
              ranked.hits.map((h) =>
                h.type === "token" && ranked.holders[h.id] != null
                  ? { ...h, holders: ranked.holders[h.id] }
                  : h
              )
            );
            return;
          }
          const s = await fetch(`${gw}/v1/search?q=${qEnc}`, {
            signal: ac.signal,
          });
          const sj = (await s.json()) as { hits?: unknown[] };
          if (cancelled) return;
          const wideHits = Array.isArray(sj.hits)
            ? sj.hits.flatMap((x) => {
                const h = asHit(x, "wide");
                return h ? [h] : [];
              })
            : [];
          apply(wideHits);
        } catch (e: unknown) {
          if (cancelled) return;
          if (e instanceof DOMException && e.name === "AbortError") return;
        } finally {
          if (!cancelled) {
            setPending(false);
            setSearched(true);
          }
        }
      })();
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
      ac.abort();
    };
  }, [q, open, enter.mark]);

  const indexGrouped = useMemo(
    () => groupHits(hits.filter((h) => h.layer !== "wide")),
    [hits]
  );
  const wideGrouped = useMemo(
    () => groupHits(hits.filter((h) => h.layer === "wide")),
    [hits]
  );
  const historyShown = useMemo(
    () => recents.slice(0, phone ? HISTORY_SHOW_PHONE : HISTORY_SHOW).map(decorateAddressHit),
    [recents, phone]
  );
  const showHistory =
    historyShown.length > 0 && (!q.trim() || hits.length === 0);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (q.trim() && hits.length === 0) {
      const id = q.trim();
      out.push({
        key: `query:${id}`,
        hit: {
          type: "query",
          id,
          label: id,
          path: `/search?q=${encodeURIComponent(id)}`,
        },
      });
    }
    for (const g of indexGrouped) {
      for (const h of g.items) {
        out.push({ key: `${h.type}:${h.id}`, hit: h });
      }
    }
    for (const g of wideGrouped) {
      for (const h of g.items) {
        out.push({ key: `wide:${h.type}:${h.id}`, hit: h, wide: true });
      }
    }
    if (showHistory) {
      for (const h of historyShown) {
        out.push({
          key: `recent:${h.type}:${h.id}`,
          hit: h,
          recent: true,
        });
      }
    }
    return out;
  }, [q, hits.length, indexGrouped, wideGrouped, showHistory, historyShown]);

  useEffect(() => {
    setActive((a) => {
      if (!rows.length) return 0;
      return Math.min(a, rows.length - 1);
    });
  }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${listId}-opt-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const go = useCallback(
    (h: Hit) => {
      pushRecent(h);
      setRecents(readRecents());
      const path = safePath(h.path);
      navigate(explorerHref(path ?? `/search?q=${encodeURIComponent(h.id)}`, api));
    },
    [navigate, api]
  );

  const onInputKey = (e: InputKeyEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!rows.length) return;
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) go(row.hit);
      else if (q.trim()) {
        const id = q.trim();
        go({
          type: "query",
          id,
          label: id,
          path: `/search?q=${encodeURIComponent(id)}`,
        });
      }
    }
  };

  const quick = [
    { key: "nav.home", href: "/" },
    { key: "nav.blocks", href: "/blocks" },
    { key: "nav.mempool", href: "/mempool" },
    { key: "nav.txs", href: "/transactions" },
    { key: "nav.holders", href: "/addresses" },
    { key: "nav.names", href: "/names" },
    { key: "nav.favorites", href: "/favorites" },
    { key: "nav.tokens", href: "/tokens" },
    { key: "nav.nfts", href: "/nfts" },
    { key: "nav.rentUpcoming", href: "/rent" },
    { key: "nav.rentHistory", href: "/rent/history" },
    { key: "nav.defiSpectrum", href: "/defi/spectrum" },
    { key: "nav.defiPool", href: "/defi/pool" },
    { key: "nav.defiLithos", href: "/defi/lithos" },
    { key: "nav.defiAgeusd", href: "/defi/stable" },
    { key: "nav.defiBasis", href: "/defi/basis" },
    { key: "nav.oracles", href: "/oracles" },
    { key: "nav.oraclesOfficial", href: "/oracles/ergusd" },
    { key: "nav.oraclesUsd", href: "/oracles/erg-usd" },
    { key: "nav.oraclesXau", href: "/oracles/xau-erg" },
    { key: "nav.gort", href: "/oracles/xau-erg/gort" },
    { key: "nav.dort", href: "/oracles/erg-usd/dort" },
    { key: "nav.rosen", href: "/rosen" },
    { key: "nav.lithosProtocol", href: "/lithos" },
    { key: "nav.learn", href: "/learn" },
    { key: "nav.network", href: "/learn/network" },
    { key: "nav.about", href: "/about" },
    { key: "nav.api", href: "https://api.ergoscan.me/docs" },
    { key: "nav.status", href: "/status" },
  ];

  const panelEnter = reduce
    ? { opacity: 0 }
    : { opacity: 0, y: -8, scale: 0.98 };
  const panelShow = reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const panelLeave = {
    ...(reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }),
    transition: { duration: 0.14, ease: EASE },
  };

  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const renderOption = (row: Row, i: number) => {
    const selected = i === active;
    const keyId = `${row.hit.type}:${row.hit.id}`;
    const token = row.hit.type === "token" && !row.recent;
    const holders = token ? row.hit.holders : undefined;
    return (
      <div
        key={row.key}
        id={`${listId}-opt-${i}`}
        role="option"
        aria-selected={selected}
        onMouseEnter={() => setActive(i)}
        onClick={() => go(row.hit)}
        className={clsx(
          "chip-press group mb-0.5 flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-[10px] text-left",
          phone ? "min-h-[48px] px-3 py-2 text-[15px]" : "px-3.5 py-2 text-[13px]",
          selected && !phone ? "is-pressed bg-[var(--wash-mid)]" : "hover:bg-[var(--wash-faint)]",
          !row.recent && enter.enterClass(keyId)
        )}
      >
        <TypeGlyph type={row.hit.type} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={clsx("min-w-0 truncate text-[var(--text)]", phone ? "text-[15px]" : "text-[13px]")}>
            {row.recent ? (
              <>
                <span className="text-[var(--muted)]">
                  {typeLabel(row.hit.type, t)}{" "}
                </span>
                {hitCaption(row.hit)}
              </>
            ) : (
              hitCaption(row.hit)
            )}
          </span>
          {token && tokenKnown(row.hit.id) ? <KnownTokenMark /> : null}
        </span>
        {holders != null ? (
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-2)]">
            {tn("feed.holders", holders, holders.toLocaleString(loc))}
          </span>
        ) : null}
        {!row.recent &&
          row.hit.type !== "query" &&
          row.hit.label &&
          row.hit.label !== row.hit.id && (
            <span
              className={clsx(
                "shrink-0 font-mono text-[11px] tabular-nums",
                row.hit.type === "address" ? "text-[var(--muted-2)]" : "text-accent"
              )}
            >
              {shortId(row.hit.id, 6)}
            </span>
          )}
        {row.recent ? (
          <>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted-2)]">
              {formatRelTime(row.hit.ts ?? null, locale)}
            </span>
            <PressChip
              tabIndex={-1}
              aria-label={t("search.removeRecent")}
              className={clsx(
                "chip-press flex shrink-0 items-center justify-center overflow-hidden text-[var(--muted-2)] hover:bg-[var(--wash-mid)] hover:text-[var(--text)]",
                phone ? "-my-1 -mr-2 h-11 w-11 rounded-full text-[18px]" : "h-6 w-6 rounded-[6px]",
                phone || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                removeRecent(row.hit);
                setRecents(readRecents());
                inputRef.current?.focus();
              }}
            >
              ×
            </PressChip>
          </>
        ) : null}
      </div>
    );
  };

  const paintListbox = (): ReactNode[] => {
    const out: ReactNode[] = [];
    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      if (row.hit.type === "query") {
        out.push(renderOption(row, i));
        if (searched && !pending && hits.length === 0) {
          out.push(
            <div key="no-hits" role="presentation">
              <p
                aria-hidden="true"
                className="px-3 py-3 text-center text-[13px] text-[var(--muted)]"
              >
                {t("search.noHits")}
              </p>
            </div>
          );
        }
        i += 1;
        continue;
      }
      if (row.recent) {
        const hid = `${listId}-g-recent`;
        const items: { r: Row; idx: number }[] = [];
        while (i < rows.length && rows[i].recent) {
          items.push({ r: rows[i], idx: i });
          i += 1;
        }
        out.push(
          <div key="g-recent" role="group" aria-labelledby={hid}>
            <ListHead id={hid}>{t("search.recent")}</ListHead>
            {items.map(({ r, idx }) => renderOption(r, idx))}
          </div>
        );
        continue;
      }
      if (row.wide) {
        const hid = `${listId}-g-wide`;
        const items: { r: Row; idx: number }[] = [];
        while (i < rows.length && rows[i].wide) {
          items.push({ r: rows[i], idx: i });
          i += 1;
        }
        out.push(
          <div key="g-wide" role="group" aria-labelledby={hid}>
            <ListHead id={hid}>{t("search.wide")}</ListHead>
            {items.map(({ r, idx }, k) => {
              const prev = k === 0 ? undefined : items[k - 1].r;
              const typeHead = !prev || prev.hit.type !== r.hit.type;
              return (
                <div key={r.key} role="presentation">
                  {typeHead ? (
                    <ListHead hidden>{typeLabel(r.hit.type, t)}</ListHead>
                  ) : null}
                  {renderOption(r, idx)}
                </div>
              );
            })}
          </div>
        );
        continue;
      }
      const type = row.hit.type;
      const hid = `${listId}-g-${type}`;
      const items: { r: Row; idx: number }[] = [];
      while (
        i < rows.length &&
        !rows[i].recent &&
        !rows[i].wide &&
        rows[i].hit.type !== "query" &&
        rows[i].hit.type === type
      ) {
        items.push({ r: rows[i], idx: i });
        i += 1;
      }
      out.push(
        <div key={`g-${type}`} role="group" aria-labelledby={hid}>
          <ListHead id={hid}>{typeLabel(type, t)}</ListHead>
          {items.map(({ r, idx }) => renderOption(r, idx))}
        </div>
      );
    }
    return out;
  };

  const inputEl = (className: string) => (
    <input
      ref={inputRef}
      value={q}
      onChange={(e) => setQ(e.target.value)}
      onKeyDown={onInputKey}
      placeholder={t("search.placeholder")}
      enterKeyHint="search"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={rows[active] ? `${listId}-opt-${active}` : undefined}
      className={className}
    />
  );

  const listboxEl = (
    <div
      id={listId}
      role="listbox"
      className={clsx(
        "transition-opacity duration-[400ms] ease-[var(--ease)]",
        pending && hits.length > 0 && "opacity-60"
      )}
    >
      {paintListbox()}
    </div>
  );

  const clearRecentEl = (
    <PressChip
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        writeRecents([]);
        setRecents([]);
        inputRef.current?.focus();
      }}
      className={
        phone
          ? "chip-press flex h-11 items-center overflow-hidden rounded-[10px] px-3 text-[13px] text-[var(--muted-2)]"
          : "chip-press overflow-hidden rounded-[10px] px-2 py-1 text-[11px] text-[var(--muted-2)] hover:text-[var(--muted)]"
      }
    >
      {t("search.clearRecent")}
    </PressChip>
  );

  const jumpChips = quick.map((x) => (
    <PressChip
      key={x.href}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => navigate(x.key === "nav.api" ? x.href : explorerHref(x.href, api))}
      className={
        phone
          ? "search-chip-hit chip-press inline-flex h-9 items-center rounded-full bg-[var(--wash)] px-3.5 text-[13px] font-medium text-[var(--muted)]"
          : "chip-press overflow-hidden rounded-full bg-[var(--wash)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-opacity hover:text-[var(--text)]"
      }
    >
      {t(x.key)}
    </PressChip>
  ));

  return (
    <AnimatePresence onExitComplete={() => triggerRef.current?.focus()}>
      {open && !phone && (
        <motion.button
          key="search-backdrop"
          type="button"
          aria-label={t("nav.close")}
          className="search-backdrop fixed inset-0 z-[60] bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE } }}
          transition={{ duration: reduce ? 0.14 : 0.2, ease: EASE }}
          onClick={close}
        />
      )}
      {open && phone && (
        <motion.div
          key="search-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("search.title")}
          className="search-sheet fixed inset-0 z-[70] flex flex-col bg-[var(--bg)]"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE } }}
          transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE }}
        >
          <div className="flex shrink-0 items-center gap-1 pb-2 pl-3 pr-1.5 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
            <div className="search-sheet-field flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] pl-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-[var(--muted)]">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m16.2 16.2 4.3 4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {inputEl(
                "h-12 min-w-0 flex-1 bg-transparent text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--muted-2)]"
              )}
              {pending ? <span className="shrink-0 text-[12px] text-[var(--muted)]">…</span> : null}
              {q ? (
                <button
                  type="button"
                  aria-label={t("search.clear")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQ("");
                    inputRef.current?.focus();
                  }}
                  className="chip-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.28" />
                    <path d="m9 9 6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              ) : (
                <span className="w-2 shrink-0" aria-hidden />
              )}
            </div>
            <button
              type="button"
              onClick={close}
              className="chip-press flex h-11 shrink-0 items-center rounded-[10px] px-2.5 text-[15px] font-medium text-[var(--accent)]"
            >
              {t("search.cancel")}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
            {!q.trim() && canPaste ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-2 pt-1">
                <PressChip
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void onPaste()}
                  className="search-chip-hit chip-press inline-flex h-9 items-center gap-2 rounded-full bg-[var(--wash)] px-3.5 text-[13px] font-medium text-[var(--text)]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect x="6" y="5" width="12" height="16" stroke="currentColor" strokeWidth="2" />
                    <path d="M9 3h6v4H9z" fill="currentColor" />
                  </svg>
                  {t("search.paste")}
                </PressChip>
                {pasteMiss ? (
                  <span role="status" className="text-[12px] text-[var(--muted)]">
                    {t("search.pasteNone")}
                  </span>
                ) : null}
              </div>
            ) : null}
            {listboxEl}
            {showHistory ? <div className="px-1 pt-1">{clearRecentEl}</div> : null}
            {!q.trim() ? (
              <div className="px-2 pb-2 pt-3">
                <p className="mb-3 px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-2)]">
                  {t("search.jump")}
                </p>
                <div className="flex flex-wrap gap-x-1.5 gap-y-2">{jumpChips}</div>
              </div>
            ) : null}
          </div>
        </motion.div>
      )}
      {open && !phone && (
        <motion.div
          key="search-panel"
          role="dialog"
          aria-modal="true"
          aria-label={t("search.title")}
          className="search-panel fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] mx-auto w-[min(560px,calc(100vw-1rem))] sm:top-[11vh] sm:w-[min(560px,92vw)]"
          initial={panelEnter}
          animate={panelShow}
          exit={panelLeave}
          transition={{ duration: reduce ? 0.14 : 0.22, ease: EASE }}
        >
          <div className="search-panel-inner overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)]">
              <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5 sm:py-4">
                <span className="hidden text-[12px] font-medium text-[var(--muted)] sm:inline">
                  ⌘K
                </span>
                {inputEl(
                  "w-full bg-transparent text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--muted-2)]"
                )}
                {pending && (
                  <span className="text-[11px] text-[var(--muted)]">…</span>
                )}
              </div>

              <div className="max-h-[50vh] overflow-y-auto p-2">
                {listboxEl}
                {showHistory && (
                  <div className="mt-1.5 border-t border-[var(--border)] px-2.5 pt-2">
                    {clearRecentEl}
                  </div>
                )}

                {!q.trim() && (
                  <div className="px-3 py-3">
                    <p className="mb-2.5 px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-2)]">
                      {t("search.jump")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">{jumpChips}</div>
                  </div>
                )}
              </div>

              <div className="search-keys kbd-hints border-t border-[var(--border)] px-5 py-2.5 text-[10px] tracking-wide text-[var(--muted-2)]">
                ↑↓ {t("search.hintNav")} · ↵ {t("search.hintOpen")} · esc{" "}
                {t("search.hintClose")}
              </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Palette chips call preventDefault on mousedown to keep the combobox focused; arm the well by pointer. */
function PressChip({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { armed, bind } = usePaperPress(true);
  return (
    <button type="button" {...rest} {...bind} className={clsx(className, armed && "is-armed")}>
      {children}
    </button>
  );
}
