// Project sign-off document: default content, validation, and PDF generation.
// Layout (lib/pdfDoc.js): cover -> contents -> 1 Introduction -> 2 Project overview
// (objectives, outstanding items, recommendations) -> 3 Acceptance sign-off
//
// Our pre-applied signature (Billing -> Your signature) fills the AutoWerke | IT block.

const PDFDocument = require('pdfkit');
const { brandName, contactInfo } = require('./brand');
const pdfDoc = require('./pdfDoc');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------- Content ----------

function defaultSignoff(project) {
  const company = project.company_name || 'the client';
  return {
    project_title: project.project_title || '',
    introduction:
      project.reviewed_scope_summary ||
      `This document confirms the completion of the project delivered for ${company}.`,
    objectives: project.reviewed_requirements || [],
    outstanding_issues: [],
    recommendations: [],
    acceptance_statement:
      `The signatures below confirm that the project deliverables described in this document ` +
      `have been completed to the satisfaction of ${company}, and that the project is accepted as delivered.`,
    client_signatory_name: [project.name, project.surname].filter(Boolean).join(' '),
    client_signatory_title: project.position || '',
  };
}

function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Accepts an array or a newline-separated string (one item per line)
function cleanList(v, maxItems = 40, maxLen = 500) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/\r?\n/);
  return arr
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((x) => x.slice(0, maxLen));
}

function sanitizeSignoff(input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = {
    project_title: cleanText(s.project_title, 120),
    introduction: cleanText(s.introduction, 4000),
    objectives: cleanList(s.objectives),
    outstanding_issues: cleanList(s.outstanding_issues),
    recommendations: cleanList(s.recommendations),
    acceptance_statement: cleanText(s.acceptance_statement, 1500),
    client_signatory_name: cleanText(s.client_signatory_name, 120),
    client_signatory_title: cleanText(s.client_signatory_title, 120),
  };
  if (!out.project_title) throw new Error('The sign-off needs a project name.');
  if (!out.introduction) throw new Error('The sign-off needs an introduction.');
  if (out.objectives.length === 0) throw new Error('Add at least one project objective.');
  if (!out.acceptance_statement) throw new Error('The sign-off needs an acceptance statement.');
  return out;
}

// ---------- PDF ----------

function generateSignoffPdf({ project, signoff, date = new Date() }) {
  const brand = brandName();
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: pdfDoc.BODY_TOP, bottom: 70, left: 60, right: 60 },
    bufferPages: true, // lets us go back and fill in the contents + page numbers
    info: { Title: `${signoff.project_title} — Project Sign-off`, Author: brand },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  // --- Cover + contents (lib/pdfDoc.js: shared by the client documents) ---
  const contact = contactInfo();
  const company = project.company_name || 'the client';
  const clientName = [project.name, project.surname].filter(Boolean).join(' ');
  pdfDoc.cover(doc, {
    kind: 'Project sign-off',
    title: signoff.project_title,
    client: project.company_name,
    description: 'This document confirms that the project is complete. It sets out what was delivered, '
      + 'anything still outstanding and our recommendations, and asks you to accept the project as delivered.',
    facts: [
      ['Prepared for', [project.company_name, clientName].filter(Boolean).join('\n')],
      ['Prepared by', `${brand}\n${contact.email}`],
      ['Reference', project.project_id],
      ['Date', fmtDate(date)],
    ],
    note: 'To accept, sign section 3: online with the link in our email, or print, sign and upload it.',
  });
  const toc = pdfDoc.contentsPage(doc, { intro: `Prepared for ${company}. Please read sections 1 and 2, then sign section 3.` });

  // --- 1 Introduction ---
  doc.addPage(); doc.y = pdfDoc.BODY_TOP;
  pdfDoc.section(doc, 1, 'Introduction');
  toc.add(1, 'Introduction', 'What the project set out to do.');
  pdfDoc.para(doc, signoff.introduction);

  // --- 2 Project overview ---
  pdfDoc.section(doc, 2, 'Project overview');
  toc.add(2, 'Project overview', 'Objectives delivered, anything outstanding, and our recommendations.');
  pdfDoc.subhead(doc, 'Objectives delivered');
  pdfDoc.list(doc, signoff.objectives);
  doc.y += 6;
  pdfDoc.subhead(doc, 'Outstanding items');
  if (signoff.outstanding_issues.length) pdfDoc.list(doc, signoff.outstanding_issues, { numbered: false });
  else pdfDoc.para(doc, 'None.', { color: pdfDoc.C.MUTED });
  doc.y += 6;
  pdfDoc.subhead(doc, 'Our recommendations');
  if (signoff.recommendations.length) pdfDoc.list(doc, signoff.recommendations, { numbered: false });
  else pdfDoc.para(doc, 'No further recommendations at this time.', { color: pdfDoc.C.MUTED });

  // --- 3 Acceptance ---
  pdfDoc.section(doc, 3, 'Acceptance sign-off', { keep: 290 }); // statement and both signature blocks stay together
  toc.add(3, 'Acceptance sign-off', `Signatures from ${company} and ${brand} confirming the project is accepted.`);
  pdfDoc.para(doc, signoff.acceptance_statement);
  doc.y += 10;
  const sig = require('./signature').getSignature();
  pdfDoc.signatures(doc, [
    { heading: company, name: signoff.client_signatory_name, title: signoff.client_signatory_title },
    { heading: brand, name: sig ? sig.name : '', title: sig ? sig.title : '', image: sig ? sig.buffer : null },
  ]);

  // --- Contents page numbers, then the header + footer on every page after the cover ---
  toc.fill(pdfDoc.pageNumber(doc));
  pdfDoc.chrome(doc, { title: signoff.project_title, ref: project.project_id });

  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

module.exports = { defaultSignoff, sanitizeSignoff, generateSignoffPdf, brandName };
