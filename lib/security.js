// Security building blocks. Everything sensitive goes through here so it's
// done one careful way:
//   - passwords: scrypt (slow on purpose, salted)
//   - codes + session tokens: random, stored only as a keyed hash (HMAC)
//   - comparisons: constant-time, so timing can't leak a match
//   - rate limiting, secure cookies, security headers, same-origin checks

const crypto = require('crypto');

const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);

// Live site? Any of: NODE_ENV=production, an https BASE_URL, or running on Render (which sets
// RENDER). Dev-only conveniences (codes printed in the terminal) need all three to be absent.
function isProduction() {
  return process.env.NODE_ENV === 'production' || /^https:\/\//i.test(process.env.BASE_URL || '') || Boolean(process.env.RENDER);
}

// ---------- App secret (keys the hashes of codes and session tokens) ----------
let APP_SECRET = (process.env.APP_SECRET || '').trim();
if (APP_SECRET.length < 32 && isProduction()) {
  // A made-up secret would sign everyone out on every restart, and hide that it's missing
  throw new Error('APP_SECRET is missing or under 32 characters. The live site will not start without it. '
    + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" (BUILD-LOG section 23).');
}
if (APP_SECRET.length < 32) {
  APP_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('!! APP_SECRET is not set (or under 32 characters). Using a temporary one: everyone will be signed out when the app restarts. See BUILD-LOG section 23.');
}

const hmac = (value) => crypto.createHmac('sha256', APP_SECRET).update(String(value)).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; } // keep timing similar
  return crypto.timingSafeEqual(x, y);
}

// ---------- Passwords (scrypt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// Async: scrypt runs on Node's worker pool, so a burst of sign-in attempts can't freeze
// every other request while passwords are checked
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    // Only the cost we use: a tampered hash can't ask for a huge (slow) one
    if (Number(N) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p) return false;
    const expected = Buffer.from(hash, 'base64');
    if (expected.length !== SCRYPT.keylen) return false;
    const actual = await scryptAsync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/\d/.test(s)) return 'Mix upper and lower case letters with at least one number.';
  return null;
}

// ---------- One-time codes ----------
// No easily confused characters (0/O, 1/I/L).
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const pick = (set) => set[crypto.randomInt(set.length)];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Admin login: 6 letters
function adminLoginCode() {
  return Array.from({ length: 6 }, () => pick(LETTERS)).join('');
}

// Client sign-off: 8 characters, 2 of them letters from the company's name, all shuffled.
// The company letters make it feel familiar; the other 6 random characters carry the
// security (31^6 ≈ 887 million combinations, with only 5 tries allowed).
function signoffCode(companyName) {
  const fromCompany = [...new Set(String(companyName || '').toUpperCase().split('').filter((c) => LETTERS.includes(c)))];
  const chars = [];
  for (let i = 0; i < 2; i++) chars.push(fromCompany.length ? fromCompany[crypto.randomInt(fromCompany.length)] : pick(LETTERS));
  for (let i = 0; i < 6; i++) chars.push(pick(CODE_CHARS));
  return shuffle(chars).join('');
}

const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (purpose, subjectId, code) => hmac(`${purpose}:${subjectId}:${normalizeCode(code)}`);

// ---------- Session tokens ----------
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => hmac(`token:${token}`);

// ---------- Rate limiting (in memory, per key) ----------
const buckets = new Map();
function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 20000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { allowed: hits.length <= limit, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
}
const resetRateLimits = () => buckets.clear(); // for tests

// ---------- Cookies ----------
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

const isHttps = () => /^https:\/\//i.test(process.env.BASE_URL || '');

function setCookie(res, name, value, { maxAgeSec, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (isHttps()) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
const clearCookie = (res, name, path = '/') => setCookie(res, name, '', { maxAgeSec: 0, path });

// req.ip honours `trust proxy` (set in server.js): it takes the address our proxy saw, from the
// END of X-Forwarded-For. Never read the header's first entry: the client writes that part.
function clientIp(req) {
  return String(req.ip || req.socket.remoteAddress || '').slice(0, 64);
}

// ---------- Back-office requests ----------
// Admin pages, admin APIs and sign-in. lib/hosts.js uses this to keep them on the admin site.
const ADMIN_PATH = /^\/(admin(\/|$)|api\/admin\/|api\/auth\/)/i;
const adminHostname = () => { try { return new URL(process.env.ADMIN_URL).hostname.toLowerCase(); } catch { return null; } };
const isAdminRequest = (req) => ADMIN_PATH.test(req.path) || (adminHostname() !== null && String(req.hostname || '').toLowerCase() === adminHostname());

// ---------- Security headers (every response) ----------
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Google Analytics is only for the public site. The back office never loads it, so its
  // CSP allows scripts from this site alone: any googletagmanager.com script (including
  // someone else's GTM container) is refused there.
  const ga = !isAdminRequest(req);
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self'${ga ? ' https://www.googletagmanager.com' : ''}`,  // no inline scripts; Google Analytics only after consent
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self'${ga ? ' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  if (isHttps()) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// Requests that change things must come from our own pages (defence in depth on top of SameSite cookies)
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser clients; the session cookie is still required
  const expected = new Set([`${req.protocol}://${req.get('host')}`]);
  for (const u of [process.env.BASE_URL, process.env.ADMIN_URL]) {
    try { expected.add(new URL(u).origin); } catch { /* not set */ }
  }
  if (!expected.has(origin)) return res.status(403).json({ error: 'Request blocked: it did not come from this site.' });
  next();
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(user.length - 1, 2))}@${domain}`;
}

module.exports = {
  hashPassword, verifyPassword, passwordProblem,
  adminLoginCode, signoffCode, normalizeCode, hashCode,
  newToken, hashToken, safeEqual, hmac,
  rateLimit, resetRateLimits,
  parseCookies, setCookie, clearCookie, clientIp, isHttps, isProduction,
  securityHeaders, sameOrigin, maskEmail, ADMIN_PATH, isAdminRequest,
  LETTERS, CODE_CHARS,
};
