// The drive's overlay, fixed 1600 x 900 CSS: the title and the spindle gauge top left, what is under the head and the
// zone chart down the left, the transport bottom left; the seek profile (head speed and VCM current, drawn live), the
// rotation dial with the target sector and the access-time breakdown down the right; the phase chip top centre; the
// subsystem buttons bottom centre; cover / cutaway / view toggles bottom right; the nanometre scale for the dive;
// callouts with thin leaders. update(s) redraws everything from the frame's drive state (kin.driveAt).
import {
  CAPACITY, G, J, KT, L, LAT_AVG, NCYL, NZ, OMEGA, REV_S, STROKE, SPT_ID, SPT_OD, T_REV, D2R, rateOf, sptOf, sectorAng, segEval, vLin, PHI_ID, PHI_OD, SERVO_WEDGES, FLY_NM, PITCH_NM,
} from './kin.js';
import {ACCENT} from './drive.js';
import {nf, T} from './i18n.js';

export const C = {ink: '#16181b', mute: '#868a91', faint: '#c9ccd0', line: '#e1e3e6', panel: 'rgba(249,249,250,.94)', acc: ACCENT, accSoft: 'rgba(239,74,29,.12)', blue: '#2f6fb3'};
export const VIEWS = ['dessus', 'trois4', 'rasante', 'tete'];
export const VIEW_LABEL = Object.fromEntries(VIEWS.map((k) => [k, T('view:' + k)]));
export const CUTS = ['glass', 'section', 'solid'];
export const CUT_LABEL = Object.fromEntries(CUTS.map((k) => [k, T('cut:' + k)]));
export const COVERS = ['off', 'glass', 'solid'];
export const COVER_LABEL = Object.fromEntries(COVERS.map((k) => [k, T('cover:' + k)]));
export const SUBS = ['broche', 'plateaux', 'vcm', 'tetes', 'rampe', 'servo', 'elec'];
export const SUB_LABEL = Object.fromEntries(SUBS.map((k) => [k, T('sub:' + k)]));

const TAU = Math.PI * 2;
const CSS = `
#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.ui{position:absolute;inset:0;pointer-events:none}
.pn{position:absolute;background:${C.panel};border:1px solid ${C.line};box-shadow:0 1px 2px rgba(20,22,26,.04)}
.cp{font-size:10px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;white-space:nowrap}
.mu{color:${C.mute}}
.mo{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
.tb{position:absolute;height:21px;padding:0 7px;display:flex;align-items:center;justify-content:center;font-size:9.2px;font-weight:600;letter-spacing:.9px;text-transform:uppercase;border:1px solid ${C.line};background:#fff;color:${C.ink};white-space:nowrap}
.row{position:absolute;display:flex;justify-content:space-between;align-items:baseline;font-size:12px;white-space:nowrap}
.row .k{font-size:9.6px;font-weight:600;letter-spacing:1.3px;color:${C.mute};text-transform:uppercase}
.row .v{font-weight:600;font-size:13.5px}
.call{position:absolute;white-space:nowrap}
.call b{display:block;font-size:14px;font-weight:650;letter-spacing:.05px}
.call span{display:block;font-size:9.4px;font-weight:500;letter-spacing:1.3px;color:${C.mute};text-transform:uppercase;margin-top:2px}
.cur{position:absolute;left:0;top:0;z-index:50;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.ring{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid ${C.ink};opacity:0;z-index:49}
.sp-chip{position:absolute;left:800px;top:30px;transform:translateX(-50%);display:flex;align-items:center;gap:9px;height:28px;padding:0 14px;background:#fff;border:1px solid ${C.line};font-size:11px;font-weight:700;letter-spacing:1.6px;white-space:nowrap}
.sp-chip i{display:block;width:8px;height:8px;border-radius:50%}
.sp-cap{position:absolute;left:800px;top:66px;transform:translateX(-50%);font-size:15px;font-weight:500;color:${C.ink};white-space:nowrap;text-align:center}
`;
const el = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h.trim();
  return d.firstElementChild;
};

// phase names for the chip
export const PHASE = {
  park: [T('ph:park'), C.mute],
  load: [T('ph:load'), C.ink],
  idle: [T('ph:idle'), C.ink],
  seek: [T('ph:seek'), C.ink],
  switch: [T('ph:switch'), C.ink],
  wait: [T('ph:wait'), C.acc],
  read: ['', C.acc],
  retract: [T('ph:retract'), C.ink],
};

export function createConsole(app) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const ui = el(`<div class="ui"></div>`);
  app.appendChild(ui);
  const add = (h) => {
    const n = el(h);
    ui.appendChild(n);
    return n;
  };
  const btn = {};

  // ------------------------------------------------------------ title and spindle gauge
  add(`<div style="position:absolute;left:32px;top:30px;width:43px;height:3px;background:${C.ink}"></div>`);
  add(`<div style="position:absolute;left:32px;top:42px;font-size:24px;font-weight:700;letter-spacing:-.3px">${T('title').replace('<m>', `<span style="color:${C.mute};font-weight:500">`).replace('</m>', '</span>')}</div>`);
  add(`<div class="cp mu" style="position:absolute;left:32px;top:76px;font-weight:500;font-size:9.4px">${T('subtitle', nf(CAPACITY / 1e12, 1))}</div>`);
  const rpmBig = add(`<div style="position:absolute;left:30px;top:98px;font-size:52px;font-weight:800;letter-spacing:-2.6px;line-height:1"></div>`);
  const rpmSub = add(`<div class="cp" style="position:absolute;left:184px;top:112px;font-weight:600;line-height:1.5;font-size:9.4px"></div>`);
  add(`<div style="position:absolute;left:32px;top:160px;width:260px;height:7px;background:#e6e7e9"></div>`);
  const rpmFill = add(`<div style="position:absolute;left:32px;top:160px;height:7px;background:${C.ink}"></div>`);
  add(`<div style="position:absolute;left:${32 + 260}px;top:156px;width:1px;height:15px;background:${C.ink}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:32px;top:173px;font-weight:500;font-size:9px">0</div>`);
  add(`<div class="cp" style="position:absolute;right:${1600 - 292}px;top:173px;font-weight:500;font-size:9px">${T('gaugeMax')}</div>`);

  // ------------------------------------------------------------ under the head
  add(`<div class="pn" style="left:32px;top:200px;width:260px;height:278px"></div>`);
  add(`<div class="cp" style="position:absolute;left:44px;top:212px;font-weight:700">${T('underHead')}</div>`);
  const headTag = add(`<div class="cp mu" style="position:absolute;right:${1600 - 281}px;top:212px;font-weight:500"></div>`);
  const rows = {};
  const ROWS = [
    ['cyl', T('rowCyl')],
    ['zone', T('rowZone')],
    ['sec', T('rowSec')],
    ['lba', T('rowLba')],
    ['r', T('rowR')],
  ];
  ROWS.forEach(([k, n], i) => {
    rows[k] = add(`<div class="row" style="left:44px;top:${234 + i * 22}px;width:237px"><span class="k">${n}</span><span class="v mo"></span></div>`);
  });
  add(`<div style="position:absolute;left:44px;top:350px;width:237px;height:1px;background:${C.line}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:44px;top:358px;font-weight:600">${T('linSpeed')}</div>`);
  const vBig = add(`<div style="position:absolute;left:43px;top:372px;font-size:30px;font-weight:800;letter-spacing:-1.2px;line-height:1"></div>`);
  const vEq = add(`<div class="mo" style="position:absolute;left:44px;top:406px;font-size:10.4px;color:${C.mute}"></div>`);
  add(`<div style="position:absolute;left:44px;top:424px;width:237px;height:1px;background:${C.line}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:44px;top:432px;font-weight:600">${T('skewTitle')}</div>`);
  const skewVal = add(`<div class="mo" style="position:absolute;left:44px;top:449px;font-size:17px;font-weight:700"></div>`);
  const skewSvg = add(`<svg style="position:absolute;left:170px;top:430px" width="112" height="44"></svg>`);

  // ------------------------------------------------------------ ZBR chart
  add(`<div class="pn" style="left:32px;top:486px;width:260px;height:206px"></div>`);
  add(`<div class="cp" style="position:absolute;left:44px;top:498px;font-weight:700">${T('zonesTitle')}</div>`);
  add(`<div class="cp mu" style="position:absolute;right:${1600 - 281}px;top:498px;font-weight:500">${T('zbrZones', NZ)}</div>`);
  const rateBig = add(`<div style="position:absolute;left:43px;top:516px;font-size:30px;font-weight:800;letter-spacing:-1.2px;line-height:1"></div>`);
  const rateSub = add(`<div class="cp mu" style="position:absolute;left:150px;top:520px;font-weight:600;line-height:1.45;font-size:9px"></div>`);
  const zbr = add(`<svg style="position:absolute;left:40px;top:552px" width="246" height="136"></svg>`);

  // ------------------------------------------------------------ transport
  add(`<div class="pn" style="left:32px;top:760px;width:270px;height:125px"></div>`);
  btn.power = add(`<div class="tb" style="left:42px;top:770px;width:120px;height:28px;font-size:9.8px"></div>`);
  btn.req = add(`<div class="tb" style="left:167px;top:770px;width:125px;height:28px;font-size:9.8px">${T('req')}</div>`);
  add(`<div class="cp" style="position:absolute;left:42px;top:809px;font-weight:500">${T('slowmo')}</div>`);
  const playVal = add(`<div class="cp mo" style="position:absolute;right:${1600 - 292}px;top:809px;font-weight:700"></div>`);
  const SLD = {x: 43, w: 248};
  add(`<div style="position:absolute;left:${SLD.x}px;top:828px;width:${SLD.w}px;height:2px;background:${C.line}"></div>`);
  const playKnob = add(`<div style="position:absolute;top:823px;width:9px;height:12px;margin-left:-4.5px;background:${C.ink}"></div>`);
  add(`<div class="cp" style="position:absolute;left:42px;top:843px;font-weight:500">${T('driveTime')}</div>`);
  const clock = add(`<div class="mo" style="position:absolute;right:${1600 - 292}px;top:841px;font-size:12px;font-weight:700"></div>`);
  const clockSub = add(`<div class="cp mu" style="position:absolute;left:42px;top:862px;font-weight:500;font-size:8.8px"></div>`);

  // ------------------------------------------------------------ seek profile
  add(`<div class="pn" style="left:1306px;top:30px;width:262px;height:292px"></div>`);
  add(`<div class="cp" style="position:absolute;left:1318px;top:42px;font-weight:700">${T('seekTitle')}</div>`);
  const seekTag = add(`<div class="cp mu" style="position:absolute;right:${1600 - 1557}px;top:42px;font-weight:500"></div>`);
  const seekBig = add(`<div style="position:absolute;left:1317px;top:60px;font-size:30px;font-weight:800;letter-spacing:-1.2px;line-height:1"></div>`);
  const seekSub = add(`<div class="cp mu" style="position:absolute;left:1430px;top:62px;font-weight:600;line-height:1.45;font-size:9px"></div>`);
  const seekSvg = add(`<svg style="position:absolute;left:1312px;top:96px" width="252" height="222"></svg>`);

  // ------------------------------------------------------------ rotation dial
  add(`<div class="pn" style="left:1306px;top:330px;width:262px;height:200px"></div>`);
  add(`<div class="cp" style="position:absolute;left:1318px;top:342px;font-weight:700">${T('rotation')}</div>`);
  add(`<div class="cp mu" style="position:absolute;right:${1600 - 1557}px;top:342px;font-weight:500">${T('oneRev', nf(T_REV * 1e3, 2))}</div>`);
  const dial = add(`<svg style="position:absolute;left:1310px;top:362px" width="150" height="166"></svg>`);
  const latBig = add(`<div style="position:absolute;left:1458px;top:380px;font-size:26px;font-weight:800;letter-spacing:-1px;line-height:1;white-space:nowrap"></div>`);
  const latSub = add(`<div class="cp mu" style="position:absolute;left:1459px;top:410px;font-weight:600;line-height:1.6;font-size:8.6px;letter-spacing:1px"></div>`);

  // ------------------------------------------------------------ access time breakdown
  add(`<div class="pn" style="left:1306px;top:538px;width:262px;height:112px"></div>`);
  add(`<div class="cp" style="position:absolute;left:1318px;top:550px;font-weight:700">${T('accessTitle')}</div>`);
  const accTag = add(`<div class="cp mu" style="position:absolute;right:${1600 - 1557}px;top:550px;font-weight:500"></div>`);
  const acc = add(`<svg style="position:absolute;left:1316px;top:568px" width="244" height="80"></svg>`);

  // ------------------------------------------------------------ toggles
  add(`<div class="pn" style="left:1306px;top:712px;width:262px;height:173px"></div>`);
  const group = (title, keys, labels, y, prefix) => {
    add(`<div class="cp mu" style="position:absolute;left:1316px;top:${y}px;font-weight:500">${title}</div>`);
    let x = 1316;
    let yy = y + 15;
    keys.forEach((k) => {
      const w = Math.round(labels[k].length * 6.4 + 16);
      if (x + w > 1560) {
        x = 1316;
        yy += 25;
      }
      btn[prefix + k] = add(`<div class="tb" style="left:${x}px;top:${yy}px;width:${w}px">${labels[k]}</div>`);
      x += w + 4;
    });
  };
  group(T('grpCover'), COVERS, COVER_LABEL, 720, 'cover:');
  group(T('grpCut'), CUTS, CUT_LABEL, 766, 'cut:');
  group(T('grpView'), VIEWS, VIEW_LABEL, 812, 'view:');

  // ------------------------------------------------------------ subsystems
  add(`<div class="cp mu" style="position:absolute;left:0;right:0;top:822px;text-align:center;font-weight:500">${T('subsHint').replace('<b>', `<span style="color:${C.ink}">`).replace('</b>', '</span>')}</div>`);
  {
    const keys = SUBS;
    const ws = keys.map((k) => Math.round(SUB_LABEL[k].length * 6.6 + 18));
    const tot = ws.reduce((a, b) => a + b, 0) + 5 * (keys.length - 1);
    let x = 800 - tot / 2;
    keys.forEach((k, i) => {
      btn['sub:' + k] = add(`<div class="tb" style="left:${x}px;top:840px;width:${ws[i]}px;height:24px">${SUB_LABEL[k]}</div>`);
      x += ws[i] + 5;
    });
  }
  add(`<div class="cp" style="position:absolute;left:0;right:0;top:872px;text-align:center;font-weight:500;color:${C.faint};font-size:9px">${T('hint')}</div>`);

  // ------------------------------------------------------------ phase chip and caption
  const chip = add(`<div class="sp-chip"><i></i><span></span></div>`);
  const cap = add(`<div class="sp-cap"></div>`);

  // ------------------------------------------------------------ nanometre scale (the dive)
  const nano = add(`<div style="position:absolute;left:968px;top:112px;width:318px;height:318px;opacity:0"></div>`);
  nano.innerHTML = `<div class="pn" style="left:0;top:0;width:318px;height:318px"></div>
    <div class="cp" style="position:absolute;left:12px;top:12px;font-weight:700">${T('nanoTitle')}</div>
    <div class="cp mu" style="position:absolute;right:12px;top:12px;font-weight:500">LOG 10</div>
    <svg style="position:absolute;left:8px;top:30px" width="302" height="282"></svg>`;
  const nanoSvg = nano.querySelector('svg');

  // ------------------------------------------------------------ callouts, the pointer
  const callSvg = add(`<svg style="position:absolute;inset:0;overflow:visible" width="1600" height="900"></svg>`);
  const callG = add(`<div style="position:absolute;inset:0"></div>`);
  const ring = add(`<div class="ring"></div>`);
  const cur = add(`<div class="cur"><svg width="22" height="22" viewBox="0 0 34 34"><path d="M4 3 L30 13.5 L17.5 17.5 L13.5 30 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg></div>`);
  const centre = (n) => {
    const l = parseFloat(n.style.left);
    const t = parseFloat(n.style.top);
    const w = parseFloat(n.style.width);
    const h = parseFloat(n.style.height || 21);
    return [l + w / 2, t + h / 2];
  };
  const spots = Object.fromEntries(Object.entries(btn).map(([k, n]) => [k, centre(n)]));
  const knobX = (v) => SLD.x + v * SLD.w;
  const pointer = (c) => {
    cur.style.display = c.x < 0 ? 'none' : 'block';
    cur.style.transform = `translate(${(c.x - 3).toFixed(2)}px, ${(c.y - 2).toFixed(2)}px) scale(${c.press ? 0.88 : 1})`;
    ring.style.left = `${c.ringX}px`;
    ring.style.top = `${c.ringY}px`;
    ring.style.opacity = String(c.ring * 0.85);
    ring.style.transform = `scale(${(0.35 + 0.9 * (1 - c.ring)).toFixed(3)})`;
  };
  const setBtn = (n, on, hot = false) => {
    n.style.background = on ? (hot ? C.acc : C.ink) : '#fff';
    n.style.color = on ? '#fff' : C.ink;
    n.style.borderColor = on ? (hot ? C.acc : C.ink) : C.line;
  };

  // static: the ZBR steps (rate against radius)
  const ZX = (r) => 26 + ((r - G.rIn) / (G.rOut - G.rIn)) * 206;
  const ZY = (mb) => 100 - ((mb - 100) / 160) * 86;
  let zbrStatic = `<text x="0" y="10" font-size="7.5" fill="${C.mute}">${T('zbrUnit')}</text>`;
  for (const v of [120, 180, 240]) zbrStatic += `<text x="20" y="${ZY(v) + 2.5}" font-size="7.5" text-anchor="end" fill="${C.mute}">${v}</text><line x1="${ZX(G.rIn)}" x2="${ZX(G.rOut)}" y1="${ZY(v)}" y2="${ZY(v)}" stroke="${C.line}" stroke-width=".7"/>`;
  {
    let p = '';
    const dz = (G.rOut - G.rIn) / NZ;
    for (let z = NZ - 1; z >= 0; z--) {
      const r0 = G.rOut - (z + 1) * dz;
      const r1 = G.rOut - z * dz;
      const y = ZY(rateOf(z));
      p += `${p ? 'L' : 'M'}${ZX(r0).toFixed(1)} ${y.toFixed(1)}L${ZX(r1).toFixed(1)} ${y.toFixed(1)}`;
    }
    zbrStatic += `<path d="${p}" fill="none" stroke="${C.ink}" stroke-width="1.3"/>`;
    // the ideal constant-density line through both ends, for comparison
    zbrStatic += `<line x1="${ZX(G.rIn)}" y1="${ZY(rateOf(NZ - 1))}" x2="${ZX(G.rOut)}" y2="${ZY(rateOf(0))}" stroke="${C.faint}" stroke-dasharray="2 3" stroke-width=".9"/>`;
  }
  zbrStatic += `<line x1="${ZX(G.rIn)}" x2="${ZX(G.rOut)}" y1="102" y2="102" stroke="${C.ink}" stroke-width=".8"/>`;
  for (const r of [20, 25, 30, 35, 40, 46]) zbrStatic += `<text x="${ZX(r)}" y="113" font-size="7.5" text-anchor="middle" fill="${C.mute}">${r}</text>`;
  zbrStatic += `<text x="${ZX(G.rOut)}" y="126" font-size="7.4" letter-spacing=".9" text-anchor="end" fill="${C.mute}">${T('zbrAxis', SPT_ID, SPT_OD)}</text>`;

  // nano scale: log ladder from 1 mm to 1 nm
  const NANO = [
    [1e-3, T('nanoSlider'), '1 mm'],
    [7e-5, T('nanoHair'), '70 µm'],
    [2.5e-6, T('nanoDust'), `${nf(2.5, 1)} µm`],
    [PITCH_NM * 1e-9, T('nanoTrack'), `${PITCH_NM} nm`],
    [1.5e-8, T('nanoLayer'), '≈ 15 nm'],
    [FLY_NM * 1e-9, T('nanoFly'), `≈ ${FLY_NM} nm`],
  ];
  const NY = (m) => 14 + ((Math.log10(1e-3) - Math.log10(m)) / 6) * 252;

  return {
    spots,
    btn,
    playKnob: (v) => [knobX(v), 829],
    root: ui,
    pointer,
    update(s) {
      const d = s.d;
      // spindle
      rpmBig.textContent = nf(d.rpm, 0);
      rpmSub.innerHTML = `${T('rpmUnit')}<br><span class="mu">${nf(d.spin.w / TAU, 1)} ${T('revS')}</span>`;
      rpmFill.style.width = `${Math.min(260, (d.spin.w / OMEGA) * 260).toFixed(1)}px`;
      // under the head
      const on = d.onDisk;
      headTag.innerHTML = on ? T('headTag', d.head, d.head % 2 === 0, d.head < 2 ? 2 : 1).replace('<b>', `<b style="color:${C.ink}">`) : T('onRamp');
      const dash = '—';
      rows.cyl.lastChild.textContent = on ? `${nf(d.c)} / ${nf(NCYL)}` : dash;
      rows.zone.lastChild.textContent = on ? T('zoneVal', d.z, d.spt) : dash;
      rows.sec.lastChild.textContent = on && d.sector >= 0 ? `${d.sector} / ${d.spt}` : dash;
      rows.lba.lastChild.textContent = d.lba >= 0 ? nf(d.lba) : dash;
      rows.lba.lastChild.style.color = d.reading ? C.acc : C.ink;
      rows.r.lastChild.textContent = `${nf(d.r, 2)} mm`;
      const vNom = vLin(d.r);
      vBig.innerHTML = `${nf(d.v, 1)} <span style="font-size:13px;font-weight:600;letter-spacing:0">m/s</span>`;
      const f = d.spin.w / TAU;
      vEq.textContent = `v = 2π · ${nf(d.r / 1000, 4)} m · ${nf(f, f >= 119.95 ? 0 : 1)} ${T('revUnit')} = ${nf(TAU * d.r * 1e-3 * f, 1)}`;
      void vNom;
      skewVal.innerHTML = `${d.skew >= 0 ? '+' : '−'}${nf(Math.abs(d.skew / D2R), 1)}°`;
      {
        // the slider's axis against the track tangent
        const a = d.skew;
        const cx = 56;
        const cy = 24;
        let h = `<line x1="${cx - 50}" x2="${cx + 50}" y1="${cy}" y2="${cy}" stroke="${C.faint}" stroke-width="1"/><text x="${cx + 50}" y="${cy - 5}" font-size="7" text-anchor="end" fill="${C.mute}">${T('track')}</text>`;
        const dx = Math.cos(a) * 34;
        const dy = -Math.sin(a) * 34;
        h += `<line x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${cy + dy}" stroke="${C.ink}" stroke-width="1.4"/>`;
        h += `<rect x="${cx - 7}" y="${cy - 4}" width="14" height="8" fill="#fff" stroke="${C.ink}" stroke-width="1.2" transform="rotate(${(-a / D2R).toFixed(2)} ${cx} ${cy})"/>`;
        skewSvg.innerHTML = h;
      }
      // ZBR
      rateBig.innerHTML = d.reading ? `${nf(d.rate, 0)} <span style="font-size:13px;font-weight:600;letter-spacing:0">${T('mbs')}</span>` : `<span style="color:${C.faint}">0</span> <span style="font-size:13px;font-weight:600;letter-spacing:0;color:${C.faint}">${T('mbs')}</span>`;
      rateBig.style.color = d.reading ? C.acc : C.ink;
      rateSub.innerHTML = d.reading ? T('rateReading', d.z) : on ? T('rateMedia', d.z, nf(d.zoneRate, 0)) : `${T('rateNone')}<br>&nbsp;`;
      {
        let h = zbrStatic;
        if (on) {
          const x = ZX(d.r);
          const y = ZY(d.zoneRate);
          h += `<line x1="${x}" x2="${x}" y1="10" y2="102" stroke="${d.reading ? C.acc : C.ink}" stroke-width="${d.reading ? 1.6 : 1}" stroke-dasharray="${d.reading ? '' : '2 2'}"/><circle cx="${x}" cy="${y}" r="3.6" fill="${d.reading ? C.acc : '#fff'}" stroke="${d.reading ? C.acc : C.ink}" stroke-width="1.3"/>`;
        }
        zbr.innerHTML = h;
      }
      // transport
      playVal.textContent = s.playText;
      playKnob.style.left = `${knobX(s.playK).toFixed(1)}px`;
      clock.textContent = `${nf(d.t * 1e3, 3)} ms`;
      clockSub.textContent = s.clockNote || '';
      btn.power.innerHTML = `⏻ &nbsp;${s.powered ? T('powerOff') : T('powerOn')}`;
      setBtn(btn.power, s.powered);
      btn.req.style.display = s.live ? 'flex' : 'none';

      // seek profile: head speed and VCM current, the elapsed part drawn, the rest faint
      {
        const sk = d.seek;
        const W = 252;
        const x0 = 26;
        const xw = 214;
        let h = '';
        const vy = (v) => 92 - (v / 4.2) * 78;
        const iy = (a) => 160 - (a / 1.0) * 34;
        h += `<text x="0" y="10" font-size="7.5" fill="${C.mute}">M/S</text>`;
        for (const v of [0, 2, 4]) h += `<text x="20" y="${vy(v) + 2.5}" font-size="7.5" text-anchor="end" fill="${C.mute}">${v}</text><line x1="${x0}" x2="${x0 + xw}" y1="${vy(v)}" y2="${vy(v)}" stroke="${C.line}" stroke-width=".7"/>`;
        h += `<text x="${x0 + xw}" y="10" font-size="7.4" letter-spacing=".9" text-anchor="end" fill="${C.mute}">${T('headSpeed')}</text>`;
        h += `<text x="0" y="118" font-size="7.5" fill="${C.mute}">A</text>`;
        for (const a of [-1, 0, 1]) h += `<text x="20" y="${iy(a) + 2.5}" font-size="7.5" text-anchor="end" fill="${C.mute}">${a > 0 ? '+1' : a < 0 ? '−1' : '0'}</text><line x1="${x0}" x2="${x0 + xw}" y1="${iy(a)}" y2="${iy(a)}" stroke="${a ? C.line : C.faint}" stroke-width=".7"/>`;
        h += `<text x="${x0 + xw}" y="118" font-size="7.4" letter-spacing=".9" text-anchor="end" fill="${C.mute}">${T('coilCurrent')}</text>`;
        if (sk) {
          const dur = sk.dur;
          const X = (tt) => x0 + (tt / Math.max(dur, 1e-6)) * xw;
          const seg = {k: 'seek', t0: 0, t1: dur, T: sk.T, phi0: sk.phi0, phi1: sk.phi1};
          const now = Math.min(dur, d.t - sk.t0);
          let pv = '';
          let pi = '';
          let qv = '';
          let qi = '';
          const N = 90;
          for (let i = 0; i <= N; i++) {
            const tt = (i / N) * dur;
            const m = segEval(seg, tt);
            const sp = Math.abs(m.v) * L * 1e-3;
            const amp = (J * m.a) / KT;
            const pt = `${X(tt).toFixed(1)} ${vy(sp).toFixed(1)}`;
            const pa = `${X(tt).toFixed(1)} ${iy(Math.max(-1.15, Math.min(1.15, amp))).toFixed(1)}`;
            pv += `${i ? 'L' : 'M'}${pt}`;
            pi += `${i ? 'L' : 'M'}${pa}`;
            if (tt <= now) {
              qv += `${i ? 'L' : 'M'}${pt}`;
              qi += `${i ? 'L' : 'M'}${pa}`;
            }
          }
          h += `<path d="${pv}" fill="none" stroke="${C.faint}" stroke-width="1"/><path d="${pi}" fill="none" stroke="${C.faint}" stroke-width="1"/>`;
          h += `<path d="${qv}" fill="none" stroke="${C.ink}" stroke-width="1.8"/><path d="${qi}" fill="none" stroke="${C.blue}" stroke-width="1.5"/>`;
          if (sk.live) {
            const m = segEval(seg, now);
            const amp = (J * m.a) / KT;
            h += `<circle cx="${X(now)}" cy="${vy(Math.abs(m.v) * L * 1e-3)}" r="3.2" fill="${C.ink}"/><circle cx="${X(now)}" cy="${iy(Math.max(-1.15, Math.min(1.15, amp)))}" r="3" fill="${C.blue}"/>`;
          }
          // the accelerate / brake halves and the settle
          h += `<line x1="${X(sk.T / 2)}" x2="${X(sk.T / 2)}" y1="14" y2="180" stroke="${C.line}" stroke-dasharray="2 2"/><line x1="${X(sk.T)}" x2="${X(sk.T)}" y1="14" y2="180" stroke="${C.line}" stroke-dasharray="2 2"/>`;
          h += `<text x="${X(sk.T / 4)}" y="190" font-size="7.4" letter-spacing=".8" text-anchor="middle" fill="${C.mute}">${T('accel')}</text><text x="${X((3 * sk.T) / 4)}" y="190" font-size="7.4" letter-spacing=".8" text-anchor="middle" fill="${C.mute}">${T('brake')}</text><text x="${Math.min(X(sk.T) + 3, x0 + xw)}" y="190" font-size="7.4" letter-spacing=".8" text-anchor="${X(sk.T) + 30 > x0 + xw ? 'end' : 'start'}" fill="${C.mute}">${T('settle')}</text>`;
          h += `<line x1="${x0}" x2="${x0 + xw}" y1="198" y2="198" stroke="${C.ink}" stroke-width=".8"/>`;
          for (const f of [0, 0.5, 1]) h += `<text x="${X(dur * f)}" y="210" font-size="7.5" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" fill="${C.mute}">${nf(dur * f * 1e3, 1)} ms</text>`;
          seekBig.innerHTML = `${nf((sk.live ? now : dur) * 1e3, 2)} <span style="font-size:13px;font-weight:600;letter-spacing:0">ms</span>`;
          seekSub.innerHTML = T('seekSub', nf(sk.dc), nf(Math.abs(sk.phi1 - sk.phi0) / D2R, 1), nf(STROKE / D2R, 1));
          seekTag.innerHTML = sk.live ? `<b style="color:${C.ink}">${T('seekLive')}</b>` : T('seekLast');
        } else {
          seekBig.innerHTML = `<span style="color:${C.faint}">—</span>`;
          seekSub.innerHTML = T('seekIdle', nf(8.5, 1), nf(0.9, 1));
          seekTag.textContent = '';
          h += `<line x1="${x0}" x2="${x0 + xw}" y1="198" y2="198" stroke="${C.ink}" stroke-width=".8"/>`;
        }
        seekSvg.innerHTML = h;
      }

      // rotation dial: the platter from above, the head fixed, the target sector turning toward it
      {
        const cx = 75;
        const cy = 78;
        const R = 62;
        const r0 = 26;
        let h = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f1f2f4" stroke="${C.faint}" stroke-width="1"/><circle cx="${cx}" cy="${cy}" r="${r0}" fill="#fff" stroke="${C.faint}" stroke-width="1"/>`;
        // servo wedges every 10th, turning with the platter
        const th = d.th;
        for (let i = 0; i < SERVO_WEDGES; i += 10) {
          const a = (i / SERVO_WEDGES) * TAU + th;
          h += `<line x1="${cx + Math.cos(a) * (r0 + 3)}" y1="${cy - Math.sin(a) * (r0 + 3)}" x2="${cx + Math.cos(a) * (R - 3)}" y2="${cy - Math.sin(a) * (R - 3)}" stroke="#dfe1e4" stroke-width=".7"/>`;
        }
        const rr = r0 + ((d.onDisk ? d.r : G.rOut + 3) - G.rIn) / (G.rOut - G.rIn) * (R - r0 - 6) + 2;
        h += `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" fill="none" stroke="${d.onDisk ? C.acc : C.faint}" stroke-width="${d.onDisk ? 1.2 : 0.8}" opacity="${d.onDisk ? 0.6 : 1}"/>`;
        const tg = d.target;
        if (tg && d.onDisk) {
          const n = tg.wrap ? 1 : Math.min(tg.n, 8);
          const a0 = sectorAng(tg.c, tg.h, tg.s0, tg.spt) + th;
          const a1 = a0 - Math.max((TAU * n) / tg.spt, 0.09);
          const p = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy - Math.sin(a) * r).toFixed(1)}`;
          h += `<path d="M${p(a0, rr - 5)} A${rr - 5} ${rr - 5} 0 0 0 ${p(a1, rr - 5)} L${p(a1, rr + 5)} A${rr + 5} ${rr + 5} 0 0 1 ${p(a0, rr + 5)} Z" fill="${C.acc}"/>`;
        }
        // the head: fixed at its world angle
        const ha = d.psi;
        const hx = cx + Math.cos(ha) * rr;
        const hy = cy - Math.sin(ha) * rr;
        h += `<line x1="${cx + Math.cos(ha) * (R + 12)}" y1="${cy - Math.sin(ha) * (R + 12)}" x2="${hx}" y2="${hy}" stroke="${C.ink}" stroke-width="1.6"/><rect x="${hx - 4}" y="${hy - 3}" width="8" height="6" fill="${C.ink}" transform="rotate(${(-ha / D2R + 90).toFixed(1)} ${hx} ${hy})"/>`;
        // rotation direction
        h += `<path d="M${cx + R + 4} ${cy - 18} A${R + 4} ${R + 4} 0 0 0 ${cx + R - 2} ${cy - 34}" fill="none" stroke="${C.mute}" stroke-width="1"/><path d="M${cx + R - 2} ${cy - 34} l-1 6 l5 -3 z" fill="${C.mute}"/>`;
        h += `<text x="${cx}" y="${cy + 3}" font-size="7.4" letter-spacing=".8" text-anchor="middle" fill="${C.mute}">${T('topView')}</text>`;
        dial.innerHTML = h;
        const w = d.wait;
        if (w) {
          latBig.innerHTML = `${nf(w.left * 1e3, 2)} <span style="font-size:12px;font-weight:600;letter-spacing:0">ms</span>`;
          latBig.style.color = C.acc;
          latSub.innerHTML = `${w.zero ? T('latZero') : T('latBefore', w.s)}<br>${T('latThis', nf(w.total * 1e3, 2))}<br>${T('latAvg', nf(LAT_AVG * 1e3, 2))}<br>${T('halfRev')}`;
        } else {
          latBig.innerHTML = d.reading ? `<span style="font-size:11px;letter-spacing:1px;font-weight:600">${T('sectorWord')}</span><br>${d.sector}` : `<span style="color:${C.faint}">—</span>`;
          latBig.style.color = d.reading ? C.acc : C.ink;
          latSub.innerHTML = d.reading ? `<br>${T('reading')}<br>${T('latAvg', nf(LAT_AVG * 1e3, 2))}<br>${T('halfRev')}` : T('latIdle', nf(LAT_AVG * 1e3, 2), REV_S);
        }
      }

      // access time: seek + latency + transfer of the current request
      {
        const a = s.access;
        let h = '';
        if (a) {
          const tot = a.seek + a.lat + a.xfer;
          const X = (v) => (v / Math.max(tot, 1e-6)) * 236;
          let x = 0;
          const bar = (v, col, name, y) => {
            const w = Math.max(1.5, X(v));
            h += `<rect x="${x + 4}" y="6" width="${w}" height="14" fill="${col}"/>`;
            h += `<text x="4" y="${y}" font-size="8.6" fill="${C.ink}"><tspan font-weight="700">${nf(v * 1e3, 2)} ms</tspan><tspan fill="${C.mute}" letter-spacing=".9" font-size="7.6"> ${name}</tspan></text>`;
            x += w;
          };
          bar(a.seek, C.ink, 'SEEK', 36);
          bar(a.lat, '#a6aab0', T('barLat'), 50);
          bar(a.xfer, C.acc, T('barXfer', a.n), 64);
          accTag.innerHTML = `<b style="color:${C.ink}">${nf(tot * 1e3, 2)} MS</b>`;
        } else accTag.textContent = '';
        acc.innerHTML = h;
      }

      // toggles
      for (const k of COVERS) setBtn(btn['cover:' + k], s.cover === k);
      for (const k of CUTS) setBtn(btn['cut:' + k], s.cut === k);
      for (const k of VIEWS) setBtn(btn['view:' + k], s.view === k);
      for (const k of SUBS) setBtn(btn['sub:' + k], s.sub === k);

      // chip and caption
      {
        const [name, col] = PHASE[d.k] || PHASE.idle;
        let label = name;
        if (d.k === 'park' && d.spin.k === 'up') label = T('ph:up');
        if (d.k === 'park' && d.spin.k === 'down') label = T('ph:down');
        if (d.k === 'park' && d.spin.k === 'stop') label = T('ph:stop');
        if (d.k === 'read') label = T('ph:read', nf(d.rate, 0));
        chip.lastChild.textContent = label;
        chip.firstChild.style.background = col;
        cap.textContent = s.caption || '';
        cap.style.opacity = String(s.capO ?? 1);
      }

      // nanometre scale
      {
        const o = s.nano ?? 0;
        nano.style.opacity = o.toFixed(3);
        if (o > 0.01) {
          const k = s.nanoK ?? 1; // 0..1: the zoom walking down the ladder
          let h = '';
          for (let e = 0; e <= 6; e++) {
            const y = 14 + (e / 6) * 252;
            h += `<line x1="70" x2="78" y1="${y}" y2="${y}" stroke="${C.ink}" stroke-width=".8"/><text x="64" y="${y + 3}" font-size="8.4" text-anchor="end" fill="${C.mute}" class="mo">${['1 mm', '100 µm', '10 µm', '1 µm', '100 nm', '10 nm', '1 nm'][e]}</text>`;
          }
          h += `<line x1="74" x2="74" y1="14" y2="266" stroke="${C.ink}" stroke-width=".8"/>`;
          const zoomY = 14 + k * 252;
          h += `<rect x="80" y="${Math.max(10, zoomY - 22)}" width="214" height="${Math.min(44, 266 - zoomY + 24)}" fill="${C.accSoft}" opacity=".0"/>`;
          NANO.forEach(([m, n, v], i) => {
            const y = NY(m);
            const lit = i === NANO.length - 1;
            const shown = y <= zoomY + 4;
            const op = shown ? 1 : 0.25;
            h += `<g opacity="${op}"><circle cx="74" cy="${y}" r="${lit ? 4.5 : 3}" fill="${lit ? C.acc : '#fff'}" stroke="${lit ? C.acc : C.ink}" stroke-width="1.2"/>`;
            h += `<line x1="80" x2="96" y1="${y}" y2="${y}" stroke="${C.faint}"/><text x="100" y="${y + 1}" font-size="11.5" font-weight="${lit ? 700 : 500}" fill="${lit ? C.acc : C.ink}">${n}</text><text x="100" y="${y + 13}" font-size="8.6" fill="${C.mute}" class="mo">${v}</text></g>`;
          });
          // ratio line: the slider at the scale of a jumbo jet
          h += `<text x="296" y="${276}" font-size="8.2" text-anchor="end" fill="${C.mute}">${T('nanoNote')}</text>`;
          nanoSvg.innerHTML = h;
        }
      }

      // callouts
      let lh = '';
      let ch = '';
      for (const c of s.callouts || []) {
        if (c.o < 0.02 || !c.at) continue;
        const [ax, ay] = c.at;
        const [lx, ly] = c.label;
        const right = c.align === 'right';
        const ex = right ? lx - c.w : lx + c.w;
        lh += `<polyline points="${ax.toFixed(1)},${ay.toFixed(1)} ${lx.toFixed(1)},${(ly + 19).toFixed(1)} ${ex.toFixed(1)},${(ly + 19).toFixed(1)}" fill="none" stroke="${c.hot ? C.acc : C.mute}" stroke-width="${c.hot ? 1.2 : 0.9}" opacity="${c.o.toFixed(2)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.2" fill="${c.hot ? C.acc : C.ink}" opacity="${c.o.toFixed(2)}"/>`;
        ch += `<div class="call" style="left:${(right ? lx - c.w : lx).toFixed(1)}px;width:${c.w}px;text-align:${right ? 'right' : 'left'};top:${(ly - 10).toFixed(1)}px;opacity:${c.o.toFixed(2)}"><b style="color:${c.hot ? C.acc : C.ink}">${c.name}</b><span>${c.sub}</span></div>`;
      }
      callSvg.innerHTML = lh;
      callG.innerHTML = ch;
      pointer(s.cursor);
    },
  };
}
export {PHI_ID, PHI_OD, SPT_ID, SPT_OD, sptOf};
