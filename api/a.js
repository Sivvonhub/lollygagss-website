
// api/a.js — Vercel serverless function (ES Module)
// Server-side arrival beacon endpoint. See _hit-handler.js for the
// implementation; this file just wires it up as the current beacon path.
// (Previously /api/hit — renamed because that path matches common tracker
// blocklist patterns. See api/hit.js for the back-compat alias.)

export { default } from './_hit-handler.js';
