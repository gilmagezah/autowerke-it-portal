// Your pre-applied signature: uploaded once (Billing → Your signature), stored privately,
// kept in memory so every PDF generator can draw it without extra work at each call site.
const db = require('./db');
const storage = require('./storage');

let cached = null; // { buffer, name, title, url }

async function loadSignature() {
  try {
    const s = await db.getSetting('signature');
    if (!s || !s.url) { cached = null; return null; }
    cached = { buffer: await storage.download(storage.pathFromUrl(s.url)), name: s.name || '', title: s.title || '', url: s.url };
  } catch (err) {
    console.warn('Signature not loaded:', err.message);
    cached = null;
  }
  return cached;
}

const getSignature = () => cached;
const setSignatureCache = (s) => { cached = s; };

// Draws "For <brand>: [signature] ___ Name, Title" at (x, y). Returns the height used.
// With no signature uploaded, draws a blank signing line instead.
function drawSignature(doc, x, y, { brand, width = 200, date } = {}) {
  const s = cached;
  doc.save();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1F2622').text(`For ${brand}`, x, y, { width });
  // A signature image needs 46pt above the line; a blank line only needs room to sign by hand
  let drawn = false;
  if (s && s.buffer) {
    try { doc.image(s.buffer, x, y + 14, { fit: [width, 46], valign: 'bottom' }); drawn = true; } catch { /* unreadable image: leave the line blank */ }
  }
  const line = y + (drawn ? 64 : 44);
  doc.moveTo(x, line).lineTo(x + width, line).lineWidth(0.6).strokeColor('#6F6F65').stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor('#6F6F65')
    .text([s && s.name, s && s.title].filter(Boolean).join(', ') || 'Authorised signatory', x, line + 4, { width });
  if (date) doc.text(date, x, line + 16, { width });
  doc.restore();
  return (line - y) + (date ? 30 : 18);
}

module.exports = { loadSignature, getSignature, setSignatureCache, drawSignature };
