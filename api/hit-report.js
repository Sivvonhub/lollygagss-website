
// api/hit-report.js — Vercel serverless function (ES Module)
// Internal-only read endpoint over the arrival-beacon counters written by
// api/hit.js. GET /api/hit-report?days=N (default 7, max 90).
//
// Auth: requires `Authorization: Bearer <HIT_REPORT_SECRET>`. Missing or
// wrong credentials return 404 (not 401) so the endpoint's existence isn't
// advertised. The secret is never accepted as a query parameter.
//
// Dates are UTC calendar days. Bali is UTC+8, so a UTC day boundary
// (00:00 UTC = 08:00 Bali) splits the Bali trading day — every report this
// endpoint returns is bucketed by UTC date, and says so in the response.

import { Redis } from '@upstash/redis';
import { timingSafeEqual } from 'node:crypto';
import { utcDateKey, indexKey, ALL_ECT_BUCKETS } from './_hit-shared.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const redis = (KV_URL && KV_TOKEN) ? new Redis({ url: KV_URL, token: KV_TOKEN }) : null;

const SECRET = process.env.HIT_REPORT_SECRET || '';

function isAuthorized(req) {
  if (!SECRET) return false;
  const header = req.headers['authorization'] || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length);
  const a = Buffer.from(token);
  const b = Buffer.from(SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Builds one day's report from a bounded set of keys: the path index (at
// most 13 known paths + "/other") gives total/paid/bot keys per path, and
// the ect buckets are a fixed 5-value list — no keyspace scan needed.
async function buildDayReport(date) {
  const paths = await redis.smembers(indexKey(date));

  const pathKeys = [];
  for (const path of paths) {
    pathKeys.push(`hit:${date}:${path}`, `hit:${date}:${path}:paid`, `hit:${date}:${path}:bot`);
  }
  const ectKeys = ALL_ECT_BUCKETS.map((bucket) => `hit:${date}:ect:${bucket}`);
  const allKeys = [...pathKeys, ...ectKeys];

  const byPath = {};
  const paidByPath = {};
  const botByPath = {};
  const ectByValue = {};

  if (allKeys.length) {
    const values = await redis.mget(...allKeys);

    paths.forEach((path, i) => {
      const [total, paid, bot] = values.slice(i * 3, i * 3 + 3).map((v) => Number(v) || 0);
      byPath[path] = total;
      paidByPath[path] = paid;
      botByPath[path] = bot;
    });

    ALL_ECT_BUCKETS.forEach((bucket, i) => {
      const count = Number(values[pathKeys.length + i]) || 0;
      if (count > 0) ectByValue[bucket] = count;
    });
  }

  const total = Object.values(byPath).reduce((sum, n) => sum + n, 0);
  const paid = Object.values(paidByPath).reduce((sum, n) => sum + n, 0);
  const bot = Object.values(botByPath).reduce((sum, n) => sum + n, 0);

  return { date, total, paid, bot, human: total - bot, byPath, paidByPath, botByPath, ectByValue };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(404).end();
  }

  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  let days = parseInt(req.query.days, 10);
  if (!Number.isFinite(days) || days < 1) days = 7;
  if (days > 90) days = 90;

  try {
    const now = new Date();
    const dateKeys = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      dateKeys.push(utcDateKey(d));
    }

    const perDay = [];
    for (const date of dateKeys) {
      perDay.push(await buildDayReport(date));
    }

    return res.status(200).json({
      timezone: 'UTC',
      note: 'Days are bucketed by UTC calendar date. Bali is UTC+8, so a UTC day boundary splits the Bali trading day.',
      days,
      from: dateKeys[0],
      to: dateKeys[dateKeys.length - 1],
      perDay,
    });
  } catch (err) {
    console.error('hit-report error:', err.message);
    return res.status(500).json({ error: 'Report generation failed' });
  }
}
