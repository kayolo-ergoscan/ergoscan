import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ipfsPathFromHref,
  ipfsUrlFallbacks,
  isSafeIpfsPath,
  preferIpfsUrl,
  publicArtworkUrl,
  previewArtworkUrl,
} from "./ipfs-url.js";

test("ipfsPathFromHref: proto, gateway, subdomain, bare CID + file", () => {
  assert.equal(ipfsPathFromHref("ipfs://bafyabc/x.png"), "bafyabc/x.png");
  assert.equal(
    ipfsPathFromHref("https://ipfs.io/ipfs/bafkreiaee65mzdc7sxvllgseuegvjswwa5ftc663uct77qcq5znpkaqmzu"),
    "bafkreiaee65mzdc7sxvllgseuegvjswwa5ftc663uct77qcq5znpkaqmzu"
  );
  assert.equal(
    ipfsPathFromHref(
      "https://ipfs.io/ipfs/QmXEfc1jSxyGNFRiYFCefFp8TnxNHdzA3QZBPMNSWuC1uL/330_Chase-the-IRS-hitman1.png"
    ),
    "QmXEfc1jSxyGNFRiYFCefFp8TnxNHdzA3QZBPMNSWuC1uL/330_Chase-the-IRS-hitman1.png"
  );
  assert.equal(
    ipfsPathFromHref("https://bafyabc.ipfs.nftstorage.link/cover.png"),
    "bafyabc/cover.png"
  );
  assert.equal(ipfsPathFromHref("https://i.ibb.co/x.png"), null);
  assert.equal(ipfsPathFromHref("https://arweave.net/abc"), null);
  assert.equal(ipfsPathFromHref("javascript:alert(1)"), null);
});

test("isSafeIpfsPath rejects traversal", () => {
  assert.equal(
    isSafeIpfsPath("bafkreiaee65mzdc7sxvllgseuegvjswwa5ftc663uct77qcq5znpkaqmzu"),
    true
  );
  assert.equal(
    isSafeIpfsPath("QmXEfc1jSxyGNFRiYFCefFp8TnxNHdzA3QZBPMNSWuC1uL/file.png"),
    true
  );
  assert.equal(isSafeIpfsPath("bafyabc/../etc/passwd"), false);
  assert.equal(isSafeIpfsPath("not-a-cid"), false);
});

test("preferIpfsUrl rewrites ipfs.io, keeps blockfrost and http", () => {
  assert.equal(
    preferIpfsUrl("https://ipfs.io/ipfs/bafyabc"),
    "https://nftstorage.link/ipfs/bafyabc"
  );
  assert.equal(
    preferIpfsUrl("ipfs://bafyabc"),
    "https://nftstorage.link/ipfs/bafyabc"
  );
  assert.equal(
    preferIpfsUrl("https://ipfs.blockfrost.dev/ipfs/QmSEW2kuXKsGKorv39n7pXMTZM2noSS5Dqv6BDbaeET5WL"),
    "https://ipfs.blockfrost.dev/ipfs/QmSEW2kuXKsGKorv39n7pXMTZM2noSS5Dqv6BDbaeET5WL"
  );
  assert.equal(preferIpfsUrl("https://arweave.net/U6"), null);
  assert.equal(preferIpfsUrl('{"image":"ipfs://Qmabc"}'), null);
  assert.equal(publicArtworkUrl("https://arweave.net/U6"), "https://arweave.net/U6");
  const falls = ipfsUrlFallbacks("https://ipfs.io/ipfs/bafyabc");
  assert.equal(falls[0], "https://nftstorage.link/ipfs/bafyabc");
  assert.ok(falls.includes("https://ipfs.io/ipfs/bafyabc"));
  assert.ok(falls.includes("https://ipfs.blockfrost.dev/ipfs/bafyabc"));
});

test("a ready preview replaces the public gate", () => {
  const url = "https://nftstorage.link/ipfs/bafyabc";
  assert.equal(
    previewArtworkUrl(url, new Set(["bafyabc"])),
    "https://ergoscan.me/nft/bafyabc.webp"
  );
  assert.equal(previewArtworkUrl(url, new Set()), "https://nftstorage.link/ipfs/bafyabc");
  assert.equal(previewArtworkUrl("data:image/png;base64,aaa", new Set()), "data:image/png;base64,aaa");
});
