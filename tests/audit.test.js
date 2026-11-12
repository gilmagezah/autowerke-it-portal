// Security audit, November 2026: one check per finding, each trying the attack that worked
// (or would have) before the fix. `npm test`. In-memory database, stubbed storage and email.
//   1. one malformed address stopped the whole server; async route errors now reach the error handler
//   2. portal file links outlived the portal's 30-day expiry
//   3. wrong passwords from anywhere locked the owner out; password checks froze the app
//   4. the live site started without APP_SECRET; dev code logging trusted BASE_URL alone
//   5. portal uploads were read before the link was checked
//   6. workspace documents kept the browser's claimed type
//   7. escaping in the domain row and timeline; 8. full-length GCM tags on stored secrets
const ROOT = require('path').join(__dirname, '..');
const PORT = 3582;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026'; process.env.ADMIN_NAME = 'Gil';
process.env.APP_SECRET = 'd'.repeat(64); process.env.NODE_ENV = 'production';
process.env.CREDENTIALS_KEY = require('crypto').randomBytes(32).toString('base64');
const assert = require('assert'); const crypto = require('crypto'); const fs = require('fs'); const vm = require('vm');
const { spawnSync } = require('child_process');

const storage = require(ROOT + '/lib/storage');
const stored = [];
storage.uploadSignedContract = async (ref, buf, name, type, label) => { stored.push({ ref, name, type }); return `${storage.PUBLIC_PREFIX}${ref}/${label}.pdf`; };
storage.signedUrl = async (p) => `https://signed.example/${p}`;
const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T);
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => (String(u).includes('api.resend.com') ? (emails.push(JSON.parse(o.body)), { ok: true, json: async () => ({}) }) : realFetch(u, o));
const sec = require(ROOT + '/lib/security');

const liveToken = crypto.randomUUID(); const oldToken = crypto.randomUUID();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
T.projects.push(
  { id: crypto.randomUUID(), project_id: 'LIVE-1001', confirm_token: liveToken, company_name: 'Live Co', name: 'Rudo', email: 'rudo@live.co.zw', request_type: 'IT Project', status: 'proceeding', updated_at: daysAgo(1) },
  { id: crypto.randomUUID(), project_id: 'DONE-1002', confirm_token: oldToken, company_name: 'Done Co', name: 'Tendai', email: 't@done.co.zw', request_type: 'IT Project', status: 'closed', closed_at: daysAgo(40), updated_at: daysAgo(40) },
);

const B = `http://localhost:${PORT}`;
const send = async (method, p, { json, body, headers = {} } = {}) => {
  const r = await realFetch(B + p, { method, redirect: 'manual', headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
  return { status: r.status, location: r.headers.get('location'), json: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') };
};
const login = (password, ip) => send('POST', '/api/auth/login', { json: { email: 'gil@autowerkeit.com', password }, headers: { 'X-Forwarded-For': ip } });

(async () => {
  require(ROOT + '/server.js');
  await new Promise((r) => setTimeout(r, 500));

  // ---- 1. The crash ----
  for (const bad of ['/files/LIVE-1001/%25E0%25A4%25A.pdf', '/files/%25', '/files/LIVE-1001/%25%25%25', '/files/%E0%A4%A']) {
    const r = await send('GET', bad);
    assert([400, 404].includes(r.status), `${bad} -> ${r.status}`);
  }
  assert.strictEqual((await send('GET', '/')).status, 200, 'the server is still up');
  // Any async handler that rejects now gets the normal error answer, with no internals, and the process carries on
  require(ROOT + '/lib/asyncErrors');
  const express = require('express');
  const mini = express();
  mini.get('/boom', async () => { throw new Error('internal detail: db password'); });
  mini.get('/later', async (req, res) => { await new Promise((r) => setTimeout(r, 5)); throw new Error('late'); });
  mini.use((err, req, res, next) => res.status(500).json({ error: 'Something went wrong on our side.' })); // eslint-disable-line no-unused-vars
  const srv = mini.listen(PORT + 1);
  for (const p of ['/boom', '/later']) {
    const r = await realFetch(`http://localhost:${PORT + 1}${p}`);
    const text = await r.text();
    assert(r.status === 500 && !text.includes('db password'), `${p}: ${r.status} ${text}`);
  }
  srv.close();
  assert(process.listenerCount('unhandledRejection') >= 1, 'a stray rejection is logged, not fatal');
  console.log('1. "/files/…%25E0%25A4%25A.pdf" -> 404 and the server keeps running (it used to stop); async route errors get a plain 500 ✓');

  // ---- 6 (needs a fresh sign-in first). Workspace documents: stored with the type found in the file ----
  await login('Bootstrap-Pass-2026', '192.0.2.1');
  const code = emails.at(-1).subject.match(/code: ([A-Z]{6})$/)[1];
  const v = await send('POST', '/api/auth/verify', { json: { email: 'gil@autowerkeit.com', code }, headers: { 'X-Forwarded-For': '192.0.2.1' } });
  const G = { Cookie: `aw_admin=${v.cookie.match(/aw_admin=([^;]+)/)[1]}` };
  const ws = (await send('POST', '/api/admin/workspaces', { json: { ref: 'LIVE-1001' }, headers: G })).json;
  const upload = (bytes, name, claimed) => {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: claimed }), name);
    fd.append('description', 'Signed scope from the client');
    return send('POST', `/api/admin/workspaces/${ws.id}/documents`, { body: fd, headers: G });
  };
  let r = await upload(Buffer.from('%PDF-1.4\n<html><script>alert(1)</script>'), 'scope.pdf', 'text/html');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(stored.at(-1).type, 'application/pdf', 'a PDF claimed as text/html is stored as a PDF');
  r = await upload(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]), 'plan.docx', 'text/html');
  assert(r.status === 200 && /wordprocessingml/.test(stored.at(-1).type), stored.at(-1).type);
  const { storedType } = require(ROOT + '/lib/workspace');
  assert.strictEqual(storedType('application/zip-office', 'odd.zip'), 'application/octet-stream', 'an unknown Office-looking file downloads, never renders');
  console.log('6. workspace uploads stored as what they are (a PDF sent as "text/html" is kept as application/pdf), never the browser\'s claim ✓');

  // ---- 2. Portal file links expire with the portal ----
  r = await send('GET', `/files/LIVE-1001/contract.pdf?t=${liveToken}`);
  assert(r.status === 302 && r.location.startsWith('https://signed.example/LIVE-1001/'), `live link: ${r.status}`);
  assert.strictEqual((await send('GET', `/api/confirm/${oldToken}`)).status, 410, 'the portal itself has expired');
  r = await send('GET', `/files/DONE-1002/contract.pdf?t=${oldToken}`);
  assert.strictEqual(r.status, 404, `an expired link's file: ${r.status}`);
  assert.strictEqual((await send('GET', `/files/DONE-1002/contract.pdf?t=${liveToken}`)).status, 404, "another client's token still opens nothing");
  console.log('2. file links follow the portal: open while live, 404 forty days after the project closed (they used to work forever) ✓');

  // ---- 3. Sign-in: lockouts are per connection, password checks don't stall the app ----
  sec.resetRateLimits();
  for (let i = 0; i < 5; i++) assert.strictEqual((await login('wrong-password-123', '203.0.113.66')).status, 401);
  assert.strictEqual((await login('wrong-password-123', '203.0.113.66')).status, 429, 'the guesser is stopped');
  r = await login('Bootstrap-Pass-2026', '198.51.100.20');
  assert(r.status === 200 && r.json.step === 'code', `the owner, from their own connection, still signs in: ${r.status}`);
  sec.resetRateLimits();
  for (let i = 0; i < 60; i++) await login('wrong-password-123', `10.9.${i}.1`);
  assert.strictEqual((await login('wrong-password-123', '10.9.200.1')).status, 429, 'guessing spread over 60 addresses still stalls');
  // The check runs off the main thread: timers keep firing while a password is verified
  const hash = await sec.hashPassword('Correct-Horse-2026');
  // (count event-loop turns: a blocking scryptSync would allow none until it finished)
  let ticks = 0; let spinning = true;
  const spin = () => { if (spinning) { ticks++; setImmediate(spin); } };
  setImmediate(spin);
  const ok = await sec.verifyPassword('Correct-Horse-2026', hash);
  spinning = false;
  assert(ok === true && ticks >= 10, `verify ok=${ok}, event-loop turns during it=${ticks}`);
  assert.strictEqual(await sec.verifyPassword('nope', hash), false);
  const greedy = hash.replace(/^scrypt\$16384\$/, 'scrypt$1048576$');
  const t0 = Date.now();
  assert.strictEqual(await sec.verifyPassword('Correct-Horse-2026', greedy), false, 'a stored hash asking for a huge cost is refused');
  assert(Date.now() - t0 < 100, 'and refused at once');
  console.log(`3. 5 wrong passwords lock out only that address; the owner signs in from theirs; 60 addresses still stall; scrypt runs async (${ticks} event-loop turns during one check) ✓`);

  // ---- 4. No APP_SECRET on the live site: refuse to start. Dev-only code logging needs all signs of "local" ----
  const boot = (env) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(ROOT + '/lib/security')}); console.log('started')`],
    { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
  for (const env of [{ NODE_ENV: 'production' }, { BASE_URL: 'https://portal.autowerkeit.com' }, { RENDER: 'true', BASE_URL: 'http://typo.autowerkeit.com' }, { NODE_ENV: 'production', APP_SECRET: 'too-short' }]) {
    const out = boot(env);
    assert(out.status !== 0 && /APP_SECRET is missing/.test(out.stderr) && !/started/.test(out.stdout), `${JSON.stringify(env)}: ${out.status} ${out.stderr.slice(0, 200)}`);
  }
  let out = boot({ BASE_URL: 'http://localhost:3000' });
  assert(out.status === 0 && /started/.test(out.stdout) && /temporary one/.test(out.stderr), 'local development still starts, with a warning');
  out = boot({ NODE_ENV: 'production', APP_SECRET: 'e'.repeat(64) });
  assert(out.status === 0 && /started/.test(out.stdout), 'the live site starts with a real secret');
  const saved = { ...process.env };
  const prod = (env) => { for (const k of ['NODE_ENV', 'BASE_URL', 'RENDER']) delete process.env[k]; Object.assign(process.env, env); const p = sec.isProduction(); Object.assign(process.env, saved); return p; };
  assert.strictEqual(prod({ BASE_URL: 'http://localhost:3000' }), false, 'local = development (codes print in the terminal)');
  assert.strictEqual(prod({ RENDER: 'true', BASE_URL: 'http://portal.autowerkeit.com' }), true, 'on Render, even with an http BASE_URL typo, codes never print');
  assert(/const isDev = \(\) => !sec\.isProduction\(\)/.test(fs.readFileSync(ROOT + '/lib/auth.js', 'utf8') + fs.readFileSync(ROOT + '/lib/esign.js', 'utf8')), 'sign-in and sign-off share the rule');
  console.log('4. no APP_SECRET (or a short one) + NODE_ENV=production, https, or Render -> the app refuses to start; on Render codes never print ✓');

  // ---- 5. Portal uploads: the link is checked before the file is read ----
  sec.resetRateLimits();
  const junk = () => { const fd = new FormData(); fd.append('file', new Blob([Buffer.alloc(2 * 1024 * 1024, 0x41)]), 'x.pdf'); return fd; };
  for (const p of ['upload-signed', 'upload-estimate', 'upload-signoff']) {
    r = await send('POST', `/api/confirm/${crypto.randomUUID()}/${p}`, { body: junk() });
    assert(r.status === 404 && /not found/i.test(r.json.error), `${p} with a made-up link: ${r.status} ${JSON.stringify(r.json)}`);
  }
  r = await send('POST', `/api/confirm/${liveToken}/upload-signed`, { body: junk() });
  assert(r.status === 400 && /signed copy as a PDF, PNG or JPG/.test(r.json.error), `a real link still checks the file: ${r.status}`);
  console.log('5. uploads to a made-up portal link -> 404 before the file is read (it used to be checked first); real links unchanged ✓');

  // ---- 7. Escaping ----
  const appJs = fs.readFileSync(ROOT + '/public/app.js', 'utf8');
  assert(!/value="\$\{value/.test(appJs) && /row\.querySelector\('input'\)\.value = value;/.test(appJs), 'domain row sets the value as a property');
  const box = { innerHTML: '' };
  const ctx = { document: {}, window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/public/timeline.js', 'utf8'), ctx);
  const evil = '"><img src=x onerror=alert(1)>';
  ctx.renderTimeline(box, [{ id: evil, date: '2026-11-09', start: `09:00${evil}`, end: '10:00', note: evil }], { editable: true, projectId: evil });
  assert(box.innerHTML.length > 0 && !box.innerHTML.includes('<img'), box.innerHTML.slice(0, 300));
  assert.strictEqual((box.innerHTML.match(/&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 5, 'every injected value shows up as text (id twice, start, note, project id)');
  console.log('7. timeline escapes times, ids and the project id (an <img onerror> in each renders as text); the domain row never parses its value ✓');

  // ---- 8. Stored secrets need the full GCM tag ----
  const { encryptSecret, decryptSecret } = require(ROOT + '/lib/secrets');
  const enc = encryptSecret('registrar-pass-123');
  assert.strictEqual(decryptSecret(enc), 'registrar-pass-123');
  const [ver, ivB, tag, data] = enc.split(':');
  assert.throws(() => decryptSecret([ver, ivB, Buffer.from(tag, 'base64').subarray(0, 4).toString('base64'), data].join(':')), /authentication tag/);
  const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1;
  assert.throws(() => decryptSecret([ver, ivB, tag, flipped.toString('base64')].join(':')));
  console.log('8. stored secrets: a cut-down 4-byte tag or one changed byte is refused; the real value still decrypts ✓');

  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); console.error(e.stack); process.exit(1); });
