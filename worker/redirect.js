// Spindl lives in Exploded now: every request here answers a 301 to the same machine there. Pure, so
// scripts/test-redirect.mjs covers it. /en/, /fr/, /es/ (and anything under them) keep their language; the share
// card keeps working; any other path goes to the visitor's language (worker/root-lang.js).
import {LANGS, pickLang} from './root-lang.js';

export const EXPLODED = 'https://exploded.storagebits.workers.dev';

export function target(pathname, search, cookie, acceptLanguage) {
  if (pathname === '/og.png') return `${EXPLODED}/spindl/og.png`;
  if (pathname === '/favicon.svg') return `${EXPLODED}/favicon.svg`;
  const first = pathname.split('/')[1];
  const lang = LANGS.includes(first) ? first : pickLang(cookie, acceptLanguage);
  return `${EXPLODED}/${lang}/spindl/${search}`;
}
