-- Preview files live on disk. This row is only "the webp is ready".
CREATE TABLE IF NOT EXISTS nft_preview (
  cid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  bytes INTEGER,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
