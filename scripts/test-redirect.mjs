// The redirect to Exploded: node scripts/test-redirect.mjs
import assert from 'node:assert/strict';
import {target, EXPLODED} from '../worker/redirect.js';

const cases = [
  ['/', '', null, 'fr-CA,fr;q=0.9', `${EXPLODED}/fr/spindl/`],
  ['/', '', 'lang=es', 'en', `${EXPLODED}/es/spindl/`],
  ['/', '?utm_source=hn', null, null, `${EXPLODED}/en/spindl/?utm_source=hn`],
  ['/en/', '', null, 'fr', `${EXPLODED}/en/spindl/`],
  ['/fr/', '', null, 'en', `${EXPLODED}/fr/spindl/`],
  ['/es', '', null, 'en', `${EXPLODED}/es/spindl/`],
  ['/de/', '', null, 'es', `${EXPLODED}/es/spindl/`],
  ['/og.png', '', null, null, `${EXPLODED}/spindl/og.png`],
  ['/favicon.svg', '', null, null, `${EXPLODED}/favicon.svg`],
  ['/nope', '', null, null, `${EXPLODED}/en/spindl/`],
];
for (const [p, q, c, al, want] of cases) assert.equal(target(p, q, c, al), want, `${p}${q}`);
console.log(`redirect: ${cases.length} cases ok`);
