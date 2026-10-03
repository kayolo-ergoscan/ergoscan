"use client";

/**
 * Quiet Home Earth — prebaked Natural Earth texture (no GeoJSON at runtime).
 * Peers as beads on hash slots, not geo. New ids flash in, then orbit.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { getGateway } from "@/lib/config";
import { loadGlobeMap, makePlaceholderMap } from "@/lib/earth-texture";
import { enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { INK } from "@/lib/palette";
import { ReelText } from "@/components/ReelText";
import { useI18n } from "@/lib/i18n/I18nProvider";

const REGION_INK = [INK.cyan, INK.green, INK.gold, INK.coral, INK.sky, INK.violet, INK.teal];

type OrbitPeer = { id: string; t: number; c?: number; ip?: string; name?: string };
type OrbitRegion = { id: string; n: number };

type Slot = {
  id: string;
  theta: number;
  inc: number;
  lan: number;
  r: number;
  inner: boolean;
  speed: number;
  name: string;
  ip: string;
  born: number;
  delay: number;
  rgb: [number, number, number];
};

type Pt = { x: number; y: number; z: number };

type Hit = {
  id: string;
  x: number;
  y: number;
  z: number;
  name: string;
  ip: string;
};

const TAU = Math.PI * 2;
/** House keyed-enter window; motion starts after this. */
const ENTER_MS = 400;
const FLASH_MS = 180;

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function unit(h: number, salt: number): number {
  return ((h >>> salt) & 0xffff) / 0xffff;
}

function wrapAngle(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function peerRgb(id: string): [number, number, number] {
  return hexRgb(REGION_INK[hash32(id) % REGION_INK.length]);
}

function isInner(p: OrbitPeer, now: number): boolean {
  return p.c === 0
    ? false
    : p.c === 1 || p.c == null || (p.t > 0 && now - p.t < 2 * 60 * 60 * 1000);
}

function newSlot(p: OrbitPeer, i: number, n: number, wall: number, born: number): Slot {
  const h = hash32(p.id);
  const y = 1 - (2 * (i + 0.5)) / Math.max(1, n);
  return {
    id: p.id,
    theta: unit(h, 0) * TAU,
    inc: Math.acos(Math.max(-1, Math.min(1, y))),
    lan: unit(h, 16) * TAU,
    r: 1.055 + Math.floor(unit(h, 4) * 4) * 0.07,
    inner: isInner(p, wall),
    speed: 0.00007 + unit(h, 12) * 0.00008,
    name: (p.name ?? "").trim(),
    ip: (p.ip ?? "").trim(),
    born,
    delay: (h % 18) * 22,
    rgb: peerRgb(p.id),
  };
}

/** Keep live theta on refetch so the 30s poll does not rewind the orbit. */
function mergeSlots(prev: Slot[], peers: OrbitPeer[], wall: number, born: number): Slot[] {
  const keep = new Map(prev.map((s) => [s.id, s]));
  const n = peers.length;
  return peers.map((p, i) => {
    const old = keep.get(p.id);
    if (old) {
      return {
        ...old,
        inner: isInner(p, wall),
        name: (p.name ?? "").trim(),
        ip: (p.ip ?? "").trim(),
      };
    }
    return newSlot(p, i, n, wall, born);
  });
}

/** Point on an inclined orbit (inclination + longitude of ascending node). */
function onOrbit(theta: number, inc: number, lan: number, r: number): Pt {
  const x0 = r * Math.sin(theta);
  const z0 = r * Math.cos(theta);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const y1 = z0 * si;
  const z1 = z0 * ci;
  const cl = Math.cos(lan);
  const sl = Math.sin(lan);
  return { x: x0 * cl + z1 * sl, y: y1, z: z1 * cl - x0 * sl };
}

function rotate(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number
): { x: number; y: number; z: number } {
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const x1 = x * cosY + z * sinY;
  const z1 = z * cosY - x * sinY;
  return { x: x1, y: y * cosX - z1 * sinX, z: z1 * cosX + y * sinX };
}

const VERT = `
attribute vec2 a;
void main() {
  gl_Position = vec4(a, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform sampler2D uMap;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uRx;
uniform float uRy;
uniform vec3 uBg;

vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x * c + p.z * s, p.y, p.z * c - p.x * s);
}
vec3 rotX(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x, p.y * c - p.z * s, p.z * c + p.y * s);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float dist = length(p);
  if (dist > uRadius) {
    gl_FragColor = vec4(uBg, 1.0);
    return;
  }
  float z = sqrt(max(0.0, uRadius * uRadius - dist * dist));
  vec3 n = vec3(p.x, p.y, z) / uRadius;
  vec3 w = rotX(rotY(n, uRy), uRx);
  float lon = atan(w.x, w.z);
  float lat = asin(clamp(w.y, -1.0, 1.0));
  vec2 uv = vec2(0.5 + lon / 6.28318530718, 0.5 + lat / 3.14159265359);
  vec3 albedo = texture2D(uMap, uv).rgb;
  vec3 light = normalize(vec3(-0.38, 0.42, 0.82));
  float ndl = max(0.0, dot(n, light));
  vec3 col = albedo * (0.9 + 0.1 * ndl);
  float edge = smoothstep(uRadius - 1.0, uRadius, dist);
  col = mix(col, uBg, edge);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("shader");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || "compile");
  }
  return s;
}

function pickHit(hits: Hit[], mx: number, my: number): Hit | null {
  let best: Hit | null = null;
  let bestScore = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - mx, h.y - my);
    if (d > 22) continue;
    const score = d - h.z * 6;
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

export function NetworkOrbit({ enter = 0 }: { enter?: number }) {
  const { t, locale } = useI18n();
  const { mark, enterClass } = useEnterIds();
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const slotsRef = useRef<Slot[]>([]);
  const regionsRef = useRef<OrbitRegion[]>([]);
  const rot = useRef({ y: 1.52, x: -0.24 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const hoverIdRef = useRef<string | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipNameRef = useRef<HTMLParagraphElement>(null);
  const tipIpRef = useRef<HTMLParagraphElement>(null);
  const nodeWord = useRef(t("home.node"));
  nodeWord.current = t("home.node");
  const [peerN, setPeerN] = useState(0);
  const [regions, setRegions] = useState<OrbitRegion[]>([]);
  const regionNames = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      dn = null;
    }
    return regions.map((r) => {
      const named = dn?.of(r.id);
      return { id: r.id, n: r.n, label: named && named !== r.id ? named : r.id };
    });
  }, [locale, regions]);

  const load = useCallback(async (): Promise<number> => {
    try {
      const r = await fetch(`${getGateway()}/v1/network/orbit`, { cache: "no-store" });
      const j = (await r.json()) as { peers?: OrbitPeer[]; regions?: OrbitRegion[] };
      const peers = Array.isArray(j.peers) ? j.peers : [];
      if (peers.length > 0) {
        slotsRef.current = mergeSlots(slotsRef.current, peers, Date.now(), performance.now());
        setPeerN(peers.length);
        const nextRegions = Array.isArray(j.regions)
          ? j.regions.filter((x) => x && typeof x.id === "string" && Number.isFinite(x.n)).slice(0, 8)
          : [];
        mark(enteringIds(regionsRef.current, nextRegions));
        regionsRef.current = nextRegions;
        setRegions(nextRegions);
        return peers.length;
      }
    } catch {
      /* keep whatever is already in orbit */
    }
    return slotsRef.current.length;
  }, [mark]);

  useEffect(() => {
    let n = 0;
    let timer = 0;
    let stopped = false;
    const run = () => {
      void load().then((count) => {
        if (stopped) return;
        n += 1;
        const wait = count > 0 ? 30_000 : n < 6 ? 2_000 : 15_000;
        timer = window.setTimeout(run, wait);
      });
    };
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !glCanvas || !overlay) return;

    const gl = glCanvas.getContext("webgl", {
      alpha: false,
      antialias: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    });
    const octx = overlay.getContext("2d");
    if (!gl || !octx) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const map = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, map);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makePlaceholderMap());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let mapped = true;
    const aniso =
      gl.getExtension("EXT_texture_filter_anisotropic") ||
      gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
    void loadGlobeMap().then((img) => {
      if (!mapped) return;
      gl.bindTexture(gl.TEXTURE_2D, map);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (aniso) {
        const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max || 1));
      }
    }).catch(() => {
      /* keep ocean placeholder */
    });

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uCenter = gl.getUniformLocation(prog, "uCenter");
    const uRadius = gl.getUniformLocation(prog, "uRadius");
    const uRx = gl.getUniformLocation(prog, "uRx");
    const uRy = gl.getUniformLocation(prog, "uRy");
    const uBg = gl.getUniformLocation(prog, "uBg");
    const uMap = gl.getUniformLocation(prog, "uMap");
    gl.uniform1i(uMap, 0);

    const pageRgb = (() => {
      const raw = getComputedStyle(wrap).getPropertyValue("--module").trim();
      const hex = raw.startsWith("#") ? raw.slice(1).replace(/[^0-9a-f]/gi, "") : "";
      if (hex.length >= 6) {
        const n = Number.parseInt(hex.slice(0, 6), 16);
        if (Number.isFinite(n)) {
          return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
        }
      }
      return [53 / 255, 52 / 255, 61 / 255] as const;
    })();
    gl.uniform3f(uBg, pageRgb[0], pageRgb[1], pageRgb[2]);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;

    const paint = (now: number) => {
      if (!running) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 32 || h < 32 || Math.abs(w - h) > 4) {
        raf = requestAnimationFrame(paint);
        return;
      }
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (glCanvas.width !== pw || glCanvas.height !== ph) {
        glCanvas.width = pw;
        glCanvas.height = ph;
        overlay.width = pw;
        overlay.height = ph;
      }

      if (!reduce && !drag.current) {
        rot.current.y += 0.00155;
        for (const s of slotsRef.current) {
          if (now - s.born - s.delay >= ENTER_MS) s.theta += s.speed;
        }
      }
      rot.current.y = wrapAngle(rot.current.y);
      for (const s of slotsRef.current) s.theta = wrapAngle(s.theta);
      const { x: rx, y: ry } = rot.current;
      const R = Math.min(w, h) * 0.5 - 36;
      const cx = w * 0.5;
      const cy = h * 0.5;

      gl.viewport(0, 0, pw, ph);
      gl.clearColor(pageRgb[0], pageRgb[1], pageRgb[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, pw, ph);
      gl.uniform2f(uCenter, cx * dpr, (h - cy) * dpr);
      gl.uniform1f(uRadius, R * dpr);
      gl.uniform1f(uRx, rx);
      gl.uniform1f(uRy, ry);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, w, h);
      const project = (
        theta: number,
        inc: number,
        lan: number,
        r: number,
        yaw: number,
        pitch: number
      ): Pt => {
        const a = onOrbit(theta, inc, lan, r);
        const p = rotate(a.x, a.y, a.z, pitch, yaw);
        return { x: cx + p.x * R, y: cy - p.y * R, z: p.z };
      };

      const painted = slotsRef.current.map((s) => {
        const head = project(s.theta, s.inc, s.lan, s.r, ry, rx);
        return {
          head,
          inner: s.inner,
          z: head.z,
          id: s.id,
          name: s.name,
          ip: s.ip,
          rgb: s.rgb,
          born: s.born,
          delay: s.delay,
        };
      });
      painted.sort((a, b) => a.z - b.z);

      const hits: Hit[] = [];
      for (const d of painted) {
        const head = d.head;
        if (head.z < -0.16) continue;
        let fade = 1;
        let fr = d.rgb[0];
        let fg = d.rgb[1];
        let fb = d.rgb[2];
        if (!reduce) {
          const age = now - d.born - d.delay;
          if (age < 0) continue;
          if (age < ENTER_MS) {
            const t = age / ENTER_MS;
            fade = 1 - (1 - t) ** 3;
            if (age < FLASH_MS) {
              const flash = 1 - age / FLASH_MS;
              fr += (255 - fr) * flash;
              fg += (255 - fg) * flash;
              fb += (255 - fb) * flash;
            }
          }
        }
        const depth = 0.38 + Math.max(0, Math.min(1, head.z * 0.65 + 0.35)) * 0.62;
        octx.fillStyle = `rgb(${fr | 0},${fg | 0},${fb | 0})`;
        octx.beginPath();
        octx.arc(head.x, head.y, d.inner ? 4.2 : 3.2, 0, TAU);
        octx.globalAlpha = (d.inner ? 0.96 : 0.78) * depth * fade;
        octx.fill();
        hits.push({ id: d.id, x: head.x, y: head.y, z: head.z, name: d.name, ip: d.ip });
      }
      octx.globalAlpha = 1;
      hitsRef.current = hits;

      const box = tipRef.current;
      const hid = hoverIdRef.current;
      if (box && hid && !drag.current) {
        const still = hits.find((h) => h.id === hid);
        if (still) {
          box.style.left = `${still.x}px`;
          box.style.top = `${still.y}px`;
        } else {
          hoverIdRef.current = null;
          box.style.opacity = "0";
          box.style.transform = "translate(-50%, calc(-100% - 4px))";
        }
      }

      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => {
      mapped = false;
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const loc = locale === "ru" ? "ru-RU" : "en-US";

  return (
    <section
      className="home-tile-enter home-meet-right min-w-0 max-lg:order-5 lg:h-full"
      style={{ "--enter": enter } as CSSProperties}
    >
      <article className="mod flex h-full min-h-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] px-4 py-3 sm:px-5">
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex h-[22px] shrink-0 items-center justify-between gap-3 sm:col-span-2 sm:row-start-1">
          <h2 className="m-0 text-[17px] font-semibold leading-none tracking-tight">{t("home.network")}</h2>
          <p
            className={clsx(
              "m-0 text-[22px] font-semibold leading-none tabular-nums tracking-tight",
              peerN <= 0 && "text-[var(--muted)]"
            )}
          >
            <ReelText text={peerN > 0 ? peerN.toLocaleString(loc) : "—"} />
          </p>
        </div>
        <div className="flex min-h-0 min-w-0 items-center justify-center sm:col-start-1 sm:row-start-2">
          <div className="relative aspect-square w-full max-w-[15rem] overflow-hidden">
            <div ref={wrapRef} className="absolute inset-0">
              <canvas ref={glRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
                aria-label={t("home.network")}
                onPointerDown={(e) => {
                  (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                  drag.current = { x: e.clientX, y: e.clientY };
                  hoverIdRef.current = null;
                  const box = tipRef.current;
                  if (box) {
                    box.style.opacity = "0";
                    box.style.transform = "translate(-50%, calc(-100% - 4px))";
                  }
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (d) {
                    rot.current.y += (e.clientX - d.x) * 0.008;
                    rot.current.x = Math.max(-0.85, Math.min(0.85, rot.current.x + (e.clientY - d.y) * 0.006));
                    drag.current = { x: e.clientX, y: e.clientY };
                    return;
                  }
                  const wrap = wrapRef.current;
                  const box = tipRef.current;
                  if (!wrap || !box) return;
                  const r = wrap.getBoundingClientRect();
                  const hit = pickHit(hitsRef.current, e.clientX - r.left, e.clientY - r.top);
                  if (!hit) {
                    hoverIdRef.current = null;
                    box.style.opacity = "0";
                    box.style.transform = "translate(-50%, calc(-100% - 4px))";
                    return;
                  }
                  hoverIdRef.current = hit.id;
                  if (tipNameRef.current) tipNameRef.current.textContent = hit.name || nodeWord.current;
                  if (tipIpRef.current) {
                    tipIpRef.current.textContent = hit.ip;
                    tipIpRef.current.classList.toggle("hidden", !hit.ip);
                  }
                  box.style.left = `${hit.x}px`;
                  box.style.top = `${hit.y}px`;
                  box.style.opacity = "1";
                  box.style.transform = "translate(-50%, calc(-100% - 10px))";
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onPointerLeave={() => {
                  if (drag.current) return;
                  hoverIdRef.current = null;
                  const box = tipRef.current;
                  if (box) {
                    box.style.opacity = "0";
                    box.style.transform = "translate(-50%, calc(-100% - 4px))";
                  }
                }}
              />
              <div
                ref={tipRef}
                className="pointer-events-none absolute left-0 top-0 z-[2] w-max max-w-[16rem] rounded-[10px] border border-[var(--border)] bg-[var(--module)] px-3 py-2 motion-reduce:duration-0"
                style={{
                  opacity: 0,
                  transform: "translate(-50%, calc(-100% - 4px))",
                  transitionProperty: "opacity, transform",
                  transitionDuration: "350ms",
                  transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                <p ref={tipNameRef} className="truncate text-[13px] font-medium tracking-tight" />
                <p ref={tipIpRef} className="mt-0.5 text-[12px] tabular-nums text-[var(--muted)]" />
              </div>
            </div>
          </div>
        </div>
        {regionNames.length > 0 ? (
          <ul className="m-0 grid max-h-full min-h-0 w-full list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 overflow-y-auto p-0 sm:col-start-2 sm:row-start-2 sm:w-[11rem] sm:self-center">
            {regionNames.map((r, i) => {
              const ink = REGION_INK[i % REGION_INK.length];
              return (
                <li key={r.id} className={clsx("contents", enterClass(r.id))}>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: ink }}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate text-[13px]">{r.label}</span>
                  <span
                    className="pl-1 text-right text-[13px] font-medium tabular-nums"
                    style={{ color: ink }}
                  >
                    <ReelText text={r.n.toLocaleString(loc)} />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 w-full text-[13px] text-[var(--muted-2)] sm:col-start-2 sm:row-start-2 sm:w-[11rem] sm:self-center">
            {t("home.unavailable")}
          </p>
        )}
      </div>
        <div className="mt-auto flex items-baseline justify-between gap-3 pt-3">
          <Link href="/learn#limits" className="text-[13px] text-[var(--muted)] hover:text-[var(--text)]">
            {t("nav.learn")}
          </Link>
        </div>
      </div>
      </article>
    </section>
  );
}

export default NetworkOrbit;
