import type { Db } from "./db.js";

/**
 * Milestone 1 tables. Keep existing defi.trades / pool_snap / ranks_cache / price_tick.
 * Additive: defi.pool_tick (per-pool TVL/vol, hourly, 14d). Do NOT DROP schema defi.
 */
export async function ensureProjectorSchema(db: Db): Promise<void> {
  await db.query(`CREATE SCHEMA IF NOT EXISTS defi`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS defi.pool_registry (
      pool_id TEXT PRIMARY KEY,
      venue TEXT NOT NULL DEFAULT 'spectrum_cfmm',
      quote_token TEXT NOT NULL,
      base_token TEXT,
      symbol TEXT,
      decimals INT,
      updated_height INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (pool_id <> quote_token),
      CHECK (length(pool_id) = 64),
      CHECK (length(quote_token) = 64)
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_pool_registry_quote ON defi.pool_registry (quote_token)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_pool_registry_venue ON defi.pool_registry (venue)`
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS defi.swaps (
      id BIGSERIAL PRIMARY KEY,
      tx_id TEXT NOT NULL,
      height INT,
      ts_ms BIGINT,
      venue TEXT NOT NULL DEFAULT 'spectrum_cfmm',
      pool_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      base_id TEXT NOT NULL,
      side TEXT NOT NULL,
      token_amount NUMERIC NOT NULL,
      base_amount NUMERIC NOT NULL,
      price NUMERIC,
      trader TEXT,
      event_kind TEXT NOT NULL DEFAULT 'swap',
      status TEXT NOT NULL DEFAULT 'confirmed',
      UNIQUE (tx_id, pool_id, event_kind)
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_swaps_ts ON defi.swaps (ts_ms DESC)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_swaps_token_ts ON defi.swaps (token_id, ts_ms DESC)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_swaps_venue_ts ON defi.swaps (venue, ts_ms DESC)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_swaps_pool_height ON defi.swaps (pool_id, height DESC NULLS LAST, ts_ms DESC)`
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS defi.pool_tick (
      pool_id TEXT NOT NULL,
      ts_ms BIGINT NOT NULL,
      tvl_erg DOUBLE PRECISION,
      volume_erg_24h DOUBLE PRECISION,
      price_erg DOUBLE PRECISION,
      PRIMARY KEY (pool_id, ts_ms)
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_pool_tick_ts ON defi.pool_tick (ts_ms DESC)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS defi_pool_tick_pool_ts ON defi.pool_tick (pool_id, ts_ms DESC)`
  );

  // Current pool totals for /defi/pool. Not a time series. Ranks upsert does not touch these.
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS trades_n BIGINT`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS vol_erg DOUBLE PRECISION`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS first_ts_ms BIGINT`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS last_ts_ms BIGINT`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS price_print_erg DOUBLE PRECISION`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS vol_erg_30d DOUBLE PRECISION`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS traders_n BIGINT`);
  await db.query(`ALTER TABLE defi.pool_snap ADD COLUMN IF NOT EXISTS fee_rate DOUBLE PRECISION`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS defi.pool_scanned (
      pool_id TEXT PRIMARY KEY,
      height INT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS defi.price_day (
      token_id TEXT NOT NULL,
      day DATE NOT NULL,
      price_erg DOUBLE PRECISION,
      price_usd DOUBLE PRECISION,
      tvl_erg DOUBLE PRECISION,
      PRIMARY KEY (token_id, day)
    )
  `);
}
