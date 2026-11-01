// The drive's tour film: the drive (drive.js) on the pale studio (stage.js) under the console (console.js). The drive
// runs on its own clock τ (tour.js: film time → drive time at a playback rate that follows the story). An operator
// powers it up, opens the ramp, reads a track on the outer edge from above, opens the VCM for a long seek, waits for
// the sector, dives to the slider, explodes the stack and cuts the power. render(t) is a pure function of t.
import {runSim} from 'teardown-kit/runtime.js';
import {createConsole, SUB_LABEL} from './console.js';
import {nf, T} from './i18n.js';
import {D2R, G, NCYL, PV, SP, SURF, L, sectorAng, surfY, armAng, OMEGA, driveAt, rOfCyl} from './kin.js';
import {createStage} from './stage.js';
import {B, DURATION, PLAN, rateAt, tauAt} from './tour.js';

const TAU = Math.PI * 2;
const MM = 0.001;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));

// ------------------------------------------------------------ the operator's script: one click per beat
// click: the console button pressed; the state it sets (view, sub, cover, cut, power) holds until changed.
export const SCRIPT = [
  {t: 0, view: 'trois4', cover: 'glass', cut: 'solid', sub: null},
  {t: B.spinup, click: 'power', power: true},
  {t: B.load - 0.55, click: 'sub:rampe', sub: 'rampe', cover: 'off'},
  {t: B.read - 0.15, click: 'view:dessus', view: 'dessus', sub: null},
  {t: B.seek - 0.2, click: 'sub:vcm', sub: 'vcm'},
  {t: B.wait - 0.25, cam: 'headtop', sub: null},
  {t: B.dive, click: 'view:tete', view: 'tete', cam: null},
  {t: B.explode, click: 'sub:plateaux', sub: 'plateaux'},
  {t: B.power, click: 'power', power: false, sub: null, view: 'trois4', cam: 'rampe'},
  {t: B.power + 2.9, cam: 'outro'},
];
export const CAPTIONS = [
  [0, T('cap0')],
  [B.spinup, T('cap1')],
  [B.load, T('cap2')],
  [B.read, T('cap3')],
  [B.seek, T('cap4')],
  [B.wait, T('cap5')],
  [B.dive, T('cap6')],
  [B.explode, T('cap7')],
  [B.power, T('cap8')],
];
// the state each script key holds at film time t
export const held = (t, key, list = SCRIPT) => {
  let v;
  let at = 0;
  for (const e of list) {
    if (e.t > t) break;
    if (key in e) {
      v = e[key];
      at = e.t;
    }
  }
  return {v, at};
};

// ------------------------------------------------------------ positions in the drive (metres, pure functions of d)
export const headPos = (d, h = d.head, ex = 0, lift = 0, l = L - 0.3) => {
  const a = armAng(d.phi);
  return [(PV.x + l * Math.cos(a)) * MM, (surfY(h, ex) + lift + (SURF[h].up ? 0.15 : -0.15)) * MM, (PV.z + l * Math.sin(a)) * MM];
};
const P = (x, y, z) => [x * MM, y * MM, z * MM];
export const exOf = (k) => ({ex: k * 7.5, lift: smoother(k) * 24});

// ------------------------------------------------------------ views: functions of u (seconds since they came on) and d
export const VIEW_FN = {
  trois4: (u) => ({tx: 0.0, ty: 0.009, tz: 0.004, az: 30 + 2.2 * u, el: 34, dist: 0.35, sx: 0, sy: 26}),
  dessus: (u) => ({tx: 0.0, ty: 0.012, tz: 0.002, az: -90, el: 88.5, dist: 0.385 - 0.004 * u, sx: 0, sy: 6}),
  rasante: (u) => ({tx: -0.004, ty: 0.012, tz: -0.006, az: -58 + 1.2 * u, el: 7, dist: 0.27, sx: 0, sy: 20}),
  tete: (u, d, x0 = {}) => {
    const [x, y, z] = headPos(d, d.head, x0.ex ?? 0, x0.lift ?? 0);
    const rx = x - SP.x * MM;
    const rz = z - SP.z * MM;
    const az = Math.atan2(rx, rz) / D2R + 14 + 1.6 * u;
    // a head under its platter is seen from below
    const up = SURF[d.head].up ? 1 : -1;
    return {tx: x, ty: y - up * 0.0001, tz: z, az, el: up * (7 + 0.5 * u), dist: 0.0046 - 0.00008 * u, sx: -150, sy: 40 * up};
  },
  headtop: (u, d) => {
    const [x, y, z] = headPos(d);
    return {tx: x * 0.75, ty: y, tz: z * 0.75 + SP.z * MM * 0.25, az: -90, el: 80, dist: 0.165 - 0.006 * u, sx: 0, sy: 0};
  },
  rampe: (u) => ({tx: -0.024, ty: 0.012, tz: 0.016, az: 146 + 3 * u, el: 34 - 1.2 * u, dist: 0.12, sx: 0, sy: 10}),
  vcm: (u) => ({tx: 0.008, ty: 0.014, tz: 0.016, az: 18 + 2 * u, el: 56, dist: 0.33, sx: 0, sy: 0}),
  plateaux: (u) => ({tx: 0.004, ty: 0.036, tz: 0.0, az: -36 + 2.0 * u, el: 14 + 0.6 * u, dist: 0.235, sx: 60, sy: 10}),
  broche: (u) => ({tx: SP.x * MM, ty: 0.01, tz: SP.z * MM, az: 168 + 3 * u, el: 22, dist: 0.2, sx: 0, sy: 10}),
  servo: (u, d) => {
    const [x, y, z] = headPos(d);
    return {tx: x * 0.6, ty: y, tz: z * 0.6 + SP.z * MM * 0.4, az: -90, el: 84, dist: 0.2 - 0.003 * u, sx: 0, sy: 0};
  },
  elec: (u) => ({tx: -0.05, ty: 0.004, tz: 0.012, az: -28 + 2 * u, el: 46, dist: 0.5, sx: 0, sy: 16}),
  outro: (u) => ({tx: 0.0, ty: 0.009, tz: 0.004, az: 36 + 2.0 * u, el: 30, dist: 0.35, sx: 0, sy: 26}),
};
// which camera a state uses
export const camKey = (view, sub, cam) => cam || (sub && sub !== 'tetes' ? sub : view === 'tete' || sub === 'tetes' ? 'tete' : view);
// blend two camera states; distance in log so a dive reads as a zoom
export function blendCam(a, b, k) {
  const o = {};
  for (const key in b) {
    if (key === 'az') o.az = a.az + ((((b.az - a.az + 540) % 360) - 180) * k);
    else if (key === 'dist') o.dist = Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k);
    else o[key] = a[key] + (b[key] - a[key]) * k;
  }
  // targets travel late on a dive in and early on a pull out, so the subject stays framed
  const kk = b.dist < a.dist * 0.2 ? Math.pow(k, 0.55) : a.dist < b.dist * 0.2 ? Math.pow(k, 1.6) : k;
  for (const key of ['tx', 'ty', 'tz']) o[key] = a[key] + (b[key] - a[key]) * kk;
  return o;
}

// ------------------------------------------------------------ what each subsystem opens
export const FOCUS = {
  broche: {cut: 'section', ghost: {platters: 0.35, cover: 0}, cover: 'off'},
  plateaux: {explode: 1, cover: 'off'},
  vcm: {vcmOpen: 1, cover: 'off'},
  tetes: {mag: 1, wedge: 1, cover: 'off'},
  rampe: {cover: 'off'},
  servo: {wedge: 1, cover: 'off'},
  elec: {pcbOpen: 1},
};

// ------------------------------------------------------------ callouts: label boxes and leaders into the drive
export function callouts(st, d, {cam, sub, since, ex = 0, lift = 0, o = 1}) {
  const pr = (p) => st.project(p[0], p[1], p[2]);
  const vis = ss(0.9, 1.6, since) * o;
  const out = [];
  const add = (name, subt, at, label, w = 170, extra = {}) => out.push({name, sub: subt, at: pr(at), label, w, o: vis, ...extra});
  // a callout from the dictionary: [name, sub]
  const addT = ([name, subt], at, label, w, extra) => add(name, subt, at, label, w, extra);
  const hp = headPos(d, d.head, ex, lift);
  const hub = P(SP.x, G.H - 8 + lift, SP.z);
  if (cam === 'trois4' || cam === 'outro') {
    addT(T('cPlatters'), P(SP.x - 33, 13 + lift, SP.z - 33), [330, 742], 170);
    addT(T('cActuator'), P(PV.x + 16, 14, PV.z + 10), [1100, 610], 180, {align: 'right'});
    if (!d.onDisk) addT(T('cRampRest'), P(-29, 14, 18), [380, 280], 170);
    else addT(T('cHeadReading', nf(d.c)), hp, [380, 280], 170, {hot: d.reading});
  } else if (cam === 'rampe') {
    addT(T('cRamp'), P(-35, 16, 22), [360, 250], 210);
    addT(T('cTab'), P(PV.x + 50.5 * Math.cos(armAng(d.phi)), surfY(0) + 0.5 + d.lift, PV.z + 50.5 * Math.sin(armAng(d.phi))), [1080, 230], 190, {align: 'right'});
    addT(T('cEdge'), P(SP.x - 30, 12.6, SP.z + 36.5), [1060, 640], 150, {align: 'right'});
  } else if (cam === 'dessus') {
    if (d.onDisk) addT(T('cTrack', d.reading, nf(d.r, 1), d.spt), hp, [360, 150], 190, {hot: d.reading});
    addT(T('cPivot'), P(PV.x, 16, PV.z), [1110, 160], 160, {align: 'right'});
    addT(T('cWedges'), P(SP.x + 30 * Math.cos(-2.4), 12.6, SP.z - 30 * Math.sin(-2.4)), [360, 700], 190);
  } else if (cam === 'vcm') {
    addT(T('cTopMagnet'), P(PV.x + 22, 15.2 + 20, PV.z + 16), [1110, 170], 190, {align: 'right'});
    const fsgn = d.amps > 0.02 ? T('dirOut') : d.amps < -0.02 ? T('dirIn') : T('dirNone');
    addT(T('cCoil', fsgn, nf(Math.abs(d.amps), 2)), P(PV.x - 16.2 * Math.cos(armAng(d.phi)), 12.8, PV.z - 16.2 * Math.sin(armAng(d.phi))), [1120, 600], 220, {align: 'right'});
    if (d.onDisk) addT(T('cSkew', `${d.skew >= 0 ? '+' : '−'}${nf(Math.abs(d.skew / D2R), 1)}°`), hp, [350, 200], 150);
  } else if (cam === 'headtop' || cam === 'servo') {
    const tg = d.target;
    if (tg && d.onDisk) {
      const a = sectorAng(tg.c, tg.h, tg.s0, tg.spt) + d.th - 0.025;
      const r = rOfCyl(tg.c);
      addT(T('cTarget', tg.s0, tg.n * 8), P(SP.x + r * Math.cos(a), surfY(0), SP.z - r * Math.sin(a)), [1090, 200], 190, {align: 'right', hot: true});
    }
    add(T('cHead'), d.wait ? T('headWaits', nf(d.wait.left * 1e3, 2)) : d.reading ? T('headReads') : '', hp, [380, 640], 150);
  } else if (cam === 'tete') {
    const [x, y, z] = hp;
    addT(T('cSlider'), [x, y + 0.0002, z], [380, 210], 170);
    addT(T('cAir'), [x, y - 0.00017, z], [380, 640], 170);
    addT(T('cWedge'), P(SP.x + d.r * Math.cos(d.psi + 0.03), surfY(d.head), SP.z - d.r * Math.sin(d.psi + 0.03)), [900, 700], 200, {hot: true});
  } else if (cam === 'plateaux') {
    const ys = [190, 290, 520, 620];
    for (let h = 0; h < 4; h++) {
      addT(T('cHeadN', h, h % 2 === 0, h < 2 ? 2 : 1, nf(d.c)), headPos(d, h, ex, lift), [380, ys[h]], 190, {hot: h === d.head && d.reading});
    }
  } else if (cam === 'broche') {
    addT(T('cStator'), P(SP.x - 6, 4.5, SP.z), [380, 640], 210);
    addT(T('cRotor'), P(SP.x - 11.9, 5, SP.z + 2), [380, 250], 160);
    addT(T('cClamp'), P(SP.x - 10, 14.2, SP.z), [1100, 230], 150, {align: 'right'});
  } else if (cam === 'elec') {
    addT(T('cSoc'), P(-W2PCB(-6), 0, 34), [380, 200], 200);
    addT(T('cDram'), P(-W2PCB(14), 0, 34), [380, 650], 140);
    addT(T('cDriver'), P(-W2PCB(-24), 0, 22), [1100, 220], 200, {align: 'right'});
    addT(T('cPreamp'), P(PV.x - 2, 11, PV.z + 8), [1100, 620], 200, {align: 'right'});
  }
  void hub;
  return out;
}
// the PCB swings out about x = −50.8: a board point at x lands at −101.6 − x
const W2PCB = (x) => G.W + x;

// ------------------------------------------------------------ access time of the request in hand
export function accessOf(plan, d) {
  if (!d.target || !['seek', 'wait', 'read', 'switch'].includes(d.k)) return null;
  const segs = plan.act;
  let i = d.segI;
  while (i < segs.length && !(segs[i].k === 'read' && segs[i].t0 === d.target.t0)) i++;
  if (i >= segs.length) return null;
  const rd = segs[i];
  const w = segs[i - 1]?.k === 'wait' ? segs[i - 1] : null;
  const sk = segs[i - (w ? 2 : 1)]?.k === 'seek' ? segs[i - (w ? 2 : 1)] : null;
  return {seek: sk ? sk.t1 - sk.t0 : 0, lat: w ? w.t1 - w.t0 : 0, xfer: rd.t1 - rd.t0, n: rd.n};
}

export const playText = (r) => (r >= 0.999 ? (r < 1.05 ? T('realTime') : `×${nf(r, 1)}`) : T('slowRate', nf(Math.round(1 / r / (r < 0.01 ? 10 : 1)) * (r < 0.01 ? 10 : 1))));
export const playK = (r) => Math.min(1, Math.max(0, 1 - (Math.log10(r) + 4) / 4.4));

// ------------------------------------------------------------ the operator's pointer
const REST = [[820, 470], [700, 430], [900, 520], [760, 380]];
export function makeCursor(ui, script = SCRIPT) {
  const EV = script.filter((e) => e.click).map((e) => ({t: e.t, spot: ui.spots[e.click]}));
  const WP = [[0, 980, 640]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.5, ...e.spot]);
    WP.push([e.t + 0.24, ...e.spot]);
    WP.push([e.t + 1.6, ...REST[i % REST.length]]);
  });
  WP.sort((a, b) => a[0] - b[0]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const k = ss(t0, t1, t);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let rx = 0;
    let ry = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + 0.1) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [rx, ry] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX: rx, ringY: ry};
  };
}

// ------------------------------------------------------------ the film's state at t: camera, options, panels
const CAM_T = 1.7;
const OP_T = 1.3;
// a value that eases toward the target held by the script, from whatever it was at the last change
function easedOp(t, fn, dur = OP_T, delay = 0) {
  const changes = [];
  let prev = fn(0);
  for (const e of SCRIPT) {
    if (e.t <= 0) continue;
    const v = fn(e.t);
    if (v !== prev) changes.push([e.t, v]);
    prev = v;
  }
  let val = fn(0);
  for (const [tc, v] of changes) {
    if (tc > t) break;
    const k = smoother((t - tc - (v > val ? delay : 0)) / dur);
    const from = val;
    val = from + (v - from) * k;
  }
  return val;
}
export const stateAt = (t) => ({view: held(t, 'view').v, sub: held(t, 'sub').v, cover: held(t, 'cover').v, cut: held(t, 'cut').v, cam: held(t, 'cam').v});
export const camNameAt = (t) => {
  const s = stateAt(t);
  return camKey(s.view, s.sub, s.cam);
};
// camera changes: every script event whose camera differs from the one before
const CAMS = (() => {
  const out = [];
  let prev = null;
  for (const e of SCRIPT) {
    const c = camNameAt(e.t);
    if (c !== prev) out.push([e.t, c]);
    prev = c;
  }
  return out;
})();
export function filmCam(t, d, x0) {
  let i = 0;
  while (i < CAMS.length - 1 && CAMS[i + 1][0] <= t) i++;
  const view = (k) => VIEW_FN[CAMS[k][1]](t - CAMS[k][0], d, x0);
  const cur = view(i);
  if (i === 0) return cur;
  const dur = CAMS[i][1] === 'tete' ? 3.2 : CAMS[i - 1][1] === 'tete' ? 2.4 : CAM_T;
  const k = ss(CAMS[i][0], CAMS[i][0] + dur, t);
  if (k >= 1) return cur;
  return blendCam(view(i - 1), cur, k);
}
export function filmOps(t, d) {
  const s = stateAt(t);
  const f = (key) => (tt) => {
    const q = stateAt(tt);
    const fo = FOCUS[q.sub] || {};
    if (key === 'mag') return camKey(q.view, q.sub, q.cam) === 'tete' ? 1 : 0;
    if (key === 'wedge') return camKey(q.view, q.sub, q.cam) === 'tete' || q.sub === 'servo' ? 1 : 0;
    if (key === 'coverK') return (fo.cover ?? q.cover) === 'off' ? 0 : 1;
    if (key === 'baseGhost') return camKey(q.view, q.sub, q.cam) === 'rasante' ? 1 : 0;
    return fo[key] ?? 0;
  };
  const fo = FOCUS[s.sub] || {};
  const coverK = easedOp(t, f('coverK'));
  const cover = coverK < 0.01 ? 'off' : held(t, 'cover').v === 'solid' && !fo.cover ? 'solid' : 'glass';
  return {
    explode: easedOp(t, f('explode'), 1.9, 1.1),
    vcmOpen: easedOp(t, f('vcmOpen')),
    pcbOpen: easedOp(t, f('pcbOpen')),
    mag: easedOp(t, f('mag'), 2.4),
    wedge: easedOp(t, f('wedge')),
    coverK,
    cover,
    cut: fo.cut ?? s.cut,
    ghost: {...(fo.ghost || {}), base: 1 - 0.85 * easedOp(t, f('baseGhost'))},
    blur: (d.spin.w * rateAt(t)) / 60,
    flow: (d.th * d.r) / 2.2,
  };
}

/** draw film frame t and fill the console; extra overrides console fields (the live page's tour) */
export function filmFrame(st, ui, cursorAt, t, extra = {}) {
  const tau = tauAt(t);
  const d = driveAt(PLAN, tau);
  const ops = filmOps(t, d);
  const c = filmCam(t, d, exOf(ops.explode));
  st.setCut(ops.cut);
  st.frame(d, {...c, az: c.az * D2R, el: c.el * D2R}, ops);
  const s = stateAt(t);
  const cam = camNameAt(t);
  const since = t - [...CAMS].reverse().find(([a]) => a <= t)[0];
  const {ex, lift} = exOf(ops.explode);
  const capI = CAPTIONS.filter(([a]) => a <= t).length - 1;
  const capT = CAPTIONS[capI][0];
  const capNext = CAPTIONS[capI + 1]?.[0] ?? DURATION;
  const rate = rateAt(t);
  const data = {
    d,
    view: cam === 'tete' ? 'tete' : s.view,
    sub: s.sub,
    cover: ops.cover === 'off' ? 'off' : held(t, 'cover').v,
    cut: ops.cut,
    powered: t >= B.spinup && t < B.power,
    playText: playText(rate),
    playK: playK(rate),
    clockNote: rate < 0.999 ? T('filmClock', nf(rate * 1e3, rate < 0.01 ? 3 : 1)) : T('filmClock1'),
    caption: CAPTIONS[capI][1],
    capO: ss(capT, capT + 0.45, t) * (1 - ss(capNext - 0.35, capNext, t)),
    nano: ss(B.dive + 1.6, B.dive + 2.4, t) * (1 - ss(B.explode - 0.4, B.explode + 0.2, t)),
    nanoK: ss(B.dive + 2.0, B.dive + 4.2, t),
    access: accessOf(PLAN, d),
    callouts: callouts(st, d, {cam, sub: s.sub, since, ex, lift}),
    cursor: cursorAt(t),
    live: false,
    ...extra,
  };
  ui.update(data);
  // a capture for a cover image: the drive alone
  if (window.__SIM_CONFIG?.clean) ui.root.style.display = 'none';
  return {d, ops, cam: c, camName: cam, state: s, rate};
}

export function makeFilm() {
  return async ({canvas, capture}) => {
    const st = createStage({canvas});
    const resize = () => st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const ui = createConsole(document.getElementById('app'));
    const cursorAt = makeCursor(ui);
    window.HDD = st;
    return {
      resize,
      render(t) {
        filmFrame(st, ui, cursorAt, t);
        return {};
      },
    };
  };
}

export const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: 'hdd', subtitle: ''}, director: {enabled: false}, watermark: ''};
export const run = () => runSim(DEFAULTS, makeFilm());
void SUB_LABEL;
void NCYL;
void OMEGA;
void TAU;
