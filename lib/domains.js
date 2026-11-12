// Domains service: request validation, quotes, the managed-domains registry,
// and renewal reminders.

const { zonedParts, reminderTimeZone } = require('./followups');

const MAX_DOMAINS = 20;
// Labels of letters/digits/hyphens (not starting/ending with a hyphen), then a TLD.
// Allows multi-part endings like .co.zw
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const round2 = (n) => Math.round(n * 100) / 100;

// "https://www.Example.co.zw/about" -> "example.co.zw"
function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  d = d.split(/[/?#\s]/)[0].replace(/\.$/, '');
  return d;
}

function parseDomainList(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  raw.forEach((x) => {
    const d = normalizeDomain(x);
    if (!d) return;
    if (!DOMAIN_RE.test(d)) { invalid.push(String(x).trim()); return; }
    if (!seen.has(d)) { seen.add(d); valid.push(d); }
  });
  return { valid: valid.slice(0, MAX_DOMAINS), invalid, tooMany: valid.length > MAX_DOMAINS };
}

function money(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,\s$]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? round2(n) : null;
}

// Quote you send the client. Server recomputes every total - never trusts the browser's maths.
function buildQuote(input, vatRate = Number(process.env.VAT_RATE || 15.5)) {
  const s = input && typeof input === 'object' ? input : {};
  const lines = (Array.isArray(s.lines) ? s.lines : []).map((l) => ({
    domain: normalizeDomain(l && l.domain),
    years: Math.min(Math.max(parseInt(l && l.years, 10) || 1, 1), 10),
    price: money(l && l.price),
    available: !(l && l.available === false),
  }));
  if (!lines.length) throw new Error('Add at least one domain to the quote.');
  lines.forEach((l) => {
    if (!DOMAIN_RE.test(l.domain)) throw new Error(`"${l.domain || '(blank)'}" is not a valid domain.`);
    if (l.available && l.price === null) throw new Error(`Enter a price for ${l.domain} (or mark it unavailable).`);
  });
  const billable = lines.filter((l) => l.available);
  if (!billable.length) throw new Error('At least one domain must be available to quote.');

  const serviceFee = money(s.service_fee) ?? 0;
  const vatApplicable = s.vat_applicable !== false;
  const domainsTotal = round2(billable.reduce((sum, l) => sum + l.price * l.years, 0));
  const subtotal = round2(domainsTotal + serviceFee);
  const vat = vatApplicable ? round2((subtotal * vatRate) / 100) : 0;
  return {
    lines, service_fee: serviceFee, vat_applicable: vatApplicable, vat_rate: vatRate,
    domains_total: domainsTotal, subtotal, vat, total: round2(subtotal + vat),
    note: String(s.note || '').trim().slice(0, 1000),
  };
}

// ---------- Registry ----------

function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function sanitizeRegistry(input) {
  const s = input && typeof input === 'object' ? input : {};
  const domain = normalizeDomain(s.domain);
  const url = cleanText(s.registrar_url, 500);
  const days = (v, def) => Math.min(Math.max(parseInt(v, 10) || def, 0), 365);
  const out = {
    client_company: cleanText(s.client_company, 160),
    client_email: cleanText(s.client_email, 254).toLowerCase() || null,
    domain,
    registrar_name: cleanText(s.registrar_name, 120) || null,
    registrar_url: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
    account_username: cleanText(s.account_username, 254) || null,
    vault_reference: cleanText(s.vault_reference, 300) || null,
    renewal_date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.renewal_date || '')) ? s.renewal_date : null,
    renewal_price: money(s.renewal_price),
    admin_reminder_days: days(s.admin_reminder_days, 7),
    client_reminder_enabled: s.client_reminder_enabled !== false,
    client_reminder_days: days(s.client_reminder_days, 7),
    notes: cleanText(s.notes, 2000) || null,
    renewal_years: Math.min(Math.max(parseInt(s.renewal_years, 10) || 1, 1), 10),
    renewal_service_fee: money(s.renewal_service_fee),
    renewal_vat_applicable: s.renewal_vat_applicable !== false,
    request_id: typeof s.request_id === 'string' && /^[0-9a-f-]{36}$/i.test(s.request_id) ? s.request_id : null,
  };
  if (!out.client_company) throw new Error('Client company is required.');
  if (!DOMAIN_RE.test(domain)) throw new Error('Enter a valid domain, e.g. example.co.zw');
  if (out.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.client_email)) throw new Error('Client email is not valid.');
  if (out.client_reminder_enabled && !out.client_email) out.client_reminder_enabled = false;
  return out;
}

// Days from today (in your timezone) until a YYYY-MM-DD date
function daysUntil(dateStr, now = new Date(), timeZone = reminderTimeZone()) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = zonedParts(now, timeZone);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.y, t.m - 1, t.d)) / 86400000);
}

// Which renewal reminders are due right now. Each renewal date is reminded about
// once per audience (admin_reminded_for / client_reminded_for remember it), and
// reminders only go out from 08:00 your time.
function dueRenewalReminders(records, now = new Date(), timeZone = reminderTimeZone()) {
  if (zonedParts(now, timeZone).hh < 8) return { admin: [], client: [] };
  const admin = [];
  const client = [];
  records.forEach((r) => {
    const left = daysUntil(r.renewal_date, now, timeZone);
    if (left === null || left < -30) return; // no date, or long lapsed
    if (left <= r.admin_reminder_days && r.admin_reminded_for !== r.renewal_date) admin.push({ ...r, days_left: left });
    // If you've already sent the renewal email for this date, the automatic
    // client reminder would just be a second email about the same thing
    const renewalEmailSent = r.renewal_email_sent_for && r.renewal_email_sent_for === r.renewal_date;
    if (r.client_reminder_enabled && r.client_email && !renewalEmailSent && left >= 0 && left <= r.client_reminder_days && r.client_reminded_for !== r.renewal_date) {
      client.push({ ...r, days_left: left });
    }
  });
  return { admin, client };
}

// ---------- Renewal pricing + ready-to-send email ----------

// What the client pays to renew: domain price x years + your fee, plus VAT if charged
function renewalQuote(r, vatRate = Number(process.env.VAT_RATE || 15.5)) {
  const years = Math.min(Math.max(parseInt(r.renewal_years, 10) || 1, 1), 10);
  const price = Number(r.renewal_price) || 0;
  const fee = Number(r.renewal_service_fee) || 0;
  const domainCost = round2(price * years);
  const subtotal = round2(domainCost + fee);
  const vatApplicable = r.renewal_vat_applicable !== false;
  const vat = vatApplicable ? round2((subtotal * vatRate) / 100) : 0;
  return { years, price, fee, domainCost, subtotal, vatApplicable, vatRate, vat, total: round2(subtotal + vat), hasPrice: price > 0 };
}

const fmtUsd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtLongDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
}

// Default wording. Saved as a draft you can edit, so it's "ready to go" when the reminder fires.
function defaultRenewalEmail(r, brand, vatRate) {
  const q = renewalQuote(r, vatRate);
  const period = `${q.years} year${q.years === 1 ? '' : 's'}`;
  const lines = [
    `Domain: ${r.domain}`,
    `Renewal date: ${fmtLongDate(r.renewal_date)}`,
    `Renewal period: ${period}`,
    '',
    `Domain renewal (${fmtUsd(q.price)} x ${period}): ${fmtUsd(q.domainCost)}`,
    ...(q.fee ? [`Service fee: ${fmtUsd(q.fee)}`] : []),
    ...(q.vatApplicable ? [`VAT (${q.vatRate}%): ${fmtUsd(q.vat)}`] : []),
    `Total: ${fmtUsd(q.total)}`,
  ];
  return {
    subject: `Domain renewal — ${r.domain} — due ${fmtLongDate(r.renewal_date)}`,
    body:
      'Hello,\n\n' +
      `Your domain ${r.domain} is due for renewal on ${fmtLongDate(r.renewal_date)}. As we manage it for you, we'll take care of the renewal so your website and email keep running without interruption.\n\n` +
      lines.join('\n') + '\n\n' +
      "Please reply to confirm you'd like us to go ahead, or let us know if you'd prefer a different renewal period or would rather not renew.\n\n" +
      `Kind regards,\n${brand}`,
  };
}

function addYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y + 1, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0); // 29 Feb -> 28 Feb
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  normalizeDomain, parseDomainList, buildQuote, sanitizeRegistry, daysUntil, dueRenewalReminders, addYear, DOMAIN_RE,
  renewalQuote, defaultRenewalEmail, fmtLongDate,
};
