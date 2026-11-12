// Tracking page redesign + harder-to-guess references. `npm test`.
// Adversarial: the public lookup must never leak the private link, file links, project prices
// or work notes; "email me my private link" must only ever mail the address on file, answer
// the same either way, and not be usable to flood an inbox.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3583;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.APP_SECRET = 't'.repeat(64); process.env.NODE_ENV = 'production';
const assert = require('assert'); const crypto = require('crypto'); const fs = require('fs');

const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T);
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => (String(u).includes('api.resend.com') ? (emails.push(JSON.parse(o.body)), { ok: true, json: async () => ({}) }) : realFetch(u, o));
const sec = require(ROOT + '/lib/security');

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const tokens = { project: crypto.randomUUID(), support: crypto.randomUUID(), fresh: crypto.randomUUID(), old: crypto.randomUUID() };
T.projects.push(
  { id: crypto.randomUUID(), project_id: 'KOPJE-8KQ-4X9', confirm_token: tokens.project, company_name: 'Kopje Engineering', name: 'Tendai', surname: 'Moyo', email: 'tendai@kopje.co.zw',
    request_type: 'IT Project', status: 'signed', project_title: 'Intune rollout', created_at: ago(30), signed_at: ago(20), signoff_sent_at: ago(1), updated_at: ago(1),
    pricing_estimate: 'US$4,800 SECRET-PRICE', signed_contract_url: 'https://abc.supabase.co/storage/v1/object/public/contracts/KOPJE-8KQ-4X9/contract.pdf',
    phases: [
      { title: 'Baseline', done: true, completed_date: '2026-11-02T14:00:00Z', planned_start: '2026-10-28', planned_end: '2026-11-01', instructions: 'INTERNAL-STEPS use the break-glass account', notes: 'INTERNAL-PHASE-NOTE' },
      { title: 'Roll out', done: false, planned_end: '2026-11-20', completed_date: '2026-11-03' },
    ] },
  { id: crypto.randomUUID(), project_id: 'KINEMA-7MT-3RD', confirm_token: tokens.support, company_name: 'KinematicsOne', name: 'Rudo', email: 'rudo@kinema.co.zw',
    request_type: 'IT Support', status: 'in_progress', created_at: ago(6), estimate_signed_at: ago(3), updated_at: ago(1), estimated_hours: 2, hourly_rate: 65,
    work_log: [{ id: 'a', date: ago(2).slice(0, 10), start: '09:30', end: '10:15', note: 'INTERNAL-NOTE reset the admin password' }, { id: 'b', date: ago(2).slice(0, 10), start: '25:00', end: 'x' }] },
  { id: crypto.randomUUID(), project_id: 'NEWCO-2AB-3CD', confirm_token: tokens.fresh, company_name: 'NewCo', name: 'Farai', email: 'farai@newco.co.zw', request_type: 'IT Project', status: 'pending_review', created_at: ago(0) },
  { id: crypto.randomUUID(), project_id: 'OLDCO-5422', confirm_token: tokens.old, company_name: 'OldCo', name: 'Tino', email: 'tino@oldco.co.zw', request_type: 'IT Support', status: 'completed', completed_at: ago(45), updated_at: ago(45) },
);

const B = `http://localhost:${PORT}`;
const track = (ref, email, ip = '198.51.100.1') => realFetch(`${B}/api/track?projectId=${encodeURIComponent(ref)}&email=${encodeURIComponent(email)}`, { headers: { 'X-Forwarded-For': ip } })
  .then(async (r) => { const text = await r.text(); return { status: r.status, json: JSON.parse(text), text }; });
const askLink = async (projectId, email, ip = '198.51.100.2') => {
  const t0 = Date.now();
  const r = await realFetch(`${B}/api/track/link`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B, 'X-Forwarded-For': ip }, body: JSON.stringify({ projectId, email }) });
  return { status: r.status, body: await r.text(), ms: Date.now() - t0 };
};

(async () => {
  // ---- 1. References: harder to guess, still easy to type ----
  const refs = new Set();
  for (let i = 0; i < 2000; i++) refs.add(db.generateProjectId('Tanner Republic (Pvt) Ltd'));
  assert.strictEqual(refs.size, 2000, 'no repeats in 2,000');
  for (const r of refs) assert(/^TANNER-[A-HJ-KMNP-Z2-9]{3}-[A-HJ-KMNP-Z2-9]{3}$/.test(r), r);
  assert(![...refs].join('').replace(/TANNER/g, '').match(/[01OIL]/), 'no look-alike characters (0/O, 1/I/L)');
  assert(/^CLIENT-/.test(db.generateProjectId('!!!')) && /^ACME-/.test(db.generateProjectId('acme')));
  assert.strictEqual(db.cleanRef('  tanner 7kq 4x9 '), 'TANNER-7KQ-4X9', 'lower case and spaces are forgiven');
  assert.strictEqual(db.cleanRef('tanner-5422'), 'TANNER-5422', 'older references still work');
  assert.strictEqual(db.cleanRef('%'), null); assert.strictEqual(db.cleanRef('A_%'), null);
  console.log(`1. new references look like TANNER-7KQ-4X9: 31^6 = 887 million per company (was 9,000), no look-alikes; "tanner 7kq 4x9" and old TANNER-5422 both work ✓`);

  require(ROOT + '/server.js');
  await new Promise((r) => setTimeout(r, 500));

  // ---- 2. The public view ----
  let r = await track('kopje 8kq 4x9', 'tendai@kopje.co.zw');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const p = r.json;
  for (const secret of [tokens.project, 'SECRET-PRICE', 'supabase', '/files/', 'contract.pdf', 'confirm_token', 'pricing_estimate']) {
    assert(!r.text.includes(secret), `the public view leaks ${secret}`);
  }
  assert.deepStrictEqual(p.documents.map((d) => [d.name, d.state]), [['Price', 'done'], ['Contract', 'done'], ['Project sign-off', 'you']]);
  assert.deepStrictEqual(p.phases, [
    { title: 'Baseline', done: true, completedDate: '2026-11-02', plannedStart: '2026-10-28', plannedEnd: '2026-11-01' },
    { title: 'Roll out', done: false, completedDate: null, plannedStart: null, plannedEnd: '2026-11-20' },
  ], 'phases carry dates (a phase not done has no done date), never their instructions or notes');
  assert(!r.text.includes('INTERNAL-STEPS') && !r.text.includes('INTERNAL-PHASE-NOTE'));
  assert.deepStrictEqual(p.activity.map((a) => a.label), ['Sign-off sent to you', 'Contract signed', 'Request submitted']);
  assert(p.privateLink === true && p.projectTitle === 'Intune rollout' && p.contactName === 'Tendai Moyo');

  r = await track('KINEMA-7MT-3RD', 'rudo@kinema.co.zw');
  assert(!r.text.includes('INTERNAL-NOTE') && !r.text.includes(tokens.support), 'work notes and the token stay private');
  assert.strictEqual(r.json.loggedMinutes, 45, 'the broken log entry (25:00 to "x") is skipped');
  assert.deepStrictEqual(r.json.workDays[0].blocks, [{ start: '09:30', end: '10:15', minutes: 45 }]);
  const logged = r.json.activity.find((a) => a.day);
  assert.deepStrictEqual([logged.label, logged.at], ['45m logged', `${ago(2).slice(0, 10)}T08:15:00.000Z`], 'a day of work is dated when it ended (10:15 Harare), and reads "45m"');
  const { duration } = require(ROOT + '/lib/track');
  assert.deepStrictEqual([duration(45), duration(60), duration(80), duration(150), duration(0)], ['45m', '1h', '1h 20m', '2h 30m', '0m']);
  assert(r.json.estimate && r.json.estimate.subtotal === 130, 'support tickets keep their estimate');
  assert.deepStrictEqual(r.json.documents.map((d) => d.state), ['done', 'later']);
  assert.strictEqual((await track('KINEMA-7MT-3RD', 'someone@else.com')).status, 404);
  assert.strictEqual((await track('NEWCO-2AB-3CD', 'farai@newco.co.zw')).json.privateLink, false, 'no private page before review');
  assert.strictEqual((await track('OLDCO-5422', 'tino@oldco.co.zw')).json.privateLink, false, 'nor 30 days after the work is finished');
  console.log('2. the lookup shows paperwork, milestones, activity and hours, never the private link, file links, project prices or work notes ✓');

  // ---- 3. "Email me my private link" ----
  emails.length = 0;
  const good = await askLink('kopje 8kq 4x9', 'tendai@kopje.co.zw');
  const wrongEmail = await askLink('KOPJE-8KQ-4X9', 'attacker@evil.com');
  const unknown = await askLink('NOPE-AAA-BBB', 'tendai@kopje.co.zw');
  const tooEarly = await askLink('NEWCO-2AB-3CD', 'farai@newco.co.zw');
  const expired = await askLink('OLDCO-5422', 'tino@oldco.co.zw');
  assert(good.status === 200 && [wrongEmail, unknown, tooEarly, expired].every((x) => x.status === 200 && x.body === good.body), 'the same answer every time');
  assert(!good.body.includes(tokens.project), 'the answer never carries the link');
  assert([good, wrongEmail, unknown].every((x) => x.ms >= 550), `and takes about as long: ${[good, wrongEmail, unknown].map((x) => x.ms)}`);
  assert.strictEqual(emails.length, 1, `only the real match is emailed (sent ${emails.length})`);
  assert.deepStrictEqual(emails[0].to, ['tendai@kopje.co.zw']);
  assert(emails[0].html.includes(`/confirm/${tokens.project}`) && /Your private page for KOPJE-8KQ-4X9/.test(emails[0].subject));
  sec.resetRateLimits();
  for (let i = 0; i < 5; i++) await askLink('KOPJE-8KQ-4X9', 'tendai@kopje.co.zw', `203.0.113.${i}`);
  assert.strictEqual(emails.length, 4, `at most 3 emails an hour per request, from any number of addresses (sent ${emails.length - 1} more)`);
  sec.resetRateLimits();
  for (let i = 0; i < 6; i++) await askLink('NOPE-AAA-BBB', 'x@y.com', '192.0.2.50');
  assert.strictEqual((await askLink('NOPE-AAA-BBB', 'x@y.com', '192.0.2.50')).status, 429, 'the 7th ask from one address in an hour');
  const cross = await realFetch(`${B}/api/track/link`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.strictEqual(cross.status, 403, 'another site cannot trigger it');
  console.log('3. "Email me my private link": only the address on file gets it, max 3 an hour; same answer and timing for wrong, unknown, unreviewed or expired requests; 403 cross-site ✓');

  // ---- 4. The page: CSP-safe, dark mode, the court kept ----
  const pub = (f) => fs.readFileSync(`${ROOT}/public/${f}`, 'utf8');
  const html = pub('track.html'); const js = pub('track.js'); const css = pub('track.css');
  assert(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html) && !/\son[a-z]+\s*=\s*["']/i.test(html) && !/\sstyle\s*=\s*["']/i.test(html), 'no inline scripts, handlers or styles');
  assert(html.indexOf('/theme-mode.js') < html.indexOf('</head>') && html.includes('id="themeToggle"') && html.includes('/home-dark.css'), 'dark mode: switch + saved choice before paint');
  assert(/:root\[data-theme="dark"\] \.theme\.client\.track/.test(css) && (css.match(/\[data-theme="dark"\]/g) || []).length >= 15, 'tracking-page dark rules');
  assert(/court-ball/.test(js) && /court-shadow/.test(js) && /function serve\(\)/.test(js), 'the tennis court: ball served to whoever moves next');
  assert(/@keyframes court-bounce/.test(pub('client.css')) && /prefers-reduced-motion: reduce\) \{ \.tr-court \.court-shadow \{ animation: none/.test(css), 'bounce kept, and it stops for reduced motion');
  assert(!/style="/.test(js.replace(/\.style\./g, '')), 'time bars positioned with element.style, never style="" (CSP)');
  for (const field of ['projectId', 'title', 'companyName', 'name', 'note', 'label']) assert(new RegExp(`esc\\([^)]*${field}`).test(js), `escapes ${field}`);
  assert(/<dt>\$\{esc\(k\)\}<\/dt><dd>\$\{esc\(v\)\}<\/dd>/.test(js), 'the details list (company, contact, dates) is escaped');
  const docsFn = js.slice(js.indexOf('function documentsHtml'), js.indexOf('function', js.indexOf('function documentsHtml') + 10));
  assert(docsFn.includes('tr-doc') && !/<a\s|href|download|\.url/i.test(docsFn), 'documents are listed for show: no links, no downloads');
  assert(/function dayWindow/.test(js) && /data-from="\$\{win\.from\}"/.test(js) && /chart\.dataset\.from/.test(js), 'the time chart stretches to the hours actually logged');
  assert(/i > lastDone/.test(js) && /Still to finish/.test(js) && /tr-phases li\.open/.test(css), 'phases finished out of order: the one after the last done is in progress, earlier open ones say "still to finish"');
  assert(!/id="(trackForm|result)"/.test(html), "new ids, so the old page's leftover styles can't reach it");
  assert(/Signed online, securely and in minutes/.test(pub('index.html')) && !/Signed online with a one-time code/.test(pub('index.html')), 'homepage sign-off line reworded');
  console.log('4. page is CSP-safe, has a dark mode, keeps the bouncing court (still for reduced motion), escapes everything; homepage line reworded ✓');

  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
