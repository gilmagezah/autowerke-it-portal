// Admin consultancy: AI-drafted replies, meetings, closing.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const { draftConsultResponse } = require('./ai');
const consultLib = require('./consult');
const { sendConsultResponseEmail, sendMeetingConfirmedEmail } = require('./email');
const db = require('./db');
const { adminAuth } = require('./auth');
const { brandName } = require('./brand');
const { BASE_URL, VIEWS } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: consultancy ----------

router.get('/admin/consultancy', adminAuth, (req, res) => res.sendFile(path.join(VIEWS, 'consultancy.html')));

router.get('/api/admin/consultancy', adminAuth, async (req, res) => {
  try {
    res.json({ items: await db.listByType('Consultancy') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getConsult(id, statuses) {
  const p = await db.getProjectById(id);
  if (p.request_type !== 'Consultancy' || (statuses && !statuses.includes(p.status))) {
    const e = new Error('This consultancy request is not at that stage.'); e.status = 400; throw e;
  }
  return p;
}

router.post('/api/admin/consultancy/:id/redraft', adminAuth, async (req, res) => {
  try {
    const p = await getConsult(req.params.id, ['consult_requested']);
    const draft = await draftConsultResponse({ companyName: p.company_name, contactName: p.name, details: p.details, brand: brandName() });
    await db.updateProject(p.id, { consult_draft: draft.response });
    res.json({ draft: draft.response, suggestMeeting: draft.suggestMeeting });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/api/admin/consultancy/:id/respond', adminAuth, async (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 10000);
  if (body.length < 20) return res.status(400).json({ error: 'The response is empty.' });
  const inviteMeeting = req.body.invite_meeting === true;
  const feeNum = Number(String(req.body.fee ?? '').replace(/[,\s$]/g, ''));
  const fee = Number.isFinite(feeNum) && feeNum > 0 ? Math.round(feeNum * 100) / 100 : 0; // 0 = free
  try {
    const p = await getConsult(req.params.id, ['consult_requested']);
    const project = await db.updateProject(p.id, {
      consult_response: body,
      consult_fee: fee,
      status: inviteMeeting ? 'consult_meeting_invited' : 'consult_answered',
    });
    await sendConsultResponseEmail({ project, body, inviteMeeting, fee, baseUrl: BASE_URL });
    res.json({ success: true, status: project.status });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/api/admin/consultancy/:id/confirm', adminAuth, async (req, res) => {
  try {
    const p = await getConsult(req.params.id, ['consult_meeting_requested']);
    let confirmed;
    try { confirmed = consultLib.buildConfirmation(p.consult_meeting, req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ics = consultLib.buildIcs({
      uid: `${p.id}@autowerkeit.com`,
      confirmed,
      title: `Discovery ${confirmed.type === 'online' ? 'meeting' : 'call'}: ${p.company_name} x ${brandName()}`,
      description: `Reference ${p.project_id}\n${p.project_title || ''}${confirmed.link ? `\nJoin: ${confirmed.link}` : ''}`,
      organizerName: brandName(),
      organizerEmail: (process.env.BRAND_EMAIL || 'services@autowerkeit.com').trim(),
      attendees: [p.email, ...(confirmed.recipients || [])],
    });
    const project = await db.updateProject(p.id, { consult_confirmed: confirmed, status: 'consult_meeting_confirmed' });
    await sendMeetingConfirmedEmail({ project, confirmed, ics });
    res.json({ success: true, confirmed });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/api/admin/consultancy/:id/close', adminAuth, async (req, res) => {
  try {
    await getConsult(req.params.id);
    await db.updateProject(req.params.id, { status: 'consult_closed' });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
