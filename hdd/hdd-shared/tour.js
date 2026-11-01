// The tour's clock: film time t → drive time τ. The drive lives in milliseconds, the film in seconds, so the film
// runs the drive at a playback rate that changes with the story (1× for the spin-up, 1/400 to watch a track go by,
// 1/8000 for the dive) and τ is that rate integrated once at load. The request queue is planned in drive time from
// the beats, so the motion, the panels and the score all read one plan.
import {makePlan, driveAt, chsToPhys, sectorAng, psiOf, phiOfR, rOfCyl, sptOf, zoneOfCyl, NCYL, spinAt, T_REV} from './kin.js';

const TAU = Math.PI * 2;
const mod = (a, m) => ((a % m) + m) % m;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// the beats of the tour (film seconds)
export const B = {stop: 0, spinup: 2.0, load: 6.0, read: 8.0, seek: 11.5, wait: 14.3, dive: 15.9, explode: 20.6, power: 25.2, end: 31};
export const DURATION = B.end;

// playback rate keys [film t, drive seconds per film second], log-interpolated with a smoother step between keys
export const RATE = [
  [0, 1],
  [5.6, 1],
  [6.05, 1 / 8],
  [7.7, 1 / 8],
  [8.25, 1 / 400],
  [11.3, 1 / 400],
  [11.55, 1 / 200],
  [14.15, 1 / 200],
  [14.5, 1 / 500],
  [15.75, 1 / 500],
  [16.6, 1 / 8000],
  [B.power - 0.25, 1 / 8000],
  [B.power + 0.15, 1 / 40],
  [B.power + 1.6, 1 / 40],
  [B.power + 3.0, 2.4],
  [B.end + 1, 2.4],
];
export const rateAt = (t) => {
  if (t <= RATE[0][0]) return RATE[0][1];
  for (let i = 0; i < RATE.length - 1; i++) {
    const [t0, r0] = RATE[i];
    const [t1, r1] = RATE[i + 1];
    if (t <= t1) return Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * smoother((t - t0) / (t1 - t0)));
  }
  return RATE[RATE.length - 1][1];
};
const DT = 1 / 600;
const TAUS = new Float64Array(Math.ceil((DURATION + 2) / DT) + 2);
for (let i = 1; i < TAUS.length; i++) TAUS[i] = TAUS[i - 1] + rateAt((i - 0.5) * DT) * DT;
/** drive time at film time t */
export const tauAt = (t) => {
  const u = Math.max(0, Math.min(TAUS.length - 2, t / DT));
  const i = Math.floor(u);
  return TAUS[i] + (TAUS[i + 1] - TAUS[i]) * (u - i);
};
/** film time at drive time τ (for the score and the beats) */
export const filmAt = (tau) => {
  let lo = 0;
  let hi = TAUS.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (TAUS[m] <= tau) lo = m;
    else hi = m;
  }
  return (lo + (tau - TAUS[lo]) / Math.max(1e-12, TAUS[hi] - TAUS[lo])) * DT;
};

// ------------------------------------------------------------ the queue
// 1. power on at the spin-up beat; 2. load onto the outer edge, read one whole track there (zero-latency read);
// 3. a long seek to near the inner edge, to a sector chosen to arrive under the head at the dive beat; 4. power loss.
export const TARGET = {c: NCYL - 6200, h: 0};
const spinEv = [{t: tauAt(B.spinup), on: true}, {t: tauAt(B.power), on: false}];
const base = (s) => [
  {t: tauAt(B.load), load: true, c: 400},
  {t: tauAt(B.read), read: {c: 400, h: 0, full: true}},
  {t: tauAt(B.seek), read: {p: chsToPhys(TARGET.c, TARGET.h, s), n: 96}},
  {t: tauAt(B.power), off: true},
];
const plan0 = makePlan(spinEv, base(0));
{
  // the sector under the head at the dive beat, at the target's actuator angle
  const spt = sptOf(zoneOfCyl(TARGET.c));
  const th = spinAt(plan0.spin, tauAt(B.dive)).th;
  const beta = mod(psiOf(phiOfR(rOfCyl(TARGET.c))) - th, TAU);
  TARGET.s = Math.round((mod(sectorAng(TARGET.c, TARGET.h, 0, spt) - beta, TAU) / TAU) * spt) % spt;
}
export const PLAN = makePlan(spinEv, base(TARGET.s));
export const SPIN_EVENTS = spinEv;
export const driveAtFilm = (t) => driveAt(PLAN, tauAt(t));

/** the plan's segment starts in film seconds (for the score: one click per seek, the tac at the park) */
export const events = () => PLAN.act.filter((s) => Number.isFinite(s.t0)).map((s) => ({k: s.k, t: filmAt(s.t0), t1: Number.isFinite(s.t1) ? filmAt(s.t1) : null, dc: s.c0 !== undefined ? Math.abs(s.c - s.c0) : 0}));
void T_REV;
