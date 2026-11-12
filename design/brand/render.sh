#!/usr/bin/env bash
# Render one sheet to PNG with the snap chromium (it can only see ~/snap/chromium/common).
# design/brand/render.sh <sheet.html> <out.png> <width> <height> [query]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
stage=/root/snap/chromium/common/brand
mkdir -p "$stage/token-logos" "$here/png"
cp "$here"/sheets/*.html "$here"/sheets/*.js "$stage/"
for id in 03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04 e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297 0fdb7ff8b37479b6eb7aab38d45af2cfeefabbefdc7eebc0348d25dd65bc2c91 f0d5bdf474fcbd4249608e6dc6e9cf34a327b218f66445ea545b4c711b4676e3 fcfca7654fb0da57ecf9a3f489bcbeb1d43b56dce7e73b352f7bc6f2561d2a1b; do
  [ -f "$stage/token-logos/$id.png" ] || cp "$here/../../apps/web/public/token-logos/$id.png" "$stage/token-logos/"
done
sheet="$1"; png="$2"; w="$3"; h="$4"; q="${5:-}"; dpr="${6:-1}"
timeout 90 /usr/bin/chromium-browser --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor="$dpr" --window-size="$w,$h" --virtual-time-budget=10000 \
  --screenshot="$stage/$png" "file://$stage/$sheet${q:+?$q}" >/dev/null 2>&1
cp "$stage/$png" "$here/png/$png"
echo "$here/png/$png"
