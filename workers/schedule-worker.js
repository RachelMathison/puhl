export default {
  async fetch(request) {
    // 1. Get the domain making the request
    const origin = request.headers.get('Origin');

    // 2. Define your allowed domains
    const allowedOrigins = [
      'https://darkknightshockey.com',
      'https://www.darkknightshockey.com',
      'http://darkknightshockey.com',
      'http://www.darkknightshockey.com',
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'https://rachelmathison.github.io',
      'https://portland.hockey',
      'https://puhl.portland.hockey'
    ];

    // 3. Determine if the requesting origin is allowed
    const isAllowed = allowedOrigins.includes(origin);
    const corsOrigin = isAllowed ? origin : allowedOrigins[0];

    // Optional: Handle browser preflight checks (OPTIONS request)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 4. Read the requested SportNgin tags and fetch the schedule feed.
    const tags = new URL(request.url).searchParams.get('tags')?.trim();
    if (!tags || !/^\d+(,\d+)*$/.test(tags)) {
      return new Response('Provide tags as a comma-separated list of numeric IDs.', {
        status: 400,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    const icalUrl = new URL('https://wicadulthockey.sportngin.com/ical_feed');
    icalUrl.searchParams.set('tags', tags);
    const response = await fetch(icalUrl);
    const data = await response.text();

    // 5. Return the response with restricted CORS header
    return new Response(data, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  },
};
