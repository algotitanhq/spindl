// The drive's stage: the V8's pale studio scaled to a 15 cm object. A soft top box and side strips for the platters'
// mirror to catch (kept dim: roughness 0.46, envMapIntensity 0.5 on the big surfaces so nothing streaks), a soft
// shadow on an invisible desk, GTAO with a radius that follows the camera so the dive into the slider keeps its
// contact shading. frame(d, cam, ops) poses the drive for state d and draws one frame.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Pass} from 'three/addons/postprocessing/Pass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {buildDrive} from './drive.js';

const V3 = THREE.Vector3;
export const BG = {top: '#f4f4f5', mid: '#ebecee', low: '#e2e3e6'};

export function createStage({canvas}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, BG.top);
    gr.addColorStop(0.55, BG.mid);
    gr.addColorStop(1, BG.low);
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  }
  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.002, 5);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 8}));
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 4, 4);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.7;
  const aoParams = {radius: 0.006, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false};
  gtao.updateGtaoMaterial(aoParams);
  gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16});
  class Toggle extends Pass {
    constructor(fn) {
      super();
      this.needsSwap = false;
      this.fn = fn;
    }
    render() {
      this.fn();
    }
  }
  const aoSkip = (on) => {
    shade.visible = on;
  };
  composer.addPass(new Toggle(() => aoSkip(false)));
  composer.addPass(gtao);
  composer.addPass(new Toggle(() => aoSkip(true)));
  composer.addPass(new OutputPass());

  {
    const env = new THREE.Scene();
    env.background = new THREE.Color('#d6d7da');
    const box = (w, h, pos, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(1, 1, 1).multiplyScalar(k), side: THREE.DoubleSide}));
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    box(10, 10, new V3(0, 14, 2), 1.9);
    box(3, 14, new V3(-12, 4, 6), 2.0);
    box(3, 14, new V3(12, 4, -4), 1.4);
    box(18, 2, new V3(0, 2, 14), 1.1);
    const g = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({color: '#bfc1c5', side: THREE.DoubleSide}));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -2;
    env.add(g);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.03).texture;
    scene.environmentIntensity = 1.0;
    pm.dispose();
  }
  const sun = new THREE.DirectionalLight('#ffffff', 2.3);
  sun.position.set(-0.12, 0.34, 0.16);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, {left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.05, far: 1});
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 10;
  sun.shadow.blurSamples = 20;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.0002;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfd0d3', 0.75));

  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(0.56, 0.56),
    new THREE.ShadowMaterial({color: '#5d636c', opacity: 0.26, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8}),
  );
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = -0.00005;
  shade.receiveShadow = true;
  scene.add(shade);

  const drv = buildDrive();
  scene.add(drv.root);

  const size = {w: 1600, h: 900};
  const resize = (w, h, pr) => {
    size.w = w;
    size.h = h;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  // cam: target (tx, ty, tz) in metres, azimuth from +z toward +x, elevation, distance (radians, metres), sx/sy shift
  let lastR = 0;
  const frame = (d, cam, ops = {}) => {
    drv.update(d, ops);
    const {tx, ty, tz, az, el, dist} = cam;
    camera.position.set(tx + dist * Math.cos(el) * Math.sin(az), ty + dist * Math.sin(el), tz + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(tx, ty, tz);
    camera.near = Math.max(0.00002, dist * 0.08);
    camera.far = dist * 30 + 0.5;
    camera.setViewOffset(size.w, size.h, -(cam.sx ?? 0), -(cam.sy ?? 0), size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const r = Math.min(0.006, Math.max(0.00004, dist * 0.022));
    if (Math.abs(r - lastR) / r > 0.05) {
      gtao.updateGtaoMaterial({...aoParams, radius: r});
      lastR = r;
    }
    composer.render();
  };
  const pv = new V3();
  const project = (x, y, z) => {
    pv.set(x, y, z).project(camera);
    if (pv.z > 1) return null;
    return [(pv.x * 0.5 + 0.5) * size.w, (-pv.y * 0.5 + 0.5) * size.h];
  };
  const setQuality = ({samples, ao, shadow}) => {
    if (samples !== undefined) {
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        t.samples = samples;
        t.dispose();
      }
    }
    if (ao !== undefined) gtao.enabled = ao;
    if (shadow !== undefined) {
      sun.shadow.mapSize.set(shadow, shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };
  const setCut = (mode) => {
    gtao.normalMaterial.clippingPlanes = mode === 'section' ? [drv.CLIP] : null;
    gtao.normalMaterial.needsUpdate = true;
  };
  return {renderer, scene, camera, drv, composer, gtao, sun, resize, frame, project, size, setQuality, setCut};
}
