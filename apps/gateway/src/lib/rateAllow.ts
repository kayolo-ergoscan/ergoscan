import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Partner allowlist for the per-IP read limit (12 Nov 2026: our DEX got 4 108 × 429 on
 * 9–10 Nov). `RATE_LIMIT_PARTNERS` is a comma list of IPv4/IPv6 addresses or CIDR subnets,
 * e.g. "49.13.147.118,2a01:4f8:1c18:27ae::/64". Partners get their own, larger budget, not
 * an unlimited one. The client IP comes from Caddy's X-Forwarded-For, which Caddy replaces
 * (no trusted_proxies), so a client cannot claim a partner address.
 */
export function parsePartnerList(spec: string | undefined): BlockList | null {
  const parts = (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const list = new BlockList();
  for (const p of parts) {
    const [addr, bitsRaw] = p.split("/");
    const family = isIPv4(addr) ? "ipv4" : isIPv6(addr) ? "ipv6" : null;
    if (!family) throw new Error(`RATE_LIMIT_PARTNERS: not an IP address: ${p}`);
    if (bitsRaw === undefined) {
      list.addAddress(addr, family);
    } else {
      const bits = Number(bitsRaw);
      const max = family === "ipv4" ? 32 : 128;
      if (!Number.isInteger(bits) || bits < 0 || bits > max) {
        throw new Error(`RATE_LIMIT_PARTNERS: bad prefix length: ${p}`);
      }
      list.addSubnet(addr, bits, family);
    }
  }
  return list;
}

export function isPartnerIp(list: BlockList | null, ip: string): boolean {
  if (!list || !ip) return false;
  const v4 = ip.startsWith("::ffff:") && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (isIPv4(v4)) return list.check(v4, "ipv4");
  if (isIPv6(v4)) return list.check(v4, "ipv6");
  return false;
}
