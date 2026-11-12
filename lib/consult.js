// Consultancy service: discovery-meeting preferences, confirmation, and calendar invites.

const { zonedParts, zonedToUtc } = require('./followups');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATFORMS = { teams: 'Microsoft Teams', zoom: 'Zoom' };
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function fmtDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${DAY[weekdayOf(dateStr)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

// What the client sends from their portal
function sanitizeMeetingPrefs(input, now = new Date()) {
  const s = input && typeof input === 'object' ? input : {};
  const type = s.type === 'call' ? 'call' : 'online';
  const timezone = validTimeZone(String(s.timezone || '')) ? String(s.timezone) : null;
  if (!timezone) throw new Error('Please choose your timezone.');

  const out = { type, timezone, platform: null, recipients: [], phone: null, slots: [], note: String(s.note || '').trim().slice(0, 1000) };

  if (type === 'online') {
    out.platform = PLATFORMS[s.platform] ? s.platform : null;
    if (!out.platform) throw new Error('Choose Microsoft Teams or Zoom.');
    const list = (Array.isArray(s.recipients) ? s.recipients : String(s.recipients || '').split(/[\s,;]+/))
      .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    const bad = list.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new Error(`"${bad}" isn't a valid email address.`);
    out.recipients = [...new Set(list)].slice(0, 10);
  } else {
    out.phone = String(s.phone || '').trim().slice(0, 40);
    if (!/^[+\d][\d\s()-]{6,}$/.test(out.phone)) throw new Error('Enter the phone number we should call.');
  }

  const today = zonedParts(now, timezone);
  const todayStr = `${today.y}-${String(today.m).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
  const slots = Array.isArray(s.slots) ? s.slots : [];
  slots.forEach((slot, i) => {
    const date = String(slot && slot.date || '');
    const from = String(slot && slot.from || '');
    const to = String(slot && slot.to || '');
    const n = i + 1;
    if (!DATE_RE.test(date)) throw new Error(`Option ${n}: pick a date.`);
    const wd = weekdayOf(date);
    if (wd === 0 || wd === 6) throw new Error(`Option ${n}: ${fmtDay(date)} is a weekend - meetings are Monday to Friday.`);
    if (date < todayStr) throw new Error(`Option ${n}: that date has passed.`);
    if (!TIME_RE.test(from) || !TIME_RE.test(to)) throw new Error(`Option ${n}: enter a start and end time.`);
    if (toMin(to) - toMin(from) < 30) throw new Error(`Option ${n}: allow at least 30 minutes between the times.`);
    out.slots.push({ date, from, to });
  });
  if (!out.slots.length) throw new Error('Suggest at least one day and time you are free.');
  out.slots = out.slots.slice(0, 5);
  return out;
}

// What you confirm in admin: one of the client's options, an exact start, length, and link
function buildConfirmation(prefs, input) {
  const s = input && typeof input === 'object' ? input : {};
  const slot = prefs.slots[Number(s.slot_index)];
  if (!slot) throw new Error('Pick one of the times the client suggested.');
  const start = TIME_RE.test(String(s.start || '')) ? s.start : slot.from;
  const duration = [30, 45, 60, 90].includes(Number(s.duration)) ? Number(s.duration) : 60;
  if (toMin(start) < toMin(slot.from) || toMin(start) + duration > toMin(slot.to)) {
    throw new Error(`The meeting must fit inside the client's window (${slot.from}–${slot.to}).`);
  }
  const link = String(s.link || '').trim().slice(0, 500);
  if (prefs.type === 'online' && !/^https:\/\/\S+$/i.test(link)) {
    throw new Error(`Paste the ${PLATFORMS[prefs.platform]} meeting link (starting with https://).`);
  }
  const [y, m, d] = slot.date.split('-').map(Number);
  const startUtc = zonedToUtc(y, m, d, ...start.split(':').map(Number), prefs.timezone);
  const endUtc = new Date(startUtc.getTime() + duration * 60000);
  const endMin = toMin(start) + duration;
  return {
    type: prefs.type,
    platform: prefs.platform,
    date: slot.date,
    start,
    end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`,
    duration,
    timezone: prefs.timezone,
    link: prefs.type === 'online' ? link : null,
    phone: prefs.phone,
    recipients: prefs.recipients,
    start_utc: startUtc.toISOString(),
    end_utc: endUtc.toISOString(),
    message: String(s.message || '').trim().slice(0, 2000),
  };
}

// ---------- Calendar invite (.ics) ----------

function icsEscape(text = '') {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines longer than 75 octets are folded with CRLF + space
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 74) { out.push(cur); cur = ` ${ch}`; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

const icsDate = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function buildIcs({ uid, confirmed, title, description, organizerName, organizerEmail, attendees = [] }) {
  const where = confirmed.type === 'online' ? `${PLATFORMS[confirmed.platform]}: ${confirmed.link}` : `Phone call to ${confirmed.phone}`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AutoWerke IT//Project Intake//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(confirmed.start_utc)}`,
    `DTEND:${icsDate(confirmed.end_utc)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(where)}`,
    ...(confirmed.link ? [`URL:${confirmed.link}`] : []),
    `ORGANIZER;CN=${icsEscape(organizerName)}:mailto:${organizerEmail}`,
    ...attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${a}`),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { sanitizeMeetingPrefs, buildConfirmation, buildIcs, fmtDay, PLATFORMS, weekdayOf };
