// Extract the text of a PDF, on any OS.
// Uses `pdftotext` (poppler) when it's installed; otherwise reads the PDF's compressed content
// streams with Node's zlib and decodes the text operators. That fallback is enough for the PDFs
// this app makes (pdfkit + pdf-lib, standard fonts), so `npm test` works on Windows too.
const zlib = require('zlib');
const { execFileSync } = require('child_process');

function viaPdftotext(file) {
  return execFileSync('pdftotext', ['-layout', file, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

function viaNode(buffer) {
  const raw = buffer.toString('latin1');
  const out = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streams.exec(raw))) {
    let content;
    try { content = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { content = m[1]; }
    // Text shown with Tj / TJ: hex strings <...> or literal strings (...)
    const ops = /\[((?:\\.|[^\]])*)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^)])*)\)\s*Tj/g;
    let t;
    while ((t = ops.exec(content))) {
      const parts = t[1] !== undefined ? [...t[1].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^)])*)\)/g)].map((p) => decode(p[1], p[2])) : [decode(t[2], t[3])];
      out.push(parts.join(''));
    }
  }
  return out.join(' ');
}

function decode(hex, literal) {
  if (hex !== undefined) {
    const h = hex.replace(/\s+/g, '');
    let s = '';
    for (let i = 0; i + 1 < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return s;
  }
  return String(literal || '').replace(/\\([nrtbf()\\])/g, (x, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c));
}

module.exports = function pdfText(file, buffer) {
  if (!process.env.FORCE_PDF_TEXT_FALLBACK) {
    try { return viaPdftotext(file); } catch { /* not installed (e.g. Windows): use the Node reader */ }
  }
  return viaNode(buffer || require('fs').readFileSync(file));
};
