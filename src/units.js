// Constants. Distances in km unless a name says otherwise, times in seconds.
export const C = 299792.458; // speed of light, km/s
export const AU = 149597870.7; // km
export const PC = 206264.80625 * AU; // parsec, km
export const LY = C * 365.25 * 86400; // light year, km
export const G0 = 9.80665e-3; // standard gravity, km/s^2
export const DAY = 86400;
export const YEAR = 365.25 * DAY;
export const J2000 = 2451545.0; // Julian date of 2000 Jan 1 12:00 TT
export const OBLIQUITY = (23.4392911 * Math.PI) / 180;
export const GM_SUN = 1.32712440018e11; // km^3/s^2
export const DEG = Math.PI / 180;

export const julianDate = (ms) => ms / 86400000 + 2440587.5;
export const dateFromJulian = (jd) => new Date((jd - 2440587.5) * 86400000);

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => scale(a, 1 / (norm(a) || 1));
