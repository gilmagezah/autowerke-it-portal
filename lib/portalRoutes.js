// Client portal, reached with the private link token: confirm, download documents,
// and upload signed copies (checked by content, stored privately).
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const consultLib = require('./consult');
const { sendAdminNotification, sendMeetingRequestedAdmin } = require('./email');
const db = require('./db');
const { generateContractPdf } = require('./contract');
const { generateEstimatePdf } = require('./estimate');
const { supportBilling, generateSupportSignoffPdf } = require('./supportSignoff');
const { generateSignoffPdf } = require('./signoff');
const { detectSignedDocument } = require('./attachments');
const { BASE_URL, ROOT, upload, SIGNED_DOC_ERROR, storeSignedDocument, publicError } = require('./routeHelpers');

const router = express.Router();

// ---------- Public: client's ongoing portal link ----------
router.get('/confirm/:token', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'confirm.html'));
});

router.get('/api/confirm/:token', async (req, res) => {
  try {
    const project = await db.getProjectByToken(req.params.token);
    if (project.status === 'pending_review') {
      return res.status(404).json({ error: 'This request has not been reviewed yet.' });
    }
    res.json({
      projectId: project.project_id,
      companyName: project.company_name,
      requestType: project.request_type,
      status: project.status,
      requirements: project.reviewed_requirements,
      scopeSummary: project.reviewed_scope_summary,
      pricingEstimate: project.pricing_estimate,
      signedContractUrl: project.signed_contract_url,
      estimatedHours: project.estimated_hours,
      hourlyRate: project.hourly_rate,
      // The estimate as it would be billed (same maths as the PDF and the final sign-off)
      estimate: project.request_type === 'IT Support' && Number(project.estimated_hours) > 0
        ? (({ subtotal, vatApplies, vatRate, vat, total }) => ({ subtotal, vatApplies, vatRate, vat, total }))(supportBilling({ ...project, work_log: [] }))
        : undefined,
      workLog: project.work_log,
      projectTitle: project.project_title,
      signoffSentAt: project.signoff_sent_at,
      signoffSignedAt: project.signoff_signed_at,
      closedAt: project.closed_at,
      completedAt: project.completed_at,
      domains: project.domains,
      domainService: project.domain_service,
      domainQuote: project.domain_quote,
      consultMeeting: project.consult_meeting,
      consultConfirmed: project.consult_confirmed,
      billing: project.request_type === 'IT Support' && ['awaiting_signoff', 'completed'].includes(project.status)
        ? (({ loggedHours, billableHours, usedEstimate, rate, subtotal, vatApplies, vatRate, vat, total }) =>
            ({ loggedHours, billableHours, usedEstimate, rate, subtotal, vatApplies, vatRate, vat, total }))(supportBilling(project))
        : undefined,
    });
  } catch (err) {
    res.status(404).json({ error: 'Project not found for this link.' });
  }
});

router.post('/api/confirm/:token', async (req, res) => {
  const { action, message } = req.body;

  // Every action names the stage(s) it's allowed from, so a portal link can't jump a request
  // backwards or forwards (e.g. "decline" a signed project, or "proceed" without a price).
  // Anything else gets 409 "This link is not expecting that action right now."
  try {
    if (action === 'confirm') {
      const project = await db.updateByToken(req.params.token, { status: 'client_confirmed' }, ['reviewed']);
      await sendAdminNotification({ project, event: 'client_confirmed' });
      return res.json({ success: true });
    }

    if (action === 'request_changes') {
      const project = await db.updateByToken(req.params.token,
        { status: 'changes_requested', change_request: String(message || '').trim().slice(0, 4000) }, ['reviewed']);
      await sendAdminNotification({ project, event: 'changes_requested' });
      return res.json({ success: true });
    }

    if (action === 'proceed') {
      const project = await db.updateByToken(req.params.token, { status: 'proceeding' }, ['pricing_sent']);
      await sendAdminNotification({ project, event: 'proceeding' });
      return res.json({ success: true });
    }

    if (action === 'decline') {
      const project = await db.updateByToken(req.params.token, { status: 'declined' }, ['pricing_sent']);
      await sendAdminNotification({ project, event: 'declined' });
      return res.json({ success: true });
    }

    if (action === 'accept_domain_quote') {
      const project = await db.updateByToken(req.params.token, { status: 'domain_accepted' }, ['domain_quoted']);
      await sendAdminNotification({ project, event: 'domain_accepted' });
      return res.json({ success: true });
    }

    if (action === 'decline_domain_quote') {
      const project = await db.updateByToken(req.params.token, { status: 'declined' }, ['domain_quoted']);
      await sendAdminNotification({ project, event: 'declined' });
      return res.json({ success: true });
    }

    if (action === 'meeting_prefs') {
      let prefs;
      try { prefs = consultLib.sanitizeMeetingPrefs(req.body.prefs); } catch (e) { return res.status(400).json({ error: e.message }); }
      const project = await db.updateByToken(req.params.token, { status: 'consult_meeting_requested', consult_meeting: prefs },
        ['consult_meeting_invited', 'consult_meeting_requested']);
      await sendMeetingRequestedAdmin({ project, baseUrl: BASE_URL });
      return res.json({ success: true });
    }

    if (action === 'approve_estimate') {
      // Approval now happens by uploading the signed estimate (see upload-estimate)
      return res.status(400).json({ error: 'Please download the estimate, sign it, and upload the signed copy to approve.' });
    }

    if (action === 'decline_estimate') {
      const project = await db.updateByToken(req.params.token, { status: 'declined' }, ['estimate_sent']);
      await sendAdminNotification({ project, event: 'declined' });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('Confirm action failed:', err.message);
    publicError(res, err);
  }
});

// ---------- Public: contract / estimate document downloads ----------
router.get('/api/contract/:token', async (req, res) => {
  try {
    const project = await db.getProjectByToken(req.params.token);
    if (!['proceeding', 'signed'].includes(project.status)) {
      return res.status(403).json({ error: 'Contract is not available yet.' });
    }
    const pdfBuffer = await generateContractPdf(project);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${project.project_id}-contract.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Contract generation failed:', err.message);
    publicError(res, err, 'We could not prepare your contract. Please try again.');
  }
});

router.get('/api/estimate/:token', async (req, res) => {
  try {
    const project = await db.getProjectByToken(req.params.token);
    if (!['estimate_sent', 'in_progress', 'completed'].includes(project.status)) {
      return res.status(403).json({ error: 'Estimate is not available yet.' });
    }
    const pdfBuffer = await generateEstimatePdf(project);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${project.project_id}-estimate.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Estimate generation failed:', err.message);
    publicError(res, err, 'We could not prepare your estimate. Please try again.');
  }
});

// ---------- Public: sign-off download + signed copy upload ----------

router.get('/api/signoff/:token', async (req, res) => {
  try {
    const project = await db.getProjectByToken(req.params.token);
    if (project.request_type === 'IT Support') {
      if (!project.signoff_sent_at || !['awaiting_signoff', 'completed'].includes(project.status)) {
        return res.status(403).json({ error: 'The sign-off document is not available yet.' });
      }
      const pdf = await generateSupportSignoffPdf({ project, date: project.signoff_sent_at });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${project.project_id}-support-sign-off.pdf"`);
      return res.send(pdf);
    }
    if (!project.signoff_sent_at || !project.signoff) {
      return res.status(403).json({ error: 'The sign-off document is not available yet.' });
    }
    const pdf = await generateSignoffPdf({ project, signoff: project.signoff, date: project.signoff_sent_at });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${project.project_id}-sign-off.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('Sign-off download failed:', err.message);
    publicError(res, err, 'We could not prepare the sign-off document. Please try again.');
  }
});

// Upload routes check the link before reading anything: a made-up link never gets a 10 MB
// file buffered into memory (the route then checks the stage as before)
async function portalLinkFirst(req, res, next) {
  try {
    await db.getProjectByToken(req.params.token);
  } catch {
    return res.status(404).json({ error: 'Project not found for this link.' });
  }
  next();
}

router.post('/api/confirm/:token/upload-signoff', portalLinkFirst, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!detectSignedDocument(req.file.buffer)) return res.status(400).json({ error: SIGNED_DOC_ERROR });

  try {
    const project = await db.getProjectByToken(req.params.token);
    if (project.request_type === 'IT Support') {
      if (project.status === 'completed') return res.status(403).json({ error: 'This ticket is already signed off.' });
      if (project.status !== 'awaiting_signoff') {
        return res.status(403).json({ error: 'Not expecting a signed sign-off at this stage.' });
      }
      const url = await storeSignedDocument(project, req.file, 'support-signoff-signed');
      const updated = await db.markSupportSignoffSigned(req.params.token, url);
      await sendAdminNotification({ project: updated, event: 'support_signoff_signed' });
      return res.json({ success: true });
    }
    if (project.status === 'closed') {
      return res.status(403).json({ error: 'This project is already closed.' });
    }
    if (!['signed', 'delivered'].includes(project.status) || !project.signoff_sent_at) {
      return res.status(403).json({ error: 'Not expecting a signed sign-off at this stage.' });
    }
    const url = await storeSignedDocument(project, req.file, 'signoff-signed');
    const updated = await db.markSignoffSigned(req.params.token, url);
    await sendAdminNotification({ project: updated, event: 'signoff_signed' });
    res.json({ success: true });
  } catch (err) {
    console.error('Sign-off upload failed:', err.message);
    publicError(res, err, 'We could not save your file. Please try again.');
  }
});

// ---------- Public: signed support estimate upload (= approval to start work) ----------

router.post('/api/confirm/:token/upload-estimate', portalLinkFirst, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!detectSignedDocument(req.file.buffer)) return res.status(400).json({ error: SIGNED_DOC_ERROR });
  try {
    const project = await db.getProjectByToken(req.params.token);
    if (project.request_type !== 'IT Support' || project.status !== 'estimate_sent') {
      return res.status(403).json({ error: 'Not expecting a signed estimate at this stage.' });
    }
    const url = await storeSignedDocument(project, req.file, 'estimate-signed');
    const updated = await db.markEstimateSigned(req.params.token, url);
    await sendAdminNotification({ project: updated, event: 'estimate_approved' });
    res.json({ success: true });
  } catch (err) {
    console.error('Estimate upload failed:', err.message);
    publicError(res, err, 'We could not save your file. Please try again.');
  }
});

// ---------- Public: signed contract upload ----------
router.post('/api/confirm/:token/upload-signed', portalLinkFirst, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  if (!detectSignedDocument(req.file.buffer)) return res.status(400).json({ error: SIGNED_DOC_ERROR });

  try {
    const project = await db.getProjectByToken(req.params.token);
    if (project.status !== 'proceeding') {
      return res.status(403).json({ error: 'Not expecting a signed contract at this stage.' });
    }

    const url = await storeSignedDocument(project, req.file, 'signed');
    const updated = await db.markSigned(req.params.token, url);
    await sendAdminNotification({ project: updated, event: 'signed' });

    res.json({ success: true });
  } catch (err) {
    console.error('Signed upload failed:', err.message);
    publicError(res, err, 'We could not save your file. Please try again.');
  }
});

module.exports = router;
