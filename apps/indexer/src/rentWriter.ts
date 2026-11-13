/**
 * Rent claims, off the indexer tick.
 * History: keeps rent_claim_verify_height and finishes the guess rows.
 * Tip: own cursor rent_claim_live_height, from the last guess height upward.
 * Full scan: own cursor rent_claim_full_height, from block 1_051_199 upward.
 * It starts only after rent_claim_verify_done. Do not reset any cursor.
 */
import http from "node:http";
import pg from "pg";
import { maybeFollowRentTip, maybeScanRentFull, maybeVerifyRentClaims } from "./rentClaim.js";
import { maybeRefreshRentHistory } from "./rentCollected.js";

const port = Number(process.env.HEALTH_PORT || 8798);
const pollMs = Number(process.env.POLL_MS || 2000);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://ergoscan:changeme@127.0.0.1:5432/ergoscan",
  max: 4,
});
// Idle client errors (Postgres restart) must not kill the writer; see db.ts.
pool.on("error", (e) => console.warn("[rent-writer] postgres idle client error", String(e).slice(0, 200)));
pool.on("connect", (client) => {
  client.on("error", (e) => console.warn("[rent-writer] postgres client error", String(e).slice(0, 200)));
});

const health: {
  ok: boolean;
  mode: string;
  verifyHeight: string | null;
  liveHeight: string | null;
  fullHeight: string | null;
  tipHeight: string | null;
  lastError: string | null;
} = {
  ok: true,
  mode: "boot",
  verifyHeight: null,
  liveHeight: null,
  fullHeight: null,
  tipHeight: null,
  lastError: null,
};

async function refresh(): Promise<void> {
  const r = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM indexer_state
     WHERE key = ANY($1::text[])`,
    [[
      "rent_claim_verify_height",
      "rent_claim_live_height",
      "rent_claim_full_height",
      "rent_claim_verify_done",
      "last_height",
    ]]
  );
  const m = new Map(r.rows.map((row) => [row.key, row.value]));
  health.verifyHeight = m.get("rent_claim_verify_height") ?? null;
  health.liveHeight = m.get("rent_claim_live_height") ?? null;
  health.fullHeight = m.get("rent_claim_full_height") ?? null;
  health.tipHeight = m.get("last_height") ?? null;
  health.mode = m.get("rent_claim_verify_done") ? "tip" : "history";
}

async function tick(): Promise<void> {
  await maybeVerifyRentClaims(pool);
  await maybeFollowRentTip(pool);
  await maybeScanRentFull(pool);
  await maybeRefreshRentHistory(pool);
  await refresh();
  health.ok = true;
  health.lastError = null;
}

http
  .createServer((req, res) => {
    if (req.url === "/health" || req.url === "/health/") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(health));
      return;
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`[rent-writer] health 127.0.0.1:${port}`);
  });

async function loop(): Promise<void> {
  for (;;) {
    try {
      await tick();
    } catch (e) {
      health.ok = false;
      health.lastError = String(e);
      console.warn("[rent-writer]", health.lastError);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

void loop();
