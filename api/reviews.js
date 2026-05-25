// api/reviews.js — Vercel serverless function
// Proxies Google Places API so the key never appears in client-side code.
// Deploy this file to /api/reviews.js in your lollygagss-website GitHub repo.

export default async function handler(req, res) {
  // CORS — only allow your own domain
  res.setHeader('Access-Control-Allow-Origin', 'https://lollygagss.id');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const PLACE_ID  = 'ChIJHTK4hLlH0i0RMqbSXuaV1XY';
  const API_KEY   = process.env.GOOGLE_PLACES_API_KEY; // set this in Vercel dashboard

  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const fields = 'rating,user_ratings_total,reviews';
  const url    = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=${fields}&key=${API_KEY}&reviews_sort=newest`;

  try {
    const upstream = await fetch(url);
    const data     = await upstream.json();

    if (data.status !== 'OK') {
      return res.status(502).json({ error: data.status, message: data.error_message });
    }

    const result = data.result;

    // Cache for 6 hours — reviews don't change that often
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    return res.status(200).json({
      rating:              result.rating              || 0,
      user_ratings_total:  result.user_ratings_total  || 0,
      reviews:             result.reviews             || [],
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
