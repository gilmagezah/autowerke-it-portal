// Reminder scheduler: payment, renewal and admin reminders plus Monday debriefs.
// runReminders() runs every minute while awake (server.js) and on the cron ping below.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const domainsLib = require('./domains');
const { sendReminderDigest, sendRenewalDigest, sendAdminReminderEmail, sendClientRenewalReminder } = require('./email');
const db = require('./db');
const sec = require('./security');
const followups = require('./followups');
const remindersLib = require('./reminders');
const fxRates = require('./fxRates');
const { brandName } = require('./brand');
const { BASE_URL, withSchedule } = require('./routeHelpers');

const router = express.Router();

// ---------- Reminder scheduler ----------
// Checks every minute while the app is awake. On hosts that sleep when idle
// (e.g. Render's free tier), also point a free cron service at
//   GET /api/cron/reminders?key=YOUR_CRON_SECRET
// every 15 minutes: it wakes the app and runs the same check.

let reminderRunning = false;
async function runReminders(now = new Date()) {
  if (reminderRunning) return { skipped: true };
  reminderRunning = true;
  try {
    let sent = 0;
    const due = await db.listDueReminders(now);
    if (due.length) {
      await sendReminderDigest({ items: due.map(withSchedule), baseUrl: BASE_URL, now });
      // Schedule each one's next reminder from now (so a missed window never fires repeatedly)
      for (const fu of due) {
        const next = followups.nextReminderAt(followups.scheduleOf(fu), now);
        await db.updateFollowUp(fu.id, { last_reminded_at: now.toISOString(), next_reminder_at: next ? next.toISOString() : null });
      }
      console.log(`Reminder digest sent for ${due.length} payment(s).`);
      sent += due.length;
    }

    // Domain renewals: each renewal date is reminded about once per audience
    const renewals = domainsLib.dueRenewalReminders(await db.listRegistry(), now);
    if (renewals.admin.length) {
      // Prepare (and save) a ready-to-send renewal email for each, unless one already exists for this date
      for (const r of renewals.admin) {
        const hasDraft = r.renewal_email && r.renewal_email.prepared_for === r.renewal_date;
        const alreadySent = r.renewal_email_sent_for === r.renewal_date;
        if (!hasDraft && !alreadySent && r.client_email) {
          const draft = domainsLib.defaultRenewalEmail(r, brandName());
          r.renewal_email = { ...draft, prepared_for: r.renewal_date, prepared_at: now.toISOString() };
        }
        r.renewal_email_ready = Boolean(r.renewal_email && r.renewal_email.prepared_for === r.renewal_date && !alreadySent);
        r.renewal_total = domainsLib.renewalQuote(r).total;
      }
      await sendRenewalDigest({ items: renewals.admin, baseUrl: BASE_URL });
      for (const r of renewals.admin) {
        await db.updateRegistry(r.id, { admin_reminded_for: r.renewal_date, ...(r.renewal_email ? { renewal_email: r.renewal_email } : {}) });
      }
      sent += renewals.admin.length;
    }
    for (const r of renewals.client) {
      await sendClientRenewalReminder({ record: r });
      await db.updateRegistry(r.id, { client_reminded_for: r.renewal_date });
      sent += 1;
    }

    // Admins' own reminders (Dates & reminders accessory): one email per admin. Kept last and
    // self-contained, so a missing schema_accessories.sql can't stop the reminders above.
    try {
      const due = (await db.listDueAdminReminders(now)) || [];
      const byAdmin = new Map();
      for (const r of due) {
        if (!r.admin || !r.admin.active || !r.admin.email) continue;
        if (!byAdmin.has(r.admin_id)) byAdmin.set(r.admin_id, { admin: r.admin, items: [] });
        const l = remindersLib.local(r.due_at);
        byAdmin.get(r.admin_id).items.push({ ...r, whenText: `${l.date} ${l.time}` });
      }
      for (const { admin, items } of byAdmin.values()) {
        try {
          await sendAdminReminderEmail({ to: admin.email, name: admin.name, items, baseUrl: BASE_URL });
          await db.markRemindersEmailed(items.map((r) => r.id), now.toISOString());
          sent += items.length;
        } catch (e) { console.error('Admin reminder email failed:', e.message); }
      }
    } catch (e) {
      if (!/admin_reminders/.test(e.message || '')) console.error('Admin reminders check failed:', e.message);
    }

    // Monday debriefs (Debrief accessory), for admins who turned them on. Self-contained too.
    try {
      const r = await require('./debrief').runAuto({
        now,
        send: ({ admin, debrief, auto }) => require('./email').sendDebriefEmail({ to: admin.email, name: admin.name, debrief, baseUrl: BASE_URL, auto }),
      });
      sent += r.sent;
    } catch (e) { console.error('Monday debrief check failed:', e.message); }
    return { sent };
  } finally {
    reminderRunning = false;
  }
}

router.all('/api/cron/reminders', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(404).json({ error: 'Cron endpoint disabled - set CRON_SECRET to enable it.' });
  // Header only: a key in the URL ends up in proxy and cron-service logs. Compared in constant time.
  if (req.query.key !== undefined) return res.status(400).json({ error: 'Send the key in an X-Cron-Key header, not in the URL.' });
  if (!sec.safeEqual(req.get('x-cron-key') || '', secret)) return res.status(401).json({ error: 'Bad key.' });
  // Currency rates for the converter: only fetches once 12 hours have passed (lib/fxRates.js).
  // Not awaited, so a slow rates site never holds up the reminders.
  fxRates.refresh().catch((e) => console.warn(`Currency rates refresh failed: ${e.message}`));
  try {
    res.json(await runReminders());
  } catch (err) {
    console.error('Reminder run failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, runReminders };
