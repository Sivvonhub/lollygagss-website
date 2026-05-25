// api/reviews.js — Vercel serverless function
// Proxies Google Places API so the key never appears in client-side code.

const https = require('https');

module.exports = async function handler(req, res) {
  // CORS — allow your domain and Vercel preview URLs
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const PLACE_ID = 'ChIJHTK4hLlH0i0RMqbSXuaV1XY';
  const API_KEY  = process.env.GOOGLE_PLACES_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const fields = 'rating,user_ratings_total,reviews';
  const url    = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=${fields}&key=${API_KEY}&reviews_sort=newest`;

  try {
    // Use native fetch (Node 18+) with fallback to https module
    let data;
    if (typeof fetch !== 'undefined') {
      const upstream = await fetch(url);
      data = await upstream.json();
    } else {
      // Fallback for older Node versions
      data = await new Promise((resolve, reject) => {
        https.get(url, (r) => {
          let body = '';
          r.on('data', chunk => body += chunk);
          r.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
    }

    if (data.status !== 'OK') {
      return res.status(502).json({
        error: data.status,
        message: data.error_message || 'Google Places API error'
      });
    }

    const result = data.result;

    // Cache for 6 hours
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');

    return res.status(200).json({
      rating:             result.rating             || 0,
      user_ratings_total: result.user_ratings_total || 0,
      reviews:            result.reviews            || [],
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
};
