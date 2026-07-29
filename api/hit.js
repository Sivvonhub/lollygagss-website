
// api/hit.js — Vercel serverless function (ES Module)
// Server-side arrival beacon: fires via navigator.sendBeacon() as the first
// thing in <head>, independent of whether gtag.js ever loads or fires.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const p = String(req.query.p || '').slice(0, 200);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const ref = String(req.headers['referer'] || req.headers['referrer'] || '').slice(0, 300);
    const geo = req.headers['x-vercel-ip-country'] || '';

    console.log(JSON.stringify({
      evt: 'hit',
      p,
      ua,
      geo,
      ref,
      ts: Date.now(),
    }));
  } catch (err) {
    console.error('hit endpoint error:', err.message);
  }

  return res.status(204).end();
}
