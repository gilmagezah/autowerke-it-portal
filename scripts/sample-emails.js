// Builds one of every email the portal sends, filled with made-up sample data, so you can see them
// without creating real requests.
//   npm run sample-emails                          -> sample-emails/index.html (open it in a browser)
//   npm run sample-emails -- --send you@example.com -> also sends every sample to that inbox via Resend
//   npm run sample-emails -- --send you@example.com --only client   (just the client emails)
//   npm run sample-emails -- --send you@example.com --pick invoice,receipt   (just those, by name)
//   npm run sample-emails -- --baseline   saves this run as the "before" copy; later runs add a
//                                         "Changed" tab showing before and after side by side
// Uses your .env for the brand, sender and contact details. Nothing touches the database. Without
// --send nothing is emailed: every send is captured and written to disk instead.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const sendTo = args.includes('--send') ? args[args.indexOf('--send') + 1] : null;
const saveBaseline = args.includes('--baseline');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const pick = args.includes('--pick') ? String(args[args.indexOf('--pick') + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : null;
if (args.includes('--send') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendTo || '')) {
  console.log('Usage: npm run sample-emails -- --send you@example.com [--only client|admin] [--pick name,name]');
  process.exit(1);
}
if (only && !['client', 'admin'].includes(only)) { console.log('--only takes "client" or "admin"'); process.exit(1); }

// The email helpers read these; fill gaps so the samples build on a fresh checkout too
// A localhost BASE_URL makes emails drop the logo (inboxes can't reach your PC), so render the samples
// as they'll look live. The logo files are then copied or embedded from public/brand, so it works offline.
if (!process.env.BASE_URL || /\/\/(localhost|127\.|\[::1\])/.test(process.env.BASE_URL)) process.env.BASE_URL = 'https://portal.autowerkeit.com';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:59999';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';

const OUT = path.join(__dirname, '..', 'sample-emails');
const BASE = process.env.BASE_URL.replace(/\/+$/, '');

// Capture every Resend call instead of sending it
const realFetch = global.fetch;
let captured = [];
global.fetch = async (url, opts) => {
  if (String(url).includes('api.resend.com/emails')) {
    captured.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ id: 'sample' }), text: async () => '' };
  }
  return realFetch(url, opts);
};

const email = require('../lib/email');
const { generateEstimatePdf } = require('../lib/estimate');
const { generateSignoffPdf, defaultSignoff } = require('../lib/signoff');
const { generateSupportSignoffPdf, supportBilling } = require('../lib/supportSignoff');
const billing = require('../lib/billing');
const { certificatePdf, mergePdfs, ACCEPT } = require('../lib/esign');
const { buildIcs } = require('../lib/consult');

// Fixed times within a day, so two runs on the same day differ only where the emails changed
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:00Z`).getTime();
const day = (n) => new Date(NOW - n * 86400000);
const iso = (n) => day(n).toISOString();
const ymd = (n) => iso(n).slice(0, 10);
const BRAND_DIR = path.join(__dirname, '..', 'public', 'brand');
const BRAND_SRC = new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/brand/([\\w.-]+\\.png)`, 'g');
const copyBrand = (file) => {
  const from = path.join(BRAND_DIR, file);
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.join(OUT, 'brand'), { recursive: true });
  fs.copyFileSync(from, path.join(OUT, 'brand', file));
  return true;
};
const token = 'sample-portal-link';

// ---------- Sample clients (all made up, same people as npm run sample-pdfs) ----------
const project = {
  project_id: 'PRJ-2611-0042', request_type: 'IT Project', project_title: 'Microsoft 365 and Intune rollout',
  company_name: 'Msasa Logistics (Pvt) Ltd', name: 'Tendai', surname: 'Moyo', position: 'Operations Director',
  email: 'tendai.moyo@msasa-logistics.example', phone: '+263 77 123 4567', confirm_token: token,
  details: 'We want to move off our old Exchange server to Microsoft 365, and manage all company laptops and phones properly. About 38 staff across Harare and Bulawayo.',
  reviewed_scope_summary: 'Move Msasa Logistics from on-premises Exchange to Microsoft 365 Business Premium, enrol all company laptops and phones in Intune, and set up Entra ID sign-in with multi-factor authentication for 38 staff.',
  reviewed_requirements: [
    'Migrate 38 mailboxes (about 210 GB) from Exchange 2013 to Exchange Online with no lost mail',
    'Set up Entra ID accounts with MFA (Microsoft Authenticator) for every user',
    'Enrol 32 Windows laptops in Intune with Autopilot and the Microsoft security baseline',
    'Enrol 20 company Android phones with work profiles and app protection policies',
    'Two training sessions for staff and a short admin handbook for the office manager',
  ],
  // Same lines as npm run sample-pdfs, so the email and the contract PDF can be compared
  pricing_estimate: ['Mailbox migration to Exchange Online, 38 x $45 = $1710', '52 devices enrolled in Intune (laptops and phones) x $35 = $1820', 'SharePoint and OneDrive move = $780', 'Staff training, 2 x $270 = $540', 'VAT 15.5%', '50% on signing this contract, 50% on sign-off.', 'Microsoft 365 licences are billed separately by your reseller.'].join('\n'),
  phases: [
    { title: 'Discovery and plan', done: true, planned_start: ymd(30), planned_end: ymd(25) },
    { title: 'Entra ID and MFA', done: true, planned_start: ymd(24), planned_end: ymd(18) },
    { title: 'Mailbox migration', done: false, planned_start: ymd(17), planned_end: ymd(-3) },
    { title: 'Intune enrolment', done: false, planned_start: ymd(-4), planned_end: ymd(-14) },
    { title: 'Training and handover', done: false, planned_start: ymd(-15), planned_end: ymd(-18) },
  ],
  change_request: 'Please add the two Bulawayo shared PCs to the Intune enrolment.',
  signed_contract_url: `${BASE}/files/PRJ-2611-0042/signed-contract.pdf`,
  signoff_signed_url: `${BASE}/files/PRJ-2611-0042/signoff-signed.pdf`,
};
const ticket = {
  project_id: 'SUP-2611-0107', request_type: 'IT Support', project_title: 'Outlook not syncing and printer offline',
  company_name: 'Borrowdale Dental Practice', name: 'Rutendo', surname: 'Chikwanha', email: 'rutendo@borrowdale-dental.example',
  phone: '+263 71 987 6543', confirm_token: token, priority: 4, can_work: false,
  details: "Outlook on the two reception PCs stopped syncing the shared bookings calendar this morning. We restarted both PCs and signed out and back in, but appointments made on one PC don't show on the other. The printer also shows offline.",
  estimated_hours: 3, hourly_rate: 45, vat_applicable: true,
  work_log: [
    { date: ymd(4), start: '08:30', end: '10:15', note: 'Remote: rebuilt Outlook profiles, re-shared the bookings calendar' },
    { date: ymd(3), start: '13:00', end: '14:30', note: 'On site: fixed IP for the printer, reinstalled the driver on 3 PCs' },
    { date: ymd(2), start: '09:00', end: '09:40', note: 'Follow-up check with reception' },
  ],
  estimate_signed_url: `${BASE}/files/SUP-2611-0107/estimate-signed.pdf`,
  signoff_signed_url: `${BASE}/files/SUP-2611-0107/signoff-signed.pdf`,
};
const domainReq = {
  project_id: 'DOM-2611-0015', request_type: 'Domains', company_name: 'Kopje Coffee Roasters', name: 'Nyasha', surname: 'Mutasa',
  email: 'nyasha@kopjecoffee.example', confirm_token: token, domain_service: 'register', domains: ['kopjecoffee.co.zw', 'kopjecoffee.com'],
};
const subtotal = 25 + 15 + 20;
domainReq.domain_quote = {
  lines: [{ domain: 'kopjecoffee.co.zw', available: true, price: 25, years: 1 }, { domain: 'kopjecoffee.com', available: true, price: 15, years: 1 }],
  service_fee: 20, subtotal, vat_applicable: true, vat_rate: 15.5, vat: Math.round(subtotal * 15.5) / 100, total: Math.round(subtotal * 115.5) / 100,
  note: 'Both names are available. Prices are for the first year; renewals are the same unless the registry changes them.',
};
const consult = {
  project_id: 'CON-2611-0009', request_type: 'Consultancy', company_name: 'Avondale Legal Chambers', name: 'Farai', surname: 'Dube',
  email: 'farai@avondale-legal.example', confirm_token: token,
  details: 'We are 12 lawyers on personal Gmail accounts. What would it take to move to a proper business setup, and keep client files safe?',
  consult_meeting: { type: 'online', platform: 'teams', timezone: 'Africa/Harare', recipients: ['office@avondale-legal.example'],
    slots: [{ date: ymd(-3), from: '09:00', to: '11:00' }, { date: ymd(-4), from: '14:00', to: '16:00' }], note: 'Mornings are best.' },
};
const confirmed = {
  type: 'online', platform: 'teams', link: 'https://teams.microsoft.com/l/meetup-join/sample', date: ymd(-3), start: '09:30', end: '10:15',
  timezone: 'Africa/Harare', message: "We'll walk through your current setup and what a move to Microsoft 365 would look like.",
  recipients: ['office@avondale-legal.example'], start_utc: `${ymd(-3)}T07:30:00Z`, end_utc: `${ymd(-3)}T08:15:00Z`,
};
const esignFor = (p, amount) => ({
  name: `${p.name} ${p.surname}`, email: p.email, method: 'type',
  code_verified_at: iso(1), signed_at: new Date(NOW - 86400000 + 120000).toISOString(),
  ip: '41.79.112.18', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', amount,
  po_number: 'PO-ML-2026-118', documents: [{ name: 'Msasa-PO-118.pdf', url: `${BASE}/files/PRJ-2611-0042/po.pdf` }],
  accepted: ACCEPT(amount), doc_sha256: crypto.createHash('sha256').update(p.project_id).digest('hex'),
  signed_pdf_url: `${BASE}/files/PRJ-2611-0042/signed.pdf`,
});
const lines = [
  { description: 'Microsoft 365 and Intune rollout: second payment (50%) on sign-off', qty: 1, unit_price: 2425 },
  { description: 'Extra on-site day, Bulawayo office (travel included)', qty: 1, unit_price: 180 },
];
const t = billing.totals(lines, true);
const invoice = {
  number: 'INV-2026-0031', issued_at: iso(1), due_date: ymd(-13), currency: 'USD', lines,
  subtotal: t.subtotal, vat: t.vat, vat_rate: t.vatRate ?? t.vat_rate ?? 15.5, total: t.total,
  company: project.company_name, contact_name: `${project.name} ${project.surname}`, email: project.email, ref: project.project_id,
};
const receipt = { company: invoice.company, email: invoice.email, ref: invoice.ref, method: 'Bank transfer', reference: 'CBZ-TRF-889120', number: 'RCT-2026-0020', received_on: ymd(0), amount: invoice.total };
const renewal = { domain: 'kopjecoffee.co.zw', client_company: domainReq.company_name, client_email: domainReq.email, days_left: 21, renewal_date: ymd(-21), renewal_price: 25, renewal_total: 28.88, registrar_name: 'ZISPA', client_reminder_enabled: true };

(async () => {
  const signoffPdf = await generateSignoffPdf({ project, signoff: { ...defaultSignoff(project), objectives: project.reviewed_requirements }, date: day(1) });
  const supportPdf = await generateSupportSignoffPdf({ project: ticket, date: day(1) });
  const supportBill = supportBilling(ticket);
  const signedPdf = await mergePdfs(signoffPdf, await certificatePdf({ project, esign: esignFor(project, 4850), signatureImage: null }));
  const ics = buildIcs({ uid: `${consult.project_id}@sample`, confirmed, title: 'Discovery meeting: AutoWerke | IT', description: 'Sample invite', organizerName: 'AutoWerke | IT', organizerEmail: process.env.ADMIN_EMAIL, attendees: [consult.email] });
  const aiDraft = { requirements: ['Rebuild the Outlook profiles on both reception PCs', 'Check calendar sharing permissions', 'Bring the printer back online'], scope_summary: 'Outlook calendar sync and printer fix at reception.' };

  // [file name, who it goes to, when it's sent, how to make it]
  const list = [
    ['client', 'request-received-support', 'Someone submits an IT Support request', () => email.sendRequestReceivedEmail({ project: ticket, attachments: [{ name: 'outlook-error.png' }, { name: 'sync-error.txt' }], baseUrl: BASE })],
    ['client', 'request-received-project', 'Someone submits an IT Project request', () => email.sendRequestReceivedEmail({ project, baseUrl: BASE })],
    ['client', 'scope-to-confirm', 'You send the reviewed scope (project)', () => email.sendClientConfirmationEmail({ project, baseUrl: BASE })],
    ['client', 'scope-to-confirm-revised', 'You send the scope again after changes', () => email.sendClientConfirmationEmail({ project, baseUrl: BASE, revised: true })],
    ['client', 'project-pricing', 'You send the project price', () => email.sendPricingEmail({ project, baseUrl: BASE })],
    ['client', 'support-work-estimate', 'You send the support work estimate', () => email.sendEstimateEmail({ project: ticket, baseUrl: BASE })],
    ['client', 'project-progress-update', 'You send a progress update', () => email.sendProgressUpdateEmail({ project, message: 'Mailboxes for the Harare office are done. Bulawayo moves this weekend, so expect a short Outlook prompt on Monday.', baseUrl: BASE })],
    ['client', 'project-sign-off', 'All phases done: the sign-off document', () => email.sendSignoffEmail({ project, pdfBuffer: signoffPdf, baseUrl: BASE })],
    ['client', 'support-converted-to-project', 'You turn a support ticket into a project', () => email.sendConversionEmail({ project: { ...ticket, project_title: 'Reception network rebuild' }, previousStatus: 'estimate_sent', reason: 'Fixing this properly means replacing the router and re-cabling reception, which is bigger than a support job.', baseUrl: BASE })],
    ['client', 'support-sign-off', 'Support work finished: completion sign-off and bill', () => email.sendSupportSignoffEmail({ project: ticket, pdfBuffer: supportPdf, billing: supportBill, baseUrl: BASE })],
    ['client', 'sign-off-code', 'Client asks to sign online: their one-time code', () => email.sendSignoffCode({ project, code: 'K7QM4XPA', codeMinutes: 10, sessionMinutes: 30 })],
    ['both', 'signed-online', 'Client signs online (one to them, one to you)', () => email.sendSignedOnlineEmails({ project, esign: esignFor(project, 4850), signedPdf, total: 4850 })],
    ['client', 'invoice', 'You send an invoice', async () => email.sendInvoiceEmail({ invoice, pdf: await billing.invoicePdf(invoice) })],
    ['client', 'receipt', 'You record a payment', async () => email.sendReceiptEmail({ receipt, pdf: await billing.receiptPdf(receipt, invoice) })],
    // The real default wording from Follow-ups (you can edit it before sending)
    ['client', 'payment-follow-up', 'You send a payment reminder (default wording, editable)', () => {
      const fu = { email: project.email, contact_name: `${project.name} ${project.surname}`, project_ref: project.project_id, amount: 2425, due_date: ymd(3) };
      const { subject, body } = require('../lib/followups').defaultFollowupEmail(fu, require('../lib/brand').brandName());
      return email.sendFollowupEmail({ followUp: fu, subject, body });
    }],
    ['client', 'domain-request-received', 'Someone requests a domain', () => email.sendDomainReceivedEmail({ project: domainReq, baseUrl: BASE })],
    ['client', 'domain-quote', 'You send the domain quote', () => email.sendDomainQuoteEmail({ project: domainReq, baseUrl: BASE })],
    ['client', 'domain-registered', 'You mark the domains registered', () => email.sendDomainCompleteEmail({ project: domainReq, records: [renewal, { ...renewal, domain: 'kopjecoffee.com' }] })],
    ['client', 'domain-renewal-reminder', 'Automatic reminder before a renewal', () => email.sendClientRenewalReminder({ record: renewal })],
    ['client', 'domain-renewal-email', 'You send the renewal email (your own words)', () => email.sendRenewalEmailToClient({ record: renewal, subject: 'kopjecoffee.co.zw renews in 21 days', body: 'Hi Nyasha,\n\nYour domain renews on the date below. The cost is $28.88 including VAT.\n\nReply if you would like to change anything.' })],
    ['client', 'consultancy-received', 'Someone sends a consultancy question', () => email.sendConsultReceivedEmail({ project: consult })],
    ['client', 'consultancy-answer', 'You answer a consultancy question', () => email.sendConsultResponseEmail({ project: consult, body: 'Hi Farai,\n\nThanks for the question. A move to Microsoft 365 Business Premium would give each lawyer a firm address, and keep client files in SharePoint with proper permissions.', inviteMeeting: false, baseUrl: BASE })],
    ['client', 'consultancy-meeting-invite', 'You answer and invite them to a meeting', () => email.sendConsultResponseEmail({ project: consult, body: 'Hi Farai,\n\nThe best next step is a short discovery meeting so we can see your current setup.', inviteMeeting: true, baseUrl: BASE, fee: 0 })],
    ['client', 'consultancy-meeting-confirmed', 'You confirm the meeting time (with calendar invite)', () => email.sendMeetingConfirmedEmail({ project: consult, confirmed, ics })],
    ['admin', 'admin-new-request-review', 'A request arrives: the AI draft for you to review', () => email.sendReviewEmail({ submission: { requestType: 'IT Support', companyName: ticket.company_name, name: ticket.name, email: ticket.email, details: ticket.details }, aiDraft, projectId: ticket.project_id, priority: 4, canWork: false, attachments: [{ name: 'outlook-error.png', url: `${BASE}/files/x/1`, type: 'image/png' }, { name: 'sync-error.txt', url: `${BASE}/files/x/2`, type: 'text/plain' }], baseUrl: BASE })],
    ['admin', 'admin-sign-in-code', 'You sign in to the back office', () => email.sendAdminLoginCode({ admin: { name: 'Gil Magezah', email: process.env.ADMIN_EMAIL }, code: 'QWPLMR', minutes: 10 })],
    ['admin', 'admin-payment-digest', 'Daily: payments to follow up', () => email.sendReminderDigest({ items: [{ company_name: project.company_name, project_ref: project.project_id, amount: 2425, due_date: ymd(3), followups_sent: 1 }, { company_name: ticket.company_name, project_ref: ticket.project_id, amount: 155.93, due_date: ymd(-5), followups_sent: 0 }], baseUrl: BASE })],
    ['admin', 'admin-domain-request', 'A domain request arrives', () => email.sendDomainAdminAlert({ project: domainReq, baseUrl: BASE })],
    ['admin', 'admin-renewals-digest', 'Daily: domain renewals coming up', () => email.sendRenewalDigest({ items: [renewal, { ...renewal, domain: 'msasa-logistics.example', client_company: project.company_name, days_left: -2, renewal_email_ready: true }], baseUrl: BASE })],
    ['admin', 'admin-your-reminders', 'Your own reminders come due', () => email.sendAdminReminderEmail({ to: process.env.ADMIN_EMAIL, name: 'Gil Magezah', items: [{ title: 'Call Msasa about Bulawayo laptops', ref: project.project_id, note: 'Two laptops back from repair', whenText: 'Today 09:00' }], baseUrl: BASE })],
    ['admin', 'admin-consultancy-draft', 'A consultancy question arrives: the AI draft', () => email.sendConsultAdminDraft({ project: consult, draft: 'Hi Farai,\n\nThanks for reaching out. Moving to Microsoft 365 would...', suggestMeeting: true, baseUrl: BASE })],
    ['admin', 'admin-meeting-preferences', 'Client picks meeting times', () => email.sendMeetingRequestedAdmin({ project: consult, baseUrl: BASE })],
    ...['client_confirmed', 'changes_requested', 'proceeding', 'declined', 'signed', 'estimate_approved', 'ticket_completed', 'signoff_signed', 'support_signoff_signed', 'domain_accepted'].map((event) => [
      'admin', `admin-alert-${event.replace(/_/g, '-')}`, `Client action: ${event.replace(/_/g, ' ')}`,
      () => email.sendAdminNotification({ project: event.startsWith('domain') ? domainReq : /estimate|ticket|support/.test(event) ? ticket : project, event }),
    ]),
  ];

  // Clear the last run, but keep the saved "before" copies (sample-emails/baseline/)
  const BASELINE = path.join(OUT, 'baseline');
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f !== 'baseline') fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'attachments'), { recursive: true });
  const made = [];
  for (const [audience, slug, when, make] of list) {
    captured = [];
    await make();
    if (!captured.length) throw new Error(`${slug} sent nothing`);
    captured.forEach((m, i) => {
      const isAdmin = (m.to || []).includes(process.env.ADMIN_EMAIL);
      const who = audience === 'both' ? (isAdmin ? 'admin' : 'client') : audience;
      const name = `${String(made.length + 1).padStart(2, '0')}-${slug}${captured.length > 1 ? `-${who}` : ''}`;
      // Logos come from BASE_URL, which may be localhost or not live yet: use local copies here
      const html = m.html.replace(BRAND_SRC, (all, file) => (copyBrand(file) ? `brand/${file}` : all));
      fs.writeFileSync(path.join(OUT, `${name}.html`), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><title>${esc(m.subject)}</title>${html}`);
      const files = (m.attachments || []).map((a) => {
        const file = `${name}--${a.filename}`;
        fs.writeFileSync(path.join(OUT, 'attachments', file), Buffer.from(a.content, 'base64'));
        return { file, name: a.filename, kb: Math.max(1, Math.round(Buffer.from(a.content, 'base64').length / 1024)) };
      });
      made.push({ name, slug: name.replace(/^\d+-/, ''), who, when, payload: m, files });
    });
  }
  if (saveBaseline) {
    fs.rmSync(BASELINE, { recursive: true, force: true });
    fs.mkdirSync(BASELINE, { recursive: true });
    for (const e of made) fs.writeFileSync(path.join(BASELINE, `${e.slug}.html`), fs.readFileSync(path.join(OUT, `${e.name}.html`), 'utf8').split('src="brand/').join('src="../brand/'));
    console.log(`Saved ${made.length} emails as the "before" copy in ${BASELINE}`);
  }
  // Compare with the saved "before" copy, if there is one
  const before = (slug) => { try { return fs.readFileSync(path.join(BASELINE, `${slug}.html`), 'utf8').split('src="../brand/').join('src="brand/'); } catch { return null; } };
  let notes = {};
  try { notes = JSON.parse(fs.readFileSync(path.join(BASELINE, 'notes.json'), 'utf8')); } catch { /* optional */ }
  for (const e of made) {
    const old = before(e.slug);
    e.status = old === null ? (fs.existsSync(BASELINE) ? 'new' : null) : old === fs.readFileSync(path.join(OUT, `${e.name}.html`), 'utf8') ? null : 'changed';
    e.note = notes[e.slug] || '';
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), gallery(made, notes._summary || ''));
  for (const e of made) console.log(`${e.who.padEnd(6)} ${e.name.padEnd(42)} ${e.payload.subject}`);
  console.log(`\n${made.length} emails (${made.filter((e) => e.who === 'client').length} to clients, ${made.filter((e) => e.who === 'admin').length} to you).`);
  console.log(`Open ${path.join(OUT, 'index.html')} in your browser.`);

  if (sendTo) {
    if (!process.env.RESEND_API_KEY) { console.log('\nRESEND_API_KEY is not set in .env, so nothing was sent.'); process.exit(1); }
    const unknown = (pick || []).filter((p) => !made.some((e) => e.slug === p));
    if (unknown.length) { console.log(`\nNo sample called: ${unknown.join(', ')}. Names: ${made.map((e) => e.slug).join(', ')}`); process.exit(1); }
    const toSend = made.filter((e) => (!only || e.who === only) && (!pick || pick.includes(e.slug)));
    console.log(`\nSending ${toSend.length} samples to ${sendTo} through Resend...`);
    let ok = 0;
    for (const e of toSend) {
      // Same email, but only to you, and marked as a sample so it can't be mistaken for a real one
      const body = { ...e.payload, to: [sendTo], subject: `[Sample] ${e.payload.subject}` };
      delete body.cc; delete body.bcc;
      // Embed the logos (inline "cid:" images) so they show even before the site is live
      const inline = new Set();
      body.html = body.html.replace(BRAND_SRC, (all, file) => (fs.existsSync(path.join(BRAND_DIR, file)) ? (inline.add(file), `cid:${file}`) : all));
      body.attachments = [...(body.attachments || []), ...[...inline].map((file) => ({
        filename: file, content: fs.readFileSync(path.join(BRAND_DIR, file)).toString('base64'), content_id: file,
      }))];
      const r = await realFetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, body: JSON.stringify(body),
      });
      if (r.ok) ok += 1; else console.log(`  ✗ ${e.name}: Resend said ${r.status} ${(await r.text()).slice(0, 200)}`);
      await new Promise((res) => setTimeout(res, 600)); // Resend allows about 2 a second
    }
    console.log(`Sent ${ok} of ${toSend.length}. Check ${sendTo} (and its spam folder).`);
  }
  process.exit(0);
})().catch((e) => { console.error('Failed:', e.stack || e.message); process.exit(1); });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A plain local page with two tabs: every email, and (after --baseline) the ones that changed,
// before and after side by side. Each email sits in a frame with its subject, recipients and files.
function gallery(items, summary) {
  const meta = (e) => `
      <div class="tag ${e.who}">${e.who === 'client' ? 'To the client' : 'To you (admin)'}</div>${e.status ? ` <span class="flag">${e.status}</span>` : ''}
      <div class="when">${esc(e.when)}</div>
      <div class="subject">${esc(e.payload.subject)}</div>
      <div class="row"><b>From</b> ${esc(e.payload.from)}${e.payload.reply_to ? ` &middot; <b>Reply to</b> ${esc(e.payload.reply_to)}` : ''}</div>
      <div class="row"><b>To</b> ${esc((e.payload.to || []).join(', '))}</div>
      ${e.files.length ? `<div class="row"><b>Attached</b> ${e.files.map((f) => `<a href="attachments/${encodeURIComponent(f.file)}">${esc(f.name)}</a> (${f.kb} KB)`).join(' &middot; ')}</div>` : ''}
      <div class="row"><a href="${e.name}.html">Open on its own</a></div>`;
  const card = (e) => `
  <section class="mail" id="${e.name}"><div class="meta">${meta(e)}</div>
    <iframe src="${e.name}.html" title="${esc(e.payload.subject)}" loading="lazy"></iframe></section>`;
  const compare = (e) => `
  <section class="mail compare" id="changed-${e.name}"><div class="meta">${meta(e)}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>
    <div class="pair">
      <figure><figcaption>Before</figcaption>${e.status === 'new'
        ? '<div class="none">New email: no earlier version.</div>'
        : `<iframe src="baseline/${e.slug}.html" title="Before: ${esc(e.payload.subject)}" loading="lazy"></iframe>`}</figure>
      <figure><figcaption class="after">After</figcaption><iframe src="${e.name}.html" title="After: ${esc(e.payload.subject)}" loading="lazy"></iframe></figure>
    </div></section>`;
  const section = (list, who, title, render) => {
    const mine = list.filter((e) => e.who === who);
    return mine.length ? `<h2>${title} <span>${mine.length}</span></h2>${mine.map(render).join('')}` : '';
  };
  const nav = (list, prefix) => list.map((e) => `<a href="#${prefix}${e.name}" class="${e.who}">${esc(e.slug.replace(/-/g, ' '))}</a>`).join('');
  const changed = items.filter((e) => e.status);
  const changedTab = changed.length
    ? `${summary ? `<div class="summary">${esc(summary)}</div>` : ''}<nav>${nav(changed, 'changed-')}</nav>
       <main>${section(changed, 'client', 'To clients', compare)}${section(changed, 'admin', 'To you', compare)}</main>`
    : '<main><p class="empty">No "before" copy to compare with, or nothing has changed since it was saved. Run <code>npm run sample-emails -- --baseline</code> before making changes.</p></main>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sample emails: AutoWerke | IT</title>
<style>
  body { margin: 0; background: #F4F1E8; color: #1F2622; font: 14px/1.5 system-ui, sans-serif; }
  header { background: #2F4A3B; color: #F4F1E8; padding: 22px 28px 0; }
  header h1 { margin: 0; font: bold 22px 'Courier New', monospace; letter-spacing: 1px; }
  header p { margin: 6px 0 14px; color: #C9D3C6; }
  .tabs { display: flex; gap: 4px; }
  .tabs button { font: bold 13px 'Courier New', monospace; letter-spacing: 1px; text-transform: uppercase; border: 0; border-radius: 6px 6px 0 0; padding: 10px 16px; cursor: pointer; background: #4A6656; color: #E6ECE4; }
  .tabs button[aria-selected="true"] { background: #F4F1E8; color: #2F4A3B; }
  .panel[hidden] { display: none; }
  nav { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 28px; border-bottom: 1px solid #DEDACD; }
  nav a { font: 12px 'Courier New', monospace; color: #2F4A3B; text-decoration: none; padding: 3px 8px; border: 1px solid #C9D3C6; border-radius: 4px; background: #fff; }
  nav a.admin { color: #7B7B70; }
  .summary { margin: 18px 28px 0; padding: 12px 16px; background: #fff; border-left: 3px solid #2F4A3B; border-radius: 4px; white-space: pre-line; max-width: 1100px; }
  main { padding: 0 28px 40px; max-width: 1500px; }
  h2 { font: bold 16px 'Courier New', monospace; text-transform: uppercase; letter-spacing: 2px; color: #2F4A3B; margin: 30px 0 12px; }
  h2 span { color: #7B7B70; font-weight: normal; }
  .mail { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 18px; background: #fff; border: 1px solid #DEDACD; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .meta { font-size: 13px; }
  .tag { display: inline-block; font: bold 11px 'Courier New', monospace; letter-spacing: 1px; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: #2F4A3B; color: #F4F1E8; }
  .tag.admin { background: #7B7B70; }
  .flag { font: bold 11px 'Courier New', monospace; text-transform: uppercase; letter-spacing: 1px; color: #A06414; margin-left: 6px; }
  .when { color: #7B7B70; margin: 8px 0 4px; }
  .subject { font-weight: bold; font-size: 15px; margin-bottom: 10px; }
  .row { margin: 4px 0; word-break: break-word; }
  .row a { color: #2F4A3B; }
  .note { margin-top: 12px; padding: 10px 12px; background: #F4F1E8; border-left: 3px solid #2F4A3B; border-radius: 4px; white-space: pre-line; }
  .pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  figure { margin: 0; min-width: 0; }
  figcaption { font: bold 11px 'Courier New', monospace; letter-spacing: 2px; text-transform: uppercase; color: #7B7B70; margin-bottom: 6px; }
  figcaption.after { color: #2F4A3B; }
  .none { padding: 30px 16px; color: #7B7B70; border: 1px dashed #DEDACD; border-radius: 6px; }
  iframe { width: 100%; height: 720px; border: 1px solid #DEDACD; border-radius: 6px; background: #fff; resize: vertical; }
  .empty { margin-top: 30px; }
  @media (max-width: 1100px) { .mail, .pair { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 760px) { main, nav, header { padding-left: 14px; padding-right: 14px; } .summary { margin: 14px; } }
</style></head><body>
<header><h1>AutoWerke | IT &middot; sample emails</h1><p>${items.length} emails built with made-up data on ${esc(new Date().toLocaleString('en-GB'))}. Links point at ${esc(BASE)} and won't work for these samples.</p>
<div class="tabs" role="tablist">
  <button type="button" role="tab" aria-controls="changed" aria-selected="false">Changed (${changed.length})</button>
  <button type="button" role="tab" aria-controls="all" aria-selected="false">All emails (${items.length})</button>
</div></header>
<div class="panel" id="changed" role="tabpanel" hidden>${changedTab}</div>
<div class="panel" id="all" role="tabpanel" hidden><nav>${nav(items, '')}</nav>
  <main>${section(items, 'client', 'To clients', card)}${section(items, 'admin', 'To you', card)}</main></div>
<script>
  // Local review page only (never served by the portal), so an inline script is fine here
  function show(id) {
    document.querySelectorAll('[role=tab]').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('aria-controls') === id)); });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.id !== id; });
  }
  document.querySelectorAll('[role=tab]').forEach(function (t) { t.addEventListener('click', function () { show(t.getAttribute('aria-controls')); }); });
  show(${changed.length ? "'changed'" : "'all'"});
</script>
</body></html>`;
}

