// End-to-end test: workspace. Run all with `npm test`. Uses an in-memory database (tests/fakedb.js)
// and stubbed email/storage, so it never touches Supabase or sends real email.
const ROOT = require('path').join(__dirname, '..');
process.env.PORT = '3563'; process.env.BASE_URL = 'http://localhost:3563';
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x';
process.env.RESEND_API_KEY = 'x'; process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026'; process.env.ADMIN_NAME = 'Gil';
process.env.APP_SECRET = 'c'.repeat(64); process.env.NODE_ENV = 'production';
process.env.CREDENTIALS_KEY = require('crypto').randomBytes(32).toString('base64');
const assert = require('assert'); const crypto = require('crypto');
const uploads = [];
require(ROOT + '/lib/storage').uploadSignedContract = async (ref, buf, name, type, label) => { uploads.push(ref); return `https://store/${ref}/${label}`; };
require(ROOT + '/lib/storage').signedUrl = async (p) => `https://signed.example/${p}`;
const T = require('./fakedb.js')(require(ROOT + '/lib/db'));
require('./fakedb.js').extend(require(ROOT + '/lib/db'), T);
const clientToken = crypto.randomUUID();
T.projects.push({ id: crypto.randomUUID(), project_id: 'TANNER-5422', confirm_token: clientToken, company_name: 'Tanner Republic', name: 'Rudo', surname: 'Moyo', email: 'rudo@tanner.co.zw', phone: '+263 77 000 0000',
  request_type: 'IT Project', status: 'signed', project_title: 'Intune Application Deployment', details: 'Deploy 3 apps to 150 devices', phases: [{ title: 'Kickoff', done: true }, { title: 'Build', done: false }] });
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => (String(u).includes('api.resend.com') ? (emails.push(JSON.parse(o.body)), { ok: true, json: async () => ({}) }) : realFetch(u, o));
require(ROOT + '/server.js');
const B = 'http://localhost:3563';
async function signIn(email, password) {
  await realFetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const code = emails.at(-1).subject.match(/code: ([A-Z]{6})$/)[1];
  const r = await realFetch(B + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  return { Cookie: `aw_admin=${r.headers.get('set-cookie').match(/aw_admin=([^;]+)/)[1]}` };
}
const call = async (C, method, p, body, raw) => {
  const r = await realFetch(B + p, { method, headers: { ...C, ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
(async () => {
  await new Promise((r) => setTimeout(r, 400));
  const G = await signIn('gil@autowerkeit.com', 'Bootstrap-Pass-2026');
  await call(G, 'POST', '/api/admin/team', { name: 'Tino', email: 'tino@autowerkeit.com', password: 'Colleague-Pass-99' });
  await call(G, 'POST', '/api/admin/team', { name: 'Farai', email: 'farai@autowerkeit.com', password: 'Colleague-Pass-98' });
  assert.strictEqual((await call(G, 'POST', '/api/admin/workspaces', { ref: 'nope-1' })).status, 404);
  const ws = (await call(G, 'POST', '/api/admin/workspaces', { ref: 'tanner-5422' })).json;
  assert(ws.ref === 'TANNER-5422' && ws.title === 'Intune Application Deployment');
  assert.strictEqual((await call(G, 'POST', '/api/admin/workspaces', { ref: 'TANNER-5422' })).json.id, ws.id);
  console.log('1. workspace opened from a ticket number (unknown refs refused; reopening returns the same one) ✓');
  let r = await call(G, 'POST', `/api/admin/workspaces/${ws.id}/items`, { kind: 'login', title: 'M365 global admin', data: { username: 'admin@tanner.onmicrosoft.com', mfa_method: 'Authenticator app', mfa_holder: "Rudo's phone", password: 'SHOULD-NOT-STORE' }, secrets: { password: 'Tr0ub4dor&3', mfa_backup: '1234-5678' } });
  const login = r.json;
  assert(r.status === 200 && login.has_secret && !('secret_enc' in login) && !('password' in login.data));
  const raw = JSON.stringify(T.workspace_items);
  assert(!raw.includes('Tr0ub4dor') && !raw.includes('1234-5678') && !raw.includes('SHOULD-NOT-STORE'));
  assert.deepStrictEqual((await call(G, 'POST', `/api/admin/workspace-items/${login.id}/reveal`)).json.secrets, { password: 'Tr0ub4dor&3', mfa_backup: '1234-5678' });
  await call(G, 'PATCH', `/api/admin/workspace-items/${login.id}`, { title: 'M365 global admin', data: login.data, secrets: { password: '' } });
  assert.strictEqual((await call(G, 'POST', `/api/admin/workspace-items/${login.id}/reveal`)).json.secrets.password, 'Tr0ub4dor&3');
  console.log('2. password + backup codes ENCRYPTED (not in DB or API lists); Reveal decrypts; saving blank keeps them ✓');
  await call(G, 'POST', `/api/admin/workspaces/${ws.id}/items`, { kind: 'contact', title: 'Rudo Moyo', data: { role: 'IT Manager' } });
  await call(G, 'PATCH', `/api/admin/workspaces/${ws.id}`, { notes: 'Found: legacy GPO blocking installs.', environment: 'Tenant: tanner.onmicrosoft.com' });
  assert.strictEqual((await call(G, 'POST', `/api/admin/workspaces/${ws.id}/items`, { kind: 'document', title: 'x' })).status, 400);
  console.log('3. contact, notes canvas + environment banner saved; documents only via upload ✓');
  assert.deepStrictEqual((await call(G, 'POST', `/api/admin/workspaces/${ws.id}/shares`, { email: 'tino@autowerkeit.com', sections: ['people', 'notes'] })).json.sections, ['people', 'notes']);
  const Tn = await signIn('tino@autowerkeit.com', 'Colleague-Pass-99');
  r = await call(Tn, 'GET', `/api/admin/workspaces/${ws.id}`);
  // People-only: every visible item must be a contact (the auto-added client + the one added above), never a login
  const kinds = new Set(r.json.items.map((i) => i.kind));
  assert(r.status === 200 && kinds.size === 1 && kinds.has('contact') && r.json.items.length === 2, JSON.stringify([...kinds]));
  assert(!JSON.stringify(r.json).includes('M365 global admin'), 'no trace of the login');
  assert(r.json.workspace.notes.startsWith('Found') && r.json.shares.length === 0);
  for (const [m, p, b] of [['POST', `/api/admin/workspace-items/${login.id}/reveal`], ['PATCH', `/api/admin/workspace-items/${login.id}`, { title: 'hacked' }], ['DELETE', `/api/admin/workspace-items/${login.id}`], ['POST', `/api/admin/workspaces/${ws.id}/items`, { kind: 'login', title: 'x' }], ['POST', `/api/admin/workspaces/${ws.id}/shares`, { email: 'farai@autowerkeit.com' }]]) {
    assert.strictEqual((await call(Tn, m, p, b)).status, 403, `${m} ${p}`);
  }
  console.log('4. Tino (People + Notes only): sees just those; can NOT reveal, edit, delete or add logins, or re-share ✓');
  const F = await signIn('farai@autowerkeit.com', 'Colleague-Pass-98');
  assert.strictEqual((await call(F, 'GET', `/api/admin/workspaces/${ws.id}`)).status, 404);
  assert.strictEqual((await call(F, 'POST', '/api/admin/workspaces', { ref: 'TANNER-5422' })).status, 403);
  assert.strictEqual((await call(F, 'POST', `/api/admin/workspace-items/${login.id}/reveal`)).status, 404);
  console.log("5. Farai (not shared): can't open it, claim the ticket, or reveal secrets by guessing an item ID ✓");
  await call(G, 'POST', `/api/admin/workspaces/${ws.id}/shares`, { email: 'tino@autowerkeit.com', sections: null });
  assert.strictEqual((await call(Tn, 'POST', `/api/admin/workspace-items/${login.id}/reveal`)).json.secrets.password, 'Tr0ub4dor&3');
  console.log('6. upgraded to full access -> Tino can now reveal the login ✓');
  const up = (buf, name, d) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); fd.append('description', d); return call(G, 'POST', `/api/admin/workspaces/${ws.id}/documents`, null, fd); };
  assert.strictEqual((await up(Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(500)]), 'Network diagram.pdf', 'From previous provider')).status, 200);
  assert.strictEqual((await up(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(500)]), 'Device list.xlsx', 'Asset register')).status, 200);
  assert.strictEqual((await up(Buffer.from('MZ\x90\x00 evil'), 'invoice.pdf', 'totally a pdf')).status, 400);
  assert.strictEqual((await up(Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(50)]), 'x.pdf', '')).status, 400);
  console.log('7. documents: PDF + Excel accepted with descriptions; renamed .exe refused; description required ✓');
  assert(uploads.length === 2 && uploads.every((ref) => ref === 'ws_TANNER-5422'), uploads.join(','));
  const open = async (C, p) => (await realFetch(B + `/files/${p}`, { headers: C, redirect: 'manual' })).status;
  const wsFile = 'ws_TANNER-5422/1730000000000-workspace-1730000000000.pdf';
  const legacyFile = 'TANNER-5422/1730000000000-workspace-1730000000000.pdf'; // uploaded before the separate folder
  for (const p of [wsFile, legacyFile]) {
    assert.strictEqual(await open(G, p), 302, `owner opens ${p}`);
    assert.strictEqual(await open(Tn, p), 302, `full share opens ${p}`);
    assert.strictEqual(await open(F, p), 404, `unshared admin refused ${p}`);
    assert.strictEqual(await open({}, `${p}?t=${clientToken}`), 404, `client token refused ${p}`);
  }
  assert.strictEqual(await open({}, `TANNER-5422/signed.pdf?t=${clientToken}`), 302, "client still opens their own files");
  await call(G, 'POST', `/api/admin/workspaces/${ws.id}/shares`, { email: 'tino@autowerkeit.com', sections: ['people'] });
  assert.strictEqual(await open(Tn, wsFile), 404, 'Documents section not shared');
  await call(G, 'POST', `/api/admin/workspaces/${ws.id}/shares`, { email: 'tino@autowerkeit.com', sections: null });
  console.log("7b. workspace documents stored in their own folder: owner + shared admins open them; unshared admins, People-only shares and client portal links can't (old uploads too) ✓");
  const tid = (await call(G, 'POST', `/api/admin/workspaces/${ws.id}/time/start`)).json.id;
  T.workspace_time.find((t) => t.id === tid).started_at = new Date(Date.now() - 42 * 60000).toISOString();
  assert.strictEqual((await call(Tn, 'POST', `/api/admin/workspace-time/${tid}/end`)).status, 404);
  await call(G, 'POST', `/api/admin/workspace-time/${tid}/end`);
  const secs = (await call(G, 'GET', `/api/admin/workspaces/${ws.id}`)).json.time.Gil;
  assert(secs >= 42 * 60 && secs < 43 * 60);
  console.log(`8. timer: a 42-minute session logged against Gil (${Math.round(secs / 60)} min); others can't stop your timer ✓`);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
