import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` wipes its distDir first. A deploy builds into NEXT_DIST_DIR (e.g. .next-build)
  // while the live server keeps .next, then swaps the folders; `next start` reads .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@ergoscan/shared", "@lumen/amm-chart", "echarts", "zrender"],
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    const gateway =
      process.env.NEXT_PUBLIC_GATEWAY_URL?.replace(/\/$/, "") || "http://127.0.0.1:4400";
    return [{ source: "/v1/:path*", destination: `${gateway}/v1/:path*` }];
  },
  async redirects() {
    return [
      { source: "/richlist", destination: "/addresses", permanent: true },
      { source: "/operators/oracles", destination: "/oracles", permanent: false },
      // Nautilus opens /transactions/:id and /addresses/:id. Our pages are /tx and /address.
      { source: "/transactions/:id", destination: "/tx/:id", permanent: true },
      { source: "/addresses/:id", destination: "/address/:id", permanent: true },
    ];
  },
};

export default nextConfig;
