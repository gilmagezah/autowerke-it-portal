require('dotenv').config();
const express = require('express');
// Before any route: async handlers that reject reach the error handler instead of crashing the app
require('./lib/asyncErrors').installProcessHandlers();
const path = require('path');
const multer = require('multer');
const db = require('./lib/db');
const auth = require('./lib/auth');
const { adminAuth } = auth;
const sec = require('./lib/security');
const esign = require('./lib/esign');
const fxRates = require('./lib/fxRates');
const { PORT, BASE_URL } = require('./lib/routeHelpers');
const { portalExpired, PORTAL_DAYS } = require('./lib/portal');
const reminders = require('./lib/reminderRoutes');

// The order below matters (DEVELOPMENT.md, "Middleware order"): security headers, host routing and the
// same-origin check first; private-file link rewriting before every router; then the routers;
// then rate limits and the portal-expiry check ahead of the feature routes that need them.
const app = express();

app.set('trust proxy', 1); // behind Render's proxy: real client IPs for rate limiting
app.disable('x-powered-by');
app.use(sec.securityHeaders);
app.use(require('./lib/hosts').hostRouting); // admin site on its own host when ADMIN_URL is set
app.use(express.json({ limit: '2mb' }));
app.use('/api', sec.sameOrigin);

// ---------- Private files (BEFORE every router, so all JSON responses get rewritten links) ----------
const fileAccess = require('./lib/fileAccess');
app.use(fileAccess(auth.currentAdmin));
app.use('/api/admin', fileAccess.rewriteJson());
// Every route a client reaches with their portal link (the token is a UUID in the path)
const PORTAL_ROUTE = /^\/api\/(confirm|contract|estimate|signoff)\/[0-9a-f-]{36}/i;
const portalToken = (req) => (req.originalUrl.match(/^\/api\/(?:confirm|contract|estimate|signoff)\/([0-9a-f-]{36})/i) || [])[1] || null;
app.use(PORTAL_ROUTE, fileAccess.rewriteJson(portalToken));

// ---------- Secure sign-in, online sign-off, and the workspace ----------
auth.setLoginCodeSender((args) => require('./lib/email').sendAdminLoginCode(args));
esign.setMailer({
  sendSignoffCode: (args) => require('./lib/email').sendSignoffCode(args),
  sendSignedOnlineEmails: (args) => require('./lib/email').sendSignedOnlineEmails(args),
});
app.use(auth.router);
app.use(esign.router);
app.use(require('./lib/workspace')(adminAuth));

// ---------- Billing: invoices, receipts, document trail, your signature ----------
app.use(require('./lib/billingRoutes')(adminAuth, auth.ownerOnly, require('./lib/email')));

// ---------- Admin accessories: reminders, synced notes, currency rates (BUILD-LOG 29) ----------
app.use(require('./lib/accessoriesRoutes')(adminAuth));

// ---------- Rate limits on public endpoints ----------
const limit = (name, max, minutes) => (req, res, next) => {
  const r = sec.rateLimit(`${name}:${sec.clientIp(req)}`, { limit: max, windowMs: minutes * 60 * 1000 });
  if (r.allowed) return next();
  res.set('Retry-After', String(r.retryAfterSec));
  return res.status(429).json({ error: `Too many requests. Please wait ${Math.ceil(r.retryAfterSec / 60)} minute(s) and try again.` });
};
app.use('/api/submit', limit('submit', 8, 15));
app.use('/api/track', limit('track', 20, 15));
app.use(/^\/api\/(confirm|contract|estimate)\//, limit('portal', 90, 15));
app.use(/^\/api\/signoff\/[0-9a-f-]{36}/i, limit('portal', 90, 15)); // the sign-off PDF (identify/verify have their own limits)

// ---------- Portal links expire 30 days after the request is finished ----------
// (the same rule closes file links: lib/portal.js)
app.use(PORTAL_ROUTE, async (req, res, next) => {
  try {
    const p = await db.getProjectByToken(portalToken(req));
    if (portalExpired(p)) {
      return res.status(410).json({ error: `This link has expired. Links stay active until ${PORTAL_DAYS} days after a request is finished. You can still check its status on the tracking page.`, expired: true });
    }
  } catch { /* unknown token: the route itself answers */ }
  next();
});

// Speed: compressed responses, images cached for a week, CSS/JS for 10 minutes, pages always revalidated
app.use(require('compression')());
app.use('/brand', express.static(path.join(__dirname, 'public', 'brand'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '10m',
  setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));

// ---------- Feature routes, one file each in lib/ ----------
app.use(require('./lib/publicRoutes'));       // site settings, legal pages, intake form, tracking
app.use(require('./lib/pipelineRoutes'));     // admin pipeline: review, pricing, estimates, hours, support
app.use(require('./lib/deliveryRoutes'));     // project delivery phases and the sign-off document
app.use(require('./lib/earningsRoutes'));     // earnings and project values
app.use(require('./lib/portalRoutes'));       // the client's private portal link
app.use(require('./lib/followupRoutes'));     // payment follow-ups
app.use(require('./lib/contactRoutes'));      // contacts directory and Quick find
app.use(require('./lib/domainRoutes'));       // domain requests, registry and renewals
app.use(require('./lib/consultancyRoutes'));  // consultancy replies and meetings
app.use(reminders.router);                    // the cron ping that runs the reminders

// ---------- Admin: database health (drives the warning banner) ----------
app.get('/api/admin/health', adminAuth, async (req, res) => {
  try {
    res.json(await db.schemaStatus({ fresh: req.query.fresh === '1' }));
  } catch (err) {
    res.json({ ok: false, messages: [`Could not check the database: ${err.message}`] });
  }
});

// ---------- Not found (after every route) ----------
app.use((req, res) => {
  if (req.method === 'GET' && !req.originalUrl.startsWith('/api/') && (req.get('accept') || '').includes('text/html')) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.status(404).json({ error: 'Not found.' });
});

// ---------- Error handling (must come after all routes) ----------
// Upload problems get a clear message the client portal can show...
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    const isIntake = req.path === '/api/submit';
    let error = `Upload problem: ${err.message}`;
    if (tooBig) error = isIntake ? 'One of the files is too large. Images can be up to 5 MB and text files up to 1 MB.' : 'That file is too large. The maximum is 10 MB - try a smaller scan or a PDF.';
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') error = 'You can attach up to 4 files.';
    return res.status(tooBig ? 413 : 400).json({ error });
  }
  return next(err);
});

// ...and anything unexpected returns plain JSON, never an HTML page with internal details
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong on our side. Please try again.' : err.message });
});

app.listen(PORT, async () => {
  console.log(`Project intake system running at ${BASE_URL}`);
  // Catch a missed schema file or stale Supabase cache now, not mid-workflow
  try {
    const status = await db.schemaStatus({ fresh: true });
    if (status.ok) console.log('Database schema: OK');
    else {
      console.warn('\n!! Database needs attention:');
      status.messages.forEach((m) => console.warn(`   - ${m}`));
      console.warn('');
    }
  } catch (err) {
    console.warn(`Database schema check skipped: ${err.message}`);
  }

  // Your pre-applied signature, loaded once into memory for the PDF generators
  require('./lib/signature').loadSignature().then((s) => { if (s) console.log('Pre-applied signature loaded.'); });

  // Payment reminder check, once a minute while the app is awake
  setInterval(() => {
    reminders.runReminders().catch((err) => console.warn(`Reminder check failed: ${err.message}`));
    fxRates.refresh().catch((err) => console.warn(`Currency rates refresh failed: ${err.message}`));
  }, 60 * 1000);
});

module.exports = { app, runReminders: reminders.runReminders };
