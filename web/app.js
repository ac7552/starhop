// Starhop page: the ship sits at the origin and the universe moves round it. Positions are kept in km in
// the J2000 ecliptic frame (z = ecliptic north) as doubles, and turned into ship-relative floats each frame.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import * as S from "./shaders.js";
import { AU, C, DAY, DEG, G0, LY, OBLIQUITY, PC, add, cross, dateFromJulian, julianDate, norm, scale, sub, unit } from "../src/units.js";
import { circularSpeed, propagate } from "../src/kepler.js";
import { blackbodyRGB, readStars } from "../src/stars.js";
import { gammaOf, trip as planTrip, tripAt } from "../src/relativity.js";
import { bodyPosition, madeUpSystem, solSystem } from "../src/systems.js";

const $ = (id) => document.getElementById(id);
const KIND = { rock: 0, cloud: 1, earth: 2, desert: 3, bands: 4, ice: 5, lava: 6 };
const SPIN_DAYS = { Mercury: 58.6, Venus: -243, Earth: 0.997, Mars: 1.026, Jupiter: 0.414, Saturn: 0.444, Uranus: -0.718, Neptune: 0.671 };
const FAMOUS = ["Rigil Kentaurus", "Proxima Centauri", "Barnard's Star", "Wolf 359", "Lalande 21185", "Sirius", "Ran", "Procyon", "Altair", "Vega", "Fomalhaut", "Pollux", "Arcturus", "Capella", "Aldebaran", "Regulus", "Achernar", "Canopus", "Polaris", "Betelgeuse", "Antares", "Rigel", "Deneb"];

// ---------- renderer, camera ----------
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Without a graphics card the browser draws in software, which is slow. Keep the frame rate up by drawing
// fewer pixels when frames come slowly, and more again when there is time to spare.
const MAX_SCALE = Math.min(2, devicePixelRatio);
const gl = renderer.getContext();
const info = gl.getExtension("WEBGL_debug_renderer_info");
const gpuName = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
const software = /swiftshader|llvmpipe|software|softpipe/i.test(gpuName);
let renderScale = software ? Math.min(MAX_SCALE, 0.6) : MAX_SCALE;
renderer.setPixelRatio(renderScale);
const pace = { frames: 0, since: performance.now() };
function keepPace(now) {
  pace.frames++;
  if (now - pace.since < 1000) return;
  const fps = (pace.frames * 1000) / (now - pace.since);
  pace.frames = 0; pace.since = now;
  const before = renderScale;
  if (fps < 24 && renderScale > 0.35) renderScale = Math.max(0.35, renderScale * 0.8);
  else if (fps > 48 && renderScale < MAX_SCALE) renderScale = Math.min(MAX_SCALE, renderScale * 1.15);
  if (renderScale !== before) { renderer.setPixelRatio(renderScale); resize(); }
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.0005, 1e16);
camera.up.set(0, 0, 1);
camera.position.set(-0.25, -0.18, 0.08);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 0.03;
controls.maxDistance = 2e10;
controls.zoomSpeed = 1.8;

// ---------- sky: catalog stars and the Milky Way ----------
const LUT_N = 256;
const lut = new Uint8Array(LUT_N * 4);
for (let i = 0; i < LUT_N; i++) {
  const T = Math.exp(Math.log(500) + (i / (LUT_N - 1)) * (Math.log(200000) - Math.log(500)));
  blackbodyRGB(T).forEach((v, k) => (lut[i * 4 + k] = Math.round(v * 255)));
  lut[i * 4 + 3] = 255;
}
const lutTex = new THREE.DataTexture(lut, LUT_N, 1, THREE.RGBAFormat);
lutTex.magFilter = lutTex.minFilter = THREE.LinearFilter;
lutTex.needsUpdate = true;

function eqToEcl(raDeg, decDeg) {
  const ra = raDeg * DEG, de = decDeg * DEG;
  const x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de);
  return new THREE.Vector3(x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY));
}
const skyUniforms = {
  uNgp: { value: eqToEcl(192.85948, 27.12825) }, uGc: { value: eqToEcl(266.40499, -28.93617) },
  uBeta: { value: new THREE.Vector3() }, uGamma: { value: 1 }, uGain: { value: 0.035 },
};
const sky = new THREE.Mesh(new THREE.SphereGeometry(1e14, 64, 32), new THREE.ShaderMaterial({
  vertexShader: S.skyVertex, fragmentShader: S.skyFragment, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
}));
sky.renderOrder = -2;
sky.frustumCulled = false;
scene.add(sky);

const starUniforms = {
  uObserver: { value: new THREE.Vector3() }, uBeta: skyUniforms.uBeta, uGamma: skyUniforms.uGamma,
  uMagRef: { value: 3.6 }, uSize: { value: 2.2 }, uHideWithin: { value: 1e-9 }, uLut: { value: lutTex },
};
let stars, meta, points;

async function loadStars() {
  [meta, stars] = await Promise.all([
    fetch("../data/stars.json").then((r) => r.json()),
    fetch("../data/stars.bin").then((r) => r.arrayBuffer()),
  ]).then(([m, b]) => [m, readStars(b, m)]);
  const n = stars.count + 1; // plus the Sun, last
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), temp = new Float32Array(n);
  for (let i = 0; i < stars.count; i++) {
    pos[i * 3] = stars.x[i]; pos[i * 3 + 1] = stars.y[i]; pos[i * 3 + 2] = stars.z[i];
    mag[i] = stars.absMag[i]; temp[i] = stars.temperature[i];
  }
  mag[n - 1] = 4.83; temp[n - 1] = 5772;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("starPos", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("absMag", new THREE.BufferAttribute(mag, 1));
  g.setAttribute("temp", new THREE.BufferAttribute(temp, 1));
  points = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexShader: S.starVertex, fragmentShader: S.starFragment, uniforms: starUniforms,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  points.renderOrder = -1;
  points.frustumCulled = false;
  scene.add(points);
}

// ---------- the ship ----------
function buildShip() {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, metalness: 0.55, roughness: 0.42 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.3, roughness: 0.7 });
  const radMat = new THREE.MeshStandardMaterial({ color: 0x34363a, metalness: 0.2, roughness: 0.75, emissive: 0x5a1e0c, emissiveIntensity: 0.25 });
  const hull = new THREE.LatheGeometry([[0, 0.07], [0.004, 0.066], [0.008, 0.057], [0.0095, 0.03], [0.0095, -0.03], [0.012, -0.04], [0.012, -0.05], [0, -0.05]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
  group.add(new THREE.Mesh(hull, hullMat));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0045, 16, 96), hullMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.036;
  const hub = new THREE.Group();
  hub.add(ring);
  for (let k = 0; k < 4; k++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.026 * 2, 8), darkMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = (k * Math.PI) / 4 * 2;
    spoke.position.y = 0.036;
    hub.add(spoke);
  }
  const lit = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 1.2 });
  for (let k = 0; k < 24; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0012, 0.0012), lit);
    const a = (k / 24) * Math.PI * 2;
    w.position.set(Math.cos(a) * 0.0305, 0.036, Math.sin(a) * 0.0305);
    w.rotation.y = -a;
    hub.add(w);
  }
  group.add(hub);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.03, 0.0006), radMat);
    panel.position.set(side * 0.038, -0.012, 0);
    group.add(panel);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.02, 6), darkMat);
    strut.rotation.z = Math.PI / 2;
    strut.position.set(side * 0.011, -0.012, 0);
    group.add(strut);
  }
  const bell = new THREE.LatheGeometry([[0.004, -0.05], [0.006, -0.054], [0.01, -0.064], [0.0135, -0.076]].map(([r, y]) => new THREE.Vector2(r, y)), 40);
  group.add(new THREE.Mesh(bell, new THREE.MeshStandardMaterial({ color: 0x6b6058, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide })));
  const plumeMat = new THREE.ShaderMaterial({
    vertexShader: S.glowVertex, fragmentShader: S.plumeFragment, uniforms: { uTime: { value: 0 }, uThrust: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (let k = 0; k < 2; k++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.22), plumeMat);
    plane.position.y = -0.076 - 0.11;
    plane.rotation.y = (k * Math.PI) / 2;
    group.add(plane);
  }
  return { group, hub, plumeMat };
}
const ship = buildShip();
scene.add(ship.group);
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
scene.add(sunLight, sunLight.target);
scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x1a1612, 0.35));

// ---------- star systems ----------
const sphere = new THREE.SphereGeometry(1, 96, 64);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const labelsEl = $("labels");

function buildSystem(system) {
  const group = new THREE.Group();
  const starRGB = blackbodyRGB(system.star.temperature);
  const starColor = new THREE.Vector3(...starRGB);
  const starMesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({ vertexShader: S.surfaceVertex, fragmentShader: S.sunFragment, uniforms: { uColor: { value: starColor }, uTime: { value: 0 } } }));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    vertexShader: S.glowVertex, fragmentShader: S.glowFragment, uniforms: { uColor: { value: starColor }, uStrength: { value: 1.4 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(starMesh, glow);
  const planets = system.planets.map((p, k) => {
    const mesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
      vertexShader: S.surfaceVertex, fragmentShader: S.planetFragment,
      uniforms: { uKind: { value: KIND[p.kind] }, uColor: { value: new THREE.Vector3(...p.color) }, uLightDir: { value: new THREE.Vector3(1, 0, 0) }, uLightColor: { value: new THREE.Vector3(...starRGB) }, uSeed: { value: (system.star.index || 0) * 0.37 + k * 3.1 }, uTime: { value: 0 } },
    }));
    group.add(mesh);
    let ring = null;
    if (p.rings) {
      ring = new THREE.Mesh(new THREE.RingGeometry(p.rings[0], p.rings[1], 256, 1), new THREE.ShaderMaterial({
        vertexShader: S.surfaceVertex, fragmentShader: S.ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Vector3(...p.color) }, uLightDir: mesh.material.uniforms.uLightDir, uLightColor: mesh.material.uniforms.uLightColor, uCenter: { value: new THREE.Vector3() }, uRadius: { value: p.radius }, uInner: { value: p.rings[0] }, uOuter: { value: p.rings[1] } },
      }));
      group.add(ring);
    }
    // Orbit line, relative to the star.
    const pts = [];
    for (let s = 0; s <= 256; s++) pts.push(new THREE.Vector3(...p.at(2451545 + (s / 256) * p.periodDays)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.real ? 0x5c6f8f : 0x7a6a50, transparent: true, opacity: 0.45 }));
    line.frustumCulled = false;
    group.add(line);
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = p.name;
    labelsEl.append(label);
    const pole = new THREE.Vector3(...p.pole);
    return {
      p, mesh, ring, line, label, spin: SPIN_DAYS[p.name] ?? 0.5 + ((k * 0.73) % 2.5),
      tilt: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, pole), ringTilt: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pole),
    };
  });
  const starLabel = document.createElement("div");
  starLabel.className = "label star";
  starLabel.textContent = system.star.name;
  labelsEl.append(starLabel);
  scene.add(group);
  return { system, group, starMesh, glow, planets, starLabel, starRGB };
}

function dropSystem(view) {
  scene.remove(view.group);
  view.group.traverse((o) => { if (o.geometry && o.geometry !== sphere) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  view.planets.forEach((pl) => pl.label.remove());
  view.starLabel.remove();
}

// ---------- simulation state ----------
const sim = { jd: julianDate(Date.now()), tau: 0, warp: 1, pos: [0, 0, 0], beta: [0, 0, 0], orbit: null, travel: null, nose: [0, 1, 0] };
let views = [];
let current = null; // the system you are in

function setSystem(system) {
  views.forEach(dropSystem);
  current = system;
  views = [buildSystem(system)];
  renderDestinations();
}

function standoff(p) {
  return Math.max(3 * p.radius, p.rings ? p.rings[1] * 1.25 : 0);
}

function parkDistance(system) {
  const first = system.planets.length ? Math.hypot(...system.planets[0].at(sim.jd)) : 0;
  return Math.max(40 * system.star.radius, system.star.name === "Sun" ? 1.4 * AU : 1.3 * first);
}

// Circular orbit round a body (a planet, or a star) at radius r, in the ecliptic plane.
function enterOrbit(body, center, r) {
  const c = center(sim.jd);
  let d = sub(sim.pos, c);
  d = unit([d[0], d[1], 0]);
  if (!Number.isFinite(d[0])) d = [1, 0, 0];
  sim.orbit = { body, center, r0: scale(d, r), v0: scale(unit(cross([0, 0, 1], d)), circularSpeed(body.gm, r)), jd0: sim.jd };
  sim.beta = [0, 0, 0];
  setWarp(r < 1e6 ? 60 : 3600);
}

function orbitPlanet(system, p) {
  enterOrbit(p, (jd) => bodyPosition(system, p, jd), standoff(p));
}

// Plans a flip-and-burn trip to a destination: { kind: "planet", planet } or { kind: "star", index, name }.
function plan(dest, accel) {
  const start = sim.pos.slice();
  if (dest.kind === "planet") {
    let T = 0, aim;
    for (let k = 0; k < 8; k++) {
      const c = bodyPosition(current, dest.planet, sim.jd + T / DAY);
      aim = add(c, scale(unit(sub(start, c)), standoff(dest.planet)));
      T = planTrip(norm(sub(aim, start)), accel).homeTime;
    }
    return { start, aim, tr: planTrip(norm(sub(aim, start)), accel), system: current };
  }
  const system = dest.index < 0 ? solSystem() : madeUpSystem(stars, dest.index, dest.name);
  const sp = system.star.pos;
  const aim = add(sp, scale(unit(sub(start, sp)), parkDistance(system)));
  return { start, aim, tr: planTrip(norm(sub(aim, start)), accel), system };
}

function depart(dest) {
  const accel = Number($("accel").value) * G0;
  const pl = plan(dest, accel);
  if (pl.tr.distance < 1) return;
  const realSeconds = Number($("duration").value);
  sim.orbit = null;
  sim.travel = { ...pl, dest, t: 0, tau0: sim.tau, jd0: sim.jd, dir: unit(sub(pl.aim, pl.start)), warp: Math.max(1, pl.tr.homeTime / realSeconds) };
  if (pl.system !== current) views.push(buildSystem(pl.system));
  chaseCamera(sim.travel.dir);
  renderDestinations();
}

function arrive() {
  const tv = sim.travel;
  sim.travel = null;
  sim.pos = tv.aim.slice();
  sim.beta = [0, 0, 0];
  if (tv.system !== current) {
    const keep = views.find((v) => v.system === tv.system);
    views.filter((v) => v !== keep).forEach(dropSystem);
    views = [keep];
    current = tv.system;
  }
  if (tv.dest.kind === "planet") orbitPlanet(current, tv.dest.planet);
  else { const st = current.star; enterOrbit(st, () => st.pos, norm(sub(sim.pos, st.pos))); }
  renderDestinations();
}

function setWarp(w) {
  sim.warp = w;
  document.querySelectorAll("#warp button").forEach((b) => b.classList.toggle("on", Number(b.dataset.w) === w));
}

function chaseCamera(dir) {
  let side = cross(dir, [0, 0, 1]);
  side = norm(side) < 1e-6 ? [1, 0, 0] : unit(side);
  const up = cross(side, dir);
  camera.position.set(...add(add(scale(dir, -0.3), scale(side, 0.13)), scale(up, 0.09)));
  controls.update();
}

// ---------- each frame ----------
function step(dt) {
  const tv = sim.travel;
  if (tv) {
    tv.t = Math.min(tv.tr.homeTime, tv.t + dt * tv.warp);
    const st = tripAt(tv.tr, tv.t);
    sim.pos = add(tv.start, scale(tv.dir, st.x));
    sim.beta = scale(tv.dir, st.beta);
    sim.jd = tv.jd0 + tv.t / DAY;
    sim.tau = tv.tau0 + st.tau;
    sim.nose = st.braking ? scale(tv.dir, -1) : tv.dir;
    tv.state = st;
    if (tv.t >= tv.tr.homeTime) arrive();
    return;
  }
  sim.jd += (dt * sim.warp) / DAY;
  sim.tau += dt * sim.warp;
  if (sim.orbit) {
    const o = sim.orbit;
    const rel = propagate(o.r0, o.v0, o.body.gm, (sim.jd - o.jd0) * DAY);
    sim.pos = add(o.center(sim.jd), rel.r);
    sim.nose = unit(rel.v);
  }
}

const tmpV = new THREE.Vector3();
const spinQ = new THREE.Quaternion();
const shipQ = new THREE.Quaternion();
function place(obj, worldKm) {
  obj.position.set(worldKm[0] - sim.pos[0], worldKm[1] - sim.pos[1], worldKm[2] - sim.pos[2]);
}
function showLabel(el, rel, visible = true) {
  tmpV.set(rel[0], rel[1], rel[2]).project(camera);
  const on = visible && tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05;
  el.style.display = on ? "block" : "none";
  if (on) el.style.transform = `translate(${((tmpV.x + 1) / 2) * innerWidth}px, ${((1 - tmpV.y) / 2) * innerHeight}px)`;
}

function draw(dt, now) {
  const b = norm(sim.beta);
  starUniforms.uObserver.value.set(sim.pos[0] / PC, sim.pos[1] / PC, sim.pos[2] / PC);
  skyUniforms.uBeta.value.set(...sim.beta);
  skyUniforms.uGamma.value = gammaOf(Math.min(b, 0.999999));
  sky.position.copy(camera.position);
  if (points) points.position.copy(camera.position);
  const camDist = camera.position.length();
  for (const v of views) {
    const s = v.system.star;
    const sRel = sub(s.pos, sim.pos);
    const sDist = norm(sRel);
    place(v.starMesh, s.pos);
    v.starMesh.scale.setScalar(s.radius);
    v.starMesh.material.uniforms.uTime.value = now;
    v.glow.position.copy(v.starMesh.position);
    v.glow.quaternion.copy(camera.quaternion);
    v.glow.scale.setScalar(s.radius * 12);
    const near = sDist < 3000 * AU;
    v.group.visible = near;
    showLabel(v.starLabel, sRel, near && sDist > 20 * s.radius);
    for (const pl of v.planets) {
      const pos = bodyPosition(v.system, pl.p, sim.jd);
      place(pl.mesh, pos);
      pl.mesh.scale.setScalar(pl.p.radius);
      spinQ.setFromAxisAngle(Y_AXIS, ((sim.jd % Math.abs(pl.spin)) / pl.spin) * 2 * Math.PI);
      pl.mesh.quaternion.copy(pl.tilt).multiply(spinQ);
      const u = pl.mesh.material.uniforms;
      u.uLightDir.value.set(...unit(sub(s.pos, pos)));
      u.uTime.value = sim.jd * DAY;
      if (pl.ring) { pl.ring.position.copy(pl.mesh.position); pl.ring.quaternion.copy(pl.ringTilt); pl.ring.material.uniforms.uCenter.value.copy(pl.mesh.position); }
      place(pl.line, s.pos);
      pl.line.visible = camDist > 2e5;
      const rel = sub(pos, sim.pos);
      showLabel(pl.label, rel, near && norm(rel) > 12 * pl.p.radius);
    }
  }
  // Light on the ship from the nearest star.
  const host = (current || views[0].system).star;
  const toStar = sub(host.pos, sim.pos);
  const dStar = norm(toStar);
  sunLight.position.set(...unit(toStar));
  sunLight.color.setRGB(...views[0].starRGB);
  sunLight.intensity = 3 * Math.max(0.02, Math.min(1, ((host.luminosity || 1) * (AU / dStar) ** 2) ** 0.35));
  // Ship attitude: nose along the thrust (or prograde in orbit), turning smoothly through the flip.
  shipQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...sim.nose));
  ship.group.quaternion.slerp(shipQ, 1 - Math.exp(-dt * 1.5));
  ship.hub.rotation.y += dt * 0.25;
  const thrust = sim.travel ? 1 : 0;
  ship.plumeMat.uniforms.uThrust.value += (thrust - ship.plumeMat.uniforms.uThrust.value) * Math.min(1, dt * 3);
  ship.plumeMat.uniforms.uTime.value = now;
  controls.update();
  renderer.render(scene, camera);
}

// ---------- read-outs ----------
const fmtDist = (km) => (km > 0.05 * LY ? `${(km / LY).toFixed(km > 10 * LY ? 1 : 2)} ly` : km > 0.01 * AU ? `${(km / AU).toFixed(km > 10 * AU ? 1 : 3)} au` : `${Math.round(km).toLocaleString()} km`);
function fmtSpan(s) {
  const y = Math.floor(s / (365.25 * DAY)); s -= y * 365.25 * DAY;
  const d = Math.floor(s / DAY); s -= d * DAY;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${y ? `${y} y ` : ""}${d || y ? `${d} d ` : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const fmtLong = (s) => (s > 2 * 365.25 * DAY ? `${(s / (365.25 * DAY)).toFixed(1)} years` : s > 2 * DAY ? `${(s / DAY).toFixed(1)} days` : `${(s / 3600).toFixed(1)} hours`);

function hud() {
  const tv = sim.travel;
  const b = norm(sim.beta);
  $("date").textContent = dateFromJulian(sim.jd).toISOString().slice(0, 16).replace("T", " ") + " UT";
  $("aboard").textContent = fmtSpan(sim.tau);
  $("speed").textContent = b > 0.001 ? `${b.toFixed(b > 0.99 ? 5 : 3)} c` : tv ? `${(b * C).toFixed(1)} km/s` : "orbiting";
  $("gamma").textContent = b > 1e-4 ? gammaOf(b).toFixed(b > 0.9 ? 3 : 5) : "1";
  $("togo").textContent = tv ? fmtDist(norm(sub(tv.aim, sim.pos))) : "-";
  $("phase").textContent = tv ? (tv.state && tv.state.braking ? "Braking, engine first" : "Accelerating") : sim.orbit ? `In orbit round ${sim.orbit.body.name}` : "";
  $("warp").hidden = Boolean(tv);
  $("tripwarp").textContent = tv ? `Time ×${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(tv.warp)}` : "";
}

// ---------- destinations ----------
let selected = null;
function renderDestinations() {
  const here = $("here"), far = $("far");
  here.innerHTML = far.innerHTML = "";
  if (!current || !stars) return;
  $("system").textContent = current.star.name === "Sun" ? "Solar system" : `${current.star.name} (made-up planets)`;
  for (const p of current.planets) {
    const b = document.createElement("button");
    b.className = "dest";
    b.innerHTML = `<span>${p.name}</span><small>${p.real ? "planet" : `made-up, ${p.teq} K`}</small>`;
    b.onclick = () => select({ kind: "planet", planet: p, name: p.name });
    here.append(b);
  }
  const list = FAMOUS.map((name) => meta.named.find((n) => n.name === name)).filter(Boolean).map((n) => ({ kind: "star", index: n.i, name: n.name }));
  if (current.star.name !== "Sun") list.unshift({ kind: "star", index: -1, name: "Sun" });
  const pos = (d) => (d.index < 0 ? [0, 0, 0] : [stars.x[d.index] * PC, stars.y[d.index] * PC, stars.z[d.index] * PC]);
  list.filter((d) => d.name !== current.star.name).map((d) => ({ d, dist: norm(sub(pos(d), sim.pos)) })).sort((a, b) => a.dist - b.dist)
    .forEach(({ d, dist }) => {
      const b = document.createElement("button");
      b.className = "dest";
      b.innerHTML = `<span>${d.name}</span><small>${fmtDist(dist)}</small>`;
      b.onclick = () => select(d);
      far.append(b);
    });
  if (selected) select(selected);
}

function select(dest) {
  selected = dest;
  document.querySelectorAll(".dest").forEach((b) => b.classList.toggle("on", b.firstChild.textContent === dest.name));
  const pl = plan(dest, Number($("accel").value) * G0);
  const tr = pl.tr;
  $("preview").hidden = false;
  $("pname").textContent = dest.name;
  $("pdist").textContent = fmtDist(tr.distance);
  $("pship").textContent = fmtLong(tr.shipTime);
  $("phome").textContent = fmtLong(tr.homeTime);
  $("ppeak").textContent = tr.betaPeak > 0.001 ? `${tr.betaPeak.toFixed(tr.betaPeak > 0.99 ? 4 : 3)} c` : `${Math.round(tr.betaPeak * C)} km/s`;
  $("go").disabled = Boolean(sim.travel);
}

$("go").onclick = () => selected && depart(selected);
$("accel").onchange = () => selected && select(selected);
$("face").onclick = () => {
  const dir = sim.travel ? sim.travel.dir : selected ? unit(sub(plan(selected, G0).aim, sim.pos)) : sim.nose;
  chaseCamera(dir);
};
document.querySelectorAll("#warp button").forEach((b) => (b.onclick = () => setWarp(Number(b.dataset.w))));

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  starUniforms.uSize.value = 2.2 * renderScale;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- start: in orbit round Earth, today ----------
await loadStars();
setSystem(solSystem());
orbitPlanet(current, current.planets.find((p) => p.name === "Earth"));
step(0);
$("loading").hidden = true;
let last = performance.now(), lastHud = 0;
function frame(now) {
  keepPace(now);
  const dt = Math.min(1, (now - last) / 1000); // trips and orbits are exact formulas, so big steps are fine
  last = now;
  step(dt);
  draw(dt, now / 1000);
  if (now - lastHud > 100) { hud(); lastHud = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.starhop = { get renderScale() { return renderScale; }, gpuName, sim, depart, select, plan, camera, controls, get current() { return current; }, setWarp };
