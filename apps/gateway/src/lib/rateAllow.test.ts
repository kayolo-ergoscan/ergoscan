import assert from "node:assert/strict";
import { test } from "node:test";
import { isPartnerIp, parsePartnerList } from "./rateAllow.js";

test("partner list: IPv4 address, IPv6 /64, mapped IPv4", () => {
  const list = parsePartnerList("49.13.147.118, 2a01:4f8:1c18:27ae::/64");
  assert.equal(isPartnerIp(list, "49.13.147.118"), true);
  assert.equal(isPartnerIp(list, "::ffff:49.13.147.118"), true);
  assert.equal(isPartnerIp(list, "49.13.147.119"), false);
  assert.equal(isPartnerIp(list, "2a01:4f8:1c18:27ae::1"), true);
  assert.equal(isPartnerIp(list, "2a01:4f8:1c18:27ae:ffff::9"), true);
  assert.equal(isPartnerIp(list, "2a01:4f8:1c18:27af::1"), false);
  assert.equal(isPartnerIp(list, "unknown"), false);
});

test("partner list: empty means nobody; garbage fails loudly", () => {
  assert.equal(parsePartnerList(""), null);
  assert.equal(parsePartnerList(undefined), null);
  assert.equal(isPartnerIp(null, "49.13.147.118"), false);
  assert.throws(() => parsePartnerList("49.13.147.118,example.com"));
  assert.throws(() => parsePartnerList("10.0.0.0/33"));
});
