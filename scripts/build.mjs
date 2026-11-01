#!/usr/bin/env node
// Builds the site into dist/: one self-contained page per language (dist/en/, dist/fr/, dist/es/), the same bundle
// with <html lang> set (hdd-shared/i18n.js reads it), the share card, the favicon, a 404 page and dist/_headers with
// a Content-Security-Policy that allows exactly the page's inline script by its hash.
//
//   npm run build
//
// Adapted from the teardown kit's sims/build.mjs (MIT, kit/LICENSE): three.js and the fonts are inlined, the page
// opens offline and stays under 1 MB so link crawlers read its share card.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const NM = path.join(ROOT, 'node_modules');
export const SITE = 'https://spindl.storagebits.workers.dev';
const LANGS = ['en', 'fr', 'es'];
const MAX_PAGE = 1024 * 1024;

const META = {
  en: {
    title: 'Spindl · a 3.5″ 7,200 rpm hard drive, taken apart',
    description:
      'A desktop hard drive you can take apart in the browser: spin-up, head load, a seek drawn live, the rotational wait, the 3 nm flying height, the emergency park. Every gauge reads the model that moves the parts.',
    locale: 'en_US',
  },
  fr: {
    title: 'Spindl · un disque dur 3,5″ 7 200 tr/min, démonté',
    description:
      'Un disque dur de bureau à démonter dans le navigateur : démarrage, chargement des têtes, un seek tracé en direct, l’attente rotationnelle, le vol à 3 nm, le parking d’urgence. Chaque jauge lit le modèle qui fait bouger les pièces.',
    locale: 'fr_FR',
  },
  es: {
    title: 'Spindl · un disco duro de 3,5″ y 7200 rpm, desmontado',
    description:
      'Un disco duro de escritorio para desmontar en el navegador: arranque, carga de los cabezales, un seek dibujado en vivo, la espera rotacional, el vuelo a 3 nm, el aparcamiento de emergencia. Cada indicador lee el modelo que mueve las piezas.',
    locale: 'es_ES',
  },
};

const font = (file, family, weight) => {
  const b64 = fs.readFileSync(path.join(NM, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
};
const FONTS = [
  ...[400, 600, 700].map((w) => font(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`, 'JetBrains Mono', w)),
  font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'Inter', '100 900'),
  font('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', 'Instrument Serif', 400),
].join('\n');
const KIT_CSS = fs.readFileSync(path.join(ROOT, 'kit/style.css'), 'utf8');

// `teardown-kit/x.js` is the vendored kit in kit/
const kitPlugin = {
  name: 'teardown-kit',
  setup(b) {
    b.onResolve({filter: /^teardown-kit\//}, (args) => ({path: path.join(ROOT, 'kit', args.path.slice('teardown-kit/'.length))}));
  },
};
const res = await esbuild.build({
  plugins: [kitPlugin],
  entryPoints: [path.join(ROOT, 'hdd/hdd-live/main.js')],
  bundle: true,
  format: 'esm',
  minify: !process.env.DEBUG,
  write: false,
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const hash = crypto.createHash('sha256').update(js).digest('base64');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const page = (lang) => {
  const m = META[lang];
  const url = `${SITE}/${lang}/`;
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}/${l}/">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="canonical" href="${url}">
${alt}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#ecedef">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Spindl">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${m.locale}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(m.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.title)}">
<meta name="twitter:description" content="${esc(m.description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<style>
${FONTS}
${KIT_CSS}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">${js}</script>
</body>
</html>
`;
};

fs.rmSync(DIST, {recursive: true, force: true});
fs.mkdirSync(DIST, {recursive: true});
for (const lang of LANGS) {
  const html = page(lang);
  if (html.length > MAX_PAGE && !process.env.DEBUG) {
    console.error(`dist/${lang}/index.html is ${(html.length / 1024).toFixed(0)} KB, over the 1 MB budget`);
    process.exit(1);
  }
  fs.mkdirSync(path.join(DIST, lang), {recursive: true});
  fs.writeFileSync(path.join(DIST, lang, 'index.html'), html);
  console.log(`dist/${lang}/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}
for (const f of fs.readdirSync(path.join(ROOT, 'static'))) fs.copyFileSync(path.join(ROOT, 'static', f), path.join(DIST, f));
fs.writeFileSync(
  path.join(DIST, '404.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spindl · not found</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ecedef;color:#16181b;font:16px/1.5 system-ui,sans-serif}a{color:#ef4a1d}</style></head><body><p>Nothing here. <a href="/">Back to the drive</a></p></body></html>\n`,
);
// security headers for every page and asset (Cloudflare Workers static assets read dist/_headers)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${hash}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
fs.writeFileSync(
  path.join(DIST, '_headers'),
  `/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: ${csp}
`,
);
console.log(`dist/_headers  script sha256-${hash.slice(0, 12)}…`);
