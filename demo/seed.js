// Made-up sample data for the demo. Every company, person, email address and amount here is
// fictional. Dates are relative to "now", so the demo always looks current.
const crypto = require('crypto');
const { createDefaultPhases } = require('../lib/phases');

const DAY = 86400000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const day = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const id = () => crypto.randomUUID();

function phases(doneCount, startDaysAgo) {
  return createDefaultPhases().map((p, i) => ({
    ...p,
    done: i < doneCount,
    completed_date: i < doneCount ? day(-startDaysAgo + i * 4 + 3) : null,
    planned_start: day(-startDaysAgo + i * 4),
    planned_end: day(-startDaysAgo + i * 4 + 3),
  }));
}
const log = (entries) => entries.map(([d, start, end, note]) => ({ id: id(), date: day(-d), start, end, note }));

function person(first, last, company, domain, extra = {}) {
  return {
    name: first, surname: last, company_name: company, position: extra.position || 'Operations Manager',
    email: `${first.toLowerCase()}@${domain}`, phone: '+263 77 000 0000', company_website: `https://${domain}`,
    consent_at: ago(30 * DAY), consent_version: '2026-10',
  };
}

function seed() {
  const projects = [
    // ---- Pipeline: your move ----
    {
      project_id: 'KARIBA-7QX-2M4', request_type: 'IT Project', status: 'pending_review', created_at: ago(16 * DAY), updated_at: ago(16 * DAY),
      ...person('Tariro', 'Ncube', 'Kariba Logistics', 'kariba-logistics.example'),
      details: 'We bought 40 new Windows laptops for the depot and drivers. We want them set up automatically for each user, with company apps, and locked down if one is lost.',
      project_title: 'Intune Rollout for 40 Laptops',
      ai_requirements: ['Enrol 40 Windows laptops in Intune with Windows Autopilot', 'Baseline compliance and BitLocker encryption policies', 'Company Portal with the six core business apps', 'Remote wipe and lost-device procedure for managers'],
      ai_scope_summary: 'We will set up your 40 new laptops so each one configures itself when a staff member signs in, installs your company apps, and stays encrypted. If a laptop is lost, it can be locked or wiped remotely.',
    },
    {
      project_id: 'CHIEDZ-4LP-9WD', request_type: 'IT Project', status: 'changes_requested', created_at: ago(9 * DAY), updated_at: ago(2 * DAY),
      ...person('Rumbi', 'Dube', 'Chiedza Trust', 'chiedzatrust.example', { position: 'Programme Director' }),
      details: 'An intranet in SharePoint for 25 staff: policies, a staff directory, and news from head office.',
      project_title: 'SharePoint Staff Intranet',
      reviewed_requirements: ['SharePoint communication site with Policies, Directory and News pages', 'Staff directory from Entra ID profiles', 'News posting for two editors at head office'],
      reviewed_scope_summary: 'A SharePoint intranet where your 25 staff find policies, colleagues and head-office news in one place.',
      change_request: 'Could we also add a leave request form that goes to the line manager?',
    },
    {
      project_id: 'HILLSI-2RB-8NE', request_type: 'IT Project', status: 'client_confirmed', created_at: ago(6 * DAY), updated_at: ago(1 * DAY),
      ...person('Nyasha', 'Mutasa', 'Hillside Clinic', 'hillsideclinic.example', { position: 'Practice Manager' }),
      details: 'Move our email from the old host to Microsoft 365 and set up shared mailboxes for reception and accounts.',
      project_title: 'Email Move to Microsoft 365',
      reviewed_requirements: ['Migrate 12 mailboxes to Exchange Online', 'Shared mailboxes for Reception and Accounts', 'Update DNS (MX, SPF, DKIM, DMARC) with no lost mail'],
      reviewed_scope_summary: 'We will move your clinic email to Microsoft 365 over a weekend, set up shared inboxes for reception and accounts, and make sure no mail goes missing.',
    },
    {
      project_id: 'MSASAD-8RT-3KF', request_type: 'IT Support', status: 'client_confirmed', created_at: ago(5 * 3600000), updated_at: ago(3 * 3600000),
      ...person('Farai', 'Moyo', 'Msasa Dental', 'msasadental.example', { position: 'Office Administrator' }),
      details: 'Outlook keeps asking for a password on three of the reception PCs since Monday.',
      users_affected: '3', devices_affected: '3 reception PCs', attempts_taken: 'Restarted the PCs and re-entered the password', priority: 2, can_work: true,
      project_title: 'Outlook Password Prompts',
      reviewed_requirements: ['Check the Microsoft 365 sign-in logs for the three accounts', 'Clear cached credentials and repair the Outlook profiles', 'Confirm modern authentication is enabled for the tenant'],
      reviewed_scope_summary: 'We will find out why Outlook keeps asking for passwords on the three reception PCs and fix it so staff can work without interruptions.',
    },
    // ---- Pipeline: moving, and with clients ----
    {
      project_id: 'BORROW-2HN-6QA', request_type: 'IT Support', status: 'in_progress', created_at: ago(6 * DAY), updated_at: ago(1 * DAY),
      ...person('Tendai', 'Sibanda', 'Borrowdale Pharmacy', 'borrowdalepharmacy.example'),
      details: 'The receipt printer drops off the network and the back-office Wi-Fi is slow.',
      users_affected: '6', devices_affected: '1 printer, Wi-Fi', attempts_taken: 'Power-cycled the router', priority: 2, can_work: true,
      project_title: 'Printer and Wi-Fi Fix', estimated_hours: 5, hourly_rate: 45,
      reviewed_requirements: ['Give the receipt printer a reserved IP address', 'Survey the back-office Wi-Fi and move the access point channel'],
      reviewed_scope_summary: 'We will make the receipt printer stay connected and speed up the back-office Wi-Fi.',
      work_log: log([[4, '09:00', '10:30', 'Site visit, printer DHCP reservation'], [2, '14:00', '16:00', 'Wi-Fi survey and channel change']]),
    },
    {
      project_id: 'AVONDA-5JC-1TB', request_type: 'IT Support', status: 'awaiting_signoff', created_at: ago(12 * DAY), updated_at: ago(3 * DAY), signoff_sent_at: ago(3 * DAY),
      ...person('Chipo', 'Marufu', 'Avondale Law Chambers', 'avondalelaw.example', { position: 'Partner' }),
      details: 'Two partners lost access to the shared case mailbox after a password reset.',
      users_affected: '2', devices_affected: 'Laptops', attempts_taken: 'None', priority: 1, can_work: false,
      project_title: 'Shared Mailbox Access Restored', estimated_hours: 2, hourly_rate: 45,
      reviewed_requirements: ['Restore Full Access and Send As permissions', 'Re-add the mailbox in Outlook for both partners'],
      reviewed_scope_summary: 'We will restore both partners’ access to the shared case mailbox.',
      work_log: log([[4, '08:30', '10:15', 'Permissions restored, profiles re-added']]),
    },
    // ---- Project delivery ----
    {
      project_id: 'KOPJEW-6TD-5LH', request_type: 'IT Project', status: 'signed', created_at: ago(40 * DAY), updated_at: ago(2 * DAY), signed_at: ago(26 * DAY),
      ...person('Rudo', 'Chari', 'Kopje Works', 'kopjeworks.example', { position: 'Managing Director' }),
      details: 'Secure our Microsoft 365 tenant: MFA, conditional access, and device compliance for 30 staff.',
      project_title: 'Microsoft 365 Security Hardening', contract_value: 4800, vat_applicable: true,
      pricing_estimate: 'US$4,800 excl. VAT, in three milestones', phases: phases(3, 24),
      reviewed_requirements: ['MFA for all 30 users with number matching', 'Conditional Access baseline (block legacy auth, require compliant devices)', 'Intune compliance policies for Windows and mobile'],
      reviewed_scope_summary: 'We will make your Microsoft 365 accounts much harder to break into, with MFA, sign-in rules and device checks for all 30 staff.',
    },
    {
      project_id: 'GREEND-9MA-3QS', request_type: 'IT Project', status: 'signed', created_at: ago(70 * DAY), updated_at: ago(1 * DAY), signed_at: ago(52 * DAY),
      ...person('Simba', 'Gumbo', 'Greendale Academy', 'greendaleacademy.example', { position: 'Bursar' }),
      details: 'Teams and OneDrive for 60 teachers, with training sessions.',
      project_title: 'Teams and OneDrive Rollout', contract_value: 3600, vat_applicable: true,
      pricing_estimate: 'US$3,600 excl. VAT', phases: phases(6, 50),
      reviewed_requirements: ['Teams for 60 staff with class and department teams', 'OneDrive Known Folder Move', 'Two training sessions'],
      reviewed_scope_summary: 'Teams and OneDrive for all teachers, with their files backed up and two training sessions.',
    },
    // ---- Finished work (earnings) ----
    {
      project_id: 'MABELR-3XV-7PD', request_type: 'IT Project', status: 'closed', created_at: ago(120 * DAY), updated_at: ago(60 * DAY), signed_at: ago(110 * DAY), closed_at: ago(60 * DAY),
      ...person('Kuda', 'Zhou', 'Mabelreign Motors', 'mabelreignmotors.example'),
      details: 'New domain, email and website hosting for the dealership.', project_title: 'Domain and Email Setup',
      contract_value: 1450, vat_applicable: true, phases: phases(7, 110),
    },
    {
      project_id: 'AVONDA-8KD-2WR', request_type: 'IT Support', status: 'completed', created_at: ago(45 * DAY), updated_at: ago(38 * DAY), completed_at: ago(38 * DAY),
      ...person('Chipo', 'Marufu', 'Avondale Law Chambers', 'avondalelaw.example', { position: 'Partner' }),
      details: 'Laptop will not boot after an update.', project_title: 'Laptop Boot Repair', estimated_hours: 3, hourly_rate: 45,
      work_log: log([[40, '09:00', '12:15', 'Startup repair, BitLocker key recovered, update rolled back']]),
    },
    {
      project_id: 'KARIBA-5FN-9QC', request_type: 'IT Support', status: 'completed', created_at: ago(20 * DAY), updated_at: ago(15 * DAY), completed_at: ago(15 * DAY),
      ...person('Tariro', 'Ncube', 'Kariba Logistics', 'kariba-logistics.example'),
      details: 'Scanner to email stopped working at the depot.', project_title: 'Scan-to-Email Fix', estimated_hours: 1.5, hourly_rate: 45,
      work_log: log([[16, '13:00', '14:30', 'SMTP relay re-authorised for the copier']]),
    },
    // ---- Domains and consultancy ----
    {
      project_id: 'BELVED-7HW-4MC', request_type: 'Domains', status: 'domain_requested', created_at: ago(1 * DAY), updated_at: ago(1 * DAY),
      ...person('Ruvimbo', 'Chikore', 'Belvedere Bakery', 'belvederebakery.example'),
      details: 'We would like belvederebakery.co.zw and a matching .com if available.', domain_service: 'register',
      domains: [{ name: 'belvederebakery.co.zw' }, { name: 'belvederebakery.com' }],
    },
    {
      project_id: 'EASTLE-4PB-6VN', request_type: 'Consultancy', status: 'consult_requested', created_at: ago(2 * DAY), updated_at: ago(2 * DAY),
      ...person('Tapiwa', 'Mlambo', 'Eastlea Accounting', 'eastleaaccounting.example', { position: 'Senior Partner' }),
      details: 'We have 15 staff on personal Gmail accounts. What would moving to Microsoft 365 involve, and what licence would you recommend?',
    },
    // A year of earlier finished work, so the earnings chart has some history
    ...[
      [300, 'IT Project', 'Network Refresh', 'Mabelreign Motors', 'mabelreignmotors.example', 2200],
      [250, 'IT Support', 'Firewall Rule Clean-up', 'Kariba Logistics', 'kariba-logistics.example', 6],
      [210, 'IT Project', 'Backup to Azure', 'Greendale Academy', 'greendaleacademy.example', 1900],
      [170, 'IT Support', 'Teams Calling Fault', 'Chiedza Trust', 'chiedzatrust.example', 4],
      [140, 'IT Project', 'Entra ID Clean-up', 'Avondale Law Chambers', 'avondalelaw.example', 1250],
      [95, 'IT Support', 'Printer Fleet Drivers', 'Borrowdale Pharmacy', 'borrowdalepharmacy.example', 5],
      [75, 'IT Project', 'SharePoint Document Library', 'Hillside Clinic', 'hillsideclinic.example', 980],
    ].map(([d, type, title, company, domain, n], i) => ({
      project_id: `${company.replace(/[^A-Z]/gi, '').slice(0, 6).toUpperCase()}-${i}H${i}-${i + 2}PX`, request_type: type,
      status: type === 'IT Project' ? 'closed' : 'completed', created_at: ago((d + 20) * DAY), updated_at: ago(d * DAY),
      ...person('Alex', 'Client', company, domain), details: title, project_title: title,
      ...(type === 'IT Project'
        ? { contract_value: n, signed_at: ago((d + 15) * DAY), closed_at: ago(d * DAY), phases: phases(8, d + 15) }
        : { estimated_hours: n, hourly_rate: 45, completed_at: ago(d * DAY), work_log: log([[d + 1, '08:00', `${String(8 + n).padStart(2, '0')}:00`, title]]) }),
    })),
  ].map((p) => ({ id: id(), confirm_token: crypto.randomUUID(), phases: [], work_log: [], vat_applicable: true, ...p }));

  const byRef = (r) => projects.find((p) => p.project_id === r);
  const year = new Date().getFullYear();
  const kopje = byRef('KOPJEW-6TD-5LH'); const mabel = byRef('MABELR-3XV-7PD');
  const invoices = [
    { id: id(), number: `AW-INV-${year}-0001`, request_id: mabel.id, ref: mabel.project_id, company: mabel.company_name, contact_name: 'Kuda Zhou', email: mabel.email,
      lines: [{ description: 'Domain and email setup', qty: 1, unit_price: 1450 }], subtotal: 1450, vat_rate: 15.5, vat: 224.75, total: 1674.75, currency: 'USD',
      issued_at: ago(60 * DAY), due_date: day(-46), status: 'paid', paid_at: ago(50 * DAY), created_at: ago(60 * DAY) },
    { id: id(), number: `AW-INV-${year}-0002`, request_id: kopje.id, ref: kopje.project_id, company: kopje.company_name, contact_name: 'Rudo Chari', email: kopje.email,
      lines: [{ description: 'Milestone 1 of 3: MFA and Conditional Access', qty: 1, unit_price: 1600 }], subtotal: 1600, vat_rate: 15.5, vat: 248, total: 1848, currency: 'USD',
      issued_at: ago(10 * DAY), due_date: day(4), status: 'issued', created_at: ago(10 * DAY) },
  ];
  const receipts = [
    { id: id(), number: `AW-RCT-${year}-0001`, invoice_id: invoices[0].id, request_id: mabel.id, ref: mabel.project_id, company: mabel.company_name, email: mabel.email,
      amount: 1674.75, method: 'Bank transfer', reference: 'FT2610-48213', received_on: day(-50), source: 'generated', created_at: ago(50 * DAY) },
  ];
  const follow_ups = [
    { id: id(), project_id: kopje.id, project_ref: kopje.project_id, company_name: kopje.company_name, contact_name: 'Rudo Chari', email: kopje.email,
      amount: 1848, due_date: day(4), notes: 'Milestone 1 invoice', status: 'open', reminder_enabled: true, reminder_frequency: 'weekly', reminder_weekday: 1,
      reminder_time: '08:00', next_reminder_at: new Date(Date.now() + 3 * DAY).toISOString(), followups_sent: 0, created_at: ago(10 * DAY), updated_at: ago(10 * DAY) },
  ];

  return { projects, invoices, receipts, follow_ups, app_settings: [] };
}

module.exports = { seed };
