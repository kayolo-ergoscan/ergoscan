-- 2026-11-12 · defi_price_tick_token_ts (token_id, ts_ms DESC) repeated the primary key
-- (token_id, ts_ms): every reader filters one token_id, and the key read backward gives the same
-- plan (checked with EXPLAIN ANALYZE: price tape lateral 0.7 ms, chart 65 ms, priced tick via 006).
-- 557 MB and one more index write per tick.
DROP INDEX CONCURRENTLY IF EXISTS defi.defi_price_tick_token_ts;
