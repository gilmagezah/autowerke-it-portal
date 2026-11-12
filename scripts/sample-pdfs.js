// Builds one of every PDF the portal sends out, filled with made-up sample data, so the designs
// can be reviewed side by side without creating real requests.
//   npm run sample-pdfs            -> sample-pdfs/*.pdf (gitignored)
// Uses your .env for the brand, contact details and invoice payment details, and draws your
// uploaded signature if it can read it (read-only). Nothing is written to the database or emailed.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = path.join(__dirname, '..', 'sample-pdfs');
const { generateContractPdf } = require('../lib/contract');
const { generateEstimatePdf } = require('../lib/estimate');
const { generateSignoffPdf, defaultSignoff } = require('../lib/signoff');
const { generateSupportSignoffPdf, supportBilling } = require('../lib/supportSignoff');
const billing = require('../lib/billing');
const { certificatePdf, mergePdfs, ACCEPT } = require('../lib/esign');
const { generateDirectoryPdf } = require('../lib/directoryPdf');
const { loadSignature } = require('../lib/signature');

const day = (n) => new Date(Date.now() - n * 86400000);
const iso = (n) => day(n).toISOString();
const ymd = (n) => iso(n).slice(0, 10);

// ---------- Sample clients (all made up) ----------
const project = {
  project_id: 'PRJ-2611-0042', request_type: 'IT Project', project_title: 'Microsoft 365 and Intune rollout',
  company_name: 'Msasa Logistics (Pvt) Ltd', name: 'Tendai', surname: 'Moyo', position: 'Operations Director',
  email: 'tendai.moyo@msasa-logistics.example', phone: '+263 77 123 4567',
  reviewed_scope_summary: 'Move Msasa Logistics from on-premises Exchange and shared local accounts to Microsoft 365 Business Premium. '
    + 'Enrol all company laptops and phones in Intune, apply security baselines, and set up Entra ID sign-in with multi-factor authentication for 38 staff across the Harare and Bulawayo offices.',
  reviewed_requirements: [
    'Migrate 38 mailboxes (about 210 GB) from Exchange 2013 to Exchange Online with no lost mail',
    'Set up Entra ID accounts with MFA (Microsoft Authenticator) for every user',
    'Enrol 32 Windows laptops in Intune with Autopilot and the Microsoft security baseline',
    'Enrol 20 company Android phones with work profiles and app protection policies',
    'Move the shared S: drive to SharePoint and OneDrive with the same folder permissions',
    'Two training sessions for staff and a short admin handbook for the office manager',
  ],
  pricing_estimate: ['Mailbox migration to Exchange Online, 38 x $45 = $1710', '52 devices enrolled in Intune (laptops and phones) x $35 = $1820', 'SharePoint and OneDrive move = $780', 'Staff training, 2 x $270 = $540', 'VAT 15.5%', '50% on signing this contract, 50% on sign-off.', 'Microsoft 365 licences are billed separately by your reseller.'].join('\n'),
};

const signoff = {
  ...defaultSignoff(project),
  project_title: project.project_title,
  objectives: project.reviewed_requirements,
  outstanding_issues: ['Two Bulawayo laptops were away for repair and will be enrolled when they return (no extra charge)'],
  recommendations: [
    'Review the Intune compliance report monthly, or ask us for the quarterly health check',
    'Retire the old Exchange server after 60 days, once nothing has needed it',
    'Consider Defender for Business alerts being sent to a shared IT inbox',
  ],
};

const ticket = {
  project_id: 'SUP-2611-0107', request_type: 'IT Support', project_title: 'Outlook not syncing and printer offline',
  company_name: 'Borrowdale Dental Practice', name: 'Rutendo', surname: 'Chikwanha', position: 'Practice Manager',
  email: 'rutendo@borrowdale-dental.example', phone: '+263 71 987 6543',
  reviewed_scope_summary: 'Outlook on the reception PCs stopped syncing the shared bookings calendar, and the network printer dropped off the network after a router change.',
  details: 'Reception cannot see new bookings. Printer shows offline on all three PCs.',
  users_affected: '4', devices_affected: '3 PCs, 1 printer', attempts_taken: 'Restarted the PCs and the printer; re-entered the Outlook password.',
  estimated_hours: 3, hourly_rate: 45, vat_applicable: true,
  work_log: [
    { date: ymd(4), start: '08:30', end: '10:15', note: 'Remote: rebuilt Outlook profiles, re-shared the bookings calendar with the right permissions' },
    { date: ymd(3), start: '13:00', end: '14:30', note: 'On site: gave the printer a fixed IP on the new router, reinstalled the driver on 3 PCs' },
    { date: ymd(2), start: '09:00', end: '09:40', note: 'Follow-up check with reception, all bookings syncing' },
  ],
};
const estimateTicket = { ...ticket, work_log: [] };

const esignFor = (p, amount) => ({
  name: `${p.name} ${p.surname}`, email: p.email, method: 'type',
  code_verified_at: iso(1).replace(/\.\d+Z$/, 'Z'), signed_at: new Date(Date.now() - 86400000 + 120000).toISOString().replace(/\.\d+Z$/, 'Z'),
  ip: '41.79.112.18', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  amount, po_number: p === project ? 'PO-ML-2026-118' : null, documents: p === project ? [{ name: 'Msasa-PO-118.pdf' }] : [],
  accepted: ACCEPT(amount), doc_sha256: crypto.createHash('sha256').update(p.project_id).digest('hex'),
});

const lines = [
  { description: 'Microsoft 365 and Intune rollout: second payment (50%) on sign-off', qty: 1, unit_price: 2425 },
  { description: 'Extra on-site day, Bulawayo office (travel included)', qty: 1, unit_price: 180 },
  { description: 'Intune enrolment of 2 laptops returned from repair', qty: 2, unit_price: 0 },
];
const t = billing.totals(lines, true);
const invoice = {
  number: 'INV-2026-0031', issued_at: iso(1), due_date: ymd(-13), currency: 'USD', lines,
  subtotal: t.subtotal, vat: t.vat, vat_rate: t.vatRate ?? t.vat_rate ?? Number(process.env.VAT_RATE || 15.5), total: t.total,
  company: project.company_name, contact_name: `${project.name} ${project.surname}`, email: project.email, ref: project.project_id,
  notes: 'Thank you for your business. Payment within 14 days, please.',
};
const receiptBase = { company: invoice.company, email: invoice.email, ref: invoice.ref, method: 'Bank transfer', reference: 'CBZ-TRF-889120' };

const directory = [
  { company: project.company_name, active: true, domains: ['msasa-logistics.example'],
    people: [{ name: 'Tendai Moyo', position: 'Operations Director', email: project.email, phone: project.phone }, { name: 'Farai Dube', position: 'Office Manager', email: 'farai@msasa-logistics.example', phone: '+263 77 555 0101' }],
    requests: [{ ref: project.project_id, type: 'IT Project', title: project.project_title, label: 'Signed', owner: 'AutoWerke | IT', date: iso(1) }] },
  { company: ticket.company_name, active: true, domains: ['borrowdale-dental.example'],
    people: [{ name: 'Rutendo Chikwanha', position: 'Practice Manager', email: ticket.email, phone: ticket.phone }],
    requests: [{ ref: ticket.project_id, type: 'IT Support', title: ticket.project_title, label: 'Completed', owner: 'Client', date: iso(2) }] },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const sig = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? await loadSignature() : null;
  const supportTotal = supportBilling(ticket).total;
  const projectSignoffPdf = await generateSignoffPdf({ project, signoff, date: day(1) });
  const supportSignoffPdf = await generateSupportSignoffPdf({ project: ticket, date: day(1) });
  const files = [
    ['01-project-contract.pdf', 'IT Project: contract, downloaded when the client goes ahead', () => generateContractPdf(project)],
    ['02-support-work-estimate.pdf', 'IT Support: work estimate the client signs and uploads', () => generateEstimatePdf(estimateTicket)],
    ['03-project-sign-off.pdf', 'IT Project: sign-off document, emailed for signing', () => projectSignoffPdf],
    ['04-project-sign-off-SIGNED.pdf', 'IT Project: signed online (sign-off + e-signature certificate)', async () => mergePdfs(projectSignoffPdf, await certificatePdf({ project, esign: esignFor(project, 4850), signatureImage: null }))],
    ['05-support-sign-off.pdf', 'IT Support: completion sign-off with the work log and bill', () => supportSignoffPdf],
    ['06-support-sign-off-SIGNED.pdf', 'IT Support: signed online (sign-off + certificate)', async () => mergePdfs(supportSignoffPdf, await certificatePdf({ project: ticket, esign: esignFor(ticket, supportTotal), signatureImage: null }))],
    ['07-invoice.pdf', 'Invoice', () => billing.invoicePdf(invoice)],
    ['08-receipt-part-payment.pdf', 'Receipt: part payment (shows the balance)', () => billing.receiptPdf({ ...receiptBase, number: 'RCT-2026-0019', received_on: ymd(0), amount: 1500 }, invoice)],
    ['09-receipt-paid-in-full.pdf', 'Receipt: paid in full', () => billing.receiptPdf({ ...receiptBase, number: 'RCT-2026-0020', received_on: ymd(0), amount: invoice.total }, invoice)],
    ['10-client-directory-INTERNAL.pdf', 'Admin only (not sent to clients): client directory export', () => generateDirectoryPdf(directory, { title: 'Client directory' })],
  ];
  for (const [name, what, make] of files) {
    const buf = await make();
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`${name.padEnd(40)} ${String(Math.round(buf.length / 1024)).padStart(4)} KB  ${what}`);
  }
  console.log(`\n${files.length} PDFs in ${OUT}${sig ? ' (with your uploaded signature)' : ' (no signature uploaded or readable: blank signing line)'}`);
  process.exit(0);
})().catch((e) => { console.error('Failed:', e.stack || e.message); process.exit(1); });
