-- 2026-11-12 · defi_pool_tick_pool_ts (pool_id, ts_ms DESC) repeated the primary key
-- (pool_id, ts_ms). The one reader (gateway pool-history) filters one pool and reads ts_ms up:
-- the primary key. 15 scans in the index's life, 51 MB.
DROP INDEX CONCURRENTLY IF EXISTS defi.defi_pool_tick_pool_ts;
