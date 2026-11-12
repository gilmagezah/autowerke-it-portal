// End-to-end test: the accessories' server side. Reminders (+ suggestions and the reminder
// email), notes synced to your account (encrypted), saved notes, and the currency rates
// (automatic feeds stubbed, ZiG by hand). `npm test`.
// In-memory database (tests/fakedb.js) and captured email: never touches Supabase or sends mail.
// Adversarial: another admin tries to read, change and delete your reminders and notes.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3574;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`; process.env.ADMIN_URL = `http://admin.localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026'; process.env.ADMIN_NAME = 'Gil';
process.env.APP_SECRET = 'r'.repeat(64); process.env.NODE_ENV = 'production'; process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.REMINDER_TIMEZONE = 'Africa/Harare';
const assert = require('assert'); const crypto = require('crypto'); const http = require('http');
require(ROOT + '/lib/storage').signedUrl = async (p) => `https://signed.example/${p}`;
const db = require(ROOT + '/lib/db');
const fake = require('./fakedb.js');
const T = fake(db); fake.extend(db, T); fake.accessories(db, T);
db.listDueReminders = async () => []; // payment follow-ups: not what this suite is about
process.env.FX_RATES_AUTO = 'on'; // fakedb turns it off for every suite; this one tests it, with the feeds stubbed below
const realFetch = global.fetch; const emails = [];
// Stand-ins for the two rate feeds (shaped like the real ones on 5 Nov 2026). Never the network.
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-11-05'>
  <Cube currency='USD' rate='1.1224'/><Cube currency='GBP' rate='0.83393'/><Cube currency='MYR' rate='4.5412'/>
  <Cube currency='SGD' rate='1.4336'/><Cube currency='ZAR' rate='18.4268'/></Cube></Cube></gesmes:Envelope>`;
const MARKET = { result: 'success', base_code: 'USD', time_last_update_unix: 1793836951, rates: { USD: 1, ZWG: 26.5412, ZAR: 16.423516, BWP: 13.860014, ZMW: 20.370379, MZN: 63.82381, GBP: 0.742316, EUR: 0.889912, AED: 3.6725, MYR: 4.064713, SGD: 1.27882, EGP: 54.769414, MUR: 47.246153 } };
const feeds = { ecb: 'ok', market: 'ok', calls: 0 };
global.fetch = async (u, o) => {
  if (String(u).startsWith('https://www.ecb.europa.eu/')) {
    feeds.calls += 1;
    if (feeds.ecb === 'down') throw new Error('getaddrinfo ENOTFOUND');
    return new Response(feeds.ecb === 'junk' ? '<html>Maintenance</html>' : ECB_XML, { status: 200 });
  }
  if (String(u).startsWith('https://open.er-api.com/')) {
    feeds.calls += 1;
    if (feeds.market === 'down') return new Response('Too many requests', { status: 429 });
    return new Response(JSON.stringify(MARKET), { status: 200 });
  }
  if (String(u).includes('api.resend.com')) { emails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; }
  if (String(u).includes('api.anthropic.com')) return { ok: true, json: async () => ({ content: [{ text: '{}' }] }) };
  return realFetch(u, o);
};
require(ROOT + '/server.js');
const sec = require(ROOT + '/lib/security');
const R = require(ROOT + '/lib/reminders');
const Acc = require(ROOT + '/public/acc-core');

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
async function signIn(email, password) {
  let r = await send(ADM, 'POST', '/api/auth/login', { json: { email, password } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const code = emails.filter((e) => e.to.includes(email)).at(-1).subject.match(/code: ([A-Z]{6})$/)[1];
  r = await send(ADM, 'POST', '/api/auth/verify', { json: { email, code } });
  return r.headers['set-cookie'][0].match(/aw_admin=[^;]+/)[0];
}

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const gil = await signIn('gil@autowerkeit.com', 'Bootstrap-Pass-2026');
  await db.createAdmin({ email: 'rudo@autowerkeit.com', name: 'Rudo', role: 'admin', password_hash: await sec.hashPassword('Second-Admin-Pass-2026') });
  const rudo = await signIn('rudo@autowerkeit.com', 'Second-Admin-Pass-2026');
  const as = (cookie) => (method, path, json, headers = {}) => send(ADM, method, path, { headers: { Cookie: cookie, ...headers }, json });
  const G = as(gil); const Ru = as(rudo);
  const gilId = T.admin_users.find((a) => a.email === 'gil@autowerkeit.com').id;

  // ---- 1. Admin only, admin site only ----
  for (const [m, p] of [['GET', '/api/admin/reminders'], ['POST', '/api/admin/reminders'], ['GET', '/api/admin/reminders/suggestions'],
    ['GET', '/api/admin/notes'], ['PUT', '/api/admin/notes'], ['GET', '/api/admin/fx-rates'], ['PUT', '/api/admin/fx-rates']]) {
    assert.strictEqual((await send(ADM, m, p, { json: m === 'GET' ? undefined : {} })).status, 401, `${m} ${p} without a session`);
    assert.strictEqual((await send(PUB, m, p, { headers: { Cookie: gil }, json: m === 'GET' ? undefined : {} })).status, 404, `${m} ${p} on the public site`);
  }
  console.log('1. reminders, notes and rates need an admin session, and never answer on the public site ✓');

  // ---- 2. Creating reminders: Harare time, plain-English refusals ----
  const today = R.localToday();
  const tomorrow = Acc.addDays(today, 1);
  for (const [bad, why] of [
    [{ date: tomorrow, time: '09:00' }, /title/], [{ title: '   ', date: tomorrow, time: '09:00' }, /title/],
    [{ title: 'x', date: '6 Nov', time: '09:00' }, /date and a time/], [{ title: 'x', date: tomorrow, time: '9am' }, /date and a time/],
    [{ title: 'x', date: tomorrow, time: '24:00' }, /date and a time/], [{ title: 'x', date: ['2026-11-06'], time: '09:00' }, /date and a time/],
    [{ title: 'x', date: Acc.addDays(today, -1), time: '09:00' }, /already passed/], [{ title: 'x', date: Acc.addDays(today, 1200), time: '09:00' }, /3 years/],
    [{ title: 'x', date: tomorrow, time: '09:00', ref: '%' }, /reference/],
  ]) {
    const r = await G('POST', '/api/admin/reminders', bad);
    assert(r.status === 400 && why.test(r.json.error), `${JSON.stringify(bad)} -> ${r.status} ${r.json && r.json.error}`);
  }
  let r = await G('POST', '/api/admin/reminders', { title: '  Nudge   Tanner about the estimate ', date: tomorrow, time: '09:00', ref: 'tanner-5422', note: 'Ask for the signed copy', email: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const nudge = r.json;
  assert.strictEqual(nudge.title, 'Nudge Tanner about the estimate');
  assert.strictEqual(nudge.ref, 'TANNER-5422');
  assert.deepStrictEqual(nudge.local, { date: tomorrow, time: '09:00' });
  assert.strictEqual(new Date(nudge.due_at).toISOString(), `${tomorrow}T07:00:00.000Z`, '09:00 in Harare is 07:00 UTC, whatever the server clock says');
  assert.strictEqual(nudge.admin_id, gilId);
  r = await G('POST', '/api/admin/reminders', { title: 'x'.repeat(500), date: tomorrow, time: '10:00', email: 'yes' });
  assert(r.json.title.length === 200 && r.json.email === false, 'long titles trimmed; email is only on for a real true');
  console.log('2. reminders: set in Harare time (09:00 -> 07:00 UTC), refs cleaned, bad dates/times, past and far-future refused ✓');

  // ---- 3. Your reminders are yours ----
  r = await Ru('GET', '/api/admin/reminders');
  assert.strictEqual(r.json.reminders.length, 0, 'another admin sees none of yours');
  assert.strictEqual((await Ru('PATCH', `/api/admin/reminders/${nudge.id}`, { done: true })).status, 404);
  assert.strictEqual((await Ru('PATCH', `/api/admin/reminders/${nudge.id}`, { title: 'hijacked' })).status, 404);
  await Ru('DELETE', `/api/admin/reminders/${nudge.id}`);
  const still = T.admin_reminders.find((x) => x.id === nudge.id);
  assert(still && !still.done_at && still.title === 'Nudge Tanner about the estimate', 'their PATCH and DELETE changed nothing');
  for (const id of ['abc', "1' or '1'='1", '..%2F..']) assert.strictEqual((await G('PATCH', `/api/admin/reminders/${encodeURIComponent(id)}`, { done: true })).status, 404, id);
  r = await G('GET', '/api/admin/reminders');
  assert.strictEqual(r.json.reminders.length, 2);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  console.log('3. another admin can’t list, tick off, edit or delete your reminders; junk ids are a plain 404 ✓');

  // ---- 4. Done, undo, snooze, edit ----
  assert.strictEqual((await G('PATCH', `/api/admin/reminders/${nudge.id}`, {})).status, 400);
  for (const s of [0, 7, 999999, '60; drop', -60]) assert.strictEqual((await G('PATCH', `/api/admin/reminders/${nudge.id}`, { snooze: s })).status, 400, `snooze ${s}`);
  T.admin_reminders.find((x) => x.id === nudge.id).emailed_at = new Date().toISOString();
  const t0 = Date.now();
  r = await G('PATCH', `/api/admin/reminders/${nudge.id}`, { snooze: 60 });
  assert(Math.abs(new Date(r.json.due_at) - (t0 + 3600000)) < 5000 && r.json.emailed_at === null, 'snoozed an hour, and it will email again');
  r = await G('PATCH', `/api/admin/reminders/${nudge.id}`, { done: true });
  assert(r.json.done_at);
  r = await G('GET', '/api/admin/reminders');
  assert(!r.json.reminders.some((x) => x.id === nudge.id) && r.json.done.some((x) => x.id === nudge.id), 'moves to "done this week"');
  await G('PATCH', `/api/admin/reminders/${nudge.id}`, { done: false });
  r = await G('PATCH', `/api/admin/reminders/${nudge.id}`, { date: tomorrow, time: '11:30', title: 'Call Tanner' });
  assert(r.json.title === 'Call Tanner' && r.json.local.time === '11:30' && !r.json.done_at);
  console.log('4. done/undo, snooze only 15 min / 1 h / 3 h / 1 day (re-arms the email), edits re-checked ✓');

  // ---- 5. Suggestions: stable keys, no repeats once taken ----
  const old = (d) => new Date(Date.now() - d * 86400000).toISOString();
  T.projects.push(
    { id: crypto.randomUUID(), project_id: 'TANNER-5422', company_name: 'Tanner Republic', request_type: 'IT Project', status: 'pricing_sent', updated_at: old(6), created_at: old(20) },
    { id: crypto.randomUUID(), project_id: 'FRESH-1000', company_name: 'Fresh Co', request_type: 'IT Project', status: 'pricing_sent', updated_at: old(1), created_at: old(1) },
    { id: crypto.randomUUID(), project_id: 'OURS-2000', company_name: 'Ours Ltd', request_type: 'IT Project', status: 'client_confirmed', updated_at: old(9), created_at: old(9) },
    { id: crypto.randomUUID(), project_id: 'HILLBU-7001', company_name: 'Hillburys', request_type: 'IT Support', status: 'in_progress', updated_at: old(8), created_at: old(8), work_log: [{ date: Acc.addDays(today, -6) }] },
    { id: crypto.randomUUID(), project_id: 'MEET-3000', company_name: 'Meetly', request_type: 'Consultancy', status: 'consult_meeting_confirmed', updated_at: old(1), consult_confirmed: { start_utc: new Date(Date.now() + 3 * 86400000).toISOString() } },
  );
  T.invoices.push({ id: crypto.randomUUID(), number: 'AW-INV-2026-0042', company: 'Tanner Republic', ref: 'TANNER-5422', status: 'issued', due_date: Acc.addDays(today, -2), follow_up_id: crypto.randomUUID() },
    { id: crypto.randomUUID(), number: 'AW-INV-2026-0043', company: 'Later Ltd', status: 'issued', due_date: Acc.addDays(today, 20) },
    { id: crypto.randomUUID(), number: 'AW-INV-2026-0044', company: 'Paid Ltd', status: 'paid', due_date: Acc.addDays(today, -1) });
  r = await G('GET', '/api/admin/reminders/suggestions');
  const sug = r.json.suggestions;
  const kinds = sug.map((s) => s.kind);
  assert(sug.some((s) => s.kind === 'nudge' && s.ref === 'TANNER-5422' && /6 days/.test(s.why)), 'client sitting on a price for 6 days');
  assert(!sug.some((s) => ['FRESH-1000', 'OURS-2000'].includes(s.ref) && s.kind === 'nudge'), 'not after 1 day, and not when the ball is in our court');
  assert(sug.some((s) => s.kind === 'idle' && s.ref === 'HILLBU-7001' && /6 days/.test(s.why)), 'support ticket with no time logged');
  const meet = sug.find((s) => s.kind === 'meeting');
  assert(meet && meet.ref === 'MEET-3000', 'meeting prep');
  assert(sug.some((s) => s.kind === 'invoice' && /AW-INV-2026-0042/.test(s.title) && /2 days overdue \(follow-up emails/.test(s.why)), 'overdue invoice');
  assert(!sug.some((s) => /0043|0044/.test(s.title)), 'not invoices due later or already paid');
  assert(kinds.length <= 12 && sug.every((s) => s.key && Acc.isDate(s.date) && /^\d\d:\d\d$/.test(s.time)));
  assert(sug.filter((s) => s.time === '09:00' && s.kind !== 'invoice').every((s) => Acc.isWorkingDay(s.date)), 'suggested for a working morning');
  const take = sug.find((s) => s.kind === 'nudge');
  r = await G('POST', '/api/admin/reminders', { title: take.title, ref: take.ref, date: take.date, time: take.time, source: take.key });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual((await G('POST', '/api/admin/reminders', { title: take.title, date: take.date, time: take.time, source: take.key })).status, 409, 'the same suggestion twice');
  r = await G('GET', '/api/admin/reminders/suggestions');
  assert(!r.json.suggestions.some((s) => s.key === take.key), 'a suggestion you took isn’t offered again');
  assert((await Ru('GET', '/api/admin/reminders/suggestions')).json.suggestions.some((s) => s.key === take.key), '…but still is to another admin');
  console.log('5. suggestions: clients waiting 3+ days, quiet tickets, meeting prep, invoices due/overdue; taken ones vanish (409 on a repeat) ✓');

  // ---- 6. At most 50 open ----
  const open = T.admin_reminders.filter((x) => x.admin_id === gilId && !x.done_at).length;
  for (let i = open; i < R.MAX_OPEN; i++) await G('POST', '/api/admin/reminders', { title: `Filler ${i}`, date: Acc.addDays(today, 30), time: '09:00', email: false });
  r = await G('POST', '/api/admin/reminders', { title: 'one too many', date: tomorrow, time: '09:00' });
  assert(r.status === 400 && /50 open/.test(r.json.error));
  T.admin_reminders = T.admin_reminders.filter((x) => !/^Filler/.test(x.title));
  console.log('6. up to 50 open reminders each ✓');

  // ---- 7. Due now: the background check, and the reminder email (once) ----
  const nowL = R.local(new Date().toISOString());
  r = await G('POST', '/api/admin/reminders', { title: 'Ring <b>Hillburys</b> back', date: nowL.date, time: nowL.time, note: 'Line 1\nLine 2' });
  assert.strictEqual(r.status, 200, 'this minute is fine');
  const dueOne = r.json;
  await G('POST', '/api/admin/reminders', { title: 'Quiet one', date: nowL.date, time: nowL.time, email: false });
  await Ru('POST', '/api/admin/reminders', { title: 'Rudo’s own', date: nowL.date, time: nowL.time });
  await new Promise((res) => setTimeout(res, 50));
  // A fresh session (so the session cache starts empty), last used 5 minutes ago
  const G2 = as(await signIn('gil@autowerkeit.com', 'Bootstrap-Pass-2026'));
  const sess = T.admin_sessions.filter((s) => s.admin_id === gilId).at(-1);
  const stale = new Date(Date.now() - 5 * 60000).toISOString();
  sess.last_seen_at = stale;
  r = await G2('GET', '/api/admin/reminders?due=1', undefined, { 'X-Background': '1' });
  assert(r.json.due.some((x) => x.id === dueOne.id) && r.json.due.every((x) => x.admin_id === gilId), JSON.stringify(r.json));
  assert.strictEqual(sess.last_seen_at, stale, 'the background check doesn’t keep an idle session alive');
  await G2('GET', '/api/admin/reminders');
  assert.notStrictEqual(sess.last_seen_at, stale, 'a real request does');
  const before = emails.length;
  r = await send(PUB, 'POST', '/api/cron/reminders', { headers: { 'X-Cron-Key': process.env.CRON_SECRET } });
  assert.strictEqual(r.status, 200, r.text);
  await send(PUB, 'POST', '/api/cron/reminders', { headers: { 'X-Cron-Key': process.env.CRON_SECRET } });
  const mine = emails.filter((e) => e.to.includes('gil@autowerkeit.com') && /Ring/.test(e.subject));
  assert.strictEqual(mine.length, 1, 'emailed once, not on every run');
  assert(mine[0].html.includes('Ring &lt;b&gt;Hillburys&lt;/b&gt; back') && !mine[0].html.includes('<b>Hillburys'), 'reminder text is escaped in the email');
  assert(mine[0].html.includes('Line 1<br>Line 2') || mine[0].html.includes('Line 1<br/>Line 2') || mine[0].html.includes('Line 1<br />Line 2'), 'note line breaks kept');
  assert(mine[0].html.includes(`http://admin.localhost:${PORT}/admin`), 'links to the admin site');
  assert(!emails.slice(before).some((e) => /Quiet one/.test(e.subject + e.html)), '"Email me" off: no email');
  assert(emails.slice(before).some((e) => e.to.includes('rudo@autowerkeit.com') && /Rudo/.test(e.subject)) && !mine[0].html.includes('Rudo'), 'each admin gets only their own');
  assert(T.admin_reminders.find((x) => x.id === dueOne.id).emailed_at);
  console.log('7. due reminders: shown to their owner by a background check that doesn’t extend the session; emailed once by the cron, escaped, only to their owner ✓');

  // ---- 8. Missing schema: a clear 503, and the other reminders still run ----
  const realList = db.listReminders; const realDue = db.listDueAdminReminders;
  db.listReminders = async () => { throw new Error('relation "public.admin_reminders" does not exist'); };
  db.listDueAdminReminders = db.listReminders;
  r = await G('GET', '/api/admin/reminders?due=1');
  assert(r.status === 503 && /schema_accessories\.sql/.test(r.json.error));
  r = await send(PUB, 'POST', '/api/cron/reminders', { headers: { 'X-Cron-Key': process.env.CRON_SECRET } });
  assert.strictEqual(r.status, 200, 'the cron carries on without the table');
  db.listReminders = realList; db.listDueAdminReminders = realDue;
  console.log('8. before schema_accessories.sql is run: a clear 503 naming the file, and the cron still works ✓');

  // ---- 9. Notes: encrypted, yours only, never silently overwritten ----
  r = await G('GET', '/api/admin/notes');
  assert.deepStrictEqual(r.json, { configured: true, pages: null, updated_at: null });
  for (const bad of [{}, { pages: [] }, { pages: 'x' }, { pages: [{ text: 5 }] }, { pages: Array(10).fill({ text: 'a' }) }, { pages: [{ text: 'x'.repeat(20001) }] }]) {
    assert.strictEqual((await G('PUT', '/api/admin/notes', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  const secretish = 'Call Tanner re: Intune rollout, 14:00';
  r = await G('PUT', '/api/admin/notes', { pages: [{ text: secretish, at: 1 }], base: null });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const v1 = r.json.updated_at;
  const row = T.admin_notes.find((n) => n.admin_id === gilId);
  assert(row && !row.pages_enc.includes('Tanner') && !row.pages_enc.includes('Intune'), 'stored encrypted, not as text');
  r = await G('GET', '/api/admin/notes');
  assert(r.json.pages[0].text === secretish && r.json.updated_at === v1);
  assert.strictEqual((await Ru('GET', '/api/admin/notes')).json.pages, null, 'another admin can’t read yours');
  await new Promise((res) => setTimeout(res, 5));
  r = await G('PUT', '/api/admin/notes', { pages: [{ text: 'from the laptop' }], base: v1 });
  assert.strictEqual(r.status, 200);
  r = await G('PUT', '/api/admin/notes', { pages: [{ text: 'from the phone, stale' }], base: v1 });
  assert(r.status === 409 && r.json.pages[0].text === 'from the laptop', 'a stale device gets the newer copy back instead of overwriting it');
  const merged = Acc.mergeNotes(r.json.pages, [{ text: 'from the phone, stale' }]);
  assert.deepStrictEqual(merged.map((p) => p.text), ['from the laptop', 'from the phone, stale']);
  r = await G('PUT', '/api/admin/notes', { pages: merged, base: r.json.updated_at });
  assert.strictEqual(r.status, 200, 'the merge saves');
  const key = process.env.CREDENTIALS_KEY; delete process.env.CREDENTIALS_KEY;
  assert.deepStrictEqual((await G('GET', '/api/admin/notes')).json, { configured: false });
  r = await G('PUT', '/api/admin/notes', { pages: [{ text: 'x' }] });
  assert(r.status === 400 && r.json.configured === false, 'no key: the notepad stays in the browser');
  process.env.CREDENTIALS_KEY = key;
  console.log('9. notes: encrypted at rest, only yours, a stale device gets a 409 + the newer copy (merged, nothing lost), browser-only without CREDENTIALS_KEY ✓');

  // ---- 10. Currency rates: automatic every 12 hours (ECB + market feed), ZiG set by hand ----
  const fx = require(ROOT + '/lib/fxRates');
  await new Promise((res) => setTimeout(res, 200)); // let any refresh the cron calls above started finish
  delete T.app_settings.fx_rates; feeds.calls = 0;
  assert.strictEqual((await send(ADM, 'GET', '/api/admin/fx-rates')).status, 401);
  r = await G('GET', '/api/admin/fx-rates');
  assert.strictEqual(feeds.calls, 2, 'first look: both feeds fetched');
  let v = r.json;
  assert(Math.abs(v.rates.ZAR - 18.4268 / 1.1224) < 1e-6 && v.sources.ZAR === 'ECB', `ECB quotes per euro; we convert to per dollar: ${v.rates.ZAR}`);
  assert(Math.abs(v.rates.EUR - 1 / 1.1224) < 1e-6 && v.sources.EUR === 'ECB');
  assert(v.sources.GBP === 'ECB' && v.sources.MYR === 'ECB' && v.sources.SGD === 'ECB', 'official ECB rate wherever the ECB publishes one');
  assert(v.rates.BWP === 13.860014 && v.sources.BWP === 'ExchangeRate-API' && v.sources.AED === 'ExchangeRate-API', 'the market feed for the rest');
  assert(!v.rates.ZWG && v.hints.ZWG.rate === 26.5412, 'ZiG is never set automatically: the feed figure is only a hint');
  assert.deepStrictEqual(v.manualCodes, ['ZWG']);
  assert(v.auto.at && v.auto.ecb_date === '2026-11-05' && !v.auto.error && new Date(v.auto.next_at) - new Date(v.auto.at) === 12 * 3600000);
  // ZiG by hand; automatic ones can't be overridden
  for (const bad of [{ rates: { ZWG: 'abc' } }, { rates: { ZWG: '-1' } }, { rates: { ZWG: 0 } }, { rates: { XXX: 1 } }, { rates: { USD: 2 } }, { rates: 'ZWG=26' }, { rates: { ZWG: '1e5' } }, { rates: [26] }, { rates: { ZWG: true } }]) {
    r = await G('PUT', '/api/admin/fx-rates', bad);
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)} -> ${r.status}`);
  }
  r = await G('PUT', '/api/admin/fx-rates', { rates: { ZAR: '17' } });
  assert(r.status === 400 && /automatically/.test(r.json.error), 'rand comes from the ECB, not a person');
  r = await G('PUT', '/api/admin/fx-rates', { rates: { ZWG: '26.85' } });
  assert(r.status === 200 && r.json.rates.ZWG === 26.85 && r.json.sources.ZWG === 'manual' && r.json.manual.ZWG.by === 'Gil', JSON.stringify(r.json));
  r = await Ru('GET', '/api/admin/fx-rates');
  assert(r.json.rates.ZWG === 26.85 && r.json.manual.ZWG.by === 'Gil', 'every admin sees the same rates, and who set ZiG');
  assert.strictEqual(Acc.convert(100, 'USD', 'ZWG', r.json.rates), 2685);
  assert.strictEqual(feeds.calls, 2, 'no refetch within 12 hours');
  // 13 hours later the ECB is down: rand etc. fall back to the market feed; ZiG stays as you set it
  const later = (h) => new Date(Date.now() + h * 3600000);
  feeds.ecb = 'down';
  let s = await fx.refresh({ now: later(13) });
  v = fx.view(s, later(13));
  assert(v.sources.ZAR === 'ExchangeRate-API' && v.rates.ZAR === 16.423516 && /ECB/.test(v.auto.error), JSON.stringify(v.auto));
  assert(v.rates.ZWG === 26.85 && v.sources.ZWG === 'manual', 'a refresh never touches the ZiG you set');
  // Both down: the last good rates stay, with the error shown, and it tries again in an hour (not every minute)
  feeds.market = 'down'; feeds.calls = 0;
  s = await fx.refresh({ now: later(26) });
  v = fx.view(s, later(26));
  assert(v.rates.ZAR === 16.423516 && v.rates.BWP === 13.860014 && /ECB/.test(v.auto.error) && /429/.test(v.auto.error), 'old rates kept');
  await fx.refresh({ now: later(26.2) });
  assert.strictEqual(feeds.calls, 2, 'no retry storm');
  assert(!fx.view(s, later(30)).auto.stale && fx.view(s, later(50)).auto.stale, 'last good fetch 36+ hours ago: flagged');
  // A garbled page from the ECB is refused, not half-read
  feeds.market = 'ok'; feeds.ecb = 'junk';
  s = await fx.refresh({ now: later(28) });
  assert(/unexpected format/.test(s.auto.error) && fx.view(s).sources.ZAR === 'ExchangeRate-API');
  // "Refresh now" works, but at most every 5 minutes
  feeds.ecb = 'ok'; feeds.calls = 0;
  r = await G('POST', '/api/admin/fx-rates/refresh');
  assert(r.status === 200 && r.json.sources.ZAR === 'ECB' && feeds.calls === 2, JSON.stringify(r.json.auto));
  await G('POST', '/api/admin/fx-rates/refresh');
  assert.strictEqual(feeds.calls, 2, 'a second press straight away doesn’t refetch');
  // A currency with no automatic rate at all can be set by hand; a blank ZiG removes it
  const st0 = await fx.load(); delete st0.auto.rates.MUR; await db.setSetting(fx.KEY, st0);
  r = await G('PUT', '/api/admin/fx-rates', { rates: { MUR: '46.5' } });
  assert(r.status === 200 && r.json.sources.MUR === 'manual' && r.json.manualCodes.includes('MUR'));
  r = await G('PUT', '/api/admin/fx-rates', { rates: { ZWG: '' } });
  assert(!r.json.rates.ZWG, 'blank removes it');
  // Rates saved by the earlier, all-by-hand converter: ZiG carries over, the rest go automatic
  const legacy = fx.normalize({ rates: { ZWG: 25.9, ZAR: 18 }, updated_at: '2026-11-01T08:00:00Z', updated_by: 'Gil' });
  assert(legacy.manual.ZWG.rate === 25.9 && legacy.manual.ZWG.by === 'Gil' && !legacy.auto.rates.ZAR);
  console.log('10. currency rates: ECB (official) and a market feed every 12 h, per dollar; ZiG only by hand (feed figure as a hint); feeds down = last good rates kept, retried hourly ✓');

  // ---- 11. Saved notes: encrypted (titles too), yours only ----
  assert.strictEqual((await send(ADM, 'GET', '/api/admin/notes/saved')).status, 401);
  assert.strictEqual((await send(ADM, 'POST', '/api/admin/notes/saved', { json: { text: 'x' } })).status, 401);
  assert.strictEqual((await send(PUB, 'GET', '/api/admin/notes/saved', { headers: { Cookie: gil } })).status, 404);
  for (const bad of [{}, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(20001) }]) assert.strictEqual((await G('POST', '/api/admin/notes/saved', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  const body = '[05 Nov 2026, 14:02] Call with Tanner Republic\nIntune rollout on Thursday at 14:00\nBring the licence count';
  r = await G('POST', '/api/admin/notes/saved', { text: body });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const saved = r.json;
  assert.strictEqual(saved.title, 'Call with Tanner Republic', 'titled by its first line, date stamp skipped');
  const srow = T.admin_saved_notes.find((x) => x.id === saved.id);
  assert(srow && !/Tanner|Intune/.test(srow.title_enc + srow.body_enc) && srow.chars === body.length, 'title and text stored encrypted');
  r = await G('GET', '/api/admin/notes/saved');
  assert(r.json.notes.length === 1 && r.json.notes[0].title === saved.title && /^Intune rollout/.test(r.json.notes[0].preview) && !('text' in r.json.notes[0]));
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  r = await G('GET', `/api/admin/notes/saved/${saved.id}`);
  assert.strictEqual(r.json.text, body);
  assert.strictEqual((await Ru('GET', '/api/admin/notes/saved')).json.notes.length, 0, 'another admin sees none of yours');
  assert.strictEqual((await Ru('GET', `/api/admin/notes/saved/${saved.id}`)).status, 404);
  assert.strictEqual((await Ru('PUT', `/api/admin/notes/saved/${saved.id}`, { text: 'hijacked' })).status, 404);
  await Ru('DELETE', `/api/admin/notes/saved/${saved.id}`);
  assert(T.admin_saved_notes.some((x) => x.id === saved.id), 'their delete did nothing');
  for (const id of ['abc', '../x', 'local-123']) assert.strictEqual((await G('GET', `/api/admin/notes/saved/${encodeURIComponent(id)}`)).status, 404, id);
  r = await G('PUT', `/api/admin/notes/saved/${saved.id}`, { text: 'Tanner follow-up\nSent the quote' });
  assert(r.json.title === 'Tanner follow-up' && r.json.id === saved.id, 'saving again updates the same note');
  r = await G('POST', '/api/admin/notes/saved', { text: 'Second', title: '  Custom   title ' });
  assert.strictEqual(r.json.title, 'Custom title');
  // Pages remember which saved note they are; junk ids are dropped
  const base = (await G('GET', '/api/admin/notes')).json.updated_at;
  r = await G('PUT', '/api/admin/notes', { pages: [{ text: 'Tanner follow-up', savedId: saved.id, savedAt: 5 }, { text: 'y', savedId: '<script>' }], base });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const pages = (await G('GET', '/api/admin/notes')).json.pages;
  assert(pages[0].savedId === saved.id && pages[0].savedAt === 5 && !('savedId' in pages[1]));
  await G('DELETE', `/api/admin/notes/saved/${saved.id}`);
  assert.strictEqual((await G('GET', `/api/admin/notes/saved/${saved.id}`)).status, 404, 'deleted');
  const realCount = db.countSavedNotes; db.countSavedNotes = async () => 200;
  r = await G('POST', '/api/admin/notes/saved', { text: 'one too many' });
  assert(r.status === 400 && /200 saved notes/.test(r.json.error));
  db.countSavedNotes = realCount;
  delete process.env.CREDENTIALS_KEY;
  assert.strictEqual((await G('GET', '/api/admin/notes/saved')).json.configured, false);
  assert.strictEqual((await G('POST', '/api/admin/notes/saved', { text: 'x' })).status, 400, 'no key: saved notes stay in the browser');
  process.env.CREDENTIALS_KEY = key;
  const realSaved = db.listSavedNotes; db.listSavedNotes = async () => { throw new Error('Could not find the table \'public.admin_saved_notes\' in the schema cache'); };
  r = await G('GET', '/api/admin/notes/saved');
  assert(r.status === 503 && /schema_accessories/.test(r.json.error), 'before the SQL is run: 503, the notepad keeps them in the browser');
  db.listSavedNotes = realSaved;
  console.log('11. saved notes: titled by their first line, encrypted (titles too), only yours, saving again updates, 200 max; browser-only without the key or table ✓');

  console.log('\nAll accessories API checks passed.');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
