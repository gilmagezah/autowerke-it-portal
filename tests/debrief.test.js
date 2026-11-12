// Debrief + Business card accessories, and the delivery board's current-phase outline. `npm test`.
// Adversarial: the debrief only ever goes to the signed-in admin, can't be sent twice inside 30
// minutes (not even with a double click), sends on Mondays only once and only to admins who asked;
// the business card (bank details) is admin-only and never cached.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3591;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026'; process.env.ADMIN_NAME = 'Gil';
process.env.APP_SECRET = 'd'.repeat(64); process.env.NODE_ENV = 'production'; process.env.REMINDER_TIMEZONE = 'Africa/Harare';
process.env.INVOICE_PAYMENT_DETAILS = 'Bank: CABS\\nAccount name: AutoWerke IT\\nAccount: 1002 3344 5566\\nEcoCash merchant 77881';
const assert = require('assert'); const crypto = require('crypto'); const fs = require('fs');

const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T); require('./fakedb.js').accessories(db, T);
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => (String(u).includes('api.resend.com') ? (emails.push(JSON.parse(o.body)), { ok: true, json: async () => ({}) }) : realFetch(u, o));
const Debrief = require(ROOT + '/lib/debrief');
const { paymentLines, CERTS } = require(ROOT + '/lib/businessCard');

const NOW = new Date('2026-11-09T08:30:00Z'); // Monday 10:30 in Harare
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const projects = [
  { id: crypto.randomUUID(), project_id: 'DUNDEE-7KQ-4X9', company_name: 'Dundee Beetles', project_title: 'M365 setup', request_type: 'IT Project', status: 'signed', updated_at: ago(9),
    phases: [{ title: 'Kickoff', done: true }, { title: 'Access', done: false }, { title: 'Design', done: true }, { title: 'Testing', done: false }, { title: 'Rollout', done: false }] },
  { id: crypto.randomUUID(), project_id: 'KINEMA-7MT-3RD', company_name: 'KinematicsOne', request_type: 'IT Support', status: 'in_progress', updated_at: ago(1), estimated_hours: 2,
    work_log: [{ date: '2026-11-07', start: '18:12', end: '18:44', note: 'INTERNAL' }, { date: '2026-11-09', start: '08:00', end: '09:20' }] },
  { id: crypto.randomUUID(), project_id: 'KOPJE-2AB-3CD', company_name: '<script>alert(1)</script> Kopje', project_title: 'Intune', request_type: 'IT Project', status: 'pricing_sent', updated_at: ago(12) },
  { id: crypto.randomUUID(), project_id: 'APU-5422', company_name: 'APU', request_type: 'Domains', status: 'domain_quoted', updated_at: ago(2) },
  { id: crypto.randomUUID(), project_id: 'OLD-1111', company_name: 'Old', request_type: 'IT Support', status: 'completed', updated_at: ago(40) },
];
const invoices = [
  { number: 'AW-INV-2026-0003', company: 'Dundee Beetles', total: 480, due_date: '2026-11-05', status: 'issued' },
  { number: 'AW-INV-2026-0004', company: 'APU', total: 120.5, due_date: '2026-11-20', status: 'issued' },
  { number: 'AW-INV-2026-0001', company: 'Paid Co', total: 999, due_date: '2026-10-01', status: 'paid' },
];
const reminders = [
  { title: 'Call Dundee', due_at: '2026-11-09T07:00:00Z', ref: 'DUNDEE-7KQ-4X9' },
  { title: 'Renew licences', due_at: '2026-11-13T07:00:00Z' },
  { title: 'Next month', due_at: '2026-12-20T07:00:00Z' },
  { title: 'Ticked off', due_at: '2026-11-10T07:00:00Z', done_at: ago(0) },
];
const registry = [{ domain: 'apu.ac.zw', client_company: 'APU', renewal_date: '2026-11-25' }, { domain: 'far.co.zw', client_company: 'Far', renewal_date: '2027-06-01' }];

const B = `http://localhost:${PORT}`;
async function signIn(email, password) {
  await realFetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const code = emails.at(-1).subject.match(/code: ([A-Z]{6})$/)[1];
  const r = await realFetch(B + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  return { Cookie: `aw_admin=${r.headers.get('set-cookie').match(/aw_admin=([^;]+)/)[1]}` };
}
const call = async (C, method, p, body) => {
  const r = await realFetch(B + p, { method, headers: { ...C, 'Content-Type': 'application/json' }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})), cache: r.headers.get('cache-control') };
};

(async () => {
  // ---- 1. What the debrief says ----
  const d = Debrief.buildDebrief({ projects, invoices, reminders, registry, now: NOW });
  assert.deepStrictEqual(d.ongoing.map((p) => p.ref), ['DUNDEE-7KQ-4X9', 'KINEMA-7MT-3RD'], 'with us: longest untouched first; finished work left out');
  assert.strictEqual(d.ongoing[0].detail, '2 of 5 phases done · now: Testing', 'phases done out of order: the one after the last done is "now"');
  assert.strictEqual(d.ongoing[1].detail, '1h 52m logged of 2h estimated · last worked 9 Nov');
  assert(!JSON.stringify(d).includes('INTERNAL'), 'work-log notes stay out');
  assert.deepStrictEqual(d.waiting.map((p) => [p.ref, p.days]), [['KOPJE-2AB-3CD', 12], ['APU-5422', 2]], 'on hold: waiting on the client, longest first');
  assert.deepStrictEqual(d.reminders.map((r) => [r.title, r.overdue]), [['Call Dundee', true], ['Renew licences', false]], 'reminders: overdue + next 7 days, ticked-off ones dropped');
  assert.strictEqual(d.reminders[0].when, '9 Nov 09:00', 'shown in Harare time');
  assert.deepStrictEqual(d.invoices.map((i) => [i.number, i.left]), [['AW-INV-2026-0003', -4], ['AW-INV-2026-0004', 11]], 'unpaid only, most overdue first');
  assert.deepStrictEqual(d.renewals.map((r) => r.domain), ['apu.ac.zw']);
  assert.deepStrictEqual(d.counts, { ongoing: 2, waiting: 2, reminders: 2, overdueReminders: 1, unpaid: 2, unpaidTotal: 600.5, overdueInvoices: 1, renewals: 1 });
  console.log('1. debrief: ongoing work with phase/hours detail, on hold longest first, reminders for the week, unpaid invoices, renewals ✓');

  // ---- 2. Monday mornings only ----
  assert.strictEqual(Debrief.autoDay(new Date('2026-11-09T04:59:00Z')), null, 'Monday 06:59 Harare: not yet');
  assert.strictEqual(Debrief.autoDay(new Date('2026-11-09T05:00:00Z')), '2026-11-09', 'Monday 07:00 Harare');
  assert.strictEqual(Debrief.autoDay(new Date('2026-11-08T23:30:00Z')), null, 'Sunday 23:30 UTC is Monday 01:30 Harare: too early');
  assert.strictEqual(Debrief.autoDay(new Date('2026-11-10T08:00:00Z')), null, 'Tuesday');
  console.log('2. auto-send window: Mondays from 07:00 Harare time, whatever the server clock says ✓');

  // ---- 3. Business card details ----
  assert.deepStrictEqual(paymentLines(), [
    { label: 'Bank', value: 'CABS' }, { label: 'Account name', value: 'AutoWerke IT' }, { label: 'Account', value: '1002 3344 5566' }, { label: '', value: 'EcoCash merchant 77881' },
  ]);
  assert.deepStrictEqual(paymentLines(''), []);
  assert.deepStrictEqual(paymentLines('BancABC Avondale · Account name: AutoWerke IT · Account: 12345'), [{ label: '', value: 'BancABC Avondale' }, { label: 'Account name', value: 'AutoWerke IT' }, { label: 'Account', value: '12345' }], 'one line split with " · " works too');
  const home = fs.readFileSync(`${ROOT}/public/index.html`, 'utf8');
  const homeCerts = [...home.matchAll(/class="cert-code" title="([^"]+)">([A-Z]{2}-\d{3})</g)].map((m) => ({ code: m[2], title: m[1] }));
  assert.deepStrictEqual(CERTS, homeCerts, 'the card lists the same certifications as the homepage');
  console.log('3. bank details read from INVOICE_PAYMENT_DETAILS line by line; certifications match the homepage ✓');

  // ---- 4. The API ----
  projects.forEach((p) => T.projects.push(p));
  invoices.forEach((i) => T.invoices.push(i));
  require(ROOT + '/server.js');
  await new Promise((r) => setTimeout(r, 500));
  const G = await signIn('gil@autowerkeit.com', 'Bootstrap-Pass-2026');
  await call(G, 'POST', '/api/admin/team', { name: 'Tino', email: 'tino@autowerkeit.com', password: 'Colleague-Pass-99' });
  const Tn = await signIn('tino@autowerkeit.com', 'Colleague-Pass-99');

  for (const [m, p] of [['GET', '/api/admin/debrief'], ['POST', '/api/admin/debrief/send'], ['PUT', '/api/admin/debrief/settings'], ['GET', '/api/admin/business-card']]) {
    assert.strictEqual((await call({}, m, p, {})).status, 401, `${m} ${p} needs a session`);
  }
  let r = await call(G, 'GET', '/api/admin/debrief');
  assert(r.status === 200 && r.json.to === 'gil@autowerkeit.com' && r.json.autoMonday === false && r.json.nextAt === null && r.json.preview.counts.ongoing === 2);
  assert(/no-store/.test(r.cache));

  const before = emails.length;
  r = await call(G, 'POST', '/api/admin/debrief/send');
  assert(r.status === 200 && r.json.sent && r.json.nextAt, JSON.stringify(r.json));
  const mail = emails.at(-1);
  assert.deepStrictEqual(mail.to, ['gil@autowerkeit.com'], 'only ever to the signed-in admin');
  assert(/^Debrief, \w{3} \d+ \w{3}: 2 with us, 2 on hold/.test(mail.subject), mail.subject);
  assert(mail.html.includes('DUNDEE-7KQ-4X9') && mail.html.includes('2 of 5 phases done') && mail.html.includes('AW-INV-2026-0003'));
  assert(!mail.html.includes('<script>alert(1)') && mail.html.includes('&lt;script&gt;'), 'client names are escaped');
  assert(!mail.html.includes('INTERNAL'));
  r = await call(G, 'POST', '/api/admin/debrief/send');
  assert(r.status === 429 && /in (29|30) minutes/.test(r.json.error) && r.json.nextAt, 'a second send inside 30 minutes is refused');
  assert.strictEqual(emails.length, before + 1);
  // A double click: both requests at once, before either has saved
  const results = await Promise.all([call(Tn, 'POST', '/api/admin/debrief/send'), call(Tn, 'POST', '/api/admin/debrief/send')]);
  assert.deepStrictEqual(results.map((x) => x.status).sort(), [200, 429], 'a double click sends one email');
  assert.deepStrictEqual(emails.at(-1).to, ['tino@autowerkeit.com'], "Tino's own cool-down, sent to Tino");
  // The cool-down passes
  T.app_settings[`debrief:${T.admin_users.find((a) => a.email === 'gil@autowerkeit.com').id}`].lastSentAt = new Date(Date.now() - 31 * 60000).toISOString();
  assert.strictEqual((await call(G, 'POST', '/api/admin/debrief/send')).status, 200, 'after 30 minutes it sends again');
  console.log('4. send now: to you only, escaped, 30-minute cool-down per admin (a double click sends once); admin-only, never cached ✓');

  // ---- 5. Every Monday ----
  assert.strictEqual((await call(G, 'PUT', '/api/admin/debrief/settings', { autoMonday: 'yes' })).status, 400);
  r = await call(G, 'PUT', '/api/admin/debrief/settings', { autoMonday: true });
  assert(r.status === 200 && r.json.autoMonday === true && r.json.lastSentAt, 'turning it on keeps the last-sent time');
  assert.strictEqual((await call(Tn, 'GET', '/api/admin/debrief')).json.autoMonday, false, "Gil's switch is Gil's alone");
  const sent = [];
  const send = async (x) => { sent.push(x); };
  Debrief.resetAuto();
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-09T04:30:00Z'), send })).sent, 0, 'not before 07:00');
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-09T05:01:00Z'), send })).sent, 1);
  assert(sent[0].admin.email === 'gil@autowerkeit.com' && sent[0].auto === true && sent[0].debrief.counts);
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-09T05:02:00Z'), send })).sent, 0, 'once per Monday');
  Debrief.resetAuto(); // a restart mid-Monday must not send it again either
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-09T09:00:00Z'), send })).sent, 0, 'remembered across a restart');
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-16T05:30:00Z'), send })).sent, 1, 'and again next Monday');
  let failOnce = true;
  Debrief.resetAuto();
  const flaky = async () => { if (failOnce) { failOnce = false; throw new Error('Resend down'); } };
  const origError = console.error; console.error = () => {};
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-23T05:30:00Z'), send: flaky })).sent, 0);
  console.error = origError;
  assert.strictEqual((await Debrief.runAuto({ now: new Date('2026-11-23T05:31:00Z'), send: flaky })).sent, 1, 'a failed send is retried on the next check');
  const server = fs.readFileSync(`${ROOT}/lib/reminderRoutes.js`, 'utf8');
  assert(/runReminders[\s\S]*require\('\.\/debrief'\)\.runAuto/.test(server), 'the minute-by-minute check (and the cron ping) runs it');
  console.log('5. every Monday from 07:00: only admins who switched it on, once per Monday (even after a restart), retried if the email fails ✓');

  // ---- 6. Business card API ----
  r = await call(G, 'GET', '/api/admin/business-card');
  assert(r.status === 200 && /no-store/.test(r.cache));
  assert(r.json.email && r.json.phone && r.json.website === 'autowerkeit.com' && r.json.payment.length === 4 && r.json.certs.length === CERTS.length && r.json.vatRate === 15.5);
  console.log('6. business card: admin-only, bank details never cached ✓');

  // ---- 7. The pages ----
  const pub = (f) => fs.readFileSync(`${ROOT}/public/${f}`, 'utf8');
  assert(/\.theme \.phase-row\.current \{ border-color: var\(--green\); box-shadow: none; \}/.test(pub('theme.css')), 'current phase: the green outline only, no side bar');
  assert(/'\/debrief\.js', '\/bizcard\.js'\]/.test(pub('accessories.js')), 'both load with the other accessories');
  for (const f of ['debrief.js', 'bizcard.js']) {
    const js = pub(f);
    assert(!/\son[a-z]+\s*=\s*["'`$]/i.test(js) && !/style\s*=\s*["']/.test(js), `${f}: no inline handlers or styles (CSP)`);
  }
  const card = pub('bizcard.js');
  // Copyable lines go through line(), which escapes its label and value; everything else through esc()
  assert(/const line = \(label, value, copy = value\) => `[^`]*data-copy="\$\{esc\(copy\)\}"[^`]*\$\{esc\(label\)\}[^`]*\$\{esc\(value\)\}/.test(card), 'line() escapes what it shows and copies');
  for (const call of ["line('Email', info.email)", "line('Phone', info.phone)", "line('Web', info.website)", ", p.value)"]) assert(card.includes(call), `bizcard shows ${call} through line()`);
  for (const field of ['info.name', 'c.code', 'c.title', 'info.location', 'info.tagline', 'f', 'e.message']) assert(card.includes(`esc(${field})`), `bizcard escapes ${field}`);
  assert(/front\.inert = toBack; back\.inert = !toBack/.test(card), 'only the visible face takes focus');
  assert(/prefers-reduced-motion: reduce\) \{\s*\.bc-card/.test(pub('accessories.css')), 'the card turns without animation for reduced motion');
  const brief = pub('debrief.js');
  for (const field of ['x.ref', 'x.title', 'x.when', 'e.message']) assert(brief.includes(`esc(${field})`), `debrief escapes ${field}`);
  console.log('7. delivery board: current phase keeps the outline, no side bar; both accessories CSP-safe and escaped ✓');

  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
