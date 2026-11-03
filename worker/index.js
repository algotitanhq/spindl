// The only Worker code: every path answers a 301 to the same machine in Exploded (worker/redirect.js). The browser
// keeps the visitor's Referer across the redirect, so the sources still show in Exploded's analytics.
import {target} from './redirect.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return new Response(null, {
      status: 301,
      headers: {
        Location: target(url.pathname, url.search, request.headers.get('Cookie'), request.headers.get('Accept-Language')),
        'Cache-Control': 'public, max-age=3600',
        Vary: 'Accept-Language, Cookie',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    });
  },
};
