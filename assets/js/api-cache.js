(function () {
  const CACHE_NAME = 'puhl-api-responses-v1';
  const CACHE_TTL_MS = 60 * 60 * 1000;
  const CACHE_TIME_HEADER = 'x-puhl-browser-cached-at';
  const nativeFetch = window.fetch.bind(window);
  const inFlightRequests = new Map();

  function isSiteApi(url) {
    return url.hostname.endsWith('.workers.dev') ||
      url.hostname.endsWith('.darkknightshockey.com');
  }

  function requestUrl(input) {
    return input instanceof Request ? input.url : String(input);
  }

  window.fetch = async function (input, init) {
    const options = init || {};
    const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' || (options.cache && options.cache !== 'default')) return nativeFetch(input, init);

    let url;
    try {
      url = new URL(requestUrl(input), window.location.href);
    } catch (error) {
      return nativeFetch(input, init);
    }
    if (!isSiteApi(url) || !window.caches) return nativeFetch(input, init);

    const key = new Request(url.href, { method: 'GET' });
    const requestKey = url.href;
    let cache;
    try {
      cache = await window.caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(key);
      if (cachedResponse) {
        const cachedAt = Number(cachedResponse.headers.get(CACHE_TIME_HEADER));
        if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) return cachedResponse;
        await cache.delete(key);
      }
    } catch (error) {
      return nativeFetch(input, init);
    }

    if (inFlightRequests.has(requestKey)) {
      return (await inFlightRequests.get(requestKey)).clone();
    }

    const pendingRequest = (async function () {
      const response = await nativeFetch(input, init);
      if (response.ok && response.type !== 'opaque') {
        try {
          const copy = response.clone();
          const headers = new Headers(copy.headers);
          headers.set(CACHE_TIME_HEADER, String(Date.now()));
          await cache.put(key, new Response(copy.body, {
            status: copy.status,
            statusText: copy.statusText,
            headers
          }));
        } catch (error) {
          // Keep the network response usable if the browser refuses storage.
        }
      }
      return response;
    })();

    inFlightRequests.set(requestKey, pendingRequest);
    try {
      return (await pendingRequest).clone();
    } finally {
      inFlightRequests.delete(requestKey);
    }
  };
})();
