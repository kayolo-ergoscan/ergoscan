import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artFromIssuanceRegs,
  kindFromIssuanceRegs,
  nameFromIssuanceRegs,
  pickArtUrl,
} from "./tokenNamesFromRegs.js";

test("nameFromIssuanceRegs: text R4, skip urls", () => {
  // 0e = Coll[Byte], 04 = len 4, "Wolf"
  const wolf = { R4: "0e04576f6c66" };
  assert.equal(nameFromIssuanceRegs(wolf), "Wolf");
  assert.equal(
    nameFromIssuanceRegs({ R4: { serializedValue: "0e04576f6c66" } }),
    "Wolf"
  );
  assert.equal(nameFromIssuanceRegs({ R4: "0e0b68747470733a2f2f782e70" }), null);
  assert.equal(
    nameFromIssuanceRegs({
      R4: "644ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e16",
    }),
    null
  );
});

test("artFromIssuanceRegs: http, ipfs, on-chain data URI", () => {
  // 0e + len + utf8
  const http = Buffer.from("https://i.ibb.co/x.png", "utf8");
  const httpHex = `0e${http.length.toString(16).padStart(2, "0")}${http.toString("hex")}`;
  assert.equal(artFromIssuanceRegs({ R9: httpHex }), "https://i.ibb.co/x.png");

  const ipfs = Buffer.from("ipfs://bafyabc", "utf8");
  const ipfsHex = `0e${ipfs.length.toString(16).padStart(2, "0")}${ipfs.toString("hex")}`;
  assert.equal(artFromIssuanceRegs({ R9: ipfsHex }), "https://nftstorage.link/ipfs/bafyabc");

  const data = "data:image/png;base64,aaa";
  const dataBuf = Buffer.from(data, "utf8");
  const dataHex = `0e${dataBuf.length.toString(16).padStart(2, "0")}${dataBuf.toString("hex")}`;
  assert.equal(artFromIssuanceRegs({ R9: dataHex }), data);

  assert.equal(artFromIssuanceRegs({ R4: "0e04576f6c66" }), null);
});

test("nameFromIssuanceRegs ignores empty", () => {
  assert.equal(nameFromIssuanceRegs(null), null);
  assert.equal(nameFromIssuanceRegs({}), null);
});

test("kindFromIssuanceRegs: R7 image / audio", () => {
  assert.equal(kindFromIssuanceRegs({ R7: "0e020101" }), "image");
  assert.equal(kindFromIssuanceRegs({ R7: "0e020102" }), "audio");
  assert.equal(kindFromIssuanceRegs({ R4: "0e04576f6c66" }), null);
});

test("artFromIssuanceRegs: audio pair uses cover, not the audio URL", () => {
  const r9 =
    "3c0e0e42697066733a2f2f62616679626569627061346135676476326d626a74666e6f62763375626f3764707a6d6233736a70706d326f79333561757462366574626879796942697066733a2f2f62616679626569687a667677336e6e6a777a7a7a753569616570337662697072796774693474366274797378746165626536766133757378347161";
  const art = artFromIssuanceRegs({ R7: "0e020102", R9: r9 });
  assert.ok(art && art.includes("bafybeihzfvw3nnjwzzzu5iaep3vbiprygti4t6btysxtaebe6va3usx4qa"));
  assert.ok(art && !art.includes("bafybeibpa4a5gdv2mbjtfnobv3ubo7dpzmb3sjppm2oy35autb6etbhyyi"));
});

test("pickArtUrl: mint R9 wins, empty issuer is ignored, null stays null", () => {
  const r9 =
    "3c0e0e42697066733a2f2f626166796265696661346a72786c737a7734656b6664786262767766647062766762327164696e7869636d74377a6669666176766134627964706d42697066733a2f2f6261667962656964633662773568327861366534677267766c71733733326d766165733463756c736569776f796a32626a6b3770357a3678716f65";
  const mint = { R7: "0e020101", R9: r9 };
  const issuer = { R4: "0e064d6172696f6e" };
  const url = pickArtUrl(mint, issuer);
  assert.ok(url && url.includes("bafybeifa4jrxlszw4ekfdxbbvwfdpbvgb2qdinxicmt7zfifavva4bydpm"));
  assert.equal(pickArtUrl(issuer, issuer), null);
  assert.equal(pickArtUrl(null, { R9: "0e046e756c6c" }), null);
});

test("nameFromIssuanceRegs: long EIP-4 names up to 128 chars (node keeps them)", () => {
  const hex = (s: string) => {
    const b = Buffer.from(s, "utf8");
    let n = b.length;
    const len: number[] = [];
    do {
      let c = n & 0x7f;
      n >>= 7;
      if (n) c |= 0x80;
      len.push(c);
    } while (n);
    return "0e" + Buffer.from(len).toString("hex") + b.toString("hex");
  };
  const long = "Mew Bridge Cardano NFT Registry - 446973636f536f6c6172697331353835";
  assert.equal(nameFromIssuanceRegs({ R4: hex(long) }), long);
  assert.equal(nameFromIssuanceRegs({ R4: hex("x".repeat(128)) }), "x".repeat(128));
  assert.equal(nameFromIssuanceRegs({ R4: hex("x".repeat(129)) }), null);
});
