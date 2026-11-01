// The drive as a page you drive: the film's drive and console in real time. Subsystem buttons open each part, the
// cover / cutaway / view toggles, ALLUMER / COUPER (a real spin-up and an emergency park), a random request (an LBA
// anywhere: seek, rotational wait, transfer), the slow-motion slider, an orbit you drag and a zoom on the wheel.
// Left alone it plays the film as an auto tour with the operator's cursor; a click, drag, wheel or key hands control
// over (the drive carries on from the tour's exact state), 25 s of quiet hands it back.
//
// The live drive is planned the same way as the tour: every command re-plans from a snapshot of the drive at the
// moment it can act (the end of a move in progress), so the panels and the parts still read one function of τ.
import {warmComposer} from 'teardown-kit/warm.js';
import {COVERS, createConsole, CUTS, SUBS, VIEWS} from './console.js';
import {accessOf, blendCam, callouts, camKey, exOf, filmFrame, FOCUS, makeCursor, playK, playText, VIEW_FN} from './film.js';
import {D2R, driveAt, makePlan, NCYL, OMEGA, T_UP, physToCHS, chsToPhys, PHYS_TOTAL, LBA_PER} from './kin.js';
import {createStage} from './stage.js';
import {createChrome} from './chrome.js';
import {LANG, LANGS, nf, T as tr} from './i18n.js';
import {DURATION, PLAN, rateAt, tauAt} from './tour.js';

const W = 1600;
const H = 900;
const IDLE = 25;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const ss = (a, b, t) => {
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
// slow-motion steps: drive seconds per real second
const PLAYS = [1, 1 / 10, 1 / 40, 1 / 200, 1 / 500, 1 / 2000, 1 / 8000];
const nearestPlay = (r) => {
  let best = 0;
  PLAYS.forEach((p, i) => {
    if (Math.abs(Math.log(p) - Math.log(r)) < Math.abs(Math.log(PLAYS[best]) - Math.log(r))) best = i;
  });
  return best;
};

const CSS = `
html,body{background:#ebecee linear-gradient(#f4f4f5,#ebecee 55%,#e2e3e6) fixed;overflow:hidden}
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#gl{touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.tb{pointer-events:auto;cursor:pointer}
.tb:hover{filter:brightness(.95)}
.hit{position:absolute;pointer-events:auto;cursor:pointer}
.hit.ew{cursor:ew-resize}
.tourchip{position:absolute;left:800px;top:96px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:21px;padding:0 11px;border:1px solid #e1e3e6;background:rgba(255,255,255,.95);color:#16181b;font:600 8.8px Inter,sans-serif;letter-spacing:1.3px;white-space:nowrap;cursor:pointer;pointer-events:auto}
.tourchip i{display:block;width:6px;height:6px;border-radius:50%;background:#16181b}
.tourchip.on i{animation:blink 1.2s steps(2) infinite}
@keyframes blink{50%{opacity:.15}}
.turn{position:fixed;left:0;right:0;bottom:18px;text-align:center;font:600 12px/1.4 'JetBrains Mono',monospace;letter-spacing:1px;color:#8b8f95;text-transform:uppercase;display:none}
@media (orientation:portrait) and (max-width:820px){.turn{display:block}}
`;

export function runLive() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = tr('docTitle');
  document.documentElement.lang = LANG;
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const st = createStage({canvas});
  const ui = createConsole(app);
  const tourCursor = makeCursor(ui);

  // ------------------------------------------------------------ quality tiers
  const TIERS = [
    {samples: 8, ao: true, shadow: 4096, pr: 2},
    {samples: 4, ao: false, shadow: 2048, pr: 1.5},
    {samples: 2, ao: false, shadow: 1024, pr: 1},
  ];
  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let tier = light ? 2 : 0;
  let scale = 1;
  // the stage fits between the page's header and footer (chrome.js)
  const chrome = createChrome();
  const fit = () => {
    const {top, bottom} = chrome.heights();
    const h = innerHeight - top - bottom;
    scale = Math.min(innerWidth / W, h / H);
    app.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${top + (h - H * scale) / 2}px) scale(${scale})`;
    st.resize(W, H, clamp((devicePixelRatio || 1) * scale, 0.75, TIERS[tier].pr));
  };
  const applyTier = () => {
    const {pr, ...q} = TIERS[tier];
    st.setQuality(q);
    fit();
  };
  applyTier();
  addEventListener('resize', fit);
  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / scale, (cy - r.top) / scale];
  };
  const tourChip = document.createElement('div');
  tourChip.className = 'tourchip';
  ui.root.appendChild(tourChip);
  const note = document.createElement('div');
  note.className = 'turn';
  note.textContent = tr('turnPhone');
  document.body.appendChild(note);

  // ------------------------------------------------------------ the live drive: a chain of plans in drive time
  let T = 0; // real seconds
  let tau = 0; // drive seconds
  let playI = 3;
  let powered = false;
  let drv = {prev: null, plan: PLAN, switchT: 0};
  const driveNow = (t) => (drv.prev && t < drv.switchT ? drv.prev(t) : driveAt(drv.plan, t));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  /** re-plan: cmds(t0) returns the commands given the moment the drive can act */
  const replan = (spinEv, cmdsAt) => {
    const d0 = driveNow(tau);
    // a move in progress finishes first
    const moving = ['seek', 'load', 'retract', 'switch'].includes(d0.k);
    const t0 = moving ? d0.seg.t1 : tau;
    const d = driveNow(t0);
    const prevFn = ((p) => (t) => (p.prev && t < p.switchT ? p.prev(t) : driveAt(p.plan, t)))(drv);
    const loaded = d.onDisk || ['idle', 'read', 'wait', 'switch'].includes(d.k);
    const ev = [...spinEv];
    if (powered && d.spin.w < OMEGA * 0.999 && !ev.length) ev.push({t: t0, on: true});
    const init = {spin: {t: t0, th: d.th, w: d.spin.w}, act: {t: t0, phi: d.phi, loaded, c: d.seg.c ?? 0, h: d.head}};
    drv = {prev: prevFn, plan: makePlan(ev.map((e) => ({...e, t: Math.max(e.t, t0)})), cmdsAt(t0, d, loaded), init), switchT: t0};
  };
  const powerOn = () => {
    powered = true;
    const d = driveNow(tau);
    const ready = tau + T_UP * (1 - d.spin.w / OMEGA) + 0.1;
    replan([{t: tau, on: true}], (t0, dd, loaded) => (loaded ? [] : [{t: Math.max(ready, t0), load: true, c: 400}]));
  };
  const powerOff = () => {
    powered = false;
    replan([{t: tau, on: false}], (t0) => [{t: t0, off: true}]);
  };
  const randomRead = () => {
    if (!powered) return powerOn();
    const p = Math.floor(rnd() * (PHYS_TOTAL - 200));
    const d = driveNow(tau);
    const ready = d.spin.w < OMEGA * 0.999 ? tau + T_UP * (1 - d.spin.w / OMEGA) + 0.1 : tau;
    replan([], (t0, dd, loaded) => [...(loaded ? [] : [{t: Math.max(ready, t0), load: true, c: physToCHS(p).c}]), {t: Math.max(ready, t0) + 1e-6, read: {p, n: 64}}]);
  };
  void chsToPhys;
  void NCYL;
  void LBA_PER;

  // ------------------------------------------------------------ page state
  let view = 'trois4';
  let sub = null;
  let cover = 'glass';
  let cut = 'solid';
  let viewAt = 0;
  const op = {explode: 0, vcmOpen: 0, pcbOpen: 0, mag: 0, wedge: 0, coverK: 1, baseGhost: 0};
  const off = {az: 0, el: 0, k: 1};
  let cam = null;
  let ring = {t: -9, x: 0, y: 0};
  let hidden = false;
  const pulse = (k) => (ring = {t: T, x: ui.spots[k][0], y: ui.spots[k][1]});

  // ------------------------------------------------------------ the tour
  const AP = {on: true, t0: 0, loop: 0};
  let lastInput = 0;
  let tourOut = null;
  const startTour = () => {
    AP.on = true;
    AP.t0 = T;
    AP.loop = 0;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const takeOver = () => {
    lastInput = T;
    if (!AP.on) return;
    AP.on = false;
    const cyc = (T - AP.t0) % DURATION;
    // carry on from the tour: its drive, its clock, its views and openings
    tau = tauAt(cyc);
    drv = {prev: null, plan: PLAN, switchT: 0};
    powered = cyc >= 2.0 && cyc < 25.2;
    playI = nearestPlay(rateAt(cyc));
    // spun up, the drive is shown slowed down so a seek can be followed
    if (cyc > 6 && cyc < 25.2) playI = Math.max(playI, 3);
    if (tourOut) {
      view = tourOut.state.view === 'tete' || tourOut.camName === 'tete' ? 'tete' : tourOut.state.view;
      sub = tourOut.state.sub;
      cover = tourOut.ops.cover === 'off' ? 'off' : tourOut.state.cover;
      cut = tourOut.ops.cut;
      Object.assign(op, {explode: tourOut.ops.explode, vcmOpen: tourOut.ops.vcmOpen, pcbOpen: tourOut.ops.pcbOpen, mag: tourOut.ops.mag, wedge: tourOut.ops.wedge, coverK: tourOut.ops.coverK});
      cam = {...tourOut.cam};
    }
    viewAt = T - 3;
    // the tour's plan stays valid: commands from now re-plan from it
  };
  tourChip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (AP.on) takeOver();
    else startTour();
  });
  addEventListener('pointerdown', (e) => {
    if (e.target !== tourChip) takeOver();
  });

  // ------------------------------------------------------------ controls
  const setView = (v) => {
    view = v;
    if (v === 'tete') sub = sub === 'plateaux' ? null : sub;
    viewAt = T;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const on = (k, fn) =>
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulse(k);
      fn();
    });
  for (const k of VIEWS)
    on('view:' + k, () => {
      sub = null;
      setView(k);
      if (k === 'tete' && driveNow(tau).onDisk) playI = Math.max(playI, 5);
    });
  for (const k of CUTS) on('cut:' + k, () => (cut = k));
  for (const k of COVERS) on('cover:' + k, () => (cover = k));
  for (const k of SUBS)
    on('sub:' + k, () => {
      sub = sub === k ? null : k;
      if (k === 'tetes') view = sub ? 'tete' : 'trois4';
      // the parts that only read in slow motion slow the drive down
      // ... once the heads fly: before that, slowing down would only stall the spin-up
      const flying = driveNow(tau).onDisk;
      if (flying && (sub === 'tetes' || sub === 'servo')) playI = Math.max(playI, 5);
      if (flying && sub === 'vcm') playI = Math.max(playI, 3);
      if (sub && FOCUS[sub]?.cover) cover = FOCUS[sub].cover;
      viewAt = T;
      Object.assign(off, {az: 0, el: 0, k: 1});
    });
  on('power', () => (powered ? powerOff() : powerOn()));
  // languages, in the header: on the site a cookie (the Worker reads it for /) and the language's own page; from a
  // file, ?lang=
  for (const a of chrome.langLinks)
    a.addEventListener('click', (e) => {
      const k = a.dataset.lang;
      e.preventDefault();
      if (k === LANG) return;
      if (location.protocol === 'file:') {
        const u = new URL(location.href);
        u.searchParams.set('lang', k);
        location.href = u.href;
      } else {
        document.cookie = `lang=${k}; path=/; max-age=31536000; samesite=lax`;
        location.href = `/${k}/`;
      }
    });
  on('req', () => randomRead());
  {
    const [x0, y] = ui.playKnob(0);
    const [x1] = ui.playKnob(1);
    const dv = document.createElement('div');
    dv.className = 'hit ew';
    Object.assign(dv.style, {left: `${x0 - 8}px`, top: `${y - 11}px`, width: `${x1 - x0 + 16}px`, height: '22px'});
    const move = (e) => {
      const [x] = toStage(e.clientX, e.clientY);
      const k = clamp((x - x0) / (x1 - x0), 0, 1);
      let best = 0;
      PLAYS.forEach((p, i) => {
        if (Math.abs(playK(p) - k) < Math.abs(playK(PLAYS[best]) - k)) best = i;
      });
      playI = best;
      lastInput = T;
    };
    dv.addEventListener('pointerdown', (e) => {
      takeOver();
      dv.setPointerCapture(e.pointerId);
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      move(e);
    });
    ui.root.appendChild(dv);
  }
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    takeOver();
    const v = {1: 'dessus', 2: 'trois4', 3: 'rasante', 4: 'tete'}[key];
    if (v) {
      sub = null;
      setView(v);
    } else if (key === 'h') hidden = !hidden;
    else if (key === 'p') powered ? powerOff() : powerOn();
    else if (key === 'r') randomRead();
    else if (key === 'arrowleft') playI = Math.max(0, playI - 1);
    else if (key === 'arrowright') playI = Math.min(PLAYS.length - 1, playI + 1);
    else return;
    e.preventDefault();
  });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = {x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    off.az += ((e.clientX - drag.x) / scale) * 0.3;
    off.el = clamp(off.el + ((e.clientY - drag.y) / scale) * 0.2, -30, 60);
    drag = {x: e.clientX, y: e.clientY};
    lastInput = T;
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      takeOver();
      off.k = clamp(off.k * Math.exp(e.deltaY * 0.0012), 0.3, 2.5);
    },
    {passive: false},
  );

  // ------------------------------------------------------------ the frame
  startTour();
  let last = performance.now();
  const perf = {n: 0, sum: 0, slow: 0, age: 0};
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    T += dt;
    if (tier < TIERS.length - 1) {
      perf.age += dt;
      if (perf.age > 0.6) {
        perf.sum += dt;
        perf.n++;
        if (perf.sum >= 0.5 && perf.n >= 6) {
          perf.slow = perf.sum / perf.n > 0.022 ? perf.slow + 1 : 0;
          perf.sum = 0;
          perf.n = 0;
          if (perf.slow >= (perf.age < 6 ? 1 : 2)) {
            tier++;
            applyTier();
            Object.assign(perf, {age: 0, slow: 0});
          }
        }
      }
    }
    ui.root.style.display = hidden ? 'none' : '';

    if (AP.on) {
      const c = T - AP.t0;
      const loop = Math.floor(c / DURATION);
      const cyc = c - loop * DURATION;
      AP.loop = loop;
      let cursor = tourCursor(cyc);
      if (loop > 0 && cyc < 0.8) {
        const end = tourCursor(DURATION - 0.01);
        const k = ss(0, 0.8, cyc);
        cursor = {...cursor, x: end.x + (cursor.x - end.x) * k, y: end.y + (cursor.y - end.y) * k};
      }
      tourOut = filmFrame(st, ui, () => cursor, cyc);
    } else {
      if (T - lastInput > IDLE) startTour();
      const rate = PLAYS[playI];
      tau += dt * rate;
      if (drv.prev && tau > drv.switchT) drv.prev = null;
      const d = driveNow(tau);
      // openings ease toward the page's state
      const fo = FOCUS[sub] || {};
      const camName = camKey(view, sub, null);
      const tgtOp = {
        explode: fo.explode ?? 0,
        vcmOpen: fo.vcmOpen ?? 0,
        pcbOpen: fo.pcbOpen ?? 0,
        mag: camName === 'tete' ? 1 : 0,
        wedge: camName === 'tete' || sub === 'servo' ? 1 : 0,
        coverK: cover === 'off' ? 0 : 1,
        baseGhost: camName === 'rasante' ? 1 : 0,
      };
      const ke = 1 - Math.exp(-dt / 0.45);
      for (const k in op) op[k] += (tgtOp[k] - op[k]) * ke;
      const x0 = exOf(op.explode);
      const since = T - viewAt;
      const tgt = VIEW_FN[camName](since, d, x0);
      tgt.az += off.az;
      tgt.el = clamp(tgt.el + off.el, -20, 89);
      tgt.dist *= off.k;
      if (!cam) cam = {...tgt};
      // a dive or a pull-out glides in log distance; everything else eases
      const kc = 1 - Math.exp(-dt / 0.5);
      const next = blendCam(cam, tgt, kc);
      next.az = cam.az + wrap(tgt.az - cam.az) * kc;
      cam = next;
      const ops = {
        explode: op.explode,
        vcmOpen: op.vcmOpen,
        pcbOpen: op.pcbOpen,
        mag: op.mag,
        wedge: op.wedge,
        coverK: op.coverK,
        cover: op.coverK < 0.01 ? 'off' : cover === 'solid' ? 'solid' : 'glass',
        cut: fo.cut ?? cut,
        ghost: {...(fo.ghost || {}), base: 1 - 0.85 * op.baseGhost},
        blur: (d.spin.w * rate) / 60,
        flow: (d.th * d.r) / 2.2,
      };
      st.setCut(ops.cut);
      st.frame(d, {...cam, az: cam.az * D2R, el: cam.el * D2R}, ops);
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      ui.update({
        d,
        view: camName === 'tete' ? 'tete' : view,
        sub,
        cover,
        cut: ops.cut,
        powered,
        playText: playText(rate),
        playK: playK(rate),
        clockNote: rate < 0.999 ? tr('liveClock', nf(rate * 1e3, rate * 1e3 < 1 ? 3 : 0)) : tr('liveClock1'),
        caption: '',
        capO: 0,
        nano: op.mag > 0.6 ? (op.mag - 0.6) / 0.4 : 0,
        nanoK: 1,
        access: accessOf(drv.plan, d.segI !== undefined && (!drv.prev || tau >= drv.switchT) ? d : {...d, target: null}),
        callouts: callouts(st, d, {cam: camName, sub, since, ex: x0.ex, lift: x0.lift}),
        cursor: {x: -99, y: -99, press: false, ring: rk, ringX: ring.x, ringY: ring.y},
        live: true,
      });
    }
    if (tourChip.classList.contains('on') !== AP.on || !tourChip.firstChild) {
      tourChip.classList.toggle('on', AP.on);
      tourChip.innerHTML = AP.on ? `<i></i>${tr('tourOn')}` : tr('tourOff');
    }
    if (!window.SIM_SHOWN) {
      window.SIM_SHOWN = true;
      dispatchEvent(new Event('simframe'));
    }
    requestAnimationFrame(frame);
  };
  warmComposer(st.renderer, st.composer, st.scene, st.camera).then(() => requestAnimationFrame(frame));
  window.LIVE = {st, startTour, takeOver, randomRead, powerOn, powerOff, get tier() {
    return tier;
  }, get tau() {
    return tau;
  }, get T() {
    return T;
  }, setView, get state() {
    return {view, sub, cover, cut, powered, playI};
  }};
}
