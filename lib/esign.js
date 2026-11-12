// Online sign-off.
//   1. The client confirms who they are: reference + email + name (+ phone if we have one)
//   2. We email an 8-character code (2 letters from their company name, all shuffled).
//      Single use, 10 minutes, 5 tries. The reply is identical whether or not details
//      match, so nobody can probe for valid references.
//   3. The code opens a 30-minute signing session (HttpOnly cookie, only its hash stored)
//   4. They review, accept the terms, sign (type, draw or upload), add a PO or proof of payment
//   5. We produce the signed PDF: the original document plus a certificate page recording
//      who signed, how, when, from where, and a SHA-256 fingerprint of the document.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLib } = require('pdf-lib');
const db = require('./db');
const sec = require('./security');
const { supportBilling, generateSupportSignoffPdf } = require('./supportSignoff');
const { generateSignoffPdf, defaultSignoff } = require('./signoff');
const storage = require('./storage');
const { brandName } = require('./brand');
const pdfDoc = require('./pdfDoc');
const { detectImageType, pngChunksOk } = require('./attachments');

const COOKIE = 'aw_signoff';
const CODE_MINUTES = 10;
const SESSION_MINUTES = 30;
const MAX_TRIES = 5;
const GENERIC = "If those details match a request that's waiting for sign-off, we've emailed a code to that address. It expires in 10 minutes.";

let mailer = { sendSignoffCode: async () => {}, sendSignedOnlineEmails: async () => {} };
const setMailer = (m) => { mailer = m; };
const isDev = () => !sec.isProduction();
const upload = (...args) => storage.uploadSignedContract(...args);

// ---------- Who can sign, and is it really them? ----------

function awaitingSignoff(p) {
  if (!p) return false;
  if (p.request_type === 'IT Support') return p.status === 'awaiting_signoff';
  return ['signed', 'delivered'].includes(p.status) && Boolean(p.signoff_sent_at) && !p.signoff_signed_at;
}

const letters = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
const digits = (s) => String(s || '').replace(/\D/g, '');

function identityMatches(p, input) {
  if (String(input.email || '').trim().toLowerCase() !== String(p.email || '').trim().toLowerCase()) return false;
  const stored = letters(p.name);
  const given = letters(input.name);
  if (!stored.length || !given.length || !given.includes(stored[0])) return false; // their first name must be there
  const storedPhone = digits(p.phone);
  if (storedPhone.length >= 7) {
    // Compare the last 7 digits so +263 77... and 077... both work
    if (digits(input.phone).slice(-7) !== storedPhone.slice(-7)) return false;
  }
  return true;
}

// ---------- Totals for the page and certificate ----------

function amountFor(p) {
  if (p.request_type === 'IT Support') return supportBilling(p).total;
  const v = Number(p.contract_value);
  if (!Number.isFinite(v) || v <= 0) return null;
  const rate = Number(process.env.VAT_RATE || 15.5);
  return Math.round((p.vat_applicable === false ? v : v * (1 + rate / 100)) * 100) / 100;
}

async function originalPdf(p) {
  if (p.request_type === 'IT Support') return generateSupportSignoffPdf({ project: p });
  return generateSignoffPdf({ project: p, signoff: p.signoff || defaultSignoff(p) });
}

const ACCEPT = (amount) => [
  'The work described in this sign-off has been completed, apart from any outstanding items listed.',
  amount ? `I agree to the amount shown ($${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}) and the payment terms.` : 'I agree to the payment terms.',
  'My typed name and signature here are my legal electronic signature, with the same effect as signing on paper.',
];

// ---------- Session ----------

async function currentSession(req) {
  const token = sec.parseCookies(req)[COOKIE];
  if (!token || token.length < 30) return null;
  const s = await db.getSignoffSession(sec.hashToken(token));
  if (!s || s.completed_at || new Date(s.expires_at).getTime() < Date.now()) return null;
  const project = await db.getProjectById(s.project_id);
  if (!awaitingSignoff(project)) return null;
  return { session: s, project };
}

// ---------- Certificate page ----------
// Added after the signed document. One A4 page, always: a full-width green header with the key
// facts, then how it was signed (a short timeline), the signature and the technical record.
// Long values are cut to fit their space, so nothing can push it onto a second page.

const PALE = '#B9C7BB'; // muted text on the green
const RULE_ON_GREEN = '#4A6656';
const METHOD = { type: 'Typed name', draw: 'Drawn on screen', upload: 'Uploaded signature image' };

// ISO time -> { date: '5 Nov 2026', time: '14:38', place: 'Harare' } in REMINDER_TIMEZONE
function localTime(iso) {
  const tz = (process.env.REMINDER_TIMEZONE || 'Africa/Harare').trim();
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return { date: '', time: '', place: '' };
  let date; let time;
  try {
    date = d.toLocaleDateString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });
    time = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { // unknown time zone name: fall back to UTC rather than fail the signing
    return { ...localTime.utc(d), place: 'UTC' };
  }
  return { date, time, place: tz.split('/').pop().replace(/_/g, ' ') };
}
localTime.utc = (d) => ({
  date: d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }),
  time: d.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }),
});

// The built-in PDF fonts have no ✓ character, so ticks are drawn
const tick = (doc, x, y, color, w = 1.4) => doc.save().moveTo(x + 1, y + 5).lineTo(x + 4, y + 8.5).lineTo(x + 10, y + 1).lineWidth(w).strokeColor(color).stroke().restore();

// measure (tests only): called with { contentBottom, footerTop } once the page is drawn
function certificatePdf({ project, esign, signatureImage, measure }) {
  const { C, MONO, MONO_B, SANS, SANS_B } = pdfDoc;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 74, bottom: 60, left: 60, right: 60 } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.page.margins.bottom = 0; // one page, always: nothing here may start a new one
  const L = 60;
  const W = doc.page.width - 120;
  const PW = doc.page.width;
  const H = doc.page.height;
  const brand = brandName();
  const kind = project.request_type === 'IT Support' ? 'support sign-off' : 'project sign-off';
  const signed = localTime(esign.signed_at);
  const verified = localTime(esign.code_verified_at);
  const method = METHOD[esign.method] || String(esign.method || '-');
  const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ---- Full-width green header ----
  const bandH = 228;
  doc.rect(0, 0, PW, bandH).fill(C.GREEN);
  // Brand in cream type (the logo image is dark, so it can't sit on the green)
  const [mark, ...rest] = brand.split('|');
  doc.font(SANS_B).fontSize(13).fillColor(C.CREAM).text(mark.trim(), L, 30, { continued: Boolean(rest.length), lineBreak: false });
  if (rest.length) doc.font(SANS).fillColor(PALE).text(`  |  ${rest.join('|').trim()}`, { lineBreak: false });
  doc.font(MONO).fontSize(8).fillColor(PALE).text(project.project_id, L + W - 200, 33, { width: 200, align: 'right', lineBreak: false });
  doc.moveTo(L, 54).lineTo(L + W, 54).lineWidth(0.5).strokeColor(RULE_ON_GREEN).stroke();

  pdfDoc.label(doc, 'Electronic signature certificate', L, 74, { color: PALE });
  doc.font(SANS_B).fontSize(24).fillColor(C.CREAM).text('Signed online', L, 90, { lineBreak: false });
  // SIGNED stamp
  const sx = L + W - 130;
  doc.roundedRect(sx, 84, 130, 46, 4).lineWidth(1).strokeColor(C.CREAM).stroke();
  tick(doc, sx + 10, 94, C.CREAM, 1.8);
  doc.font(MONO_B).fontSize(11).fillColor(C.CREAM).text('SIGNED', sx + 28, 94, { characterSpacing: 1.5, lineBreak: false });
  doc.font(MONO).fontSize(8).fillColor(PALE).text(`${signed.date}, ${signed.time}`, sx + 10, 112, { width: 110, lineBreak: false });
  doc.font(SANS).fontSize(9.5).fillColor(PALE).text(`${kind[0].toUpperCase()}${kind.slice(1)}: ${project.project_title || project.project_id}`,
    L, 124, { width: W - 150, height: 26, ellipsis: true, lineGap: 1.5 });

  // Key facts inside the band: four columns with thin dividers
  const fy = bandH - 66;
  doc.moveTo(L, fy).lineTo(L + W, fy).lineWidth(0.5).strokeColor(RULE_ON_GREEN).stroke();
  const facts = [
    ['Signed by', esign.name],
    ['For', project.company_name],
    ['Amount agreed', esign.amount ? money(esign.amount) : 'Not stated'],
    ['Method', method],
  ];
  const cw = W / facts.length;
  facts.forEach(([k, v], i) => {
    const x = L + i * cw;
    if (i) doc.moveTo(x - 8, fy + 12).lineTo(x - 8, bandH - 14).lineWidth(0.5).strokeColor(RULE_ON_GREEN).stroke();
    pdfDoc.label(doc, k, x, fy + 14, { color: PALE });
    doc.font(SANS_B).fontSize(10).fillColor(C.CREAM).text(String(v || '-'), x, fy + 28, { width: cw - 18, height: 26, ellipsis: true, lineGap: 1 });
  });

  // ---- Summary ----
  let y = bandH + 26;
  doc.font(SANS).fontSize(10).fillColor(C.MUTED).text(
    `${esign.name} (${esign.email}) signed this ${kind} online. This page records how we confirmed it was them, and a fingerprint of the exact document they signed.`,
    L, y, { width: W, height: 44, ellipsis: true, lineGap: 2.5 });
  y = doc.y + 6;
  const extras = [esign.po_number && (/^po\b/i.test(esign.po_number) ? esign.po_number : `PO ${esign.po_number}`), ...(esign.documents || []).map((d) => d.name)].filter(Boolean);
  if (extras.length) {
    doc.font(SANS).fontSize(10).fillColor(C.MUTED).text('PO and attachments: ', L, y, { continued: true, width: W, height: 28, ellipsis: true })
      .fillColor(C.INK).text(extras.join(', '));
    y = doc.y;
  }
  y += 20;

  // ---- How it was signed: a short timeline ----
  pdfDoc.label(doc, `How it was signed${signed.place ? ` (${signed.place} time)` : ''}`, L, y);
  y += 18;
  const steps = [
    [verified.time, 'Identity checked', `Reference, email, name${project.phone ? ' and phone' : ''} matched our records. A one-time code was emailed to ${sec.maskEmail(esign.email)} and entered correctly.`],
    [signed.time, 'Statements accepted', null],
    [signed.time, 'Signed', `${method}. The document was fingerprinted at the same moment.`],
  ];
  const tx = L + 62;
  const tw = W - 62;
  steps.forEach(([time, title, body], i) => {
    const top = y;
    doc.font(MONO).fontSize(9).fillColor(C.MUTED).text(time || '', L, top + 1, { width: 44, lineBreak: false });
    doc.circle(L + 52, top + 6, 3).fill(C.GREEN);
    doc.font(SANS_B).fontSize(10).fillColor(C.INK).text(title, tx, top, { width: tw, lineBreak: false });
    let by = top + 15;
    if (body) {
      doc.font(SANS).fontSize(9.5).fillColor(C.INK).text(body, tx, by, { width: tw, height: 36, ellipsis: true, lineGap: 1.5 });
      by = doc.y;
    } else {
      (esign.accepted || []).slice(0, 4).forEach((t) => {
        tick(doc, tx, by, C.GREEN);
        doc.font(SANS).fontSize(9.5).fillColor(C.INK).text(t, tx + 18, by + 1, { width: tw - 18, height: 26, ellipsis: true, lineGap: 1.5 });
        by = doc.y + 3;
      });
    }
    y = by + 12;
    if (i < steps.length - 1) doc.moveTo(L + 52, top + 12).lineTo(L + 52, y + 2).lineWidth(0.6).strokeColor(C.LINE).stroke();
  });
  y += 4;

  // ---- Signature, in a cream box ----
  const boxH = 86;
  doc.roundedRect(L, y, W, boxH, 6).fill(C.CREAM);
  pdfDoc.label(doc, 'Signature', L + 14, y + 12);
  if (signatureImage) {
    doc.image(signatureImage, L + 14, y + 22, { fit: [W * 0.6, 40], valign: 'center' });
  } else {
    // Courier bold oblique: the typewriter italic the sign-off page previews it in
    doc.font('Courier-BoldOblique').fontSize(24).fillColor(C.INK).text(pdfDoc.fit(doc.font('Courier-BoldOblique').fontSize(24), esign.name, W - 28), L + 14, y + 29, { lineBreak: false });
  }
  doc.save().moveTo(L + 14, y + 64).lineTo(L + W - 14, y + 64).dash(1, { space: 2 }).lineWidth(0.6).strokeColor(C.SOFT).stroke().restore();
  doc.font(SANS).fontSize(8.5).fillColor(C.MUTED).text(pdfDoc.fit(doc, `${esign.name}  ·  ${signed.date}, ${signed.time}`, W - 28), L + 14, y + 69, { lineBreak: false });
  y += boxH + 18;

  // ---- Technical record: small typewriter, the exact values ----
  pdfDoc.label(doc, 'Technical record', L, y);
  y += 16;
  [
    ['Signed (UTC)', `${esign.signed_at}   IP address  ${esign.ip || '-'}`, 1],
    ['Device', esign.user_agent || '-', 2],
    ['SHA-256', String(esign.doc_sha256 || '').match(/.{1,8}/g)?.join(' ') || '-', 2],
  ].forEach(([k, v, lines]) => {
    doc.font(MONO).fontSize(7.5).fillColor(C.MUTED).text(k, L, y, { width: 80, lineBreak: false });
    doc.font(MONO).fontSize(7.5).fillColor(C.INK).text(v, L + 84, y, { width: W - 84, height: lines * 9.5, ellipsis: true, lineGap: 1 });
    y = doc.y + 4;
  });
  y += 6;
  doc.font(SANS).fontSize(8).fillColor(C.MUTED).text(
    'The SHA-256 fingerprint identifies the exact pages that were signed: any change to them, however small, gives a different fingerprint. '
    + `This page was added automatically by ${brand} at the moment of signing.`, L, y, { width: W, lineGap: 1.5 });
  const contentBottom = doc.y;

  // ---- Footer ----
  const footY = H - 40;
  doc.moveTo(L, footY - 8).lineTo(L + W, footY - 8).lineWidth(0.5).strokeColor(C.LINE).stroke();
  doc.font(SANS).fontSize(8).fillColor(C.MUTED).text(`${brand}  ·  Signing certificate`, L, footY, { lineBreak: false });
  doc.font(MONO).fontSize(8).fillColor(C.MUTED).text('Added on signing', L + W - 120, footY, { width: 120, align: 'right', lineBreak: false });
  if (measure) measure({ contentBottom, footerTop: footY - 8 });

  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

async function mergePdfs(original, certificate) {
  const out = await PdfLib.create();
  for (const buf of [original, certificate]) {
    const src = await PdfLib.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  out.setTitle('Signed sign-off');
  return Buffer.from(await out.save());
}

// ---------- Routes ----------

const router = express.Router();
const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 4 } });

function limited(res, r) {
  res.set('Retry-After', String(r.retryAfterSec));
  return res.status(429).json({ error: `Too many attempts. Please wait ${Math.ceil(r.retryAfterSec / 60)} minute(s) and try again.` });
}

router.get('/signoff', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'signoff.html')));

router.post('/api/signoff/identify', async (req, res) => {
  const ip = sec.clientIp(req);
  const ref = db.cleanRef(req.body.ref);
  // Per reference AND address: someone hammering a client's reference only locks themselves
  // out, never the real client signing from their own connection
  const r1 = sec.rateLimit(`so-id-ip:${ip}`, { limit: 6, windowMs: 15 * 60 * 1000 });
  const r2 = sec.rateLimit(`so-id-ref:${ref}:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!r1.allowed) return limited(res, r1);
  if (ref && !r2.allowed) return limited(res, r2);
  const started = Date.now();
  try {
    const p = ref ? await db.getProjectByRef(ref) : null;
    // Codes actually sent are capped per reference (only details that match count), so the
    // client's inbox can't be flooded. Over the cap, the reply is still the same generic one.
    if (p && awaitingSignoff(p) && identityMatches(p, req.body)
      && sec.rateLimit(`so-codes-sent:${p.id}`, { limit: 5, windowMs: 60 * 60 * 1000 }).allowed) {
      const code = sec.signoffCode(p.company_name);
      await db.invalidateCodes('signoff', p.id);
      await db.createCode({
        purpose: 'signoff', subject_id: p.id, code_hash: sec.hashCode('signoff', p.id, code),
        expires_at: new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString(), ip,
      });
      if (isDev()) console.log(`[development only] Sign-off code for ${p.project_id}: ${code}`);
      await mailer.sendSignoffCode({ project: p, code, codeMinutes: CODE_MINUTES, sessionMinutes: SESSION_MINUTES })
        .catch((e) => console.error('Sign-off code email failed:', e.message));
    }
  } catch (err) {
    console.error('Sign-off identify:', err.message);
  }
  // Same answer, and roughly the same time, whether or not anything matched
  const wait = Math.max(0, 600 - (Date.now() - started));
  setTimeout(() => res.json({ ok: true, message: GENERIC, codeMinutes: CODE_MINUTES }), wait);
});

router.post('/api/signoff/verify', async (req, res) => {
  const ip = sec.clientIp(req);
  const rl = sec.rateLimit(`so-verify-ip:${ip}`, { limit: 15, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return limited(res, rl);
  const fail = (msg = "That code isn't right, or it has expired.") => res.status(401).json({ error: msg });
  try {
    const p = await db.getProjectByRef(req.body.ref);
    if (!p || !awaitingSignoff(p) || String(req.body.email || '').trim().toLowerCase() !== String(p.email).toLowerCase()) return fail();
    const c = await db.latestCode('signoff', p.id);
    if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now()) return fail('That code has expired. Go back and request a new one.');
    if (c.attempts >= MAX_TRIES) return fail('Too many wrong codes. Go back and request a new one.');
    if (!sec.safeEqual(sec.hashCode('signoff', p.id, req.body.code), c.code_hash)) {
      const attempts = c.attempts + 1;
      await db.updateCode(c.id, { attempts, ...(attempts >= MAX_TRIES ? { used_at: new Date().toISOString() } : {}) });
      return fail(attempts >= MAX_TRIES ? 'Too many wrong codes. Go back and request a new one.' : `That code isn't right. ${MAX_TRIES - attempts} tries left.`);
    }
    const now = new Date();
    await db.updateCode(c.id, { used_at: now.toISOString() });
    const token = sec.newToken();
    const expiresAt = new Date(now.getTime() + SESSION_MINUTES * 60 * 1000).toISOString();
    await db.createSignoffSession({ project_id: p.id, token_hash: sec.hashToken(token), expires_at: expiresAt, ip, user_agent: String(req.get('user-agent') || '').slice(0, 300) });
    sec.setCookie(res, COOKIE, token, { maxAgeSec: SESSION_MINUTES * 60 });
    res.json({ ok: true, expiresAt });
  } catch (err) {
    console.error('Sign-off verify:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/api/signoff/session', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const cur = await currentSession(req);
    if (!cur) return res.status(401).json({ error: 'Your secure session has ended. Please verify again.' });
    const p = cur.project;
    const support = p.request_type === 'IT Support';
    const out = {
      ref: p.project_id, title: p.project_title, company: p.company_name,
      contactName: [p.name, p.surname].filter(Boolean).join(' '), email: p.email, type: support ? 'support' : 'project',
      expiresAt: cur.session.expires_at, sessionMinutes: SESSION_MINUTES, amount: amountFor(p),
      statements: ACCEPT(amountFor(p)), // exactly what goes on the certificate
    };
    if (support) {
      const b = supportBilling(p);
      out.billing = { hours: b.billableHours, rate: b.rate, subtotal: b.subtotal, vat: b.vat, vatRate: b.vatRate, total: b.total, usedEstimate: b.usedEstimate };
      out.entries = (b.entries || []).map((e) => ({ date: e.date, start: e.start, end: e.end, note: e.note, minutes: e.minutes }));
    } else {
      const so = p.signoff || defaultSignoff(p);
      out.phases = (p.phases || []).map((ph) => ({ title: ph.title, done: ph.done, completed: ph.completed_date }));
      out.document = { introduction: so.introduction, objectives: so.objectives || [], outstanding: so.outstanding_issues || [], recommendations: so.recommendations || [] };
    }
    res.json(out);
  } catch (err) {
    console.error('Sign-off session:', err.message);
    res.status(500).json({ error: 'Something went wrong loading your sign-off.' });
  }
});

// The exact document being signed, for reading before signing
router.get('/api/signoff/document', async (req, res) => {
  try {
    const cur = await currentSession(req);
    if (!cur) return res.status(401).send('Your secure session has ended.');
    const pdf = await originalPdf(cur.project);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${cur.project.project_id}-sign-off.pdf"`);
    res.set('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (err) {
    res.status(500).send('Could not load the document.');
  }
});

// Runs BEFORE the upload is read: without a live signing session nothing is buffered into memory
async function signingSessionFirst(req, res, next) {
  const rl = sec.rateLimit(`so-complete-ip:${sec.clientIp(req)}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return limited(res, rl);
  try {
    req.signing = await currentSession(req);
  } catch (err) {
    console.error('Sign-off session check:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
  if (!req.signing) return res.status(401).json({ error: 'Your secure session has ended. Please verify again to sign.' });
  return next();
}

// Decompression bombs: a small PNG can claim enormous dimensions and use gigabytes once decoded
const MAX_SIGNATURE_SIDE = 3000;
function readableSignature(buf) {
  if (detectImageType(buf) === 'image/png' && !pngChunksOk(buf)) return false; // see pngChunksOk: a bad PNG can hang pdfkit
  try {
    const img = new PDFDocument().openImage(buf);
    return img.width > 0 && img.height > 0 && img.width <= MAX_SIGNATURE_SIDE && img.height <= MAX_SIGNATURE_SIDE;
  } catch {
    return false;
  }
}

router.post('/api/signoff/complete', signingSessionFirst, uploads.fields([{ name: 'signature', maxCount: 1 }, { name: 'documents', maxCount: 3 }]), async (req, res) => {
  let body;
  try { body = JSON.parse(req.body.payload || '{}'); } catch { return res.status(400).json({ error: 'The form could not be read.' }); }
  try {
    const { session, project: p } = req.signing;
    const amount = amountFor(p);
    const statements = ACCEPT(amount);

    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 3 || !/[a-z]/i.test(name)) return res.status(400).json({ error: 'Type your full name to sign.' });
    if (!Array.isArray(body.accept) || body.accept.length !== statements.length || !body.accept.every((x) => x === true)) {
      return res.status(400).json({ error: 'Please tick each statement to continue.' });
    }
    const method = ['type', 'draw', 'upload'].includes(body.method) ? body.method : null;
    if (!method) return res.status(400).json({ error: 'Choose how you want to sign.' });

    let signatureImage = null;
    if (method === 'draw') {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.drawn || ''));
      signatureImage = m ? Buffer.from(m[1], 'base64') : null;
      if (!signatureImage || detectImageType(signatureImage) !== 'image/png' || signatureImage.length > 1024 * 1024) {
        return res.status(400).json({ error: 'Please draw your signature in the box.' });
      }
    }
    if (method === 'upload') {
      const f = ((req.files || {}).signature || [])[0];
      const type = f && detectImageType(f.buffer);
      if (!f || !['image/png', 'image/jpeg'].includes(type) || f.size > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Upload your signature as a PNG or JPG under 2 MB.' });
      }
      signatureImage = f.buffer;
    }

    // Make sure the signature image can really be read (not just that it starts like a PNG),
    // before anything is committed
    if (signatureImage && !readableSignature(signatureImage)) {
      return res.status(400).json({ error: `We couldn't use that signature image. Please draw it again, or upload a PNG or JPG no larger than ${MAX_SIGNATURE_SIDE} pixels on each side.` });
    }

    // Payment documents: PDF, PNG or JPG only, checked by content
    const docs = [];
    for (const f of (req.files || {}).documents || []) {
      const isPdf = f.buffer.slice(0, 5).toString('latin1') === '%PDF-';
      const img = detectImageType(f.buffer);
      if (!isPdf && !['image/png', 'image/jpeg'].includes(img)) return res.status(400).json({ error: `"${f.originalname}" must be a PDF, PNG or JPG.` });
      docs.push({ buffer: f.buffer, name: String(f.originalname).replace(/[^\w .-]/g, '').slice(0, 80) || 'document', type: isPdf ? 'application/pdf' : img });
    }

    // Close the session first, so a double-click can't sign twice. If anything below fails,
    // it's reopened so the client can simply try again (no new code needed).
    await db.updateSignoffSession(session.id, { completed_at: new Date().toISOString() });
    try {
      const original = await originalPdf(p);
      const esign = {
        name, email: p.email, method, accepted: statements, amount,
        po_number: String(body.po_number || '').trim().slice(0, 60) || null,
        signed_at: new Date().toISOString(),
        code_verified_at: session.created_at,
        ip: sec.clientIp(req), user_agent: String(req.get('user-agent') || '').slice(0, 300),
        doc_sha256: crypto.createHash('sha256').update(original).digest('hex'),
        session_id: session.id,
        documents: [],
      };

      const stamp = Date.now();
      for (const [i, d] of docs.entries()) {
        const url = await upload(p.project_id, d.buffer, d.name, d.type, `payment-doc-${i + 1}-${stamp}`);
        esign.documents.push({ name: d.name, url, type: d.type });
      }
      if (signatureImage) {
        esign.signature_url = await upload(p.project_id, signatureImage, 'signature.png', detectImageType(signatureImage), `signature-${stamp}`);
      }
      const cert = await certificatePdf({ project: p, esign, signatureImage });
      const signedPdf = await mergePdfs(original, cert);
      const label = p.request_type === 'IT Support' ? 'support-signoff-signed-online' : 'signoff-signed-online';
      esign.signed_pdf_url = await upload(p.project_id, signedPdf, `${p.project_id}-signed.pdf`, 'application/pdf', label);

      const updated = p.request_type === 'IT Support'
        ? await db.markSupportSignoffSigned(p.confirm_token, esign.signed_pdf_url)
        : await db.markSignoffSigned(p.confirm_token, esign.signed_pdf_url);
      await db.updateProject(p.id, { esign });

      await mailer.sendSignedOnlineEmails({ project: updated, esign, signedPdf, total: amount }).catch((e) => console.error('Signed emails failed:', e.message));
      sec.clearCookie(res, COOKIE);
      res.json({ success: true, ref: p.project_id, amount, signedAt: esign.signed_at, name });
    } catch (inner) {
      await db.updateSignoffSession(session.id, { completed_at: null }).catch(() => {});
      throw inner;
    }
  } catch (err) {
    console.error('Sign-off complete failed:', err.message);
    res.status(500).json({ error: 'Something went wrong saving your sign-off. Please try again. If it keeps happening, contact us.' });
  }
});

router.post('/api/signoff/leave', async (req, res) => {
  try {
    const token = sec.parseCookies(req)[COOKIE];
    if (token) {
      const s = await db.getSignoffSession(sec.hashToken(token));
      if (s && !s.completed_at) await db.updateSignoffSession(s.id, { expires_at: new Date().toISOString() });
    }
  } catch { /* nothing to end */ }
  sec.clearCookie(res, COOKIE);
  res.json({ ok: true });
});

module.exports = { router, setMailer, identityMatches, awaitingSignoff, certificatePdf, mergePdfs, readableSignature, ACCEPT, SESSION_MINUTES };
