// The hand check of kin.js against the brief, as a test: every figure the page shows is recomputed here and must
// land in the range the brief set. node hdd/check.mjs (CI runs it on every push).
import * as K from './hdd-shared/kin.js';

let fail = 0;
const f = (x, d = 2) => x.toFixed(d);
const check = (name, v, lo, hi, unit = '') => {
  const ok = v >= lo && v <= hi;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${f(v, 3).padStart(10)} ${unit.padEnd(6)} [${lo}, ${hi}]`);
};
const deg = (r) => r / K.D2R;

// spindle: 7,200 rpm → 120 rev/s, 8.333 ms a turn, 4.167 ms average latency
check('rev per second', K.REV_S, 120, 120, 'rev/s');
check('one revolution', K.T_REV * 1e3, 8.333, 8.334, 'ms');
check('average rotational latency', K.LAT_AVG * 1e3, 4.166, 4.167, 'ms');
// v = 2π r · 120, by hand: 2π × 0.020 × 120 = 15.08 m/s; 2π × 0.046 × 120 = 34.68 m/s
check('linear speed at r = 20 mm', K.vLin(20), 15.07, 15.09, 'm/s');
check('linear speed at r = 46 mm', K.vLin(46), 34.67, 34.69, 'm/s');
check('hand value 2π·0.020·120', 2 * Math.PI * 0.02 * 120, 15.07, 15.09, 'm/s');
// actuator: pivot → head 45-50 mm, a stroke of about 30°, skew within about ±15°
check('pivot to head', K.L, 45, 50, 'mm');
check('stroke over the data band', deg(K.STROKE), 28, 34, '°');
check('skew at the inner edge', deg(K.skewOf(K.G.rIn)), -18, -12, '°');
check('skew at the outer edge', deg(K.skewOf(K.G.rOut)), 12, 18, '°');
check('parked head radius (off the platter)', K.rOfPhi(K.PHI_PARK), K.G.platR + 1, 60, 'mm');
// seeks: 1/3 stroke ≈ 8.5 ms, track to track ≈ 1 ms
check('track-to-track seek', K.seekTimeCyl(1000, 1001) * 1e3, 0.7, 1.1, 'ms');
check('one-third-stroke seek', K.seekTimeCyl(0, Math.round(K.NCYL / 3)) * 1e3, 8.2, 8.8, 'ms');
check('full-stroke seek', K.seekTimeCyl(0, K.NCYL - 1) * 1e3, 12, 18, 'ms');
check('peak VCM current', (K.J * K.A_MAX) / K.KT, 0.5, 1.5, 'A');
// zoned recording: ~250 MB/s outside, ~120 MB/s inside; a 2 TB drive
check('media rate, outer zone', K.rateOf(0), 245, 255, 'MB/s');
check('media rate, inner zone', K.rateOf(K.NZ - 1), 115, 125, 'MB/s');
check('capacity', K.CAPACITY / 1e12, 1.9, 2.1, 'TB');
// LBA mapping round trips
for (const p of [0, 1, 123456789, K.PHYS_TOTAL - 1]) {
  const a = K.physToCHS(p);
  check(`phys ${p} round trip`, K.chsToPhys(a.c, a.h, a.s) - p, 0, 0);
}
if (fail) {
  console.error(`${fail} check(s) out of range`);
  process.exit(1);
}
console.log('all figures in range');
