// Admin contacts directory, Quick find index and the directory PDF.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const db = require('./db');
const { adminAuth } = require('./auth');
const { VIEWS } = require('./routeHelpers');

const router = express.Router();

// ---------- Admin: contacts directory ----------

const { buildDirectory } = require('./directory');
const { generateDirectoryPdf } = require('./directoryPdf');
const { statusInfo } = require('../public/status-info');

router.get('/admin/contacts', adminAuth, (req, res) => res.sendFile(path.join(VIEWS, 'contacts.html')));

async function directoryData() {
  const [rows, registry] = await Promise.all([db.listForDirectory(), db.listRegistry().catch(() => [])]);
  return buildDirectory(rows, registry);
}

// Quick find (public/quickfind.js): every request, slimmed to what the search shows. Matching
// happens in the browser over this list, never as a pattern in a database query.
router.get('/api/admin/find-index', adminAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const rows = await db.listForDirectory();
    res.json({
      rows: (rows || []).map((r) => ({
        id: r.id,
        ref: r.project_id,
        title: r.project_title || '',
        company: r.company_name || '',
        contact: [r.name, r.surname].filter(Boolean).join(' ').trim(),
        email: r.email || '',
        phone: r.phone || '',
        type: r.request_type || '',
        status: r.status || '',
        statusLabel: statusInfo(r.status, { requestType: r.request_type, signoffSentAt: r.signoff_sent_at, signoffSignedAt: r.signoff_signed_at }).label,
        updated: r.updated_at || r.created_at || null,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/admin/directory', adminAuth, async (req, res) => {
  try { res.json({ companies: await directoryData() }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ?company=Hillburys for one company, or everything
router.get('/api/admin/directory/pdf', adminAuth, async (req, res) => {
  try {
    let companies = await directoryData();
    const want = String(req.query.company || '').trim().toLowerCase();
    if (want) companies = companies.filter((c) => c.company.toLowerCase() === want);
    if (!companies.length) return res.status(404).json({ error: 'No matching company.' });
    const title = want ? `${companies[0].company} contacts` : 'Client directory';
    const pdf = await generateDirectoryPdf(companies, { title });
    const slug = (want ? companies[0].company : 'client-directory').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.set('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (err) {
    console.error('Directory PDF failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
