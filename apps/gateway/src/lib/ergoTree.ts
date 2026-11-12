/**
 * ErgoTree decode for GET /v1/boxes/:id, plus the template-hash filler.
 * sigmastate-js stays on the gateway — never re-export through shared/web.
 * Not used on box lists. Hash = SHA-256(template bytes). Not blake2b. Not hex-ASCII.
 */
import { sha256 } from "@noble/hashes/sha2.js";

export type ErgoTreeConstantRow = {
  index: number;
  sigmaType: string;
  renderedValue: string;
  hex: string;
};

export type ErgoTreeDecode = {
  ergoTreeConstants: string;
  ergoTreeScript: string;
  ergoTreeTemplateHash: string | null;
  treeConstants: ErgoTreeConstantRow[];
};

const EMPTY: ErgoTreeDecode = {
  ergoTreeConstants: "",
  ergoTreeScript: "",
  ergoTreeTemplateHash: null,
  treeConstants: [],
};

const CACHE_MAX = 64;
const cache = new Map<string, ErgoTreeDecode>();

type SigmaTree = {
  templateHex?: () => string;
  constants?: () => Array<{
    tpe?: { name?: string };
    data?: unknown;
    toHex?: () => string;
  }>;
  root?: { wrappedValue?: { toString?: () => string } };
  toString?: () => string;
};

type SigmaLib = {
  ErgoTree$: { fromHex: (hex: string) => SigmaTree };
};

let libP: Promise<SigmaLib | null> | null = null;

function normTreeHex(tree: string | null | undefined): string | null {
  if (!tree || typeof tree !== "string") return null;
  const h = tree.startsWith("0x") ? tree.slice(2) : tree;
  const hex = h.toLowerCase();
  return /^[0-9a-f]+$/.test(hex) && hex.length >= 2 ? hex : null;
}

function sha256Bytes(buf: Uint8Array): string {
  return Buffer.from(sha256(buf)).toString("hex");
}

function hashTemplate(tree: SigmaTree, rawHex: string): string | null {
  try {
    const th = String(tree.templateHex?.() ?? "");
    if (/^[0-9a-f]+$/i.test(th) && th.length >= 2 && th.length % 2 === 0) {
      return sha256Bytes(Buffer.from(th, "hex"));
    }
  } catch {
    /* fallback */
  }
  try {
    return sha256Bytes(Buffer.from(rawHex, "hex"));
  } catch {
    return null;
  }
}

function scalaTypeName(tpe: string): string {
  const n = tpe.trim();
  if (n === "Boolean") return "SBoolean";
  if (n === "Byte") return "SByte$";
  if (n === "Short") return "SShort$";
  if (n === "Int") return "SInt$";
  if (n === "Long") return "SLong$";
  if (n === "BigInt") return "SBigInt$";
  if (n === "GroupElement") return "SGroupElement$";
  if (n === "SigmaProp") return "SSigmaProp";
  if (n === "Coll[Byte]") return "Coll[SByte$]";
  if (n.startsWith("Coll[Coll[Byte]")) return "Coll[Coll[SByte$]]";
  return n;
}

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

/**
 * Official explorer text of a compressed secp256k1 point: ECPoint(x6,y6,...), the first six hex
 * digits of x and of y as numbers. y is recovered from x (y^2 = x^3 + 7). Null when it is not a point.
 */
export function ecPointShort(pk: string): string | null {
  const h = pk.toLowerCase();
  if (!/^0[23][0-9a-f]{64}$/.test(h)) return null;
  const x = BigInt(`0x${h.slice(2)}`);
  const y2 = (x * x * x + 7n) % SECP_P;
  let y = modPow(y2, (SECP_P + 1n) / 4n, SECP_P);
  if ((y * y) % SECP_P !== y2) return null;
  if ((y & 1n) !== (h[1] === "3" ? 1n : 0n)) y = SECP_P - y;
  // Hex of the number, no leading zeros (official prints 0x0edc90… as edc90f).
  return `ECPoint(${x.toString(16).slice(0, 6)},${y.toString(16).slice(0, 6)},...)`;
}

/** SigmaProp / GroupElement constants from their serialized hex (the JS objects print [object Object]). */
function pointConstant(tpe: string, hex: string): string | null {
  const h = hex.toLowerCase();
  if (tpe === "GroupElement" && h.startsWith("07")) return ecPointShort(h.slice(2));
  if (tpe === "SigmaProp" && h.startsWith("08cd")) {
    const p = ecPointShort(h.slice(4));
    return p ? `SigmaProp(ProveDlog(${p}))` : null;
  }
  if (tpe === "SigmaProp" && h.length > 2) return `SigmaProp(${h.slice(2)})`;
  return null;
}

function scalaValue(tpe: string, data: unknown, hex = ""): string {
  const point = tpe === "GroupElement" || tpe === "SigmaProp" ? pointConstant(tpe, hex) : null;
  if (point) return point;
  if (tpe === "Boolean") return data === true ? "true" : "false";
  if (typeof data === "bigint") return data.toString();
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (tpe === "Coll[Byte]" && Array.isArray(data)) {
    return `Coll(${data.map((n) => String(n)).join(",")})`;
  }
  if (Array.isArray(data)) {
    const inner = data.map((item) =>
      Array.isArray(item) ? `Coll(${item.map((n) => String(n)).join(",")})` : String(item)
    );
    return `Coll(${inner.join(",")})`;
  }
  if (data == null) return "null";
  return String(data);
}

function scriptFromTree(tree: SigmaTree): string {
  const wrapped = tree.root?.wrappedValue;
  if (wrapped && typeof wrapped.toString === "function") {
    const s = String(wrapped.toString());
    if (s && s !== "[object Object]") return s;
  }
  try {
    const s = String(tree.toString?.() ?? "");
    if (s && s !== "[object Object]") return s;
  } catch {
    /* */
  }
  return "";
}

function formatConstants(rows: ErgoTreeConstantRow[]): string {
  if (!rows.length) return "";
  return rows.map((r) => `${r.index}: ${r.sigmaType} = ${r.renderedValue}`).join("\n");
}

/** The official explorer's constants text: "[]" or "[\n  0: SInt$ = 720,\n  1: …\n]". */
export function officialConstantsText(rows: ErgoTreeConstantRow[]): string {
  if (!rows.length) return "[]";
  return `[\n${rows.map((r) => `  ${r.index}: ${r.sigmaType} = ${r.renderedValue}`).join(",\n")}\n]`;
}

async function loadLib(): Promise<SigmaLib | null> {
  if (libP) return libP;
  libP = import("sigmastate-js/main")
    .then((m) => {
      const ErgoTree$ = (m as { ErgoTree$?: SigmaLib["ErgoTree$"] }).ErgoTree$;
      if (!ErgoTree$?.fromHex) return null;
      return { ErgoTree$ };
    })
    .catch((err) => {
      console.warn("[ergoTree] sigmastate-js load failed", err);
      libP = null;
      return null;
    });
  return libP;
}

/** Load Scala.js once so the first box GET is not the cold 100MB parse. */
export function warmErgoTreeParser(): void {
  void loadLib();
}

export function decodeErgoTreeSync(hex: string, lib: SigmaLib): ErgoTreeDecode {
  const raw = normTreeHex(hex);
  if (!raw) return { ...EMPTY };
  try {
    const tree = lib.ErgoTree$.fromHex(raw);
    const consts = tree.constants?.() ?? [];
    const rows: ErgoTreeConstantRow[] = consts.map((c, index) => {
      const tpe = String(c.tpe?.name ?? "");
      let hexVal = "";
      try {
        hexVal = String(c.toHex?.() ?? "");
      } catch {
        hexVal = "";
      }
      return {
        index,
        sigmaType: scalaTypeName(tpe),
        renderedValue: scalaValue(tpe, c.data, hexVal),
        hex: hexVal,
      };
    });
    return {
      ergoTreeConstants: formatConstants(rows),
      ergoTreeScript: scriptFromTree(tree),
      ergoTreeTemplateHash: hashTemplate(tree, raw),
      treeConstants: rows,
    };
  } catch {
    return {
      ...EMPTY,
      ergoTreeTemplateHash: (() => {
        try {
          return sha256Bytes(Buffer.from(raw, "hex"));
        } catch {
          return null;
        }
      })(),
    };
  }
}

/** SHA-256(template bytes). Same bytes as the box card. Null when the hex is not a tree. */
export async function ergoTreeTemplateHash(treeHex: string | null | undefined): Promise<string | null> {
  const raw = normTreeHex(treeHex ?? null);
  if (!raw) return null;
  const lib = await loadLib();
  if (!lib) return null;
  try {
    return hashTemplate(lib.ErgoTree$.fromHex(raw), raw);
  } catch {
    try {
      return sha256Bytes(Buffer.from(raw, "hex"));
    } catch {
      return null;
    }
  }
}

export async function decodeErgoTree(treeHex: string | null | undefined): Promise<ErgoTreeDecode> {
  const raw = normTreeHex(treeHex ?? null);
  if (!raw) return { ...EMPTY };
  const hit = cache.get(raw);
  if (hit) return hit;
  const lib = await loadLib();
  if (!lib) return { ...EMPTY };
  const decoded = decodeErgoTreeSync(raw, lib);
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(raw, decoded);
  return decoded;
}

/** SHA-256(template bytes). Test helper — hashing the hex string must not match. */
export function sha256HexBytes(hex: string): string {
  return sha256Bytes(Buffer.from(hex, "hex"));
}
