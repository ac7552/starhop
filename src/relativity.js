// Special relativity for a ship under constant thrust, and for the sky it sees.
//
// Trips are "flip and burn": accelerate at a constant proper acceleration a (what the crew feels) to the
// midpoint, turn round, and brake at a. For that motion there are exact formulas (the relativistic rocket):
//   ship time  tau,  home time t = (c/a) sinh(a tau / c),  distance x = (c^2/a)(cosh(a tau / c) - 1),
//   speed beta = tanh(a tau / c).
// The sky changes with speed: starlight arriving from direction n (pointing to the star) is seen from a ship
// moving at velocity beta (in units of c) along a different direction n' (aberration), with every frequency
// multiplied by D = gamma (1 + beta . n) (Doppler). Stars ahead crowd forward, turn bluer and brighter.
import { C, dot, norm } from "./units.js";

export const gammaOf = (beta) => 1 / Math.sqrt(1 - beta * beta);

// Direction of a star as seen from the ship, and its Doppler factor. n: unit vector toward the star in the
// home frame; beta: ship velocity / c (vector, |beta| < 1).
export function aberrate(n, beta) {
  const b = norm(beta);
  if (b < 1e-15) return { n: n.slice(), D: 1 };
  const bh = beta.map((x) => x / b);
  const g = gammaOf(b);
  const nb = dot(n, bh);
  const D = g * (1 + b * nb);
  const k = (g - 1) * nb + g * b;
  return { n: n.map((x, i) => (x + k * bh[i]) / D), D };
}

// Exact flip-and-burn trip over a distance (km) at proper acceleration a (km/s^2).
export function trip(distance, a) {
  const half = distance / 2;
  const tauHalf = (C / a) * Math.acosh(1 + (a * half) / (C * C));
  const tHalf = (C / a) * Math.sinh((a * tauHalf) / C);
  const gammaPeak = 1 + (a * half) / (C * C);
  return {
    distance, a,
    shipTime: 2 * tauHalf,
    homeTime: 2 * tHalf,
    gammaPeak,
    betaPeak: Math.sqrt(1 - 1 / (gammaPeak * gammaPeak)),
  };
}

// Where the ship is on the trip at home time t (seconds since departure): distance covered, speed and
// ship time. Second half mirrors the first.
export function tripAt(tr, t) {
  const { a, distance } = tr;
  const leg = (tt) => {
    const tau = (C / a) * Math.asinh((a * tt) / C);
    return { x: ((C * C) / a) * (Math.cosh((a * tau) / C) - 1), beta: Math.tanh((a * tau) / C), tau };
  };
  if (t <= 0) return { x: 0, beta: 0, tau: 0, braking: false };
  if (t >= tr.homeTime) return { x: distance, beta: 0, tau: tr.shipTime, braking: true };
  if (t <= tr.homeTime / 2) return { ...leg(t), braking: false };
  const back = leg(tr.homeTime - t);
  return { x: distance - back.x, beta: back.beta, tau: tr.shipTime - back.tau, braking: true };
}

// The same trip by brute force: integrates the rocket's equations in ship time with RK4. Used to check trip().
export function tripByIntegration(distance, a, steps = 20000) {
  // State: x (km), u = gamma * v (km/s), t (s); d/dtau: x' = u, u' = +-a gamma, t' = gamma.
  const accelLeg = (tauEnd, u0, sign) => {
    let x = 0, u = u0, t = 0;
    const h = tauEnd / steps;
    const f = (uu) => { const g = Math.sqrt(1 + (uu * uu) / (C * C)); return [uu, sign * a * g, g]; };
    for (let k = 0; k < steps; k++) {
      const k1 = f(u), k2 = f(u + (h / 2) * k1[1]), k3 = f(u + (h / 2) * k2[1]), k4 = f(u + h * k3[1]);
      x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      t += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      u += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    }
    return { x, u, t };
  };
  // Find the ship time to the midpoint by bisection on distance covered.
  let lo = 0, hi = 1;
  while (accelLeg(hi, 0, 1).x < distance / 2) hi *= 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (accelLeg(mid, 0, 1).x < distance / 2) lo = mid; else hi = mid;
  }
  const first = accelLeg(lo, 0, 1);
  return { shipTime: 2 * lo, homeTime: 2 * first.t, gammaPeak: Math.sqrt(1 + (first.u * first.u) / (C * C)) };
}
