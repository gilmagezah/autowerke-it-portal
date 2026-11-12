// Admin pipeline: review, pricing, estimates, logged hours, support sign-off,
// converting a ticket into a project, and project titles.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const { suggestProjectTitle, cleanTitle } = require('./ai');
const { sendClientConfirmationEmail, sendPricingEmail, sendEstimateEmail, sendConversionEmail, sendSupportSignoffEmail } = require('./email');
const db = require('./db');
const { adminAuth } = require('./auth');
const { buildStats } = require('./stats');
const { supportBilling, generateSupportSignoffPdf } = require('./supportSignoff');
const { BASE_URL, VIEWS, parseMoney } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: password-protected dashboard ----------
router.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(VIEWS, 'admin.html'));
});

router.get('/api/admin/projects', adminAuth, async (req, res) => {
  try {
    const [pending, changesRequested, awaitingPricing, awaitingEstimate, inProgress, awaitingSupportSignoff] = await Promise.all([
      db.listPendingReview(),
      db.listChangesRequested(),
      db.listAwaitingPricing(),
      db.listAwaitingEstimate(),
      db.listInProgress(),
      db.listAwaitingSupportSignoff(),
    ]);
    // Attach the billing summary so the admin cards can show hours + totals
    awaitingSupportSignoff.forEach((p) => { p.billing = supportBilling(p); });
    inProgress.forEach((p) => { p.billing = supportBilling(p); });
    res.json({ pending, changesRequested, awaitingPricing, awaitingEstimate, inProgress, awaitingSupportSignoff, vatRate: Number(process.env.VAT_RATE || 15.5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const rows = await db.listAllForStats();
    res.json(buildStats(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/approve', adminAuth, async (req, res) => {
  const { requirements, scopeSummary, revised } = req.body;
  const title = cleanTitle(req.body.title || '');

  try {
    const project = await db.approveProject(req.params.id, { requirements, scopeSummary, title });
    await sendClientConfirmationEmail({ project, baseUrl: BASE_URL, revised: Boolean(revised) });
    res.json({ success: true });
  } catch (err) {
    console.error('Approve failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});



router.post('/api/admin/projects/:id/send-pricing', adminAuth, async (req, res) => {
  const { pricingEstimate } = req.body;
  const contractValue = parseMoney(req.body.contractValue);
  const vatApplicable = req.body.vatApplicable !== false;

  if (!pricingEstimate) {
    return res.status(400).json({ error: 'Pricing estimate is required.' });
  }
  if (contractValue === null) {
    return res.status(400).json({ error: 'Enter the contract value (excl. VAT) as a number.' });
  }

  try {
    const project = await db.sendPricing(req.params.id, pricingEstimate, { contractValue, vatApplicable });
    await sendPricingEmail({ project, baseUrl: BASE_URL });
    res.json({ success: true });
  } catch (err) {
    console.error('Send pricing failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/send-estimate', adminAuth, async (req, res) => {
  const { estimatedHours, hourlyRate } = req.body;

  if (!estimatedHours || !hourlyRate) {
    return res.status(400).json({ error: 'Estimated hours and hourly rate are both required.' });
  }

  try {
    const project = await db.sendEstimate(req.params.id, { estimatedHours, hourlyRate });
    await sendEstimateEmail({ project, baseUrl: BASE_URL });
    res.json({ success: true });
  } catch (err) {
    console.error('Send estimate failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/log-hours', adminAuth, async (req, res) => {
  const { date, start, end } = req.body;
  const note = String(req.body.note || '').slice(0, 500);

  if (!date || !start || !end) {
    return res.status(400).json({ error: 'Date, start, and end are required.' });
  }
  // The Log hours form and the support timer both send YYYY-MM-DD and 24-hour HH:MM
  // (typeof checks: ["09:00"] would otherwise pass as "09:00" and be stored as an array)
  const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || !isTime(start) || !isTime(end)) {
    return res.status(400).json({ error: 'Use a date like 2026-11-05 and times like 09:30.' });
  }
  // Billing counts an entry that doesn't end after it starts as 0 minutes, so refuse it here
  if (end <= start) {
    return res.status(400).json({ error: 'The end time must be after the start time (log work past midnight as two entries).' });
  }

  try {
    const project = await db.addWorkLogEntry(req.params.id, { date, start, end, note });
    res.json({ success: true, workLog: project.work_log });
  } catch (err) {
    console.error('Log hours failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/projects/:id/log-hours/:entryId', adminAuth, async (req, res) => {
  try {
    const project = await db.removeWorkLogEntry(req.params.id, req.params.entryId);
    res.json({ success: true, workLog: project.work_log });
  } catch (err) {
    console.error('Remove log entry failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Loads a support ticket and checks it's at one of the expected stages
async function getSupportTicket(id, statuses) {
  const p = await db.getProjectById(id);
  if (p.request_type !== 'IT Support' || !statuses.includes(p.status)) {
    const err = new Error(`This only works for support tickets that are ${statuses.join(' or ').replace(/_/g, ' ')}.`);
    err.status = 400;
    throw err;
  }
  return p;
}

// Work done: lock in the hours, email the completion sign-off PDF, wait for the signed copy
router.post('/api/admin/projects/:id/complete', adminAuth, async (req, res) => {
  try {
    const ticket = await getSupportTicket(req.params.id, ['in_progress']);
    const billing = supportBilling(ticket);
    if (!billing.rate || !billing.billableHours) {
      return res.status(400).json({ error: 'No hours logged and no approved estimate to bill - log the time first.' });
    }
    const pdfBuffer = await generateSupportSignoffPdf({ project: ticket });
    const updated = await db.markSupportSignoffSent(ticket.id);
    await sendSupportSignoffEmail({ project: updated, pdfBuffer, billing, baseUrl: BASE_URL });
    res.json({ success: true, billing });
  } catch (err) {
    console.error('Complete + send sign-off failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/api/admin/projects/:id/support-signoff/preview', adminAuth, async (req, res) => {
  try {
    const ticket = await getSupportTicket(req.params.id, ['in_progress', 'awaiting_signoff', 'completed']);
    const pdf = await generateSupportSignoffPdf({ project: ticket, date: ticket.signoff_sent_at || new Date() });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${ticket.project_id}-support-sign-off.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/support-signoff/resend', adminAuth, async (req, res) => {
  try {
    const ticket = await getSupportTicket(req.params.id, ['awaiting_signoff']);
    const billing = supportBilling(ticket);
    const pdfBuffer = await generateSupportSignoffPdf({ project: ticket, date: ticket.signoff_sent_at });
    await sendSupportSignoffEmail({ project: ticket, pdfBuffer, billing, baseUrl: BASE_URL });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// For a client who signed some other way (e.g. on paper)
router.post('/api/admin/projects/:id/close-support', adminAuth, async (req, res) => {
  try {
    const ticket = await getSupportTicket(req.params.id, ['awaiting_signoff']);
    const updated = await db.markCompleted(ticket.id);
    res.json({ success: true, completedAt: updated.completed_at });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ---------- Admin: convert a support ticket into a project ----------

router.post('/api/admin/projects/:id/convert', adminAuth, async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 2000);
  if (reason.length < 10) {
    return res.status(400).json({ error: 'Please explain to the client why (at least a sentence).' });
  }
  try {
    const { project, previousStatus } = await db.convertToProject(req.params.id, reason);
    await sendConversionEmail({ project, previousStatus, reason, baseUrl: BASE_URL });
    res.json({ success: true, status: project.status });
  } catch (err) {
    console.error('Convert failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ---------- Admin: project titles ----------

router.patch('/api/admin/projects/:id/title', adminAuth, async (req, res) => {
  const title = cleanTitle(req.body.title || '');
  if (!title) return res.status(400).json({ error: 'Title cannot be empty.' });
  try {
    const project = await db.setProjectTitle(req.params.id, title);
    res.json({ title: project.project_title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/suggest-title', adminAuth, async (req, res) => {
  try {
    const p = await db.getProjectById(req.params.id);
    const title = await suggestProjectTitle({
      requestType: p.request_type,
      details: p.details,
      scopeSummary: p.reviewed_scope_summary || p.ai_scope_summary,
      requirements: p.reviewed_requirements || p.ai_requirements,
    });
    if (!title) throw new Error('Could not come up with a title - try typing one.');
    res.json({ title });
  } catch (err) {
    console.error('Suggest title failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
