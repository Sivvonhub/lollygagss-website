// api/reviews.js — Vercel serverless function
// Uses Google Places API (New) — places.googleapis.com/v1/places/:id
// Proxies the request so the API key never appears in client-side code.

const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const PLACE_ID = 'ChIJHTK4hLlH0i0RMqbSXuaV1XY';
  const API_KEY  = process.env.GOOGLE_PLACES_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Places API (New) endpoint
  const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;

  // Places API (New) uses header-based field masks instead of query params
  const options = {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key':    API_KEY,
      'X-Goog-FieldMask':  'rating,userRatingCount,reviews',
      'Content-Type':      'application/json',
    },
  };

  try {
    let data;

    if (typeof fetch !== 'undefined') {
      // Node 18+ native fetch
      const upstream = await fetch(url, options);
      data = await upstream.json();
    } else {
      // Fallback for older Node
      data = await new Promise((resolve, reject) => {
        const req = https.request(url, options, (r) => {
          let body = '';
          r.on('data', chunk => body += chunk);
          r.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    // Places API (New) returns error objects differently
    if (data.error) {
      return res.status(502).json({
        error: data.error.status || 'API_ERROR',
        message: data.error.message || 'Google Places API (New) error',
      });
    }

    // Places API (New) response shape is different from classic:
    // data.rating, data.userRatingCount, data.reviews[]
    // Each review: { rating, text: { text }, authorAttribution: { displayName, photoUri }, relativePublishTimeDescription }

    const reviews = (data.reviews || []).map(r => ({
      rating:             r.rating || 5,
      text:               r.text?.text || '',
      author_name:        r.authorAttribution?.displayName || 'Guest',
      profile_photo_url:  r.authorAttribution?.photoUri || '',
      // New API gives relative time as a string e.g. "2 months ago" — use directly
      relative_time:      r.relativePublishTimeDescription || '',
    }));

    // Cache for 6 hours
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');

    return res.status(200).json({
      rating:             data.rating             || 0,
      user_ratings_total: data.userRatingCount    || 0,
      reviews,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
};
