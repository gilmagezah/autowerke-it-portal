// The Business card accessory: company details to copy (front) and certifications (back).
// Admin-only (it shows the bank details). Contact details come from lib/brand.js, bank details
// from INVOICE_PAYMENT_DETAILS (the same text printed on invoices).
const { contactInfo } = require('./brand');
const { reminderTimeZone } = require('./followups');

// Keep in step with the certifications on the homepage (public/index.html); a test checks it
const CERTS = [
  { code: 'SC-300', title: 'Identity and Access Administrator Associate' },
  { code: 'AZ-500', title: 'Azure Security Engineer Associate' },
  { code: 'MS-900', title: 'Microsoft 365 Fundamentals' },
];

// What we do, in short (the homepage's skill headings)
const FOCUS = ['Microsoft 365', 'Intune', 'Entra ID', 'Security hardening', 'Domains & email'];

// "Bank: CABS\nAccount: 1002 3344" (or one line split with " · ") ->
// [{ label: 'Bank', value: 'CABS' }, ...]. Parts without a "Label:" keep their whole text as the value.
function paymentLines(raw = process.env.INVOICE_PAYMENT_DETAILS) {
  return String(raw || '').replace(/\\n/g, '\n').split(/\n|\s+[·|;]\s+/).map((l) => l.trim()).filter(Boolean).slice(0, 8).map((line) => {
    const m = /^([^:]{1,24}):\s*(.+)$/.exec(line);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { label: '', value: line };
  });
}

function businessCard() {
  const c = contactInfo();
  const vat = Number(process.env.VAT_RATE);
  return {
    name: c.name,
    email: c.email,
    phone: c.phone,
    location: c.location,
    tagline: c.tagline,
    website: (process.env.BRAND_WEBSITE || 'autowerkeit.com').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    payment: paymentLines(),
    certs: CERTS,
    focus: FOCUS,
    vatRate: Number.isFinite(vat) && vat >= 0 ? vat : 15.5,
    timezone: reminderTimeZone(),
  };
}

module.exports = { businessCard, paymentLines, CERTS };
