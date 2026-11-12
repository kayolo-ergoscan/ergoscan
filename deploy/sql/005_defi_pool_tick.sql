-- Per-pool TVL / 24h vol ticks (Spectrum + Lithos). Projector also CREATE IF NOT EXISTS.
-- 14d retention, same cadence as defi.price_tick (ranks cycle).
CREATE TABLE IF NOT EXISTS defi.pool_tick (
  pool_id TEXT NOT NULL,
  ts_ms BIGINT NOT NULL,
  tvl_erg DOUBLE PRECISION,
  volume_erg_24h DOUBLE PRECISION,
  price_erg DOUBLE PRECISION,
  PRIMARY KEY (pool_id, ts_ms)
);
CREATE INDEX IF NOT EXISTS defi_pool_tick_ts ON defi.pool_tick (ts_ms DESC);
-- (pool_id, ts_ms DESC) was a copy of the primary key; dropped in 008.
