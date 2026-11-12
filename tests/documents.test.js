// Client documents: the shared cover + contents layout (lib/pdfDoc.js). Builds real PDFs and
// reads them back with pdf-lib: page counts, A4 size, and worst-case content. `npm test`.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:59999';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const { generateSignoffPdf, defaultSignoff } = require('../lib/signoff');

const project = {
  project_id: 'PRJ-TEST-0001', company_name: 'Test Co (Pvt) Ltd', name: 'Tendai', surname: 'Moyo', position: 'Director',
  reviewed_scope_summary: 'Move the office to Microsoft 365.', reviewed_requirements: ['Migrate mail', 'Enrol laptops'],
};
const pages = async (buf) => (await PDFDocument.load(buf)).getPages();

(async () => {
  let p = await pages(await generateSignoffPdf({ project, signoff: { ...defaultSignoff(project), project_title: 'Office 365 move' } }));
  // Cover, contents, then the sections flow: a short sign-off fits on 1–2 more pages.
  assert(p.length >= 3 && p.length <= 4, `pages ${p.length}`);
  p.forEach((pg) => { const { width, height } = pg.getSize(); assert(Math.round(width) === 595 && Math.round(height) === 842, 'A4'); });
  console.log(`1. project sign-off: cover, contents and 3 flowing sections = ${p.length} A4 pages ✓`);

  // Worst case: a very long title and company name, lots of objectives. The cover must stay one
  // page (nothing spills onto the contents page) and the footer must never add pages.
  const long = 'Microsoft 365, Intune, Entra ID and SharePoint migration with Autopilot, Defender for Business and staff training across three offices';
  const big = { ...project, company_name: 'The Very Long Name Engineering and Logistics Holdings (Private) Limited' };
  // Same content with a short title vs a 120-character one: equal page counts prove the cover
  // didn't spill onto a second page.
  const so = { ...defaultSignoff(big), project_title: long.slice(0, 120) };
  const shortP = await pages(await generateSignoffPdf({ project: big, signoff: { ...so, project_title: 'Office move' } }));
  p = await pages(await generateSignoffPdf({ project: big, signoff: so }));
  assert.strictEqual(p.length, shortP.length, `cover spilled over: ${p.length} vs ${shortP.length} pages`);
  const many = { ...so, objectives: Array.from({ length: 40 }, (_, i) => `Objective ${i + 1}: ${'detail '.repeat(12)}`) };
  p = await pages(await generateSignoffPdf({ project: big, signoff: many }));
  assert(p.length > shortP.length && p.length <= 8, `long sign-off pages ${p.length}`);
  console.log(`2. worst case (120-character title, long company name): cover stays one page; 40 objectives flow on to ${p.length} pages ✓`);

  // Pricing text -> invoice-style rows. Lines it can't read are kept as written, never dropped.
  const { parsePricing } = require('../lib/pdfDoc');
  const pp = parsePricing('50 devices x $20 = $1000\nStaff training, 2 x $270 = $540\nSetup: $300 (once-off)\nVAT 15.5%\nTotal = $2,124.70\n50% up front, 50% on sign-off.\n100% of the hard work 😀');
  assert.deepStrictEqual(pp.rows.map((r) => [r.description, r.qty, r.unit, r.amount]), [['Devices', 50, 20, 1000], ['Staff training', 2, 270, 540], ['Setup (once-off)', null, null, 300]]);
  assert(pp.vatRate === 15.5 && pp.total === 2124.7 && pp.vat === null);
  assert.deepStrictEqual(pp.notes, ['50% up front, 50% on sign-off.', '100% of the hard work 😀']);
  const plain = parsePricing('Fixed price for the whole job, payable on completion.');
  assert(plain.rows.length === 0 && plain.notes.length === 1 && plain.total === null);
  assert.deepStrictEqual(parsePricing('').rows, []);
  console.log('3. pricing lines ("50 devices x $20 = $1000", "Setup: $300", VAT %, Total) read into rows; other lines kept word for word ✓');

  const { generateContractPdf } = require('../lib/contract');
  const priced = { ...project, project_title: 'Office 365 move', pricing_estimate: '50 devices x $20 = $1000\nVAT 15.5%\n50% up front.' };
  p = await pages(await generateContractPdf(priced));
  assert.strictEqual(p.length, 4, `contract pages ${p.length}`);
  // Worst cases: no title, no requirements, unreadable pricing text, long everything
  p = await pages(await generateContractPdf({ project_id: 'X-1', company_name: big.company_name, pricing_estimate: 'Call us.' }));
  assert(p.length >= 3 && p.length <= 4, `bare contract pages ${p.length}`);
  const huge = { ...big, project_title: long, reviewed_scope_summary: 'Scope. '.repeat(400), reviewed_requirements: Array.from({ length: 40 }, (_, i) => `Requirement ${i + 1} ${'x '.repeat(30)}`),
    pricing_estimate: Array.from({ length: 30 }, (_, i) => `Item ${i + 1} x $${i + 10} = $${i + 10}`).join('\n') };
  p = await pages(await generateContractPdf(huge));
  assert(p.length >= 6 && p.length <= 12, `huge contract pages ${p.length}`);
  console.log(`4. project contract: 4 pages normally; bare request and a huge one (${p.length} pages) both render ✓`);

  // Work estimate: figures from the same maths as the final support bill
  const { generateEstimatePdf } = require('../lib/estimate');
  const { supportBilling } = require('../lib/supportSignoff');
  const ticket = { ...project, project_title: 'Printer offline', request_type: 'IT Support', estimated_hours: 3, hourly_rate: 45, users_affected: '4', devices_affected: '1 printer' };
  const b = supportBilling({ ...ticket, work_log: [] });
  assert(b.subtotal === 135 && b.vat === 20.93 && b.total === 155.93, `estimate maths ${JSON.stringify(b)}`);
  p = await pages(await generateEstimatePdf(ticket));
  assert(p.length >= 3 && p.length <= 4, `estimate pages ${p.length}`);
  // No VAT, no details, odd numbers, long everything
  p = await pages(await generateEstimatePdf({ project_id: 'S-1', company_name: big.company_name, estimated_hours: '1.5', hourly_rate: '0', vat_applicable: false }));
  assert(p.length >= 3 && p.length <= 4, `bare estimate pages ${p.length}`);
  p = await pages(await generateEstimatePdf({ ...ticket, company_name: big.company_name, project_title: long, details: 'Details. '.repeat(300), attempts_taken: 'Tried. '.repeat(80) }));
  assert(p.length >= 4 && p.length <= 7, `long estimate pages ${p.length}`);
  console.log('5. work estimate: 3 h x $45 + 15.5% VAT = $155.93 (same as the final bill would be); bare and long tickets render ✓');

  // Support sign-off: cover, contents, the work, time logged, amount due, acceptance
  const { generateSupportSignoffPdf } = require('../lib/supportSignoff');
  const text = (buf) => require('./pdftext')(require('path').join(require('os').tmpdir(), 'aw-doc.pdf'), buf).replace(/\s+/g, '');
  const worked = { ...ticket, work_log: [
    { date: '2026-11-02', start: '08:30', end: '10:15', note: 'Rebuilt Outlook profiles' },
    { date: '2026-11-03', start: '13:00', end: '14:30', note: 'Fixed IP for the printer' },
    { date: '2026-11-04', start: '09:00', end: '09:40' },
  ] };
  let buf = await generateSupportSignoffPdf({ project: worked });
  p = await pages(buf);
  assert(p.length >= 3 && p.length <= 4, `support sign-off pages ${p.length}`);
  let t = text(buf);
  assert(t.includes('SUPPORTSIGN-OFF') && t.includes('Totaldue') && t.includes('$203.74') && t.includes('3.92h(3h55m)'), 'support sign-off figures');
  // Nothing logged: billed at the approved estimate, the same $155.93 as the estimate PDF
  buf = await generateSupportSignoffPdf({ project: { ...ticket, work_log: [] } });
  t = text(buf);
  assert(t.includes('Notimeentries') && t.includes('(approvedestimate)') && t.includes('$155.93'), 'estimate fallback');
  // No VAT: no VAT line, total = subtotal
  t = text(await generateSupportSignoffPdf({ project: { ...worked, vat_applicable: false } }));
  assert(!t.includes('VAT(15.5%)') && t.includes('$176.40') && !t.includes('$203.74'), 'no-VAT sign-off');
  // Worst case: 32 long sessions outside 08:00-18:00 and a long title. Same page count as with a
  // short title (the cover stays one page), and the table flows on over several pages.
  const longLog = [];
  for (let d = 1; d <= 16; d++) for (const [s, e] of [['06:30', '09:30'], ['13:15', '19:45']]) longLog.push({ date: `2026-10-${String(d).padStart(2, '0')}`, start: s, end: e, note: `Session ${d}: ${'checked the switch and rebuilt the profile, '.repeat(3)}` });
  const busy = { ...worked, company_name: big.company_name, work_log: longLog };
  const nShort = (await pages(await generateSupportSignoffPdf({ project: busy }))).length;
  p = await pages(await generateSupportSignoffPdf({ project: { ...busy, project_title: long } }));
  assert(p.length === nShort && p.length >= 5 && p.length <= 9, `busy support sign-off pages ${p.length} vs ${nShort}`);
  console.log(`6. support sign-off: logged time billed ($203.74), estimate fallback ($155.93), no-VAT, and 32 sessions over ${p.length} pages ✓`);

  // E-signature certificate: always exactly one page, nothing running into the footer
  const { certificatePdf, ACCEPT } = require('../lib/esign');
  const esign = {
    name: 'Tendai Moyo', email: 'tendai@test.example', method: 'type', code_verified_at: '2026-11-05T12:36:07Z', signed_at: '2026-11-05T12:38:07Z',
    ip: '41.79.112.18', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', amount: 203.74, po_number: null, documents: [],
    accepted: ACCEPT(203.74), doc_sha256: 'ab'.repeat(32),
  };
  let m;
  buf = await certificatePdf({ project: { ...worked, phone: '+263 77 123 4567' }, esign, measure: (x) => { m = x; } });
  assert.strictEqual((await pages(buf)).length, 1);
  assert(m.contentBottom < m.footerTop, `certificate content ${m.contentBottom} reaches the footer ${m.footerTop}`);
  t = text(buf);
  assert(t.includes('ELECTRONICSIGNATURECERTIFICATE') && t.includes('Supportsign-off') && t.includes('$203.74') && t.includes('14:38') && t.includes('(HARARETIME)'), 'certificate text');
  // Worst case: every free-text field very long, an uploaded image, four attachments
  const wide = 'W'.repeat(90);
  buf = await certificatePdf({
    project: { ...busy, request_type: 'IT Project', project_title: long + long, phone: '+263 77 123 4567' },
    esign: { ...esign, name: `Tendaishe ${wide}`, email: `${'very.long.address.'.repeat(5)}@${'subdomain.'.repeat(5)}example`, method: 'upload',
      po_number: `PO-${'9'.repeat(120)}`, documents: Array.from({ length: 4 }, (_, i) => ({ name: `Attachment-${i}-${'x'.repeat(80)}.pdf` })),
      user_agent: 'Mozilla/5.0 '.repeat(60), amount: 1234567.89, accepted: ACCEPT(1234567.89) },
    signatureImage: require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'sig.png')),
    measure: (x) => { m = x; },
  });
  assert.strictEqual((await pages(buf)).length, 1, 'worst-case certificate pages');
  assert(m.contentBottom < m.footerTop, `worst-case certificate content ${m.contentBottom} reaches the footer ${m.footerTop}`);
  console.log(`7. signing certificate: one page; worst case (huge names, PO, 4 attachments, long device) ends at ${Math.round(m.contentBottom)}pt, above the footer ✓`);

  console.log('\nAll document layout checks passed.');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
