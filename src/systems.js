// Star systems you can visit. The Sun's is real (solar.js). Every other star gets made-up planets, seeded by
// its catalog number so a star always has the same ones. Orbits are spaced from the star's luminosity, and
// each planet's type follows from its equilibrium temperature (278 K * L^(1/4) / sqrt(a in au)).
import { AU, GM_SUN, PC } from "./units.js";
import { keplerState } from "./kepler.js";
import { BODIES, ELEMENTS, PLANETS, POLES, eclipticDirection, planetPosition } from "./solar.js";
import { luminosity, radiusSuns } from "./stars.js";

export function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const LETTERS = "bcdefgh";

export function solSystem() {
  return {
    name: "Sun",
    star: { name: "Sun", pos: [0, 0, 0], radius: BODIES.Sun.radius, temperature: 5772, gm: GM_SUN },
    planets: PLANETS.map((name) => ({ name, ...BODIES[name], real: true, pole: eclipticDirection(...POLES[name]), periodDays: 365.25 * ELEMENTS[name][0][0] ** 1.5, at: (jd) => planetPosition(name, jd) })),
  };
}

// A made-up system for catalog star i. stars: the arrays from readStars.
export function madeUpSystem(stars, i, name) {
  const T = stars.temperature[i];
  const L = Math.min(1e5, Math.max(1e-4, luminosity(stars.absMag[i])));
  const R = Math.min(1500, Math.max(0.08, radiusSuns(stars.absMag[i], T)));
  const mass = Math.min(25, Math.max(0.08, L ** (1 / 3.5)));
  const gm = GM_SUN * mass;
  const rand = seeded(i + 7);
  const count = 2 + Math.floor(rand() * 4);
  const inner = Math.max(0.05, 0.35 * Math.sqrt(L), R * 0.00465 * 4); // au, clear of the star itself
  const planets = [];
  let a = inner * (1 + rand());
  for (let k = 0; k < count; k++) {
    const teq = (278 * L ** 0.25) / Math.sqrt(a);
    const big = rand() < (teq < 200 ? 0.75 : 0.25);
    let kind, radius, color;
    if (teq > 900) { kind = "lava"; radius = 3000 + rand() * 5000; color = [0.25, 0.2, 0.18]; }
    else if (big) { kind = teq < 120 ? "ice" : "bands"; radius = kind === "ice" ? 20000 + rand() * 9000 : 45000 + rand() * 30000; color = kind === "ice" ? [0.5 + rand() * 0.2, 0.7 + rand() * 0.2, 0.9] : [0.75 + rand() * 0.2, 0.6 + rand() * 0.2, 0.45 + rand() * 0.2]; }
    else if (teq > 330) { kind = rand() < 0.5 ? "cloud" : "rock"; radius = 2500 + rand() * 5000; color = kind === "cloud" ? [0.9, 0.82, 0.62] : [0.5 + rand() * 0.2, 0.46, 0.42]; }
    else if (teq > 230) { kind = rand() < 0.6 ? "earth" : "desert"; radius = 4000 + rand() * 4000; color = kind === "earth" ? [0.2, 0.38 + rand() * 0.1, 0.62] : [0.7, 0.45, 0.3]; }
    else { kind = "rock"; radius = 1500 + rand() * 3500; color = [0.6, 0.6, 0.62]; }
    const el = { a: a * AU, e: rand() * 0.12, i: (rand() - 0.5) * 0.08, node: rand() * 2 * Math.PI, argPeri: rand() * 2 * Math.PI, M0: rand() * 2 * Math.PI };
    const n = Math.sqrt(gm / el.a ** 3);
    planets.push({
      name: `${name} ${LETTERS[k]}`, kind, radius, color, gm: 398600 * (radius / 6371) ** 3 * (kind === "bands" || kind === "ice" ? 0.25 : 1),
      rings: kind === "bands" && rand() < 0.35 ? [radius * 1.3, radius * 2.3] : null,
      real: false, teq: Math.round(teq), periodDays: (2 * Math.PI) / n / 86400,
      pole: (() => { const t = rand() * 0.5, az = rand() * 2 * Math.PI; return [Math.sin(t) * Math.cos(az), Math.sin(t) * Math.sin(az), Math.cos(t)]; })(),
      at: (jd) => keplerState({ ...el, M: el.M0 + n * (jd - 2451545) * 86400 }, gm).r,
    });
    a *= 1.6 + rand() * 0.9;
  }
  return {
    name,
    star: { name, pos: [stars.x[i] * PC, stars.y[i] * PC, stars.z[i] * PC], radius: R * BODIES.Sun.radius, temperature: T, gm, luminosity: L, index: i },
    planets,
  };
}

// Heliocentric position (km) of a planet in a system at a Julian date.
export const bodyPosition = (system, planet, jd) => {
  const p = planet.at(jd);
  return [system.star.pos[0] + p[0], system.star.pos[1] + p[1], system.star.pos[2] + p[2]];
};
