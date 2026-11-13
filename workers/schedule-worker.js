const allowedOrigins = [
  'https://portland.hockey',
  'http://portland.hockey',
  'https://www.portland.hockey',
  'http://www.portland.hockey',
  'https://puhl.portland.hockey',
  'http://puhl.portland.hockey',
  'https://darkknightshockey.com',
  'http://darkknightshockey.com',
  'https://www.darkknightshockey.com',
  'http://www.darkknightshockey.com',
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const isLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || '');
    const isXarriaWorker = /^https:\/\/[a-z0-9-]+\.xarria\.workers\.dev$/.test(origin || '');
    const isAllowed = allowedOrigins.includes(origin) || isLocalhost || isXarriaWorker;
    const corsOrigin = isAllowed ? origin : allowedOrigins[0];
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin'
    };

    // Optional: Handle browser preflight checks (OPTIONS request)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Read the requested SportNgin tags and fetch the schedule feed.
    const tags = new URL(request.url).searchParams.get('tags')?.trim();
    if (!tags || !/^\d+(,\d+)*$/.test(tags)) {
      return new Response('Provide tags as a comma-separated list of numeric IDs.', {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    const icalUrl = new URL('https://wicadulthockey.sportngin.com/ical_feed');
    icalUrl.searchParams.set('tags', tags);
    const response = await fetch(icalUrl);
    const data = await response.text();
    if (!response.ok) {
      return new Response('Could not fetch the schedule feed.', {
        status: 502,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Return the response with restricted CORS header
    return new Response(data, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'public, max-age=900',
      },
    });
  },
};
