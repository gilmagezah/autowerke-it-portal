// Debrief (the Debrief accessory): one email to an admin saying where everything stands.
//   - Ongoing work: requests where the ball is in our court (phase progress, hours logged)
//   - On hold: requests waiting on the client, longest wait first
//   - Your reminders: overdue and the next 7 days
//   - Money: unpaid invoices; Domains: renewals in the next 30 days
// Send it any time (30-minute cool-down per admin), and optionally have it sent every Monday from
// 07:00 Harare time. Settings live in app_settings under `debrief:<admin id>`.
const db = require('./db');
const Acc = require('../public/acc-core');
const { statusInfo } = require('../public/status-info');
const { reminderTimeZone, zonedParts } = require('./followups');
const R = require('./reminders');
const { duration } = require('./track');

const COOLDOWN_MS = 30 * 60 * 1000;
const AUTO_HOUR = 7; // Mondays from 07:00 in REMINDER_TIMEZONE
const settingKey = (adminId) => `debrief:${adminId}`;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

async function getSettings(adminId) {
  const s = await db.getSetting(settingKey(adminId)).catch(() => null);
  return { autoMonday: false, lastSentAt: null, lastAutoFor: null, ...(s && typeof s === 'object' ? s : {}) };
}
const saveSettings = (adminId, s) => db.setSetting(settingKey(adminId), {
  autoMonday: s.autoMonday === true, lastSentAt: s.lastSentAt || null, lastAutoFor: s.lastAutoFor || null,
});

// When the next "Send now" is allowed (null = now)
function nextSendAt(settings, now = new Date()) {
  const last = settings.lastSentAt ? new Date(settings.lastSentAt).getTime() : NaN;
  if (!Number.isFinite(last)) return null;
  const at = last + COOLDOWN_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}

// Phases can be done out of order: the one in progress is the first open phase after the last done
function phaseNow(phases) {
  const list = (Array.isArray(phases) ? phases : []).filter((p) => p && p.title);
  if (!list.length) return null;
  const done = list.filter((p) => p.done).length;
  const lastDone = list.reduce((at, p, i) => (p.done ? i : at), -1);
  let i = list.findIndex((p, k) => !p.done && k > lastDone);
  if (i === -1) i = list.findIndex((p) => !p.done);
  return { done, total: list.length, current: i === -1 ? null : String(list[i].title) };
}

function supportHours(p) {
  const days = require('./track').workDays(p.work_log);
  const mins = days.reduce((s, d) => s + d.minutes, 0);
  return { mins, last: days.length ? days[0].date : null, est: Number(p.estimated_hours) > 0 ? Number(p.estimated_hours) : null };
}

const shortDate = (iso) => {
  if (!Acc.isDate(String(iso || '').slice(0, 10))) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

// Everything the email (and the accessory's preview) shows. Pure: give it the rows.
function buildDebrief({ projects = [], invoices = [], reminders = [], registry = [], now = new Date(), timeZone = reminderTimeZone() }) {
  const today = R.localToday(now, timeZone);
  const daysSince = (iso) => (iso ? Math.max(0, Math.floor((now - new Date(iso)) / DAY)) : 0);
  const ongoing = []; const waiting = [];

  for (const p of projects) {
    const info = statusInfo(p.status, { requestType: p.request_type, signoffSentAt: p.signoff_sent_at, signoffSignedAt: p.signoff_signed_at });
    if (info.owner === 'done') continue;
    const row = { ref: p.project_id, company: p.company_name || '', title: p.project_title || p.request_type || '', label: info.label, days: daysSince(p.updated_at || p.created_at) };
    if (info.owner === 'you') { waiting.push(row); continue; }
    // Ball in our court (or a meeting both sides are going to)
    let detail = '';
    if (p.request_type === 'IT Project' && p.status === 'signed') {
      const ph = phaseNow(p.phases);
      if (ph) detail = `${ph.done} of ${ph.total} phases done${ph.current ? ` · now: ${ph.current}` : ''}`;
    } else if (p.request_type === 'IT Support' && p.status === 'in_progress') {
      const h = supportHours(p);
      detail = `${duration(h.mins)} logged${h.est ? ` of ${h.est}h estimated` : ''}${h.last ? ` · last worked ${shortDate(h.last)}` : ' · no time logged yet'}`;
    } else if (p.status === 'consult_meeting_confirmed' && p.consult_confirmed && p.consult_confirmed.start_utc) {
      const l = R.local(p.consult_confirmed.start_utc, timeZone);
      detail = `Meeting ${shortDate(l.date)} at ${l.time}`;
    }
    ongoing.push({ ...row, detail });
  }
  // Oldest untouched first: what's been sitting longest is what needs you
  ongoing.sort((a, b) => b.days - a.days);
  waiting.sort((a, b) => b.days - a.days);

  const soon = now.getTime() + 7 * DAY;
  const rem = reminders
    .filter((r) => !r.done_at && Number.isFinite(new Date(r.due_at).getTime()) && new Date(r.due_at).getTime() <= soon)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .map((r) => { const l = R.local(r.due_at, timeZone); return { title: r.title, ref: r.ref || null, when: `${shortDate(l.date)} ${l.time}`, overdue: new Date(r.due_at) <= now }; });

  const unpaid = invoices
    .filter((i) => i.status === 'issued')
    .map((i) => {
      const left = Acc.isDate(String(i.due_date || '')) ? Acc.daysBetween(today, i.due_date) : null;
      return { number: i.number, company: i.company, total: Math.round(Number(i.total || 0) * 100) / 100, due: i.due_date || null, left };
    })
    .sort((a, b) => (a.left ?? 9999) - (b.left ?? 9999));

  const renewals = registry
    .filter((r) => Acc.isDate(String(r.renewal_date || '')))
    .map((r) => ({ domain: r.domain, company: r.client_company || '', date: r.renewal_date, left: Acc.daysBetween(today, r.renewal_date) }))
    .filter((r) => r.left >= -7 && r.left <= 30)
    .sort((a, b) => a.left - b.left);

  return {
    today,
    ongoing, waiting, reminders: rem, invoices: unpaid, renewals,
    counts: {
      ongoing: ongoing.length, waiting: waiting.length, reminders: rem.length,
      overdueReminders: rem.filter((r) => r.overdue).length,
      unpaid: unpaid.length, unpaidTotal: Math.round(unpaid.reduce((s, i) => s + i.total, 0) * 100) / 100,
      overdueInvoices: unpaid.filter((i) => i.left !== null && i.left < 0).length,
      renewals: renewals.length,
    },
  };
}

// The rows for one admin, read fresh
async function gather(adminId, now = new Date()) {
  const [projects, invoices, reminders, registry] = await Promise.all([
    db.listForReminders().catch(() => []),
    db.listInvoices().catch(() => []),
    db.listReminders(adminId).catch(() => []),
    db.listRegistry().catch(() => []),
  ]);
  return buildDebrief({ projects: projects || [], invoices: invoices || [], reminders: reminders || [], registry: registry || [], now });
}

// Monday from 07:00 in the business timezone? Returns that Monday's date, or null.
function autoDay(now = new Date(), timeZone = reminderTimeZone()) {
  const p = zonedParts(now, timeZone);
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() === 1;
  return monday && p.hh >= AUTO_HOUR ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
}

// Called by the reminder check (every minute, and the cron ping). Sends each admin who turned on
// "every Monday" one debrief that Monday. `send({ admin, debrief, auto })` does the emailing.
let doneFor = null;
async function runAuto({ now = new Date(), send }) {
  const day = autoDay(now);
  if (!day || doneFor === day) return { sent: 0 };
  let sent = 0; let failed = false;
  for (const admin of (await db.listAdmins()) || []) {
    if (!admin.active || !admin.email) continue;
    const s = await getSettings(admin.id);
    if (!s.autoMonday || s.lastAutoFor === day) continue;
    try {
      await send({ admin, debrief: await gather(admin.id, now), auto: true });
      await saveSettings(admin.id, { ...s, lastAutoFor: day, lastSentAt: now.toISOString() });
      sent += 1;
    } catch (e) {
      failed = true; // try again on the next check
      console.error('Monday debrief failed:', e.message);
    }
  }
  if (!failed) doneFor = day;
  return { sent };
}
const resetAuto = () => { doneFor = null; };

module.exports = { COOLDOWN_MS, AUTO_HOUR, buildDebrief, gather, getSettings, saveSettings, nextSendAt, autoDay, runAuto, resetAuto, phaseNow };
