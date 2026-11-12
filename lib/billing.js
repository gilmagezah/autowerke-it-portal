// Invoices and receipts: suggested lines from what's already agreed, totals (always
// recalculated on the server), and the PDFs in the house style with your signature.
const PDFDocument = require('pdfkit');
const { supportBilling } = require('./supportSignoff');
const { brandName, drawPdfLogo, contactInfo, pdfContactLines } = require('./brand');
const { drawSignature } = require('./signature');

const GREEN = '#2F4A3B';
const CREAM = '#F4F1E8';
const LINE = '#DEDACD';
const INK = '#1F2622';
const MUTED = '#6F6F65';
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vatRate = () => Number(process.env.VAT_RATE || 15.5);
const METHODS = ['Bank transfer', 'EcoCash', 'Cash', 'Card', 'Other'];

// What to bill, from what was already agreed for this request
function suggest(p) {
  const title = p.project_title || p.request_type;
  if (p.request_type === 'IT Support') {
    const b = supportBilling(p);
    return { vat: b.vatApplies, lines: [{ description: `IT support: ${title}`, qty: r2(b.billableHours), unit_price: r2(b.rate) }] };
  }
  if (p.request_type === 'Domains') {
    const q = p.domain_quote;
    if (!q) return { vat: true, lines: [] };
    const lines = q.lines.filter((l) => l.available).map((l) => ({ description: `Domain registration: ${l.domain} (${l.years} year${l.years === 1 ? '' : 's'})`, qty: 1, unit_price: r2(l.price * l.years) }));
    if (q.service_fee) lines.push({ description: 'Domain service fee', qty: 1, unit_price: r2(q.service_fee) });
    return { vat: q.vat_applicable !== false, lines };
  }
  if (p.request_type === 'Consultancy') {
    return { vat: true, lines: Number(p.consult_fee) > 0 ? [{ description: `Consultancy: ${title}`, qty: 1, unit_price: r2(p.consult_fee) }] : [] };
  }
  const v = Number(p.contract_value);
  return { vat: p.vat_applicable !== false, lines: Number.isFinite(v) && v > 0 ? [{ description: `IT project: ${title}`, qty: 1, unit_price: r2(v) }] : [] };
}

function cleanLines(input) {
  const lines = (Array.isArray(input) ? input : []).slice(0, 30).map((l) => ({
    description: String((l && l.description) || '').trim().slice(0, 200),
    qty: r2(Number(l && l.qty) || 0),
    unit_price: r2(Number(String((l && l.unit_price) ?? '').replace(/[,\s$]/g, '')) || 0),
  })).filter((l) => l.description && l.qty > 0);
  if (!lines.length) throw new Error('Add at least one line with a description and quantity.');
  if (lines.some((l) => l.unit_price < 0 || l.qty > 100000 || l.unit_price > 10000000)) throw new Error('Check the quantities and prices.');
  return lines;
}

function totals(lines, vatApplicable) {
  const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
  const rate = vatApplicable ? vatRate() : 0;
  const vat = r2((subtotal * rate) / 100);
  return { subtotal, vat_rate: rate, vat, total: r2(subtotal + vat) };
}

const fmtDate = (d) => {
  if (!d) return '';
  const x = new Date(String(d).length === 10 ? `${d}T12:00:00Z` : d);
  return `${x.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

// ---------- Shared PDF frame ----------
function frame(title, number, metaRows) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 }, info: { Title: `${title} ${number}`, Author: brandName() } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const L = 50;
  const W = doc.page.width - 100;
  const c = contactInfo();
  const logoH = drawPdfLogo(doc, L, 44, 140);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(pdfContactLines(c), L, 42, { width: W, align: 'right' });
  let y = 44 + logoH + 22;
  doc.roundedRect(L, y, W, 64, 6).fill(GREEN);
  doc.font('Courier-Bold').fontSize(20).fillColor(CREAM).text(title.toUpperCase(), L + 16, y + 14, { characterSpacing: 1 });
  doc.font('Courier').fontSize(10).fillColor('#B9C7BB').text(number, L + 16, y + 40);
  metaRows.forEach(([label, value], i) => {
    const x = L + W - 16 - (metaRows.length - i) * 120;
    doc.font('Courier').fontSize(7.5).fillColor('#B9C7BB').text(label.toUpperCase(), x, y + 16, { width: 112, align: 'right' });
    doc.font('Courier-Bold').fontSize(11).fillColor(CREAM).text(value, x, y + 30, { width: 112, align: 'right' });
  });
  y += 84;
  const done = () => { doc.end(); return new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks)))); };
  return { doc, L, W, y, done };
}

function billTo(doc, L, y, who) {
  doc.font('Courier-Bold').fontSize(7.5).fillColor(MUTED).text('BILL TO', L, y, { characterSpacing: 0.6 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(who.company, L, y + 12);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text([who.contact_name, who.email, who.ref ? `Reference ${who.ref}` : null].filter(Boolean).join('\n'), L, doc.y + 2);
  return doc.y + 18;
}

// ---------- Invoice ----------
async function invoicePdf(inv) {
  const { doc, L, W, y: y0, done } = frame('Invoice', inv.number, [['Issued', fmtDate(inv.issued_at)], ['Due', fmtDate(inv.due_date) || 'On receipt'], ['Total', money(inv.total)]]);
  let y = billTo(doc, L, y0, inv);

  // Lines
  const cols = [{ k: 'description', w: W * 0.55, label: 'Description' }, { k: 'qty', w: W * 0.12, label: 'Qty', r: true }, { k: 'unit_price', w: W * 0.16, label: 'Unit price', r: true }, { k: 'amount', w: W * 0.17, label: 'Amount', r: true }];
  doc.rect(L, y, W, 20).fill(CREAM);
  let x = L + 8;
  cols.forEach((c) => { doc.font('Courier-Bold').fontSize(7.5).fillColor(MUTED).text(c.label.toUpperCase(), x, y + 7, { width: c.w - 16, align: c.r ? 'right' : 'left' }); x += c.w; });
  y += 26;
  inv.lines.forEach((l) => {
    const row = { description: l.description, qty: String(l.qty), unit_price: money(l.unit_price), amount: money(l.qty * l.unit_price) };
    const h = Math.max(14, doc.font('Helvetica').fontSize(10).heightOfString(l.description, { width: cols[0].w - 16 }));
    x = L + 8;
    cols.forEach((c) => { doc.font(c.k === 'amount' ? 'Courier-Bold' : (c.r ? 'Courier' : 'Helvetica')).fontSize(10).fillColor(INK).text(row[c.k], x, y, { width: c.w - 16, align: c.r ? 'right' : 'left' }); x += c.w; });
    y += h + 8;
    doc.moveTo(L, y - 4).lineTo(L + W, y - 4).lineWidth(0.4).strokeColor(LINE).stroke();
  });

  // Totals: label and amount share one baseline; every row's height is fixed so nothing
  // depends on where pdfkit's cursor ended up
  const bottom = doc.page.height - doc.page.margins.bottom;
  const room = (h) => { if (y + h > bottom) { doc.addPage(); y = doc.page.margins.top; } };
  room(90);
  y += 6;
  const tx = L + W - 240;
  const trow = (label, value, bold) => {
    doc.font(bold ? 'Courier-Bold' : 'Courier').fontSize(bold ? 12 : 10).fillColor(INK);
    doc.text(label, tx, y, { width: 130, lineBreak: false });
    doc.text(value, tx + 130, y, { width: 110, align: 'right', lineBreak: false });
    y += bold ? 18 : 16;
  };
  trow('Subtotal', money(inv.subtotal));
  if (Number(inv.vat) > 0) trow(`VAT (${inv.vat_rate}%)`, money(inv.vat));
  y += 2;
  doc.moveTo(tx, y).lineTo(L + W, y).lineWidth(1.5).strokeColor(GREEN).stroke();
  y += 8;
  trow(`Total (${inv.currency || 'USD'})`, money(inv.total), true);

  // How to pay: details and the payment reference sit inside one box, measured in the
  // font they're drawn in
  y += 18;
  const pad = 14;
  const inner = W - pad * 2;
  // One detail per line: split on new lines and on " · " separators, so
  // "Bank: X · Account name: Y · Account: Z" prints as three tidy lines
  const pay = String(process.env.INVOICE_PAYMENT_DETAILS || '').replace(/\\n/g, '\n')
    .split(/\n|\s+·\s+/).map((x) => x.trim()).filter(Boolean).join('\n')
    || `Please contact ${contactInfo().email} for payment details.`;
  const refLine = `Payment reference: ${inv.number}`;
  doc.font('Helvetica').fontSize(9.5);
  const payH = doc.heightOfString(pay, { width: inner });
  doc.font('Helvetica-Bold').fontSize(9.5);
  const refH = doc.heightOfString(refLine, { width: inner });
  const boxH = pad + 10 + 6 + payH + 6 + refH + pad;
  room(boxH);
  doc.roundedRect(L, y, W, boxH, 6).fill(CREAM);
  doc.font('Courier-Bold').fontSize(7.5).fillColor(MUTED).text('HOW TO PAY', L + pad, y + pad, { characterSpacing: 0.6, lineBreak: false });
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(pay, L + pad, y + pad + 16, { width: inner });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN).text(refLine, L + pad, y + pad + 16 + payH + 6, { width: inner });
  y += boxH;

  // Notes, lined up with the box's text
  if (inv.notes) {
    y += 16;
    doc.font('Helvetica').fontSize(9.5);
    const notesH = doc.heightOfString(inv.notes, { width: inner });
    room(16 + notesH);
    doc.font('Courier-Bold').fontSize(7.5).fillColor(MUTED).text('NOTES', L + pad, y, { characterSpacing: 0.6, lineBreak: false });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(inv.notes, L + pad, y + 14, { width: inner });
    y += 14 + notesH;
  }

  y += 30;
  room(100);
  drawSignature(doc, L + pad, y, { brand: brandName(), date: fmtDate(inv.issued_at) });
  return done();
}

// ---------- Receipt ----------
async function receiptPdf(rc, inv) {
  const { doc, L, W, y: y0, done } = frame('Receipt', rc.number, [['Received', fmtDate(rc.received_on)], ['Method', rc.method || '-'], ['Amount', money(rc.amount)]]);
  let y = billTo(doc, L, y0, { company: rc.company, contact_name: inv && inv.contact_name, email: rc.email, ref: rc.ref });
  doc.roundedRect(L, y, W, 96, 8).fill(GREEN);
  doc.font('Courier').fontSize(9).fillColor('#B9C7BB').text('PAYMENT RECEIVED  ·  THANK YOU', L + 18, y + 16, { characterSpacing: 1 });
  doc.font('Courier-Bold').fontSize(30).fillColor(CREAM).text(money(rc.amount), L + 18, y + 34);
  doc.font('Courier').fontSize(9.5).fillColor('#B9C7BB').text(
    [inv ? `For invoice ${inv.number}` : null, rc.reference ? `Payment reference ${rc.reference}` : null].filter(Boolean).join('   ·   '), L + 18, y + 72, { width: W - 36 });
  y += 116;
  if (inv) {
    const balance = r2(Number(inv.total) - Number(rc.amount));
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(
      balance > 0.005 ? `Invoice total ${money(inv.total)}. Balance outstanding: ${money(balance)}.` : `Invoice ${inv.number} (${money(inv.total)}) is now paid in full.`, L, y, { width: W });
    y = doc.y + 24;
  }
  drawSignature(doc, L, y, { brand: brandName(), date: fmtDate(rc.received_on) });
  return done();
}

module.exports = { suggest, cleanLines, totals, invoicePdf, receiptPdf, METHODS, fmtDate, money };
