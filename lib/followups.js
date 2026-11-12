// Payment follow-ups: reminder scheduling (timezone-aware), validation, and email content.
//
// Reminder times are entered in YOUR local time (REMINDER_TIMEZONE, default
// Africa/Harare) even though the server itself runs on UTC.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function reminderTimeZone() {
  const tz = (process.env.REMINDER_TIMEZONE || 'Africa/Harare').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Africa/Harare';
  }
}

// The wall-clock parts of an instant in a given timezone
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    y: Number(get('year')), m: Number(get('month')), d: Number(get('day')),
    hh: Number(get('hour')), mm: Number(get('minute')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

// The UTC instant for a wall-clock time in a timezone (handles DST via one correction pass)
function zonedToUtc(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - guess;
  let utc = guess - offset;
  const p2 = zonedParts(new Date(utc), timeZone);
  const offset2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.hh, p2.mm) - utc;
  if (offset2 !== offset) utc = guess - offset2;
  return new Date(utc);
}

// Next time a reminder should fire, strictly after `from`
function nextReminderAt({ frequency, weekday, time }, from = new Date(), timeZone = reminderTimeZone()) {
  const [hh, mm] = String(time || '08:00').split(':').map(Number);
  const today = zonedParts(from, timeZone);
  for (let add = 0; add <= 8; add++) {
    // Walk forward day by day in local calendar terms
    const local = new Date(Date.UTC(today.y, today.m - 1, today.d + add));
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth() + 1;
    const d = local.getUTCDate();
    if (frequency === 'weekly' && local.getUTCDay() !== Number(weekday)) continue;
    const candidate = zonedToUtc(y, m, d, hh, mm, timeZone);
    if (candidate > from) return candidate;
  }
  return null;
}

// A stored follow-up's reminder settings, in the shape nextReminderAt expects.
// Always go through this - the column names differ from the scheduler's.
function scheduleOf(fu) {
  return { frequency: fu.reminder_frequency, weekday: fu.reminder_weekday, time: fu.reminder_time };
}

function describeSchedule(fu, timeZone = reminderTimeZone()) {
  if (!fu.reminder_enabled) return 'Reminders off';
  const when = fu.reminder_frequency === 'daily' ? 'Daily' : `Weekly on ${DAY_NAMES[fu.reminder_weekday] || 'Monday'}`;
  return `${when} at ${fu.reminder_time} (${timeZone})`;
}

// ---------- Validation ----------

function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function parseAmount(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s$]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 100000000) return null;
  return Math.round(n * 100) / 100;
}

function sanitizeFollowUp(input, now = new Date()) {
  const s = input && typeof input === 'object' ? input : {};
  const out = {
    company_name: cleanText(s.company_name, 160),
    contact_name: cleanText(s.contact_name, 160) || null,
    email: cleanText(s.email, 254).toLowerCase(),
    project_ref: cleanText(s.project_ref, 40) || null,
    project_id: typeof s.project_id === 'string' && /^[0-9a-f-]{36}$/i.test(s.project_id) ? s.project_id : null,
    amount: parseAmount(s.amount),
    due_date: typeof s.due_date === 'string' && DATE_RE.test(s.due_date) ? s.due_date : null,
    notes: cleanText(s.notes, 2000) || null,
    reminder_enabled: s.reminder_enabled !== false,
    reminder_frequency: s.reminder_frequency === 'daily' ? 'daily' : 'weekly',
    reminder_weekday: Number.isInteger(Number(s.reminder_weekday)) && Number(s.reminder_weekday) >= 0 && Number(s.reminder_weekday) <= 6
      ? Number(s.reminder_weekday) : 1,
    reminder_time: TIME_RE.test(String(s.reminder_time || '')) ? s.reminder_time : '08:00',
  };
  if (!out.company_name) throw new Error('Company name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error('A valid company email is required.');
  if (out.amount === null) throw new Error('Enter the amount due as a number greater than 0.');
  out.next_reminder_at = out.reminder_enabled ? nextReminderAt(scheduleOf(out), now).toISOString() : null;
  return out;
}

// ---------- Email content ----------

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

function daysOverdue(dueDate, now = new Date()) {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.split('-').map(Number);
  const t = zonedParts(now, reminderTimeZone());
  return Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(y, m - 1, d)) / 86400000);
}

// Editable default wording for the follow-up email to the client
function defaultFollowupEmail(fu, brand) {
  const ref = fu.project_ref ? ` (reference ${fu.project_ref})` : '';
  const greeting = fu.contact_name ? `Hi ${fu.contact_name.split(' ')[0]},` : 'Hello,';
  const due = fu.due_date ? `, which was due on ${fmtDate(fu.due_date)}` : '';
  return {
    subject: `Payment reminder${fu.project_ref ? ` — ${fu.project_ref}` : ''} — ${brand}`,
    body:
      `${greeting}\n\n` +
      `I hope you're well. This is a friendly reminder that a payment of ${money(fu.amount)} for our recent work${ref} is outstanding${due}.\n\n` +
      `If you've already made the payment, thank you, and please disregard this message. Otherwise, we'd appreciate it if you could arrange payment at your earliest convenience, or let us know if there's anything you need from us.\n\n` +
      `Kind regards,\n${brand}`,
  };
}

module.exports = {
  reminderTimeZone, zonedParts, zonedToUtc, nextReminderAt, scheduleOf, describeSchedule,
  sanitizeFollowUp, parseAmount, defaultFollowupEmail, daysOverdue, money, fmtDate, DAY_NAMES,
};
