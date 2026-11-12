// Admin payment follow-ups: schedule, draft, send, mark paid, test reminder.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const { sendFollowupEmail, sendReminderDigest } = require('./email');
const db = require('./db');
const { adminAuth } = require('./auth');
const { supportBilling } = require('./supportSignoff');
const followups = require('./followups');
const { brandName } = require('./brand');
const { BASE_URL, VIEWS, withSchedule } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: payment follow-ups ----------

router.get('/admin/follow-ups', adminAuth, (req, res) => {
  res.sendFile(path.join(VIEWS, 'followups.html'));
});


router.get('/api/admin/follow-ups', adminAuth, async (req, res) => {
  try {
    const items = await db.listFollowUps();
    res.json({ items: items.map(withSchedule), timeZone: followups.reminderTimeZone() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Projects/tickets to pick from, with a suggested amount due (what the client owes, incl. VAT)
router.get('/api/admin/follow-ups/sources', adminAuth, async (req, res) => {
  try {
    const vatRate = Number(process.env.VAT_RATE || 15.5);
    const rows = await db.listFollowUpSources();
    res.json(rows.map((p) => {
      let amount = null;
      if (p.request_type === 'IT Support') {
        const b = supportBilling(p);
        amount = b.total || null;
      } else if (p.contract_value !== null && p.contract_value !== undefined) {
        const v = Number(p.contract_value);
        amount = Math.round((p.vat_applicable === false ? v : v * (1 + vatRate / 100)) * 100) / 100;
      }
      return {
        id: p.id, ref: p.project_id, title: p.project_title, company: p.company_name,
        contact: [p.name, p.surname].filter(Boolean).join(' '), email: p.email,
        type: p.request_type, status: p.status, amount,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/follow-ups', adminAuth, async (req, res) => {
  let fields;
  try { fields = followups.sanitizeFollowUp(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    res.json(withSchedule(await db.createFollowUp(fields)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/admin/follow-ups/:id', adminAuth, async (req, res) => {
  let fields;
  try { fields = followups.sanitizeFollowUp(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    res.json(withSchedule(await db.updateFollowUp(req.params.id, fields)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/follow-ups/:id', adminAuth, async (req, res) => {
  try {
    await db.deleteFollowUp(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/follow-ups/:id/paid', adminAuth, async (req, res) => {
  try {
    const fu = await db.updateFollowUp(req.params.id, { status: 'paid', paid_at: new Date().toISOString(), next_reminder_at: null });
    res.json(withSchedule(fu));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/follow-ups/:id/reopen', adminAuth, async (req, res) => {
  try {
    const cur = await db.getFollowUp(req.params.id);
    const next = cur.reminder_enabled ? followups.nextReminderAt(followups.scheduleOf(cur)).toISOString() : null;
    const fu = await db.updateFollowUp(req.params.id, { status: 'open', paid_at: null, next_reminder_at: next });
    res.json(withSchedule(fu));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pre-written follow-up email for the admin to review/edit before sending
router.get('/api/admin/follow-ups/:id/draft', adminAuth, async (req, res) => {
  try {
    res.json(followups.defaultFollowupEmail(await db.getFollowUp(req.params.id), brandName()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/follow-ups/:id/send', adminAuth, async (req, res) => {
  const subject = String(req.body.subject || '').trim().slice(0, 200);
  const body = String(req.body.body || '').trim().slice(0, 5000);
  if (!subject || body.length < 10) return res.status(400).json({ error: 'The email needs a subject and a message.' });
  try {
    const fu = await db.getFollowUp(req.params.id);
    if (fu.status !== 'open') return res.status(400).json({ error: 'This payment is marked as paid.' });
    await sendFollowupEmail({ followUp: fu, subject, body });
    const updated = await db.updateFollowUp(fu.id, {
      followups_sent: (fu.followups_sent || 0) + 1,
      last_followup_at: new Date().toISOString(),
    });
    res.json(withSchedule(updated));
  } catch (err) {
    console.error('Follow-up email failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Admin "send me a test reminder now" for the selected follow-up
router.post('/api/admin/follow-ups/:id/test-reminder', adminAuth, async (req, res) => {
  try {
    const fu = await db.getFollowUp(req.params.id);
    await sendReminderDigest({ items: [withSchedule(fu)], baseUrl: BASE_URL });
    res.json({ success: true, to: process.env.ADMIN_EMAIL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
