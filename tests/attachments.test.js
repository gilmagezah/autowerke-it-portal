// Intake attachments: screenshots and plain text files (error messages, logs, code). `npm test`.
// Text has no magic number, so the content decides: these checks try renamed executables,
// archives, PDFs, NUL bytes, odd encodings and oversized files, then submit real multipart
// requests through the server and read what was stored, emailed and sent to the AI.
const ROOT = require('path').join(__dirname, '..');
const PORT = 3577;
process.env.PORT = String(PORT); process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = 'http://127.0.0.1:59999'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ANTHROPIC_API_KEY = 'x'; process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.APP_SECRET = 'a'.repeat(64);
const assert = require('assert'); const crypto = require('crypto'); const fs = require('fs');

const stored = [];
require(ROOT + '/lib/storage').uploadSignedContract = async (ref, buf, name, type, label) => { stored.push({ ref, buf, name, type, label }); return `https://store/${ref}/${label}`; };
const db = require(ROOT + '/lib/db');
const T = require('./fakedb.js')(db); require('./fakedb.js').extend(db, T);
let n = 0;
db.createProject = async (f) => { const p = { id: crypto.randomUUID(), project_id: `ACME-${1000 + (++n)}`, ...f }; T.projects.push(p); return p; };
const realFetch = global.fetch; const emails = []; const aiPrompts = []; let failClientEmail = false;
global.fetch = async (u, o) => {
  if (String(u).includes('api.resend.com')) {
    const m = JSON.parse(o.body);
    if (failClientEmail && m.to[0] !== process.env.ADMIN_EMAIL) return { ok: false, status: 500, text: async () => 'Resend is down' };
    emails.push(m); return { ok: true, json: async () => ({}) };
  }
  if (String(u).includes('api.anthropic.com')) { aiPrompts.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ content: [{ text: '{}' }] }) }; }
  return realFetch(u, o);
};
const att = require(ROOT + '/lib/attachments');
const sec = require(ROOT + '/lib/security');

const utf16le = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const file = (name, buffer) => ({ originalname: name, buffer, size: buffer.length });
const throwsMsg = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };

(async () => {
  // ---- 1. What counts as plain text ----
  const err = 'Error 0x80070005: Access is denied.\r\n\tat Outlook.Sync (line 42)\n';
  assert.strictEqual(att.readPlainText(Buffer.from(err)), err);
  assert.strictEqual(att.readPlainText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('café ✓')])), 'café ✓');
  assert.strictEqual(att.readPlainText(utf16le('PS C:\\> ipconfig /all\r\nWindows IP Configuration')), 'PS C:\\> ipconfig /all\r\nWindows IP Configuration');
  assert(att.readPlainText(Buffer.from('\u001b[31mFAILED\u001b[0m npm test')), 'terminal colours are fine');
  const pdf = await require(ROOT + '/lib/estimate').generateEstimatePdf({ project_id: 'X-1', company_name: 'X', estimated_hours: 1, hourly_rate: 1 });
  const refused = {
    'NUL bytes': Buffer.from('abc\u0000def'),
    'Windows executable': Buffer.concat([Buffer.from('MZ'), Buffer.from([0x90, 0x00, 0x03, 0x00]), Buffer.from('This program cannot be run in DOS mode')]),
    'zip archive': Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), crypto.randomBytes(200)]),
    'a real PDF': pdf,
    'random bytes': crypto.randomBytes(2000),
    'not UTF-8': Buffer.from([0x63, 0x61, 0x66, 0xe9]),
    'empty': Buffer.alloc(0),
    'only spaces': Buffer.from('   \n  '),
  };
  for (const [what, buf] of Object.entries(refused)) assert.strictEqual(att.readPlainText(buf), null, what);
  console.log(`1. plain text accepted (UTF-8, UTF-8 BOM, PowerShell's UTF-16, terminal colours); refused: ${Object.keys(refused).join(', ')} ✓`);

  // ---- 2. Validation: names, types, sizes, counts ----
  let v = att.validateScreenshots([file('Outlook error.log', utf16le(err)), file('shot.png', fs.readFileSync(`${__dirname}/fixtures/sig.png`))]);
  assert(v[0].name === 'Outlook error.txt' && v[0].type === 'text/plain; charset=utf-8' && v[0].buffer.toString('utf8') === err && v[0].text === err);
  assert(v[1].name === 'shot.png' && v[1].type === 'image/png' && !v[1].text);
  assert(/isn't an image .* or a plain text file/.test(throwsMsg(() => att.validateScreenshots([file('error.txt', refused['Windows executable'])]))));
  assert(/isn't an image/.test(throwsMsg(() => att.validateScreenshots([file('setup.exe', refused['Windows executable'])]))));
  assert(/over 1 MB/.test(throwsMsg(() => att.validateScreenshots([file('big.log', Buffer.alloc(1024 * 1024 + 1, 'a'))]))));
  assert(/up to 4 files/.test(throwsMsg(() => att.validateScreenshots(Array.from({ length: 5 }, () => file('a.txt', Buffer.from('a')))))));
  v = att.validateScreenshots([file('<script>alert(1)</script>.html', Buffer.from('<b>hi</b>'))]);
  assert(v[0].name === 'scriptalert1script.txt' && v[0].type.startsWith('text/plain'), v[0].name);
  console.log('2. a renamed .exe is refused as .txt; text over 1 MB and a 5th file refused; any text is stored as .txt, text/plain (an "HTML" upload is just text) ✓');

  // ---- 3. AI gets the text, capped ----
  const capped = att.toClaudeText([{ type: 'text/plain', name: 'a.txt', text: 'x'.repeat(50000) }, { type: 'text/plain', name: 'b.txt', text: 'y'.repeat(100) }]);
  assert(capped[0].text.length < 20100 && capped[0].text.includes('[... cut') && capped[1].text.length < 60);
  assert.strictEqual(att.toClaudeImages([{ type: 'text/plain', buffer: Buffer.from('x') }]).length, 0);
  console.log('3. the AI draft gets text files as text (20,000 characters at most across all of them), never as images ✓');

  // ---- 4. End to end: a multipart submission with a screenshot and a PowerShell log ----
  require(ROOT + '/server.js');
  await new Promise((r) => setTimeout(r, 500));
  const B = `http://localhost:${PORT}`;
  const base = { agreeTerms: true, requestType: 'IT Support', name: 'Rudo', companyName: 'Acme', email: 'rudo@acme.co.zw', details: 'Outlook will not sync' };
  const submit = (files) => {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(base));
    files.forEach(([name, buf, type]) => fd.append('screenshots', new Blob([buf], { type }), name));
    return realFetch(`${B}/api/submit`, { method: 'POST', body: fd, headers: { Origin: B } });
  };
  let r = await submit([['shot.png', fs.readFileSync(`${__dirname}/fixtures/sig.png`), 'image/png'], ['sync-error.log', utf16le(err), 'text/plain']]);
  const body = await r.json();
  assert(r.status === 200 && body.attachments === 2, JSON.stringify(body));
  const txt = stored.find((s) => s.label === 'textfile-2');
  assert(txt && txt.name === 'sync-error.txt' && txt.type === 'text/plain; charset=utf-8' && txt.buf.toString('utf8') === err, JSON.stringify(stored.map((s) => s.label)));
  const p = T.projects.find((x) => x.project_id === body.projectId);
  assert(p.attachments.length === 2 && p.attachments[1].type.startsWith('text/plain') && p.attachments[0].type === 'image/png');
  const prompt = aiPrompts.at(-1).messages[0].content;
  assert(Array.isArray(prompt) && prompt.filter((c) => c.type === 'image').length === 1, 'one image block');
  assert(prompt.at(-1).text.includes('Error 0x80070005: Access is denied.') && prompt.at(-1).text.includes('"sync-error.txt"'));
  const review = emails.find((e) => e.subject && e.html.includes('Attachments (2)'));
  assert(review && review.html.includes('sync-error.txt</a> (text)'), 'review email lists the text file');
  console.log('4. submit with a screenshot + a UTF-16 .log: stored as UTF-8 "sync-error.txt" (text/plain), the AI reads the error text, the review email lists both ✓');

  // ---- 5. A renamed executable is refused before anything is created ----
  sec.resetRateLimits();
  const before = T.projects.length;
  r = await submit([['error.txt', refused['Windows executable'], 'text/plain']]);
  const bad = await r.json();
  assert(r.status === 400 && /plain text file/.test(bad.error) && T.projects.length === before, JSON.stringify(bad));
  r = await submit([['huge.log', Buffer.alloc(1024 * 1024 + 10, 'a'), 'text/plain']]);
  assert(r.status === 400 && /1 MB/.test((await r.json()).error));
  console.log(`5. "error.txt" that is really an .exe -> 400 "${bad.error}"; nothing created ✓`);

  // ---- 6. The client's "request received" email ----
  const got = emails.find((e) => e.subject === `Support request received — ${body.projectId}`);
  assert(got && got.to[0] === 'rudo@acme.co.zw', 'support request-received email sent to the client');
  assert(got.html.includes(body.projectId) && got.html.includes('Outlook will not sync') && got.html.includes('sync-error.txt') && got.html.includes('work estimate') && got.html.includes('/track'));
  // The thank-you leads (big heading before anything else they read) and is the inbox preview line too
  const firstText = got.html.replace(/<style>[^]*?<\/style>/, '').replace(/<div style="display:none[^]*?<\/div>/, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&zwnj;/g, ' ').replace(/\s+/g, ' ').trim();
  assert(/^(?:AutoWerke \| IT )?Support request received · ACME-\d+ Thank you for choosing us\. Hi Rudo, we've received your support request and we appreciate the opportunity to help\./.test(firstText), firstText.slice(0, 160));
  assert(/<div style="display:none;[^"]*">Thank you for choosing us\. Your reference is ACME-\d+\./.test(got.html), 'preheader');
  // House style: plain headings and links get the brand look; anything already styled is left alone
  const { emailLayout } = require(ROOT + '/lib/brand');
  const styled = emailLayout('<h3>Next</h3><a href="https://x.example/a?b=1&amp;c=2">Go</a><h2 style="color:red">Kept</h2>', B);
  assert(/<h3 style="[^"]*text-transform:uppercase/.test(styled) && /<a href="https:\/\/x\.example\/a\?b=1&amp;c=2" style="color:#2F4A3B/.test(styled) && styled.includes('<h2 style="color:red">Kept'));
  // Dark mode hooks: cream boxes and red warnings get tagged automatically; green and already-tagged elements are left alone
  const hooked = emailLayout('<div style="background:#F4F1E8;padding:4px">Box</div><span style="font-weight:bold;color:#A33A2E">3 days overdue</span><td class="aw-btn-cream" style="background:#F4F1E8">B</td><div style="background:#2F4A3B">G</div>', B);
  assert(hooked.includes('<div class="aw-cream" style="background:#F4F1E8;padding:4px">Box') && hooked.includes('<span class="aw-warn" style="font-weight:bold;color:#A33A2E">3 days overdue')
    && hooked.includes('<td class="aw-btn-cream" style="background:#F4F1E8">B') && hooked.includes('<div style="background:#2F4A3B">G') && /\.aw \.aw-warn \{ color: #F28B82/.test(hooked), 'dark mode hooks');
  // Dark mode styles in every email; the cream page background only on the "thank you" emails
  assert(got.html.includes('@media (prefers-color-scheme: dark)') && /class="aw" style="background:#F4F1E8/.test(got.html), 'thank-you email on cream');
  // Project estimate: the contract's price lines as a table, totals worked out the same way as the PDF
  const em = require(ROOT + '/lib/email');
  await em.sendPricingEmail({ project: { project_id: 'P-1', email: 'a@b.co', confirm_token: 't', pricing_estimate: 'Laptops, 2 x $100 = $200\nSetup = $50\nVAT 15.5%\n50% <b>upfront</b>.' }, baseUrl: B });
  const priced = emails.at(-1).html;
  assert(/>Unit price</.test(priced) && priced.includes('$100.00') && priced.includes('$250.00') && priced.includes('$38.75') && priced.includes('$288.75') && priced.includes('50% &lt;b&gt;upfront&lt;/b&gt;.'), 'itemised estimate');
  assert(!/class="aw" style="background/.test(priced), 'other emails have no page background (dark mode friendly)');
  await em.sendPricingEmail({ project: { project_id: 'P-2', email: 'a@b.co', confirm_token: 't', pricing_estimate: 'To be agreed after the site visit' }, baseUrl: B });
  assert(!/>Unit price</.test(emails.at(-1).html) && emails.at(-1).html.includes('To be agreed after the site visit'), 'unreadable pricing is shown as written');
  assert(!emails.some((e) => /border-left:3px solid #2F4A3B/.test(e.html)), 'no green edge bars on boxes');
  assert(!got.html.includes('Error 0x80070005') && !/requirements|scope_summary/i.test(got.html), 'no file contents or AI draft in the client email');
  // A project gets the project steps and no priority line; HTML in what they typed stays escaped
  sec.resetRateLimits();
  r = await realFetch(`${B}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B },
    body: JSON.stringify({ ...base, requestType: 'IT Project', name: '<b>Tari</b>', details: 'New office network\n<script>x</script>' }) });
  const proj = await r.json();
  const pe = emails.find((e) => e.subject === `Project request received — ${proj.projectId}`);
  assert(r.status === 200 && pe, 'project request-received email');
  assert(pe.html.includes('confirm the scope') && pe.html.includes('&lt;b&gt;Tari&lt;/b&gt;') && pe.html.includes('&lt;script&gt;') && !pe.html.includes('<script>x') && !pe.html.includes('Priority:'));
  sec.resetRateLimits();
  r = await realFetch(`${B}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B },
    body: JSON.stringify({ ...base, priority: 5, canWork: false }) });
  const urgent = await r.json();
  const ue = emails.find((e) => e.subject === `Support request received — ${urgent.projectId}`);
  assert(ue.html.includes('P5') && ue.html.includes("you can't work at all right now") && ue.html.includes('front of our queue'), 'urgent support email');
  // If the client email can't be sent, the request still succeeds (it's saved; no duplicate resubmits)
  sec.resetRateLimits();
  failClientEmail = true;
  r = await realFetch(`${B}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(base) });
  failClientEmail = false;
  assert.strictEqual(r.status, 200, 'submission still succeeds when the client email fails');
  console.log('6. clients get "Support/Project request received" with their reference, a copy of what they sent and the next steps (escaped; no AI draft); a failed send never fails the request ✓');

  // ---- 7. npm run sample-emails builds every email and sends none ----
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [ROOT + '/scripts/sample-emails.js'], { cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, RESEND_API_KEY: '', BASE_URL: 'http://localhost:3000' } });
  assert.strictEqual(run.status, 0, run.stderr || run.stdout);
  const outDir = ROOT + '/sample-emails';
  const pages = fs.readdirSync(outDir).filter((f) => /^\d+-.*\.html$/.test(f));
  assert(pages.length >= 40 && fs.existsSync(outDir + '/index.html'), `${pages.length} sample pages`);
  const sample = fs.readFileSync(`${outDir}/01-request-received-support.html`, 'utf8');
  assert(sample.includes('src="brand/autowerke-it-logo-email-plate.png"') && sample.includes('Thank you for choosing us.'), 'local logo + thank-you line');
  assert(fs.readdirSync(outDir + '/attachments').some((f) => f.endsWith('.ics')) && /Usage:/.test(spawnSync(process.execPath, [ROOT + '/scripts/sample-emails.js', '--send', 'nope'], { cwd: ROOT, encoding: 'utf8' }).stdout));
  console.log(`7. npm run sample-emails writes ${pages.length} emails + a gallery (logos copied locally, attachments saved); --send needs a real address ✓`);

  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
