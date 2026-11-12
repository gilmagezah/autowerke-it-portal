// Admin reminders (the Dates & reminders accessory): input checks, and suggested reminders built
// from what's happening in the business. Times are entered in REMINDER_TIMEZONE (Harare) even
// though the server runs on UTC (DEVELOPMENT.md gotcha 6).
const Acc = require('../public/acc-core');
const { statusInfo } = require('../public/status-info');
const { reminderTimeZone, zonedParts, zonedToUtc } = require('./followups');
const db = require('./db');

const MAX_OPEN = 50;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const pad = (n) => String(n).padStart(2, '0');

// Today's date in the business timezone
function localToday(now = new Date(), timeZone = reminderTimeZone()) {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
// "2026-11-06" + "09:00" in Harare -> the UTC instant
function at(date, time, timeZone = reminderTimeZone()) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, hh, mm, timeZone);
}
// A UTC instant -> { date, time } in Harare (for the form)
function local(iso, timeZone = reminderTimeZone()) {
  const p = zonedParts(new Date(iso), timeZone);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.hh)}:${pad(p.mm)}` };
}

// Body -> the fields to store. Throws a 400 with a plain message on bad input.
function cleanReminder(b, { now = new Date(), timeZone = reminderTimeZone(), partial = false } = {}) {
  const out = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (!partial || b.title !== undefined) {
    const title = str(b.title).replace(/\s+/g, ' ');
    if (!title) throw httpError(400, 'Give the reminder a title.');
    out.title = title.slice(0, 200);
  }
  if (b.note !== undefined) out.note = str(b.note).slice(0, 1000) || null;
  if (b.ref !== undefined) {
    const raw = str(b.ref);
    out.ref = raw ? db.cleanRef(raw) : null;
    if (raw && !out.ref) throw httpError(400, 'That reference doesn’t look right (e.g. TANNER-5422).');
  }
  if (b.email !== undefined) out.email = b.email === true;
  if (b.source !== undefined) out.source = str(b.source).slice(0, 120) || null;
  if (!partial || b.date !== undefined || b.time !== undefined) {
    const date = str(b.date); const time = str(b.time);
    if (!Acc.isDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw httpError(400, 'Choose a date and a time, e.g. 2026-11-06 at 09:00.');
    const due = at(date, time, timeZone);
    if (due.getTime() < now.getTime() - 60 * 1000) throw httpError(400, 'That time has already passed.');
    if (due.getTime() > now.getTime() + 3 * 366 * 86400000) throw httpError(400, 'Reminders can be up to 3 years ahead.');
    out.due_at = due.toISOString();
  }
  return out;
}

// ---------- Suggestions ----------
// Things worth a reminder that nothing else is already chasing for you. Each has a stable key, so
// once you've taken one up (or it's already a reminder) it isn't suggested again.
function suggestReminders({ projects = [], invoices = [], registry = [], taken = new Set(), now = new Date(), timeZone = reminderTimeZone() }) {
  const today = localToday(now, timeZone);
  const morning = Acc.nextWorkingDay(today); // next working day (skips weekends and holidays)
  const out = [];
  const add = (s) => { if (!taken.has(s.key)) out.push(s); };
  const ageDays = (iso) => (iso ? Math.floor((now - new Date(iso)) / 86400000) : 0);

  for (const p of projects) {
    const info = statusInfo(p.status, { requestType: p.request_type, signoffSentAt: p.signoff_sent_at, signoffSignedAt: p.signoff_signed_at });
    const age = ageDays(p.updated_at || p.created_at);

    // Waiting on the client for 3+ days
    if (info.owner === 'you' && age >= 3) {
      add({
        key: `nudge:${p.id}:${p.status}`, kind: 'nudge', urgency: age,
        title: `Nudge ${p.company_name}: ${info.label.toLowerCase()}`, ref: p.project_id,
        why: `Waiting on the client for ${age} days`, date: morning, time: '09:00',
      });
    }

    // A confirmed discovery meeting in the next 2 weeks: be ready an hour before
    const meet = p.status === 'consult_meeting_confirmed' && p.consult_confirmed && p.consult_confirmed.start_utc;
    if (meet) {
      const start = new Date(meet);
      const hoursAway = (start - now) / 3600000;
      if (hoursAway > 1.2 && hoursAway < 14 * 24) {
        const when = local(new Date(start.getTime() - 3600000).toISOString(), timeZone);
        add({
          key: `meet:${p.id}:${meet}`, kind: 'meeting', urgency: 100 - hoursAway / 24,
          title: `Prepare for ${p.company_name} discovery meeting`, ref: p.project_id,
          why: `Meeting ${local(meet, timeZone).date} at ${local(meet, timeZone).time}`, date: when.date, time: when.time,
        });
      }
    }

    // A support ticket in progress with no time logged for 5+ days
    if (p.request_type === 'IT Support' && p.status === 'in_progress') {
      const last = (p.work_log || []).map((e) => e && e.date).filter(Acc.isDate).sort().pop();
      const quiet = last ? Acc.daysBetween(last, today) : age;
      if (quiet >= 5) {
        add({
          key: `idle:${p.id}:${last || 'none'}`, kind: 'idle', urgency: quiet,
          title: `Check in on ${p.project_id} (${p.company_name})`, ref: p.project_id,
          why: last ? `No time logged for ${quiet} days` : `In progress for ${quiet} days with no time logged`, date: morning, time: '09:00',
        });
      }
    }
  }

  // Unpaid invoices due within 3 days (or overdue)
  for (const inv of invoices) {
    if (['paid', 'void'].includes(inv.status) || !Acc.isDate(inv.due_date)) continue;
    const left = Acc.daysBetween(today, inv.due_date);
    if (left > 3) continue;
    add({
      key: `inv:${inv.id}:${inv.due_date}`, kind: 'invoice', urgency: 50 - left,
      title: `Chase invoice ${inv.number} (${inv.company})`, ref: inv.ref || null,
      why: left < 0 ? `${-left} day${left === -1 ? '' : 's'} overdue${inv.follow_up_id ? ' (follow-up emails are scheduled)' : ''}` : left === 0 ? 'Due today' : `Due in ${left} day${left === 1 ? '' : 's'}`,
      date: left <= 0 ? morning : inv.due_date, time: '09:00',
    });
  }

  // Domains renewing in the next 30 days
  for (const r of registry) {
    if (!Acc.isDate(r.renewal_date)) continue;
    const left = Acc.daysBetween(today, r.renewal_date);
    if (left < -7 || left > 30) continue;
    const remind = left > 7 ? Acc.addDays(r.renewal_date, -7) : morning;
    add({
      key: `renew:${r.id}:${r.renewal_date}`, kind: 'domain', urgency: 40 - left,
      title: `Renew ${r.domain} (${r.client_company})`, ref: null,
      why: left < 0 ? `Lapsed ${-left} day${left === -1 ? '' : 's'} ago` : `Renews ${r.renewal_date}`,
      date: Acc.isWorkingDay(remind) ? remind : Acc.nextWorkingDay(remind), time: '09:00',
    });
  }

  return out.sort((a, b) => b.urgency - a.urgency).slice(0, 12).map(({ urgency, ...s }) => s);
}

module.exports = { MAX_OPEN, cleanReminder, suggestReminders, localToday, local, at };
