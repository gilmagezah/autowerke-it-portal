// End-to-end test: batch. Run all with `npm test`. Uses an in-memory database (tests/fakedb.js)
// and stubbed email/storage, so it never touches Supabase or sends real email.
const ROOT = require('path').join(__dirname, '..');
process.env.PORT = '3566'; process.env.BASE_URL = 'http://localhost:3566';
process.env.SUPABASE_URL = 'https://abc.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
process.env.ADMIN_EMAIL = 'gil@autowerkeit.com'; process.env.ADMIN_PASSWORD = 'Bootstrap-Pass-2026'; process.env.ADMIN_NAME = 'Gil Magezah';
process.env.APP_SECRET = 'g'.repeat(64); process.env.NODE_ENV = 'production'; process.env.GA_MEASUREMENT_ID = 'G-TEST12345';
process.env.INVOICE_PAYMENT_DETAILS = 'Bank: CBZ · Account: 1234567890\\nEcoCash: 077 000 0000';
const assert = require('assert'); const crypto = require('crypto'); const fs = require('fs');
const storage = require(ROOT + '/lib/storage');
const files = {};
storage.uploadSignedContract = async (ref, buf, name, type, label) => { const p = `${ref}/${label}.${name.split('.').pop()}`; files[p] = buf; return storage.PUBLIC_PREFIX + p; };
storage.signedUrl = async (p) => `https://signed.example/${p}?token=short-lived`;
storage.download = async (p) => files[p];
const db = require(ROOT + '/lib/db');
const fake = require('./fakedb.js'); const T = fake(db); fake.extend(db, T);
const tanner = { id: crypto.randomUUID(), project_id: 'TANNER-5422', confirm_token: crypto.randomUUID(), company_name: 'Tanner Republic', name: 'Rudo', surname: 'Moyo', email: 'rudo@tanner.co.zw',
  request_type: 'IT Project', status: 'signed', project_title: 'Intune Deployment', contract_value: 4050, vat_applicable: true, pricing_estimate: 'x', created_at: '2026-10-01T09:00:00Z',
  signed_contract_url: storage.PUBLIC_PREFIX + 'TANNER-5422/contract-signed.pdf', signed_at: '2026-10-03T09:00:00Z' };
const old = { ...tanner, id: crypto.randomUUID(), project_id: 'OLDCO-1000', confirm_token: crypto.randomUUID(), status: 'closed', closed_at: '2026-08-01T00:00:00Z' };
const priced = { ...tanner, id: crypto.randomUUID(), project_id: 'PRICED-1001', confirm_token: crypto.randomUUID(), status: 'pricing_sent', signed_contract_url: null, signed_at: null };
const estimated = { ...tanner, id: crypto.randomUUID(), project_id: 'ESTCO-1002', confirm_token: crypto.randomUUID(), request_type: 'IT Support', status: 'estimate_sent', signed_contract_url: null };
T.projects.push(tanner, old, priced, estimated);
files['TANNER-5422/contract-signed.pdf'] = Buffer.from('%PDF-1.4 signed');
const realFetch = global.fetch; const emails = [];
global.fetch = async (u, o) => (String(u).includes('api.resend.com') ? (emails.push(JSON.parse(o.body)), { ok: true, json: async () => ({}) }) : realFetch(u, o));
require(ROOT + '/server.js');
const B = 'http://localhost:3566';
(async () => {
  await new Promise((r) => setTimeout(r, 500));
  await realFetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gil@autowerkeit.com', password: 'Bootstrap-Pass-2026' }) });
  const v = await realFetch(B + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gil@autowerkeit.com', code: emails.at(-1).subject.slice(-6) }) });
  const C = { Cookie: `aw_admin=${v.headers.get('set-cookie').match(/aw_admin=([^;]+)/)[1]}`, 'Content-Type': 'application/json' };
  const call = async (m, p, b, h = C) => { const r = await realFetch(B + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' }); return { status: r.status, json: await r.json().catch(() => null), headers: r.headers }; };

  // ---- signature ----
  const png = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'sig.png')).toString('base64');
  let r = await call('POST', '/api/admin/settings/signature', { image: `data:image/png;base64,${png}`, name: 'Gil Magezah', title: 'Founder & Lead Consultant' });
  assert(r.status === 200 && r.json.url.startsWith('/files/settings/'), JSON.stringify(r.json));
  console.log('1. signature saved privately; its link leaves the server as /files/... (never a public URL) ✓');

  // ---- invoice ----
  const bill = (await call('GET', '/api/admin/billing')).json;
  const src = bill.sources.find((s) => s.ref === 'TANNER-5422');
  assert.deepStrictEqual(src.lines, [{ description: 'IT project: Intune Deployment', qty: 1, unit_price: 4050 }]);
  r = await call('POST', '/api/admin/invoices', { request_id: tanner.id, company: src.company, email: src.email, contact_name: src.contact, lines: src.lines, vat_applicable: true, due_days: 14, total: 1 });
  const inv = r.json;
  assert(r.status === 200 && inv.number === `AW-INV-${new Date().getFullYear()}-0001` && inv.total === 4677.75 && inv.subtotal === 4050 && inv.vat === 627.75);
  assert(inv.pdf_url.startsWith('/files/TANNER-5422/'));
  const fu = T.follow_ups[0];
  assert(fu && fu.amount === 4677.75 && fu.notes === `Invoice ${inv.number}` && fu.reminder_enabled && inv.follow_up_id === fu.id);
  const mail = emails.at(-1);
  assert(mail.subject.startsWith(`Invoice ${inv.number}`) && mail.attachments[0].filename === `${inv.number}.pdf`);
  const invPdf = files[Object.keys(files).find((k) => k.includes('invoice-'))];
  fs.writeFileSync(require('path').join(require('os').tmpdir(), 'aw-invoice.pdf'), invPdf);
  console.log(`2. invoice ${inv.number}: lines pre-filled from the contract ($4,050 + 15.5% VAT = $4,677.75; browser "total" ignored), PDF stored privately, emailed, follow-up created ✓`);

  // ---- payments ----
  r = await call('POST', `/api/admin/invoices/${inv.id}/pay`, { amount: 99999, method: 'EcoCash' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', `/api/admin/invoices/${inv.id}/pay`, { amount: 2000, method: 'EcoCash', reference: 'MP261030.1234', received_on: new Date().toISOString().slice(0, 10) });
  assert(r.status === 200 && r.json.fullyPaid === false && r.json.receipt.number === `AW-RCT-${new Date().getFullYear()}-0001`);
  assert.strictEqual(T.follow_ups[0].amount, 2677.75);
  assert.strictEqual(T.invoices[0].status, 'issued');
  console.log('3. overpayment refused; $2,000 EcoCash -> receipt AW-RCT-...-0001, invoice still open, follow-up reduced to $2,677.75 ✓');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 workplace receipt')]), 'receipt.pdf');
  fd.append('external_number', '004512'); fd.append('amount', '2677.75'); fd.append('method', 'Bank transfer'); fd.append('received_on', new Date().toISOString().slice(0, 10)); fd.append('send', 'true');
  const up = await realFetch(B + `/api/admin/invoices/${inv.id}/receipt-upload`, { method: 'POST', headers: { Cookie: C.Cookie }, body: fd });
  const upj = await up.json();
  assert(up.status === 200 && upj.fullyPaid && upj.receipt.number === 'EXT-004512' && upj.receipt.source === 'uploaded');
  assert(T.invoices[0].status === 'paid' && T.follow_ups[0].status === 'paid' && T.follow_ups[0].next_reminder_at === null);
  const rcPdf = files[Object.keys(files).find((k) => k.includes('receipt-RCT') || k.includes('receipt-AW'))];
  fs.writeFileSync(require('path').join(require('os').tmpdir(), 'aw-receipt.pdf'), rcPdf);
  console.log('4. balance filed as an UPLOADED workplace receipt (004512) -> invoice PAID, reminders stopped ✓');
  r = await call('POST', `/api/admin/invoices/${inv.id}/void`);
  assert.strictEqual(r.status, 400);
  console.log('5. a paid invoice cannot be voided ✓');

  // ---- rebuild a stale PDF (same number + amounts, new layout + signature) ----
  const beforeUrl = T.invoices[0].pdf_url;
  process.env.INVOICE_PAYMENT_DETAILS = 'Bank: BancABC Mount Pleasant · Account name: AutoWerke IT · Account: 6769000000';
  r = await call('POST', `/api/admin/invoices/${inv.id}/rebuild`, { send: false });
  assert(r.status === 200 && T.invoices[0].pdf_url !== beforeUrl && r.json.number === inv.number && Number(r.json.total) === 4677.75);
  const rebuiltPath = Object.keys(files).filter((k) => k.includes(`invoice-${inv.number}-r`)).pop();
  const rebuiltText = require('./pdftext')(require('path').join(require('os').tmpdir(), 'aw-rebuilt.pdf'), files[rebuiltPath]).replace(/\s+/g, ' ');
  assert(rebuiltText.includes('Payment reference: ' + inv.number), 'reference inside the box');
  assert(rebuiltText.includes('Bank: BancABC Mount Pleasant') && rebuiltText.includes('Account: 6769000000'));
  assert(rebuiltText.includes('Gil Magezah'), 'signature name printed');
  assert(files[storage.pathFromUrl(beforeUrl)], 'the originally emailed copy is kept'); // stored URLs are raw; only API output is rewritten
  const sentBefore = emails.length;
  r = await call('POST', `/api/admin/invoices/${inv.id}/rebuild`, { send: true });
  assert(r.status === 200 && r.json.emailed === false && emails.length === sentBefore, 'a PAID invoice is never re-sent (it would ask for payment twice)');
  const voided = { ...T.invoices[0], id: crypto.randomUUID(), number: 'AW-INV-TEST-VOID', status: 'void' };
  T.invoices.push(voided);
  assert.strictEqual((await call('POST', `/api/admin/invoices/${voided.id}/rebuild`, { send: true })).status, 400);
  T.invoices.splice(T.invoices.indexOf(voided), 1);
  const genRc = T.receipts.find((x) => x.source === 'generated');
  const rcBefore = genRc.file_url; // snapshot: genRc is the live record
  r = await call('POST', `/api/admin/receipts/${genRc.id}/rebuild`, { send: false });
  assert(r.status === 200 && genRc.file_url !== rcBefore);
  const upRc = T.receipts.find((x) => x.source === 'uploaded');
  assert.strictEqual((await call('POST', `/api/admin/receipts/${upRc.id}/rebuild`, {})).status, 400);
  console.log('5b. Rebuild PDF: same number + total, new layout (reference inside the box, details on their own lines, signature); original kept; a paid invoice is never re-emailed; void invoices and uploaded receipts refused ✓');

  // ---- trail ----
  const tr = (await call('GET', `/api/admin/trail/${tanner.id}`)).json.trail.map((e) => e.title);
  assert(tr[0] === 'Request submitted' && tr.includes('Signed contract') && tr.some((t) => t.startsWith('Invoice AW-INV')) && tr.filter((t) => t.startsWith('Receipt')).length === 2);
  console.log(`6. document trail: ${tr.join(' → ')} ✓`);

  // ---- private files ----
  const path = 'TANNER-5422/contract-signed.pdf';
  r = await realFetch(B + `/files/${path}`, { headers: { Cookie: C.Cookie }, redirect: 'manual' });
  assert(r.status === 302 && r.headers.get('location').startsWith('https://signed.example/'));
  r = await realFetch(B + `/files/${path}`, { redirect: 'manual' });
  assert.strictEqual(r.status, 404);
  r = await realFetch(B + `/files/${path}?t=${tanner.confirm_token}`, { redirect: 'manual' });
  assert.strictEqual(r.status, 302, 'client opens own file');
  r = await realFetch(B + `/files/${path}?t=${old.confirm_token}`, { redirect: 'manual' });
  assert.strictEqual(r.status, 404, "another client's token can't open it");
  for (const evil of ['TANNER-5422/../OLDCO-1000/x.pdf', '..%2F..%2Fetc%2Fpasswd', 'TANNER-5422/a/b.pdf', '%2e%2e/x']) {
    r = await realFetch(B + `/files/${evil}?t=${tanner.confirm_token}`, { redirect: 'manual' });
    assert.strictEqual(r.status, 404, evil);
  }
  console.log("7. files: admin ✓, client's own file via portal token ✓; anonymous, another client's token, and ../ path tricks all refused ✓");
  const portal = await call('GET', `/api/confirm/${tanner.confirm_token}`, null, {});
  assert(JSON.stringify(portal.json).includes(`/files/TANNER-5422/contract-signed.pdf?t=${tanner.confirm_token}`) && !JSON.stringify(portal.json).includes('supabase.co'));
  assert(!JSON.stringify(emails).includes('/object/public/'), 'no public storage links in any email');
  console.log('8. portal + emails never contain storage URLs; the client portal gets its own token-scoped /files links ✓');

  // ---- portal expiry ----
  r = await call('GET', `/api/confirm/${old.confirm_token}`, null, {});
  assert(r.status === 410 && r.json.expired);
  assert.strictEqual((await call('GET', `/api/confirm/${tanner.confirm_token}`, null, {})).status, 200);
  console.log(`9. a request closed 90 days ago -> 410 "${r.json.error.slice(0, 50)}..."; active requests unaffected ✓`);

  // ---- portal actions only work from the right stage ----
  const act = (p, action, extra = {}) => call('POST', `/api/confirm/${p.confirm_token}`, { action, ...extra }, { 'Content-Type': 'application/json' });
  for (const a of ['decline', 'confirm', 'proceed', 'request_changes', 'decline_estimate']) {
    r = await act(tanner, a, { message: 'reopen please' });
    assert.strictEqual(r.status, 409, `${a} on a signed project`);
  }
  assert.strictEqual(T.projects.find((p) => p.id === tanner.id).status, 'signed');
  assert.strictEqual((await act(priced, 'request_changes', { message: 'x' })).status, 409, 'changes only at the scope stage');
  assert.strictEqual((await act(priced, 'proceed')).status, 200);
  assert.strictEqual(T.projects.find((p) => p.id === priced.id).status, 'proceeding');
  assert.strictEqual((await act(priced, 'decline')).status, 409, 'cannot decline after proceeding');
  // The support estimate shows VAT the same way everywhere: portal, email, PDF
  Object.assign(T.projects.find((p) => p.id === estimated.id), { estimated_hours: 3, hourly_rate: 45, vat_applicable: true });
  const est = (await realFetch(B + `/api/confirm/${estimated.confirm_token}`).then((x) => x.json())).estimate;
  assert(est && est.subtotal === 135 && est.vat === 20.93 && est.total === 155.93 && est.vatApplies, `portal estimate ${JSON.stringify(est)}`);
  await require(ROOT + '/lib/email').sendEstimateEmail({ project: T.projects.find((p) => p.id === estimated.id), baseUrl: B });
  assert(/VAT \(15\.5%\)<\/td><td[^>]*>\$20\.93</.test(emails.at(-1).html) && /Estimated total incl\. VAT<\/td><td[^>]*>\$155\.93</.test(emails.at(-1).html), 'estimate email shows VAT');
  assert.strictEqual((await realFetch(B + `/api/confirm/${tanner.confirm_token}`).then((x) => x.json())).estimate, undefined, 'projects get no support estimate');
  console.log('10b. support estimate: portal and email show $135.00 + VAT $20.93 = $155.93, matching the PDF ✓');
  assert.strictEqual((await act(estimated, 'decline_estimate')).status, 200);
  assert.strictEqual(T.projects.find((p) => p.id === estimated.id).status, 'declined');
  console.log('10. portal actions: signed project cannot be declined, reconfirmed, or re-proceeded (409); proceed/decline only from their own stage ✓');

  // ---- portal uploads are checked by content ----
  const portalUpload = (buf, name, type) => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return realFetch(B + `/api/confirm/${priced.confirm_token}/upload-signed`, { method: 'POST', body: f }); };
  for (const [buf, name, type] of [[Buffer.from('MZ\x90\x00 not a contract'), 'contract.pdf', 'application/pdf'], [Buffer.from('<html><script>alert(1)</script>'), 'contract.pdf', 'application/pdf'], [Buffer.from('<svg onload="x"/>'), 'sig.svg', 'image/svg+xml']]) {
    r = await portalUpload(buf, name, type);
    assert.strictEqual(r.status, 400, name);
  }
  assert.strictEqual(T.projects.find((p) => p.id === priced.id).status, 'proceeding', 'refused uploads change nothing');
  r = await portalUpload(Buffer.from('%PDF-1.4 really signed'), 'contract.exe', 'text/html');
  assert.strictEqual(r.status, 200);
  assert(files['PRICED-1001/signed.pdf'] && !Object.keys(files).some((k) => k.endsWith('.exe')), Object.keys(files).join(','));
  assert.strictEqual(T.projects.find((p) => p.id === priced.id).status, 'signed');
  console.log('11. portal uploads: renamed .exe, HTML and SVG refused; a real PDF named "contract.exe" is stored as .pdf ✓');

  // ---- rate limits key on the address our proxy saw, not the client-written part of X-Forwarded-For ----
  require(ROOT + '/lib/security').resetRateLimits();
  let spoofed; for (let i = 0; i < 9; i++) spoofed = await call('POST', '/api/submit', {}, { 'Content-Type': 'application/json', 'X-Forwarded-For': `${i + 1}.2.3.4, 10.9.9.9` });
  assert.strictEqual(spoofed.status, 429, 'changing the first X-Forwarded-For entry must not reset the limit');
  require(ROOT + '/lib/security').resetRateLimits();
  console.log('12. faking a new IP in X-Forwarded-For on every request still hits the submit limit (429) ✓');

  // ---- consent, config, 404, rate limit ----
  r = await call('POST', '/api/submit', { requestType: 'IT Support', name: 'A', companyName: 'B', email: 'a@b.co', details: 'x' }, { 'Content-Type': 'application/json' });
  assert(r.status === 400 && /agree/i.test(r.json.error));
  assert.strictEqual((await call('GET', '/api/site-config', null, {})).json.gaMeasurementId, 'G-TEST12345');
  r = await realFetch(B + '/nope/never', { headers: { Accept: 'text/html' } });
  const nf = await r.text();
  assert(r.status === 404 && nf.includes('OUT OF BOUNDS'));
  assert.strictEqual((await realFetch(B + '/api/nope')).status, 404);
  const csp = (await realFetch(B + '/')).headers.get('content-security-policy');
  assert(csp.includes('googletagmanager.com') && csp.includes("script-src 'self' https://www.googletagmanager.com"));
  require(ROOT + '/lib/security').resetRateLimits();
  let last; for (let i = 0; i < 9; i++) last = await call('POST', '/api/submit', {}, { 'Content-Type': 'application/json' });
  assert.strictEqual(last.status, 429);
  console.log('13. submit without agreeing -> refused; GA ID served only via config; quirky 404 page (API gets JSON 404); 9th submit in 15 min -> 429 ✓');
  for (const p of ['/privacy', '/cookies', '/terms', '/service-terms']) assert.strictEqual((await realFetch(B + p)).status, 200, p);
  console.log('14. /privacy, /cookies, /terms, /service-terms all load ✓');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
