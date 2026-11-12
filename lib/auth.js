// Admin authentication: email + password, then a 6-letter code emailed to you,
// then a session cookie. Replaces the old browser Basic Auth popup.
//
//   - Passwords: scrypt-hashed in admin_users
//   - Codes: hashed, single-use, 10 minutes, 5 tries
//   - Sessions: random token in an HttpOnly + SameSite=Strict cookie; only its hash is stored.
//     Ends after 12 hours, or 30 minutes without activity.
//   - The first account is created from ADMIN_EMAIL + ADMIN_PASSWORD the first time you sign in.

const express = require('express');
const path = require('path');
const db = require('./db');
const sec = require('./security');

// On https the cookie carries the __Host- prefix: browsers then refuse it unless it's Secure,
// Path=/ and has no Domain, so it can only ever belong to the exact admin host that set it.
const cookieName = () => (sec.isHttps() ? '__Host-aw_admin' : 'aw_admin');
const SESSION_HOURS = 12;
const IDLE_MINUTES = 30;
const CODE_MINUTES = 10;
const MAX_CODE_TRIES = 5;

let sendLoginCode = async () => { throw new Error('Login email not configured'); };
const setLoginCodeSender = (fn) => { sendLoginCode = fn; };

const isDev = () => !sec.isProduction();
const GENERIC_LOGIN_ERROR = 'That email and password combination is not right.';
let dummyHash = null; // made once, on the first sign-in
const DUMMY_HASH = async () => dummyHash || (dummyHash = await sec.hashPassword('dummy-password-for-timing'));

// Before schema_secure.sql has been run there's no admin_users table, and the admin
// health banner can't help (you can't sign in to see it), so say so on the sign-in page
const missingSchema = (err) => /admin_users|admin_sessions|auth_codes/.test(err.message) && /could not find|does not exist|schema cache/i.test(err.message);
const SCHEMA_MSG = 'The secure sign-in tables are not set up yet. Run schema_secure.sql in the Supabase SQL Editor, then try again.';

// ---------- Session cache (avoids a DB round trip on every request) ----------
const cache = new Map(); // tokenHash -> { session, at }
const CACHE_MS = 30 * 1000;

async function loadSession(req) {
  const token = sec.parseCookies(req)[cookieName()];
  if (!token || token.length < 30) return null;
  const tokenHash = sec.hashToken(token);
  let entry = cache.get(tokenHash);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const session = await db.getAdminSession(tokenHash);
    entry = { session, at: Date.now() };
    cache.set(tokenHash, entry);
  }
  const s = entry.session;
  const now = Date.now();
  if (!s || s.revoked_at || !s.admin || !s.admin.active) return null;
  if (new Date(s.expires_at).getTime() < now) return null;
  if (now - new Date(s.last_seen_at).getTime() > IDLE_MINUTES * 60 * 1000) return null;
  // Refresh "last seen" at most once a minute. Background checks (an open tab looking for due
  // reminders) say so with X-Background: 1 and don't count, or an idle tab would never time out.
  // The header can only make a session expire sooner, so it's safe to trust.
  const background = typeof req.get === 'function' && req.get('x-background') === '1';
  if (!background && now - new Date(s.last_seen_at).getTime() > 60 * 1000) {
    s.last_seen_at = new Date().toISOString();
    db.touchAdminSession(s.id, { last_seen_at: s.last_seen_at }).catch(() => {});
  }
  return { ...s, tokenHash };
}

// ---------- The middleware every admin page + API uses ----------
async function adminAuth(req, res, next) {
  try {
    const s = await loadSession(req);
    if (s) {
      req.admin = s.admin;
      req.adminSession = s;
      return next();
    }
  } catch (err) {
    console.error('Session check failed:', err.message);
  }
  const wantsPage = req.method === 'GET' && !req.originalUrl.startsWith('/api/');
  if (wantsPage) return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.status(401).json({ error: 'Please sign in again.', signin: '/admin/login' });
}

function ownerOnly(req, res, next) {
  if (req.admin && req.admin.role === 'owner') return next();
  return res.status(403).json({ error: 'Only the account owner can do that.' });
}

// First sign-in: create the owner account from .env (stored hashed from then on)
async function ensureOwner() {
  if ((await db.countAdmins()) > 0) return;
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create the first admin account.');
  // The owner account can do everything, so it gets the same password rules as the team
  const problem = sec.passwordProblem(password);
  if (problem) throw Object.assign(new Error(`ADMIN_PASSWORD in .env is too weak to create the owner account. ${problem}`), { setup: true });
  await db.createAdmin({ email, name: process.env.ADMIN_NAME || 'Owner', role: 'owner', password_hash: await sec.hashPassword(password) });
  console.log(`Created the owner admin account for ${email}.`);
}

function limited(res, r) {
  res.set('Retry-After', String(r.retryAfterSec));
  return res.status(429).json({ error: `Too many attempts. Please wait ${Math.ceil(r.retryAfterSec / 60)} minute(s) and try again.` });
}

// ---------- Routes ----------
const router = express.Router();

router.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html')));

// A fresh 6-letter code: any earlier one stops working. Returns false if the email failed (live site).
async function issueCode(admin, ip) {
  const code = sec.adminLoginCode();
  await db.invalidateCodes('admin_login', admin.id);
  await db.createCode({
    purpose: 'admin_login', subject_id: admin.id, code_hash: sec.hashCode('admin_login', admin.id, code),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString(), ip,
  });
  if (isDev()) console.log(`[development only] Admin sign-in code for ${admin.email}: ${code}`);
  try {
    await sendLoginCode({ admin, code, minutes: CODE_MINUTES });
  } catch (err) {
    console.error('Login code email failed:', err.message);
    if (!isDev()) return false;
  }
  return true;
}

// "Resend code" on step 2, without asking for the password again. The password step hands the
// page a resend ticket: random, kept here only as an HMAC, tied to that admin, and dead once its
// code would have expired, the admin signs in, or a new password step starts. One resend every
// 45 seconds, 3 at most. Held in memory: after a restart you simply sign in again.
const RESEND_WAIT_S = 45;
const MAX_RESENDS = 3;
const resendTickets = new Map(); // ticket hash -> { adminId, expires, nextAt, sends }
const dropTickets = (adminId) => { for (const [k, t] of resendTickets) if (t.adminId === adminId || t.expires < Date.now()) resendTickets.delete(k); };
function newResendTicket(adminId) {
  dropTickets(adminId);
  const ticket = sec.newToken();
  resendTickets.set(sec.hashToken(ticket), { adminId, expires: Date.now() + CODE_MINUTES * 60 * 1000, nextAt: Date.now() + RESEND_WAIT_S * 1000, sends: 0 });
  return ticket;
}

router.post('/api/auth/login', async (req, res) => {
  const ip = sec.clientIp(req);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(req.body.password || '').slice(0, 200);
  // Wrong passwords for an email count per connection: someone guessing your password from
  // their own address locks out only themselves, never you signing in from yours. The higher
  // overall cap per email still stalls guessing spread across many addresses (and a correct
  // password only gets as far as the emailed code).
  const r1 = sec.rateLimit(`login-ip:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  const r2 = sec.rateLimit(`login-email-ip:${email}:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  const r3 = sec.rateLimit(`login-email:${email}`, { limit: 60, windowMs: 15 * 60 * 1000 });
  if (!r1.allowed) return limited(res, r1);
  if (!r2.allowed) return limited(res, r2);
  if (!r3.allowed) return limited(res, r3);
  try {
    await ensureOwner();
    const admin = email ? await db.getAdminByEmail(email) : null;
    // Always run a password check, so a wrong email takes as long as a wrong password
    const ok = await sec.verifyPassword(password, admin ? admin.password_hash : await DUMMY_HASH());
    if (!admin || !admin.active || !ok) return res.status(401).json({ error: GENERIC_LOGIN_ERROR });

    if (!(await issueCode(admin, ip))) return res.status(502).json({ error: 'We could not send your sign-in code. Please try again shortly.' });
    res.json({ step: 'code', sentTo: sec.maskEmail(admin.email), minutes: CODE_MINUTES, resend: newResendTicket(admin.id), resendIn: RESEND_WAIT_S });
  } catch (err) {
    console.error('Login failed:', err.message);
    // A setup problem (only possible before any account exists) is shown, so you can fix it
    if (err.setup) return res.status(503).json({ error: err.message });
    res.status(missingSchema(err) ? 503 : 500).json({ error: missingSchema(err) ? SCHEMA_MSG : 'Sign-in is unavailable right now.' });
  }
});

router.post('/api/auth/resend', async (req, res) => {
  const ip = sec.clientIp(req);
  const rl = sec.rateLimit(`resend-ip:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return limited(res, rl);
  const key = sec.hashToken(String(req.body.ticket || '').slice(0, 100));
  const t = resendTickets.get(key);
  const restart = () => res.status(400).json({ error: 'This sign-in has timed out. Please start again.', restart: true });
  if (!t || t.expires < Date.now()) { resendTickets.delete(key); return restart(); }
  const wait = Math.ceil((t.nextAt - Date.now()) / 1000);
  if (wait > 0) return res.status(429).json({ error: `You can ask for a new code in ${wait} seconds.`, resendIn: wait });
  if (t.sends >= MAX_RESENDS) return res.status(429).json({ error: 'That was the last new code for this sign-in. Please start again.', restart: true });
  try {
    const admin = await db.getAdminById(t.adminId);
    if (!admin || !admin.active) { resendTickets.delete(key); return restart(); }
    t.sends += 1; t.nextAt = Date.now() + RESEND_WAIT_S * 1000; // counted before sending, so a failed email still waits
    if (!(await issueCode(admin, ip))) return res.status(502).json({ error: 'We could not send your sign-in code. Please try again shortly.', resendIn: RESEND_WAIT_S });
    t.expires = Date.now() + CODE_MINUTES * 60 * 1000;
    res.json({ sentTo: sec.maskEmail(admin.email), minutes: CODE_MINUTES, resendIn: t.sends >= MAX_RESENDS ? null : RESEND_WAIT_S, left: MAX_RESENDS - t.sends });
  } catch (err) {
    console.error('Code resend failed:', err.message);
    res.status(500).json({ error: 'Sign-in is unavailable right now.' });
  }
});

router.post('/api/auth/verify', async (req, res) => {
  const ip = sec.clientIp(req);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const code = sec.normalizeCode(req.body.code).slice(0, 12);
  const rl = sec.rateLimit(`verify-ip:${ip}`, { limit: 15, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return limited(res, rl);
  const fail = (msg = 'That code is not right, or it has expired.') => res.status(401).json({ error: msg });
  try {
    const admin = email ? await db.getAdminByEmail(email) : null;
    if (!admin || !admin.active) return fail();
    const c = await db.latestCode('admin_login', admin.id);
    if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now()) return fail('That code has expired. Please sign in again for a new one.');
    if (c.attempts >= MAX_CODE_TRIES) return fail('Too many wrong codes. Please sign in again for a new one.');
    if (!sec.safeEqual(sec.hashCode('admin_login', admin.id, code), c.code_hash)) {
      const attempts = c.attempts + 1;
      await db.updateCode(c.id, { attempts, ...(attempts >= MAX_CODE_TRIES ? { used_at: new Date().toISOString() } : {}) });
      return fail(attempts >= MAX_CODE_TRIES ? 'Too many wrong codes. Please sign in again for a new one.' : `That code is not right. ${MAX_CODE_TRIES - attempts} tries left.`);
    }
    await db.updateCode(c.id, { used_at: new Date().toISOString() }); // single use
    dropTickets(admin.id); // signed in: no more resends for this sign-in

    const token = sec.newToken();
    await db.createAdminSession({
      admin_id: admin.id, token_hash: sec.hashToken(token),
      expires_at: new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString(),
      ip, user_agent: String(req.get('user-agent') || '').slice(0, 300),
    });
    await db.updateAdmin(admin.id, { last_login_at: new Date().toISOString() });
    sec.setCookie(res, cookieName(), token, { maxAgeSec: SESSION_HOURS * 3600 });
    // Only ever send people back to an admin page on this site
    const next = String(req.body.next || '');
    const okNext = /^\/admin(\/[\w\-/]*)?$/.test(next) || /^\/files\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(next);
    res.json({ success: true, next: okNext ? next : '/admin' });
  } catch (err) {
    console.error('Code check failed:', err.message);
    res.status(missingSchema(err) ? 503 : 500).json({ error: missingSchema(err) ? SCHEMA_MSG : 'Sign-in is unavailable right now.' });
  }
});

router.post('/api/auth/logout', async (req, res) => {
  try {
    const token = sec.parseCookies(req)[cookieName()];
    if (token) {
      const tokenHash = sec.hashToken(token);
      const s = await db.getAdminSession(tokenHash);
      if (s) await db.touchAdminSession(s.id, { revoked_at: new Date().toISOString() });
      cache.delete(tokenHash);
    }
  } catch (err) {
    console.error('Sign-out:', err.message);
  }
  sec.clearCookie(res, cookieName());
  res.json({ success: true });
});

// ---------- Signed-in time ----------
// How long an admin has been signed in, all time: the union of every session's span, so two
// browsers open at once don't count twice. A finished session ends at its sign-out, or (if it
// had already timed out before it was revoked) at the last time it was used, so
// idle time after you walked away isn't counted. Never past its expiry. The current one runs to now.
// Accurate to about a minute ("last seen" is only written once a minute).
const ms = (t) => (t ? new Date(t).getTime() : NaN);
function signedInMs(sessions, currentId, now = Date.now()) {
  const spans = [];
  for (const x of sessions || []) {
    const start = ms(x.created_at);
    if (!Number.isFinite(start)) continue;
    let end;
    if (x.id === currentId) end = now;
    else {
      const seen = ms(x.last_seen_at); const revoked = ms(x.revoked_at);
      end = Number.isFinite(seen) ? seen : start;
      // Ended while still live (not yet timed out): a sign-out, so it ends there
      if (Number.isFinite(revoked) && revoked - end <= IDLE_MINUTES * 60 * 1000) end = Math.max(start, revoked);
    }
    const expires = ms(x.expires_at);
    if (Number.isFinite(expires)) end = Math.min(end, expires);
    end = Math.min(end, now);
    if (end > start) spans.push([start, end]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let total = 0; let curS = null; let curE = null;
  for (const [st, en] of spans) {
    if (curE === null || st > curE) { if (curE !== null) total += curE - curS; curS = st; curE = en; } else curE = Math.max(curE, en);
  }
  if (curE !== null) total += curE - curS;
  return { totalMs: total, sessions: spans.length, since: spans.length ? new Date(spans[0][0]).toISOString() : null };
}

router.get('/api/auth/time', adminAuth, async (req, res) => {
  try {
    const now = Date.now();
    const t = signedInMs(await db.listAdminSessionTimes(req.admin.id), req.adminSession.id, now);
    res.json({ sessionStartedAt: req.adminSession.created_at, serverNow: new Date(now).toISOString(), allTimeMs: t.totalMs, sessions: t.sessions, since: t.since });
  } catch (err) {
    console.error('Signed-in time:', err.message);
    res.status(500).json({ error: 'Could not add up your signed-in time.' });
  }
});

router.get('/api/auth/me', adminAuth, (req, res) => {
  res.json({ id: req.admin.id, email: req.admin.email, name: req.admin.name, role: req.admin.role, idleMinutes: IDLE_MINUTES,
    sessionStartedAt: req.adminSession.created_at, serverNow: new Date().toISOString(),
    vatRate: Number(process.env.VAT_RATE || 15.5), timezone: process.env.REMINDER_TIMEZONE || 'Africa/Harare' });
});

// ---------- Team ----------
router.get('/api/admin/team', adminAuth, async (req, res) => {
  try { res.json({ team: await db.listAdmins(), me: req.admin.id, role: req.admin.role }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/admin/team', adminAuth, ownerOnly, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(req.body.password || '');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a name and a valid email.' });
  const problem = sec.passwordProblem(password);
  if (problem) return res.status(400).json({ error: `Temporary password: ${problem}` });
  try {
    if (await db.getAdminByEmail(email)) return res.status(409).json({ error: 'That email already has an account.' });
    const a = await db.createAdmin({ name, email, role: 'admin', password_hash: await sec.hashPassword(password) });
    res.json({ id: a.id, name: a.name, email: a.email, role: a.role, active: a.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/admin/team/:id', adminAuth, ownerOnly, async (req, res) => {
  if (req.params.id === req.admin.id) return res.status(400).json({ error: "You can't deactivate your own account." });
  try {
    const active = req.body.active === true;
    const a = await db.updateAdmin(req.params.id, { active });
    if (!active) { await db.revokeAdminSessions(req.params.id); cache.clear(); } // signed out everywhere immediately
    res.json({ id: a.id, active: a.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/me/password', adminAuth, async (req, res) => {
  const problem = sec.passwordProblem(req.body.next);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const me = await db.getAdminById(req.admin.id);
    if (!(await sec.verifyPassword(String(req.body.current || ''), me.password_hash))) return res.status(401).json({ error: 'Your current password is not right.' });
    await db.updateAdmin(me.id, { password_hash: await sec.hashPassword(req.body.next) });
    await db.revokeAdminSessions(me.id); // sign out every device
    cache.clear();
    sec.clearCookie(res, cookieName());
    res.json({ success: true, message: 'Password changed. Please sign in again.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const _clearSessionCache = () => cache.clear(); // for tests
const currentAdmin = async (req) => { try { const s = await loadSession(req); return s ? s.admin : null; } catch { return null; } };

module.exports = { signedInMs, adminAuth, ownerOnly, router, setLoginCodeSender, ensureOwner, IDLE_MINUTES, cookieName, _clearSessionCache, currentAdmin, _resendTickets: resendTickets };
