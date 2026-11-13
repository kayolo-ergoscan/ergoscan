import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaUrlFallbacks, safeArtUrl, safeMediaUrl } from "./nft-art";

test("safeArtUrl: http, ipfs, data image; reject other schemes", () => {
  assert.equal(safeArtUrl("https://i.ibb.co/x.png"), "https://i.ibb.co/x.png");
  assert.equal(safeArtUrl("ipfs://bafyabc"), "https://nftstorage.link/ipfs/bafyabc");
  assert.equal(
    safeArtUrl("https://ipfs.io/ipfs/bafyabc"),
    "https://nftstorage.link/ipfs/bafyabc"
  );
  assert.equal(safeArtUrl("data:image/png;base64,aaa"), "data:image/png;base64,aaa");
  assert.equal(safeArtUrl("javascript:alert(1)"), null);
  assert.equal(safeArtUrl("data:text/html,x"), null);
  assert.equal(safeArtUrl("  "), null);
});

test("safeMediaUrl: audio/video data and http; still reject javascript", () => {
  assert.equal(safeMediaUrl("https://x.test/a.mp3", "audio"), "https://x.test/a.mp3");
  assert.equal(safeMediaUrl("data:audio/mpeg;base64,aaa", "audio"), "data:audio/mpeg;base64,aaa");
  assert.equal(safeMediaUrl("data:video/mp4;base64,aaa", "video"), "data:video/mp4;base64,aaa");
  assert.equal(safeMediaUrl("data:audio/mpeg;base64,aaa", "image"), null);
  assert.equal(safeMediaUrl("javascript:alert(1)", "any"), null);
});

test("mediaUrlFallbacks: keep each IPFS gate, ipfs.io last", () => {
  const urls = mediaUrlFallbacks("https://ipfs.io/ipfs/bafyabc", "image");
  assert.equal(urls[0], "https://nftstorage.link/ipfs/bafyabc");
  assert.ok(urls.includes("https://ipfs.blockfrost.dev/ipfs/bafyabc"));
  assert.ok(urls.includes("https://ipfs.io/ipfs/bafyabc"));
  assert.ok(urls.indexOf("https://nftstorage.link/ipfs/bafyabc") < urls.indexOf("https://ipfs.io/ipfs/bafyabc"));
});

test("the ErgoDex logo ErgoScan substitutes loads from the site itself", () => {
  const api = "https://ergoscan.me/ergodex-lp-640.webp";
  assert.deepEqual(mediaUrlFallbacks(api, "image"), ["/ergodex-lp-640.webp"]);
  assert.equal(safeArtUrl(api), "/ergodex-lp-640.webp");
  assert.equal(safeMediaUrl(api, "audio"), null);
  assert.deepEqual(mediaUrlFallbacks(api, "video"), []);
});
