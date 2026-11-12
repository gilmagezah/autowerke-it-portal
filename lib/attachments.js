// Files attached to support/project requests: screenshots, or a plain text file (an error
// message, a log, a snippet of code). We check the file's actual bytes, never its name or the
// type the browser claims - so a renamed .exe can't pass as a .png or a .txt.

const MAX_FILES = 4;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB each (also within Claude's image limit)
const TEXT_MAX_BYTES = 1024 * 1024; // 1 MB of text is ~15,000 lines: plenty for an error log
const TEXT_TYPE = 'text/plain; charset=utf-8';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// A text file has no magic number, so every byte decides it: it must decode as UTF-8 (or as
// UTF-16 with a byte-order mark, which is what Windows PowerShell's `>` writes), and contain no
// control characters other than tab, line breaks, form feed and escape (terminal colours).
// Executables, archives, PDFs, Office files and images all contain bytes that fail this.
// Returns the text (always re-encoded as UTF-8 for storage), or null.
const CONTROL = /[\u0000-\u0008\u000B\u000E-\u001A\u001C-\u001F\u007F]/;
function readPlainText(buf) {
  if (!buf || !buf.length) return null;
  let enc = 'utf-8';
  let body = buf;
  if (buf[0] === 0xff && buf[1] === 0xfe) { enc = 'utf-16le'; body = buf.subarray(2); }
  else if (buf[0] === 0xfe && buf[1] === 0xff) { enc = 'utf-16be'; body = buf.subarray(2); }
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) body = buf.subarray(3);
  let text;
  try { text = new TextDecoder(enc, { fatal: true }).decode(body); } catch { return null; }
  if (!text.trim() || CONTROL.test(text)) return null;
  return text;
}

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// Walks a PNG's chunks before pdfkit is allowed to open it. pdfkit's PNG reader (png-js) reads
// chunk lengths as signed numbers and trusts them: a chunk claiming 0xFFFFFFF4 bytes sends it
// backwards to the start, and it loops forever, freezing the whole server with a 20-byte file.
// Here every length is read unsigned and must fit inside the file, the first chunk must be
// IHDR and the file must reach IEND, so the reader can only ever move forward and finish.
function pngChunksOk(buf) {
  if (detectImageType(buf) !== 'image/png') return false;
  let pos = 8;
  for (let n = 0; pos + 12 <= buf.length && n < 10000; n++) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (n === 0 && (type !== 'IHDR' || len !== 13)) return false;
    if (len > buf.length - pos - 12) return false;
    if (type === 'IEND') return true;
    pos += 12 + len;
  }
  return false;
}

// Signed documents a client returns (contract, estimate, sign-off): PDF, PNG or JPG only.
// The extension and type come from the bytes, never from the name or the browser's claim.
function detectSignedDocument(buf) {
  if (buf && buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  const img = detectImageType(buf);
  if (img === 'image/png' || img === 'image/jpeg') return { type: img, ext: EXT[img] };
  return null;
}

// files: multer's req.files. Returns [{ buffer, name, type, size, text? }] or throws a friendly
// error. Images keep their bytes; text files are stored as UTF-8 and named .txt, whatever they
// were called, so they can only ever be shown as plain text.
function validateScreenshots(files = []) {
  if (files.length > MAX_FILES) throw new Error(`You can attach up to ${MAX_FILES} files.`);
  return files.map((f, i) => {
    const base = (fallback) => String(f.originalname || fallback).replace(/\.[^.]*$/, '').replace(/[^\w .-]/g, '').trim().slice(0, 60) || fallback;
    const type = detectImageType(f.buffer);
    if (type) {
      if (f.size > MAX_BYTES) throw new Error(`"${f.originalname}" is over 5 MB.`);
      return { buffer: f.buffer, name: `${base(`screenshot-${i + 1}`)}.${EXT[type]}`, type, size: f.size };
    }
    if (f.size > TEXT_MAX_BYTES) throw new Error(`"${f.originalname}" is over 1 MB. Text files can be up to 1 MB.`);
    const text = readPlainText(f.buffer);
    if (text === null) throw new Error(`"${f.originalname}" isn't an image (PNG, JPG, GIF or WebP) or a plain text file.`);
    const buffer = Buffer.from(text, 'utf8');
    return { buffer, name: `${base(`file-${i + 1}`)}.txt`, type: TEXT_TYPE, size: buffer.length, text };
  });
}

const isText = (a) => /^text\//.test(String(a && a.type));

// For the AI draft: Claude can read error messages straight off a screenshot
function toClaudeImages(shots) {
  return shots.filter((s) => !isText(s)).map((s) => ({ type: 'image', source: { type: 'base64', media_type: s.type, data: s.buffer.toString('base64') } }));
}

// ...and from an attached text file. Capped, so a big log can't crowd out the request itself.
const AI_TEXT_CHARS = 20000;
function toClaudeText(shots) {
  let room = AI_TEXT_CHARS;
  return shots.filter(isText).map((s) => {
    const text = s.text.length > room ? `${s.text.slice(0, room)}\n[... cut: the rest of the file is in the request]` : s.text;
    room = Math.max(0, room - text.length);
    return { name: s.name, text };
  });
}

module.exports = { validateScreenshots, detectImageType, readPlainText, pngChunksOk, detectSignedDocument, toClaudeImages, toClaudeText, isText, MAX_FILES, MAX_BYTES, TEXT_MAX_BYTES };
