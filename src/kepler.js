// Two-body orbits, three independent ways, so each can check the others:
//   keplerState      position and velocity from orbital elements, through Kepler's equation
//   propagate        any conic (circle to hyperbola) from a position and velocity, by universal variables
//   leapfrog         a plain step-by-step integrator (kick, drift, kick), which keeps energy bounded
import { cross, dot, norm, scale, add } from "./units.js";

const TAU = 2 * Math.PI;

// Eccentric anomaly E from mean anomaly M (radians) for an ellipse, by Newton's method.
export function solveKepler(M, e) {
  M = ((M % TAU) + TAU + Math.PI) % TAU - Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - M;
    const dE = f / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-15) break;
  }
  return E;
}

// Rotates a vector from the orbit's own plane (x toward periapsis) into the reference frame.
export function orbitToFrame([x, y], i, node, argPeri) {
  const co = Math.cos(argPeri), so = Math.sin(argPeri), cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(i), si = Math.sin(i);
  return [
    (co * cn - so * sn * ci) * x + (-so * cn - co * sn * ci) * y,
    (co * sn + so * cn * ci) * x + (-so * sn + co * cn * ci) * y,
    so * si * x + co * si * y,
  ];
}

// State from elements: a (km), e, i, node, argPeri, mean anomaly M (radians), mu (km^3/s^2). Ellipses only.
export function keplerState({ a, e, i, node, argPeri, M }, mu) {
  const E = solveKepler(M, e);
  const b = a * Math.sqrt(1 - e * e);
  const r = a * (1 - e * Math.cos(E));
  const n = Math.sqrt(mu / (a * a * a));
  const pos = [a * (Math.cos(E) - e), b * Math.sin(E)];
  const vel = [(-a * n * Math.sin(E) * a) / r, (b * n * Math.cos(E) * a) / r];
  return { r: orbitToFrame(pos, i, node, argPeri), v: orbitToFrame(vel, i, node, argPeri) };
}

// Stumpff functions.
function stumpC(z) {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}
function stumpS(z) {
  if (z > 1e-8) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-8) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

// Moves a position and velocity forward by dt seconds on its conic, with the universal anomaly.
export function propagate(r0, v0, mu, dt) {
  const r0n = norm(r0), v0n = norm(v0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - (v0n * v0n) / mu;
  const sm = Math.sqrt(mu);
  let chi = alpha > 1e-12 ? sm * alpha * dt : sm * Math.abs(alpha) * dt || 1e-3 * Math.sign(dt);
  if (alpha > 1e-12) {
    // Reduce whole orbits first so Newton starts near the answer.
    const period = (2 * Math.PI) / Math.sqrt(mu * alpha * alpha * alpha);
    const whole = Math.trunc(dt / period);
    dt -= whole * period;
    chi = sm * alpha * dt;
  }
  for (let k = 0; k < 100; k++) {
    const z = alpha * chi * chi;
    const C = stumpC(z), S = stumpS(z);
    const f = ((r0n * vr0) / sm) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sm * dt;
    const df = ((r0n * vr0) / sm) * chi * (1 - z * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    const step = f / df;
    chi -= step;
    if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(chi))) break;
  }
  const z = alpha * chi * chi;
  const C = stumpC(z), S = stumpS(z);
  const f = 1 - ((chi * chi) / r0n) * C;
  const g = dt - (chi * chi * chi * S) / sm;
  const r = add(scale(r0, f), scale(v0, g));
  const rn = norm(r);
  const fd = (sm / (rn * r0n)) * (z * chi * S - chi);
  const gd = 1 - ((chi * chi) / rn) * C;
  return { r, v: add(scale(r0, fd), scale(v0, gd)) };
}

// Orbital energy and angular momentum, used to check integrators.
export const energy = (r, v, mu) => dot(v, v) / 2 - mu / norm(r);
export const angularMomentum = (r, v) => cross(r, v);

// Kick-drift-kick leapfrog for a point mass around one body, n steps of dt.
export function leapfrog(r, v, mu, dt, n) {
  const acc = (p) => scale(p, -mu / norm(p) ** 3);
  let a = acc(r);
  for (let k = 0; k < n; k++) {
    v = add(v, scale(a, dt / 2));
    r = add(r, scale(v, dt));
    a = acc(r);
    v = add(v, scale(a, dt / 2));
  }
  return { r, v };
}

// Circular-orbit speed and period.
export const circularSpeed = (mu, radius) => Math.sqrt(mu / radius);
export const period = (mu, a) => 2 * Math.PI * Math.sqrt((a * a * a) / mu);
