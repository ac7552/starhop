// Packs the Yale Bright Star Catalogue (data/bsc5/bsc5.json, MIT, from
// https://github.com/brettonw/YaleBrightStarCatalog) into data/stars.bin and data/stars.json.
//
// The catalogue gives every star a position on the sky, a visual magnitude and (mostly) a B-V colour, but a
// parallax for only about a third of them, and its parallaxes are ground-based ones from before 1991, good
// to roughly 0.008 arcseconds. So a star's distance comes from:
//   1. its parallax, when that is at least 0.040 arcseconds (five times the typical error). The one
//      exception: a giant or supergiant whose parallax would put it more than three times nearer than its
//      spectral type allows. The old parallaxes of faint giants are often far too large, so those use 2;
//   2. otherwise its spectral type and luminosity class: these give an absolute magnitude (the MK
//      calibration below), and the distance follows from m - M = 5 log10(d / 10 pc);
//   3. otherwise (no usable spectral type) its parallax if at least 0.010 arcseconds, else its colour.
// Dimming by interstellar dust is ignored, so far-off stars come out somewhat too far.
// Positions are turned from the J2000 equatorial frame into the J2000 ecliptic frame the planets use.
// Run:  node tools/pack_stars.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const EPS = (23.4392911 * Math.PI) / 180; // obliquity of the ecliptic at J2000
export const GOOD_PARALLAX = 0.04; // arcseconds
const GIANT_DISAGREEMENT = 3; // a giant's parallax is dropped when its type puts it this many times further
const WEAK_PARALLAX = 0.01;

// Spectral type as a number: O0 = 0, B0 = 10, A0 = 20, F0 = 30, G0 = 40, K0 = 50, M0 = 60.
const LETTER = { O: 0, B: 10, A: 20, F: 30, G: 40, K: 50, M: 60 };
export function spectralCode(cls) {
  if (!cls) return null;
  const m = /^([OBAFGKM])(\d+(?:\.\d+)?)?(?:-(\d+(?:\.\d+)?))?/.exec(cls);
  if (!m) return null;
  const sub = m[2] === undefined ? 5 : m[3] === undefined ? +m[2] : (+m[2] + +m[3]) / 2;
  return LETTER[m[1]] + Math.min(9.5, sub);
}

// Absolute visual magnitude by spectral type for each luminosity class: rounded values of the standard MK
// calibration (as tabulated by Schmidt-Kaler 1982 and in Allen's Astrophysical Quantities), as
// [spectral code, M_V] pairs joined by straight lines.
const MV = {
  V: [[5, -5.7], [9, -4.5], [10, -4.0], [12, -2.45], [15, -1.2], [18, -0.25], [20, 0.65], [22, 1.3], [25, 1.95], [30, 2.7], [35, 3.5], [38, 4.0], [40, 4.4], [42, 4.7], [45, 5.1], [48, 5.5], [50, 5.9], [52, 6.4], [55, 7.35], [60, 8.8], [62, 9.9], [65, 12.3]],
  IV: [[10, -4.7], [15, -1.8], [20, 0.3], [25, 1.3], [30, 2.0], [35, 2.3], [40, 2.9], [45, 3.1], [50, 3.1], [52, 3.2]],
  III: [[10, -5.1], [15, -2.2], [20, 0.0], [25, 0.7], [30, 1.5], [35, 1.6], [40, 1.0], [45, 0.9], [50, 0.7], [52, 0.5], [55, -0.2], [60, -0.4], [62, -0.6], [65, -0.3]],
  II: [[10, -5.4], [15, -4.0], [20, -3.0], [25, -2.8], [30, -2.5], [35, -2.3], [55, -2.3], [60, -2.5]],
  Ib: [[10, -6.1], [15, -5.4], [20, -5.2], [25, -4.8], [35, -4.6], [45, -4.5], [50, -4.3], [55, -4.4], [60, -5.6]],
  Iab: [[10, -6.9], [20, -6.5], [40, -6.3], [50, -6.0], [60, -5.9]],
  Ia: [[10, -7.0], [20, -7.1], [30, -8.0], [45, -8.0], [50, -7.5], [60, -7.0]],
};
// B-V colour of a main-sequence star by spectral type, for the stars the catalogue gives no colour.
const BV = [[5, -0.33], [10, -0.3], [15, -0.17], [20, -0.02], [25, 0.15], [30, 0.3], [35, 0.44], [40, 0.58], [45, 0.68], [50, 0.81], [55, 1.15], [60, 1.4], [65, 1.64]];

function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    if (x <= table[k][0]) {
      const [x0, y0] = table[k - 1], [x1, y1] = table[k];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}
const codeFromBV = (bv) => { for (let c = 5; c <= 65; c += 0.5) if (interpolate(BV, c) >= bv) return c; return 65; };

// Absolute magnitude from spectral type and luminosity class, or null when the type can't be read.
// A star with no luminosity class is taken as a giant from G5 on and a dwarf before that, which is what
// most stars bright enough for this catalogue are.
export function absMagFromType(spectralCls, luminosityCls) {
  if (/^[CSN]/.test(spectralCls || "")) return -1.5; // carbon and S stars are cool giants
  const code = spectralCode(spectralCls);
  if (code === null) return null;
  let cls = luminosityCls || (code >= 45 ? "III" : "V");
  if (cls === "I") cls = "Ib";
  return interpolate(MV[cls] || MV.III, code);
}

const distanceFromMags = (vmag, absMag) => 10 ** ((vmag - absMag + 5) / 5);

// Distance in parsecs for one catalogue entry, and how it was found.
export function starDistance(s) {
  const plx = parseFloat(s.Parallax), vmag = parseFloat(s.Vmag);
  const M = absMagFromType(s.SpectralCls, s.LuminosityCls);
  const byType = M === null ? null : distanceFromMags(vmag, M);
  const giant = /^(III|II|I)/.test(s.LuminosityCls || "") && !/^(IV)/.test(s.LuminosityCls || "");
  if (plx >= GOOD_PARALLAX && !(giant && byType !== null && byType * plx > GIANT_DISAGREEMENT)) return { pc: 1 / plx, how: "parallax" };
  if (byType !== null) return { pc: byType, how: "type" };
  if (plx >= WEAK_PARALLAX) return { pc: 1 / plx, how: "weak parallax" };
  const code = codeFromBV(parseFloat(s["B-V"] ?? "0.65"));
  return { pc: distanceFromMags(vmag, interpolate(code >= 45 ? MV.III : MV.V, code)), how: "colour" };
}

export function starColour(s) {
  const bv = parseFloat(s["B-V"]);
  if (Number.isFinite(bv)) return bv;
  const code = spectralCode(s.SpectralCls);
  return code === null ? (/^[CSN]/.test(s.SpectralCls || "") ? 1.8 : 0.65) : interpolate(BV, code);
}

// "06h 45m 08.9s" and "-16° 42′ 58″" (J2000) to a unit vector in the J2000 ecliptic frame.
export function eclipticUnit(ra, dec) {
  const [h, m, sec] = ra.match(/[\d.]+/g).map(Number);
  const [d, am, as] = dec.match(/[\d.]+/g).map(Number);
  const a = ((h + m / 60 + sec / 3600) * 15 * Math.PI) / 180;
  const b = ((dec.trim().startsWith("-") ? -1 : 1) * (d + am / 60 + as / 3600) * Math.PI) / 180;
  const x = Math.cos(b) * Math.cos(a), y = Math.cos(b) * Math.sin(a), z = Math.sin(b);
  return [x, y * Math.cos(EPS) + z * Math.sin(EPS), -y * Math.sin(EPS) + z * Math.cos(EPS)];
}

// Proper names. The catalogue's remarks give traditional names ("SIRIUS; Canicula; Dog Star"); the first is
// used. A few stars are named here by their catalogue (HR) number, where the remarks have no name or an
// older spelling than the one in use today.
const NAMES = { 5459: "Rigil Kentaurus", 5460: "Toliman", 5267: "Hadar", 1084: "Ran", 509: "Tau Ceti", 8085: "61 Cygni A", 8086: "61 Cygni B", 8387: "Epsilon Indi" };
export function properName(s) {
  if (NAMES[s.HR]) return NAMES[s.HR];
  const note = (s.Notes || []).find((n) => n.Category === "Star names");
  if (!note) return "";
  const first = note.Remark.split(/[;,.]/)[0].trim();
  if (!/^[A-Za-z' -]{3,20}$/.test(first)) return "";
  return first.toLowerCase().replace(/(^|[ -])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

export function loadCatalogue() {
  return JSON.parse(fs.readFileSync(new URL("../data/bsc5/bsc5.json", import.meta.url)));
}

export function pack(catalogue) {
  const rows = [];
  const how = {};
  for (const s of catalogue) {
    const vmag = parseFloat(s.Vmag);
    if (!Number.isFinite(vmag) || !s.RA || !s.Dec) continue;
    const { pc, how: method } = starDistance(s);
    how[method] = (how[method] || 0) + 1;
    const u = eclipticUnit(s.RA, s.Dec);
    rows.push({ x: u[0] * pc, y: u[1] * pc, z: u[2] * pc, absMag: vmag - 5 * Math.log10(pc / 10), bv: starColour(s), mag: vmag, dist: pc, name: properName(s), spect: (s.SpectralCls || "") + (s.LuminosityCls || ""), hr: +s.HR, method });
  }
  rows.sort((a, b) => a.mag - b.mag || a.hr - b.hr); // brightest first
  const bin = new Float32Array(rows.length * 5);
  rows.forEach((r, i) => bin.set([r.x, r.y, r.z, r.absMag, r.bv], i * 5));
  const meta = {
    count: rows.length,
    fields: ["x_pc", "y_pc", "z_pc", "absmag", "bv"],
    frame: "J2000 ecliptic, parsecs, origin at the Sun",
    source: "Yale Bright Star Catalogue, 5th revised edition, as JSON from github.com/brettonw/YaleBrightStarCatalog (MIT)",
    distances: how,
    named: rows.flatMap((r, i) => (r.name ? [{ i, name: r.name, dist: +r.dist.toFixed(4), mag: r.mag, spect: r.spect, hr: r.hr, distanceFrom: r.method }] : [])),
    check: rows.flatMap((r, i) => (i % 97 === 0 ? [{ i, mag: r.mag, dist: r.dist }] : [])),
  };
  return { bin, meta, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { bin, meta } = pack(loadCatalogue());
  fs.writeFileSync(new URL("../data/stars.bin", import.meta.url), Buffer.from(bin.buffer));
  fs.writeFileSync(new URL("../data/stars.json", import.meta.url), JSON.stringify(meta));
  console.log(`${meta.count} stars, ${meta.named.length} named; distances from`, meta.distances);
}
