// How faithful the physics is, checked against answers known in advance. Run:  node tools/eval.mjs
//   orbits      Kepler's equation, the universal-variable propagator and a leapfrog integrator must agree
//   rocket      the closed-form flip-and-burn trip against a step-by-step integration of the rocket equations
//   sky         aberration and Doppler: the speed-of-light invariants that must hold exactly
//   colour      blackbody chromaticity against CIE Illuminant A, which is defined as a 2856 K blackbody
//   catalog     apparent magnitudes rebuilt from packed positions and absolute magnitudes, against the catalog;
//               distances worked out from spectral type, against the catalog's own good parallaxes
//   planets     dated events the planet model must reproduce
import fs from "node:fs";
import { energy, keplerState, leapfrog, propagate } from "../src/kepler.js";
import { aberrate, trip, tripByIntegration } from "../src/relativity.js";
import { planetPosition, separation, eclipticLonLat } from "../src/solar.js";
import { apparentMagnitude, blackbodyXYZ, chromaticity, readStars } from "../src/stars.js";
import { AU, G0, GM_SUN, LY, julianDate, norm, sub } from "../src/units.js";
import { seeded } from "../src/systems.js";
import { absMagFromType, loadCatalogue } from "./pack_stars.mjs";

const rows = [];
const report = (group, name, value, unit, note = "") => rows.push({ group, name, value, unit, note });
const max = (xs) => Math.max(...xs);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Orbits: 200 random ellipses, one period ahead and 37.3 periods ahead.
{
  const rand = seeded(11);
  const kvp = [], energyDrift = [];
  for (let k = 0; k < 200; k++) {
    const el = { a: (0.3 + rand() * 30) * AU, e: rand() * 0.9, i: rand() * 3, node: rand() * 6.28, argPeri: rand() * 6.28, M: rand() * 6.28 };
    const s0 = keplerState(el, GM_SUN);
    const n = Math.sqrt(GM_SUN / el.a ** 3);
    for (const dt of [1.7e5, 37.3 * (2 * Math.PI) / n]) {
      const viaK = keplerState({ ...el, M: el.M + n * dt }, GM_SUN).r;
      const viaU = propagate(s0.r, s0.v, GM_SUN, dt).r;
      kvp.push(norm(sub(viaK, viaU)) / el.a);
    }
    if (k < 40) {
      const P = (2 * Math.PI) / n;
      const lf = leapfrog(s0.r, s0.v, GM_SUN, P / 20000, 20000);
      energyDrift.push(Math.abs(energy(lf.r, lf.v, GM_SUN) / energy(s0.r, s0.v, GM_SUN) - 1));
    }
  }
  report("orbits", "Kepler vs propagator, worst position gap", max(kvp), "of the orbit's size");
  report("orbits", "leapfrog energy drift over one orbit, worst", max(energyDrift), "relative", "20,000 steps an orbit");
}

// Rocket: the trips the page offers.
{
  const errs = [];
  for (const [dist, g] of [[4.24 * LY, 1], [8.6 * LY, 1], [25 * LY, 1], [640 * LY, 1], [1.4 * AU, 0.1], [9.5 * AU, 1], [4.24 * LY, 5]]) {
    const a = g * G0, exact = trip(dist, a), num = tripByIntegration(dist, a, 4000);
    errs.push(Math.abs(num.shipTime / exact.shipTime - 1), Math.abs(num.homeTime / exact.homeTime - 1), Math.abs(num.gammaPeak / exact.gammaPeak - 1));
  }
  report("rocket", "closed form vs integration, worst", max(errs), "relative");
  const ac = trip(4.37 * LY, G0);
  report("rocket", "Alpha Centauri at 1 g: time aboard", ac.shipTime / (365.25 * 86400), "years", `${(ac.homeTime / (365.25 * 86400)).toFixed(2)} years at home, top speed ${ac.betaPeak.toFixed(4)} c`);
}

// Sky: unit length kept, beta then -beta undoes itself, Doppler factors multiply to 1.
{
  const rand = seeded(5);
  const len = [], undo = [], dd = [];
  for (let k = 0; k < 20000; k++) {
    const u = 2 * rand() - 1, t = 2 * Math.PI * rand(), s = Math.sqrt(1 - u * u);
    const n = [s * Math.cos(t), s * Math.sin(t), u];
    const b = 0.999 * Math.cbrt(rand());
    const bu = [rand() - 0.5, rand() - 0.5, rand() - 0.5], bn = norm(bu);
    const beta = bu.map((x) => (x / bn) * b);
    const a = aberrate(n, beta), back = aberrate(a.n, beta.map((x) => -x));
    len.push(Math.abs(norm(a.n) - 1));
    undo.push(norm(sub(back.n, n)));
    dd.push(Math.abs(a.D * back.D - 1));
  }
  report("sky", "seen directions stay unit length, worst", max(len), "");
  report("sky", "aberrating by beta then -beta, worst direction gap", max(undo), "radians");
  report("sky", "Doppler there and back multiply to 1, worst", max(dd), "");
}

// Colour: CIE Illuminant A is (0.44757, 0.40745) by definition; D65 sits near the 6500 K blackbody.
{
  const [x, y] = chromaticity(blackbodyXYZ(2856));
  report("colour", "2856 K blackbody vs Illuminant A chromaticity", Math.hypot(x - 0.44757, y - 0.40745), "xy distance", `(${x.toFixed(4)}, ${y.toFixed(4)})`);
}

// Catalog: apparent magnitude from the packed numbers, against the catalogue's own.
{
  const metaJ = JSON.parse(fs.readFileSync(new URL("../data/stars.json", import.meta.url)));
  const buf = fs.readFileSync(new URL("../data/stars.bin", import.meta.url));
  const st = readStars(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), metaJ);
  const d = metaJ.check.map(({ i, mag }) => Math.abs(apparentMagnitude(st.absMag[i], Math.hypot(st.x[i], st.y[i], st.z[i])) - mag));
  report("catalog", "rebuilt apparent magnitude, median gap", median(d), "magnitudes", `${metaJ.check.length} stars`);
  report("catalog", "rebuilt apparent magnitude, worst gap", max(d), "magnitudes");
  const from = metaJ.distances;
  report("catalog", "stars placed by parallax", from.parallax, "stars", `${from.type} by spectral type, ${(from.colour || 0) + (from["weak parallax"] || 0)} another way`);
  // Main-sequence stars with a parallax of 0.05" or more: the distance their type gives, over the measured one.
  const ratios = [];
  for (const s of loadCatalogue()) {
    const plx = parseFloat(s.Parallax);
    if (plx >= 0.05 && s.LuminosityCls === "V") ratios.push(10 ** ((parseFloat(s.Vmag) - absMagFromType(s.SpectralCls, "V") + 5) / 5) * plx);
  }
  report("catalog", "distance by spectral type / by parallax, median", median(ratios), "", `${ratios.length} main-sequence stars`);
  report("catalog", "share of those within a factor of 1.5", (100 * ratios.filter((r) => r > 1 / 1.5 && r < 1.5).length) / ratios.length, "%");
}

// Planets: three dated events. Each is found by searching the model hour by hour.
{
  const jd = (s) => julianDate(Date.parse(s));
  const search = (centre, hours, f) => { let best = [Infinity, 0]; for (let h = -hours; h <= hours; h++) { const v = f(jd(centre) + h / 24); if (v < best[0]) best = [v, h]; } return best; };
  const gc = search("2020-12-21T12:00:00Z", 96, (t) => { const e = planetPosition("Earth", t); return separation(e, planetPosition("Jupiter", t), planetPosition("Saturn", t)); });
  report("planets", "Jupiter-Saturn great conjunction, Dec 2020: closest gap", gc[0] * 60, "arcminutes", `model's closest is ${gc[1] >= 0 ? "+" : ""}${gc[1]} h from 21 Dec 12:00 UT`);
  const mo = search("2020-10-13T12:00:00Z", 120, (t) => Math.abs(eclipticLonLat(planetPosition("Mars", t))[0] - eclipticLonLat(planetPosition("Earth", t))[0]));
  report("planets", "Mars opposition, 13 Oct 2020", mo[1] / 24, "days from noon UT that day");
  const vt = separation(planetPosition("Earth", jd("2012-06-06T01:30:00Z")), planetPosition("Venus", jd("2012-06-06T01:30:00Z")), [0, 0, 0]);
  report("planets", "Venus transit, 6 Jun 2012 01:30 UT: Venus from the Sun's centre", vt * 60, "arcminutes", "the Sun's disc is about 15.8 arcminutes in radius");
}

const fmt = (v) => (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(1) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
let group = "";
for (const r of rows) {
  if (r.group !== group) { console.log(`\n${r.group}`); group = r.group; }
  console.log(`  ${r.name}: ${fmt(r.value)} ${r.unit}${r.note ? `  (${r.note})` : ""}`);
}
if (process.argv.includes("--json")) fs.writeFileSync("eval.json", JSON.stringify(rows, null, 1));
