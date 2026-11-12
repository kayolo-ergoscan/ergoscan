"use client";

/**
 * One list system for the explorer. Every list is a feed of rows with the
 * same anatomy:
 *
 *   lead · tile · title / facts · chips · value (sub) · caret
 *
 * lead   time for chronological lists, rank for ranked lists
 * tile   what the row is, in its entity colour; hollow while unconfirmed
 * title  the entity; facts are a muted line under it
 * value  one mono figure; signed and coloured only when it is a flow
 *
 * Chronological lists group rows under day plates (FeedDays); ranked lists
 * sit under one plate that carries the sort (FeedBoard + FeedSort).
 * Colours come from tokens in looks.css; layout lives in app/feed.css.
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Tip, TipFigure, TipHead } from "@/components/Tip";
import { TokenLogo } from "@/components/TokenBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { formatDottedDate, formatH24, formatScaledAmount, formatScaledFixed, formatScaledGlance, shortId } from "@/lib/format";
import { tokenDecimals, tokenSymbol } from "@/lib/token-meta";
import { FeedGlyph, type FeedGlyphId } from "./FeedGlyph";
import { useStuckPlate } from "@/components/StuckPin";

export type FeedKind =
  | "transfer"
  | "token"
  | "nft"
  | "defi"
  | "stable"
  | "oracle"
  | "bridge"
  | "reward"
  | "rent"
  | "contract"
  | "mixer"
  | "in"
  | "out"
  | "self"
  | "swap"
  | "block"
  | "mint"
  | "burn"
  | "addr"
  | "exchange"
  | "box"
  | "quiet";

export function feedLoc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

/* ───────────────────────────── clock ───────────────────────────── */

const noSubscribe = () => () => {};

/**
 * The zone rows are printed in: UTC while the server HTML hydrates (the server
 * clock is UTC), the viewer's own clock right after. Mono digits keep the
 * width, so the switch does not move anything.
 */
export function useFeedZone(): string | undefined {
  const local = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
  return local ? undefined : "UTC";
}

export type FeedDayGroup<T> = { key: string; ms: number | null; items: T[] };

export function groupByDay<T>(
  items: readonly T[],
  msOf: (item: T) => number | null,
  zone: string | undefined,
  pendingOf?: (item: T) => boolean
): FeedDayGroup<T>[] {
  const days: FeedDayGroup<T>[] = [];
  for (const item of items) {
    const ms = msOf(item);
    const key = pendingOf?.(item) ? "pending" : ms == null ? "unknown" : formatDottedDate(ms, zone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, ms, items: [item] });
  }
  return days;
}

function weekday(ms: number, locale: string, zone: string | undefined): string {
  try {
    const w = new Intl.DateTimeFormat(feedLoc(locale), { weekday: "short", timeZone: zone }).format(ms);
    return w.charAt(0).toUpperCase() + w.slice(1).replace(/\.$/, "");
  } catch {
    return "";
  }
}

/* ───────────────────────────── frame ───────────────────────────── */

/** The list frame. `busy` dims it while a page loads. */
export function Feed({
  children,
  busy = false,
  className,
  enterClass,
}: {
  children: ReactNode;
  busy?: boolean;
  className?: string;
  enterClass?: string;
}) {
  return (
    <div className={clsx("feed", enterClass, className)} aria-busy={busy || undefined}>
      {children}
    </div>
  );
}

/** One card: a plate on top, rows under it. */
export function FeedSection({ plate, children, label }: { plate?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section className="feed-day" aria-label={label}>
      {plate}
      <ol className="feed-rows">{children}</ol>
    </section>
  );
}

/** The plate: a tag, then date and count, then whatever the list totals or sorts by. */
export function FeedPlate({
  tag,
  now = false,
  date,
  count,
  end,
  className,
}: {
  tag: ReactNode;
  now?: boolean;
  date?: ReactNode;
  count?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useStuckPlate(ref);
  return (
    <header ref={ref} className={clsx("feed-plate", now && "is-now", className)}>
      <span className="feed-plate-tag" suppressHydrationWarning>
        {tag}
      </span>
      {date != null ? (
        <span className="feed-plate-date tabular-nums" suppressHydrationWarning>
          {date}
        </span>
      ) : null}
      {count != null ? <span className="feed-plate-count">{count}</span> : null}
      {end != null ? <span className="feed-plate-end">{end}</span> : null}
    </header>
  );
}

export type FeedLead = { text: string; same: boolean; more: boolean };

/**
 * Chronological rows under day plates. The newest plate is printed white,
 * older ones in the page's colour. Rows that share a second with the row
 * above (txs of one block) print a bracket instead of repeating the time.
 */
export function FeedDays<T>({
  items,
  msOf,
  pendingOf,
  countOf,
  totalOf,
  seconds = false,
  render,
}: {
  items: readonly T[];
  msOf: (item: T) => number | null;
  pendingOf?: (item: T) => boolean;
  countOf: (n: number) => ReactNode;
  /** Only when a day total means something. */
  totalOf?: (items: T[]) => ReactNode;
  seconds?: boolean;
  render: (item: T, lead: FeedLead) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const zone = useFeedZone();
  const days = groupByDay(items, msOf, zone, pendingOf);
  const now = Date.now();
  const today = formatDottedDate(now, zone);
  const yesterday = formatDottedDate(now - 86_400_000, zone);
  return (
    <>
      {days.map((day, di) => {
        const pending = day.key === "pending";
        const unknown = day.key === "unknown";
        const tag = pending
          ? t("feed.pending")
          : unknown
            ? "—"
            : day.key === today
              ? t("feed.today")
              : day.key === yesterday
                ? t("feed.yesterday")
                : day.ms != null
                  ? weekday(day.ms, locale, zone)
                  : "—";
        const leads = day.items.map((item) => {
          const ms = msOf(item);
          return ms == null ? "—" : formatH24(ms, zone, seconds);
        });
        return (
          <FeedSection
            key={day.key}
            plate={
              <FeedPlate
                tag={tag}
                now={di === 0}
                date={pending || unknown ? undefined : day.key}
                count={countOf(day.items.length)}
                end={totalOf ? totalOf(day.items) : undefined}
              />
            }
          >
            {day.items.map((item, i) =>
              render(item, {
                text: leads[i]!,
                same: i > 0 && leads[i] === leads[i - 1] && leads[i] !== "—",
                more: i < leads.length - 1 && leads[i] === leads[i + 1] && leads[i] !== "—",
              })
            )}
          </FeedSection>
        );
      })}
    </>
  );
}

/** Ranked rows under one plate. */
export function FeedBoard({ plate, children }: { plate: ReactNode; children: ReactNode }) {
  return <FeedSection plate={plate}>{children}</FeedSection>;
}

/** Sort chips for a ranked plate. The pressed chip is printed white with its direction. */
export function FeedSort<K extends string>({
  options,
  active,
  dir,
  onSort,
  label,
  disabled,
}: {
  options: { key: K; label: string }[];
  active: K;
  /** Without a direction the chips are a filter: no arrow on the pressed one. */
  dir?: "asc" | "desc";
  onSort: (key: K) => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* A row of chips wider than the plate scrolls; the edge that hides more chips fades. */
    const mark = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      const more = start && end ? "both" : start ? "start" : end ? "end" : "";
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
    };
    mark();
    const pressed = el.querySelector<HTMLElement>("[aria-pressed='true']");
    if (pressed && pressed.offsetLeft + pressed.offsetWidth > el.clientWidth) {
      el.scrollLeft = pressed.offsetLeft - 8;
      mark();
    }
    el.addEventListener("scroll", mark, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(mark) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", mark);
      ro?.disconnect();
    };
  }, [active]);
  return (
    <span ref={ref} className="feed-sort" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.key === active;
        return (
          <button
            key={o.key}
            type="button"
            className="feed-sort-chip"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onSort(o.key)}
          >
            {o.label}
            {on && dir ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d={dir === "desc" ? "M12 5v14M6 13l6 6 6-6" : "M12 19V5M6 11l6-6 6 6"}
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </button>
        );
      })}
    </span>
  );
}

/* ───────────────────────────── row ───────────────────────────── */

export function FeedTile({
  k,
  g,
  hollow = false,
  children,
  title,
}: {
  k: FeedKind;
  g?: FeedGlyphId;
  hollow?: boolean;
  children?: ReactNode;
  title?: string;
}) {
  return (
    <Tip content={title}>
      <span
        className={clsx("feed-tile", hollow && "is-hollow", children != null && "has-art")}
        data-k={k}
        role={title ? "img" : undefined}
        aria-label={title || undefined}
        aria-hidden={title ? undefined : true}
      >
        {children ?? <FeedGlyph g={g ?? "none"} />}
      </span>
    </Tip>
  );
}

/** Below this the shell is the phone one: a row tap opens the item, the caret opens the detail. */
const PHONE_LAYOUT = "(max-width: 1023px)";

/** The page a row stands for, when the row names none: its title's own link. */
function titleLink(li: HTMLElement | null): HTMLAnchorElement | null {
  return li?.querySelector<HTMLAnchorElement>(".feed-title a[href]") ?? null;
}

function openKey(href: string): string {
  if (href.startsWith("/tx/")) return "feed.open.tx";
  if (href.startsWith("/block/")) return "feed.open.block";
  if (href.startsWith("/address/")) return "feed.open.address";
  if (href.startsWith("/token/")) return "feed.open.token";
  if (href.startsWith("/box/")) return "feed.open.box";
  if (href.startsWith("/defi/pool/")) return "feed.open.pool";
  return "feed.open";
}

/** The detail's last line: one wide button to the item's own page. */
function FeedOpen({ href }: { href: string }) {
  const { t } = useI18n();
  const label = (
    <>
      {t(openKey(href))}
      <span aria-hidden> →</span>
    </>
  );
  if (!href.startsWith("/")) {
    return (
      <a className="feed-open" href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  return (
    <Link prefetch={false} className="feed-open" href={href}>
      {label}
    </Link>
  );
}

function isInteractive(e: MouseEvent): boolean {
  const el = e.target as HTMLElement;
  if (el.closest("a,button,input,select,label,[role='button']")) return true;
  // A finger on a tip trigger (a meter, a kind tile) reads the tip; the row stays as it is.
  if ((e.nativeEvent as PointerEvent).pointerType === "touch" && el.closest("[data-tip]")) return true;
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  return !!sel && sel.toString().length > 0;
}

export function FeedRow({
  k,
  glyph,
  tile,
  hollow,
  tileTitle,
  lead,
  leadSub,
  title,
  facts,
  chips,
  value,
  sub,
  subMinor = false,
  detail,
  href,
  enterClass,
  onPointerEnter,
  className,
  rowProps,
}: {
  k: FeedKind;
  glyph?: FeedGlyphId;
  /** Custom tile art (a token logo). */
  tile?: ReactNode;
  hollow?: boolean;
  tileTitle?: string;
  lead: FeedLead | { rank: ReactNode };
  /** Under the time: the block a run of rows shares. Desktop only; phones keep it in the facts. */
  leadSub?: ReactNode;
  title: ReactNode;
  facts?: ReactNode;
  chips?: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  /** The sub line is a detail a phone can drop. */
  subMinor?: boolean;
  /** Built only when the row is opened. */
  detail?: () => ReactNode;
  /** The item's own page, when it is not the title's link. */
  href?: string;
  enterClass?: string;
  onPointerEnter?: () => void;
  className?: string;
  rowProps?: Record<string, string | undefined>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  const [goTo, setGoTo] = useState<string | null>(href ?? null);
  const canOpen = detail != null;
  const isRank = "rank" in lead;
  const leadText = isRank ? lead.rank : lead.text;
  const toggle = () => {
    if (!open) setGoTo(href ?? titleLink(ref.current)?.getAttribute("href") ?? null);
    setOpen(!open);
  };
  const openItem = (): boolean => {
    if (href) {
      router.push(href);
      return true;
    }
    const a = titleLink(ref.current);
    if (!a) return false;
    a.click();
    return true;
  };
  return (
    <li
      ref={ref}
      className={clsx("feed-row", canOpen && "can-open", href && "has-href", open && "is-open", enterClass, className)}
      data-k={k}
      onClick={(e) => {
        if (isInteractive(e)) return;
        if (window.matchMedia(PHONE_LAYOUT).matches && openItem()) return;
        if (canOpen) toggle();
        else openItem();
      }}
      onPointerEnter={onPointerEnter}
      {...rowProps}
    >
      <span
        className={clsx(
          "feed-lead tabular-nums",
          isRank && "is-rank",
          !isRank && lead.same && "is-same",
          !isRank && lead.more && "has-more",
          leadSub != null && "has-sub"
        )}
        suppressHydrationWarning
      >
        {leadText}
        {leadSub != null ? <span className="feed-lead-sub">{leadSub}</span> : null}
      </span>
      <FeedTile k={k} g={glyph} hollow={hollow} title={tileTitle}>
        {tile}
      </FeedTile>
      <div className="feed-main">
        <div className="feed-title">{title}</div>
        <div className="feed-facts">
          <span className="feed-when tabular-nums" suppressHydrationWarning>
            {isRank ? <>#{leadText}</> : leadText}
          </span>
          {facts}
        </div>
      </div>
      <div className="feed-end">
        {chips != null ? <div className="feed-chips">{chips}</div> : null}
        <div className="feed-value">
          {value ?? null}
          {sub != null ? <span className={clsx("feed-sub", subMinor && "is-minor")}>{sub}</span> : null}
        </div>
      </div>
      {canOpen ? (
        <button
          type="button"
          className="feed-caret"
          aria-expanded={open}
          aria-label={t("feed.details")}
          onClick={toggle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className="feed-caret" aria-hidden />
      )}
      {open && detail ? (
        <>
          <span className="feed-trace" aria-hidden />
          <div className="feed-detail">
            {detail()}
            {goTo ? <FeedOpen href={goTo} /> : null}
          </div>
        </>
      ) : null}
    </li>
  );
}

/* ───────────────────────────── figures ───────────────────────────── */

/** A plural phrase with only its number typed in mono: "3 transactions". */
export function FeedCount({ k, n, className }: { k: string; n: number; className?: string }) {
  const { tn, locale } = useI18n();
  const [a, b = ""] = tn(k, n, "\u0001").split("\u0001");
  return (
    <span className={className}>
      {a}
      <span className="tabular-nums">{n.toLocaleString(feedLoc(locale))}</span>
      {b}
    </span>
  );
}

/** A phrase with one figure slotted in ("active {ago}"); the figure is typed in mono. */
export function FeedPhrase({
  text,
  value,
  slot = "{ago}",
}: {
  text: string;
  value: ReactNode;
  slot?: string;
}) {
  const [a, b = ""] = text.split(slot);
  return (
    <>
      {a}
      <span className="tabular-nums" suppressHydrationWarning>
        {value}
      </span>
      {b}
    </>
  );
}

function signOf(n: bigint): string {
  return n > 0n ? "+" : n < 0n ? "−" : "";
}

/**
 * The row's one figure, typed in mono. `signed` prints + / − and the up/down
 * colour; anything that is not a flow stays white.
 */
export function FeedAmount({
  raw,
  decimals = 9,
  unit = "ERG",
  signed = false,
  glance = false,
  cents = false,
  className,
}: {
  raw: bigint | null | undefined;
  decimals?: number;
  unit?: ReactNode;
  signed?: boolean;
  glance?: boolean;
  /** A ranked balance column: every row whole and two decimals, so the column reads one way. */
  cents?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  if (raw == null) return <span className={clsx("feed-amt is-none", className)}>—</span>;
  const abs = raw < 0n ? -raw : raw;
  const tag = feedLoc(locale);
  const exact = formatScaledAmount(abs, decimals, tag, decimals);
  const hundredth = 10n ** BigInt(Math.max(0, decimals - 2));
  const text = cents
    ? abs > 0n && abs < hundredth
      ? "<0.01"
      : formatScaledFixed(abs, decimals, 2, tag)
    : glance
      ? formatScaledGlance(abs, decimals, tag).text
      : formatScaledAmount(abs, decimals, tag);
  const sign = signed ? signOf(raw) : "";
  const tone = signed ? (raw > 0n ? "var(--up)" : raw < 0n ? "var(--down)" : undefined) : undefined;
  // The row shows a glance; the tip gives every digit. Nothing to add when they match.
  return (
    <Tip
      tap={false}
      content={
        exact === text
          ? null
          : () => (
              <TipFigure ink={tone}>
                {sign}
                {exact}
                {typeof unit === "string" ? ` ${unit}` : ""}
              </TipFigure>
            )
      }
    >
      <span
        className={clsx(
          "feed-amt tabular-nums",
          signed && (raw > 0n ? "is-up" : raw < 0n ? "is-down" : "is-zero"),
          className
        )}
      >
        {sign}
        {text}
        {unit ? <span className="feed-unit">{unit}</span> : null}
      </span>
    </Tip>
  );
}

export type FeedTokenMeta = { name: string | null; decimals: number; artworkUrl?: string | null };

export function FeedTokenChip({
  tid,
  amt,
  meta,
  signed = true,
  className,
}: {
  tid: string;
  amt: bigint;
  meta?: FeedTokenMeta;
  signed?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const dec = tokenDecimals(tid, meta?.decimals);
  const abs = amt < 0n ? -amt : amt;
  const glance = formatScaledGlance(abs, dec, feedLoc(locale));
  const sym = tokenSymbol(tid, meta?.name) || shortId(tid, 4);
  const sign = signed ? signOf(amt) : "";
  const tone = signed ? (amt > 0n ? "var(--up)" : amt < 0n ? "var(--down)" : undefined) : undefined;
  return (
    <Tip
      tap={false}
      content={() => (
        <>
          <TipHead chip={sym} ink="var(--c-token, #5b8dff)">
            {meta?.name && meta.name !== sym ? meta.name : null}
          </TipHead>
          <TipFigure ink={tone}>
            {sign}
            {glance.exact}
          </TipFigure>
        </>
      )}
    >
    <Link
      prefetch={false}
      href={`/token/${tid}`}
      className={clsx("feed-chip", className)}
    >
      <TokenLogo tokenId={tid} artworkUrl={meta?.artworkUrl ?? null} size={16} />
      <span className={clsx("tabular-nums", signed && (amt > 0n ? "is-up" : amt < 0n ? "is-down" : undefined))}>
        {sign}
        {glance.text}
      </span>
      <span className="feed-chip-sym">{sym}</span>
    </Link>
    </Tip>
  );
}

/** Token chips: two on a desktop row, one on a phone, the rest behind +N. */
export function FeedTokenChips({
  tokens,
  meta,
  signed = true,
  max = 2,
}: {
  tokens: [string, bigint][];
  meta: (tid: string) => FeedTokenMeta | undefined;
  signed?: boolean;
  max?: number;
}) {
  const { tn } = useI18n();
  const [open, setOpen] = useState(false);
  if (!tokens.length) return null;
  const shown = open ? tokens : tokens.slice(0, max);
  const rest = tokens.length - shown.length;
  return (
    <span className={clsx("feed-chip-run", open && "is-open")}>
      {shown.map(([tid, amt], i) => (
        <FeedTokenChip
          key={tid}
          tid={tid}
          amt={amt}
          meta={meta(tid)}
          signed={signed}
          className={!open && i > 0 ? "feed-chip-2" : undefined}
        />
      ))}
      {rest > 0 ? (
        <Tip content={tn("feed.moreTokens", rest)} tap={false}>
          <button
            type="button"
            className="feed-chip is-plain feed-more-wide tabular-nums"
            aria-label={tn("feed.moreTokens", rest)}
            onClick={() => setOpen(true)}
          >
            +{rest}
          </button>
        </Tip>
      ) : null}
      {!open && tokens.length > 1 ? (
        <Tip content={tn("feed.moreTokens", tokens.length - 1)} tap={false}>
          <button
            type="button"
            className="feed-chip is-plain feed-more-narrow tabular-nums"
            aria-label={tn("feed.moreTokens", tokens.length - 1)}
            onClick={() => setOpen(true)}
          >
            +{tokens.length - 1}
          </button>
        </Tip>
      ) : null}
    </span>
  );
}

/** A plain chip: a count or a word, same shape as a token chip. */
export function FeedChip({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <Tip content={title}>
      <span className={clsx("feed-chip is-plain", className)}>{children}</span>
    </Tip>
  );
}

/** A ten-step level lit in the row's colour: how full a block is, a holder's share. */
export function FeedMeter({ pct, label, title }: { pct: number; label: string; title?: string }) {
  const lit = !(pct > 0) ? 0 : Math.max(1, Math.min(10, Math.ceil(pct / 10)));
  return (
    <Tip content={title ?? label}>
    <span className="feed-meter" role="img" aria-label={title ?? label}>
      <span className="feed-meter-steps" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < lit ? "is-lit" : undefined} />
        ))}
      </span>
      <span className="feed-meter-label tabular-nums" aria-hidden>
        {label}
      </span>
    </span>
    </Tip>
  );
}

/* ───────────────────────────── detail ───────────────────────────── */

export function FeedFields({ children }: { children: ReactNode }) {
  return <div className="feed-fields">{children}</div>;
}

export function FeedField({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={clsx("feed-field", wide && "is-wide")}>
      <span className="feed-field-label">{label}</span>
      <div className="feed-field-value">{children}</div>
    </div>
  );
}

export function FeedCopy({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="feed-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? t("tx.copied") : t("tx.copy")}
    </button>
  );
}

/** Full id, linked, with a copy button. */
export function FeedIdLine({ href, id }: { href: string; id: string }) {
  return (
    <span className="feed-id-line">
      <Link prefetch={false} href={href} className="feed-id font-mono tabular-nums hover:underline">
        {id}
      </Link>
      <FeedCopy text={id} />
    </span>
  );
}

/* ───────────────────────────── states ───────────────────────────── */

/** Nothing to list: a hollow tile under the same plate. */
export function FeedEmpty({ title, hint, k = "quiet", plate }: { title: string; hint?: string; k?: FeedKind; plate?: ReactNode }) {
  return (
    <section className="feed-day">
      {plate}
      <div className="feed-empty">
        <FeedTile k={k} g="none" hollow />
        <div className="min-w-0">
          <p className="feed-empty-title">{title}</p>
          {hint ? <p className="feed-empty-hint">{hint}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** Loading: the row's shape, breathing. Still under reduced motion. */
export function FeedSkeleton({ rows = 6, plate = true }: { rows?: number; plate?: boolean }) {
  const { t } = useI18n();
  return (
    <section className="feed-day feed-skel" aria-busy="true">
      <span className="sr-only" role="status">
        {t("common.loading")}
      </span>
      {plate ? (
        <header className="feed-plate" aria-hidden>
          <span className="feed-skel-bar is-tag" />
          <span className="feed-skel-bar is-date" />
        </header>
      ) : null}
      <ol className="feed-rows" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="feed-row is-skel" style={{ ["--i" as string]: i }}>
            <span className="feed-skel-bar is-lead" />
            <span className="feed-tile is-skel" />
            <span className="feed-main">
              <span className="feed-skel-bar is-title" />
              <span className="feed-skel-bar is-facts" />
            </span>
            <span className="feed-end">
              <span className="feed-value">
                <span className="feed-skel-bar is-value" />
              </span>
            </span>
            <span className="feed-caret" />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Short id link in the entity colour (links take their target's colour in looks.css). */
export function FeedIdLink({ href, id, n = 6, title }: { href: string; id: string; n?: number; title?: string }) {
  return (
    <Link prefetch={false} href={href} title={title ?? id} className="feed-idlink font-mono tabular-nums hover:underline">
      {shortId(id, n)}
    </Link>
  );
}
