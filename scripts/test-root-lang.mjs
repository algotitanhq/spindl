// The root's language choice: node scripts/test-root-lang.mjs
import assert from 'node:assert/strict';
import {pickLang} from '../worker/root-lang.js';

const cases = [
  [null, null, 'en'],
  [null, 'en-US,en;q=0.9', 'en'],
  [null, 'fr-CA,fr;q=0.9,en;q=0.8', 'fr'],
  [null, 'en-US,en;q=0.9,fr;q=0.5', 'en'],
  [null, 'en-CA,fr-CA;q=0.9', 'en'],
  [null, 'de-DE,fr;q=0.8,en;q=0.7', 'fr'],
  [null, 'fr;q=0.5,es;q=0.9', 'es'],
  [null, 'es,fr', 'es'],
  [null, 'de,it', 'en'],
  [null, '*', 'en'],
  [null, 'es-MX,es;q=0.9', 'es'],
  [null, 'en,fr;q=0', 'en'],
  ['lang=es', 'fr-FR', 'es'],
  ['theme=x; lang=en', 'fr-FR', 'en'],
  ['lang=de', 'es', 'es'],
];
for (const [cookie, al, want] of cases) assert.equal(pickLang(cookie, al), want, `${cookie} / ${al}`);
console.log(`root-lang: ${cases.length} cases ok`);
