// Admin accessories API: personal reminders (+ suggestions), synced notes, saved notes, and shared
// currency rates (automatic every 12 hours, ZiG by hand). Every route is admin-only. Reminders and
// notes belong to the signed-in admin: each query names their id, so nobody can read or change
// someone else's. Notes (pages and saved ones, titles included) are encrypted with CREDENTIALS_KEY.
//
// Needs schema_accessories.sql (reminders, notes, saved notes). Currency rates use app_settings.
const express = require('express');
const db = require('./db');
const { encryptSecret, decryptSecret, credentialsConfigured } = require('./secrets');
const R = require('./reminders');
const fx = require('./fxRates');
const { reminderTimeZone } = require('./followups');
const Debrief = require('./debrief');
const { businessCard } = require('./businessCard');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  const status = err.status || 500;
  // Admin API: the real message is fine here (DEVELOPMENT.md), but a missing table gets a clear hint
  const missing = /admin_reminders|admin_notes|admin_saved_notes/.test(err.message || '') && /does not exist|could not find|schema cache/i.test(err.message || '');
  if (status === 500 && !missing) console.error('Accessories API:', err.message);
  res.status(missing ? 503 : status).json({ error: missing ? 'Run schema_accessories.sql in Supabase to turn this on.' : err.message });
});
const MAX_PAGES = 9;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkId = (req, what = 'Reminder') => { if (!UUID.test(String(req.params.id))) throw httpError(404, `${what} not found.`); };
const MAX_SAVED = 200;
// A saved note's title: the one you typed, or its first line (a leading [date] stamp skipped)
function titleOf(text, given) {
  const t = typeof given === 'string' ? given.replace(/\s+/g, ' ').trim() : '';
  if (t) return t.slice(0, 100);
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const unstamped = line.replace(/^\[[^\]]{1,40}\]\s*/, '');
  return (unstamped || line || 'Untitled note').slice(0, 80);
}
function savedText(b) {
  if (typeof b.text !== 'string' || !b.text.trim()) throw httpError(400, 'There’s nothing on this page to save.');
  if (b.text.length > 20000) throw httpError(400, 'A note can hold up to 20,000 characters.');
  return b.text;
}
const MAX_CHARS = 20000;

module.exports = function accessoriesRoutes(adminAuth) {
  const router = express.Router();
  router.use('/api/admin/reminders', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // ---------- Reminders ----------
  const withLocal = (r) => ({ ...r, local: R.local(r.due_at) });

  router.get('/api/admin/reminders', adminAuth, wrap(async (req, res) => {
    const open = (await db.listReminders(req.admin.id)) || [];
    if (req.query.due === '1') {
      // The background check every page makes: just what's due now
      const now = Date.now();
      return res.json({ due: open.filter((r) => new Date(r.due_at).getTime() <= now).map(withLocal), open: open.length });
    }
    const done = (await db.listRecentDoneReminders(req.admin.id, new Date(Date.now() - 7 * 86400000).toISOString())) || [];
    res.json({ reminders: open.map(withLocal), done: done.map(withLocal), timezone: reminderTimeZone(), today: R.localToday() });
  }));

  router.post('/api/admin/reminders', adminAuth, wrap(async (req, res) => {
    const fields = R.cleanReminder(req.body || {});
    if ((await db.countOpenReminders(req.admin.id)) >= R.MAX_OPEN) throw httpError(400, `You have ${R.MAX_OPEN} open reminders. Tick some off first.`);
    if (fields.source) {
      const open = (await db.listReminders(req.admin.id)) || [];
      if (open.some((r) => r.source === fields.source)) throw httpError(409, 'You already have a reminder for that.');
    }
    const r = await db.createReminder({ email: true, ...fields, admin_id: req.admin.id });
    res.json(withLocal(r));
  }));

  router.patch('/api/admin/reminders/:id', adminAuth, wrap(async (req, res) => {
    checkId(req);
    const b = req.body || {};
    let fields = {};
    if (b.done === true) fields.done_at = new Date().toISOString();
    else if (b.done === false) fields.done_at = null;
    if (b.snooze !== undefined) {
      const mins = Number(b.snooze);
      if (![15, 60, 180, 1440].includes(mins)) throw httpError(400, 'Snooze for 15 minutes, 1 hour, 3 hours or 1 day.');
      fields.due_at = new Date(Date.now() + mins * 60000).toISOString();
      fields.emailed_at = null; // a snoozed reminder emails again when it comes back
    }
    if (['title', 'note', 'ref', 'email', 'date', 'time'].some((k) => b[k] !== undefined)) {
      const clean = R.cleanReminder(b, { partial: true });
      if (clean.due_at) clean.emailed_at = null;
      fields = { ...fields, ...clean };
    }
    if (!Object.keys(fields).length) throw httpError(400, 'Nothing to change.');
    const r = await db.updateReminder(req.params.id, req.admin.id, fields);
    if (!r) throw httpError(404, 'Reminder not found.');
    res.json(withLocal(r));
  }));

  router.delete('/api/admin/reminders/:id', adminAuth, wrap(async (req, res) => {
    checkId(req);
    await db.deleteReminder(req.params.id, req.admin.id);
    res.json({ success: true });
  }));

  router.get('/api/admin/reminders/suggestions', adminAuth, wrap(async (req, res) => {
    const [projects, invoices, registry, open] = await Promise.all([
      db.listForReminders().catch(() => []),
      db.listInvoices().catch(() => []),
      db.listRegistry().catch(() => []),
      db.listReminders(req.admin.id).catch(() => []),
    ]);
    const taken = new Set((open || []).map((r) => r.source).filter(Boolean));
    res.json({ suggestions: R.suggestReminders({ projects: projects || [], invoices: invoices || [], registry: registry || [], taken }) });
  }));

  // ---------- Notes (encrypted with CREDENTIALS_KEY) ----------
  router.get('/api/admin/notes', adminAuth, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!credentialsConfigured()) return res.json({ configured: false });
    const row = await db.getNotes(req.admin.id);
    if (!row) return res.json({ configured: true, pages: null, updated_at: null });
    let pages;
    try { pages = JSON.parse(decryptSecret(row.pages_enc)); } catch { throw httpError(500, 'Your saved notes could not be decrypted (has CREDENTIALS_KEY changed?).'); }
    res.json({ configured: true, pages, updated_at: row.updated_at });
  }));

  router.put('/api/admin/notes', adminAuth, wrap(async (req, res) => {
    if (!credentialsConfigured()) return res.status(400).json({ configured: false, error: 'Set CREDENTIALS_KEY to keep notes in your account.' });
    const b = req.body || {};
    if (!Array.isArray(b.pages) || !b.pages.length || b.pages.length > MAX_PAGES) throw httpError(400, `Notes are 1 to ${MAX_PAGES} pages.`);
    const pages = b.pages.map((p) => {
      if (!p || typeof p.text !== 'string') throw httpError(400, 'Each page needs its text.');
      if (p.text.length > MAX_CHARS) throw httpError(400, `A page can hold up to ${MAX_CHARS.toLocaleString('en-US')} characters.`);
      const page = { text: p.text, at: Number.isFinite(Number(p.at)) ? Number(p.at) : Date.now() };
      // Which saved note this page is (so Save updates it rather than making a copy)
      if (typeof p.savedId === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(p.savedId)) page.savedId = p.savedId;
      if (Number.isFinite(Number(p.savedAt)) && p.savedAt) page.savedAt = Number(p.savedAt);
      return page;
    });
    // Saved from another device since this one last loaded? Send that back instead of overwriting it
    const current = await db.getNotes(req.admin.id);
    if (current && b.base !== current.updated_at && !b.force) {
      let theirs = null;
      try { theirs = JSON.parse(decryptSecret(current.pages_enc)); } catch { /* unreadable: allow overwrite below */ }
      if (theirs) return res.status(409).json({ error: 'Your notes changed on another device.', pages: theirs, updated_at: current.updated_at });
    }
    const saved = await db.saveNotes(req.admin.id, encryptSecret(JSON.stringify(pages)), new Date().toISOString());
    res.json({ updated_at: saved.updated_at });
  }));

  // ---------- Saved notes ("Save" / "See saved notes" in the notepad) ----------
  // A stored row -> what the notepad shows. `plain` skips decrypting what we just encrypted.
  const openSaved = (row, { full = false, plain = null } = {}) => {
    let title; let body;
    try {
      title = plain ? plain.title : decryptSecret(row.title_enc);
      body = plain ? plain.text : row.body_enc ? decryptSecret(row.body_enc) : '';
    } catch { title = '(could not be decrypted: has CREDENTIALS_KEY changed?)'; body = ''; }
    const rest = body.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
    return { id: row.id, title, ...(full ? { text: body } : { preview: (rest || body).slice(0, 140) }), chars: row.chars, created_at: row.created_at, updated_at: row.updated_at };
  };
  router.use('/api/admin/notes/saved', adminAuth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!credentialsConfigured()) return res.status(req.method === 'GET' ? 200 : 400).json({ configured: false, error: 'Set CREDENTIALS_KEY to keep saved notes in your account.' });
    next();
  });
  router.get('/api/admin/notes/saved', adminAuth, wrap(async (req, res) => {
    const rows = (await db.listSavedNotes(req.admin.id)) || [];
    res.json({ configured: true, notes: rows.map((r) => openSaved(r)), max: MAX_SAVED });
  }));
  router.get('/api/admin/notes/saved/:id', adminAuth, wrap(async (req, res) => {
    checkId(req, 'Saved note');
    const row = await db.getSavedNote(req.params.id, req.admin.id);
    if (!row) throw httpError(404, 'Saved note not found.');
    res.json(openSaved(row, { full: true }));
  }));
  router.post('/api/admin/notes/saved', adminAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const text = savedText(b);
    if ((await db.countSavedNotes(req.admin.id)) >= MAX_SAVED) throw httpError(400, `You have ${MAX_SAVED} saved notes. Delete some old ones first.`);
    const now = new Date().toISOString();
    const title = titleOf(text, b.title);
    const row = await db.createSavedNote({ admin_id: req.admin.id, title_enc: encryptSecret(title), body_enc: encryptSecret(text), chars: text.length, created_at: now, updated_at: now });
    res.json(openSaved(row, { plain: { title, text } }));
  }));
  router.put('/api/admin/notes/saved/:id', adminAuth, wrap(async (req, res) => {
    checkId(req, 'Saved note');
    const b = req.body || {};
    const text = savedText(b);
    const title = titleOf(text, b.title);
    const row = await db.updateSavedNote(req.params.id, req.admin.id, { title_enc: encryptSecret(title), body_enc: encryptSecret(text), chars: text.length, updated_at: new Date().toISOString() });
    if (!row) throw httpError(404, 'Saved note not found.');
    res.json(openSaved(row, { plain: { title, text } }));
  }));
  router.delete('/api/admin/notes/saved/:id', adminAuth, wrap(async (req, res) => {
    checkId(req, 'Saved note');
    await db.deleteSavedNote(req.params.id, req.admin.id);
    res.json({ success: true });
  }));

  // ---------- Debrief (lib/debrief.js): your own email of where everything stands ----------
  router.use('/api/admin/debrief', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const debriefState = (admin, settings) => ({
    to: admin.email,
    autoMonday: settings.autoMonday,
    autoHour: Debrief.AUTO_HOUR,
    lastSentAt: settings.lastSentAt,
    nextAt: Debrief.nextSendAt(settings),
    cooldownMinutes: Debrief.COOLDOWN_MS / 60000,
  });
  router.get('/api/admin/debrief', adminAuth, wrap(async (req, res) => {
    const [settings, preview] = await Promise.all([Debrief.getSettings(req.admin.id), Debrief.gather(req.admin.id)]);
    res.json({ ...debriefState(req.admin, settings), preview });
  }));
  const sending = new Set(); // a double click can't slip two emails past the cool-down
  router.post('/api/admin/debrief/send', adminAuth, wrap(async (req, res) => {
    const settings = await Debrief.getSettings(req.admin.id);
    const nextAt = Debrief.nextSendAt(settings);
    if (nextAt || sending.has(req.admin.id)) {
      const mins = nextAt ? Math.max(1, Math.ceil((new Date(nextAt) - Date.now()) / 60000)) : 1;
      return res.status(429).json({ error: `You can send another debrief in ${mins} minute${mins === 1 ? '' : 's'}.`, nextAt });
    }
    sending.add(req.admin.id);
    try {
      const debrief = await Debrief.gather(req.admin.id);
      await require('./email').sendDebriefEmail({ to: req.admin.email, name: req.admin.name, debrief, baseUrl: process.env.BASE_URL });
      const saved = { ...(await Debrief.getSettings(req.admin.id)), lastSentAt: new Date().toISOString() };
      await Debrief.saveSettings(req.admin.id, saved);
      res.json({ ...debriefState(req.admin, saved), sent: true, preview: debrief });
    } finally {
      sending.delete(req.admin.id);
    }
  }));
  router.put('/api/admin/debrief/settings', adminAuth, wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.autoMonday !== 'boolean') throw httpError(400, 'Say whether to send it every Monday (true or false).');
    const saved = { ...(await Debrief.getSettings(req.admin.id)), autoMonday: b.autoMonday };
    await Debrief.saveSettings(req.admin.id, saved);
    res.json(debriefState(req.admin, saved));
  }));

  // ---------- Business card (lib/businessCard.js): details to copy, certifications ----------
  router.get('/api/admin/business-card', adminAuth, (req, res) => {
    res.set('Cache-Control', 'no-store'); // bank details: never kept in a shared cache
    res.json(businessCard());
  });

  // ---------- Currency rates (shared by every admin; lib/fxRates.js) ----------
  // Automatic every 12 hours (ECB + ExchangeRate-API); ZiG is set by hand
  router.get('/api/admin/fx-rates', adminAuth, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let s = await fx.load();
    if (fx.isDue(s)) {
      // Due for a refresh: wait a few seconds for it, otherwise answer with what we have
      s = await Promise.race([fx.refresh().catch(() => s), new Promise((r) => setTimeout(() => r(s), 6000))]);
    }
    res.json(fx.view(s));
  }));
  router.put('/api/admin/fx-rates', adminAuth, wrap(async (req, res) => {
    const s = await fx.setManual((req.body || {}).rates, req.admin.name);
    res.json(fx.view(s));
  }));
  router.post('/api/admin/fx-rates/refresh', adminAuth, wrap(async (req, res) => {
    const s = await fx.refresh({ force: true });
    res.json(fx.view(s));
  }));

  return router;
};
