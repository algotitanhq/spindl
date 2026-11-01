// The 3.5" 7200 rpm drive as numbers: the enclosure, the platter stack, the rotary actuator, zoned recording, the
// seek profile and a planner that turns a queue of requests (LBA, count) into actuator segments in drive time.
// One input: the drive time τ (seconds). Every pose and every readout is a function of it. No three.js in here.
//
// Drive space is millimetres: y up from the bottom of the PCB, x across the 101.6 mm width, z along the 147 mm length.
// World polar angle ψ = atan2(−z, x) around the spindle: counter-clockwise seen from above, the way the platters turn.

const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mod = (a, m) => ((a % m) + m) % m;

// ------------------------------------------------------------ enclosure and stack (SFF-8301 3.5" form factor)
export const G = {
  W: 101.6, L: 147, H: 26.1,
  pcbT: 1.6, floorT: 3.0, coverT: 1.0,
  platR: 47.5, holeR: 12.5, platT: 1.27, spacerT: 3.0,
  rIn: 20, rOut: 46,
  hubY: 7.0, // top of the hub flange: the lower platter sits on it
};
G.floorY = G.pcbT + G.floorT; // 4.6, the inside floor
G.coverY = G.H - G.coverT; // 25.1, the underside of the cover
/** platter k (0 lower, 1 upper): its bottom y; explode spreads the stack by `ex` mm per platter */
export const platY = (k, ex = 0) => G.hubY + k * (G.platT + G.spacerT + 2 * ex);
// four surfaces, LBA order: head 0 is the top of the upper platter (the one you see), then its underside, then the
// lower platter's top and underside. up: the surface faces up (the head reads from above).
export const SURF = [
  {head: 0, plat: 1, up: true},
  {head: 1, plat: 1, up: false},
  {head: 2, plat: 0, up: true},
  {head: 3, plat: 0, up: false},
];
export const surfY = (h, ex = 0) => {
  const s = SURF[h];
  return platY(s.plat, ex) + (s.up ? G.platT : 0);
};

// ------------------------------------------------------------ spindle
export const RPM = 7200;
export const REV_S = RPM / 60; // 120
export const OMEGA = TAU * REV_S; // 753.98 rad/s
export const T_REV = 1 / REV_S; // 8.333 ms
export const LAT_AVG = T_REV / 2; // 4.167 ms
export const T_UP = 3.8; // spin-up, s
export const T_DOWN = 7.0; // coast to rest after power loss, s
/** linear speed under the head, m/s: v = 2π r · 120 */
export const vLin = (rmm) => TAU * rmm * 1e-3 * REV_S;

// ------------------------------------------------------------ actuator geometry
export const SP = {x: 0, z: -22}; // spindle axis
export const PV = {x: 20, z: 31.4}; // actuator pivot
export const D = Math.hypot(PV.x - SP.x, PV.z - SP.z); // 57.1
export const L = 48; // pivot → read element
export const L_TAB = 50.5; // pivot → lift-tab tip
const A0 = Math.atan2(SP.z - PV.z, SP.x - PV.x); // pivot → spindle direction in the x-z plane
/** actuator angle φ (rad, angle at the pivot between the spindle and the head) for a head radius r (mm) */
export const phiOfR = (r, l = L) => Math.acos(clamp((D * D + l * l - r * r) / (2 * D * l), -1, 1));
export const rOfPhi = (phi, l = L) => Math.sqrt(D * D + l * l - 2 * D * l * Math.cos(phi));
/** the arm's direction in the x-z plane (angle of atan2(z, x)) */
export const armAng = (phi) => A0 - phi;
export const headXZ = (phi, l = L) => {
  const a = armAng(phi);
  return {x: PV.x + l * Math.cos(a), z: PV.z + l * Math.sin(a)};
};
/** skew: angle between the slider's axis and the track tangent, sin β = (r² + L² − D²) / (2 L r) */
export const skewOf = (r) => Math.asin(clamp((r * r + L * L - D * D) / (2 * L * r), -1, 1));
/** world polar angle of the head around the spindle */
export const psiOf = (phi) => {
  const h = headXZ(phi);
  return Math.atan2(-(h.z - SP.z), h.x - SP.x);
};
export const PHI_ID = phiOfR(G.rIn);
export const PHI_OD = phiOfR(G.rOut);
export const STROKE = PHI_OD - PHI_ID; // ≈ 31.6°
// the ramp, in actuator angle: the lift tab meets it just over the platter edge, climbs 4°, rests in the detent
export const PHI_R0 = phiOfR(46.9, L_TAB);
export const PHI_R1 = PHI_R0 + 4 * D2R;
export const PHI_PARK = PHI_R1 + 3 * D2R;
export const PHI_STOP_IN = PHI_ID - 1.2 * D2R; // inner crash stop
export const LIFT = 0.7; // mm the suspension tip rises on the ramp
/** how far the slider is held off its surface by the ramp at actuator angle φ (mm) */
export const liftOf = (phi) => {
  if (phi <= PHI_R0) return 0;
  const u = clamp((phi - PHI_R0) / (PHI_R1 - PHI_R0), 0, 1);
  const k = u * u * (3 - 2 * u);
  // the detent: a shallow dip 0.06 mm deep centred on the park angle
  const dd = (phi - PHI_PARK) / (1.2 * D2R);
  return LIFT * k - 0.06 * Math.exp(-dd * dd) * (u >= 1 ? 1 : 0);
};
export const FLY_NM = 3; // flying height, nm

// ------------------------------------------------------------ zoned bit recording
export const NZ = 16;
export const PITCH_NM = 80; // track pitch
export const CYL_Z = Math.floor((G.rOut - G.rIn) * 1e6 / PITCH_NM / NZ); // 20312 cylinders per zone
export const NCYL = CYL_Z * NZ; // 324992
export const PITCH = (G.rOut - G.rIn) / NCYL; // mm
export const SPT_OD = 508;
export const SPT_ID = 244;
export const SECTOR = 4096; // bytes, 4K physical (512e: 8 LBAs each)
export const LBA_PER = 8;
export const NHEAD = 4;
export const sptOf = (z) => Math.round(SPT_OD - ((SPT_OD - SPT_ID) * z) / (NZ - 1));
export const zoneOfCyl = (c) => clamp(Math.floor(c / CYL_Z), 0, NZ - 1);
export const rOfCyl = (c) => G.rOut - (c + 0.5) * PITCH;
export const cylOfR = (r) => clamp(Math.floor((G.rOut - r) / PITCH), 0, NCYL - 1);
/** media rate of a zone in MB/s (10^6 bytes): spt × 4096 × 120 */
export const rateOf = (z) => (sptOf(z) * SECTOR * REV_S) / 1e6;
const ZBASE = [];
{
  let acc = 0;
  for (let z = 0; z < NZ; z++) {
    ZBASE.push(acc);
    acc += CYL_Z * NHEAD * sptOf(z);
  }
  ZBASE.push(acc);
}
export const PHYS_TOTAL = ZBASE[NZ];
export const CAPACITY = PHYS_TOTAL * SECTOR; // ≈ 2.0e12 bytes
export const LBA_TOTAL = PHYS_TOTAL * LBA_PER;
/** physical sector number → cylinder, head, sector */
export const physToCHS = (p) => {
  let z = 0;
  while (z < NZ - 1 && ZBASE[z + 1] <= p) z++;
  const spt = sptOf(z);
  const rem = p - ZBASE[z];
  const c = z * CYL_Z + Math.floor(rem / (spt * NHEAD));
  const r2 = rem % (spt * NHEAD);
  return {c, h: Math.floor(r2 / spt), s: r2 % spt, z, spt};
};
export const chsToPhys = (c, h, s) => {
  const z = zoneOfCyl(c);
  const spt = sptOf(z);
  return ZBASE[z] + (c - z * CYL_Z) * NHEAD * spt + h * spt + s;
};
// track skew: sector 0 of each next track sits 1/8 of a turn later, so a head switch or a one-track seek lands just
// before it. α_s, the platter-frame angle where sector s starts; sectors run clockwise so they pass in order.
export const SKEW_REV = 0.125;
export const sectorAng = (c, h, s, spt) => mod(-(c * NHEAD + h) * SKEW_REV * TAU - (TAU * s) / spt, TAU);
export const SERVO_WEDGES = 420; // per revolution: 420 × 120 = 50.4 kHz position samples

// ------------------------------------------------------------ seek: a smoothed bang-bang (cycloidal) move, then settle
export const A_MAX = 20016; // rad/s², peak angular acceleration (≈ 98 g at the head)
export const SETTLE = 0.9e-3; // s
export const J = 3.0e-6; // kg·m², head stack inertia about the pivot
export const KT = 0.062; // N·m/A, VCM torque constant
export const HEAD_SWITCH = 0.8e-3;
export const LOAD_T = 0.2; // controlled ramp unload / load
export const RETRACT_T = 0.04; // emergency retract on back-EMF
/** move time for an actuator swing dphi (s) */
export const moveTime = (dphi) => Math.sqrt((TAU * Math.abs(dphi)) / A_MAX);
export const seekTimeCyl = (c0, c1) => moveTime(phiOfR(rOfCyl(c1)) - phiOfR(rOfCyl(c0))) + SETTLE;
// x(u) = u − sin(2πu)/2π; v = (1 − cos 2πu)/T; a = 2π sin(2πu)/T²
const cyc = (u, T) => {
  const k = clamp(u, 0, 1);
  return {x: k - Math.sin(TAU * k) / TAU, v: (1 - Math.cos(TAU * k)) / T, a: (TAU * Math.sin(TAU * k)) / (T * T)};
};
// settle ringing: a few tracks of overshoot decaying in 0.25 ms
const ring = (t) => {
  const amp = (2.5 * PITCH) / L;
  const w = TAU / 0.32e-3;
  const e = Math.exp(-t / 0.22e-3);
  return {x: amp * e * Math.sin(w * t), a: amp * e * -w * w * Math.sin(w * t)};
};

// ------------------------------------------------------------ the spindle in drive time
/** events: [{t, on: true|false}]; returns ω(τ), θ(τ) in closed form between events */
export function spinPlan(events, init = {t: 0, th: 0, w: 0}) {
  const segs = [];
  let cur = {k: init.w > 0.5 * OMEGA ? 'run' : 'stop', t: init.t, th: init.th, w: init.w};
  if (init.w > 0 && init.w < OMEGA * 0.999) cur.k = 'down';
  if (cur.k === 'down') cur.w0 = init.w;
  segs.push(cur);
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const s = spinAt(segs, e.t);
    if (e.on && (s.k === 'stop' || s.k === 'down')) segs.push({k: 'up', t: e.t, th: s.th, w0: s.w, T: T_UP * (1 - s.w / OMEGA)});
    else if (!e.on && (s.k === 'run' || s.k === 'up')) segs.push({k: 'down', t: e.t, th: s.th, w0: s.w});
  }
  return segs;
}
/** spindle state at τ: k (stop | up | run | down), w (rad/s), th (rad, total) */
export function spinAt(segs, t) {
  let i = segs.length - 1;
  while (i > 0 && segs[i].t > t) i--;
  const s = segs[i];
  const dt = Math.max(0, t - s.t);
  if (s.k === 'stop') return {k: 'stop', w: 0, th: s.th};
  if (s.k === 'run') return {k: 'run', w: OMEGA, th: s.th + OMEGA * dt};
  if (s.k === 'up') {
    // torque-limited then tapering: ω = ω0 + (Ω − ω0)(1 − (1 − u)²)
    const T = Math.max(1e-3, s.T);
    const u = Math.min(1, dt / T);
    const S = u - (1 - Math.pow(1 - u, 3)) / 3;
    const th = s.th + s.w0 * Math.min(dt, T) + (OMEGA - s.w0) * T * S;
    if (dt >= T) return {k: 'run', w: OMEGA, th: th + OMEGA * (dt - T)};
    return {k: 'up', w: s.w0 + (OMEGA - s.w0) * (1 - (1 - u) * (1 - u)), th};
  }
  // down: air drag and the motor's dynamic brake, ω = ω0 (1 − u)², to rest at T_DOWN·(ω0/Ω)
  const T = T_DOWN * Math.sqrt(s.w0 / OMEGA);
  const u = Math.min(1, dt / T);
  const th = s.th + (s.w0 * T * (1 - Math.pow(1 - u, 3))) / 3;
  return {k: u >= 1 ? 'stop' : 'down', w: s.w0 * (1 - u) * (1 - u), th};
}

// ------------------------------------------------------------ the planner
// cmds: {t, load: true} | {t, read: {p, n}} (physical sector p, n sectors) | {t, read: {c, h, full: true}} (one whole
// track from whichever sector arrives first: a zero-latency read) | {t, off: true} (power loss: emergency retract).
// Segments: {k, t0, t1, phi0, phi1, c, h, ...}; k ∈ park, load, idle, seek, switch, wait, read, retract.
export function actPlan(spin, cmds, init = {t: 0, phi: PHI_PARK, loaded: false, c: 0, h: 0}) {
  const segs = [];
  let t = init.t;
  let phi = init.phi;
  let loaded = init.loaded;
  let c = init.c;
  let h = init.h;
  const push = (s) => {
    segs.push(s);
    t = s.t1;
    phi = s.phi1;
  };
  const thAt = (tt) => spinAt(spin, tt).th;
  const psiNow = () => psiOf(phi);
  const arrive = (cc, hh, s, spt, from) => {
    // the first τ ≥ from where sector s's start passes under the head: θ(τ) ≡ ψ − α_s (mod 2π)
    const want = mod(psiNow() - sectorAng(cc, hh, s, spt), TAU);
    const now = mod(thAt(from), TAU);
    return from + mod(want - now, TAU) / OMEGA;
  };
  const goTo = (cc, hh, reason) => {
    if (cc !== c || !loaded) {
      const p1 = phiOfR(rOfCyl(cc));
      const T = moveTime(p1 - phi);
      push({k: 'seek', t0: t, t1: t + T + SETTLE, T, phi0: phi, phi1: p1, c0: c, c: cc, h: hh, reason});
      c = cc;
      h = hh;
    } else if (hh !== h) {
      push({k: 'switch', t0: t, t1: t + HEAD_SWITCH, phi0: phi, phi1: phi, c, h: hh, h0: h});
      h = hh;
    }
  };
  const list = [...cmds].sort((a, b) => a.t - b.t);
  const off = list.find((e) => e.off);
  const offT = off ? off.t : Infinity;
  for (const e of list) {
    if (e.off || t >= offT) break;
    if (e.t > t) push({k: loaded ? 'idle' : 'park', t0: t, t1: e.t, phi0: phi, phi1: phi, c, h});
    if (e.load) {
      if (loaded) continue;
      const tgt = e.c ?? c;
      const p1 = phiOfR(rOfCyl(tgt));
      push({k: 'load', t0: t, t1: t + LOAD_T, phi0: phi, phi1: p1, c: tgt, h});
      c = tgt;
      loaded = true;
      continue;
    }
    if (e.read && loaded) {
      const rq = e.read;
      if (rq.full) {
        goTo(rq.c, rq.h, 'read');
        const z = zoneOfCyl(rq.c);
        const spt = sptOf(z);
        // the next sector boundary to pass under the head
        const k = mod(thAt(t) - psiNow() + sectorAng(c, h, 0, spt), TAU);
        const s0 = (Math.floor((k / TAU) * spt) + 1) % spt;
        const ta = arrive(c, h, s0, spt, t);
        if (ta > t) push({k: 'wait', t0: t, t1: ta, phi0: phi, phi1: phi, c, h, s: s0, spt, zero: true});
        push({k: 'read', t0: t, t1: t + T_REV, phi0: phi, phi1: phi, c, h, s0, n: spt, spt, p0: chsToPhys(c, h, s0), wrap: true});
        continue;
      }
      let p = rq.p;
      let left = rq.n;
      let first = true;
      while (left > 0 && t < offT) {
        const a = physToCHS(p);
        goTo(a.c, a.h, first ? 'read' : 'next');
        const ta = arrive(a.c, a.h, a.s, a.spt, t);
        if (ta > t + 1e-9) push({k: 'wait', t0: t, t1: ta, phi0: phi, phi1: phi, c, h, s: a.s, spt: a.spt, lat: first});
        const n = Math.min(left, a.spt - a.s);
        push({k: 'read', t0: t, t1: t + (n / a.spt) * T_REV, phi0: phi, phi1: phi, c, h, s0: a.s, n, spt: a.spt, p0: p});
        p += n;
        left -= n;
        first = false;
      }
    }
  }
  if (off) {
    // cut whatever runs at the power loss and swing back onto the ramp on the spindle's back-EMF
    while (segs.length && segs[segs.length - 1].t0 >= offT) segs.pop();
    let at = {phi, v: 0};
    if (segs.length && segs[segs.length - 1].t1 > offT) {
      const last = segs[segs.length - 1];
      at = segEval(last, offT);
      last.t1 = offT;
      last.cut = true;
      last.phi1 = at.phi;
    }
    t = Math.max(t, offT);
    if (t > offT && segs.length) t = segs[segs.length - 1].t1;
    phi = at.phi;
    if (loaded || phi < PHI_PARK - 1e-4) {
      if (t < offT) push({k: 'idle', t0: t, t1: offT, phi0: phi, phi1: phi, c, h});
      push({k: 'retract', t0: offT, t1: offT + RETRACT_T, phi0: phi, phi1: PHI_PARK, c, h});
      loaded = false;
    }
  }
  push({k: 'park', t0: t, t1: Infinity, phi0: phi, phi1: phi, c, h, end: true});
  if (loaded) segs[segs.length - 1].k = 'idle';
  return segs;
}

/** actuator angle, speed and acceleration inside one segment */
export function segEval(s, t) {
  const dt = t - s.t0;
  if (s.k === 'seek') {
    const d = s.phi1 - s.phi0;
    if (dt < s.T) {
      const q = cyc(dt / s.T, s.T);
      return {phi: s.phi0 + d * q.x, v: d * q.v, a: d * q.a};
    }
    const r = ring(dt - s.T);
    const sg = Math.sign(d) || 1;
    return {phi: s.phi1 + sg * r.x, v: 0, a: sg * r.a};
  }
  if (s.k === 'load' || s.k === 'retract') {
    const T = s.t1 - s.t0;
    const q = cyc(dt / T, T);
    const d = s.phi1 - s.phi0;
    return {phi: s.phi0 + d * q.x, v: d * q.v, a: d * q.a};
  }
  return {phi: s.phi0, v: 0, a: 0};
}
export const segAt = (segs, t) => {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (segs[m].t0 <= t) lo = m;
    else hi = m - 1;
  }
  return lo;
};

// ------------------------------------------------------------ the drive's state at τ: every panel reads this
export function driveAt(plan, t) {
  const sp = spinAt(plan.spin, t);
  const i = segAt(plan.act, t);
  const s = plan.act[i];
  const m = segEval(s, Math.min(t, s.t1));
  const phi = m.phi;
  const r = rOfPhi(phi);
  const onDisk = phi < PHI_R0;
  const c = onDisk ? cylOfR(r) : -1;
  const z = onDisk ? zoneOfCyl(c) : -1;
  const spt = z >= 0 ? sptOf(z) : 0;
  const head = s.h ?? 0;
  const psi = psiOf(phi);
  const thm = mod(sp.th, TAU);
  // platter-frame angle under the head, and the sector it falls in on the track the planner is on
  const beta = mod(psi - thm, TAU);
  const tc = s.c ?? c;
  let sector = -1;
  if (onDisk && spt) sector = Math.floor((mod(sectorAng(tc, head, 0, spt) - beta, TAU) / TAU) * spt) % spt;
  // the last seek: its length and duration; the current wait: total latency and what's left
  let seek = null;
  for (let k = i; k >= 0; k--) {
    if (plan.act[k].k === 'seek') {
      const q = plan.act[k];
      seek = {t0: q.t0, T: q.T, t1: q.t1, dur: q.t1 - q.t0, dc: Math.abs(q.c - (q.c0 ?? q.c)), phi0: q.phi0, phi1: q.phi1, live: t < q.t1, i: k};
      break;
    }
    if (plan.act[k].k === 'load') break;
  }
  let wait = null;
  if (s.k === 'wait') wait = {total: s.t1 - s.t0, left: s.t1 - t, s: s.s, spt: s.spt, c: s.c, h: s.h, zero: !!s.zero};
  // the request the drive is serving: the read ahead (or running), for the target sector's accent
  let target = null;
  for (let k = i; k < plan.act.length && k < i + 4; k++) {
    const q = plan.act[k];
    if (q.k === 'read') {
      target = {c: q.c, h: q.h, s0: q.s0, n: q.n, spt: q.spt, p0: q.p0, t0: q.t0, t1: q.t1, wrap: !!q.wrap};
      break;
    }
    if (q.k === 'park' || q.k === 'retract' || q.k === 'idle') break;
  }
  const reading = s.k === 'read' && t < s.t1;
  let lba = -1;
  let done = 0;
  if (reading) {
    done = Math.min(s.n, Math.floor(((t - s.t0) / (s.t1 - s.t0)) * s.n));
    const sec = (s.s0 + done) % s.spt;
    lba = chsToPhys(s.c, s.h, sec) * LBA_PER;
  } else if (target) lba = target.p0 * LBA_PER;
  return {
    t,
    spin: sp,
    rpm: (sp.w / TAU) * 60,
    th: sp.th,
    phi,
    phiV: m.v,
    phiA: m.a,
    amps: (J * m.a) / KT,
    torque: J * m.a,
    headV: m.v * L * 1e-3, // m/s across the tracks
    seg: s,
    segI: i,
    k: s.k,
    r,
    onDisk,
    lift: liftOf(phi),
    c,
    z,
    spt,
    head,
    psi,
    beta,
    sector,
    v: vLin(r) * (sp.w / OMEGA),
    skew: skewOf(Math.max(r, 1)),
    rate: reading ? rateOf(s.z ?? zoneOfCyl(s.c)) : 0,
    zoneRate: z >= 0 ? rateOf(z) : 0,
    reading,
    done,
    lba,
    seek,
    wait,
    target,
  };
}

/** a snapshot to restart planning from (the live page hands over from the tour) */
export function snapshot(plan, t) {
  const d = driveAt(plan, t);
  return {
    spin: {t, th: d.th, w: d.spin.w},
    act: {t, phi: d.k === 'seek' ? d.seg.phi1 : d.phi, loaded: d.k !== 'park' && d.k !== 'retract' && d.k !== 'load', c: d.seg.c ?? 0, h: d.head},
  };
}
export const makePlan = (spinEvents, cmds, init) => {
  const spin = spinPlan(spinEvents, init?.spin);
  return {spin, act: actPlan(spin, cmds, init?.act)};
};
