// Stars: what colour and how bright, from physics rather than a palette.
//   temperature from B-V colour index (Ballesteros 2012):  T = 4600 (1/(0.92 BV + 1.7) + 1/(0.92 BV + 0.62))
//   colour: Planck's law over 380-780 nm, weighted by the CIE 1931 colour matching functions (the analytic
//   multi-lobe fit of Wyman, Sloan and Shirley 2013), to XYZ, then to linear sRGB
//   brightness: apparent magnitude m = M + 5 log10(d / 10 pc); seen from a moving ship, bolometric flux scales
//   by D^4 and the temperature by D (D is the Doppler factor)

export const bvToTemperature = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

const lobe = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
export function cmf(nm) {
  return [
    1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2),
    0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
    1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
  ];
}

// Planck spectral radiance (arbitrary units) at a wavelength in nm and temperature in kelvin.
export function planck(nm, T) {
  const l = nm * 1e-9;
  return 1 / (l ** 5 * (Math.exp(0.0143877687750393 / (l * T)) - 1));
}

// CIE XYZ of a blackbody, normalised to Y = 1.
export function blackbodyXYZ(T) {
  let X = 0, Y = 0, Z = 0;
  for (let nm = 380; nm <= 780; nm += 2) {
    const p = planck(nm, T);
    const [x, y, z] = cmf(nm);
    X += p * x; Y += p * y; Z += p * z;
  }
  return [X / Y, 1, Z / Y];
}

export const chromaticity = ([X, Y, Z]) => [X / (X + Y + Z), Y / (X + Y + Z)];

// Linear sRGB (D65) of a blackbody, scaled so the brightest channel is 1.
export function blackbodyRGB(T) {
  const [X, Y, Z] = blackbodyXYZ(T);
  const rgb = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ].map((v) => Math.max(0, v));
  const m = Math.max(...rgb);
  return rgb.map((v) => v / m);
}

export const apparentMagnitude = (absMag, distPc) => absMag + 5 * Math.log10(distPc / 10);

// Luminosity (Suns) from visual absolute magnitude (no bolometric correction), and radius from
// L = 4 pi R^2 sigma T^4, relative to the Sun.
export const luminosity = (absMag) => 10 ** (-0.4 * (absMag - 4.83));
export const radiusSuns = (absMag, T) => Math.sqrt(luminosity(absMag)) * (5772 / T) ** 2;

// Reads the packed catalog: { count, x, y, z (pc), absMag, bv, temperature } as typed arrays.
export function readStars(buffer, meta) {
  const f = new Float32Array(buffer);
  const n = meta.count;
  const out = { count: n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), absMag: new Float32Array(n), bv: new Float32Array(n), temperature: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    out.x[i] = f[i * 5]; out.y[i] = f[i * 5 + 1]; out.z[i] = f[i * 5 + 2];
    out.absMag[i] = f[i * 5 + 3]; out.bv[i] = f[i * 5 + 4];
    out.temperature[i] = bvToTemperature(Math.min(2.0, Math.max(-0.4, out.bv[i])));
  }
  return out;
}
