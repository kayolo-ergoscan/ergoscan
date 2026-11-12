import pg from "pg";

const { Pool } = pg;

export function createPool(databaseUrl?: string) {
  const url =
    databaseUrl ||
    process.env.DATABASE_URL ||
    "postgres://ergoscan:changeme@127.0.0.1:5432/ergoscan";
  const pool = new Pool({
    connectionString: url,
    max: Math.max(3, Number(process.env.PG_POOL_MAX || 4) || 4),
    idleTimeoutMillis: 30_000,
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 8_000),
  });
  // An idle client dies when Postgres restarts. Without a listener that 'error' event is
  // unhandled and kills the process (12 Nov 2026: every writer crashed on a PG recreate).
  // The pool drops the dead client; the next query opens a new one.
  pool.on("error", (e) => console.warn("[defi] postgres idle client error", String(e).slice(0, 200)));
  // A checked-out client (held across queries) gets the same error as its own 'error' event.
  // Log it; its next query fails, and the pool drops it on release (it is no longer queryable).
  pool.on("connect", (client) => {
    client.on("error", (e) => console.warn("[defi] postgres client error", String(e).slice(0, 200)));
  });
  return pool;
}

export type Db = pg.Pool;

export async function getState(db: Db, key: string): Promise<string | null> {
  const r = await db.query<{ value: string }>(
    `SELECT value FROM defi.worker_state WHERE key = $1`,
    [key]
  );
  return r.rows[0]?.value ?? null;
}

export async function setState(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO defi.worker_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}
