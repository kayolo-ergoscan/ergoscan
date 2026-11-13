/**
 * The Lithos client's latest release, from GitHub Releases (Lithos-Protocol/Lithos-Client).
 * An external source: fetched in the background, kept in RAM for 6 h, nothing stored. A request
 * never waits for GitHub; until the first answer, and after repeated failures, there is no
 * version and the page leaves it out.
 */

export type LithosClientRelease = {
  version: string;
  publishedAt: string | null;
  url: string;
};

const RELEASE_API = "https://api.github.com/repos/Lithos-Protocol/Lithos-Client/releases/latest";
const RELEASE_PAGE_PREFIX = "https://github.com/Lithos-Protocol/";
const UA = "ErgoScan/1.0 (+https://ergoscan.me; Ergo explorer)";

export const LITHOS_CLIENT_TTL_MS = 6 * 3_600_000;
/** After a failure, try again sooner than the TTL. */
export const LITHOS_CLIENT_RETRY_MS = 30 * 60_000;
/** A good answer is shown for at most this long without a fresh one. */
export const LITHOS_CLIENT_KEEP_MS = 24 * 3_600_000;

/** GitHub `releases/latest` body → release, or null when it is not a plain published version. */
export function parseLithosRelease(body: unknown): LithosClientRelease | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === "string" ? r.tag_name.trim() : "";
  const m = tag.match(/^v?(\d{1,4}(?:\.\d{1,4}){1,3})$/);
  if (!m) return null;
  const url = typeof r.html_url === "string" ? r.html_url.trim() : "";
  if (!url.startsWith(RELEASE_PAGE_PREFIX) || url.length > 300) return null;
  const at = typeof r.published_at === "string" ? r.published_at.trim() : "";
  const publishedAt = at && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : null;
  return { version: m[1]!, publishedAt, url };
}

type State = { value: LithosClientRelease | null; okAt: number; triedAt: number; busy: boolean };

/** RAM cache around a fetcher. `get()` returns at once and refreshes in the background when due. */
export function lithosClientCache(
  fetchBody: () => Promise<unknown>,
  now: () => number = Date.now
) {
  const st: State = { value: null, okAt: 0, triedAt: 0, busy: false };
  const refresh = async () => {
    st.busy = true;
    st.triedAt = now();
    try {
      const parsed = parseLithosRelease(await fetchBody());
      if (parsed) {
        st.value = parsed;
        st.okAt = now();
      }
    } catch {
      /* keep the last good answer until it is too old */
    } finally {
      st.busy = false;
    }
  };
  return {
    get(): LithosClientRelease | null {
      const t = now();
      const fresh = st.okAt > 0 && t - st.okAt < LITHOS_CLIENT_TTL_MS;
      const retryDue = t - st.triedAt >= (st.okAt >= st.triedAt ? LITHOS_CLIENT_TTL_MS : LITHOS_CLIENT_RETRY_MS);
      if (!fresh && !st.busy && (st.triedAt === 0 || retryDue)) void refresh();
      if (!st.value || t - st.okAt > LITHOS_CLIENT_KEEP_MS) return null;
      return st.value;
    },
    /** Resolves when an in-flight refresh ends (tests). */
    async settle(): Promise<void> {
      while (st.busy) await new Promise((r) => setTimeout(r, 1));
    },
  };
}

async function fetchRelease(): Promise<unknown> {
  const res = await fetch(RELEASE_API, {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/vnd.github+json", "user-agent": UA },
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return res.json();
}

const cache = lithosClientCache(fetchRelease);

/** The cached release, or null. Never waits on the network. */
export function lithosClientRelease(): LithosClientRelease | null {
  return cache.get();
}
