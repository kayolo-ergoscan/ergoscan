-- 2026-08-14 · C3 AMM price history (worker ranks cycle → ticks)
CREATE TABLE IF NOT EXISTS defi.price_tick (
  token_id text NOT NULL,
  ts_ms bigint NOT NULL,
  price_erg double precision,
  price_usd double precision,
  tvl_erg double precision,
  PRIMARY KEY (token_id, ts_ms)
);
CREATE INDEX IF NOT EXISTS defi_price_tick_ts ON defi.price_tick (ts_ms DESC);
-- (token_id, ts_ms DESC) was a copy of the primary key read backward; dropped in 007.
