// Admin project delivery: phases, progress emails, closing, and the sign-off document.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const { sendProgressUpdateEmail, sendSignoffEmail } = require('./email');
const db = require('./db');
const { adminAuth } = require('./auth');
const { emailLayout } = require('./brand');
const { createDefaultPhases, sanitizePhases } = require('./phases');
const { buildProgressUpdateHtml } = require('./progress');
const { defaultSignoff, sanitizeSignoff, generateSignoffPdf } = require('./signoff');
const { BASE_URL, VIEWS } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: project delivery (internal phase tracking) ----------

router.get('/admin/projects', adminAuth, (req, res) => {
  res.sendFile(path.join(VIEWS, 'delivery.html'));
});

router.get('/api/admin/delivery', adminAuth, async (req, res) => {
  try {
    res.json(await db.listDelivery());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Loads a project and confirms it's an IT Project in delivery.
// Closed projects are read-only, so edits are rejected unless allowClosed.
async function getDeliveryProject(id, { allowClosed = false } = {}) {
  const project = await db.getProjectById(id);
  const allowed = allowClosed ? ['signed', 'delivered', 'closed'] : ['signed', 'delivered'];
  if (project.request_type !== 'IT Project' || !allowed.includes(project.status)) {
    const err = new Error(project.status === 'closed'
      ? 'This project is closed and can no longer be edited.'
      : 'Phase tracking is only for signed IT projects.');
    err.status = 400;
    throw err;
  }
  return project;
}

function cleanMessage(v) {
  return String(v || '').trim().slice(0, 2000);
}

router.post('/api/admin/projects/:id/phases/init', adminAuth, async (req, res) => {
  try {
    const project = await getDeliveryProject(req.params.id);
    // Never overwrite phases that already exist
    if (project.phases && project.phases.length) {
      return res.json({ phases: project.phases });
    }
    const updated = await db.savePhases(project.id, createDefaultPhases());
    res.json({ phases: updated.phases });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/api/admin/projects/:id/phases', adminAuth, async (req, res) => {
  let phases;
  try {
    phases = sanitizePhases(req.body.phases);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const project = await getDeliveryProject(req.params.id);
    const updated = await db.savePhases(project.id, phases);
    res.json({ phases: updated.phases });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Preview uses the phases currently on screen (even if unsaved)
router.post('/api/admin/projects/:id/update-preview', adminAuth, async (req, res) => {
  try {
    const project = await getDeliveryProject(req.params.id);
    const phases = req.body.phases ? sanitizePhases(req.body.phases) : project.phases;
    const html = buildProgressUpdateHtml({
      project: { ...project, phases },
      message: cleanMessage(req.body.message),
      baseUrl: BASE_URL,
    });
    res.type('html').send(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Email preview</title></head>` +
      `<body style="margin:0;">${emailLayout(html, BASE_URL)}</body></html>`
    );
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/send-update', adminAuth, async (req, res) => {
  try {
    const project = await getDeliveryProject(req.params.id);
    if (!project.phases || project.phases.length === 0) {
      return res.status(400).json({ error: 'Set up phases before sending an update.' });
    }
    await sendProgressUpdateEmail({ project, message: cleanMessage(req.body.message), baseUrl: BASE_URL });
    const updated = await db.markProgressUpdateSent(project.id);
    res.json({ success: true, lastSentAt: updated.last_progress_update_at });
  } catch (err) {
    console.error('Send progress update failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Manual close - for when the client signs on paper / outside the portal.
// Normally a project closes itself when the client uploads the signed sign-off.
router.post('/api/admin/projects/:id/close', adminAuth, async (req, res) => {
  try {
    const project = await getDeliveryProject(req.params.id);
    const updated = await db.markClosed(project.id);
    res.json({ success: true, closedAt: updated.closed_at });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ---------- Admin: sign-off document ----------

function allPhasesDone(project) {
  const phases = project.phases || [];
  return phases.length > 0 && phases.every((p) => p.done);
}

// Default content for the editor (pre-filled from the project)
router.get('/api/admin/projects/:id/signoff/defaults', adminAuth, async (req, res) => {
  try {
    const project = await getDeliveryProject(req.params.id);
    res.json(defaultSignoff(project));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/api/admin/projects/:id/signoff', adminAuth, async (req, res) => {
  let signoff;
  try {
    signoff = sanitizeSignoff(req.body.signoff);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    await getDeliveryProject(req.params.id);
    const updated = await db.saveSignoff(req.params.id, signoff);
    res.json({ signoff: updated.signoff });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Preview renders whatever is in the editor right now (saved or not)
router.post('/api/admin/projects/:id/signoff/preview', adminAuth, async (req, res) => {
  let signoff;
  try {
    signoff = sanitizeSignoff(req.body.signoff);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const project = await getDeliveryProject(req.params.id);
    const pdf = await generateSignoffPdf({ project, signoff });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${project.project_id}-sign-off-preview.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/api/admin/projects/:id/signoff/send', adminAuth, async (req, res) => {
  let signoff;
  try {
    signoff = sanitizeSignoff(req.body.signoff);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const project = await getDeliveryProject(req.params.id);
    if (!allPhasesDone(project)) {
      return res.status(400).json({ error: 'Tick off every phase (and save) before sending the sign-off.' });
    }
    const pdfBuffer = await generateSignoffPdf({ project, signoff });
    const updated = await db.markSignoffSent(project.id, signoff);
    await sendSignoffEmail({ project: updated, pdfBuffer, baseUrl: BASE_URL });
    res.json({ success: true, sentAt: updated.signoff_sent_at });
  } catch (err) {
    console.error('Send sign-off failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
