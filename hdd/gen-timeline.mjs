// Writes the film's timelines from the one plan: timeline.json (the beats, for the review sheets) and sound.json
// (the spindle speed sampled at 100 Hz and every actuator event in film seconds, for the score).
// node gen-timeline.mjs
import fs from 'node:fs';
import {B, PLAN, tauAt, filmAt, DURATION} from './hdd-shared/tour.js';
import {spinAt} from './hdd-shared/kin.js';

const beats = {...B};
delete beats.end;
fs.writeFileSync('hdd-film/timeline.json', JSON.stringify({duration: DURATION, beats}));
const rate = 100;
const rpm = [];
for (let i = 0; i <= DURATION * rate; i++) rpm.push(Math.round((spinAt(PLAN.spin, tauAt(i / rate)).w / (2 * Math.PI)) * 60));
const ev = (k) => PLAN.act.filter((s) => s.k === k && Number.isFinite(s.t0)).map((s) => ({t: +filmAt(s.t0).toFixed(4), t1: +filmAt(s.t1).toFixed(4)}));
const sound = {
  duration: DURATION,
  rpm: {rate, samples: rpm},
  seeks: ev('seek'),
  loads: ev('load'),
  retracts: ev('retract'),
};
fs.writeFileSync('hdd-film/sound.json', JSON.stringify(sound));
console.log('seeks', sound.seeks, 'loads', sound.loads, 'retracts', sound.retracts);
