import pg from "pg";

const { Pool } = pg;

export function createPool(databaseUrl?: string) {
  const url =
    databaseUrl ||
    process.env.DATABASE_URL ||
    "postgres://ergoscan:changeme@127.0.0.1:5432/ergoscan";
  const pool = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
  });
  // An idle client dies when Postgres restarts. Without a listener that 'error' event is
  // unhandled and kills the process (12 Nov 2026: every writer crashed on a PG recreate).
  // The pool drops the dead client; the next query opens a new one.
  pool.on("error", (e) => console.warn("[indexer] postgres idle client error", String(e).slice(0, 200)));
  // A checked-out client (held across queries) gets the same error as its own 'error' event.
  // Log it; its next query fails, and the pool drops it on release (it is no longer queryable).
  pool.on("connect", (client) => {
    client.on("error", (e) => console.warn("[indexer] postgres client error", String(e).slice(0, 200)));
  });
  return pool;
}

export type Db = pg.Pool;

/**
 * `SET LOCAL` outside BEGIN is dropped with a warning, so autocommit work caps the session.
 * Pair with `releaseCapped`, or the cap rides the pool into the next caller (tip included).
 */
export async function capStatements(client: pg.PoolClient, ms: number): Promise<void> {
  await client.query(`SET statement_timeout = ${Math.trunc(ms)}`);
}

/** Clears the cap before the client goes back. A client that cannot RESET is dropped. */
export async function releaseCapped(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("RESET statement_timeout");
  } catch (e) {
    client.release(e instanceof Error ? e : new Error(String(e)));
    return;
  }
  client.release();
}
