// Optional company website on the intake form. `npm test`.
// Adversarial: script and data addresses, sign-in details in the address, IP addresses and
// localhost, odd ports, HTML in the path. Then real submissions for each request type, what is
// stored and emailed, and a database that hasn't had schema_website.sql run yet.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3581;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ANTHROPIC_API_KEY = 'x'; process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.APP_SECRET = 'a'.repeat(64);
const assert = require('assert'); const crypto = require('crypto'); const { spawnSync } = require('child_process');

const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T);
let n = 0;
const created = [];
const save = (f) => { const p = { id: crypto.randomUUID(), project_id: `ACME-${2000 + (++n)}`, ...f }; T.projects.push(p); created.push(f); return p; };
db.createProject = async (f) => save(f);
db.createRequest = async (f) => save(f);
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => {
  if (String(u).includes('api.resend.com')) { emails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; }
  if (String(u).includes('api.anthropic.com')) return { ok: true, json: async () => ({ content: [{ text: '{}' }] }) };
  return realFetch(u, o);
};
const { cleanWebsite, displayWebsite } = require(ROOT + '/lib/website');
const sec = require(ROOT + '/lib/security');

(async () => {
  // ---- 1. What counts as a website ----
  const ok = {
    'Acme.co.zw': 'https://acme.co.zw',
    'www.acme.co.zw': 'https://www.acme.co.zw',
    'HTTPS://ACME.CO.ZW/': 'https://acme.co.zw',
    'http://acme.com/about?utm_source=x#team': 'http://acme.com/about',
    'https://acme.co.zw/"><script>alert(1)</script>': 'https://acme.co.zw/%22%3E%3Cscript%3Ealert(1)%3C/script%3E',
  };
  for (const [input, want] of Object.entries(ok)) assert.strictEqual(cleanWebsite(input).value, want, input);
  assert.strictEqual(cleanWebsite('').value, null); assert.strictEqual(cleanWebsite('   ').value, null); assert.strictEqual(cleanWebsite(undefined).value, null);
  const refused = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'ftp://acme.com', 'file:///etc/passwd',
    'https://user:pass@acme.com', 'https://acme.com@evil.com', 'http://127.0.0.1', 'http://[::1]/', 'localhost:3000', 'http://intranet',
    'https://acme.com:8080', 'acme com', 'https://' + 'a'.repeat(200) + '.com', '<script>', 'mailto:hi@acme.com'];
  for (const r of refused) assert(cleanWebsite(r).error, `refused: ${r}`);
  assert.strictEqual(displayWebsite('https://www.acme.co.zw/about'), 'acme.co.zw/about');
  console.log(`1. websites cleaned to plain https/http addresses (query and #fragment dropped, HTML in the path encoded); refused ${refused.length} tricks incl. javascript:, data:, sign-in details, IP addresses, localhost, odd ports ✓`);

  // ---- 2. Real submissions ----
  require(ROOT + '/server.js');
  await new Promise((r) => setTimeout(r, 500));
  const B = `http://localhost:${PORT}`;
  const submit = (body) => {
    const fd = new FormData();
    fd.append('payload', JSON.stringify({ agreeTerms: true, name: 'Rudo', companyName: 'Acme', email: 'rudo@acme.co.zw', ...body }));
    return realFetch(`${B}/api/submit`, { method: 'POST', body: fd, headers: { Origin: B } });
  };
  let r = await submit({ requestType: 'IT Support', details: 'Outlook will not sync', companyWebsite: 'Acme.co.zw' });
  let body = await r.json();
  assert(r.status === 200, JSON.stringify(body));
  assert.strictEqual(created.at(-1).companyWebsite, 'https://acme.co.zw');
  const review = emails.find((e) => e.to[0] === process.env.ADMIN_EMAIL && e.html.includes(body.projectId));
  assert(review && review.html.includes('<strong>Website:</strong> <a href="https://acme.co.zw"'), 'review email shows the website');
  const client = emails.find((e) => e.to[0] === 'rudo@acme.co.zw');
  assert(client && !client.html.includes('Website:'), 'the client is not emailed their own website back');

  // without a website: nothing stored, no line in the email
  r = await submit({ requestType: 'IT Project', details: 'Move 12 mailboxes to Microsoft 365' });
  body = await r.json();
  assert(r.status === 200 && created.at(-1).companyWebsite == null);
  assert(!emails.find((e) => e.html.includes(body.projectId) && e.to[0] === process.env.ADMIN_EMAIL).html.includes('Website:'));
  console.log('2. IT Support with "Acme.co.zw" stores https://acme.co.zw and the review email links it; left blank, nothing is stored or shown ✓');

  // ---- 3. A bad website stops the request before anything is created or sent ----
  sec.resetRateLimits();
  for (const type of ['IT Support', 'Domains', 'Consultancy']) {
    const before = created.length, sent = emails.length;
    r = await submit({ requestType: type, details: 'We need help with our email setup please', domains: ['acme.co.zw'], companyWebsite: 'javascript:alert(document.cookie)' });
    const bad = await r.json();
    assert(r.status === 400 && /website address doesn't look right/.test(bad.error), `${type}: ${JSON.stringify(bad)}`);
    assert(created.length === before && emails.length === sent, `${type}: nothing created or sent`);
  }
  console.log('3. "javascript:" as the website -> 400 with a plain message, for IT, Domains and Consultancy; nothing created or emailed ✓');

  // ---- 4. Domains and Consultancy keep it too, and their admin alerts show it ----
  sec.resetRateLimits();
  r = await submit({ requestType: 'Domains', domains: ['acme.co.zw'], companyWebsite: 'https://www.acme.com' });
  body = await r.json();
  assert(r.status === 200 && created.at(-1).company_website === 'https://www.acme.com', JSON.stringify(created.at(-1)));
  assert(emails.some((e) => e.subject.startsWith('URGENT: domain request') && /<a href="https:\/\/www\.acme\.com"[^>]*>acme\.com<\/a>/.test(e.html)), 'domain alert shows it');
  r = await submit({ requestType: 'Consultancy', details: 'Should we move our files from a server to SharePoint?', companyWebsite: 'acme.co.zw' });
  assert(r.status === 200 && created.at(-1).company_website === 'https://acme.co.zw');
  console.log('4. Domains and Consultancy requests store the website; the domain alert links it ✓');

  // ---- 5. Before schema_website.sql is run, a request with a website still saves ----
  const script = `
    const path = require.resolve('@supabase/supabase-js', { paths: [${JSON.stringify(ROOT)}] });
    const inserts = [];
    require.cache[path] = { id: path, filename: path, loaded: true, exports: { createClient: () => ({
      from: () => ({ insert: (row) => { inserts.push(row); return { select: () => ({ single: async () => (
        'company_website' in row
          ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'company_website' column of 'projects' in the schema cache" } }
          : { data: { id: 1, ...row }, error: null }) }) }; } }),
    }) } };
    process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_KEY = 'x';
    console.warn = () => {};
    require(${JSON.stringify(ROOT + '/lib/db')}).createRequest({ company_name: 'Acme', company_website: 'https://acme.co.zw', request_type: 'Domains' })
      .then((p) => console.log(JSON.stringify({ saved: !!p.project_id, tries: inserts.length, last: 'company_website' in inserts.at(-1) })))
      .catch((e) => console.log(JSON.stringify({ error: e.message })));`;
  const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const res = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(res, { saved: true, tries: 2, last: false }, out.stdout + out.stderr);
  console.log('5. no company_website column yet: the request is saved on a second try without the website, never lost ✓');

  // ---- 6. Wiring: the form, the admin pipeline and the schema check ----
  const fs = require('fs');
  const pub = (f) => fs.readFileSync(`${ROOT}/public/${f}`, 'utf8');
  for (const page of ['index.html', 'classic.html']) {
    const html = pub(page);
    assert(/<button type="button" class="link-btn site-add" id="addWebsite" aria-controls="websiteField" aria-expanded="false">\+ Website<\/button>/.test(html), `${page}: the "+ Website" link`);
    assert(/<label class="site-field hidden" id="websiteField">[^]*?<input type="url" id="companyWebsite"[^>]*maxlength="200"/.test(html), `${page}: the hidden website field`);
  }
  const admin = pub('admin.js');
  assert(/rel="noopener noreferrer nofollow"/.test(admin) && /\^https\?:\\\/\\\/\[\^\\s"'<>\]\+\$/.test(admin), 'admin link: http(s) only, escaped, new tab without opener');
  assert(/schema_website\.sql/.test(fs.readFileSync(`${ROOT}/lib/schemaCheck.js`, 'utf8')) && fs.existsSync(`${ROOT}/schema_website.sql`), 'schema file and startup check');
  console.log('6. "+ Website" on both pages; admin shows it as a safe link; the startup check names schema_website.sql ✓');

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
