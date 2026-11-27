// GLSL for the sky, stars, planets and rings. Lighting is in world space; the ship sits at the origin and
// everything else is placed relative to it, so positions stay precise far from the Sun.

export const NOISE = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

// Aberration and Doppler, as in src/relativity.js. n points at the source in the home frame.
const ABERRATE = /* glsl */ `
vec3 aberrate(vec3 n, vec3 beta, float gamma, out float D) {
  float b = length(beta);
  if (b < 1e-7) { D = 1.0; return n; }
  vec3 bh = beta / b;
  float nb = dot(n, bh);
  D = gamma * (1.0 + b * nb);
  return (n + ((gamma - 1.0) * nb + gamma * b) * bh) / D;
}
`;

export const starVertex = /* glsl */ `
attribute vec3 starPos;   // parsecs, J2000 ecliptic, from the Sun
attribute float absMag;
attribute float temp;
uniform vec3 uObserver;   // parsecs
uniform vec3 uBeta;
uniform float uGamma;
uniform float uMagRef;
uniform float uSize;
uniform float uHideWithin; // parsecs: stars this close are drawn as spheres instead
varying vec3 vColor;
varying float vAlpha;
uniform sampler2D uLut;
${ABERRATE}
void main() {
  vec3 rel = starPos - uObserver;
  float d = max(length(rel), 1e-9);
  float D;
  vec3 n = aberrate(rel / d, uBeta, uGamma, D);
  // Visual (550 nm) brightening of a blackbody at temperature T seen with Doppler factor D:
  // F_nu transforms as D^3 F_nu(nu / D), which for Planck's law gives (e^x - 1) / (e^(x/D) - 1), x = h nu / k T.
  float x = min(26158.0 / temp, 60.0);
  float boost = (exp(x) - 1.0) / max(exp(x / D) - 1.0, 1e-6);
  float m = absMag + 5.0 * log(d / 10.0) / log(10.0) - 2.5 * log(boost) / log(10.0);
  float T = clamp(temp * D, 500.0, 200000.0);
  vColor = texture2D(uLut, vec2((log(T) - log(500.0)) / (log(200000.0) - log(500.0)), 0.5)).rgb;
  float I = pow(10.0, -0.4 * (m - uMagRef));
  float size = uSize * clamp(pow(I, 0.33), 1.0, 7.0);
  vAlpha = clamp(I, 0.0, 1.0) * smoothstep(uHideWithin, uHideWithin * 2.0, d);
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(n * 1e12, 1.0);
}
`;

export const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-r * r * 9.0) + 0.18 * exp(-r * 3.5);
  if (core * vAlpha < 0.002) discard;
  gl_FragColor = vec4(vColor * core * vAlpha * 1.3, 1.0);
  #include <colorspace_fragment>
}
`;

// Faint Milky Way band on a sphere around the camera, aberrated like the stars.
export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const skyFragment = /* glsl */ `
uniform vec3 uNgp; uniform vec3 uGc; uniform vec3 uBeta; uniform float uGamma; uniform float uGain;
varying vec3 vDir;
${NOISE}
${ABERRATE}
void main() {
  // Seen direction -> home-frame direction: undo the aberration with the opposite velocity.
  float Dinv;
  vec3 n = aberrate(normalize(vDir), -uBeta, uGamma, Dinv);
  float D = 1.0 / Dinv;
  float b = asin(clamp(dot(n, uNgp), -1.0, 1.0));
  vec3 e2 = cross(uNgp, uGc);
  float l = atan(dot(n, e2), dot(n, uGc));
  float band = exp(-abs(b) / 0.11) * (0.35 + 0.65 * exp(-l * l / 1.4));
  float near = exp(-abs(b) / 0.2);
  float clumps = near > 0.02 ? 0.55 + 0.45 * fbm(n * 7.0) : 0.6;
  float dust = near > 0.2 ? 1.0 - 0.7 * exp(-b * b / 0.0012) * smoothstep(0.35, 0.7, fbm(n * 14.0 + 3.0)) * exp(-l * l / 3.0) : 1.0;
  float x = 5.2; // the band's light, as a 5000 K blackbody seen at 550 nm
  float boost = min((exp(x) - 1.0) / max(exp(x / D) - 1.0, 1e-6), 25.0);
  float I = band * clumps * dust * uGain * boost;
  vec3 col = mix(vec3(0.62, 0.66, 0.78), vec3(0.95, 0.82, 0.66), exp(-l * l / 0.8)) * I;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const SURFACE_VARYINGS = /* glsl */ `
varying vec3 vObj; varying vec3 vWorldN; varying vec3 vWorldPos;
`;
export const surfaceVertex = /* glsl */ `
${SURFACE_VARYINGS}
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vObj = normalize(position);
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

export const planetFragment = /* glsl */ `
uniform int uKind; uniform vec3 uColor; uniform vec3 uLightDir; uniform vec3 uLightColor; uniform float uSeed; uniform float uTime;
${SURFACE_VARYINGS}
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vWorldN), L = normalize(uLightDir), V = normalize(cameraPosition - vWorldPos);
  vec3 p = vObj * 2.5 + uSeed;
  float y = vObj.y;
  vec3 albedo = uColor; vec3 emit = vec3(0.0); vec3 atmo = vec3(0.0); float atmoK = 0.0; float spec = 0.0; float wrap = 0.0;
  if (uKind == 0) { float n = fbm(p * 2.0); albedo = uColor * (0.55 + 0.6 * n) - 0.06 * smoothstep(0.6, 0.66, noise3(p * 7.0)); }
  else if (uKind == 1) { float n = fbm(vec3(p.x * 0.6, y * 3.0, p.z * 0.6) + fbm(p) * 1.5); albedo = uColor * (0.85 + 0.22 * n); atmo = vec3(1.0, 0.9, 0.7); atmoK = 0.6; wrap = 0.1; }
  else if (uKind == 2) {
    float h = fbm(p * 1.2);
    float land = smoothstep(0.52, 0.54, h);
    vec3 ground = mix(vec3(0.13, 0.28, 0.08), vec3(0.52, 0.42, 0.28), smoothstep(0.56, 0.7, h));
    albedo = mix(vec3(0.02, 0.09, 0.26), ground, land);
    albedo = mix(albedo, vec3(0.9), smoothstep(0.8, 0.86, abs(y) + 0.06 * noise3(p * 8.0)));
    float cl = smoothstep(0.55, 0.78, fbm(p * 2.2 + vec3(uTime * 1e-5, 0.0, 0.0)));
    albedo = mix(albedo, vec3(0.97), cl * 0.85);
    spec = (1.0 - land) * (1.0 - cl) * 0.6; atmo = vec3(0.32, 0.55, 1.0); atmoK = 1.0; wrap = 0.05;
  }
  else if (uKind == 3) { float n = fbm(p * 1.8); albedo = mix(uColor * 0.5, uColor * 1.1, n); albedo = mix(albedo, vec3(0.9), smoothstep(0.88, 0.93, abs(y))); atmo = vec3(0.9, 0.6, 0.45); atmoK = 0.25; }
  else if (uKind == 4) {
    float w = fbm(vec3(p.x * 0.8, y * 2.0, p.z * 0.8)) * 0.6;
    float b1 = sin((y + w * 0.15) * 28.0 + uSeed) * 0.5 + 0.5, b2 = sin((y + w * 0.1) * 9.0) * 0.5 + 0.5;
    albedo = uColor * (0.7 + 0.22 * b1 + 0.12 * b2); atmo = uColor; atmoK = 0.5; wrap = 0.12;
  }
  else if (uKind == 5) { float b = sin((y + fbm(p) * 0.05) * 12.0) * 0.5 + 0.5; albedo = uColor * (0.9 + 0.08 * b); atmo = uColor; atmoK = 0.8; wrap = 0.12; }
  else { float n = fbm(p * 2.5); albedo = uColor * (0.5 + 0.5 * n); float crack = 1.0 - smoothstep(0.0, 0.035, abs(noise3(p * 5.0) - 0.5)); emit = vec3(1.0, 0.35, 0.08) * crack * 1.4; }
  float nl = dot(N, L);
  float diff = clamp((nl + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = albedo * diff * uLightColor + emit + albedo * 0.004;
  vec3 H = normalize(L + V);
  col += spec * pow(max(dot(N, H), 0.0), 60.0) * uLightColor * diff;
  col += atmo * atmoK * pow(1.0 - max(dot(N, V), 0.0), 3.0) * clamp(nl + 0.3, 0.0, 1.0) * uLightColor * 0.7;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const sunFragment = /* glsl */ `
uniform vec3 uColor; uniform float uTime;
${SURFACE_VARYINGS}
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vWorldN), V = normalize(cameraPosition - vWorldPos);
  float mu = max(dot(N, V), 0.0);
  float limb = 1.0 - 0.6 * (1.0 - mu);   // linear limb darkening, u = 0.6
  float gran = 0.88 + 0.12 * fbm(vObj * 60.0 + uTime * 2e-4);
  gl_FragColor = vec4(uColor * limb * gran * 3.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const glowVertex = /* glsl */ `
varying vec2 vUv;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
export const glowFragment = /* glsl */ `
uniform vec3 uColor; uniform float uStrength;
varying vec2 vUv;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv - 0.5) * 2.0;
  float g = (exp(-r * 6.0) * 0.8 + exp(-r * 2.2) * 0.2) * smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(uColor * g * uStrength, 1.0);
  #include <colorspace_fragment>
}
`;

export const ringFragment = /* glsl */ `
uniform vec3 uColor; uniform vec3 uLightDir; uniform vec3 uLightColor; uniform vec3 uCenter; uniform float uRadius; uniform float uInner; uniform float uOuter;
${SURFACE_VARYINGS}
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vWorldPos - uCenter);
  float x = (r - uInner) / (uOuter - uInner);
  if (x < 0.0 || x > 1.0) discard;
  float fine = fwidth(x) * 190.0;  // fade the finest ringlets out when a pixel covers several
  float dens = 0.55 + 0.25 * sin(x * 70.0) * sin(x * 13.0 + 1.0) + 0.2 * sin(x * 190.0) * clamp(1.0 - fine, 0.0, 1.0);
  dens *= smoothstep(0.015, 0.04, abs(x - 0.63)) * smoothstep(0.0, 0.04, x) * smoothstep(1.0, 0.96, x);
  vec3 L = normalize(uLightDir);
  float t = dot(uCenter - vWorldPos, L);
  float shade = (t > 0.0 && length(uCenter - (vWorldPos + L * t)) < uRadius) ? 0.08 : 1.0;
  gl_FragColor = vec4(uColor * uLightColor * shade * 0.9, clamp(dens, 0.0, 1.0) * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const plumeFragment = /* glsl */ `
uniform float uTime; uniform float uThrust;
varying vec2 vUv;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float along = vUv.y;               // 1 at the nozzle, 0 at the far end
  float across = abs(vUv.x - 0.5) * 2.0;
  float width = mix(1.0, 0.22, along); // narrow at the nozzle, spreading out behind
  float flick = 0.85 + 0.15 * sin(uTime * 40.0 + along * 30.0);
  float I = pow(along, 1.4) * smoothstep(width, 0.0, across) * flick * uThrust;
  vec3 col = mix(vec3(0.45, 0.35, 1.0), vec3(0.85, 0.92, 1.0), pow(along, 3.0)) * I * 1.4;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
