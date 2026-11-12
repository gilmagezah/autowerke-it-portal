// The IT Support work estimate: the client downloads it, signs section 4 and uploads it to
// approve the work (status estimate_sent -> in_progress). Same layout as the other client
// documents (lib/pdfDoc.js). The figures come from supportBilling(), the same maths as the
// completion sign-off, so the estimate and the final bill always agree on rate and VAT.
const PDFDocument = require('pdfkit');
const { brandName, contactInfo } = require('./brand');
const pdfDoc = require('./pdfDoc');
const { supportBilling } = require('./supportSignoff');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const fmtHours = (h) => `${Number(h).toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;

function generateEstimatePdf(project, { date = new Date() } = {}) {
  const brand = brandName();
  const contact = contactInfo();
  const company = project.company_name || 'the client';
  const clientName = [project.name, project.surname].filter(Boolean).join(' ');
  const title = project.project_title || 'IT support';
  // No work logged yet, so this is the estimate exactly as it would be billed
  const bill = supportBilling({ ...project, work_log: [] });

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: pdfDoc.BODY_TOP, bottom: 70, left: 60, right: 60 },
    bufferPages: true,
    info: { Title: `${title} — Work estimate`, Author: brand },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  // --- Cover + contents ---
  pdfDoc.cover(doc, {
    kind: 'Work estimate',
    title,
    client: project.company_name,
    description: 'This estimate sets out the support work we expect to do for you and what it should cost. '
      + 'Please review it, then sign section 4 to approve the work.',
    facts: [
      ['Prepared for', [project.company_name, clientName].filter(Boolean).join('\n')],
      ['Prepared by', `${brand}\n${contact.email}`],
      ['Reference', project.project_id],
      ['Date', fmtDate(date)],
    ],
    note: 'To approve, sign section 4 and upload the signed copy using the link in our email.',
  });
  const toc = pdfDoc.contentsPage(doc, { intro: `Prepared for ${company}. Sections 1 to 3 describe the work; section 4 is where you approve it.` });

  // --- 1 The issue ---
  doc.addPage(); doc.y = pdfDoc.BODY_TOP;
  pdfDoc.section(doc, 1, 'The issue');
  toc.add(1, 'The issue', 'What you reported, and what we will be fixing.');
  pdfDoc.para(doc, project.reviewed_scope_summary || project.details || 'As described in your support request.');
  if (project.users_affected || project.devices_affected || project.attempts_taken) {
    doc.y += 4;
    pdfDoc.facts(doc, [
      ['Users affected', project.users_affected],
      ['Devices affected', project.devices_affected],
      ...(project.attempts_taken ? [['Already tried', project.attempts_taken]] : []),
    ]);
  }

  // --- 2 Estimate ---
  pdfDoc.section(doc, 2, 'Estimate', { keep: 170 }); // the table and totals stay with the heading
  toc.add(2, 'Estimate', 'Estimated hours, the hourly rate, VAT and the estimated total.');
  pdfDoc.priceRows(doc, {
    rows: [{ description: `Support work: ${title}`, qty: bill.estimatedHours, unit: bill.rate, amount: bill.subtotal }],
    subtotal: bill.subtotal, vat: bill.vatApplies ? bill.vat : null, vatRate: bill.vatApplies ? bill.vatRate : null, total: bill.total,
  }, { labels: { qty: 'Hours', unit: 'Rate / h' }, qtyFmt: fmtHours, totalLabel: 'Estimated total' });
  pdfDoc.para(doc, 'This is an estimate based on the information you gave us. Prices are in US dollars.', { color: pdfDoc.C.MUTED, size: 9 });

  // --- 3 How billing works ---
  pdfDoc.section(doc, 3, 'How billing works');
  toc.add(3, 'How billing works', 'What you are billed for, and when.');
  pdfDoc.list(doc, [
    `We bill the time we actually log on this ticket, at ${pdfDoc.money(bill.rate)} an hour, guided by this estimate.`,
    'If no time is logged, the approved estimate above is billed instead.',
    'When the work is done, you get a completion sign-off that lists every time entry and the final amount.',
    'Invoices are due within 14 days unless agreed otherwise, and we issue a receipt for every payment.',
  ], { numbered: false });

  // --- 4 Approval ---
  pdfDoc.section(doc, 4, 'Approval', { keep: 290 }); // statement and both signature blocks stay together
  toc.add(4, 'Approval', `Your signature approving the work, and ours.`);
  pdfDoc.para(doc, `By signing below, ${company} approves this estimate and asks ${brand} to go ahead with the work.`);
  doc.y += 10;
  const sig = require('./signature').getSignature();
  pdfDoc.signatures(doc, [
    { heading: company, name: clientName, title: project.position || '' },
    { heading: brand, name: sig ? sig.name : '', title: sig ? sig.title : '', image: sig ? sig.buffer : null },
  ]);

  toc.fill(pdfDoc.pageNumber(doc));
  pdfDoc.chrome(doc, { title, ref: project.project_id });
  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

module.exports = { generateEstimatePdf };
