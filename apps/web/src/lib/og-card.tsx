/**
 * Link-preview cards (1200×630) for /og/{tx|address|token}/{id}, plus the site card
 * (/og/site/card, baked to public/og.png). Telegram, X and Discord show them under a
 * pasted link. Look «Сигнал»: neutral black, the «Трата» lockup, one colour per entity,
 * every number in IBM Plex Mono, no fiat. Rendered by next/og on request and cached by
 * HTTP; nothing is stored. Mockups: design/brand/sheets/og.html.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const OG = {
  page: "#0e0e0e",
  tile: "#1a1a1a",
  line: "#2a2a2a",
  text: "#ffffff",
  muted: "#a3a3a3",
  soft: "#c6c6c6",
  chip: "#262626",
  block: "#ffd23c",
  tx: "#ff6a2b",
  address: "#ff7ab8",
  token: "#5b8dff",
  box: "#2fd27f",
  up: "#2fd27f",
  down: "#ff5468",
} as const;

const FONT_DIR = path.join(process.cwd(), "assets", "og-fonts");

type OgFont = { name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" };

let fontsP: Promise<OgFont[]> | null = null;

export function ogFonts(): Promise<OgFont[]> {
  fontsP ??= Promise.all([
    readFile(path.join(FONT_DIR, "IBMPlexSans-Regular.ttf")).then((data) => ({ name: "Plex Sans", data, weight: 400 as const, style: "normal" as const })),
    readFile(path.join(FONT_DIR, "IBMPlexSans-SemiBold.ttf")).then((data) => ({ name: "Plex Sans", data, weight: 600 as const, style: "normal" as const })),
    readFile(path.join(FONT_DIR, "IBMPlexMono-Medium.ttf")).then((data) => ({ name: "Plex Mono", data, weight: 500 as const, style: "normal" as const })),
    readFile(path.join(FONT_DIR, "IBMPlexMono-SemiBold.ttf")).then((data) => ({ name: "Plex Mono", data, weight: 600 as const, style: "normal" as const })),
  ]).catch((e) => {
    fontsP = null;
    throw e;
  });
  return fontsP;
}

const LOGO_DIR = path.join(process.cwd(), "public", "token-logos");
const logoCache = new Map<string, string | null>();

/** data: URI of a local token logo, or null. Ids are checked hex, so no path tricks. */
export async function tokenLogoData(tokenId: string): Promise<string | null> {
  const id = tokenId.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  if (logoCache.has(id)) return logoCache.get(id) ?? null;
  let out: string | null = null;
  for (const [ext, mime] of [["png", "image/png"], ["svg", "image/svg+xml"], ["jpg", "image/jpeg"], ["webp", "image/webp"]] as const) {
    try {
      const buf = await readFile(path.join(LOGO_DIR, `${id}.${ext}`));
      if (ext === "webp") break; // satori cannot draw webp
      out = `data:${mime};base64,${buf.toString("base64")}`;
      break;
    } catch {
      /* next ext */
    }
  }
  if (logoCache.size > 512) logoCache.clear();
  logoCache.set(id, out);
  return out;
}

/** 1 234 567.8 → "1,234,567.8"; small values keep up to `maxDec` decimals; big ones go compact. */
export function ogNumber(value: number, maxDec = 4): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim((value / 1e9).toFixed(2))}B`;
  if (abs >= 1e7) return `${trim((value / 1e6).toFixed(2))}M`;
  const dec = abs >= 1000 ? 2 : abs >= 1 ? Math.min(maxDec, 4) : maxDec;
  const fixed = value.toFixed(dec);
  const [i, f] = fixed.split(".");
  const int = Number(i).toLocaleString("en-US");
  const frac = f ? f.replace(/0+$/, "") : "";
  if (!frac && abs > 0 && abs < 10 ** -dec) return `<${(10 ** -dec).toFixed(dec)}`;
  return frac ? `${int}.${frac}` : int;
}

function trim(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** nanoERG → ERG number for display (full nano precision below ~9M ERG). */
export function nanoToErg(nano: bigint | number | string | null | undefined): number {
  if (nano == null) return 0;
  try {
    const b = typeof nano === "bigint" ? nano : BigInt(String(nano).split(".")[0] || "0");
    return Number(b / 1_000_000_000n) + Number(b % 1_000_000_000n) / 1e9;
  } catch {
    return 0;
  }
}

/** Raw token amount with decimals → number. */
export function scaled(raw: bigint | number | string, decimals: number): number {
  try {
    const b = typeof raw === "bigint" ? raw : BigInt(String(raw).split(".")[0] || "0");
    const d = Math.max(0, Math.min(18, decimals | 0));
    if (d === 0) return Number(b);
    const base = 10n ** BigInt(d);
    return Number(b / base) + Number(b % base) / Number(base);
  } catch {
    return 0;
  }
}

export function ogShort(id: string, n = 6): string {
  if (!id || id.length <= n * 2 + 1) return id;
  return `${id.slice(0, n)}…${id.slice(-n)}`;
}

/**
 * Text the card fonts can draw: Plex Sans covers Latin, Cyrillic and Greek, not emoji or CJK,
 * which satori would show as empty boxes. Drops the rest; null when nothing is left.
 */
export function ogText(s: string | null | undefined, max = 28): string | null {
  if (!s) return null;
  const clean = s
    .normalize("NFC")
    .replace(/[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{P}\p{Zs}$+<=>^`|~]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || !/[\p{L}\p{N}]/u.test(clean)) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function ogUtc(ts: number | null | undefined): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** "12 Nov 2026" in UTC. */
export function ogDate(ts: number | null | undefined): string | null {
  return ogUtc(ts)?.split(",")[0] ?? null;
}

/** "16:12" in UTC. */
export function ogClock(ts: number | null | undefined): string | null {
  const s = ogUtc(ts);
  return s ? s.split(", ")[1]!.replace(" UTC", "") : null;
}

const sans = "Plex Sans";
const mono = "Plex Mono";

/**
 * The «Трата» mark on the 24 grid (heavier, for the 40-odd px lockup) or the 48 grid.
 * Plain rects only: satori draws them exactly, no fill rules needed.
 */
export function OgMark({ size, grid = 24 }: { size: number; grid?: 24 | 48 }) {
  const [o, t, n] = grid === 24 ? [2, 3, [10, 12]] : [4, 5, [20, 24]];
  const spent = grid === 24 ? 13 : 26;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${grid} ${grid}`}>
      <rect x={o} y={o} width={spent} height={t} fill={OG.text} />
      <rect x={o} y={o + spent - t} width={spent} height={t} fill={OG.text} />
      <rect x={o} y={o} width={t} height={spent} fill={OG.text} />
      <rect x={o + spent - t} y={o} width={t} height={spent} fill={OG.text} />
      <rect x={n[0]} y={n[0]} width={n[1]} height={n[1]} fill={OG.tx} />
    </svg>
  );
}

/** Mark + «ergoscan.me», `.me` a step quieter, as on the site. */
export function OgLockup({ mark = 44, word = 36, grid = 24 }: { mark?: number; word?: number; grid?: 24 | 48 }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <OgMark size={mark} grid={grid} />
      <div style={{ display: "flex", marginLeft: Math.round(mark * 0.32), fontFamily: sans, fontWeight: 600, fontSize: word, letterSpacing: -0.5 }}>
        <div style={{ display: "flex", color: OG.text }}>ergoscan</div>
        <div style={{ display: "flex", color: OG.muted }}>.me</div>
      </div>
    </div>
  );
}

/** Entity label: flat coloured plate with black text. */
export function Plate({ color, children, size = 26 }: { color: string; children: ReactNode; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        background: color,
        color: "#0e0e0e",
        fontFamily: sans,
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1.25,
        padding: size > 22 ? "4px 14px" : "3px 11px",
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}

export function Mono({
  children,
  size,
  color = OG.text,
  weight = 600,
}: {
  children: ReactNode;
  size: number;
  color?: string;
  weight?: 500 | 600;
}) {
  return (
    <div style={{ display: "flex", fontFamily: mono, fontWeight: weight, fontSize: size, color, letterSpacing: -1, lineHeight: 1 }}>
      {children}
    </div>
  );
}

/** A big number with its unit: integer part in white, decimals quieter, unit in grey. */
export function BigFigure({ value, unit, size = 104, unitColor = OG.muted }: { value: string; unit: string; size?: number; unitColor?: string }) {
  // Quieter decimals only on long numbers, where they are the tail, not the point.
  const m = /^(\d{1,3}(?:,\d{3})+)(\.\d+)$/.exec(value);
  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      <Mono size={size}>{m ? m[1] : value}</Mono>
      {m ? (
        <Mono size={size} color={OG.soft}>
          {m[2]}
        </Mono>
      ) : null}
      <div style={{ display: "flex", marginLeft: 20, fontFamily: mono, fontWeight: 500, fontSize: Math.round(size * 0.42), color: unitColor, lineHeight: 1 }}>
        {unit}
      </div>
    </div>
  );
}

export type OgChip = { label: string; amount: string; logo: string | null };

/** Rough rendered width of a chip, so the row never runs off the card. */
function chipWidth(c: OgChip): number {
  return 10 + 34 + 12 + c.amount.length * 15.6 + 12 + Math.min(c.label.length * 13.5, 220) + 20;
}

/** Token chips; drops the ones that would not fit and says how many more there are. */
export function Chips({ chips, more = 0, tail, budget = 1000 }: { chips: OgChip[]; more?: number; tail?: string | null; budget?: number }) {
  const shown: OgChip[] = [];
  let used = tail ? tail.length * 15.6 + 14 : 60;
  for (const c of chips) {
    const w = chipWidth(c) + 14;
    if (used + w > budget) break;
    shown.push(c);
    used += w;
  }
  const extra = more + (chips.length - shown.length);
  if (!shown.length && !tail) return null;
  const end = tail ?? (extra > 0 ? `+${extra}` : null);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {shown.map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            marginRight: 14,
            background: OG.chip,
            borderRadius: 999,
            padding: "8px 20px 8px 10px",
          }}
        >
          {c.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo} width={34} height={34} style={{ borderRadius: 999 }} alt="" />
          ) : (
            <div style={{ display: "flex", width: 34, height: 34, borderRadius: 999, background: OG.token }} />
          )}
          <div style={{ display: "flex", marginLeft: 12, fontFamily: sans, fontWeight: 600, fontSize: 25, color: OG.text, maxWidth: 220, overflow: "hidden" }}>
            {c.label}
          </div>
          <div style={{ display: "flex", marginLeft: 12, fontFamily: mono, fontWeight: 500, fontSize: 26, color: OG.soft }}>{c.amount}</div>
        </div>
      ))}
      {end ? <div style={{ display: "flex", fontFamily: mono, fontWeight: 500, fontSize: 26, color: OG.muted }}>{end}</div> : null}
    </div>
  );
}

export type OgTile = { label: string; value: string; unit?: string | null; color?: string };

function Tile({ tile, plate }: { tile: OgTile; plate: string }) {
  const n = tile.value.length + (tile.unit ? tile.unit.length * 0.6 + 1 : 0);
  const size = n <= 9 ? 38 : n <= 11 ? 32 : 28;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        background: OG.tile,
        borderRadius: 20,
        padding: "18px 22px 20px",
      }}
    >
      <div style={{ display: "flex" }}>
        <Plate color={plate} size={20}>
          {tile.label}
        </Plate>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 14 }}>
        <Mono size={size} color={tile.color ?? OG.text}>
          {tile.value}
        </Mono>
        {tile.unit ? (
          <div style={{ display: "flex", marginLeft: 8, fontFamily: mono, fontWeight: 500, fontSize: 22, color: OG.muted }}>{tile.unit}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Card frame: lockup top-left, entity plate and short id top-right, one main tile,
 * a row of fact tiles under it (their labels wear the entity colour).
 */
export function OgFrame({
  plate,
  plateColor,
  id,
  children,
  tiles,
}: {
  plate: string;
  plateColor: string;
  id?: string | null;
  children: ReactNode;
  tiles: OgTile[];
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG.page,
        padding: "44px 56px 52px",
        fontFamily: sans,
        color: OG.text,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 52 }}>
        <OgLockup />
        <div style={{ display: "flex", alignItems: "center" }}>
          <Plate color={plateColor}>{plate}</Plate>
          {id ? (
            <div style={{ display: "flex", marginLeft: 16, fontFamily: mono, fontWeight: 500, fontSize: 28, color: OG.soft }}>{id}</div>
          ) : null}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flexGrow: 1,
          marginTop: 28,
          background: OG.tile,
          borderRadius: 24,
          padding: "24px 44px",
        }}
      >
        {children}
      </div>
      {tiles.length ? (
        <div style={{ display: "flex", marginTop: 20 }}>
          {tiles.map((t, i) => (
            <div key={i} style={{ display: "flex", flexGrow: 1, flexBasis: 0, marginLeft: i ? 20 : 0 }}>
              <Tile tile={t} plate={plateColor} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Vertical gap inside the main tile (satori keeps margins more reliably than `gap`). */
export function Gap({ h }: { h: number }) {
  return <div style={{ display: "flex", height: h, flexShrink: 0 }} />;
}

/** Entity glyphs from the site set, drawn for the default card. */
function EntityGlyph({ kind, size = 30 }: { kind: "block" | "tx" | "address" | "token" | "box"; size?: number }) {
  const line = OG.soft;
  const s = { stroke: line, strokeWidth: 2, fill: "none" } as const;
  const u = OG[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {kind === "block" ? (
        <g>
          <rect x="6" y="6" width="12" height="12" {...s} />
          <path d="M1 12h5M18 12h5" {...s} />
          <rect x="9" y="9" width="6" height="6" fill={u} />
        </g>
      ) : kind === "tx" ? (
        <g>
          <rect x="2" y="9" width="6" height="6" {...s} />
          <path d="M10 12h3.5M11.5 9.5 14 12l-2.5 2.5" {...s} />
          <rect x="16" y="8" width="7" height="8" fill={u} />
        </g>
      ) : kind === "address" ? (
        <g>
          <rect x="2" y="5" width="20" height="14" {...s} />
          <path d="M14 10h5M14 14h3" {...s} />
          <rect x="5" y="9" width="6" height="6" fill={u} />
        </g>
      ) : kind === "token" ? (
        <g>
          <circle cx="12" cy="12" r="8.5" {...s} />
          <rect x="9" y="9" width="6" height="6" fill={u} />
        </g>
      ) : (
        <g>
          <path d="M4 9v11h16V9M10 13h4" {...s} />
          <rect x="2" y="4" width="20" height="5" fill={u} />
        </g>
      )}
    </svg>
  );
}

/** Site-wide card (public/og.png): lockup, heading, caption, the search line and the five entities. */
export function OgSiteCard({ heading, caption }: { heading: string; caption: string }) {
  const kinds = [
    ["block", "Block"],
    ["tx", "Transaction"],
    ["address", "Address"],
    ["token", "Token"],
    ["box", "Box"],
  ] as const;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG.page,
        padding: "64px 64px 60px",
        fontFamily: sans,
        color: OG.text,
      }}
    >
      <OgLockup mark={68} word={60} grid={48} />
      <div style={{ display: "flex", marginTop: 52, fontWeight: 600, fontSize: 72, letterSpacing: -1.5, lineHeight: 1 }}>{heading}</div>
      <div style={{ display: "flex", marginTop: 18, fontSize: 30, color: OG.soft }}>{caption}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginTop: 44,
          height: 84,
          background: OG.tile,
          borderRadius: 18,
          padding: "0 30px",
        }}
      >
        <svg width={30} height={30} viewBox="0 0 24 24">
          <rect x="3" y="3" width="13" height="13" stroke={OG.block} strokeWidth={2.4} fill="none" />
          <path d="M15 15l6 6" stroke={OG.block} strokeWidth={2.4} />
        </svg>
        <div style={{ display: "flex", marginLeft: 18, fontFamily: mono, fontWeight: 500, fontSize: 32, color: OG.text }}>
          block, tx, address, token, box
        </div>
        <div style={{ display: "flex", width: 20, height: 4, marginLeft: 4, marginTop: 22, background: OG.text }} />
      </div>
      <div style={{ display: "flex", marginTop: 36 }}>
        {kinds.map(([k, label], i) => (
          <div
            key={k}
            style={{
              display: "flex",
              alignItems: "center",
              marginLeft: i ? 14 : 0,
              background: OG.tile,
              borderRadius: 14,
              padding: "12px 22px 12px 16px",
            }}
          >
            <EntityGlyph kind={k} />
            <div style={{ display: "flex", marginLeft: 12, fontWeight: 600, fontSize: 27 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
