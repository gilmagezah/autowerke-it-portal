// The project contract the client downloads once they choose to go ahead with the price
// (status "proceeding"), signs and uploads. Same layout as the other client documents
// (lib/pdfDoc.js): cover, contents, then the sections. The price follows the invoice's style.
//
// The wording in section 4 restates our service terms (/service-terms); it doesn't add new
// obligations. Both still need review by a Zimbabwean lawyer.
const PDFDocument = require('pdfkit');
const { brandName, contactInfo } = require('./brand');
const pdfDoc = require('./pdfDoc');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

function generateContractPdf(project, { date = new Date() } = {}) {
  const brand = brandName();
  const contact = contactInfo();
  const company = project.company_name || 'the client';
  const clientName = [project.name, project.surname].filter(Boolean).join(' ');
  const title = project.project_title || 'IT project';

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: pdfDoc.BODY_TOP, bottom: 70, left: 60, right: 60 },
    bufferPages: true,
    info: { Title: `${title} — Project contract`, Author: brand },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  // --- Cover + contents ---
  pdfDoc.cover(doc, {
    kind: 'Project contract',
    title,
    client: project.company_name,
    description: `This contract sets out the work ${brand} will deliver for you, what it costs, and how the project runs. `
      + 'Please read it, then sign section 5 to go ahead.',
    facts: [
      ['Prepared for', [project.company_name, clientName].filter(Boolean).join('\n')],
      ['Prepared by', `${brand}\n${contact.email}`],
      ['Reference', project.project_id],
      ['Date', fmtDate(date)],
    ],
    note: 'To go ahead, sign section 5 and upload the signed copy using the link in our email.',
  });
  const toc = pdfDoc.contentsPage(doc, { intro: `Prepared for ${company}. Sections 1 to 4 describe the project; section 5 is where you sign.` });

  // --- 1 Scope ---
  doc.addPage(); doc.y = pdfDoc.BODY_TOP;
  pdfDoc.section(doc, 1, 'Scope of work');
  toc.add(1, 'Scope of work', 'What the project covers, as you confirmed it.');
  pdfDoc.para(doc, project.reviewed_scope_summary || 'As agreed in the confirmed scope.');

  // --- 2 Deliverables ---
  const reqs = (project.reviewed_requirements || []).filter(Boolean);
  pdfDoc.section(doc, 2, "What we'll deliver");
  toc.add(2, "What we'll deliver", 'The requirements the finished project will meet.');
  if (reqs.length) pdfDoc.list(doc, reqs);
  else pdfDoc.para(doc, 'As described in the scope of work above.');

  // --- 3 Price ---
  pdfDoc.section(doc, 3, 'Price');
  toc.add(3, 'Price', 'What the project costs, VAT, and how it is paid.');
  pdfDoc.priceTable(doc, project.pricing_estimate || 'To be confirmed.');
  pdfDoc.para(doc, 'Prices are in US dollars. This price is valid for 14 days from the date of this contract unless stated otherwise.', { color: pdfDoc.C.MUTED, size: 9 });

  // --- 4 How the project runs (restates the service terms) ---
  pdfDoc.section(doc, 4, 'How the project runs');
  toc.add(4, 'How the project runs', 'Delivery, changes, payment and sign-off, in short.');
  pdfDoc.list(doc, [
    'We start once this contract is signed and returned. The work is delivered in phases, and you get an email update as each phase is completed.',
    'Anything outside the scope above is quoted separately and only done once you agree. We will tell you before anything extra is charged.',
    'We need timely access to the systems, people and information the work needs. Delays while waiting for access or decisions may affect the timeline.',
    'When the work is complete we send a sign-off document. Signing it confirms the work was delivered, apart from any outstanding items listed in it.',
    'Invoices are due within 14 days unless agreed otherwise, and we issue a receipt for every payment.',
  ], { numbered: false });

  // --- 5 Agreement ---
  pdfDoc.section(doc, 5, 'Agreement', { keep: 290 }); // statement and both signature blocks stay together
  toc.add(5, 'Agreement', `Signatures from ${company} and ${brand} to go ahead.`);
  pdfDoc.para(doc, `By signing below, ${company} accepts the scope and price in this contract, and both parties agree to the terms in section 4.`);
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

module.exports = { generateContractPdf };
