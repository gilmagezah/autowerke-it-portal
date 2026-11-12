// Billing: invoices -> payments -> receipts, the document trail, and your signature.
const express = require('express');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const db = require('./db');
const billing = require('./billing');
const storage = require('./storage');
const followups = require('./followups');
const { buildTrail } = require('./trail');
const signature = require('./signature');
const { detectImageType, pngChunksOk } = require('./attachments');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const httpError = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('Billing:', err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : `Billing problem: ${err.message}` });
});
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = (adminAuth, ownerOnly, mail) => {
  const router = express.Router();

  router.get('/admin/billing', adminAuth, (req, res) => res.sendFile(path.join(__dirname, '..', 'views', 'billing.html')));

  router.get('/api/admin/billing', adminAuth, wrap(async (req, res) => {
    const [invoices, receipts, billable] = await Promise.all([db.listInvoices(), db.listReceipts(), db.listBillable()]);
    const sig = signature.getSignature();
    res.json({
      invoices, receipts, methods: billing.METHODS,
      sources: (billable || []).map((p) => ({ id: p.id, ref: p.project_id, title: p.project_title, company: p.company_name, contact: [p.name, p.surname].filter(Boolean).join(' '), email: p.email, type: p.request_type, ...billing.suggest(p) })),
      signature: sig ? { set: true, name: sig.name, title: sig.title, url: sig.url } : { set: false },
      paymentDetailsSet: Boolean(String(process.env.INVOICE_PAYMENT_DETAILS || '').trim()),
      isOwner: req.admin.role === 'owner',
    });
  }));

  // ---------- Issue an invoice (PDF + email + automatic payment follow-up) ----------
  router.post('/api/admin/invoices', adminAuth, wrap(async (req, res) => {
    const b = req.body || {};
    let lines;
    try { lines = billing.cleanLines(b.lines); } catch (e) { throw httpError(400, e.message); }
    const company = String(b.company || '').trim().slice(0, 160);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
    if (!company || !EMAIL_RE.test(email)) throw httpError(400, 'Enter the company and a valid billing email.');
    const days = [0, 7, 14, 30].includes(Number(b.due_days)) ? Number(b.due_days) : 14;
    let request = null;
    if (b.request_id) request = await db.getProjectById(b.request_id).catch(() => null);

    const t = billing.totals(lines, b.vat_applicable !== false);
    let inv = await db.createInvoice({
      request_id: request ? request.id : null, ref: request ? request.project_id : (String(b.ref || '').trim().slice(0, 40) || null),
      company, contact_name: String(b.contact_name || '').trim().slice(0, 120) || null, email, lines, ...t,
      due_date: days ? addDays(days) : today(), notes: String(b.notes || '').trim().slice(0, 1000) || null,
    });
    const pdf = await billing.invoicePdf(inv);
    const pdfUrl = await storage.uploadSignedContract(inv.ref || 'billing', pdf, `${inv.number}.pdf`, 'application/pdf', `invoice-${inv.number}`);

    // A payment follow-up, so your existing reminders chase it
    let followUpId = null;
    try {
      const fu = await db.createFollowUp(followups.sanitizeFollowUp({
        company_name: company, contact_name: inv.contact_name || '', email, amount: inv.total, due_date: inv.due_date,
        project_ref: inv.ref || '', project_id: inv.request_id || undefined, notes: `Invoice ${inv.number}`,
        reminder_enabled: true, reminder_frequency: 'weekly', reminder_weekday: 1, reminder_time: '08:00',
      }));
      followUpId = fu.id;
    } catch (e) { console.warn('Follow-up not created for invoice:', e.message); }

    inv = await db.updateInvoice(inv.id, { pdf_url: pdfUrl, follow_up_id: followUpId });
    if (b.send !== false) await mail.sendInvoiceEmail({ invoice: inv, pdf });
    res.json(inv);
  }));

  router.post('/api/admin/invoices/:id/void', adminAuth, wrap(async (req, res) => {
    const inv = await db.getInvoice(req.params.id);
    if (!inv) throw httpError(404, 'Invoice not found.');
    if (inv.status === 'paid') throw httpError(400, 'A paid invoice cannot be voided.');
    if (inv.follow_up_id) await db.updateFollowUp(inv.follow_up_id, { status: 'paid', next_reminder_at: null, notes: `Invoice ${inv.number} voided` }).catch(() => {});
    res.json(await db.updateInvoice(inv.id, { status: 'void' }));
  }));

  // Shared by "record payment" and "upload receipt"
  async function settle(inv) {
    // Includes the receipt just created, so this is the running total for the invoice
    const receipts = (await db.listReceiptsForInvoice(inv.id)) || [];
    const paidSoFar = receipts.reduce((s, r) => s + Number(r.amount), 0);
    if (paidSoFar + 0.005 >= Number(inv.total)) {
      await db.updateInvoice(inv.id, { status: 'paid', paid_at: new Date().toISOString() });
      if (inv.follow_up_id) await db.updateFollowUp(inv.follow_up_id, { status: 'paid', paid_at: new Date().toISOString(), next_reminder_at: null }).catch(() => {});
      return true;
    }
    if (inv.follow_up_id) await db.updateFollowUp(inv.follow_up_id, { amount: Math.round((Number(inv.total) - paidSoFar) * 100) / 100 }).catch(() => {});
    return false;
  }

  function paymentFields(b, inv) {
    const amount = Math.round(Number(String(b.amount ?? '').replace(/[,\s$]/g, '')) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Enter the amount received.');
    if (amount > Number(inv.total) + 0.005) throw httpError(400, `That's more than the invoice total (${billing.money(inv.total)}).`);
    const received = /^\d{4}-\d{2}-\d{2}$/.test(String(b.received_on || '')) ? b.received_on : today();
    if (received > today()) throw httpError(400, "The payment date can't be in the future.");
    return { amount, method: billing.METHODS.includes(b.method) ? b.method : 'Other', reference: String(b.reference || '').trim().slice(0, 80) || null, received_on: received };
  }

  // ---------- Record a payment -> we generate the receipt ----------
  router.post('/api/admin/invoices/:id/pay', adminAuth, wrap(async (req, res) => {
    const inv = await db.getInvoice(req.params.id);
    if (!inv || inv.status === 'void') throw httpError(404, 'Invoice not found or voided.');
    if (inv.status === 'paid') throw httpError(400, 'This invoice is already paid.');
    const f = paymentFields(req.body || {}, inv);
    let rc = await db.createReceipt({ invoice_id: inv.id, request_id: inv.request_id, ref: inv.ref, company: inv.company, email: inv.email, ...f, source: 'generated' });
    const pdf = await billing.receiptPdf(rc, inv);
    const url = await storage.uploadSignedContract(inv.ref || 'billing', pdf, `${rc.number}.pdf`, 'application/pdf', `receipt-${rc.number}`);
    rc = { ...rc, file_url: url };
    await db.updateReceiptFile(rc.id, url);
    const fullyPaid = await settle(inv);
    if (req.body.send !== false) await mail.sendReceiptEmail({ receipt: rc, pdf });
    res.json({ receipt: rc, fullyPaid });
  }));

  // ---------- Or file a receipt your workplace's own system issued ----------
  router.post('/api/admin/invoices/:id/receipt-upload', adminAuth, upload.single('file'), wrap(async (req, res) => {
    const inv = await db.getInvoice(req.params.id);
    if (!inv || inv.status === 'void') throw httpError(404, 'Invoice not found or voided.');
    if (inv.status === 'paid') throw httpError(400, 'This invoice is already paid.');
    const f = req.file;
    if (!f) throw httpError(400, 'Choose the receipt file.');
    const isPdf = f.buffer.slice(0, 5).toString('latin1') === '%PDF-';
    const img = detectImageType(f.buffer);
    if (!isPdf && !['image/png', 'image/jpeg'].includes(img)) throw httpError(400, 'Upload the receipt as a PDF, PNG or JPG.');
    const external = String(req.body.external_number || '').trim().slice(0, 60);
    if (!external) throw httpError(400, "Enter the receipt number from your workplace's system.");
    const fields = paymentFields(req.body, inv);
    const ext = isPdf ? 'pdf' : img === 'image/png' ? 'png' : 'jpg';
    const url = await storage.uploadSignedContract(inv.ref || 'billing', f.buffer, `receipt.${ext}`, isPdf ? 'application/pdf' : img, `receipt-upload-${Date.now()}`);
    const rc = await db.createReceipt({
      number: `EXT-${external}`.slice(0, 70), external_number: external, invoice_id: inv.id, request_id: inv.request_id, ref: inv.ref,
      company: inv.company, email: inv.email, ...fields, source: 'uploaded', file_url: url,
    });
    const fullyPaid = await settle(inv);
    if (req.body.send === 'true') await mail.sendReceiptEmail({ receipt: rc, pdf: f.buffer, filename: `Receipt-${external}.${ext}` });
    res.json({ receipt: rc, fullyPaid });
  }));

  // ---------- Rebuild a PDF with the current layout + signature (same number and amounts) ----------
  // The PDF saved when a document was issued never changes on its own, so layout fixes or a
  // signature added later need this. Optionally re-sends the refreshed copy to the client.
  router.post('/api/admin/invoices/:id/rebuild', adminAuth, wrap(async (req, res) => {
    const inv = await db.getInvoice(req.params.id);
    if (!inv) throw httpError(404, 'Invoice not found.');
    // The PDF carries no "VOID" mark, so a rebuilt void invoice would look payable
    if (inv.status === 'void') throw httpError(400, "A voided invoice can't be rebuilt. Issue a new invoice instead.");
    const pdf = await billing.invoicePdf(inv);
    const url = await storage.uploadSignedContract(inv.ref || 'billing', pdf, `${inv.number}.pdf`, 'application/pdf', `invoice-${inv.number}-r${Date.now()}`);
    const updated = await db.updateInvoice(inv.id, { pdf_url: url });
    // Only an unpaid invoice is re-sent: emailing a paid one asks the client to pay twice
    const emailed = req.body && req.body.send === true && inv.status === 'issued';
    if (emailed) await mail.sendInvoiceEmail({ invoice: updated, pdf });
    res.json({ ...updated, emailed });
  }));

  router.post('/api/admin/receipts/:id/rebuild', adminAuth, wrap(async (req, res) => {
    const receipts = (await db.listReceipts()) || [];
    const rc = receipts.find((r) => r.id === req.params.id);
    if (!rc) throw httpError(404, 'Receipt not found.');
    if (rc.source !== 'generated') throw httpError(400, "Uploaded receipts came from another system, so there's nothing to rebuild.");
    const inv = rc.invoice_id ? await db.getInvoice(rc.invoice_id) : null;
    const pdf = await billing.receiptPdf(rc, inv);
    const url = await storage.uploadSignedContract(rc.ref || 'billing', pdf, `${rc.number}.pdf`, 'application/pdf', `receipt-${rc.number}-r${Date.now()}`);
    const updated = await db.updateReceiptFile(rc.id, url);
    if (req.body && req.body.send === true) await mail.sendReceiptEmail({ receipt: { ...rc, file_url: url }, pdf });
    res.json(updated);
  }));

  // ---------- The document trail for a request ----------
  router.get('/api/admin/trail/:requestId', adminAuth, wrap(async (req, res) => {
    const p = await db.getProjectById(req.params.requestId).catch(() => null);
    if (!p) throw httpError(404, 'Request not found.');
    const [invoices, receipts] = await Promise.all([db.listInvoicesForRequest(p.id), db.listReceiptsForRequest(p.id)]);
    res.json({ ref: p.project_id, company: p.company_name, trail: buildTrail(p, invoices || [], receipts || []) });
  }));

  // ---------- Your pre-applied signature (owner) ----------
  router.post('/api/admin/settings/signature', adminAuth, ownerOnly, wrap(async (req, res) => {
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
    const buffer = m ? Buffer.from(m[2], 'base64') : null;
    if (!buffer || buffer.length > 1024 * 1024 || !['image/png', 'image/jpeg'].includes(detectImageType(buffer))) throw httpError(400, 'Draw your signature, or upload a PNG or JPG under 1 MB.');
    let img = null;
    // A malformed PNG can send pdfkit into an endless loop: walk its chunks first (see pngChunksOk)
    if (m[1] === 'png' && !pngChunksOk(buffer)) throw httpError(400, "That image couldn't be used. Draw it again, or upload one no larger than 3000 pixels on each side.");
    try { img = new PDFDocument().openImage(buffer); } catch { /* unreadable: refused below */ }
    // Also refuse huge claimed dimensions: they would use gigabytes of memory when decoded
    if (!img || img.width > 3000 || img.height > 3000) throw httpError(400, "That image couldn't be used. Draw it again, or upload one no larger than 3000 pixels on each side.");
    const name = String(req.body.name || '').trim().slice(0, 80);
    const title = String(req.body.title || '').trim().slice(0, 80);
    if (!name) throw httpError(400, 'Add the name to print under the signature.');
    const url = await storage.uploadSignedContract('settings', buffer, `signature.${m[1] === 'png' ? 'png' : 'jpg'}`, `image/${m[1]}`, 'signature');
    await db.setSetting('signature', { url, name, title });
    signature.setSignatureCache({ buffer, name, title, url });
    res.json({ set: true, name, title, url });
  }));

  router.delete('/api/admin/settings/signature', adminAuth, ownerOnly, wrap(async (req, res) => {
    await db.setSetting('signature', null);
    signature.setSignatureCache(null);
    res.json({ set: false });
  }));

  return router;
};
