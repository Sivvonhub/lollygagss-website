
// api/_hit-handler.js — Vercel serverless function core (ES Module)
// Server-side arrival beacon: fires via navigator.sendBeacon() as the first
// thing in <head>, independent of whether gtag.js ever loads or fires.
//
// Shared by api/a.js (the current path) and api/hit.js (a temporary alias
// kept for edge-cached HTML still pointing at the old path — see the TODO
// in hit.js).
//
// NOTE (Node runtime deprecation): this function may log a DEP0169 warning
// (`url.parse()` is deprecated) in Vercel's runtime output. That warning
// originates in Vercel's own Node.js request-handling layer, which populates
// `req.query` before our handler runs — not in this file. There is nothing
// here to refactor to make it go away.

import { Redis } from '@upstash/redis';
import {
  TTL_SECONDS,
  KEY_PREFIX,
  bucketPath,
  bucketEct,
  makassarDateKey,
  indexKey,
} from './_hit-shared.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

if (!KV_URL || !KV_TOKEN) {
  console.error(
    'hit: FATAL — KV_REST_API_URL / KV_REST_API_TOKEN are not set. ' +
    'Hit counters will NOT persist to Redis until the Upstash Redis ' +
    'integration is provisioned via the Vercel Marketplace and connected ' +
    'to this project.'
  );
}

const redis = (KV_URL && KV_TOKEN) ? new Redis({ url: KV_URL, token: KV_TOKEN }) : null;

// Bot/automation UA substrings. Matches flag the hit as `bot` rather than
// dropping it, so `bot` can be reported and subtracted from `human`. A
// missing/empty UA is also treated as a bot — no real browser omits it.
const BOT_UA_RE = /bot|crawl|spider|slurp|curl|wget|python-requests|httpx|axios|node-fetch|headless|lighthouse|pagespeed|preview|monitor|uptime|scan/i;

function isBotUA(ua) {
  if (!ua) return true;
  return BOT_UA_RE.test(ua);
}

// Fire-and-forget: increments must never delay or block the 204 response,
// and a Redis failure must never surface as a thrown error or a non-204.
//
// `path` and `ect` are bucketed against a fixed allow-list before ever
// touching Redis (see _hit-shared.js) — an unauthenticated client cannot
// mint new keys by sending arbitrary `p`/`ect` values. That bounds daily
// key creation to a constant: at most 21 known paths (13 HTML pages + 8
// vercel.json rewrite-source aliases) + 1 "/other" bucket, each with up to
// 4 keys (total/paid/bot/test) = 88, plus 5 ect buckets, plus 1 index key
// per day = 94 keys/day max.
async function recordHit({ path, paid, bot, test, ect }) {
  const day = makassarDateKey(new Date());
  const bucket = bucketPath(path);
  const ectBucket = bucketEct(ect);

  const base = `${KEY_PREFIX}:${day}:${bucket}`;
  const keys = [base];
  if (test) {
    keys.push(`${base}:test`);
  } else {
    if (paid) keys.push(`${base}:paid`);
    if (bot) keys.push(`${base}:bot`);
  }
  if (ectBucket) keys.push(`${KEY_PREFIX}:${day}:ect:${ectBucket}`);

  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.incr(key);
    pipeline.expire(key, TTL_SECONDS);
  }
  // Per-day index of which path buckets saw traffic, so the report can
  // read a bounded set instead of scanning the keyspace.
  const idxKey = indexKey(day);
  pipeline.sadd(idxKey, bucket);
  pipeline.expire(idxKey, TTL_SECONDS);

  await pipeline.exec();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const p = String(req.query.p || '').slice(0, 200);
    const g = req.query.g === '1';
    const t = req.query.t === '1';
    const ect = String(req.query.ect || '').slice(0, 20);
    const vw = parseInt(req.query.vw, 10) || 0;
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const geo = req.headers['x-vercel-ip-country'] || '';

    let refHost = '';
    const ref = req.headers['referer'] || req.headers['referrer'] || '';
    if (ref) {
      try {
        refHost = new URL(ref).hostname.slice(0, 100);
      } catch {}
    }

    const bot = isBotUA(ua);

    console.log(JSON.stringify({
      evt: 'hit',
      p,
      g,
      t,
      ect,
      vw,
      ua,
      geo,
      refHost,
      bot,
      ts: Date.now(),
    }));

    if (redis && p) {
      recordHit({ path: p, paid: g, bot, test: t, ect }).catch((err) => {
        console.error('hit: redis write failed:', err.message);
      });
    }
  } catch (err) {
    console.error('hit endpoint error:', err.message);
  }

  return res.status(204).end();
}
