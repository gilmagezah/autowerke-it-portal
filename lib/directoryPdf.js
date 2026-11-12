// Client directory as a PDF, in the house style: racing green, paper cream, typewriter type.
// PDF has a built-in Courier, so the typewriter look carries over with no font files.
const PDFDocument = require('pdfkit');
const { brandName, drawPdfLogo, contactInfo, pdfContactLines } = require('./brand');

const GREEN = '#2F4A3B';
const CREAM = '#F4F1E8';
const LINE = '#DEDACD';
const INK = '#1F2622';
const MUTED = '#6F6F65';
const MONO = 'Courier';
const MONO_B = 'Courier-Bold';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

function generateDirectoryPdf(companies, { title = 'Client directory', date = new Date() } = {}) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 55, left: 46, right: 46 }, bufferPages: true, info: { Title: title, Author: brandName() } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // ---- header + green band ----
  const logoH = drawPdfLogo(doc, L, 40, 140);
  const c = contactInfo();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(pdfContactLines(c), L, 36, { width: W, align: 'right' });
  let y = 40 + logoH + 18;
  const people = companies.reduce((n, x) => n + x.people.length, 0);
  const requests = companies.reduce((n, x) => n + x.requests.length, 0);
  doc.roundedRect(L, y, W, 62, 6).fill(GREEN);
  doc.font(MONO_B).fontSize(17).fillColor(CREAM).text(title.toUpperCase(), L + 16, y + 13, { characterSpacing: 1 });
  // Kept short + width-limited so it can never run under the stat columns on the right
  doc.font(MONO).fontSize(8.5).fillColor('#B9C7BB').text(`GENERATED ${short(date.toISOString()).toUpperCase()}  ·  CONFIDENTIAL`, L + 16, y + 38, { width: W - 270, lineBreak: false });
  const stats = [['COMPANIES', companies.length], ['PEOPLE', people], ['REQUESTS', requests]];
  stats.forEach(([label, n], i) => {
    const x = L + W - 16 - (stats.length - i) * 78;
    doc.font(MONO).fontSize(7.5).fillColor('#B9C7BB').text(label, x, y + 14, { width: 72, align: 'right' });
    doc.font(MONO_B).fontSize(16).fillColor(CREAM).text(String(n), x, y + 26, { width: 72, align: 'right' });
  });
  y += 80;

  // ---- table helper ----
  const table = (cols, rows, opts = {}) => {
    const drawHead = () => {
      doc.rect(L, y, W, 17).fill(CREAM);
      let x = L + 8;
      cols.forEach((col) => {
        doc.font(MONO_B).fontSize(7).fillColor(MUTED).text(col.label.toUpperCase(), x, y + 5.5, { width: col.w - 10, lineBreak: false, characterSpacing: 0.6 });
        x += col.w;
      });
      y += 21;
    };
    if (y + 40 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
    drawHead();
    rows.forEach((row) => {
      doc.font(MONO).fontSize(8.5);
      const h = Math.max(12, ...cols.map((col, i) => doc.heightOfString(String(row[i] ?? ''), { width: col.w - 10 })));
      if (y + h + 8 > bottom()) { doc.addPage(); y = doc.page.margins.top; drawHead(); }
      let x = L + 8;
      cols.forEach((col, i) => {
        doc.font(col.bold ? MONO_B : MONO).fontSize(8.5).fillColor(col.color ? col.color(row) : INK).text(String(row[i] ?? ''), x, y, { width: col.w - 10 });
        x += col.w;
      });
      y += h + 6;
      doc.moveTo(L, y - 3).lineTo(L + W, y - 3).lineWidth(0.4).stroke(LINE);
    });
    y += opts.after ?? 10;
  };

  // ---- one section per company ----
  companies.forEach((co) => {
    if (y + 90 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
    doc.roundedRect(L, y, W, 26, 4).fill(GREEN);
    doc.font(MONO_B).fontSize(11.5).fillColor(CREAM).text(co.company, L + 10, y + 8, { width: W - 220, lineBreak: false, ellipsis: true });
    const meta = `${co.people.length} ${co.people.length === 1 ? 'PERSON' : 'PEOPLE'} · ${co.requests.length} REQUEST${co.requests.length === 1 ? '' : 'S'} · ${co.active} ACTIVE${co.domains ? ` · ${co.domains} DOMAIN${co.domains === 1 ? '' : 'S'}` : ''}`;
    doc.font(MONO).fontSize(7.5).fillColor('#B9C7BB').text(meta, L + W - 210, y + 9.5, { width: 200, align: 'right', lineBreak: false });
    y += 34;

    table(
      [{ label: 'Name', w: W * 0.24, bold: true }, { label: 'Role', w: W * 0.2 }, { label: 'Email', w: W * 0.34 }, { label: 'Phone', w: W * 0.22 }],
      co.people.map((p) => [p.name || '-', p.position || '-', p.email || '-', p.phone || '-']),
      { after: 6 }
    );
    table(
      [{ label: 'Ref', w: W * 0.16, bold: true }, { label: 'Type', w: W * 0.14 }, { label: 'Title', w: W * 0.30 },
       { label: 'Status', w: W * 0.25, color: (r) => (r[5] === 'done' ? MUTED : r[5] === 'you' ? '#A06414' : GREEN) }, { label: 'Opened', w: W * 0.15 }],
      co.requests.map((r) => [r.ref, r.type, r.title || '-', `${r.label}${r.owner === 'you' ? ' · client' : r.owner === 'us' ? ' · us' : ''}`, short(r.date), r.owner]),
      { after: 18 }
    );
  });

  // ---- footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const b = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(MONO).fontSize(7.5).fillColor(MUTED)
      .text(`${brandName()}  ·  ${title}  ·  internal`, L, doc.page.height - 36, { lineBreak: false })
      .text(`${i - range.start + 1} / ${range.count}`, L, doc.page.height - 36, { width: W, align: 'right', lineBreak: false });
    doc.page.margins.bottom = b;
  }
  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

module.exports = { generateDirectoryPdf };
