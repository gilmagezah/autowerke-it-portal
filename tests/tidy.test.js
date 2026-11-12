// Small visual and document tidy-ups. `npm test`.
// 1. The typed signature uses the house typewriter font (a handwriting stack fell back to Comic Sans on Windows).
// 2. Flagged cards get an even outline all round, never a thick coloured side bar.
// 3. PDF headers print no phone number until PDF_PHONE is set; the personal BRAND_PHONE never reaches a PDF.
const ROOT = require('path').join(__dirname, '..');
const assert = require('assert'); const fs = require('fs');
const read = (f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8');

// ---- 1. Typed signature ----
const so = read('public/signoff.css');
const typed = so.match(/\.so-typed\s*\{[^}]*\}/)[0];
assert(/font-family:\s*var\(--mono\)/.test(typed) && /italic/.test(typed), typed);
assert(!/cursive|Comic|Script|Handwriting/i.test(so), 'no handwriting fonts left on the sign-off page');
assert(/Courier\+Prime:ital,wght@[^"&]*1,700/.test(read('public/signoff.html')), 'the bold italic is actually loaded');
const es = read('lib/esign.js');
assert(/Courier-BoldOblique/.test(es) && !/Times-BoldItalic/.test(es), 'the signed PDF matches the preview');
console.log('1. typed signature: Courier Prime bold italic on the page, Courier bold oblique in the PDF ✓');

// ---- 2. No side bars ----
for (const f of ['public/services.css', 'public/workspace.css', 'public/admin.css', 'public/theme.css']) {
  const bars = read(f).match(/border-left:\s*[2-9]px[^;]*;/g) || [];
  assert.deepStrictEqual(bars, [], `${f} still has a side bar: ${bars.join(' ')}`);
}
assert(/\.svc-card\.urgent\s*\{\s*border-color:\s*var\(--red\)/.test(read('public/services.css')), 'urgent cards: an even red outline');
console.log('2. urgent, flagged and change-request cards: an even outline, no side bar ✓');

// ---- 3. Phone off the PDFs ----
process.env.BRAND_PHONE = '+263 00 000 0000'; delete process.env.PDF_PHONE;
const brand = require(ROOT + '/lib/brand');
const c = brand.contactInfo();
let lines = brand.pdfContactLines(c);
assert(!/\d{3}/.test(lines.replace(c.email, '')) && lines.split('\n').length === 2, `no phone: ${JSON.stringify(lines)}`);
assert(lines.startsWith(c.email) && lines.endsWith(c.location));
process.env.PDF_PHONE = '  ';
assert.strictEqual(brand.pdfContactLines(c), lines, 'blank PDF_PHONE = no phone');
process.env.PDF_PHONE = '+263 24 000 0000';
assert.strictEqual(brand.pdfContactLines(c).split('\n')[1], '+263 24 000 0000', 'a work number shows once set');
delete process.env.PDF_PHONE;
for (const f of ['lib/pdfDoc.js', 'lib/billing.js', 'lib/directoryPdf.js']) {
  const t = read(f);
  assert(/pdfContactLines\(c\)/.test(t) && !/c\.phone/.test(t), `${f} prints the header through pdfContactLines`);
}
assert(!/c\.phone|contact\.phone/.test(['contract', 'estimate', 'signoff', 'supportSignoff', 'esign'].map((n) => read(`lib/${n}.js`)).join('\n')), 'no other PDF prints the phone');
console.log('3. PDF headers: email + location only; PDF_PHONE brings a work number back ✓');

// ---- 4. The Accessories menu fits the window; its list scrolls on its own ----
const acc = read('public/accessories.css');
const menu = acc.match(/\.acc-menu \{[^}]*\}/)[0];
const list = acc.match(/\.acc-menu-list \{[^}]*\}/)[0];
assert(/max-height:\s*calc\(100dvh - 16px\)/.test(menu) && /flex-direction:\s*column/.test(menu), menu);
assert(/overflow-y:\s*auto/.test(list) && /min-height:\s*0/.test(list) && /scrollbar-width:\s*thin/.test(list), list);
console.log('4. Accessories menu: never taller than the window, the list has its own thin scroller ✓');
