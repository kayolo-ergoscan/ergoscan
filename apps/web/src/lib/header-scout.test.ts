import assert from "node:assert/strict";
import { test } from "node:test";
import { addressIdOf, addressReturnGate, askWaitsForSlip, isAddressHome, rentScratch, scoutBeats, tourAfterReturn } from "./header-scout";

test("address pages are his perch, the list included", () => {
  assert.equal(isAddressHome("/addresses"), true);
  assert.equal(isAddressHome("/address/9abc"), true);
  assert.equal(isAddressHome("/address"), false);
  assert.equal(isAddressHome("/blocks"), false);
});

test("desktop pass slips under the title, the price, and the market cap, then back", () => {
  assert.deepEqual(scoutBeats(true, true), [
    "fall",
    "squat-title",
    "under-title",
    "rise-title",
    "read",
    "to-price",
    "squat-price",
    "under-price",
    "rise-gap",
    "price",
    "squat-mcap",
    "under-mcap",
    "rise-mcap",
    "mcap",
    "squat-mcap-back",
    "under-mcap-back",
    "rise-gap-back",
    "peek",
    "squat-price-back",
    "under-price-back",
    "rise-price-back",
    "to-title-back",
    "squat-title-back",
    "under-title-back",
    "rise-title-back",
    "to-search",
    "seek",
  ]);
});

test("the trip home ducks before the search and clears the title", () => {
  const open = addressReturnGate({
    searchLeft: 290,
    wordLeft: 318,
    wordRight: 400,
    reservedPark: 560,
    titleLeft: 800,
  });
  assert.ok(open.approachX < 290);
  assert.ok(open.approachX < 318);
  assert.equal(open.slips, true);
  assert.ok(open.parkX > 400);
  assert.ok(open.parkX < 800);

  const tight = addressReturnGate({
    searchLeft: 290,
    wordLeft: 318,
    wordRight: 400,
    reservedPark: 560,
    titleLeft: 440,
  });
  assert.equal(tight.slips, false);
  assert.ok(tight.parkX < 440);
});

test("coming back up he runs the full pass, starting at the title", () => {
  const beats = tourAfterReturn(true, true);
  assert.equal(beats[0], "squat-title");
  assert.equal(beats.includes("fall"), false);
  assert.equal(beats.includes("read"), true);
  assert.equal(beats.includes("to-search"), true);
  assert.equal(beats[beats.length - 1], "seek");
});

test("a click under a word waits until that slip is finished", () => {
  assert.equal(askWaitsForSlip("under-title"), true);
  assert.equal(askWaitsForSlip("under-price-back"), true);
  assert.equal(askWaitsForSlip("squat-title"), false);
  assert.equal(askWaitsForSlip("to-price"), false);
  assert.equal(askWaitsForSlip("seek"), false);
});

test("an address card is the id, the catalog is not", () => {
  assert.equal(addressIdOf("/addresses"), null);
  assert.equal(addressIdOf("/address/9abc"), "9abc");
  assert.equal(addressIdOf("/blocks"), null);
});

test("the pick writes danger, the rent, then the clock", () => {
  const labels = { danger: "danger", what: "storage rent", due: "due" };
  assert.deepEqual(rentScratch(0, labels, "en"), {
    due: true,
    lines: ["danger", "storage rent", "due"],
  });
  assert.deepEqual(rentScratch(3, labels, "en").lines[2], "6m");
  assert.deepEqual(rentScratch(3, labels, "ru").lines[2], "6мин");
  assert.deepEqual(rentScratch(90, labels, "ru").lines[2], "3ч");
  assert.equal(rentScratch(3, labels, "en").due, false);
  assert.deepEqual(rentScratch(1440, labels, "ru").lines, ["danger", "storage rent", "2д"]);
});

test("phone pass only slips under the price", () => {
  assert.deepEqual(scoutBeats(false, false), [
    "fall",
    "to-price",
    "squat-price",
    "under-price",
    "rise-gap",
    "price",
    "squat-price-back",
    "under-price-back",
    "rise-price-back",
    "to-search",
    "seek",
  ]);
});
