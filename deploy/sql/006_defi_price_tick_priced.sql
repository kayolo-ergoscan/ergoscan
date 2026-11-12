-- 2026-11-12 · Latest priced tick per token (indexer snapshots.ts pricedTokenUsd, rent danger).
-- Without it the per-token LATERAL walked every tick of tokens whose pools never reach 50 ERG
-- (112 of 186 tokens): 1.4 s warm, ~14 s mean under load. With it: 14 ms.
-- Keep the predicate equal to the query (price_usd > 0 AND tvl_erg >= DANGER_MIN_POOL_TVL_ERG).
CREATE INDEX CONCURRENTLY IF NOT EXISTS defi_price_tick_priced_token_ts
  ON defi.price_tick (token_id, ts_ms DESC)
  WHERE price_usd > 0 AND tvl_erg >= 50;
