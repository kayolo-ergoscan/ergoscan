/**
 * Pull one IPFS image, store a 480px webp on the preview host, mark the CID.
 * Bytes never go into Postgres. data: URLs are skipped.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipfsCidFromPath, ipfsPathFromHref } from "@ergoscan/shared";
import { createPool } from "./db.js";

const GATES = [
  "https://ipfs.blockfrost.dev/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://w3s.link/ipfs/",
];
const HOST = process.env.NFT_PREVIEW_HOST || "10.0.0.3";
const SSH_KEY = process.env.NFT_PREVIEW_KEY || "/root/.ssh/id_ed25519_ergoscan";
const CURSOR = process.env.NFT_PREVIEW_CURSOR || "/var/lib/ergoscan/nft-preview.cursor";
const MAX_BYTES = 12 * 1024 * 1024;
const BATCH = 12;

const pool = createPool();

const CONTROL = "/run/ergoscan/nft-preview.sock";

function sshArgs(remote: string[]): string[] {
  return [
    "-i",
    SSH_KEY,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${CONTROL}`,
    "-o",
    "ControlPersist=600",
    ...remote,
  ];
}

function run(cmd: string, args: string[], stdin?: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${code}`));
    });
    if (stdin) child.stdin.end(stdin);
  });
}

async function pull(path: string): Promise<Buffer | null> {
  for (const gate of GATES) {
    try {
      const res = await fetch(gate + path, {
        signal: AbortSignal.timeout(18_000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const len = Number(res.headers.get("content-length") || 0);
      if (len > MAX_BYTES) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 32 || buf.length > MAX_BYTES) continue;
      return buf;
    } catch {
      continue;
    }
  }
  return null;
}

async function toWebp(buf: Buffer): Promise<Buffer | null> {
  const dir = join(tmpdir(), `nftp-${randomBytes(4).toString("hex")}`);
  const src = join(dir, "in");
  const dst = join(dir, "out.webp");
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(src, buf);
    await run("python3", [
      join(process.cwd(), "apps/indexer/src/nftPreviewConvert.py"),
      src,
      dst,
    ]);
    const out = await readFile(dst);
    return out.length > 32 ? out : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function safeCid(cid: string): boolean {
  return /^[A-Za-z0-9]{8,128}$/.test(cid);
}

async function ship(cid: string, webp: Buffer): Promise<void> {
  if (!safeCid(cid)) throw new Error("cid");
  await mkdir("/run/ergoscan", { recursive: true });
  const prefix = cid.slice(0, 2);
  const remote = `mkdir -p /var/nft-preview/${prefix} && cat > /var/nft-preview/${prefix}/${cid}.webp`;
  await run("ssh", sshArgs([`root@${HOST}`, remote]), webp);
}

async function mark(cid: string, status: "ready" | "fail", bytes: number | null, note: string) {
  await pool.query(
    `INSERT INTO nft_preview (cid, status, bytes, note, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (cid) DO UPDATE
       SET status = EXCLUDED.status,
           bytes = EXCLUDED.bytes,
           note = EXCLUDED.note,
           updated_at = now()`,
    [cid, status, bytes, note.slice(0, 40)]
  );
}

async function cursor(): Promise<string> {
  try {
    return (await readFile(CURSOR, "utf8")).trim();
  } catch {
    return "";
  }
}

async function saveCursor(id: string) {
  await mkdir("/var/lib/ergoscan", { recursive: true });
  await writeFile(CURSOR, id);
}

async function tick(): Promise<number> {
  const after = await cursor();
  const client = await pool.connect();
  let rows: { token_id: string; artwork_url: string }[] = [];
  try {
    await client.query("SET statement_timeout = 8000");
    const q = await client.query<{ token_id: string; artwork_url: string }>(
      `SELECT token_id, artwork_url
         FROM tokens
        WHERE token_id > $1
          AND emission = 1
          AND artwork_url IS NOT NULL
          AND artwork_url <> ''
          AND artwork_url NOT LIKE 'data:%'
        ORDER BY token_id
        LIMIT $2`,
      [after, BATCH]
    );
    rows = q.rows;
  } finally {
    client.release();
  }
  if (!rows.length) {
    await saveCursor("");
    return 0;
  }
  const jobs: { cid: string; path: string; tokenId: string }[] = [];
  for (const row of rows) {
    const path = ipfsPathFromHref(row.artwork_url);
    const cid = ipfsCidFromPath(path);
    if (path && cid) jobs.push({ cid, path, tokenId: row.token_id });
  }
  const known = new Set<string>();
  if (jobs.length) {
    const have = await pool.query<{ cid: string }>(
      `SELECT cid FROM nft_preview WHERE cid = ANY($1::text[])`,
      [jobs.map((j) => j.cid)]
    );
    for (const row of have.rows) known.add(row.cid);
  }
  let n = 0;
  for (const job of jobs) {
    if (known.has(job.cid)) continue;
    known.add(job.cid);
    const buf = await pull(job.path);
    if (!buf) {
      await mark(job.cid, "fail", null, "fetch");
      n += 1;
      continue;
    }
    const webp = await toWebp(buf);
    if (!webp) {
      await mark(job.cid, "fail", null, "convert");
      n += 1;
      continue;
    }
    try {
      await ship(job.cid, webp);
      await mark(job.cid, "ready", webp.length, "");
    } catch {
      await mark(job.cid, "fail", null, "ship");
    }
    n += 1;
  }
  await saveCursor(rows[rows.length - 1]!.token_id);
  console.log(`preview batch after=${after.slice(0, 8)} rows=${rows.length} touched=${n}`);
  return rows.length;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  if (process.env.NFT_PREVIEW_ONCE === "1") {
    await tick();
    await pool.end();
    return;
  }
  for (;;) {
    const n = await tick().catch((e) => {
      console.error("preview tick", e instanceof Error ? e.message : "fail");
      return 0;
    });
    await new Promise((r) => setTimeout(r, n === 0 ? 60_000 : 400));
  }
}

main();
