// Shared layout for the client documents: a cover page ("homepage"), a contents page, and the
// header + footer on every inner page. The house style stays in the background: racing green
// only as thin accents (a short rule, section numbers, labels), typewriter type for labels and
// numbers, plain sans for reading text. Pricing blocks follow the invoice (lib/billing.js).
//
// Use with a PDFDocument created with bufferPages: true:
//   cover(doc, {...})            draws page 1
//   const toc = contentsPage(doc) adds page 2 (filled in later)
//   ... sections, each recorded with toc.add(num, title, blurb) on the page it starts ...
//   toc.fill(); chrome(doc, {...}) once everything is drawn (page numbers are known by then)
const { brandName, drawPdfLogo, contactInfo, pdfContactLines } = require('./brand');

const C = { GREEN: '#2F4A3B', CREAM: '#F4F1E8', LINE: '#DEDACD', INK: '#1F2622', MUTED: '#6F6F65', SOFT: '#9A9A8E' };
const MONO = 'Courier';
const MONO_B = 'Courier-Bold';
const SANS = 'Helvetica';
const SANS_B = 'Helvetica-Bold';

const box = (doc) => {
  const L = doc.page.margins.left;
  return { L, W: doc.page.width - L - doc.page.margins.right, H: doc.page.height };
};

// Small typewriter label, e.g. PREPARED FOR
const label = (doc, text, x, y, opts = {}) => doc.font(MONO_B).fontSize(7.5).fillColor(opts.color || C.MUTED)
  .text(String(text).toUpperCase(), x, y, { characterSpacing: 0.8, lineBreak: false, ...opts });

// Cuts text to fit one line at the current font
function fit(doc, text, maxW) {
  let s = String(text || '');
  if (doc.widthOfString(s) <= maxW) return s;
  while (s.length > 1 && doc.widthOfString(`${s}…`) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// ---------- Cover ----------
// kind: "Project sign-off"; title; client: company name;
// description: what this document is and what the reader needs to do (a short paragraph);
// facts: [[label, value], ...] shown as a grid (2 per row); status: optional small note under it
function cover(doc, { kind, title, client, description, facts = [], note }) {
  const { L, W, H } = box(doc);
  const c = contactInfo();
  const top = 56;

  // Header: logo + contact, as on the invoice
  drawPdfLogo(doc, L, top, 150);
  doc.font(SANS).fontSize(8.5).fillColor(C.MUTED).text(pdfContactLines(c), L, top - 2, { width: W, align: 'right', lineGap: 1 });

  // The cover is always one page: nothing here may trigger pdfkit's automatic page break
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  // Title block, a third of the way down. Long titles get a smaller size and start higher.
  const titleW = W * 0.86;
  let size = 28;
  doc.font(SANS_B).fontSize(size);
  if (doc.heightOfString(title, { width: titleW, lineGap: 2 }) > 3 * 36) size = 21;
  doc.fontSize(size);
  const long = doc.heightOfString(title, { width: titleW, lineGap: 2 }) > 2 * 36;
  let y = long ? 160 : 210;
  doc.rect(L, y, 28, 3).fill(C.GREEN); // the one bold accent on the page
  y += 16;
  label(doc, kind, L, y, { color: C.GREEN });
  y += 20;
  doc.font(SANS_B).fontSize(size).fillColor(C.INK).text(title, L, y, { width: titleW, lineGap: 2 });
  y = doc.y + 8;
  if (client) {
    doc.font(SANS).fontSize(13).fillColor(C.MUTED).text(`for ${client}`, L, y, { width: W * 0.86 });
    y = doc.y;
  }

  // About this document
  if (description) {
    y += 34;
    label(doc, 'About this document', L, y);
    y += 16;
    doc.font(SANS).fontSize(10.5).fillColor(C.INK).text(description, L, y, { width: W * 0.78, lineGap: 3.5 });
    y = doc.y;
  }

  // Key facts: label over value, two columns, hairlines between rows
  y += 34;
  const colW = W / 2;
  for (let i = 0; i < facts.length; i += 2) {
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.LINE).stroke();
    let rowH = 0;
    facts.slice(i, i + 2).forEach(([k, v], j) => {
      const x = L + j * colW;
      label(doc, k, x, y + 11);
      doc.font(SANS).fontSize(10.5).fillColor(C.INK).text(String(v || '-'), x, y + 25, { width: colW - 20 });
      rowH = Math.max(rowH, doc.y - y);
    });
    y += rowH + 12;
  }
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.LINE).stroke();
  const fy = H - 58;
  if (note) {
    doc.font(SANS).fontSize(9);
    if (y + 14 + doc.heightOfString(note, { width: W * 0.78, lineGap: 2 }) < fy - 10) { // skipped if it can't fit
      doc.fillColor(C.MUTED).text(note, L, y + 14, { width: W * 0.78, lineGap: 2 });
    }
  }

  // Foot of the cover: brand line, quiet
  doc.moveTo(L, fy).lineTo(L + W, fy).lineWidth(0.5).strokeColor(C.LINE).stroke();
  doc.font(MONO).fontSize(7.5).fillColor(C.SOFT).text(`${brandName().toUpperCase()}  ·  ${c.tagline.toUpperCase()}`, L, fy + 10, { width: W, characterSpacing: 0.4, lineBreak: false });
  doc.page.margins.bottom = bottom;
}

// ---------- Contents ----------
// Adds the contents page now; sections register with add() as they start; fill() draws the list.
function contentsPage(doc, { intro } = {}) {
  doc.addPage();
  const page = doc.bufferedPageRange().count - 1;
  const entries = [];
  return {
    page,
    add(num, title, blurb) {
      const r = doc.bufferedPageRange();
      entries.push({ num: String(num), title, blurb, page: r.start + r.count - 1 });
    },
    fill(pageLabel) {
      doc.switchToPage(page);
      const { L, W } = box(doc);
      let y = doc.page.margins.top + 30;
      doc.rect(L, y, 28, 3).fill(C.GREEN);
      y += 16;
      label(doc, 'Contents', L, y, { color: C.GREEN });
      y += 20;
      doc.font(SANS_B).fontSize(20).fillColor(C.INK).text('In this document', L, y);
      y = doc.y + 6;
      if (intro) { doc.font(SANS).fontSize(10).fillColor(C.MUTED).text(intro, L, y, { width: W * 0.78, lineGap: 2.5 }); y = doc.y; }
      y += 26;
      entries.forEach((e) => {
        const pg = pageLabel(e.page);
        doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.LINE).stroke();
        y += 14;
        doc.font(MONO_B).fontSize(11).fillColor(C.GREEN).text(e.num.padStart(2, '0'), L, y, { lineBreak: false });
        doc.font(SANS_B).fontSize(12).fillColor(C.INK).text(e.title, L + 40, y - 1, { width: W - 120, lineBreak: false });
        doc.font(MONO).fontSize(10).fillColor(C.MUTED).text(`p. ${pg}`, L + W - 60, y, { width: 60, align: 'right', lineBreak: false });
        let h = 16;
        if (e.blurb) {
          doc.font(SANS).fontSize(9.5).fillColor(C.MUTED).text(e.blurb, L + 40, y + 18, { width: W - 140, lineGap: 1.5 });
          h = doc.y - y + 2;
        }
        y += h + 12;
      });
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.LINE).stroke();
    },
  };
}

// ---------- Header + footer on every page after the cover ----------
// Page numbers count the cover as page 1, so "Page 3 of 5" matches the PDF viewer.
function chrome(doc, { title, ref }) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const brand = brandName();
  for (let i = range.start + 1; i < range.start + total; i++) {
    doc.switchToPage(i);
    const { L, W, H } = box(doc);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin would otherwise add a page
    // Header: small logo left, reference right, hairline with a short green lead
    drawPdfLogo(doc, L, 26, 84);
    if (ref) doc.font(MONO).fontSize(8).fillColor(C.MUTED).text(ref, L, 29, { width: W, align: 'right', lineBreak: false });
    doc.moveTo(L, 46).lineTo(L + W, 46).lineWidth(0.5).strokeColor(C.LINE).stroke();
    doc.rect(L, 45.25, 28, 1.5).fill(C.GREEN);
    // Footer
    const fy = H - 40;
    doc.moveTo(L, fy - 8).lineTo(L + W, fy - 8).lineWidth(0.5).strokeColor(C.LINE).stroke();
    doc.font(SANS).fontSize(8).fillColor(C.MUTED);
    doc.text(fit(doc, `${brand}  ·  ${title}`, W - 90), L, fy, { lineBreak: false });
    doc.font(MONO).fontSize(8).fillColor(C.MUTED).text(`Page ${i - range.start + 1} of ${total}`, L + W - 90, fy, { width: 90, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

const pageNumber = (doc) => (idx) => String(idx - doc.bufferedPageRange().start + 1);

// ---------- Body building blocks (sections flow on, no page per section) ----------
const BODY_TOP = 74; // below the header rule

// Start a new page if fewer than h points are left
function ensure(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); doc.y = BODY_TOP; }
}

// "01  Scope of work" with a hairline: green typewriter number, plain bold title
// keep: how much of what follows must sit on the same page as the heading (default: a few lines)
function section(doc, num, title, { keep = 70 } = {}) {
  const { L, W } = box(doc);
  if (doc.y > BODY_TOP + 1) doc.y += 22;
  ensure(doc, 40 + keep);
  const y = Math.max(doc.y, BODY_TOP);
  doc.font(MONO_B).fontSize(11).fillColor(C.GREEN).text(String(num).padStart(2, '0'), L, y + 2, { lineBreak: false });
  doc.font(SANS_B).fontSize(15).fillColor(C.INK).text(title, L + 40, y, { width: W - 40 });
  const ry = doc.y + 6;
  doc.moveTo(L, ry).lineTo(L + W, ry).lineWidth(0.5).strokeColor(C.LINE).stroke();
  doc.y = ry + 14;
}

// Smaller heading inside a section
function subhead(doc, text) {
  ensure(doc, 50);
  const { L } = box(doc);
  label(doc, text, L, doc.y);
  doc.y += 15;
}

function para(doc, text, { color = C.INK, size = 10.5 } = {}) {
  const { L, W } = box(doc);
  doc.font(SANS).fontSize(size).fillColor(color).text(String(text || ''), L, doc.y, { width: W, lineGap: 3 });
  doc.y += 8;
}

// Numbered list with small green typewriter numbers (or dashes when numbered is false)
function list(doc, items, { numbered = true } = {}) {
  const { L, W } = box(doc);
  items.forEach((item, i) => {
    doc.font(SANS).fontSize(10.5);
    ensure(doc, doc.heightOfString(item, { width: W - 34, lineGap: 2 }) + 8);
    const y = doc.y;
    doc.font(MONO_B).fontSize(9).fillColor(numbered ? C.GREEN : C.MUTED).text(numbered ? String(i + 1).padStart(2, '0') : '-', L, y + 1.5, { lineBreak: false });
    doc.font(SANS).fontSize(10.5).fillColor(C.INK).text(item, L + 34, y, { width: W - 34, lineGap: 2 });
    doc.y += 6;
  });
  doc.y += 4;
}

// ---------- Prices, in the invoice's style ----------
const NUM = '([\\d,]+(?:\\.\\d{1,2})?)';
const toNum = (s) => Number(String(s).replace(/,/g, ''));
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,:;=–-]+|[\s,:;=–-]+$/g, '').trim();

// Reads the pricing the admin typed ("one item per line", e.g. "50 devices x $20 = $1000",
// "Setup = $300", "VAT 15.5%", "Total = $1155") into rows + totals. Anything that isn't a price
// line (payment terms, notes) is kept, word for word, as notes. Nothing is invented: a line we
// can't read is shown as written.
function parsePricing(text) {
  const rows = []; const notes = []; const out = { rows, notes, subtotal: null, vat: null, vatRate: null, total: null };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const amountAtEnd = line.match(new RegExp(`=\\s*\\$\\s?${NUM}\\s*$`));
    const lead = line.replace(new RegExp(`\\s*=\\s*\\$\\s?${NUM}\\s*$`), '');
    // Totals and VAT, as written
    if (/^(sub-?total)\b/i.test(lead) && (amountAtEnd || /\$/.test(lead))) {
      const m = amountAtEnd || lead.match(new RegExp(`\\$\\s?${NUM}`)); out.subtotal = toNum(m[1]); continue;
    }
    if (/^(grand\s+)?total\b/i.test(lead) && (amountAtEnd || /\$/.test(lead))) {
      const m = amountAtEnd || lead.match(new RegExp(`\\$\\s?${NUM}`)); out.total = toNum(m[1]); continue;
    }
    if (/^vat\b/i.test(lead)) {
      const pct = lead.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
      const amt = amountAtEnd || lead.match(new RegExp(`\\$\\s?${NUM}`));
      if (pct || amt) { if (pct) out.vatRate = Number(pct[1]); if (amt) out.vat = toNum(amt[1]); continue; }
    }
    // "50 devices x $20 = $1000"
    let m = lead.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s+(.+?)\\s*(?:x|×|\\*)\\s*\\$\\s?${NUM}(.*)$`, 'i'));
    if (m) { const qty = Number(m[1]); const unit = toNum(m[3]); const d = tidy(`${m[2]} ${tidy(m[4])}`); rows.push({ description: d.charAt(0).toUpperCase() + d.slice(1), qty, unit, amount: amountAtEnd ? toNum(amountAtEnd[1]) : qty * unit }); continue; }
    // "Staff training, 2 x $270 = $540"
    m = lead.match(new RegExp(`^(.+?)[\\s,:(–-]*(\\d+(?:\\.\\d+)?)\\s*(?:x|×|\\*)\\s*\\$\\s?${NUM}\\)?(.*)$`, 'i'));
    if (m) { const qty = Number(m[2]); const unit = toNum(m[3]); rows.push({ description: tidy(`${m[1]} ${tidy(m[4])}`), qty, unit, amount: amountAtEnd ? toNum(amountAtEnd[1]) : qty * unit }); continue; }
    // "Setup = $300", "Setup: $300", "Setup - $300 (once-off)"
    m = line.match(new RegExp(`^(.+?)\\s*(?:=|:|–|-)\\s*\\$\\s?${NUM}\\s*(.*)$`));
    if (m && !/\$/.test(m[1])) { const extra = tidy(m[3]).replace(/^\((.*)\)$/, '$1'); rows.push({ description: tidy(m[1]) + (extra ? ` (${extra})` : ''), qty: null, unit: null, amount: toNum(m[2]) }); continue; }
    notes.push(line);
  }
  return out;
}

// Draws the parsed pricing like the invoice: a lines table, then subtotal / VAT / total on the
// right, then notes in a cream box. With no readable price lines, the text goes in the box as is.
function priceTable(doc, text, { notesLabel = 'Payment terms and notes' } = {}) {
  const p = parsePricing(text);
  if (p.rows.length) priceRows(doc, p);
  const noteText = p.rows.length ? p.notes.join('\n') : String(text || '').trim();
  if (noteText) noteBox(doc, p.rows.length ? notesLabel : 'Price', noteText);
  return p;
}

// The invoice-style table + totals for rows already worked out.
// rows: [{ description, qty, unit, amount }] (qty/unit null for a fixed amount).
// subtotal / vat / total: as stated (null = worked out); vatRate shows in the VAT label.
// labels: column names for qty and unit (e.g. Hours, Rate); qtyFmt: how a quantity is shown.
function priceRows(doc, { rows, subtotal: sub = null, vat: v = null, vatRate = null, total: tot = null }, { labels = {}, qtyFmt = String, totalLabel = 'Total (USD)' } = {}) {
  const { L, W } = box(doc);
  const p = { rows };
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const room = (h) => { if (doc.y + h > bottom()) { doc.addPage(); doc.y = BODY_TOP; } };
  {
    const hasQty = p.rows.some((r) => r.qty !== null);
    const cols = hasQty
      ? [{ k: 'description', w: W * 0.55, label: 'Description' }, { k: 'qty', w: W * 0.12, label: labels.qty || 'Qty', r: true }, { k: 'unit', w: W * 0.16, label: labels.unit || 'Unit price', r: true }, { k: 'amount', w: W * 0.17, label: 'Amount', r: true }]
      : [{ k: 'description', w: W * 0.75, label: 'Description' }, { k: 'amount', w: W * 0.25, label: 'Amount', r: true }];
    room(60);
    let y = doc.y;
    let x;
    const header = () => { // repeated at the top of each page the table runs onto
      doc.rect(L, y, W, 20).fill(C.CREAM);
      x = L + 8;
      cols.forEach((c) => { doc.font(MONO_B).fontSize(7.5).fillColor(C.MUTED).text(c.label.toUpperCase(), x, y + 7, { width: c.w - 16, align: c.r ? 'right' : 'left', lineBreak: false }); x += c.w; });
      y += 26;
    };
    header();
    p.rows.forEach((r) => {
      const cell = { description: r.description, qty: r.qty === null ? '' : qtyFmt(r.qty), unit: r.unit === null ? '' : money(r.unit), amount: money(r.amount) };
      const h = Math.max(14, doc.font(SANS).fontSize(10).heightOfString(r.description, { width: cols[0].w - 16 }));
      if (y + h + 8 > bottom()) { doc.addPage(); y = BODY_TOP; header(); }
      x = L + 8;
      cols.forEach((c) => { doc.font(c.k === 'amount' ? MONO_B : (c.r ? MONO : SANS)).fontSize(10).fillColor(C.INK).text(cell[c.k], x, y, { width: c.w - 16, align: c.r ? 'right' : 'left' }); x += c.w; });
      y += h + 8;
      doc.moveTo(L, y - 4).lineTo(L + W, y - 4).lineWidth(0.4).strokeColor(C.LINE).stroke();
    });
    // Totals: as written; a missing subtotal or total is worked out from the lines
    const sum = Math.round(p.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const subtotal = sub ?? sum;
    const vat = v ?? (vatRate ? Math.round(subtotal * vatRate) / 100 : null);
    const total = tot ?? Math.round((subtotal + (vat || 0)) * 100) / 100;
    doc.y = y; room(80); y = doc.y + 6;
    const tx = L + W - 240;
    const trow = (lbl, value, bold) => {
      doc.font(bold ? MONO_B : MONO).fontSize(bold ? 12 : 10).fillColor(C.INK);
      doc.text(lbl, tx, y, { width: 130, lineBreak: false });
      doc.text(value, tx + 130, y, { width: 110, align: 'right', lineBreak: false });
      y += bold ? 18 : 16;
    };
    if (vat !== null || sub !== null) trow('Subtotal', money(subtotal));
    if (vat !== null) trow(`VAT${vatRate ? ` (${vatRate}%)` : ''}`, money(vat));
    y += 2;
    doc.moveTo(tx, y).lineTo(L + W, y).lineWidth(1.5).strokeColor(C.GREEN).stroke();
    y += 8;
    trow(totalLabel, money(total), true);
    doc.y = y + 10;
    return { subtotal, vat, total };
  }
}

// A cream box with a small label, as the invoice's "How to pay"
function noteBox(doc, title, text) {
  const { L, W } = box(doc);
  const pad = 14; const inner = W - pad * 2;
  doc.font(SANS).fontSize(9.5);
  const h = doc.heightOfString(text, { width: inner, lineGap: 2 });
  ensure(doc, h + pad * 2 + 24);
  const y = doc.y + 6;
  doc.roundedRect(L, y, W, h + pad * 2 + 16, 6).fill(C.CREAM);
  label(doc, title, L + pad, y + pad);
  doc.font(SANS).fontSize(9.5).fillColor(C.INK).text(text, L + pad, y + pad + 16, { width: inner, lineGap: 2 });
  doc.y = y + h + pad * 2 + 16 + 8;
}

// Label / value pairs in two columns with hairlines (like the cover's key facts, smaller)
function facts(doc, pairs) {
  const { L, W } = box(doc);
  const colW = W / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    doc.font(SANS).fontSize(10);
    const rowH = Math.max(...pairs.slice(i, i + 2).map(([, v]) => doc.heightOfString(String(v || '-'), { width: colW - 20 }))) + 32;
    ensure(doc, rowH);
    const y = doc.y;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.LINE).stroke();
    pairs.slice(i, i + 2).forEach(([k, v], j) => {
      label(doc, k, L + j * colW, y + 9);
      doc.font(SANS).fontSize(10).fillColor(C.INK).text(String(v || '-'), L + j * colW, y + 22, { width: colW - 20 });
    });
    doc.y = y + rowH;
  }
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.5).strokeColor(C.LINE).stroke();
  doc.y += 12;
}

// ---------- Two signature columns ----------
// parties: [{ heading, name, title, image }] - blank fields get a dotted line to fill in
function signatures(doc, parties) {
  const { L, W } = box(doc);
  ensure(doc, 190);
  const colW = (W - 30) / 2;
  const top = doc.y + 4;
  let maxY = top;
  // Fields line up across the columns even when one heading wraps onto two lines
  doc.font(SANS_B).fontSize(10.5);
  const headH = Math.max(...parties.map((pt) => doc.heightOfString(pt.heading, { width: colW })));
  parties.forEach((pt, i) => {
    const x = L + i * (colW + 30);
    let y = top;
    doc.rect(x, y, 28, 2).fill(C.GREEN);
    y += 10;
    doc.font(SANS_B).fontSize(10.5).fillColor(C.INK).text(pt.heading, x, y, { width: colW });
    y += headH + 10;
    [['Name', pt.name], ['Title', pt.title], ['Signature', null, pt.image], ['Date', pt.date]].forEach(([k, v, img]) => {
      label(doc, k, x, y);
      const lineY = y + (k === 'Signature' ? 46 : 26);
      if (img) { try { doc.image(img, x, y + 10, { fit: [colW * 0.7, 34], valign: 'bottom' }); } catch { /* leave the line */ } }
      if (v) doc.font(SANS).fontSize(10.5).fillColor(C.INK).text(v, x, lineY - 14, { width: colW, lineBreak: false });
      doc.save().moveTo(x, lineY).lineTo(x + colW, lineY).dash(1, { space: 2 }).lineWidth(0.6).strokeColor(C.SOFT).stroke().restore();
      y = lineY + 12;
    });
    maxY = Math.max(maxY, y);
  });
  doc.y = maxY + 6;
}

module.exports = { C, MONO, MONO_B, SANS, SANS_B, BODY_TOP, cover, contentsPage, chrome, label, fit, pageNumber, ensure, section, subhead, para, list, parsePricing, priceTable, priceRows, noteBox, facts, signatures, money };
