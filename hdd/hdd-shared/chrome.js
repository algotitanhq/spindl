// The page's own header and footer, in the house style of blok and Uberblok, light to sit with the drive's studio:
// the name in Instrument Serif on the left with "by storagebits" pointing home, the menu in Inter (About, the
// project's card on blok; Projects), the repository's GitHub mark and the flags of the three languages on the right;
// a one-line footer. The 1600 x 900 stage fits between them (live.js reads the heights).
import {LANG, LANGS, T} from './i18n.js';

export const REPO = 'https://github.com/algotitanhq/spindl';
export const BLOK = 'https://blok.storagebits.workers.dev';
const blok = (path) => `${BLOK}${LANG === 'en' ? '' : '/' + LANG}${path}`;

const GITHUB =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
// blok's flags (templates/partials/language_switcher.html)
const FLAG = {
  en: '<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><clipPath id="flag-uk"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath><path d="M0,0v30h60v-30z" fill="#012169"/><path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0L60,30M60,0L0,30" clip-path="url(#flag-uk)" stroke="#C8102E" stroke-width="4"/><path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  fr: '<svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><path fill="#0055A4" d="M0 0h1v2H0z"/><path fill="#fff" d="M1 0h1v2H1z"/><path fill="#EF4135" d="M2 0h1v2H2z"/></svg>',
  es: '<svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><path fill="#AA151B" d="M0 0h3v2H0z"/><path fill="#F1BF00" d="M0 .5h3v1H0z"/></svg>',
};

const CSS = `
.site-top,.site-foot{position:fixed;left:0;right:0;z-index:20;font:14px/1.4 Inter,system-ui,sans-serif;color:#16181b;-webkit-font-smoothing:antialiased}
.site-top{top:0;height:52px;background:color-mix(in srgb,#ecedef 88%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid rgba(22,24,27,.12)}
.site-top .sp-bar{height:100%;max-width:1600px;margin:0 auto;padding:0 32px;box-sizing:border-box;display:flex;align-items:center;gap:22px}
.site-top a{color:inherit;text-decoration:none}
.site-top .mark{font:400 25px/1 'Instrument Serif',Georgia,serif;letter-spacing:-.005em;white-space:nowrap}
.site-top .by{font:400 17px/1 'Instrument Serif',Georgia,serif;color:rgba(22,24,27,.56);white-space:nowrap;margin-left:-12px;padding-top:4px}
.site-top .by b{font-weight:400;color:#ef4a1d}
.site-top .by:hover{color:#16181b}
.site-top nav{margin-left:auto;display:flex;align-items:center;gap:22px}
.site-top ul{list-style:none;margin:0;padding:0;display:flex;align-items:center;gap:20px}
.site-top .menu a{color:rgba(22,24,27,.66)}
.site-top .menu a:hover{color:#16181b}
.site-top .gh{display:grid;place-items:center;width:30px;height:30px;color:rgba(22,24,27,.66)}
.site-top .gh svg{width:19px;height:19px}
.site-top .gh:hover{color:#16181b}
.site-top .langs{gap:12px}
.site-top .lang{display:flex;align-items:center;gap:6px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.02em;color:rgba(22,24,27,.56);padding:4px 0;border-bottom:1.5px solid transparent;cursor:pointer}
.site-top .lang:hover{color:#16181b}
.site-top .lang[aria-current]{color:#16181b;font-weight:700;border-bottom-color:#ef4a1d}
.site-top .flag{width:18px;height:12px;border-radius:1px;box-shadow:0 0 0 .5px rgba(0,0,0,.12)}
.site-top a:focus-visible,.site-foot a:focus-visible{outline:2px solid #ef4a1d;outline-offset:3px;border-radius:2px}
.site-foot{bottom:0;height:30px;border-top:1px solid rgba(22,24,27,.10);background:#ecedef}
.site-foot .sp-bar{height:100%;max-width:1600px;margin:0 auto;padding:0 32px;box-sizing:border-box;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(22,24,27,.52);white-space:nowrap;overflow:hidden}
.site-foot a{color:rgba(22,24,27,.66);text-decoration:underline;text-decoration-color:rgba(22,24,27,.22);text-underline-offset:3px}
.site-foot a:hover{color:#16181b;text-decoration-color:#ef4a1d}
.site-foot .sp-right{margin-left:auto;display:flex;gap:18px}
@media (max-width:900px){.site-top .by,.site-top .menu .more{display:none}.site-top .sp-bar,.site-foot .sp-bar{padding:0 14px}.site-top nav{gap:14px}}
@media (max-width:600px){.site-top .lang span{display:none}.site-foot .credit{display:none}}
@media (max-height:520px){.site-foot{display:none}.site-top{height:40px}.site-top .mark{font-size:21px}.site-top .gh{width:26px;height:26px}}
`;

/** builds the header and the footer; returns their heights for the stage to fit between, and the language links */
export function createChrome() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const top = document.createElement('header');
  top.className = 'site-top';
  top.innerHTML = `<div class="sp-bar">
    <a class="mark" href="./">Spindl</a>
    <a class="by" href="${blok('/')}">${T('byline')} storage<b>bits</b></a>
    <nav aria-label="${T('navLabel')}">
      <ul class="menu">
        <li><a href="${blok('/projects/spindl/')}">${T('navAbout')}</a></li>
        <li class="more"><a href="${blok('/projects/')}">${T('navProjects')}</a></li>
      </ul>
      <ul class="tools">
        <li><a class="gh" href="${REPO}" title="${T('ghTitle')}" aria-label="GitHub">${GITHUB}</a></li>
      </ul>
      <ul class="langs" aria-label="${T('grpLang')}">
        ${LANGS.map((l) => `<li><a class="lang" data-lang="${l}" href="/${l}/" hreflang="${l}" lang="${l}"${l === LANG ? ' aria-current="true"' : ''}>${FLAG[l]}<span>${l.toUpperCase()}</span></a></li>`).join('')}
      </ul>
    </nav>
  </div>`;
  const foot = document.createElement('footer');
  foot.className = 'site-foot';
  foot.innerHTML = `<div class="sp-bar">
    <span>© 2026 <a href="${blok('/')}">storagebits</a> · ${T('footLicense')}</span>
    <span class="credit">${T('footCredit')}</span>
    <span class="sp-right"><a href="${REPO}/blob/main/hdd/REFERENCES.md">${T('footSources')}</a><a href="${REPO}">GitHub · algotitanhq/spindl</a></span>
  </div>`;
  document.body.append(top, foot);
  const heights = () => ({top: top.getBoundingClientRect().height, bottom: getComputedStyle(foot).display === 'none' ? 0 : foot.getBoundingClientRect().height});
  return {top, foot, heights, langLinks: [...top.querySelectorAll('.lang')]};
}
