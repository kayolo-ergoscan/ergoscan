/**
 * Link-preview cards (1200×630) for /og/{tx|address|token}/{id}. Telegram, X and Discord
 * show them under a pasted link. Look «Сигнал»: neutral black, one colour per entity,
 * every number in IBM Plex Mono. Rendered by next/og on request and cached by HTTP;
 * nothing is stored.
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

const sans = "Plex Sans";
const mono = "Plex Mono";

/** Entity label: flat coloured plate with black text. */
export function Plate({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        background: color,
        color: "#0e0e0e",
        fontFamily: sans,
        fontWeight: 600,
        fontSize: 26,
        padding: "6px 16px",
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
    <div style={{ display: "flex", fontFamily: mono, fontWeight: weight, fontSize: size, color, letterSpacing: -1 }}>
      {children}
    </div>
  );
}

export type OgChip = { label: string; amount: string; logo: string | null };

export function Chips({ chips, more }: { chips: OgChip[]; more: number }) {
  if (!chips.length) return null;
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      {chips.map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: OG.tile,
            border: `2px solid ${OG.line}`,
            borderRadius: 999,
            padding: "8px 20px 8px 10px",
          }}
        >
          {c.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo} width={36} height={36} style={{ borderRadius: 999 }} alt="" />
          ) : (
            <div style={{ display: "flex", width: 36, height: 36, borderRadius: 999, background: OG.token }} />
          )}
          <div style={{ display: "flex", fontFamily: mono, fontWeight: 600, fontSize: 28, color: OG.text }}>{c.amount}</div>
          <div style={{ display: "flex", fontFamily: sans, fontWeight: 600, fontSize: 26, color: OG.token, maxWidth: 260, overflow: "hidden" }}>
            {c.label}
          </div>
        </div>
      ))}
      {more > 0 ? (
        <div style={{ display: "flex", fontFamily: mono, fontWeight: 500, fontSize: 28, color: OG.muted }}>+{more}</div>
      ) : null}
    </div>
  );
}

/** Card frame: entity plate top-left, wordmark top-right, body, footer line (left facts, right id). */
export function OgFrame({
  plate,
  plateColor,
  children,
  left,
  right,
}: {
  plate: string;
  plateColor: string;
  children: ReactNode;
  left: ReactNode[];
  right?: string | null;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG.page,
        padding: "56px 64px 48px",
        fontFamily: sans,
        color: OG.text,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Plate color={plateColor}>{plate}</Plate>
        <div style={{ display: "flex", fontFamily: sans, fontWeight: 600, fontSize: 30, letterSpacing: 2 }}>
          <span style={{ color: OG.muted }}>[ </span>
          <span style={{ color: OG.tx }}>ERGO</span>
          <span style={{ color: OG.text }}>SCAN</span>
          <span style={{ color: OG.tx }}>ME</span>
          <span style={{ color: OG.muted }}> ]</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 28 }}>
        {children}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `2px solid ${OG.line}`,
          paddingTop: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline" }}>
          {left.filter(Boolean).map((node, i) => (
            <div key={i} style={{ display: "flex", marginLeft: i ? 36 : 0 }}>
              {node}
            </div>
          ))}
        </div>
        {right ? (
          <div style={{ display: "flex", fontFamily: mono, fontWeight: 500, fontSize: 24, color: OG.muted }}>{right}</div>
        ) : null}
      </div>
    </div>
  );
}

/** "label value" pair for the footer; value in mono. */
export function Fact({ label, value, color = OG.soft }: { label?: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      {label ? (
        <div style={{ display: "flex", fontFamily: sans, fontSize: 24, color: OG.muted, marginRight: 12 }}>{label}</div>
      ) : null}
      <div style={{ display: "flex", fontFamily: mono, fontWeight: 600, fontSize: 28, color }}>{value}</div>
    </div>
  );
}
