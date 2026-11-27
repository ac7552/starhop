import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { keplerState, propagate, solveKepler } from "../src/kepler.js";
import { aberrate, gammaOf, trip, tripAt, tripByIntegration } from "../src/relativity.js";
import { BODIES, planetPosition, separation } from "../src/solar.js";
import { apparentMagnitude, blackbodyRGB, blackbodyXYZ, bvToTemperature, chromaticity, readStars } from "../src/stars.js";
import { madeUpSystem, solSystem } from "../src/systems.js";
import { AU, G0, GM_SUN, LY, YEAR, julianDate, norm, sub } from "../src/units.js";
import { absMagFromType, loadCatalogue, pack } from "../tools/pack_stars.mjs";

const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("Kepler's equation is solved even for nearly parabolic orbits", () => {
  for (const e of [0, 0.3, 0.9, 0.999]) for (const M of [-3, -0.1, 0.5, 2.9]) {
    const E = solveKepler(M, e);
    close(E - e * Math.sin(E), M, 1e-12, `e=${e} M=${M}`);
  }
});

test("the propagator and Kepler's equation put Mercury in the same place a year later", () => {
  const el = { a: 0.387 * AU, e: 0.2056, i: 0.122, node: 0.843, argPeri: 0.508, M: 1 };
  const s0 = keplerState(el, GM_SUN);
  const n = Math.sqrt(GM_SUN / el.a ** 3);
  const k = keplerState({ ...el, M: el.M + n * YEAR }, GM_SUN).r;
  const u = propagate(s0.r, s0.v, GM_SUN, YEAR).r;
  assert.ok(norm(sub(k, u)) < 1, `${norm(sub(k, u))} km apart`);
});

test("the propagator handles escape orbits", () => {
  const r = [AU, 0, 0], v = [0, 60, 0]; // faster than escape speed at 1 au (42.1 km/s)
  const a = propagate(r, v, GM_SUN, 1e7), b = propagate(propagate(r, v, GM_SUN, 4e6).r, propagate(r, v, GM_SUN, 4e6).v, GM_SUN, 6e6);
  assert.ok(norm(sub(a.r, b.r)) < 1e-3 * norm(a.r));
  assert.ok(norm(a.r) > 2 * AU);
});

test("a flip-and-burn trip matches a step-by-step integration of the rocket", () => {
  const exact = trip(4.24 * LY, G0), num = tripByIntegration(4.24 * LY, G0, 3000);
  close(num.shipTime / exact.shipTime, 1, 1e-9, "ship time");
  close(num.homeTime / exact.homeTime, 1, 1e-9, "home time");
  close(exact.shipTime / YEAR, 3.55, 0.05, "about 3.5 years aboard to Proxima at 1 g");
});

test("halfway through a trip the ship is at the midpoint and at top speed", () => {
  const tr = trip(10 * LY, G0);
  const mid = tripAt(tr, tr.homeTime / 2);
  close(mid.x / tr.distance, 0.5, 1e-9, "position");
  close(mid.beta, tr.betaPeak, 1e-9, "speed");
  close(gammaOf(mid.beta), tr.gammaPeak, 1e-6, "gamma");
  assert.equal(tripAt(tr, tr.homeTime).x, tr.distance);
});

test("a short hop stays slow and takes the Newtonian time", () => {
  const tr = trip(0.52 * AU, G0); // Earth to Mars at closest, roughly
  close(tr.homeTime / tr.shipTime, 1, 3e-6, "time dilation of a few parts per million");
  close(tr.homeTime / (2 * Math.sqrt(tr.distance / G0)), 1, 3e-6, "t = 2 sqrt(d / a), plus that much");
});

test("starlight ahead crowds forward and turns blue; behind it fades and reddens", () => {
  const beta = [0, 0, 0.9];
  const ahead = aberrate([0, 0, 1], beta), behind = aberrate([0, 0, -1], beta), side = aberrate([1, 0, 0], beta);
  close(ahead.D, Math.sqrt(1.9 / 0.1), 1e-12, "head-on Doppler");
  close(behind.D, Math.sqrt(0.1 / 1.9), 1e-12, "tail Doppler");
  assert.ok(side.n[2] > 0.89, "a star at the side is seen well forward");
});

test("blackbody colours follow the Planckian locus", () => {
  const [x, y] = chromaticity(blackbodyXYZ(2856));
  assert.ok(Math.hypot(x - 0.44757, y - 0.40745) < 0.003, `Illuminant A at (${x}, ${y})`);
  const cool = blackbodyRGB(3000), hot = blackbodyRGB(20000);
  assert.ok(cool[0] > cool[2] && hot[2] > hot[0]);
  close(bvToTemperature(0.656), 5772, 100, "the Sun's colour index gives the Sun's temperature");
});

test("the packed catalog reproduces the catalog's own magnitudes", () => {
  const meta = JSON.parse(fs.readFileSync(new URL("../data/stars.json", import.meta.url)));
  const buf = fs.readFileSync(new URL("../data/stars.bin", import.meta.url));
  const st = readStars(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
  for (const { i, mag } of meta.check) close(apparentMagnitude(st.absMag[i], Math.hypot(st.x[i], st.y[i], st.z[i])), mag, 0.01, `star ${i}`);
  const sirius = meta.named.find((n) => n.name === "Sirius");
  // The catalogue's 1991 parallax of 0.375" puts Sirius at 8.70 light years; today's value is 8.60.
  close(Math.hypot(st.x[sirius.i], st.y[sirius.i], st.z[sirius.i]) * 3.26156, 8.7, 0.05, "Sirius is 8.7 light years away by this catalogue");
});

test("the packed files are what the packer makes from the catalogue", () => {
  const { bin, meta } = pack(loadCatalogue());
  const onDisk = fs.readFileSync(new URL("../data/stars.bin", import.meta.url));
  assert.ok(Buffer.from(bin.buffer).equals(onDisk), "data/stars.bin is stale: run node tools/pack_stars.mjs");
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL("../data/stars.json", import.meta.url))), JSON.parse(JSON.stringify(meta)));
});

test("distances worked out from spectral type agree with good parallaxes for main-sequence stars", () => {
  const ratios = [];
  for (const s of loadCatalogue()) {
    const plx = parseFloat(s.Parallax);
    if (!(plx >= 0.05) || s.LuminosityCls !== "V") continue;
    ratios.push(10 ** ((parseFloat(s.Vmag) - absMagFromType(s.SpectralCls, "V") + 5) / 5) * plx);
  }
  ratios.sort((a, b) => a - b);
  assert.ok(ratios.length > 200, `${ratios.length} stars to check`);
  close(ratios[Math.floor(ratios.length / 2)], 1, 0.15, "median of distance by type / distance by parallax");
  const near = ratios.filter((r) => r > 1 / 1.5 && r < 1.5).length / ratios.length;
  assert.ok(near > 0.8, `${(near * 100).toFixed(0)}% within a factor of 1.5`);
});

test("planets: Venus crossed the Sun in June 2012 and Jupiter met Saturn in December 2020", () => {
  const t = julianDate(Date.parse("2012-06-06T01:30:00Z"));
  assert.ok(separation(planetPosition("Earth", t), planetPosition("Venus", t), [0, 0, 0]) < 15.8 / 60);
  const u = julianDate(Date.parse("2020-12-21T18:00:00Z"));
  assert.ok(separation(planetPosition("Earth", u), planetPosition("Jupiter", u), planetPosition("Saturn", u)) < 0.15);
  close(norm(planetPosition("Earth", u)) / AU, 0.984, 0.003, "Earth near perihelion in December");
});

test("made-up planetary systems are the same every time and sit outside their star", () => {
  const meta = JSON.parse(fs.readFileSync(new URL("../data/stars.json", import.meta.url)));
  const buf = fs.readFileSync(new URL("../data/stars.bin", import.meta.url));
  const st = readStars(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
  for (const i of [0, 3, 9, 6, 9000]) {
    const a = madeUpSystem(st, i, "x"), b = madeUpSystem(st, i, "x");
    assert.deepEqual(a.planets.map((p) => p.at(2460000)), b.planets.map((p) => p.at(2460000)));
    for (const p of a.planets) assert.ok(norm(p.at(2460000)) > 2 * a.star.radius, `star ${i}: ${p.name} inside its star`);
  }
  assert.equal(solSystem().planets.length, 8);
  assert.ok(BODIES.Saturn.rings[0] > BODIES.Saturn.radius);
});
