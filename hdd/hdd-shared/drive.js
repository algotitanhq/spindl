// The drive, built from code in millimetres after the reference photos (REFERENCES.md): a cast aluminium base whose
// wall hugs the platters, two aluminium platters on a hub with a spacer and a six-screw clamp, the spindle motor's
// stator under the hub, an E-block of three arms with four stainless suspensions and sliders, a copper voice coil
// between two nickel-plated magnet plates, a tan plastic ramp with one finger per head at the platter edge, the amber
// flex cable with the preamp on the side of the E-block, a recirculation filter, the cover, and the PCB under the
// base. update(d, ops) poses everything from the drive state d (kin.driveAt) and the view options.
import * as THREE from 'three';
import {
  D2R, G, L, L_TAB, PV, SP, SURF, PHI_R0, PHI_PARK, PHI_STOP_IN, SERVO_WEDGES, NZ, PITCH, liftOf, platY, surfY, armAng, sectorAng, rOfCyl,
} from './kin.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
export const ACCENT = '#ef4a1d';
const MM = 0.001;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// slider and suspension stack-up (mm)
const SL = {len: 1.0, w: 0.8, h: 0.23, x1: 48.2};
const SUS = {x0: 30, x1: 46.6, t: 0.1, w0: 4.2, w1: 1.1};
const ARM = {t: 0.8};
const GAP = 0.012; // drawn flying gap (the real one is ~3 nm, shown in the scale panel)
const TAB_UP = SL.h + SUS.t / 2 + 0.02; // the tab's underside above the surface when the slider flies

// ------------------------------------------------------------ shape helpers (shape (u, v) → world (x, −z))
const shapeY = (shape, depth, y0, opts = {}) => {
  const g = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: false, curveSegments: opts.seg ?? 48});
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  g.computeVertexNormals();
  return g;
};
const circlePath = (x, z, r, hole = false) => {
  const p = new THREE.Path();
  p.absarc(x, -z, r, 0, TAU, hole);
  return p;
};
const ringShape = (r0, r1, seg = 96) => {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, 0, TAU, false);
  if (r0 > 0) s.holes.push(circlePath(0, 0, r0, true));
  return s;
};
const roundRect = (x0, z0, x1, z1, r) => {
  const s = new THREE.Shape();
  const v0 = -z1;
  const v1 = -z0;
  s.moveTo(x0 + r, v0);
  s.lineTo(x1 - r, v0);
  s.absarc(x1 - r, v0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, v1 - r);
  s.absarc(x1 - r, v1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, v1);
  s.absarc(x0 + r, v1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, v0 + r);
  s.absarc(x0 + r, v0 + r, r, Math.PI, 1.5 * Math.PI, false);
  return s;
};
// an annular sector around (cx, cz) in the x-z plane, angles as atan2(z, x)
const sectorShape = (cx, cz, r0, r1, a0, a1, corner = 1.2) => {
  const s = new THREE.Shape();
  const pt = (r, a) => [cx + r * Math.cos(a), -(cz + r * Math.sin(a))];
  const n = 40;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(pt(r1, a0 + ((a1 - a0) * i) / n));
  for (let i = n; i >= 0; i--) pts.push(pt(r0, a0 + ((a1 - a0) * i) / n));
  pts.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
  s.closePath();
  void corner;
  return s;
};

// ------------------------------------------------------------ the platter surface shader
// Object space of a platter: the spindle at the origin, α = atan2(−z, x) in the platter's own frame. Tracks, zones and
// servo wedges are drawn procedurally; the active track, the sectors read so far and the target sector light up in
// the accent. uBlur is the angle the platter turns between two displayed frames: patterns finer than it fade out.
function platterMaterial(shared, surf) {
  const m = new THREE.MeshStandardMaterial({color: '#aeb3ba', metalness: 1, roughness: 0.46, envMapIntensity: 0.5});
  const U = {
    uOn: {value: 0},
    uTrackR: {value: 33},
    uArcA: {value: 0},
    uArcLen: {value: 0},
    uTgtA: {value: 0},
    uTgtLen: {value: 0},
    uTgtOn: {value: 0},
  };
  m.userData.U = U;
  m.userData.surf = surf;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPl;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPl = vec2(position.x, -position.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vPl;
uniform float uBlur, uWedge, uMag, uOn, uTrackR, uArcA, uArcLen, uTgtA, uTgtLen, uTgtOn, uTime, uZones, uPitchV;
uniform vec3 uAcc;
float angd(float a, float b){ return mod(a - b + 9.42477796, 6.28318531) - 3.14159265; }
float wrap2(float a){ return mod(a, 6.28318531); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float r = length(vPl);
  float a = atan(vPl.y, vPl.x);
  float data = step(${G.rIn.toFixed(1)}, r) * step(r, ${G.rOut.toFixed(1)});
  float px = max(fwidth(r), 1e-4);
  // the data band reads a touch darker than the clamp and the outer rim
  diffuseColor.rgb *= mix(1.0, 0.93, data);
  // zone boundaries: faint rings
  float zr = (${G.rOut.toFixed(1)} - r) / ${((G.rOut - G.rIn) / NZ).toFixed(4)};
  float zl = abs(fract(zr + 0.5) - 0.5) * ${((G.rOut - G.rIn) / NZ).toFixed(4)};
  diffuseColor.rgb *= 1.0 - 0.10 * uZones * data * (1.0 - smoothstep(0.0, 0.12 + px, zl));
  // servo wedges: ${SERVO_WEDGES} radial spokes, fading when the platter turns more than about a wedge per frame
  float wq = a * ${(SERVO_WEDGES / TAU).toFixed(5)};
  float wd = abs(fract(wq) - 0.5);
  float wpx = fwidth(wq);
  float wfade = (1.0 - smoothstep(0.004, 0.012, uBlur)) * (1.0 - smoothstep(0.25, 0.6, wpx));
  float wedge = 1.0 - smoothstep(0.035, 0.035 + wpx, 0.5 - wd);
  float wv = wedge * data * wfade;
  float wband = mix(1.0, 1.0 - smoothstep(0.5, 1.4, abs(r - uTrackR)), uMag);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, wv * 0.6 * (1.0 - uWedge * wband));
  totalEmissiveRadiance += uAcc * wv * uWedge * 0.3 * wband;
  // magnified tracks around the head (the dive): grooves at an illustrative pitch
  if (uMag > 0.001) {
    float dr = r - uTrackR;
    float band = 1.0 - smoothstep(1.2, 2.4, abs(dr));
    float g = abs(fract(dr / uPitchV + 0.5) - 0.5);
    float gp = fwidth(dr / uPitchV);
    diffuseColor.rgb *= 1.0 - 0.28 * uMag * band * (1.0 - smoothstep(0.05, 0.05 + gp, g)) * data;
    // sector gaps along the active track, 1° apart for the illustration
    float sq = a * 57.2958;
    float sd = abs(fract(sq) - 0.5);
    float onT = 1.0 - smoothstep(uPitchV * 0.42, uPitchV * 0.5, abs(dr));
    diffuseColor.rgb *= 1.0 - 0.22 * uMag * uOn * onT * (1.0 - smoothstep(0.035, 0.035 + fwidth(sq), 0.5 - sd));
  }
  // the active track, the sectors read so far, the target sector
  if (uOn > 0.001) {
    float w = max(mix(0.32, uPitchV * 0.5, uMag), px * 1.2);
    float on = (1.0 - smoothstep(w, w + px * 1.5, abs(r - uTrackR))) * uOn;
    float back = wrap2(uArcA - a);
    float rd = step(back, uArcLen) * on;
    totalEmissiveRadiance += uAcc * on * mix(0.38, 0.75, uMag);
    diffuseColor.rgb = mix(diffuseColor.rgb, uAcc * 0.6, on * mix(0.35, 0.7, uMag));
    totalEmissiveRadiance += uAcc * rd * 0.55;
    // target: its true arc widened to at least 3°, plus a motion trail of one displayed frame behind it
    float tl = max(uTgtLen, 0.052);
    float tb = wrap2(uTgtA + 0.5 * (tl - uTgtLen) - a);
    float tin = step(tb, tl);
    float trail = (1.0 - smoothstep(0.0, uBlur + 1e-4, tb - tl)) * step(tl, tb) * 0.6;
    float tw = max(w * 2.4, px * 2.0);
    float tr = 1.0 - smoothstep(tw, tw + px * 1.5, abs(r - uTrackR));
    float tg = (tin + trail) * tr * uTgtOn;
    totalEmissiveRadiance += uAcc * tg * 0.95;
    diffuseColor.rgb = mix(diffuseColor.rgb, uAcc, tg * 0.6);
  }
}`,
      );
  };
  m.customProgramCacheKey = () => 'platter-v2-' + surf;
  return m;
}

export function buildDrive() {
  const root = new THREE.Group();
  root.scale.setScalar(MM);
  const REG = {};
  const all = [];
  const mat = (group, Ctor, params) => {
    const m = new Ctor({...params, transparent: true});
    m.userData.base = {opacity: params.opacity ?? 1, depthWrite: params.depthWrite ?? true};
    (REG[group] ||= []).push(m);
    all.push(m);
    return m;
  };
  const add = (parent, geo, m, cast = true, recv = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = cast;
    o.receiveShadow = recv;
    parent.add(o);
    return o;
  };
  const shared = {
    uBlur: {value: 0},
    uWedge: {value: 0},
    uMag: {value: 0},
    uTime: {value: 0},
    uZones: {value: 1},
    uPitchV: {value: 0.11},
    uAcc: {value: new THREE.Color(ACCENT)},
  };

  const M = {
    base: mat('base', THREE.MeshStandardMaterial, {color: '#a9adb3', roughness: 0.62, metalness: 0.55}),
    floor: mat('base', THREE.MeshStandardMaterial, {color: '#8e9298', roughness: 0.7, metalness: 0.45}),
    cover: mat('cover', THREE.MeshPhysicalMaterial, {color: '#c4c8ce', roughness: 0.38, metalness: 0.85, clearcoat: 0.2}),
    screw: mat('cover', THREE.MeshStandardMaterial, {color: '#8f949b', roughness: 0.35, metalness: 1}),
    hub: mat('motor', THREE.MeshStandardMaterial, {color: '#c3c7cd', roughness: 0.3, metalness: 1}),
    clamp: mat('platters', THREE.MeshStandardMaterial, {color: '#cdd1d6', roughness: 0.28, metalness: 1}),
    rim: mat('platters', THREE.MeshStandardMaterial, {color: '#c9ccd1', roughness: 0.45, metalness: 1, envMapIntensity: 0.5}),
    stator: mat('motor', THREE.MeshStandardMaterial, {color: '#6d7178', roughness: 0.5, metalness: 0.8}),
    copper: mat('motor', THREE.MeshStandardMaterial, {color: '#b8752f', roughness: 0.35, metalness: 0.9}),
    rotorMag: mat('motor', THREE.MeshStandardMaterial, {color: '#3b3e44', roughness: 0.55, metalness: 0.5}),
    arm: mat('arm', THREE.MeshStandardMaterial, {color: '#c5c9cf', roughness: 0.38, metalness: 0.9}),
    eblock: mat('arm', THREE.MeshStandardMaterial, {color: '#b7bbc1', roughness: 0.42, metalness: 0.85}),
    bearing: mat('arm', THREE.MeshStandardMaterial, {color: '#d2d5d9', roughness: 0.25, metalness: 1}),
    coil: mat('vcm', THREE.MeshStandardMaterial, {color: '#c4843a', roughness: 0.33, metalness: 0.9}),
    coilHold: mat('vcm', THREE.MeshStandardMaterial, {color: '#3a3d42', roughness: 0.6, metalness: 0.1}),
    yoke: mat('vcm', THREE.MeshStandardMaterial, {color: '#a39b86', roughness: 0.36, metalness: 1}),
    yokeTop: mat('vcmTop', THREE.MeshStandardMaterial, {color: '#a39b86', roughness: 0.36, metalness: 1}),
    magnet: mat('vcm', THREE.MeshStandardMaterial, {color: '#8d9096', roughness: 0.4, metalness: 0.9}),
    magnetTop: mat('vcmTop', THREE.MeshStandardMaterial, {color: '#8d9096', roughness: 0.4, metalness: 0.9}),
    rubber: mat('vcm', THREE.MeshStandardMaterial, {color: '#26282c', roughness: 0.8, metalness: 0}),
    susp: mat('heads', THREE.MeshStandardMaterial, {color: '#d6d9dd', roughness: 0.3, metalness: 1}),
    slider: mat('heads', THREE.MeshStandardMaterial, {color: '#50545b', roughness: 0.4, metalness: 0.35}),
    pole: mat('heads', THREE.MeshStandardMaterial, {color: '#b98a55', roughness: 0.3, metalness: 1}),
    ramp: mat('ramp', THREE.MeshStandardMaterial, {color: '#d2a159', roughness: 0.62, metalness: 0}),
    flex: mat('elec', THREE.MeshStandardMaterial, {color: '#c96f1c', roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide}),
    chip: mat('elec', THREE.MeshStandardMaterial, {color: '#1d1e21', roughness: 0.45, metalness: 0.2}),
    pcb: mat('pcb', THREE.MeshStandardMaterial, {color: '#24392f', roughness: 0.6, metalness: 0.1}),
    pcbChip: mat('pcb', THREE.MeshStandardMaterial, {color: '#1a1b1e', roughness: 0.4, metalness: 0.2}),
    pcbGold: mat('pcb', THREE.MeshStandardMaterial, {color: '#d2a64a', roughness: 0.3, metalness: 1}),
    pcbConn: mat('pcb', THREE.MeshStandardMaterial, {color: '#2b2c30', roughness: 0.55, metalness: 0}),
    filter: mat('base', THREE.MeshStandardMaterial, {color: '#f1f1ee', roughness: 0.85, metalness: 0}),
    ink: new THREE.MeshBasicMaterial({color: '#16181b', transparent: true, opacity: 0.9, depthWrite: false}),
    air: new THREE.MeshBasicMaterial({color: '#4e90d6', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide}),
    airLine: new THREE.MeshBasicMaterial({color: '#2f6fb3', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide}),
  };

  // ------------------------------------------------------------ base casting
  const W2 = G.W / 2;
  const L2 = G.L / 2;
  const base = new THREE.Group();
  root.add(base);
  const outer = () => roundRect(-W2, -L2, W2, L2, 3.2);
  {
    const fl = outer();
    fl.holes.push(circlePath(SP.x, SP.z, 13.2, true));
    add(base, shapeY(fl, G.floorT, G.pcbT), M.floor);
    // the cavity: a shroud hugging the platters at the front, straight sides back to the actuator end
    const cav = new THREE.Path();
    const R = 48.7;
    const zb = L2 - 2.6;
    const xs = W2 - 2.2;
    cav.moveTo(xs, -SP.z);
    cav.lineTo(xs, -(zb - 5));
    cav.absarc(xs - 5, -(zb - 5), 5, 0, -Math.PI / 2, true);
    cav.lineTo(-xs + 5, -zb);
    cav.absarc(-xs + 5, -(zb - 5), 5, -Math.PI / 2, -Math.PI, true);
    cav.lineTo(-xs, -SP.z);
    // around the front of the platter: the shroud
    const a0 = Math.acos(xs / R);
    cav.absarc(SP.x, -SP.z, R, Math.PI - a0 + 0.0001, a0 - 0.0001, true);
    cav.lineTo(xs, -SP.z);
    const wall = outer();
    wall.holes.push(cav);
    add(base, shapeY(wall, G.coverY - G.floorY, G.floorY, {seg: 96}), M.base);
    // motor cup under the hub
    add(base, new THREE.CylinderGeometry(13.2, 13.2, G.floorT, 48).translate(SP.x, G.pcbT + G.floorT / 2 - 0.4, SP.z), M.floor);
    // cover screw bosses on the wall top
    for (const [x, z] of [[-W2 + 4, -L2 + 4], [W2 - 4, -L2 + 4], [-W2 + 4, L2 - 4], [W2 - 4, L2 - 4], [-W2 + 3.2, 10], [W2 - 3.2, 10]]) {
      add(base, new THREE.CylinderGeometry(1.4, 1.4, 0.2, 16).translate(x, G.coverY + 0.1, z), M.floor, false);
    }
    // recirculation filter in its slot by the back wall
    add(base, new THREE.BoxGeometry(1.2, 11, 12).translate(-W2 + 4.5, G.floorY + 5.5, 44), M.filter);
  }

  // ------------------------------------------------------------ cover
  const cover = new THREE.Group();
  root.add(cover);
  {
    add(cover, shapeY(outer(), G.coverT, G.coverY), M.cover, true, false);
    for (const [x, z] of [[-W2 + 4, -L2 + 4], [W2 - 4, -L2 + 4], [-W2 + 4, L2 - 4], [W2 - 4, L2 - 4], [-W2 + 3.2, 10], [W2 - 3.2, 10], [SP.x, SP.z], [PV.x, PV.z]]) {
      add(cover, new THREE.CylinderGeometry(2.0, 2.0, 0.5, 20).translate(x, G.H + 0.25, z), M.screw, false);
    }
  }

  // ------------------------------------------------------------ interior: lifts out of the base in the exploded view
  const inner = new THREE.Group();
  root.add(inner);
  // ------------------------------------------------------------ spindle motor, hub, platters, spacer, clamp
  const motor = new THREE.Group();
  motor.position.set(SP.x, 0, SP.z);
  inner.add(motor);
  {
    // stator: 9 teeth with copper windings on a fixed sleeve
    add(motor, new THREE.CylinderGeometry(3.2, 3.2, 6, 24).translate(0, G.pcbT + 4.2, 0), M.stator);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const g = new THREE.Group();
      g.rotation.y = a;
      motor.add(g);
      add(g, new THREE.BoxGeometry(6.6, 2.6, 1.5).translate(6.6, G.pcbT + 3.4, 0), M.stator);
      add(g, new THREE.BoxGeometry(4.0, 2.1, 2.8).translate(6.2, G.pcbT + 3.4, 0), M.copper);
      add(g, new THREE.BoxGeometry(0.8, 2.7, 3.2).translate(10.0, G.pcbT + 3.4, 0), M.stator);
    }
  }
  const spin = new THREE.Group();
  spin.position.set(SP.x, 0, SP.z);
  inner.add(spin);
  const plat = [];
  const surfMat = [];
  const hubParts = {};
  {
    // hub cup with the rotor magnet ring inside
    hubParts.cup = add(spin, new THREE.CylinderGeometry(12.4, 12.4, 1, 64, 1, true), M.hub);
    hubParts.flange = add(spin, new THREE.CylinderGeometry(15.2, 15.2, 0.8, 64).translate(0, G.hubY - 0.4, 0), M.hub);
    hubParts.skirt = add(spin, new THREE.CylinderGeometry(12.4, 12.4, G.hubY - 0.8 - (G.pcbT + 1.6), 64).translate(0, (G.hubY - 0.8 + G.pcbT + 1.6) / 2, 0), M.hub);
    add(spin, new THREE.CylinderGeometry(11.9, 11.9, 3.2, 48, 1, true).translate(0, G.pcbT + 3.4, 0), M.rotorMag);
    hubParts.top = add(spin, new THREE.CylinderGeometry(12.4, 12.4, 0.6, 64), M.hub);
    // platters: top and bottom faces carry the surface shader, rim and bore plain
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      spin.add(g);
      const top = new THREE.RingGeometry(G.holeR, G.platR, 160, 1).rotateX(-Math.PI / 2).translate(0, G.platT, 0);
      const bot = new THREE.RingGeometry(G.holeR, G.platR, 160, 1).rotateX(Math.PI / 2);
      const sTop = SURF.findIndex((s) => s.plat === k && s.up);
      const sBot = SURF.findIndex((s) => s.plat === k && !s.up);
      const mTop = platterMaterial(shared, sTop);
      const mBot = platterMaterial(shared, sBot);
      for (const m of [mTop, mBot]) {
        m.transparent = true;
        m.userData.base = {opacity: 1, depthWrite: true};
        (REG.platters ||= []).push(m);
        all.push(m);
      }
      surfMat[sTop] = mTop;
      surfMat[sBot] = mBot;
      add(g, top, mTop);
      add(g, bot, mBot);
      add(g, new THREE.CylinderGeometry(G.platR, G.platR, G.platT, 160, 1, true).translate(0, G.platT / 2, 0), M.rim);
      add(g, new THREE.CylinderGeometry(G.holeR, G.holeR, G.platT, 64, 1, true).translate(0, G.platT / 2, 0), M.rim);
      plat.push(g);
    }
    hubParts.spacer = add(spin, new THREE.CylinderGeometry(15.4, 15.4, 1, 64), M.clamp);
    // the clamp: a dished ring with six screws
    const cl = new THREE.Group();
    spin.add(cl);
    const cs = ringShape(3.2, 15.2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      cs.holes.push(circlePath(8.6 * Math.cos(a), 8.6 * Math.sin(a), 1.25, true));
    }
    add(cl, shapeY(cs, 0.9, 0, {seg: 64}), M.clamp);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      add(cl, new THREE.CylinderGeometry(1.15, 1.15, 0.6, 16).translate(8.6 * Math.cos(a), 0.6, -8.6 * Math.sin(a)), M.screw);
    }
    add(cl, new THREE.CylinderGeometry(3.4, 3.4, 0.9, 24).translate(0, 0.75, 0), M.hub);
    hubParts.clamp = cl;
  }

  // ------------------------------------------------------------ VCM: lower magnet on the floor, the top magnet plate
  const magA0 = -24 * D2R;
  const magA1 = 84 * D2R;
  const magMid = 30 * D2R;
  const vcm = new THREE.Group();
  inner.add(vcm);
  const vcmTop = new THREE.Group();
  inner.add(vcmTop);
  const VY = {yoke0: G.floorY, mag0: G.floorY + 1.0, mag1: G.floorY + 2.6, coil0: 8.6, coil1: 11.0, magT0: 12.2, magT1: 13.8, yokeT1: 15.2};
  {
    const yoke = sectorShape(PV.x, PV.z, 7.8, 27.6, magA0, magA1);
    add(vcm, shapeY(yoke, VY.mag0 - VY.yoke0, VY.yoke0), M.yoke);
    // two poles, split at the middle of the swing
    add(vcm, shapeY(sectorShape(PV.x, PV.z, 9.0, 26.0, magA0 + 0.04, magMid - 0.012), VY.mag1 - VY.mag0, VY.mag0), M.magnet);
    add(vcm, shapeY(sectorShape(PV.x, PV.z, 9.0, 26.0, magMid + 0.012, magA1 - 0.04), VY.mag1 - VY.mag0, VY.mag0), M.magnet);
    // crash stops: rubber posts at both ends of the swing
    for (const a of [magA0 - 0.06, magA1 + 0.05]) {
      add(vcm, new THREE.CylinderGeometry(1.5, 1.5, 9, 16).translate(PV.x + 24 * Math.cos(a), G.floorY + 4.5, PV.z + 24 * Math.sin(a)), M.rubber);
    }
    // the top plate: the same sector with three screw ears (the L of the reference photo)
    const top = sectorShape(PV.x, PV.z, 7.8, 27.6, magA0, magA1);
    add(vcmTop, shapeY(top, VY.yokeT1 - VY.magT1, VY.magT1), M.yokeTop);
    for (const a of [magA0 + 0.06, magMid, magA1 - 0.08]) {
      const x = PV.x + 29.5 * Math.cos(a);
      const z = PV.z + 29.5 * Math.sin(a);
      const ear = new THREE.Shape();
      ear.absarc(x, -z, 3.0, 0, TAU, false);
      ear.holes.push(circlePath(x, z, 1.2, true));
      add(vcmTop, shapeY(ear, VY.yokeT1 - VY.magT1, VY.magT1), M.yokeTop);
      add(vcmTop, new THREE.CylinderGeometry(1.5, 1.5, 0.6, 16).translate(x, VY.yokeT1 + 0.3, z), M.screw);
    }
    add(vcmTop, shapeY(sectorShape(PV.x, PV.z, 9.0, 26.0, magA0 + 0.04, magMid - 0.012), VY.magT1 - VY.magT0, VY.magT0), M.magnetTop);
    add(vcmTop, shapeY(sectorShape(PV.x, PV.z, 9.0, 26.0, magMid + 0.012, magA1 - 0.04), VY.magT1 - VY.magT0, VY.magT0), M.magnetTop);
  }

  // ------------------------------------------------------------ the head stack: E-block, arms, coil, suspensions
  const act = new THREE.Group();
  act.position.set(PV.x, 0, PV.z);
  inner.add(act);
  // arm local frame: +x along the arm toward the heads, shape v = −z
  const armShape = () => {
    const s = new THREE.Shape();
    const pts = [[0, 6.6], [10, 6.0], [22, 4.0], [31, 2.9], [33.4, 2.2], [33.4, -2.2], [31, -2.9], [22, -4.0], [10, -6.0], [0, -6.6]];
    s.moveTo(-6.6, 0);
    s.absarc(0, 0, 6.6, Math.PI, Math.PI / 2, true);
    pts.slice(1).forEach(([x, v]) => s.lineTo(x, v));
    s.absarc(0, 0, 6.6, -Math.PI / 2, -Math.PI, true);
    s.holes.push(circlePath(0, 0, 3.6, true), circlePath(13.5, 0, 2.3, true), circlePath(20.5, 0, 1.6, true), circlePath(26.5, 0, 1.0, true));
    return s;
  };
  const ARMY = [
    (G.floorY + platY(0)) / 2, // bottom arm, under the lower platter
    (platY(0) + G.platT + platY(1)) / 2, // middle arm, between the platters
    platY(1) + G.platT + 1.25, // top arm
  ];
  const arms = [];
  const heads = [];
  const ebody = add(act, new THREE.CylinderGeometry(6.6, 6.6, 1, 48), M.eblock);
  const bearing = add(act, new THREE.CylinderGeometry(3.6, 3.6, 1, 32), M.bearing);
  add(act, new THREE.CylinderGeometry(3.0, 3.0, 0.6, 24).translate(0, ARMY[2] + 1.6, 0), M.bearing);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    act.add(g);
    add(g, shapeY(armShape(), ARM.t, -ARM.t / 2, {seg: 24}), M.arm);
    arms.push(g);
  }
  // the coil and its holder, behind the pivot
  const coilG = new THREE.Group();
  act.add(coilG);
  {
    const ring = (r0, r1, half) => {
      const s = new THREE.Shape();
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI - half + (2 * half * i) / n;
        const p = [r1 * Math.cos(a), -r1 * Math.sin(a)];
        i ? s.lineTo(...p) : s.moveTo(...p);
      }
      for (let i = n; i >= 0; i--) {
        const a = Math.PI - half * 0.62 + (2 * half * 0.62 * i) / n;
        s.lineTo(r0 * Math.cos(a), -r0 * Math.sin(a));
      }
      s.closePath();
      return s;
    };
    const outerS = ring(8.5, 23.8, 27 * D2R);
    const innerS = ring(12.0, 20.4, 17 * D2R);
    const coilS = ring(8.5, 23.8, 27 * D2R);
    coilS.holes.push(new THREE.Path(innerS.getPoints(24).reverse()));
    add(coilG, shapeY(coilS, VY.coil1 - VY.coil0, VY.coil0, {seg: 24}), M.coil);
    void outerS;
    // holder: two fork tines from the E-block to the coil's inner corners
    for (const sgn of [-1, 1]) {
      const a = Math.PI + sgn * 14 * D2R;
      const g = new THREE.BoxGeometry(5.2, 2.0, 1.6);
      const m = add(coilG, g, M.coilHold);
      m.position.set(9.0 * Math.cos(a), (VY.coil0 + VY.coil1) / 2, -9.0 * Math.sin(a));
      m.rotation.y = a;
    }
  }
  // force arrow on the coil's outer leg (ink): length and sign follow the VCM current
  const arrow = new THREE.Group();
  act.add(arrow);
  {
    const shaft = add(arrow, new THREE.CylinderGeometry(0.8, 0.8, 1, 12), M.ink, false, false);
    const cone = add(arrow, new THREE.ConeGeometry(2.0, 4.4, 16), M.ink, false, false);
    arrow.userData = {shaft, cone};
  }
  // heads: suspension (a pivoting group from the swage at x = 30), slider, lift tab, read pole
  const suspGeo = (() => {
    const s = new THREE.Shape();
    const len = SUS.x1 - SUS.x0;
    s.moveTo(0, SUS.w0 / 2);
    s.lineTo(len, SUS.w1 / 2);
    s.lineTo(len, -SUS.w1 / 2);
    s.lineTo(0, -SUS.w0 / 2);
    s.closePath();
    s.holes.push(new THREE.Path([new THREE.Vector2(2.5, 0.9), new THREE.Vector2(7.5, 0.5), new THREE.Vector2(7.5, -0.5), new THREE.Vector2(2.5, -0.9)]));
    return shapeY(s, SUS.t, -SUS.t / 2, {seg: 4});
  })();
  for (let h = 0; h < 4; h++) {
    const s = SURF[h];
    const g = new THREE.Group();
    act.add(g);
    const tilt = new THREE.Group();
    g.add(tilt);
    add(tilt, suspGeo, M.susp);
    const sl = new THREE.Group();
    tilt.add(sl);
    const sgn = s.up ? -1 : 1; // toward the surface
    const sld = add(sl, new THREE.BoxGeometry(SL.len, SL.h, SL.w), M.slider);
    sld.position.set(SL.x1 - SL.len / 2 - SUS.x0, sgn * (SUS.t / 2 + SL.h / 2), 0);
    const pole = add(sl, new THREE.BoxGeometry(0.06, SL.h * 0.7, 0.18), M.pole, false);
    pole.position.set(SL.x1 - SUS.x0 - 0.02, sgn * (SUS.t / 2 + SL.h * 0.45), 0);
    // lift tab, angled away from the surface
    const tab = add(tilt, new THREE.BoxGeometry(L_TAB - SUS.x1 + 0.3, 0.08, 0.45), M.susp);
    tab.position.set((L_TAB + SUS.x1) / 2 - SUS.x0 - 0.15, -sgn * 0.06, 0);
    heads.push({g, tilt, sgn, sld});
  }

  // ------------------------------------------------------------ ramp: a spine beside the tab arc, a finger per head
  const ramp = new THREE.Group();
  inner.add(ramp);
  const rampY = (h, phi, ex = 0) => {
    const s = SURF[h];
    const y0 = surfY(h, ex);
    const sgn = s.up ? 1 : -1;
    return y0 + sgn * (GAP + TAB_UP + liftOf(phi));
  };
  const buildFinger = (h) => {
    // a strip along the tab arc (pivot distance 49.7..51.5), its working face following liftOf, 0.5 mm thick
    const n = 40;
    const p0 = PHI_R0 - 1.2 * D2R;
    const p1 = PHI_PARK + 2.2 * D2R;
    const pos = [];
    const idx = [];
    const s = SURF[h];
    const sgn = s.up ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      const phi = p0 + ((p1 - p0) * i) / n;
      const a = armAng(phi);
      const yf = rampY(h, Math.max(phi, PHI_R0)) - sgn * 0.0;
      const thick = 0.25 + 0.45 * Math.min(1, Math.max(0, (phi - PHI_R0) / (2 * D2R)));
      for (const rr of [49.6, 51.6]) {
        const x = PV.x + rr * Math.cos(a);
        const z = PV.z + rr * Math.sin(a);
        pos.push(x, yf, z, x, yf - sgn * thick, z);
      }
    }
    // quads: face (0,2), back (1,3), inner edge (0,1), outer edge (2,3)
    for (let i = 0; i < n; i++) {
      const b = i * 4;
      const c = b + 4;
      const q = (a0, a1, b0, b1) => idx.push(a0, b0, a1, a1, b0, b1);
      q(b + 0, b + 2, c + 0, c + 2);
      q(b + 3, b + 1, c + 3, c + 1);
      q(b + 1, b + 0, c + 1, c + 0);
      q(b + 2, b + 3, c + 2, c + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const fingers = [];
  {
    const fm = M.ramp.clone();
    fm.side = THREE.DoubleSide;
    fm.userData.base = M.ramp.userData.base;
    REG.ramp.push(fm);
    all.push(fm);
    for (let h = 0; h < 4; h++) fingers.push(add(ramp, buildFinger(h), fm));
    // the spine
    const a0 = armAng(PHI_R0 + 0.6 * D2R);
    const a1 = armAng(PHI_PARK + 3.5 * D2R);
    const sp = sectorShape(PV.x, PV.z, 51.5, 55.0, Math.min(a0, a1), Math.max(a0, a1));
    add(ramp, shapeY(sp, 11.5, G.floorY), M.ramp);
    // mounting ear and screw
    const am = armAng(PHI_PARK + 1.5 * D2R);
    const ex = PV.x + 57.5 * Math.cos(am);
    const ez = PV.z + 57.5 * Math.sin(am);
    add(ramp, new THREE.CylinderGeometry(2.6, 2.6, 2.0, 24).translate(ex, G.floorY + 10.5, ez), M.ramp);
    add(ramp, new THREE.CylinderGeometry(1.4, 1.4, 0.6, 16).translate(ex, G.floorY + 11.8, ez), M.screw);
  }

  // ------------------------------------------------------------ flex cable and preamp
  const FLEX_N = 36;
  const flexGeo = new THREE.BufferGeometry();
  flexGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((FLEX_N + 1) * 2 * 3), 3));
  {
    const idx = [];
    for (let i = 0; i < FLEX_N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    flexGeo.setIndex(idx);
  }
  const flex = add(inner, flexGeo, M.flex, true, true);
  flex.frustumCulled = false;
  const FLEX_END = {x: -8, z: 63.5}; // the bracket on the floor, by the back wall
  add(inner, new THREE.BoxGeometry(12, 3.5, 3.0).translate(FLEX_END.x, G.floorY + 1.75, FLEX_END.z + 1.4), M.coilHold);
  // the preamp rides on the flex, glued to the side of the E-block
  const preamp = new THREE.Group();
  act.add(preamp);
  add(preamp, new THREE.BoxGeometry(8.5, 6.4, 0.25), M.flex);
  add(preamp, new THREE.BoxGeometry(3.4, 2.6, 0.7).translate(0, 0.6, -0.45), M.chip);
  preamp.position.set(1.0, (ARMY[0] + ARMY[2]) / 2, -7.1);

  // ------------------------------------------------------------ PCB (under the base; swings out on a hinge for the electronics view)
  const pcbHinge = new THREE.Group();
  pcbHinge.position.set(-W2, 0, 0);
  root.add(pcbHinge);
  const pcb = new THREE.Group();
  pcb.position.set(W2, 0, 0);
  pcbHinge.add(pcb);
  const pcbParts = {};
  {
    const b = roundRect(-W2 + 3, -8, W2 - 3, L2 - 0.5, 2);
    b.holes.push(circlePath(SP.x + 2, 2, 2, true));
    add(pcb, shapeY(b, G.pcbT, 0), M.pcb);
    // components on the underside (y < 0 in the board frame, facing the desk)
    const chip = (w, d, h, x, z, m = M.pcbChip) => add(pcb, new THREE.BoxGeometry(w, h, d).translate(x, -h / 2, z), m);
    pcbParts.soc = chip(14, 14, 1.2, -6, 34);
    pcbParts.dram = chip(9, 11, 1.0, 14, 34);
    pcbParts.drv = chip(9, 9, 1.0, -24, 22);
    chip(5, 6, 0.8, 14, 52);
    chip(3, 3, 0.6, -24, 40);
    for (let i = 0; i < 10; i++) chip(1.6, 0.8, 0.5, 26 + (i % 5) * 3, 12 + Math.floor(i / 5) * 3);
    // SATA data (7-pin) and power (15-pin) at the back edge
    pcbParts.sata = chip(13, 6, 5.5, -20, L2 - 3, M.pcbConn);
    pcbParts.pwr = chip(22, 6, 5.5, 4, L2 - 3, M.pcbConn);
    chip(10.5, 0.6, 0.3, -20, L2 - 0.4, M.pcbGold);
    chip(19.5, 0.6, 0.3, 4, L2 - 0.4, M.pcbGold);
    // contact pads to the motor and to the head flex through the base
    for (let i = 0; i < 4; i++) chip(1.4, 1.4, 0.05, SP.x - 3 + i * 2, -1, M.pcbGold);
    for (let i = 0; i < 8; i++) chip(1.0, 2.0, 0.05, FLEX_END.x - 4 + i * 1.2, FLEX_END.z, M.pcbGold);
  }

  // ------------------------------------------------------------ air bearing (dive only): a cushion and flow lines
  const air = new THREE.Group();
  inner.add(air);
  const cushion = add(air, new THREE.BoxGeometry(1, 1, 1), M.air, false, false);
  const flowLines = [];
  for (let i = 0; i < 14; i++) flowLines.push(add(air, new THREE.BoxGeometry(1, 1, 1), M.airLine, false, false));

  // ------------------------------------------------------------ section plane
  const CLIP = new THREE.Plane(new V3(0, 0, 1), -SP.z * MM);

  // ------------------------------------------------------------ update
  const tmp = new V3();
  const exState = {ex: 0, lift: 0};
  /**
   * d: kin.driveAt state. ops: explode 0..1, vcmOpen 0..1, cover ('off' | 'glass' | 'solid', or a number 0..1 of
   * presence), cut ('glass' | 'section' | 'solid'), ghost {group: alpha}, blur (rad per displayed frame), wedge 0..1,
   * mag 0..1 (dive), pcbOpen 0..1, accent {on, ...} overrides.
   */
  const update = (d, ops = {}) => {
    const ex = (ops.explode ?? 0) * 7.5; // mm extra per platter gap
    exState.ex = ex;
    exState.lift = smoother(ops.explode ?? 0) * 24;
    const lift = smoother(ops.explode ?? 0) * 24;
    inner.position.y = lift;
    // the spindle
    spin.rotation.y = ((d.th % TAU) + TAU) % TAU;
    plat.forEach((g, k) => (g.position.y = platY(k, ex)));
    {
      const y0 = G.pcbT + 1.6;
      const yTop = platY(1, ex) + G.platT;
      hubParts.cup.scale.y = yTop - y0;
      hubParts.cup.position.y = (yTop + y0) / 2;
      hubParts.top.position.y = yTop - 0.3;
      const s0 = platY(0, ex) + G.platT;
      const s1 = platY(1, ex);
      hubParts.spacer.scale.y = s1 - s0;
      hubParts.spacer.position.y = (s0 + s1) / 2;
      hubParts.clamp.position.y = yTop;
    }
    // the actuator
    act.rotation.y = -armAng(d.phi);
    const armY = [ARMY[0], ARMY[1] + ex, ARMY[2] + 2 * ex];
    arms.forEach((g, i) => (g.position.y = armY[i]));
    ebody.scale.y = armY[2] - armY[0] + ARM.t;
    ebody.position.y = (armY[2] + armY[0]) / 2;
    bearing.scale.y = armY[2] - G.floorY + 1.8;
    bearing.position.y = (armY[2] + G.floorY + 1.8) / 2;
    coilG.position.y = ex;
    preamp.position.y = (armY[0] + armY[2]) / 2;
    // each suspension: pivot at the swage, tilted so the slider flies GAP over its surface, plus the ramp lift
    for (let h = 0; h < 4; h++) {
      const s = SURF[h];
      const H = heads[h];
      const arm = s.plat === 1 ? (s.up ? 2 : 1) : s.up ? 1 : 0;
      const yArm = armY[arm] + (s.up ? -ARM.t / 2 : ARM.t / 2);
      const ySurf = surfY(h, ex);
      const sgnUp = s.up ? 1 : -1;
      const gap = GAP + 0.05 * (ops.mag ?? 0); // the dive draws the gap grown (the real one is ~3 nm)
      const yTip = ySurf + sgnUp * (gap + SL.h + SUS.t / 2 + d.lift);
      H.g.position.set(SUS.x0, yArm, 0);
      const len = SL.x1 - SL.len / 2 - SUS.x0;
      H.tilt.rotation.z = Math.atan2(yTip - yArm, len);
      H.active = h === d.head && d.onDisk;
    }
    // the coil's force arrow: tangential at the coil's outer leg, F ∝ current
    {
      const I = d.amps;
      const k = Math.min(1, Math.abs(I) / 1.0);
      const len = 5 + 15 * k;
      const show = Math.min(1, Math.max(0, ((ops.vcmOpen ?? 0) - 0.4) / 0.4)) * (Math.abs(I) > 0.02 ? 1 : 0);
      arrow.visible = show > 0.01;
      // a force along −local z rotates the arm toward larger φ (outward); the current sign gives the torque sign
      const dir = I >= 0 ? 1 : -1;
      const r = 16.2;
      arrow.position.set(-r, VY.coil1 + 1.8 + ex, 0);
      arrow.rotation.set(dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0);
      arrow.userData.shaft.scale.y = len;
      arrow.userData.shaft.position.y = len / 2;
      arrow.userData.cone.position.y = len + 2.1;
      M.ink.opacity = 0.88 * show;
    }
    // VCM top magnet: lifts and tilts away
    {
      const v = ops.vcmOpen ?? 0;
      const sv = smoother(v);
      vcmTop.position.set(sv * 16, sv * 22, sv * 22);
      vcm.position.y = 0;
    }
    ramp.position.y = lift * 0;
    // the ramp fingers spread with the stack: rebuild only when the explode changes
    if (Math.abs((ramp.userData.ex ?? 0) - ex) > 1e-3 || Math.abs((ramp.userData.lift ?? 0) - lift) > 1e-3) {
      ramp.userData.ex = ex;
      ramp.userData.lift = lift;
      fingers.forEach((f, h) => {
        f.position.y = surfY(h, ex) - surfY(h, 0);
      });
    }
    // flex: from the preamp on the E-block side to the bracket, a smooth loop
    {
      const a = armAng(d.phi);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // local (x, z) → world: rotation.y = −a, so local +x → (cos a, sin a) and local +z → (−sin a, cos a)
      const lx = -4.5;
      const lz = -7.3;
      const p0 = {x: PV.x + lx * ca - lz * sa, z: PV.z + lx * sa + lz * ca};
      const t0 = {x: sa, z: -ca};
      const p1 = FLEX_END;
      const yA = (armY[0] + armY[2]) / 2;
      const yB = G.floorY + 6;
      const pos = flexGeo.attributes.position.array;
      const L0 = 22;
      for (let i = 0; i <= FLEX_N; i++) {
        const u = i / FLEX_N;
        const b0 = (1 - u) ** 3;
        const b1 = 3 * u * (1 - u) ** 2;
        const b2 = 3 * u * u * (1 - u);
        const b3 = u ** 3;
        const c1 = {x: p0.x + t0.x * L0, z: p0.z + t0.z * L0};
        const c2 = {x: p1.x + 26, z: p1.z - 8};
        const x = b0 * p0.x + b1 * c1.x + b2 * c2.x + b3 * p1.x;
        const z = b0 * p0.z + b1 * c1.z + b2 * c2.z + b3 * p1.z;
        const yc = yA + (yB - yA) * smoother(u);
        const hw = 2.3 - 0.5 * u;
        pos.set([x, yc - hw, z, x, yc + hw, z], i * 6);
      }
      flexGeo.attributes.position.needsUpdate = true;
      flexGeo.computeVertexNormals();
      flexGeo.computeBoundingSphere();
    }
    // PCB: swings out on its long edge, components up
    {
      const o = ops.pcbOpen ?? 0;
      pcbHinge.rotation.z = Math.PI * smoother(o);
      pcbHinge.position.y = G.pcbT * smoother(o) + 6 * Math.sin(Math.PI * smoother(o));
    }
    // cover presence
    {
      const c = ops.cover ?? 'glass';
      cover.visible = c !== 'off' && (ops.coverK ?? 1) > 0.01;
      cover.position.y = (1 - (ops.coverK ?? 1)) * 40 + lift * 1.6;
    }
    // ghosting by group, the cutaway modes
    const cut = ops.cut ?? 'solid';
    const gh = {base: 1, cover: 1, motor: 1, platters: 1, arm: 1, heads: 1, vcm: 1, vcmTop: 1, ramp: 1, elec: 1, pcb: 1, ...(ops.ghost || {})};
    if ((ops.cover ?? 'glass') === 'glass') gh.cover = Math.min(gh.cover, 0.1);
    if (cut === 'glass') {
      gh.base = Math.min(gh.base, 0.16);
      gh.cover = Math.min(gh.cover, 0.06);
    }
    for (const [g, ms] of Object.entries(REG)) {
      const k = gh[g] ?? 1;
      for (const m of ms) {
        m.opacity = m.userData.base.opacity * k;
        m.depthWrite = k > 0.6 && m.userData.base.depthWrite;
      }
    }
    // the cover in glass: a clear physical sheet
    {
      const glass = (ops.cover ?? 'glass') === 'glass';
      M.cover.roughness = glass ? 0.08 : 0.38;
      M.cover.color.set(glass ? '#ffffff' : '#c4c8ce');
      M.cover.metalness = glass ? 0 : 0.85;
    }
    root.traverse((o) => {
      if (o.isMesh && o.material?.userData?.base) o.castShadow = o.material.opacity > 0.5 && o.material !== M.cover;
    });
    const clip = cut === 'section' ? [CLIP] : null;
    for (const m of all) {
      if (m.clippingPlanes !== clip) {
        m.clippingPlanes = clip;
        m.userData.side0 ??= m.side;
        m.side = clip ? THREE.DoubleSide : m.userData.side0;
        m.needsUpdate = true;
      }
    }
    // platter surfaces: blur, wedges, the dive's magnification, the accent on the active surface
    shared.uBlur.value = ops.blur ?? 0;
    shared.uWedge.value = ops.wedge ?? 0;
    shared.uMag.value = ops.mag ?? 0;
    shared.uPitchV.value = 0.11;
    for (let h = 0; h < 4; h++) {
      const U = surfMat[h].userData.U;
      const tg = d.target;
      const on = d.onDisk && h === d.head ? 1 : 0;
      U.uOn.value = on * (ops.accent ?? 1);
      U.uTrackR.value = d.r;
      U.uArcLen.value = 0;
      U.uTgtOn.value = 0;
      if (on && d.reading) {
        const s = d.seg;
        U.uArcA.value = sectorAng(s.c, s.h, s.s0, s.spt);
        U.uArcLen.value = (TAU * Math.min(s.n, (d.t - s.t0) / (s.t1 - s.t0) * s.n)) / s.spt;
      }
      if (tg && tg.h === h && (d.k === 'wait' || d.k === 'seek' || d.k === 'switch' || (d.k === 'read' && !tg.wrap))) {
        const n = tg.wrap ? 1 : Math.min(tg.n, 8);
        U.uTgtA.value = sectorAng(tg.c, tg.h, tg.s0, tg.spt);
        U.uTgtLen.value = (TAU * n) / tg.spt;
        U.uTgtOn.value = (ops.accent ?? 1) * (d.k === 'read' ? Math.max(0, 1 - (d.t - tg.t0) / (tg.t1 - tg.t0) * 2) : 1);
        U.uTrackR.value = d.k === 'seek' ? rOfCyl(tg.c) : d.r;
        U.uOn.value = Math.max(U.uOn.value, d.k === 'seek' ? 0.55 * (ops.accent ?? 1) : U.uOn.value);
      }
    }
    // air bearing: a cushion under the active slider and flow lines along the track
    {
      const m = ops.mag ?? 0;
      air.visible = m > 0.01 && d.onDisk;
      M.air.opacity = 0.22 * m;
      M.airLine.opacity = 0.55 * m;
      if (air.visible) {
        const h = d.head;
        const s = SURF[h];
        const sgnUp = s.up ? 1 : -1;
        const a = armAng(d.phi);
        const hx = PV.x + (SL.x1 - SL.len / 2) * Math.cos(a);
        const hz = PV.z + (SL.x1 - SL.len / 2) * Math.sin(a);
        const ys = surfY(h, ex);
        // the track tangent at the head: perpendicular to the radius, in the direction the surface moves (CCW)
        const rx = hx - SP.x;
        const rz = hz - SP.z;
        const rl = Math.hypot(rx, rz);
        const tx = rz / rl;
        const tz = -rx / rl;
        const ang = Math.atan2(tz, tx);
        cushion.position.set(hx, ys + sgnUp * 0.031, hz);
        cushion.rotation.set(0, -ang, 0);
        cushion.scale.set(1.15, 0.05, 0.85);
        // flow lines: dashes riding at the surface speed (scaled by the playback) under and beside the slider
        const travel = (ops.flow ?? 0) % 1;
        flowLines.forEach((f, i) => {
          const lane = (i % 7) - 3;
          const row = Math.floor(i / 7);
          const u = ((travel + i * 0.37) % 1) * 5 - 2.5;
          const px = hx + tx * u + (-tz) * lane * 0.22;
          const pz = hz + tz * u + tx * lane * 0.22;
          f.position.set(px, ys + sgnUp * (0.02 + row * 0.03), pz);
          f.rotation.set(0, -ang, 0);
          f.scale.set(0.5, 0.004, 0.012);
        });
      }
    }
  };

  // world points for callouts and cameras (metres)
  const W = (x, y, z) => [x * MM, y * MM, z * MM];
  const headWorld = (d, h = d.head) => {
    const a = armAng(d.phi);
    const x = PV.x + (SL.x1 - SL.len / 2) * Math.cos(a);
    const z = PV.z + (SL.x1 - SL.len / 2) * Math.sin(a);
    return W(x, surfY(h, exState.ex) + exState.lift + (SURF[h].up ? 0.15 : -0.15), z);
  };
  void tmp;
  void PHI_STOP_IN;
  void PITCH;
  return {root, inner, exState, update, M, REG, CLIP, headWorld, W, VY, ARMY, spin, act, vcmTop, ramp, pcb, pcbParts, flex, preamp, shared, surfMat, magMid, FLEX_END};
}
