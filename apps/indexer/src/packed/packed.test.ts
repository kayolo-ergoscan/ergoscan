import assert from "node:assert/strict";
import { test } from "node:test";
import { packedCopyCeiling, packedCopyEnabled, packedTablespace, packedWriteEnabled } from "./flags.js";
import { packedSchemaSql, packedSecondaryIndexSql } from "./schema.js";

test("packed write and copy stay off without flags", () => {
  const prevW = process.env.PACKED_WRITE;
  const prevC = process.env.PACKED_COPY;
  const prevT = process.env.PACKED_TABLESPACE;
  delete process.env.PACKED_WRITE;
  delete process.env.PACKED_COPY;
  delete process.env.PACKED_TABLESPACE;
  try {
    assert.equal(packedWriteEnabled(), false);
    assert.equal(packedCopyEnabled(), false);
    assert.equal(packedTablespace(), null);
  } finally {
    if (prevW == null) delete process.env.PACKED_WRITE;
    else process.env.PACKED_WRITE = prevW;
    if (prevC == null) delete process.env.PACKED_COPY;
    else process.env.PACKED_COPY = prevC;
    if (prevT == null) delete process.env.PACKED_TABLESPACE;
    else process.env.PACKED_TABLESPACE = prevT;
  }
});

test("packed copy flag requires the write flag too", () => {
  const prevW = process.env.PACKED_WRITE;
  const prevC = process.env.PACKED_COPY;
  process.env.PACKED_COPY = "1";
  delete process.env.PACKED_WRITE;
  try {
    assert.equal(packedCopyEnabled(), false);
    process.env.PACKED_WRITE = "1";
    assert.equal(packedCopyEnabled(), true);
  } finally {
    if (prevW == null) delete process.env.PACKED_WRITE;
    else process.env.PACKED_WRITE = prevW;
    if (prevC == null) delete process.env.PACKED_COPY;
    else process.env.PACKED_COPY = prevC;
  }
});

test("tablespace name is a plain identifier", () => {
  const prev = process.env.PACKED_TABLESPACE;
  process.env.PACKED_TABLESPACE = "pack_vol";
  try {
    assert.equal(packedTablespace(), "pack_vol");
    process.env.PACKED_TABLESPACE = "pack-vol";
    assert.throws(() => packedTablespace());
  } finally {
    if (prev == null) delete process.env.PACKED_TABLESPACE;
    else process.env.PACKED_TABLESPACE = prev;
  }
});

test("schema decodes lower hex and does not scan boxes by address", () => {
  delete process.env.PACKED_TABLESPACE;
  const sql = packedSchemaSql();
  assert.match(sql, /decode\(lower\(t\), 'hex'\)/);
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS packed/);
  assert.doesNotMatch(sql, /COUNT\(DISTINCT ergo_tree\)/i);
  assert.match(sql, /from_addrs text\[\]/);
  assert.doesNotMatch(sql, /packed_tx_height_idx/);
  assert.doesNotMatch(sql, /packed_boxes_spent_height_idx/);
});

test("secondary indexes are built after the heap and not on the copy path", () => {
  delete process.env.PACKED_TABLESPACE;
  const sql = packedSecondaryIndexSql();
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS packed_tx_height_idx/);
  assert.match(sql, /packed_boxes_creation_tx_idx/);
  // Dropped 12 Nov 2026 (4.8 GB, 14 scans ever): the rebuild must not bring it back.
  assert.doesNotMatch(sql, /packed_token_tx_seen_height_idx/);
  assert.match(sql, /packed_token_tx_seen_tx_idx ON packed\.token_tx_seen \(tx_id\)/);
  assert.match(sql, /packed_token_tx_move_tx_idx ON packed\.token_tx_move \(tx_id\)/);
});

test("copy ceiling stays a full unwind window behind the tip", () => {
  assert.equal(packedCopyCeiling(1_880_623), 1_880_591);
  assert.equal(packedCopyCeiling(32), 0);
  assert.equal(packedCopyCeiling(10), 0);
});
