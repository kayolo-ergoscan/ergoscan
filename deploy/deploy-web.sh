#!/usr/bin/env bash
# Deploy the site without a broken window.
#
# `next build` wipes its distDir first, so building into the live .next breaks pages for the
# whole build. This builds into .next-build (next.config.ts reads NEXT_DIST_DIR), checks it,
# then swaps folders and restarts ergoscan-web (a few seconds). The previous build stays as
# .next.prev-<UTC time>; the two newest are kept.
#
# Rollback by hand: systemctl stop ergoscan-web; mv .next .next.bad; mv .next.prev-<t> .next;
#                   systemctl start ergoscan-web
#
# Before a deploy that should carry new contract names: npm run names:snapshot -w @ergoscan/web
# (writes src/lib/address-book/registry.json, commit it).
set -euo pipefail

cd "$(dirname "$0")/../apps/web"
B=.next-build
LIVE=http://127.0.0.1:4410

rm -rf "$B" "$B.failed"

# Next rewrites both files for a non-default distDir; put them back after the build.
keep=$(mktemp -d)
cp tsconfig.json next-env.d.ts "$keep/"
restore() { cp "$keep/tsconfig.json" "$keep/next-env.d.ts" . && rm -rf "$keep"; }
trap restore EXIT

# The box has ~4 GB free and no swap: cap the build so it can never push the node or the
# oracles into the OOM killer. A build that hits the cap dies; the live site is untouched.
NEXT_DIST_DIR=$B NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=3072 \
  systemd-run --scope -q -p MemoryMax=3600M -p MemorySwapMax=0 npx next build

# Every prerendered page must point at CSS that exists (HOW.md, 2 Oct 2026: stale webpack
# cache gave /names and /favorites a 404 stylesheet).
missing=0
while IFS= read -r f; do
  for c in $(grep -oE '/_next/static/css/[A-Za-z0-9_.-]+\.css' "$f" | sort -u); do
    if [ ! -f "$B/static/css/${c##*/}" ]; then
      echo "missing $c in $f"
      missing=1
    fi
  done
done < <(find "$B/server/app" -name '*.html')
if [ "$missing" != 0 ]; then
  echo "CSS check failed; live site untouched ($B kept for a look)"
  exit 1
fi

prev=".next.prev-$(date -u +%Y%m%d-%H%M%S)"
systemctl stop ergoscan-web
mv .next "$prev"
mv "$B" .next
systemctl start ergoscan-web

ok=0
for _ in $(seq 1 30); do
  if curl -sf -m 3 -o /dev/null "$LIVE/" && curl -sf -m 3 -o /dev/null "$LIVE/about"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "new build does not answer; rolling back to $prev"
  systemctl stop ergoscan-web
  mv .next "$B.failed"
  mv "$prev" .next
  systemctl start ergoscan-web
  exit 1
fi

ls -1d .next.prev-* 2>/dev/null | sort | head -n -2 | xargs -r rm -rf
echo "live build $(cat .next/BUILD_ID); previous in apps/web/$prev"
