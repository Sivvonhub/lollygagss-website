
// api/hit.js — Vercel serverless function (ES Module)
// Back-compat alias for the arrival beacon, now served at /api/a. Kept
// because Vercel edge-cached HTML can keep serving old inline scripts that
// still point at /api/hit for a while after deploy (one cached page was
// observed with an Age header of 19370 seconds).
//
// TODO: remove this alias once the cached HTML has fully rolled over —
// safe to delete 7 days after the /api/a rename ships (deployed 2026-08-01,
// so on/after 2026-08-08).

export { default } from './_hit-handler.js';
