import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOME_RENT_TAPE,
  parseRentTape,
  pickRentTapeAddresses,
  rentRailLayout,
  rentRailX,
  RENT_YARD_BACK,
  RENT_YARD_FRONT,
  RENT_YARD_MID,
  rentTapeClock,
  rentTapeTone,
  epochTapeBoxes,
  headerEpochBlocksLeft,
  parseRentEpochBoxes,
  parseRentEpochNano,
  ERGO_HEADER_EPOCH_LEN,
} from "./rent-tape.js";

test("pick unique addresses in probe order, cap 15", () => {
  const rows = [
    { address: "a" },
    { address: "a" },
    { address: "  b  " },
    { address: null },
    { address: "" },
    { address: "c" },
    { address: "d" },
    { address: "e" },
    { address: "f" },
    { address: "g" },
    { address: "h" },
    { address: "i" },
    { address: "j" },
    { address: "k" },
    { address: "l" },
    { address: "m" },
    { address: "n" },
    { address: "o" },
    { address: "p" },
  ];
  assert.deepEqual(pickRentTapeAddresses(rows), [
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
  ]);
  assert.equal(pickRentTapeAddresses(rows).length, HOME_RENT_TAPE);
});

test("parseRentTape: missing vs empty vs rows", () => {
  assert.equal(parseRentTape(undefined), null);
  assert.equal(parseRentTape({}), null);
  assert.deepEqual(parseRentTape([]), []);
  const rows = parseRentTape([
    {
      address: "  9abc  ",
      boxCount: 4,
      oldestCreationHeight: 100,
      blocksUntilRent: 0,
      rentNano: "1",
      valueNano: "2",
    },
    { address: "", boxCount: 1, oldestCreationHeight: 1, blocksUntilRent: 0 },
    { address: "skip-bad-count", boxCount: 0, oldestCreationHeight: 1, blocksUntilRent: 0 },
  ]);
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0]?.address, "9abc");
  assert.equal(rows?.[0]?.boxCount, 4);
  const many = "abcdefghijklmnop".split("").map((address) => ({
    address,
    boxCount: 1,
    oldestCreationHeight: 1,
    blocksUntilRent: 0,
  }));
  assert.equal(parseRentTape(many)?.length, HOME_RENT_TAPE);
});

test("clock and tone", () => {
  assert.deepEqual(rentTapeClock(0), { due: true });
  assert.equal(rentTapeTone(0), "due");
  assert.deepEqual(rentTapeClock(180), { due: false, n: 6, unit: "h", label: "6h" });
  assert.equal(rentTapeTone(180), "soon");
  assert.deepEqual(rentTapeClock(1440), { due: false, n: 2, unit: "d", label: "2d" });
  assert.equal(rentTapeTone(1440), "later");
});

test("clock: minutes under an hour, hours under two days", () => {
  assert.deepEqual(rentTapeClock(1), { due: false, n: 2, unit: "m", label: "2m" });
  assert.deepEqual(rentTapeClock(4), { due: false, n: 8, unit: "m", label: "8m" });
  assert.deepEqual(rentTapeClock(29), { due: false, n: 58, unit: "m", label: "58m" });
  assert.deepEqual(rentTapeClock(30), { due: false, n: 1, unit: "h", label: "1h" });
  assert.deepEqual(rentTapeClock(1084), { due: false, n: 36, unit: "h", label: "36h" });
  assert.deepEqual(rentTapeClock(1439), { due: false, n: 48, unit: "h", label: "48h" });
  assert.deepEqual(rentTapeClock(5040), { due: false, n: 7, unit: "d", label: "7d" });
});

test("week clock: now is 0, 7d is 1", () => {
  assert.equal(rentRailX(0), 0);
  assert.equal(rentRailX(5040), 1);
  assert.equal(rentRailX(100_000), 1);
  assert.equal(rentRailX(720), 720 / 5040);
});

test("yard: three crates sit mid-row, no heap", () => {
  const layout = rentRailLayout([
    { address: "a", blocksUntilRent: 0 },
    { address: "b", blocksUntilRent: 0 },
    { address: "c", blocksUntilRent: 2520 },
  ]);
  assert.deepEqual(
    layout.map((p) => ({ address: p.address, t: p.t, y: p.y, stack: p.stack })),
    [
      { address: "a", t: 1 / 6, y: RENT_YARD_MID, stack: 0 },
      { address: "b", t: 0.5, y: RENT_YARD_MID, stack: 0 },
      { address: "c", t: 5 / 6, y: RENT_YARD_MID, stack: 0 },
    ]
  );
});

test("yard: fifteen crates fill three terraces, S-path", () => {
  const rows = "abcdefghijklmno".split("").map((address) => ({
    address,
    blocksUntilRent: 0,
  }));
  const layout = rentRailLayout(rows);
  assert.deepEqual(
    layout.map((p) => ({ address: p.address, t: p.t, y: p.y })),
    [
      { address: "a", t: 0.1, y: RENT_YARD_FRONT },
      { address: "b", t: 0.3, y: RENT_YARD_FRONT },
      { address: "c", t: 0.5, y: RENT_YARD_FRONT },
      { address: "d", t: 0.7, y: RENT_YARD_FRONT },
      { address: "e", t: 0.9, y: RENT_YARD_FRONT },
      { address: "f", t: 0.9, y: RENT_YARD_MID },
      { address: "g", t: 0.7, y: RENT_YARD_MID },
      { address: "h", t: 0.5, y: RENT_YARD_MID },
      { address: "i", t: 0.3, y: RENT_YARD_MID },
      { address: "j", t: 0.1, y: RENT_YARD_MID },
      { address: "k", t: 0.1, y: RENT_YARD_BACK },
      { address: "l", t: 0.3, y: RENT_YARD_BACK },
      { address: "m", t: 0.5, y: RENT_YARD_BACK },
      { address: "n", t: 0.7, y: RENT_YARD_BACK },
      { address: "o", t: 0.9, y: RENT_YARD_BACK },
    ]
  );
});

test("yard: five crates switchback — front LTR, back RTL", () => {
  const layout = rentRailLayout([
    { address: "a", blocksUntilRent: 0 },
    { address: "b", blocksUntilRent: 0 },
    { address: "c", blocksUntilRent: 30 },
    { address: "d", blocksUntilRent: 60 },
    { address: "e", blocksUntilRent: 90 },
  ]);
  assert.deepEqual(
    layout.map((p) => ({ address: p.address, t: p.t, y: p.y })),
    [
      { address: "a", t: 1 / 6, y: RENT_YARD_FRONT },
      { address: "b", t: 0.5, y: RENT_YARD_FRONT },
      { address: "c", t: 5 / 6, y: RENT_YARD_FRONT },
      { address: "d", t: 0.75, y: RENT_YARD_BACK },
      { address: "e", t: 0.25, y: RENT_YARD_BACK },
    ]
  );
});

test("header epoch leftover and tape boxes in that window", () => {
  assert.equal(headerEpochBlocksLeft(0), ERGO_HEADER_EPOCH_LEN);
  assert.equal(headerEpochBlocksLeft(1023), 1);
  assert.equal(
    epochTapeBoxes(
      [
        { boxCount: 3, blocksUntilRent: 0 },
        { boxCount: 2, blocksUntilRent: 200 },
        { boxCount: 9, blocksUntilRent: 2000 },
      ],
      780
    ),
    5
  );
  assert.equal(parseRentEpochBoxes({ boxCount: "12" }), 12);
  assert.equal(parseRentEpochBoxes(undefined), null);
  assert.equal(parseRentEpochNano({ rentNano: "1843200000" }), "1843200000");
  assert.equal(parseRentEpochNano("0"), "0");
  assert.equal(parseRentEpochNano({ boxCount: 12 }), null);
  assert.equal(parseRentEpochNano(undefined), null);
});
