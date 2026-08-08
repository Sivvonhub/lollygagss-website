
// api/_hit-shared.js — shared by api/_hit-handler.js (write, used by both
// api/a.js and its api/hit.js alias) and api/hit-report.js (read). Vercel
// excludes any path segment starting with "_" from routing, so this file is
// not itself an endpoint.
//
// Keeping the path/ect bucket universe in one place is what keeps the
// write-side allow-list and the read-side report from drifting apart: the
// report can only enumerate what the write path was ever allowed to create.

export const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// Derived by walking the repo for **/*.html (excluding node_modules) and
// applying Vercel's cleanUrls convention (vercel.json: "cleanUrls": true):
//   index.html        -> /
//   <dir>/index.html  -> /<dir>
//   <name>.html        -> /<name>
//   <dir>/<name>.html  -> /<dir>/<name>
// Regenerate this list the same way if pages are added, removed, or renamed.
const HTML_PAGE_PATHS = [
  '/',
  '/id',
  '/id/biab-manicure-kerobokan',
  '/id/journal',
  '/id/lash-extensions-kerobokan',
  '/id/services',
  '/journal',
  '/journal/biab-bali',
  '/journal/biab-nails-kerobokan',
  '/journal/gel-biab-extensions-bali',
  '/journal/lash-classic-volume-style-bali',
  '/journal/lash-extensions-bali-humidity',
  '/journal/lash-extensions-kerobokan',
  '/biab-manicure-kerobokan',
  '/lash-extensions-kerobokan',
  '/nail-salon-kerobokan',
  '/id/salon-kuku-kerobokan',
  '/links',
  '/services',
];

// Derived from vercel.json's `rewrites[].source` values. These are URLs
// visitors actually land on (e.g. /gallery renders the homepage content via
// a rewrite) — GA4 records `location.pathname` as the visitor saw it, not
// the rewrite destination, so the beacon must bucket them as their own
// distinct paths rather than canonicalising to the destination.
// Regenerate by reading vercel.json's rewrites array and taking .source.
const VERCEL_REWRITE_SOURCE_PATHS = [
  '/gallery',
  '/about',
  '/contact',
  '/home',
  '/id/gallery',
  '/id/about',
  '/id/contact',
  '/id/home',
];

export const ALLOWED_PATHS = new Set([...HTML_PAGE_PATHS, ...VERCEL_REWRITE_SOURCE_PATHS]);

export const OTHER_PATH_BUCKET = '/other';

// location.pathname shouldn't carry a query string or hash, and shouldn't
// vary in case or trailing slash — but an unauthenticated caller can send
// anything as `p`, so normalize before matching. This is what makes
// /Services, /services/, and /services?x=1#y all land in the same bucket.
export function normalizePath(rawPath) {
  let p = String(rawPath || '');
  p = p.split('?')[0].split('#')[0];
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

// Any p not in the allow-list (after normalization) collapses to a single
// bucket, bounding daily key creation regardless of what a client sends.
export function bucketPath(rawPath) {
  const normalized = normalizePath(rawPath);
  return ALLOWED_PATHS.has(normalized) ? normalized : OTHER_PATH_BUCKET;
}

// navigator.connection.effectiveType is spec'd to be one of these four
// values. A missing/empty ect means the client didn't report one at all
// (no key should be written); any other non-empty value is a spoofed or
// future value and collapses to 'other'.
export const ALLOWED_ECT = ['slow-2g', '2g', '3g', '4g'];
export const OTHER_ECT_BUCKET = 'other';
const ALLOWED_ECT_SET = new Set(ALLOWED_ECT);

export function bucketEct(rawEct) {
  if (!rawEct) return null;
  return ALLOWED_ECT_SET.has(rawEct) ? rawEct : OTHER_ECT_BUCKET;
}

export const ALL_ECT_BUCKETS = [...ALLOWED_ECT, OTHER_ECT_BUCKET];

// Asia/Makassar (WITA) is a fixed UTC+8 offset with no daylight saving, so
// the calendar date can be computed by shifting the instant and reading the
// UTC date fields — no Intl/timezone-database lookup needed. Must be called
// per request with a freshly-constructed Date; never memoize the result at
// module scope, since a warm Lambda would keep returning a stale day.
export function makassarDateKey(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// Key prefix for Asia/Makassar-bucketed counters. Distinct from the old
// UTC-bucketed "hit:" prefix so the two never mix — the old keys hold ~2
// days of UTC-bucketed test data and are left to expire via their existing
// TTL rather than migrated.
export const KEY_PREFIX = 'hitm';

export function indexKey(date) {
  return `${KEY_PREFIX}:index:${date}`;
}
