// Support ticket completion sign-off: the billing maths and the PDF the client signs.
//
// Billing rule: bill the hours actually logged. If nothing was logged, bill the
// approved estimate instead (and say so on the document).

const PDFDocument = require('pdfkit');
const { brandName, contactInfo } = require('./brand');
const pdfDoc = require('./pdfDoc');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AXIS_START = 8; // visual axis 08:00-18:00, same as the web timeline
const AXIS_END = 18;

const round2 = (n) => Math.round(n * 100) / 100;

function toMinutes(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}

function vatRate() {
  return Number(process.env.VAT_RATE || 15.5);
}

// Everything the PDF, the email and the client page need, computed once
function supportBilling(project) {
  const rate = Number(project.hourly_rate) || 0;
  const estimatedHours = Number(project.estimated_hours) || 0;

  const entries = (project.work_log || [])
    .map((e) => ({ ...e, minutes: Math.max(toMinutes(e.end) - toMinutes(e.start), 0) || 0 }))
    .filter((e) => e.date && e.minutes > 0)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  const loggedHours = round2(entries.reduce((s, e) => s + e.minutes, 0) / 60);
  const usedEstimate = loggedHours === 0;
  const billableHours = usedEstimate ? estimatedHours : loggedHours;
  const subtotal = round2(billableHours * rate);
  const vatApplies = project.vat_applicable !== false;
  const vat = vatApplies ? round2((subtotal * vatRate()) / 100) : 0;

  return {
    entries, rate, estimatedHours, loggedHours, billableHours, usedEstimate,
    subtotal, vatApplies, vatRate: vatRate(), vat, total: round2(subtotal + vat),
  };
}

function fmtMoney(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}`;
}

function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

const fmtHours = (h) => `${Number(h).toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;

// The PDF: cover, contents, then 01 The work · 02 Time logged · 03 Amount due · 04 Acceptance,
// in the shared layout (lib/pdfDoc.js). The amount table follows the invoice.
function generateSupportSignoffPdf({ project, date = new Date() }) {
  const brand = brandName();
  const contact = contactInfo();
  const bill = supportBilling(project);
  const company = project.company_name || 'the client';
  const clientName = [project.name, project.surname].filter(Boolean).join(' ');
  const title = project.project_title || 'IT support';
  const { C, MONO, MONO_B, SANS } = pdfDoc;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: pdfDoc.BODY_TOP, bottom: 70, left: 60, right: 60 },
    bufferPages: true,
    info: { Title: `${title} — Support sign-off`, Author: brand },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const newPage = () => { doc.addPage(); doc.y = pdfDoc.BODY_TOP; };

  // --- Cover + contents ---
  pdfDoc.cover(doc, {
    kind: 'Support sign-off',
    title,
    client: project.company_name,
    description: 'The support work on this ticket is complete. This document lists every session we logged '
      + 'and the amount due, and asks you to confirm that the work is done.',
    facts: [
      ['Prepared for', [project.company_name, clientName].filter(Boolean).join('\n')],
      ['Prepared by', `${brand}\n${contact.email}`],
      ['Reference', project.project_id],
      ['Date', fmtDate(new Date(date).toISOString().slice(0, 10))],
    ],
    note: 'To accept, sign section 4: online with the link in our email, or print, sign and upload it.',
  });
  const toc = pdfDoc.contentsPage(doc, { intro: `Prepared for ${company}. Sections 1 to 3 cover the work and the amount due; section 4 is where you accept it.` });

  // --- 1 The work ---
  newPage();
  pdfDoc.section(doc, 1, 'The work');
  toc.add(1, 'The work', 'What you asked us to fix.');
  pdfDoc.para(doc, project.reviewed_scope_summary || project.details || 'As described in your support request.');

  // --- 2 Time logged ---
  pdfDoc.section(doc, 2, 'Time logged', { keep: 110 });
  toc.add(2, 'Time logged', 'Every session we worked, by day and time.');
  if (bill.entries.length === 0) {
    pdfDoc.para(doc, 'No time entries were logged on this ticket.', { color: C.MUTED });
  } else {
    // Day-by-day timeline, 08:00-18:00 like the web page, widened (in 2-hour steps) so an early
    // start or a late finish is drawn in full rather than cut off at the edge
    const first = Math.min(...bill.entries.map((e) => toMinutes(e.start)));
    const lastEnd = Math.max(...bill.entries.map((e) => toMinutes(e.end)));
    const axisStart = Math.max(0, Math.min(AXIS_START, AXIS_START - 2 * Math.ceil((AXIS_START * 60 - first) / 120)));
    const axisEnd = Math.min(24, Math.max(AXIS_END, AXIS_END + 2 * Math.ceil((lastEnd - AXIS_END * 60) / 120)));
    const labelW = 78;
    const trackX = L + labelW;
    const trackW = W - labelW;
    const span = (axisEnd - axisStart) * 60;
    const xFor = (min) => trackX + (Math.min(Math.max(min - axisStart * 60, 0), span) / span) * trackW;
    const axis = () => { // hour marks above the tracks, repeated on each page the timeline runs onto
      const y = doc.y;
      doc.font(MONO).fontSize(7).fillColor(C.SOFT);
      for (let h = axisStart; h <= axisEnd; h += 2) {
        const last = h === axisEnd; // ends at the margin instead of running past it
        doc.text(`${String(h).padStart(2, '0')}:00`, xFor(h * 60) - (last ? 28 : 14), y, { width: 28, align: last ? 'right' : 'center', lineBreak: false });
      }
      doc.y = y + 14;
    };
    const byDay = {};
    bill.entries.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    axis();
    Object.keys(byDay).sort().forEach((day) => {
      if (doc.y + 22 > bottom()) { newPage(); axis(); }
      const y = doc.y;
      doc.font(MONO).fontSize(8.5).fillColor(C.INK).text(dayLabel(day), L, y + 4, { width: labelW - 6, lineBreak: false });
      doc.roundedRect(trackX, y, trackW, 16, 3).fill(C.CREAM);
      byDay[day].forEach((e) => {
        const x1 = xFor(toMinutes(e.start));
        const x2 = Math.max(xFor(toMinutes(e.end)), x1 + 3);
        doc.roundedRect(x1, y + 2, x2 - x1, 12, 2).fill(C.GREEN);
        const text = `${e.start}–${e.end}`;
        doc.font(MONO).fontSize(6.5);
        if (x2 - x1 > doc.widthOfString(text) + 6) {
          doc.fillColor('#FFFFFF').text(text, x1, y + 5, { width: x2 - x1, align: 'center', lineBreak: false });
        }
      });
      doc.y = y + 22;
    });
    doc.y += 12;

    // Every entry, in the invoice's table style
    const cols = [
      { label: 'Date', w: 92 },
      { label: 'Time', w: 92 },
      { label: 'Duration', w: 66 },
      { label: 'Notes', w: W - 250 },
    ];
    const header = () => {
      const y = doc.y;
      doc.rect(L, y, W, 20).fill(C.CREAM);
      let x = L + 8;
      cols.forEach((col) => { pdfDoc.label(doc, col.label, x, y + 7, { width: col.w - 12 }); x += col.w; });
      doc.y = y + 26;
    };
    if (doc.y + 60 > bottom()) newPage(); // header + room for two rows, never stranded alone
    header();
    bill.entries.forEach((e) => {
      const note = e.note || '';
      doc.font(SANS).fontSize(9.5);
      const h = Math.max(14, doc.heightOfString(note || '-', { width: cols[3].w - 12 }));
      if (doc.y + h + 8 > bottom()) { newPage(); header(); }
      const y = doc.y;
      const vals = [fmtDate(e.date), `${e.start} – ${e.end}`, fmtDuration(e.minutes), note || '-'];
      let x = L + 8;
      vals.forEach((v, i) => {
        doc.font(i === 3 ? SANS : MONO).fontSize(i === 3 ? 9.5 : 9).fillColor(i === 3 && !note ? C.SOFT : C.INK)
          .text(v, x, y, { width: cols[i].w - 12, lineBreak: i === 3 });
        x += cols[i].w;
      });
      doc.y = y + h + 8;
      doc.moveTo(L, doc.y - 4).lineTo(L + W, doc.y - 4).lineWidth(0.4).strokeColor(C.LINE).stroke();
    });
    doc.y += 4;
  }

  // --- 3 Amount due ---
  pdfDoc.section(doc, 3, 'Amount due', { keep: 220 }); // the hours, table and totals stay together
  toc.add(3, 'Amount due', 'Hours billed, the hourly rate, VAT and the total due.');
  pdfDoc.para(doc, bill.usedEstimate
    ? 'No time was logged on this ticket, so the approved estimate is billed.'
    : 'We bill the time actually logged (section 2), at the hourly rate in the estimate you approved.');
  const loggedMin = bill.entries.reduce((s, e) => s + e.minutes, 0);
  pdfDoc.facts(doc, [
    ['Approved estimate', fmtHours(bill.estimatedHours)],
    ['Time logged', !loggedMin ? 'None' : loggedMin % 60 ? `${fmtHours(bill.loggedHours)} (${fmtDuration(loggedMin)})` : fmtHours(bill.loggedHours)],
  ]);
  pdfDoc.priceRows(doc, {
    rows: [{
      description: `Support work: ${title}${bill.usedEstimate ? ' (approved estimate)' : ''}`,
      qty: bill.billableHours, unit: bill.rate, amount: bill.subtotal,
    }],
    subtotal: bill.subtotal, vat: bill.vatApplies ? bill.vat : null, vatRate: bill.vatApplies ? bill.vatRate : null, total: bill.total,
  }, { labels: { qty: 'Hours', unit: 'Rate / h' }, qtyFmt: fmtHours, totalLabel: 'Total due' });
  pdfDoc.para(doc, 'Prices are in US dollars.', { color: C.MUTED, size: 9 });

  // --- 4 Acceptance ---
  pdfDoc.section(doc, 4, 'Acceptance', { keep: 290 }); // statement and both signature blocks stay together
  toc.add(4, 'Acceptance', `Signatures from ${company} and ${brand} confirming the work is complete.`);
  pdfDoc.para(doc, `By signing below, ${company} confirms that the support work described above has been completed `
    + `to its satisfaction and accepts the time logged and the total due of ${pdfDoc.money(bill.total)}.`);
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

module.exports = { supportBilling, generateSupportSignoffPdf, fmtMoney };
