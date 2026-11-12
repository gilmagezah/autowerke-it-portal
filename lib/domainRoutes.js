// Admin domains: requests, quotes, the registry (encrypted passwords), renewal emails.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const domainsLib = require('./domains');
const { encryptSecret, decryptSecret, credentialsConfigured } = require('./secrets');
const { sendDomainQuoteEmail, sendDomainCompleteEmail, sendRenewalEmailToClient } = require('./email');
const db = require('./db');
const { adminAuth } = require('./auth');
const { brandName } = require('./brand');
const { BASE_URL, VIEWS } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: domains ----------

router.get('/admin/domains', adminAuth, (req, res) => res.sendFile(path.join(VIEWS, 'domains.html')));

// Passwords are never included in lists - only whether one is stored
function safeRegistry(r) {
  const { account_password_enc, ...rest } = r;
  const draftForThisRenewal = r.renewal_email && r.renewal_email.prepared_for === r.renewal_date;
  const sentForThisRenewal = r.renewal_email_sent_for && r.renewal_email_sent_for === r.renewal_date;
  return {
    ...rest,
    has_password: Boolean(account_password_enc),
    days_left: domainsLib.daysUntil(r.renewal_date),
    renewal_quote: domainsLib.renewalQuote(r),
    renewal_email_ready: Boolean(draftForThisRenewal && !sentForThisRenewal),
    renewal_email_sent: Boolean(sentForThisRenewal),
  };
}

// The saved draft for the current renewal date, or a fresh one from the latest details
function renewalDraftFor(r) {
  if (r.renewal_email && r.renewal_email.prepared_for === r.renewal_date) {
    return { subject: r.renewal_email.subject, body: r.renewal_email.body, saved: true };
  }
  return { ...domainsLib.defaultRenewalEmail(r, brandName()), saved: false };
}

router.get('/api/admin/domains', adminAuth, async (req, res) => {
  try {
    const [requests, registry] = await Promise.all([
      db.listByType('Domains', ['domain_requested', 'domain_quoted', 'domain_accepted', 'domain_registered']),
      db.listRegistry(),
    ]);
    res.json({ requests, registry: registry.map(safeRegistry), credentialsConfigured: credentialsConfigured(), vatRate: Number(process.env.VAT_RATE || 15.5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/domains/requests/:id/quote', adminAuth, async (req, res) => {
  let quote;
  try { quote = domainsLib.buildQuote(req.body.quote); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const p = await db.getProjectById(req.params.id);
    if (p.request_type !== 'Domains' || !['domain_requested', 'domain_quoted'].includes(p.status)) {
      return res.status(400).json({ error: 'This request is not waiting on a quote.' });
    }
    const project = await db.updateProject(p.id, { domain_quote: quote, status: 'domain_quoted' });
    await sendDomainQuoteEmail({ project, baseUrl: BASE_URL });
    res.json({ success: true, quote });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/domains/requests/:id/registered', adminAuth, async (req, res) => {
  try {
    const p = await db.getProjectById(req.params.id);
    if (p.request_type !== 'Domains' || p.status !== 'domain_accepted') return res.status(400).json({ error: 'Only accepted requests can be marked registered.' });
    // completed_at is the earnings date for the service fee
    const project = await db.updateProject(p.id, { status: 'domain_registered', completed_at: new Date().toISOString() });
    const records = (await db.listRegistry()).filter((r) => r.request_id === p.id);
    await sendDomainCompleteEmail({ project, records });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function registryFields(body, { isNew }) {
  const fields = domainsLib.sanitizeRegistry(body);
  if (typeof body.password === 'string' && body.password.length) fields.account_password_enc = encryptSecret(body.password.slice(0, 500));
  else if (body.clear_password === true) fields.account_password_enc = null;
  if (!isNew) { delete fields.request_id; }
  return fields;
}

router.post('/api/admin/domains/registry', adminAuth, async (req, res) => {
  let fields;
  try { fields = registryFields(req.body, { isNew: true }); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  try {
    res.json(safeRegistry(await db.createRegistry(fields)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/admin/domains/registry/:id', adminAuth, async (req, res) => {
  let fields;
  try { fields = registryFields(req.body, { isNew: false }); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  try {
    res.json(safeRegistry(await db.updateRegistry(req.params.id, fields)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/domains/registry/:id', adminAuth, async (req, res) => {
  try { await db.deleteRegistry(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Decrypt on explicit request only. Never cached, never logged.
router.post('/api/admin/domains/registry/:id/reveal', adminAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const r = await db.getRegistry(req.params.id);
    // Same audit trail as workspace secrets: who and which record, never the value
    if (r.account_password_enc) console.log(`Registry password revealed: ${r.domain || r.id} by ${req.admin.email}`);
    res.json({ username: r.account_username, password: r.account_password_enc ? decryptSecret(r.account_password_enc) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Renewal email: open, save, send ----------

router.get('/api/admin/domains/registry/:id/renewal-email', adminAuth, async (req, res) => {
  try {
    const r = await db.getRegistry(req.params.id);
    if (!r.renewal_date) return res.status(400).json({ error: 'Set a renewal date first.' });
    res.json({ ...renewalDraftFor(r), to: r.client_email, quote: domainsLib.renewalQuote(r), sentAt: r.renewal_email_sent_for === r.renewal_date ? r.renewal_email_sent_at : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function cleanEmailBody(b) {
  return { subject: String(b.subject || '').trim().slice(0, 200), body: String(b.body || '').trim().slice(0, 8000) };
}

router.put('/api/admin/domains/registry/:id/renewal-email', adminAuth, async (req, res) => {
  const { subject, body } = cleanEmailBody(req.body);
  if (!subject || body.length < 10) return res.status(400).json({ error: 'The email needs a subject and a message.' });
  try {
    const r = await db.getRegistry(req.params.id);
    if (!r.renewal_date) return res.status(400).json({ error: 'Set a renewal date first.' });
    await db.updateRegistry(r.id, { renewal_email: { subject, body, prepared_for: r.renewal_date, prepared_at: new Date().toISOString() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/domains/registry/:id/renewal-email/send', adminAuth, async (req, res) => {
  const { subject, body } = cleanEmailBody(req.body);
  if (!subject || body.length < 10) return res.status(400).json({ error: 'The email needs a subject and a message.' });
  try {
    const r = await db.getRegistry(req.params.id);
    if (!r.client_email) return res.status(400).json({ error: 'Add the client email to this domain first.' });
    if (!r.renewal_date) return res.status(400).json({ error: 'Set a renewal date first.' });
    await sendRenewalEmailToClient({ record: r, subject, body });
    const now = new Date().toISOString();
    const updated = await db.updateRegistry(r.id, {
      renewal_email: { subject, body, prepared_for: r.renewal_date, prepared_at: now },
      renewal_email_sent_for: r.renewal_date,
      renewal_email_sent_at: now,
    });
    res.json(safeRegistry(updated));
  } catch (err) {
    console.error('Renewal email failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Renewal done: move the date on a year (reminders reset automatically for the new date)
router.post('/api/admin/domains/registry/:id/renewed', adminAuth, async (req, res) => {
  try {
    const r = await db.getRegistry(req.params.id);
    if (!r.renewal_date) return res.status(400).json({ error: 'Set a renewal date first.' });
    res.json(safeRegistry(await db.updateRegistry(r.id, { renewal_date: domainsLib.addYear(r.renewal_date) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
