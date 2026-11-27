// The Sun and planets. Positions come from JPL's "Keplerian elements for approximate positions of the major
// planets" (E. M. Standish, Table 1, valid 1800 to 2050 AD, mean ecliptic and equinox of J2000): each element
// changes linearly with time, and the position follows from Kepler's equation. JPL quotes errors of about
// 15 to 600 arcseconds in longitude over that span, worst for Saturn. The Earth row is the Earth-Moon barycentre.
import { AU, DEG, J2000, GM_SUN, OBLIQUITY } from "./units.js";
import { orbitToFrame, solveKepler } from "./kepler.js";

// a (au), e, I (deg), L (deg), long. perihelion (deg), long. node (deg); then the same per Julian century.
export const ELEMENTS = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  Mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

// Radius (km), GM (km^3/s^2) and the look the page draws.
export const BODIES = {
  Sun: { radius: 695700, gm: GM_SUN, kind: "star", temperature: 5772 },
  Mercury: { radius: 2439.7, gm: 22031.8, kind: "rock", color: [0.55, 0.52, 0.5] },
  Venus: { radius: 6051.8, gm: 324858.6, kind: "cloud", color: [0.92, 0.86, 0.7] },
  Earth: { radius: 6371.0, gm: 398600.4, kind: "earth", color: [0.25, 0.42, 0.7] },
  Mars: { radius: 3389.5, gm: 42828.4, kind: "desert", color: [0.75, 0.42, 0.26] },
  Jupiter: { radius: 69911, gm: 126686534, kind: "bands", color: [0.82, 0.72, 0.58] },
  Saturn: { radius: 58232, gm: 37931187, kind: "bands", color: [0.88, 0.8, 0.6], rings: [74500, 140220] },
  Uranus: { radius: 25362, gm: 5793939, kind: "ice", color: [0.62, 0.84, 0.88] },
  Neptune: { radius: 24622, gm: 6836529, kind: "ice", color: [0.32, 0.48, 0.86] },
};

export const PLANETS = Object.keys(ELEMENTS);

// North poles (right ascension, declination in degrees, J2000; IAU working group values), so each planet
// and its rings are tilted as they really are. Saturn's rings sit 27 degrees off its orbit.
export const POLES = { Mercury: [281.01, 61.45], Venus: [272.76, 67.16], Earth: [0, 90], Mars: [317.68, 52.89], Jupiter: [268.06, 64.5], Saturn: [40.59, 83.54], Uranus: [257.31, -15.18], Neptune: [299.36, 43.46] };

// Unit vector (J2000 ecliptic) for a right ascension and declination in degrees.
export function eclipticDirection(raDeg, decDeg) {
  const ra = raDeg * DEG, de = decDeg * DEG;
  const x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de);
  return [x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)];
}

// Elements of one planet at a Julian date, in km and radians, ready for keplerState.
export function planetElements(name, jd) {
  const [e0, rate] = ELEMENTS[name];
  const T = (jd - J2000) / 36525;
  const [a, e, I, L, lp, ln] = e0.map((x, k) => x + rate[k] * T);
  return { a: a * AU, e, i: I * DEG, node: ln * DEG, argPeri: (lp - ln) * DEG, M: (L - lp) * DEG };
}

// Heliocentric position (km, J2000 ecliptic) of a planet at a Julian date.
export function planetPosition(name, jd) {
  const el = planetElements(name, jd);
  const E = solveKepler(el.M, el.e);
  const x = el.a * (Math.cos(E) - el.e);
  const y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return orbitToFrame([x, y], el.i, el.node, el.argPeri);
}

// Heliocentric ecliptic longitude and latitude (degrees) of a position.
export function eclipticLonLat(p) {
  const lon = ((Math.atan2(p[1], p[0]) / DEG) % 360 + 360) % 360;
  return [lon, Math.atan2(p[2], Math.hypot(p[0], p[1])) / DEG];
}

// Angle (degrees) between two directions as seen from a point.
export function separation(from, a, b) {
  const u = a.map((x, k) => x - from[k]);
  const v = b.map((x, k) => x - from[k]);
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}
