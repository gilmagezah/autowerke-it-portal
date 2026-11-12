// Admin sign-in redesign + "Resend code". `npm test`.
// Adversarial: a resend needs the ticket from a correct password (not just an email), can't be
// used to flood an inbox (45 s apart, 3 at most), makes the old code useless, and dies once you
// sign in or start again. The page keeps the CSP rules and never holds on to the password.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3592;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026'; process.env.ADMIN_NAME = 'Gil';
process.env.APP_SECRET = 'e'.repeat(64); process.env.NODE_ENV = 'production';
const assert = require('assert'); const fs = require('fs');

const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T);
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => (String(u).includes('api.resend.com') ? (emails.push(JSON.parse(o.body)), { ok: true, json: async () => ({}) }) : realFetch(u, o));
const B = `http://localhost:${PORT}`;
const post = async (p, body, ip = '198.51.100.7') => {
  const r = await realFetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') };
};
const lastCode = () => emails.at(-1).subject.match(/code: ([A-Z]{6})$/)[1];

(async () => {
  require(ROOT + '/server.js');
  const auth = require(ROOT + '/lib/auth');
  const tickets = auth._resendTickets;
  const ready = () => { for (const t of tickets.values()) t.nextAt = 0; }; // skip the 45-second wait
  await new Promise((r) => setTimeout(r, 400));

  // ---- 1. The ticket only comes with a correct password ----
  let r = await post('/api/auth/login', { email: 'gil@autowerkeit.com', password: 'wrong-password-1' });
  assert(r.status === 401 && !r.json.resend, 'no ticket for a wrong password');
  r = await post('/api/auth/login', { email: 'gil@autowerkeit.com', password: 'Bootstrap-Pass-2026' });
  assert(r.status === 200 && typeof r.json.resend === 'string' && r.json.resend.length >= 40 && r.json.resendIn === 45, JSON.stringify(r.json));
  const ticket = r.json.resend; const firstCode = lastCode();
  assert(![...tickets.keys()].includes(ticket), 'only a hash of the ticket is kept');
  for (const bad of [{}, { ticket: '' }, { ticket: 'x'.repeat(43) }, { ticket: 'gil@autowerkeit.com' }, { email: 'gil@autowerkeit.com' }]) {
    const x = await post('/api/auth/resend', bad, '198.51.100.20');
    assert(x.status === 400 && x.json.restart, `refused: ${JSON.stringify(bad)}`);
  }
  console.log('1. resend needs the ticket a correct password hands out (kept only as a hash); an email alone gets nothing ✓');

  // ---- 2. Waits, limits, and the old code dies ----
  const before = emails.length;
  r = await post('/api/auth/resend', { ticket });
  assert(r.status === 429 && r.json.resendIn > 40 && emails.length === before, 'not before 45 seconds');
  ready();
  r = await post('/api/auth/resend', { ticket });
  assert(r.status === 200 && r.json.left === 2 && r.json.resendIn === 45 && emails.length === before + 1, JSON.stringify(r.json));
  assert.deepStrictEqual(emails.at(-1).to, ['gil@autowerkeit.com'], 'to the account on file only');
  const secondCode = lastCode();
  let v = await post('/api/auth/verify', { email: 'gil@autowerkeit.com', code: firstCode });
  assert.strictEqual(v.status, 401, 'the earlier code stops working');
  ready(); await post('/api/auth/resend', { ticket });
  ready(); r = await post('/api/auth/resend', { ticket });
  assert(r.status === 200 && r.json.left === 0 && r.json.resendIn === null);
  ready(); r = await post('/api/auth/resend', { ticket });
  assert(r.status === 429 && r.json.restart && emails.length === before + 3, 'three resends at most');
  console.log('2. one new code every 45 seconds, 3 at most; each new code kills the one before ✓');

  // ---- 3. Signing in (or starting again) ends the ticket ----
  r = await post('/api/auth/login', { email: 'gil@autowerkeit.com', password: 'Bootstrap-Pass-2026' });
  const t2 = r.json.resend;
  ready(); assert.strictEqual((await post('/api/auth/resend', { ticket })).status, 400, 'a new password step retires the old ticket');
  v = await post('/api/auth/verify', { email: 'gil@autowerkeit.com', code: lastCode() });
  assert(v.status === 200 && /aw_admin=/.test(v.cookie));
  ready(); assert.strictEqual((await post('/api/auth/resend', { ticket: t2 })).status, 400, 'no resends after signing in');
  assert.strictEqual(tickets.size, 0);
  assert(secondCode !== firstCode);
  console.log('3. the ticket dies when you sign in or start a new sign-in ✓');

  // ---- 4. The page ----
  const pub = (f) => fs.readFileSync(`${ROOT}/public/${f}`, 'utf8');
  const html = pub('admin-login.html'); const js = pub('admin-login.js'); const css = pub('admin-login.css');
  assert(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html) && !/\son[a-z]+\s*=\s*["']/i.test(html) && !/\sstyle\s*=\s*["']/i.test(html), 'no inline scripts, handlers or styles');
  assert(!/style\.css|theme\.css|client\.css/.test(html), "stands alone: older pages' styles can't reach it");
  assert(/Sign in to the admin centre/.test(html) && /Check your email/.test(html) && /6-letter code/.test(html) && /Resend code/.test(html));
  assert(/class="si-steps" role="img" aria-label="Step 1 of 2"/.test(html) && /aria-label="Step 2 of 2"/.test(html));
  assert(/autocomplete="username"/.test(html) && /autocomplete="current-password"/.test(html), 'password managers still fill it');
  assert(/\$\('password'\)\.value = ''/.test(js) && !/localStorage|sessionStorage/.test(js), 'the password is cleared and never stored');
  assert(/textContent = r\.sentTo/.test(js) && !/innerHTML/.test(js), 'server text goes in as text, never HTML');
  assert(/\[data-theme="dark"\]/.test(css) && /theme-mode\.js/.test(html), 'follows the saved dark mode');
  assert((await realFetch(`${B}/admin/login`)).status === 200);
  console.log('4. page: CSP-safe, stands alone, dark mode, password never kept, server text as text ✓');

  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
