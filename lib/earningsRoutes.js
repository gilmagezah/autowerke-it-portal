// Admin earnings: the analytics page and editing a project's value.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const db = require('./db');
const { adminAuth } = require('./auth');
const { VIEWS, parseMoney } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: earnings ----------

router.get('/admin/earnings', adminAuth, (req, res) => {
  res.sendFile(path.join(VIEWS, 'earnings.html'));
});

router.get('/api/admin/analytics', adminAuth, async (req, res) => {
  try {
    const rows = await db.listForAnalytics();
    res.json({ vatRate: Number(process.env.VAT_RATE || 15.5), rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/admin/projects/:id/value', adminAuth, async (req, res) => {
  const contractValue = parseMoney(req.body.contractValue);
  if (contractValue === null) return res.status(400).json({ error: 'Enter the value (excl. VAT) as a number.' });
  try {
    const p = await db.getProjectById(req.params.id);
    if (p.request_type !== 'IT Project') {
      return res.status(400).json({ error: 'Support ticket values come from hours x rate.' });
    }
    const updated = await db.setContractValue(req.params.id, contractValue, req.body.vatApplicable !== false);
    res.json({ contractValue: updated.contract_value, vatApplicable: updated.vat_applicable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
