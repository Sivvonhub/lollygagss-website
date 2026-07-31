
// api/hit.js — Vercel serverless function (ES Module)
// Server-side arrival beacon: fires via navigator.sendBeacon() as the first
// thing in <head>, independent of whether gtag.js ever loads or fires.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const p = String(req.query.p || '').slice(0, 200);
    const g = req.query.g === '1';
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

    console.log(JSON.stringify({
      evt: 'hit',
      p,
      g,
      ect,
      vw,
      ua,
      geo,
      refHost,
      ts: Date.now(),
    }));
  } catch (err) {
    console.error('hit endpoint error:', err.message);
  }

  return res.status(204).end();
}
