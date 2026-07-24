
// api/reviews.js — Vercel serverless function (Places API New, ES Module)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://lollygagss.id');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const PLACE_ID = 'ChIJHTK4hLlH0i0RMqbSXuaV1XY';
  const API_KEY  = process.env.GOOGLE_PLACES_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const url = `https://places.googleapis.com/v1/places/${PLACE_ID}?fields=rating,userRatingCount,reviews&key=${API_KEY}`;

  console.log('Fetching Places API (New):', url.replace(API_KEY, 'KEY_HIDDEN'));

  try {
    const upstream = await fetch(url);
    console.log('Google response status:', upstream.status);

    const data = await upstream.json();
    console.log('Google response keys:', Object.keys(data));

    if (data.error) {
      console.error('Google error:', JSON.stringify(data.error));
      return res.status(502).json({
        error:   data.error.status  || 'API_ERROR',
        message: data.error.message || 'Google Places API error',
      });
    }

    const reviews = (data.reviews || []).map(r => ({
      rating:            r.rating                           || 5,
      text:              r.text?.text                       || '',
      author_name:       r.authorAttribution?.displayName  || 'Guest',
      profile_photo_url: (r.authorAttribution?.photoUri || '').replace(/=s\d+-/, '=s90-'),
      relative_time:     r.relativePublishTimeDescription   || '',
    }));

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');

    return res.status(200).json({
      rating:             data.rating          || 0,
      user_ratings_total: data.userRatingCount || 0,
      reviews,
    });

  } catch (err) {
    console.error('Caught error:', err.message, err.stack);
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
