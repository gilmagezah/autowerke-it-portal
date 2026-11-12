// End-to-end test: hardening + the separate admin site. Run all with `npm test`. Uses an in-memory
// database (tests/fakedb.js) and stubbed email/AI, so it never touches Supabase or sends real email.
// Requests are sent with explicit Host headers to play both sites: localhost (public) and
// admin.localhost (the back office), exactly as two custom domains pointing at one Render app would.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3568;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`; process.env.ADMIN_URL = `http://admin.localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Weakpass1'; process.env.ADMIN_NAME = 'Gil';
process.env.APP_SECRET = 'h'.repeat(64); process.env.NODE_ENV = 'production'; process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
const assert = require('assert'); const crypto = require('crypto'); const fs = require('fs'); const http = require('http');
require(ROOT + '/lib/storage').signedUrl = async (p) => `https://signed.example/${p}`;
const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T);
const created = [];
Object.assign(db, {
  createProject: async (f) => { const p = { id: crypto.randomUUID(), project_id: 'ACME-1234', ...f }; created.push(f); T.projects.push(p); return p; },
  getProjectByIdAndEmail: async () => { throw new Error('none'); },
  listDueReminders: async () => [],
});
const signing = { id: crypto.randomUUID(), project_id: 'HILLBU-7001', confirm_token: crypto.randomUUID(), company_name: 'Hillburys', name: 'Tendai', surname: 'Moyo',
  email: 'tendai@hillburys.co.zw', phone: '', request_type: 'IT Support', status: 'awaiting_signoff', signoff_sent_at: '2026-10-20T09:00:00Z', work_log: [], estimated_hours: 2, hourly_rate: 50 };
T.projects.push(signing);
const realFetch = global.fetch; const emails = []; let aiReply = '{}';
global.fetch = async (u, o) => {
  if (String(u).includes('api.resend.com')) { emails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; }
  if (String(u).includes('api.anthropic.com')) return { ok: true, json: async () => ({ content: [{ text: aiReply }] }) };
  return realFetch(u, o);
};
require(ROOT + '/server.js');
const sec = require(ROOT + '/lib/security');

const PUB = `localhost:${PORT}`; const ADM = `admin.localhost:${PORT}`;
function send(host, method, path, { headers = {}, json } = {}) {
  return new Promise((resolve, reject) => {
    const body = json === undefined ? null : JSON.stringify(json);
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: { Host: host, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text: d, json: j }); });
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 500));

  // ---- owner bootstrap refuses a weak .env password ----
  let r = await send(ADM, 'POST', '/api/auth/login', { json: { email: 'gil@autowerkeit.com', password: 'Weakpass1' } });
  assert(r.status === 503 && /too weak/.test(r.json.error) && T.admin_users.length === 0, JSON.stringify(r.json));
  process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026';
  console.log('1. a weak ADMIN_PASSWORD will not create the owner account (clear setup message) ✓');

  // ---- the admin site lives on its own host ----
  r = await send(ADM, 'POST', '/api/auth/login', { json: { email: 'gil@autowerkeit.com', password: 'Bootstrap-Pass-2026' } });
  assert.strictEqual(r.status, 200);
  r = await send(ADM, 'POST', '/api/auth/verify', { json: { email: 'gil@autowerkeit.com', code: emails.at(-1).subject.match(/code: ([A-Z]{6})$/)[1] } });
  const cookie = r.headers['set-cookie'][0].match(/aw_admin=[^;]+/)[0];
  const me = (await send(ADM, 'GET', '/api/auth/me', { headers: { Cookie: cookie } })).json;
  assert.strictEqual(me.name, 'Gil');
  assert.strictEqual(me.vatRate, 15.5, 'the admin calculator gets the server VAT rate');
  assert.strictEqual((await send(ADM, 'GET', '/admin', { headers: { Cookie: cookie } })).status, 200);
  console.log('2. sign-in and the dashboard work on admin.localhost ✓');

  // ---- accessories: Quick find list and the support timer's work-log entries ----
  assert.strictEqual(me.timezone, 'Africa/Harare', 'the timer and notes stamp use the business timezone');
  assert.strictEqual((await send(ADM, 'GET', '/api/admin/find-index')).status, 401, 'Quick find list needs a session');
  assert.strictEqual((await send(PUB, 'GET', '/api/admin/find-index', { headers: { Cookie: cookie } })).status, 404, 'and never answers on the public site');
  r = await send(ADM, 'GET', '/api/admin/find-index', { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  const hit = r.json.rows.find((x) => x.ref === 'HILLBU-7001');
  assert(hit && hit.company === 'Hillburys' && hit.contact === 'Tendai Moyo' && hit.statusLabel, JSON.stringify(hit));
  assert.deepStrictEqual(Object.keys(hit).sort(), ['company', 'contact', 'email', 'id', 'phone', 'ref', 'status', 'statusLabel', 'title', 'type', 'updated']);
  const leak = r.text.match(/.{0,40}(confirm_token|signoff_|work_log|hourly_rate|tok-|signed_contract).{0,40}/);
  assert(!leak, `no tokens, sign-off links or billing details in the list: ${leak && leak[0]}`);
  const logHours = (json, c = cookie) => send(ADM, 'POST', `/api/admin/projects/${signing.id}/log-hours`, { headers: c ? { Cookie: c } : {}, json });
  assert.strictEqual((await logHours({ date: '2026-11-05', start: '09:00', end: '09:30' }, null)).status, 401);
  for (const bad of [
    { date: '5 Nov', start: '09:00', end: '10:00' }, { date: '2026-11-05', start: '9am', end: '10:00' },
    { date: '2026-11-05', start: '24:00', end: '24:30' }, { date: '2026-11-05', start: '10:00', end: '10:00' },
    { date: '2026-11-05', start: '23:30', end: '00:15' }, { date: '2026-11-05', start: ['09:00'], end: '10:00' },
  ]) assert.strictEqual((await logHours(bad)).status, 400, JSON.stringify(bad));
  const logsBefore = (signing.work_log || []).length;
  r = await logHours({ date: '2026-11-05', start: '09:05', end: '09:47', note: 'x'.repeat(900) });
  assert.strictEqual(r.status, 200);
  const logged = T.projects.find((p) => p.id === signing.id).work_log;
  assert.strictEqual(logged.length, logsBefore + 1);
  assert.strictEqual(logged.at(-1).note.length, 500, 'long notes are trimmed');
  console.log('2b. Quick find list: admin-only, slimmed (no tokens); logged hours must be a real date and an end after the start ✓');

  r = await send(PUB, 'GET', '/admin/earnings?x=1');
  assert(r.status === 302 && r.headers.location === `http://${ADM}/admin/earnings?x=1`, r.headers.location);
  for (const [m, p] of [['GET', '/api/admin/projects'], ['POST', '/api/auth/login'], ['GET', '/api/auth/me']]) {
    assert.strictEqual((await send(PUB, m, p, { headers: { Cookie: cookie }, json: m === 'POST' ? {} : undefined })).status, 404, `${m} ${p} on the public site`);
  }
  assert.strictEqual((await send(PUB, 'GET', '/admin/login')).headers.location, `http://${ADM}/admin/login`);
  r = await send(PUB, 'GET', '/files/HILLBU-7001/x.pdf');
  assert(r.status === 302 && r.headers.location === `http://${ADM}/files/HILLBU-7001/x.pdf`);
  r = await send(PUB, 'GET', `/files/HILLBU-7001/x.pdf?t=${signing.confirm_token}`);
  assert(r.status === 302 && r.headers.location.startsWith('https://signed.example/'), 'client file links stay on the public site');
  console.log('3. public site: admin pages redirect to the admin host; admin + sign-in APIs answer 404, even with the cookie; admin file links hop over ✓');

  r = await send(ADM, 'GET', '/');
  assert(r.status === 302 && r.headers.location === '/admin');
  r = await send(ADM, 'GET', '/track');
  assert(r.status === 302 && r.headers.location === `http://${PUB}/track`);
  assert.strictEqual((await send(ADM, 'POST', '/api/submit', { json: {} })).status, 404);
  assert.strictEqual((await send(ADM, 'GET', '/admin-shell.js')).status, 200);
  assert.strictEqual((await send(ADM, 'GET', '/api/brand')).status, 200);
  console.log('4. admin site: "/" opens the dashboard; client pages go to the public site; public APIs 404; assets + brand load ✓');

  const admCsp = (await send(ADM, 'GET', '/admin/login')).headers;
  const pubCsp = (await send(PUB, 'GET', '/')).headers;
  assert(!admCsp['content-security-policy'].includes('googletagmanager') && admCsp['x-robots-tag'] === 'noindex, nofollow');
  assert(pubCsp['content-security-policy'].includes('googletagmanager') && !pubCsp['x-robots-tag']);
  console.log('5. admin site: no Google scripts allowed by its CSP, and it asks search engines not to index it ✓');

  for (const p of ['/admin%2Ehtml', '/workspace%2ehtml', '/admin.html', '/views/admin.html']) {
    const res = await send(PUB, 'GET', p);
    assert(res.status === 404 && !res.text.includes('admin-shell.js'), p);
  }
  console.log('6. admin page files cannot be loaded directly, encoded or not (they live outside /public) ✓');

  // ---- intake: request type, contact rules, capped text, odd AI replies ----
  const base = { agreeTerms: true, requestType: 'IT Support', name: 'Rudo', companyName: 'Acme', email: 'rudo@acme.co.zw', details: 'Printer offline' };
  assert.strictEqual((await send(PUB, 'POST', '/api/submit', { json: { ...base, requestType: 'Free money' } })).status, 400);
  assert.strictEqual((await send(PUB, 'POST', '/api/submit', { json: { ...base, email: 'not-an-email' } })).status, 400);
  r = await send(PUB, 'POST', '/api/submit', { json: { ...base, details: 'x'.repeat(50000), companyName: 'A'.repeat(1000) } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert(created[0].details.length === 6000 && created[0].companyName.length === 160 && created[0].aiRequirements.length >= 1);
  console.log('7. intake: unknown request types + bad emails refused; text capped (50,000 -> 6,000 chars); an AI reply of "{}" still gives a usable draft ✓');

  // ---- tracking: lookups capped per reference and connection, plus an overall cap ----
  // (per connection, so someone hammering a reference can't lock the real client out of it)
  sec.resetRateLimits();
  const track = (ip) => send(PUB, 'GET', '/api/track?projectId=HILLBU-7001&email=guess@x.com', { headers: { 'X-Forwarded-For': ip } });
  let last; for (let i = 0; i < 16; i++) last = await track('198.51.100.7');
  assert.strictEqual(last.status, 429, 'the 16th guess from one address');
  assert.strictEqual((await track('198.51.100.8')).status, 404, 'the real client, on their own connection, still gets an answer');
  sec.resetRateLimits();
  for (let i = 0; i < 151; i++) last = await track(`10.${Math.floor(i / 250)}.${i % 250}.1`);
  assert.strictEqual(last.status, 429, 'guessing spread across 151 addresses still stalls');
  console.log('8. tracking: the 16th guess at one reference from one address -> 429, while the client\'s own connection still works; 151 guesses from many addresses -> 429 ✓');

  // ---- sign-off identify: per reference AND address; codes sent capped ----
  sec.resetRateLimits();
  const idBody = { ref: 'HILLBU-7001', email: 'nobody@else.com', name: 'X' };
  for (let i = 0; i < 5; i++) assert.strictEqual((await send(PUB, 'POST', '/api/signoff/identify', { json: idBody, headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 200);
  assert.strictEqual((await send(PUB, 'POST', '/api/signoff/identify', { json: idBody, headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 429);
  assert.strictEqual((await send(PUB, 'POST', '/api/signoff/identify', { json: { ...idBody, email: signing.email, name: 'Tendai' }, headers: { 'X-Forwarded-For': '192.0.2.44' } })).status, 200);
  const before = emails.filter((m) => m.to.includes(signing.email)).length;
  for (let i = 0; i < 6; i++) await send(PUB, 'POST', '/api/signoff/identify', { json: { ...idBody, email: signing.email, name: 'Tendai' }, headers: { 'X-Forwarded-For': `192.0.2.${100 + i}` } });
  const codesSent = emails.filter((m) => m.to.includes(signing.email)).length;
  assert(before === 1 && codesSent === 5, `${before} then ${codesSent}`);
  console.log("9. sign-off identify: someone hammering a reference locks only themselves out, the client still gets a code; codes sent capped at 5/hour ✓");

  // ---- sign-off complete: no session, no upload read; rate limited ----
  sec.resetRateLimits();
  const big = () => { const fd = new FormData(); fd.append('payload', '{}'); fd.append('documents', new Blob([Buffer.alloc(9 * 1024 * 1024)]), 'big.pdf'); return fd; };
  for (let i = 0; i < 10; i++) assert.strictEqual((await realFetch(`http://localhost:${PORT}/api/signoff/complete`, { method: 'POST', body: big() })).status, 401);
  assert.strictEqual((await realFetch(`http://localhost:${PORT}/api/signoff/complete`, { method: 'POST', body: big() })).status, 429);
  console.log('10. sign-off submit without a session -> 401 before any upload is read; the 11th try -> 429 ✓');

  // ---- signature images: decompression-bomb dimensions refused ----
  const { readableSignature } = require(ROOT + '/lib/esign');
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(50000, 0); ihdr.writeUInt32BE(50000, 4); ihdr[8] = 8; ihdr[9] = 6;
  const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(16)), chunk('IEND', Buffer.alloc(0))]);
  assert.strictEqual(readableSignature(bomb), false);
  assert.strictEqual(readableSignature(fs.readFileSync(require('path').join(__dirname, 'fixtures', 'sig.png'))), true);
  console.log('11. a PNG claiming 50,000 x 50,000 pixels is refused as a signature; a real one is accepted ✓');

  // ---- malformed PNGs that used to freeze pdfkit's reader forever (one request = the whole server stuck) ----
  // Each runs in a worker with a time limit, so a regression fails this test instead of hanging it
  const { Worker } = require('worker_threads');
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const rawChunk = (lenHex, type, data = Buffer.alloc(0)) => Buffer.concat([Buffer.from(lenHex, 'hex'), Buffer.from(type), data, Buffer.alloc(4)]);
  const ihdr1 = Buffer.alloc(13); ihdr1.writeUInt32BE(1, 0); ihdr1.writeUInt32BE(1, 4); ihdr1[8] = 8; ihdr1[9] = 6;
  const nasty = {
    'a chunk length of -12 (loops back to the start)': Buffer.concat([PNG_SIG, rawChunk('fffffff4', 'abcd')]),
    'an IDAT claiming 2 GB': Buffer.concat([PNG_SIG, chunk('IHDR', ihdr1), rawChunk('7ffffff0', 'IDAT', Buffer.alloc(16))]),
    'no IEND': Buffer.concat([PNG_SIG, chunk('IHDR', ihdr1), chunk('IDAT', Buffer.alloc(16))]),
  };
  const checkInWorker = (buf) => new Promise((resolve) => {
    const w = new Worker(`const { parentPort, workerData } = require('worker_threads');
      parentPort.postMessage(require(workerData.esign).readableSignature(Buffer.from(workerData.buf)));`,
    { eval: true, workerData: { esign: ROOT + '/lib/esign', buf } });
    const t = setTimeout(() => { w.terminate(); resolve('hung'); }, 5000);
    w.once('message', (v) => { clearTimeout(t); w.terminate(); resolve(v); });
    w.once('error', (e) => { clearTimeout(t); resolve(`error: ${e.message}`); });
  });
  for (const [what, buf] of Object.entries(nasty)) assert.strictEqual(await checkInWorker(buf), false, what);
  console.log(`11b. malformed PNGs (${Object.keys(nasty).join('; ')}) refused at once instead of freezing the server ✓`);

  // ---- cron key: header only, constant-time ----
  assert.strictEqual((await send(PUB, 'GET', `/api/cron/reminders?key=${process.env.CRON_SECRET}`)).status, 400);
  assert.strictEqual((await send(PUB, 'GET', '/api/cron/reminders', { headers: { 'X-Cron-Key': 'wrong' } })).status, 401);
  assert.strictEqual((await send(PUB, 'GET', '/api/cron/reminders', { headers: { 'X-Cron-Key': process.env.CRON_SECRET } })).status, 200);
  console.log('12. cron: a key in the URL is refused; only the X-Cron-Key header works ✓');

  // ---- public errors carry no internals ----
  const saved = db.updateByToken;
  db.updateByToken = async () => { throw new Error('DB update failed: relation "projects" violates constraint xyz_internal'); };
  r = await send(PUB, 'POST', `/api/confirm/${signing.confirm_token}`, { json: { action: 'confirm' } });
  db.updateByToken = saved;
  assert(r.status === 500 && !/DB|relation|constraint/.test(r.json.error), r.json.error);
  console.log(`13. a database failure on a public route says "${r.json.error}" (no internals) ✓`);

  // ---- the bare domain forwards to the portal ----
  const hosts = require(ROOT + '/lib/hosts');
  const APEX = `apex.localhost:${PORT}`;
  process.env.REDIRECT_HOSTS = 'apex.localhost, www.apex.localhost';
  r = await send(APEX, 'GET', '/track?ref=ACME-1234');
  assert(r.status === 301 && r.headers.location === `http://localhost:${PORT}/track?ref=ACME-1234`, `${r.status} ${r.headers.location}`);
  r = await send(`www.apex.localhost:${PORT}`, 'GET', '/');
  assert(r.status === 301 && r.headers.location === `http://localhost:${PORT}/`);
  r = await send(APEX, 'POST', '/api/submit', { json: {} });
  assert(r.status === 308, 'a form post keeps its method');
  assert.strictEqual((await send(PUB, 'GET', '/')).status, 200, 'the portal itself is not redirected');
  assert.strictEqual((await send(ADM, 'GET', '/admin/login')).status, 200, 'the admin site is untouched');
  delete process.env.REDIRECT_HOSTS;
  const savedBase = process.env.BASE_URL, savedAdmin = process.env.ADMIN_URL;
  process.env.BASE_URL = 'https://portal.autowerkeit.com'; process.env.ADMIN_URL = 'https://admin.autowerkeit.com';
  assert.deepStrictEqual(hosts.redirectHosts(), ['autowerkeit.com', 'www.autowerkeit.com']);
  process.env.REDIRECT_HOSTS = 'none';
  assert.deepStrictEqual(hosts.redirectHosts(), []);
  process.env.REDIRECT_HOSTS = 'portal.autowerkeit.com, admin.autowerkeit.com';
  assert.deepStrictEqual(hosts.redirectHosts(), [], 'the portal and admin hosts are never redirected (no loops)');
  delete process.env.REDIRECT_HOSTS;
  process.env.BASE_URL = 'http://localhost:3000';
  assert.deepStrictEqual(hosts.redirectHosts(), [], 'localhost derives nothing');
  process.env.BASE_URL = savedBase; process.env.ADMIN_URL = savedAdmin;
  console.log('14. autowerkeit.com and www. -> portal (301, same path + query; 308 for posts); portal and admin untouched; no loops ✓');

  // ---- homepage dark mode: loaded from files (the CSP allows no inline script), off by default ----
  r = await send(PUB, 'GET', '/');
  const head = r.text.split('</head>')[0];
  assert(head.includes('<script src="/theme-mode.js"></script>'), 'theme-mode.js runs in <head>, before the page paints');
  assert(!/<script(?![^>]* src=)[^>]*>/.test(r.text), 'no inline scripts on the homepage');
  assert(!/<html[^>]*data-theme/.test(r.text), "the page is served light; only a visitor's own choice turns it dark");
  assert(/id="themeToggle"[^>]* hidden>/.test(r.text), 'the switch stays hidden until its script is running');
  for (const f of ['/theme-mode.js', '/home-dark.css', '/brand/autowerke-it-logo-dark.svg']) {
    assert.strictEqual((await send(PUB, 'GET', f)).status, 200, f);
  }
  console.log('15. homepage dark mode: script in <head> from a file, light by default, switch hidden without JS ✓');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
