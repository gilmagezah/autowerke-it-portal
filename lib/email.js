const { buildProgressUpdateHtml } = require('./progress');
const { computeProgress } = require('./phases');

// Sends the review email using Resend (https://resend.com)
// Uses their shared test sender so you need zero domain setup to start.

const { emailLayout, emailFrom, emailReplyTo } = require('./brand');

// Every email goes through here: branded layout, sender name, error handling.
// Resend's most common setup errors, translated into what to actually do
function resendHint(status, text) {
  const t = String(text).toLowerCase();
  if (t.includes('not verified')) return ' - Fix: the domain in EMAIL_FROM is not verified in Resend yet. Check Resend → Domains (DNS can take a while to propagate).';
  if (t.includes('own email address') || t.includes('testing emails')) return ' - Fix: you are still on the shared test sender, which only delivers to your own Resend account address. Verify your domain and set EMAIL_FROM.';
  if (status === 401 || t.includes('api key is invalid')) return ' - Fix: RESEND_API_KEY is missing or wrong.';
  if (t.includes('invalid `from`') || t.includes('from field')) return ' - Fix: EMAIL_FROM is not a valid sender, e.g. AutoWerke | IT <noreply@mail.autowerkeit.com>';
  return '';
}

async function sendEmail({ to, subject, html, attachments, preheader, paper = false }) {
  const payload = {
    from: emailFrom(),
    to,
    subject,
    html: require('./fileAccess').rewriteForEmail(emailLayout(html, process.env.BASE_URL, { preheader, paper })),
  };
  if (attachments) payload.attachments = attachments;
  const replyTo = emailReplyTo();
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errText}${resendHint(response.status, errText)}`);
  }
  return response.json();
}

// ---------- House-style building blocks for client emails (inline styles: email apps drop CSS) ----------
const HS = { green: '#2F4A3B', paper: '#F4F1E8', pale: '#B9C7BB', line: '#E0DCD0', ink: '#1F2622', muted: '#7B7B70', mono: "'Courier Prime','Courier New',Courier,monospace" };

// Bold typewriter label (what it is · reference), the heading, then a short green rule, like the PDFs.
// `label` and `title` must already be escaped. `rule: false` for plainer, more serious emails.
function head(title, label, { big = false, rule = true } = {}) {
  return `
    ${label ? `<div style="font-family:${HS.mono};font-size:11.5px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${HS.muted};margin:0 0 8px;">${label}</div>` : ''}
    <h2 style="margin:0 0 ${rule ? 12 : 16}px;font-family:${HS.mono};font-size:${big ? 26 : 21}px;line-height:1.25;color:${big ? HS.green : HS.ink};">${title}</h2>
    ${rule ? `<div style="width:36px;height:2px;background:${HS.green};margin:0 0 18px;font-size:0;line-height:0;">&nbsp;</div>` : ''}`;
}

// The one main action in an email. A table cell, so Outlook keeps the colour. `onGreen` gives the
// cream button used inside a green panel.
function button(url, label, { onGreen = false } = {}) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:${onGreen ? '14px 0 0' : '20px 0 10px'};"><tr>
      <td class="${onGreen ? 'aw-btn-cream' : 'aw-btn'}" style="background:${onGreen ? HS.paper : HS.green};border-radius:6px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${onGreen ? HS.green : '#FFFFFF'};text-decoration:none;">${label}</a></td>
    </tr></table>`;
}

// Plain cream box for something quoted or set apart (a reason, a note, a price as written)
const panel = (inner) => `<div class="aw-cream" style="background:${HS.paper};border-radius:6px;padding:12px 16px;margin:6px 0 14px;font-size:14px;line-height:1.55;">${inner}</div>`;

// Rounded green panel: a bold pale label, cream text, then optionally a cream button
function greenPanel(label, inner, cta = '') {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${HS.green};border-radius:8px;margin:18px 0;"><tr>
      <td style="padding:16px 18px;">
        <div style="font-family:${HS.mono};font-size:12px;font-weight:bold;letter-spacing:2px;color:${HS.paper};">${label}</div>
        <div style="color:${HS.paper};margin:8px 0 0;font-size:14px;line-height:1.55;">${inner}</div>
        ${cta}
      </td></tr></table>`;
}

// A figure that matters (amount due, amount received, who signed) in a green panel, typewriter type
function figurePanel(label, figure, sub = '') {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${HS.green};border-radius:8px;margin:14px 0;"><tr>
      <td style="padding:16px 18px;font-family:${HS.mono};">
        <div style="font-size:11.5px;font-weight:bold;letter-spacing:2px;color:${HS.pale};">${label}</div>
        <div style="font-size:24px;font-weight:bold;color:${HS.paper};margin-top:4px;">${figure}</div>
        ${sub ? `<div style="font-size:12px;color:${HS.pale};margin-top:3px;">${sub}</div>` : ''}
      </td></tr></table>`;
}

// Invoice-style lines: label left, bold typewriter figures right, a green rule over the total
function priceTable(rows, [totalLabel, totalValue]) {
  const td = `padding:8px 0;border-bottom:1px solid ${HS.line};`;
  const body = rows.filter(Boolean).map(([label, value]) => `
      <tr><td style="${td}color:#3D4640;">${label}</td><td style="${td}text-align:right;font-family:${HS.mono};font-weight:bold;white-space:nowrap;">${value}</td></tr>`).join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0 16px;">${body}
      <tr><td style="padding:10px 0 4px;border-top:2px solid ${HS.green};font-weight:bold;">${totalLabel}</td><td style="padding:10px 0 4px;border-top:2px solid ${HS.green};text-align:right;font-family:${HS.mono};font-size:17px;font-weight:bold;white-space:nowrap;">${totalValue}</td></tr>
    </table>`;
}

// The contract's price table, compact for email: lines (description, qty, unit price, amount),
// then subtotal, VAT and total on the right. Reads the pricing text the same way the contract PDF
// does (lib/pdfDoc.js parsePricing), so both always agree. Returns '' if no line could be read.
function itemTable(text) {
  const p = require('./pdfDoc').parsePricing(text);
  if (!p.rows.length) return '';
  const hasQty = p.rows.some((r) => r.qty !== null);
  const th = `padding:7px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${HS.muted};background:${HS.paper};`;
  const td = `padding:8px;border-bottom:1px solid ${HS.line};vertical-align:top;`;
  const num = `${td}text-align:right;font-family:${HS.mono};font-weight:bold;white-space:nowrap;`;
  const rows = p.rows.map((r) => `
      <tr><td style="${td}">${escapeHtml(r.description)}</td>${hasQty ? `<td style="${num}">${r.qty === null ? '' : escapeHtml(String(r.qty))}</td><td style="${num}">${r.unit === null ? '' : fmtMoney(r.unit)}</td>` : ''}<td style="${num}">${fmtMoney(r.amount)}</td></tr>`).join('');
  // Totals as written; a missing subtotal or total is worked out from the lines (as the PDF does)
  const sum = Math.round(p.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const subtotal = p.subtotal ?? sum;
  const vat = p.vat ?? (p.vatRate ? Math.round(subtotal * p.vatRate) / 100 : null);
  const total = p.total ?? Math.round((subtotal + (vat || 0)) * 100) / 100;
  const trow = (label, value) => `<tr><td style="padding:4px 0;color:#3D4640;">${label}</td><td style="padding:4px 0;text-align:right;font-family:${HS.mono};font-weight:bold;white-space:nowrap;">${value}</td></tr>`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13.5px;margin:12px 0 6px;">
      <tr><td class="aw-cream" style="${th}">Description</td>${hasQty ? `<td class="aw-cream" style="${th}text-align:right;">Qty</td><td class="aw-cream" style="${th}text-align:right;">Unit price</td>` : ''}<td class="aw-cream" style="${th}text-align:right;">Amount</td></tr>${rows}
    </table>
    <table role="presentation" align="right" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13.5px;width:260px;max-width:100%;margin:6px 0 16px;">
      ${vat !== null || p.subtotal !== null ? trow('Subtotal', fmtMoney(subtotal)) : ''}
      ${vat !== null ? trow(`VAT${p.vatRate ? ` (${p.vatRate}%)` : ''}`, fmtMoney(vat)) : ''}
      <tr><td style="padding:8px 0 2px;border-top:2px solid ${HS.green};font-weight:bold;font-size:15px;">Total (USD)</td><td style="padding:8px 0 2px;border-top:2px solid ${HS.green};text-align:right;font-family:${HS.mono};font-size:17px;font-weight:bold;white-space:nowrap;">${fmtMoney(total)}</td></tr>
    </table>
    <div style="clear:both;font-size:0;line-height:0;">&nbsp;</div>
    ${p.notes.length ? `<p style="margin:4px 0 0;font-size:13px;color:#5A5A5A;">${p.notes.map(escapeHtml).join('<br>')}</p>` : ''}`;
}

// The client's website, when they gave one (already checked by lib/website.js)
function websiteLine(url) {
  if (!url || !/^https?:\/\/[^\s"'<>]+$/i.test(url)) return '';
  const { displayWebsite } = require('./website');
  return `<p><strong>Website:</strong> <a href="${escapeHtml(url)}">${escapeHtml(displayWebsite(url))}</a></p>`;
}

async function sendReviewEmail({ submission, aiDraft, projectId, priority = null, canWork = null, attachments = [], baseUrl = process.env.BASE_URL }) {
  const { PRIORITY_LABELS } = require('./priority');
  const priorityHtml = priority
    ? `<p><strong>Priority:</strong> <span style="font-family:'Courier New',monospace;font-weight:bold;color:${priority >= 4 ? '#A33A2E' : '#2F4A3B'};">P${priority}</span> · ${escapeHtml(PRIORITY_LABELS[priority])}${canWork === false ? ' · <strong>cannot work</strong>' : ''}</p>`
    : '';
  const shotsHtml = attachments.length
    ? `<h3>Attachments (${attachments.length})</h3><p>${attachments.map((a, i) => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name || `Attachment ${i + 1}`)}</a>${/^text\//.test(a.type) ? ' (text)' : ''}`).join(' · ')}</p>`
    : '';
  const requirementsHtml = aiDraft.requirements
    .map((r) => `<li>${escapeHtml(r)}</li>`)
    .join('');

  const html = `
    <h2>New ${escapeHtml(submission.requestType)} request — ${escapeHtml(submission.companyName)}</h2>
    <p><strong>Reference:</strong> ${escapeHtml(projectId)}</p>
    ${priorityHtml}
    <p><strong>Contact:</strong> ${escapeHtml(submission.name)} ${escapeHtml(submission.surname || '')}${submission.position ? ` (${escapeHtml(submission.position)})` : ''}
       — ${escapeHtml(submission.email)}${submission.phone ? `, ${escapeHtml(submission.phone)}` : ''}</p>
    ${websiteLine(submission.companyWebsite)}

    <h3>Client's original submission</h3>
    <p>${nl2br(submission.details)}</p>

    <h3>AI-drafted requirements</h3>
    <ul>${requirementsHtml}</ul>

    <h3>AI-drafted scope summary</h3>
    <p>${nl2br(aiDraft.scope_summary)}</p>
    ${shotsHtml}
    <p><a href="${baseUrl}/admin">Review and approve it in the admin pipeline</a></p>
  `;

  return sendEmail({
    to: [process.env.ADMIN_EMAIL],
    subject: `${priority >= 4 ? `[P${priority}] ` : ''}New ${submission.requestType} request: ${submission.companyName}`,
    html,
  });
}

// To the client, the moment an IT Support or IT Project request arrives: their reference, a
// copy of what they sent, and what happens next. (Domains and Consultancy have their own.)
// No AI draft here: you review the request before the client sees any scope.
async function sendRequestReceivedEmail({ project, attachments = [], baseUrl = process.env.BASE_URL }) {
  const { PRIORITY_LABELS } = require('./priority');
  const support = project.request_type === 'IT Support';
  const kind = support ? 'support request' : 'project request';
  const details = String(project.details || '');
  const excerpt = details.length > 600 ? `${details.slice(0, 600).trimEnd()}…` : details;
  const facts = [
    support && project.priority ? `<strong>Priority:</strong> P${project.priority}, &ldquo;${escapeHtml(PRIORITY_LABELS[project.priority] || '')}&rdquo;${project.can_work === false ? '<br>You told us you can\'t work at all right now.' : ''}` : '',
    attachments.length ? `<strong>Attached:</strong> ${attachments.map((a) => escapeHtml(a.name)).join(', ')}` : '',
  ].filter(Boolean).map((f) => `<p style="margin:4px 0;">${f}</p>`).join('');
  const steps = support
    ? ['We review your request and confirm what needs fixing.', 'We send you a work estimate (hours and rate) to approve.', 'Once you approve it, we get to work and keep you posted.']
    : ['We review your request and write up the scope: what we\'ll deliver.', 'You confirm the scope, or ask for changes.', 'We send you the pricing, then the contract to get started.'];
  const urgent = support && project.priority >= 4
    ? `<p>Because it's urgent, it's at the front of our queue. If anything changes, reply to this email.</p>`
    : '';
  const html = `
    ${head('Thank you for choosing us.', `${support ? 'Support' : 'Project'} request received · ${escapeHtml(project.project_id)}`, { big: true })}
    <p style="font-size:15px;">Hi ${escapeHtml(project.name || 'there')}, we've received your ${kind} and we appreciate the opportunity to ${support ? 'help' : 'work with you on it'}.</p>
    <p>Your reference is <strong style="font-family:${HS.mono};">${escapeHtml(project.project_id)}</strong>. Keep it handy: you'll need it to track your request.</p>
    <h3>What you sent us</h3>
    <div style="border-left:3px solid #DEDACD;padding:2px 0 2px 12px;margin:4px 0 12px;color:#3D4640;">${nl2br(excerpt)}</div>
    ${facts}
    ${urgent}
    <h3>What happens next</h3>
    <ol style="padding-left:20px;margin:4px 0 12px;">${steps.map((s) => `<li style="margin:3px 0;">${s}</li>`).join('')}</ol>
    <p>You can check progress anytime at <a href="${baseUrl}/track">${baseUrl}/track</a> with your reference and email address.</p>
    <p>If you'd like to add anything, just reply to this email.</p>`;
  return sendEmail({
    to: [project.email],
    subject: `${support ? 'Support' : 'Project'} request received — ${project.project_id}`,
    preheader: `Thank you for choosing us. Your reference is ${project.project_id}.`,
    paper: true,
    html,
  });
}

async function sendClientConfirmationEmail({ project, baseUrl, revised = false }) {
  const confirmUrl = `${baseUrl}/confirm/${project.confirm_token}`;
  const requirementsHtml = (project.reviewed_requirements || [])
    .map((r) => `<li>${escapeHtml(r)}</li>`)
    .join('');

  const html = `
    ${head(revised ? 'We\'ve updated your scope based on your feedback' : 'Your project scope is ready to review', `Project scope · ${escapeHtml(project.project_id)}`)}
    <p>Here's what we'll deliver${project.project_title ? ` for <strong>${escapeHtml(project.project_title)}</strong>` : ''}. Please read it through, then confirm it or ask for changes.</p>
    <h3>Scope summary</h3>
    <p>${nl2br(project.reviewed_scope_summary)}</p>
    <h3>Requirements</h3>
    <ul style="padding-left:20px;margin:4px 0 12px;">${requirementsHtml}</ul>
    ${button(confirmUrl, revised ? 'Review the updated scope' : 'Review and confirm the scope')}
  `;

  return sendEmail({
    to: [project.email],
    subject: revised
      ? `Updated scope ready to confirm — ${project.project_id}`
      : `Please confirm your project scope — ${project.project_id}`,
    preheader: revised ? 'We\'ve made the changes you asked for. Please take a look.' : 'Here\'s what we\'ll deliver. Please confirm it or ask for changes.',
    html,
  });
}

async function sendPricingEmail({ project, baseUrl }) {
  const link = `${baseUrl}/confirm/${project.confirm_token}`;

  const html = `
    ${head('Your project estimate is ready', `Project estimate · ${escapeHtml(project.project_id)}`)}
    <p>Thank you for confirming the scope. Here's our estimate for the work:</p>
    ${itemTable(project.pricing_estimate) || panel(nl2br(project.pricing_estimate))}
    ${button(link, 'View the estimate and decide')}
  `;

  return sendEmail({
    to: [project.email],
    subject: `Your project estimate — ${project.project_id}`,
    preheader: 'Our estimate for the work you confirmed.',
    html,
  });
}

async function sendEstimateEmail({ project, baseUrl }) {
  const link = `${baseUrl}/confirm/${project.confirm_token}`;
  // Same maths as the estimate PDF and the final support bill (VAT included)
  const b = require('./supportSignoff').supportBilling({ ...project, work_log: [] });
  const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const html = `
    ${head('Your work estimate is ready', `Work estimate · ${escapeHtml(project.project_id)}`)}
    <p>Here's how long we expect the work to take. Nothing starts until you approve it.</p>
    ${priceTable([
    ['Estimated hours', `${escapeHtml(String(project.estimated_hours))} h`],
    ['Rate', `${usd(b.rate)} / h`],
    ['Subtotal', usd(b.subtotal)],
    b.vatApplies && [`VAT (${b.vatRate}%)`, usd(b.vat)],
  ], [`Estimated total${b.vatApplies ? ' incl. VAT' : ''}`, usd(b.total)])}
    ${button(link, 'Review and approve the estimate')}
  `;

  return sendEmail({
    to: [project.email],
    subject: `Your work estimate — ${project.project_id}`,
    preheader: `Estimated total ${usd(b.total)}. Nothing starts until you approve it.`,
    html,
  });
}

async function sendProgressUpdateEmail({ project, message, baseUrl }) {
  const html = buildProgressUpdateHtml({ project, message, baseUrl });
  const { done, total } = computeProgress(project.phases || []);

  return sendEmail({
    to: [project.email],
    subject: `Project update — ${project.project_id}: ${done} of ${total} phases complete`,
    html,
  });
}

function signOnlineButton(project, baseUrl) {
  const url = `${baseUrl}/signoff?ref=${encodeURIComponent(project.project_id)}`;
  return `
    ${greenPanel('FASTEST · SIGN ONLINE', "Review and sign in a few minutes. We'll email you a one-time code to confirm it's you.", button(url, 'Sign online securely', { onGreen: true }))}
    <p style="margin:0 0 6px;font-size:13px;color:#5A5A5A;">Prefer paper? You can still print, sign, and upload the attached copy instead:</p>`;
}

async function sendSignoffEmail({ project, pdfBuffer, baseUrl }) {
  const link = `${baseUrl}/confirm/${project.confirm_token}`;
  const title = (project.signoff && project.signoff.project_title) || project.project_title || 'your project';
  const filename = `${project.project_id}-sign-off.pdf`;

  const html = `
    ${head('Your project sign-off document', `Project sign-off · ${escapeHtml(project.project_id)}`)}
    <p>All phases of <strong>${escapeHtml(title)}</strong> are complete. Thank you for working with us on it. Your sign-off document is attached.</p>
    <p>Please review it, sign the acceptance section, and upload the signed copy using the link below
       (you can also download the document again from there).</p>
    ${signOnlineButton(project, baseUrl)}
    <p><a href="${link}">Review and return your signed sign-off</a></p>
  `;

  return sendEmail({
    to: [project.email],
    subject: `Sign-off document — ${project.project_id}`,
    preheader: 'Every phase is complete. Your sign-off document is attached.',
    html,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  });
}

// What happens next, depending on where the support ticket was when converted
const CONVERSION_NEXT_STEP = {
  pending_review: "We're reviewing your request now and will send you a project scope to confirm shortly.",
  reviewed: 'Please use the link below to review and confirm the scope - it now covers your request as a project.',
  changes_requested: "We're updating the scope with the changes you asked for, and will send it back to you as a project scope.",
  client_confirmed: "You've already confirmed the scope, so the next thing you'll receive is a project price.",
  estimate_sent: "The hourly support estimate we sent earlier is withdrawn - you'll receive a fixed project price instead.",
};

async function sendConversionEmail({ project, previousStatus, reason, baseUrl }) {
  const portal = `${baseUrl}/confirm/${project.confirm_token}`;
  const showPortal = previousStatus !== 'pending_review'; // nothing to see there until the scope is reviewed
  const title = project.project_title ? ` (${escapeHtml(project.project_title)})` : '';

  const html = `
    ${head('Your request is now an IT project', `IT Project · ${escapeHtml(project.project_id)}`, { rule: false })}
    <p>After reviewing your support request${title}, we've moved it from <strong>IT Support</strong> to an <strong>IT Project</strong>.</p>
    <h3>Why</h3>
    ${panel(nl2br(reason))}
    <h3>What this means for you</h3>
    <p>Instead of hourly support billing, the work will be scoped and priced as a project,
       with a clear scope, a fixed price, and progress updates as each phase is completed.</p>
    <h3>What happens next</h3>
    <p>${escapeHtml(CONVERSION_NEXT_STEP[previousStatus] || '')}</p>
    <p>Your reference number stays the same, so you can keep tracking everything with <strong>${escapeHtml(project.project_id)}</strong>.</p>
    <p>${showPortal ? `<a href="${portal}">Open your project portal</a>` : `<a href="${baseUrl}/track">Track your request</a>`}</p>
  `;

  return sendEmail({
    to: [project.email],
    subject: `Your request is now an IT project — ${project.project_id}`,
    preheader: 'It will be scoped and priced as a project. Your reference stays the same.',
    html,
  });
}

async function sendSupportSignoffEmail({ project, pdfBuffer, billing, baseUrl }) {
  const link = `${baseUrl}/confirm/${project.confirm_token}`;
  const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const title = project.project_title ? ` (${escapeHtml(project.project_title)})` : '';

  const html = `
    ${head('Your support ticket is complete', `Support sign-off · ${escapeHtml(project.project_id)}`)}
    <p>The work on your support ticket${title} is done. Thank you for trusting us with it. Your completion sign-off is attached, with every session we logged.</p>
    ${priceTable([
    [billing.usedEstimate ? 'Hours billed (approved estimate)' : 'Hours logged', `${billing.billableHours} h`],
    ['Rate', `${money(billing.rate)} / h`],
    ['Subtotal', money(billing.subtotal)],
    billing.vatApplies && [`VAT (${billing.vatRate}%)`, money(billing.vat)],
  ], ['Total due', money(billing.total)])}
    <p>Please review it, sign the acceptance section, and upload the signed copy using the link below
       (you can also see the time logged and download the document again there).</p>
    ${signOnlineButton(project, baseUrl)}
    <p><a href="${link}">Review and return your signed sign-off</a></p>
  `;

  return sendEmail({
    to: [project.email],
    subject: `Support completion sign-off — ${project.project_id}`,
    preheader: `The work is done. Total due ${money(billing.total)}. Your sign-off is attached.`,
    html,
    attachments: [{ filename: `${project.project_id}-support-sign-off.pdf`, content: pdfBuffer.toString('base64') }],
  });
}

// Follow-up email to a client about an outstanding payment (text written/edited by the admin)
async function sendFollowupEmail({ followUp, subject, body }) {
  const html = `<div style="font-size:14px;line-height:1.6;">${nl2br(body)}</div>`;
  return sendEmail({ to: [followUp.email], subject, html });
}

// One digest email to the admin listing every payment whose reminder is due
async function sendReminderDigest({ items, baseUrl, now = new Date() }) {
  const { money, fmtDate, daysOverdue } = require('./followups');
  const total = items.reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const rows = items.map((f) => {
    const late = daysOverdue(f.due_date, now); // same moment the scheduler is working with
    const status = f.due_date
      ? (late > 0 ? `<span style="color:#A33A2E;font-weight:bold;">${late} day${late === 1 ? '' : 's'} overdue</span>` : late === 0 ? 'Due today' : `Due ${fmtDate(f.due_date)}`)
      : 'No due date';
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E0DCD0;font-family:'Courier New',Courier,monospace;font-size:13px;">
          <strong>${escapeHtml(f.company_name)}</strong>${f.project_ref ? `<br><span style="color:#77776C;">${escapeHtml(f.project_ref)}</span>` : ''}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #E0DCD0;font-size:12px;">${status}<br><span style="color:#77776C;">${f.followups_sent || 0} follow-up${f.followups_sent === 1 ? '' : 's'} sent</span></td>
        <td style="padding:10px 0;border-bottom:1px solid #E0DCD0;text-align:right;font-family:'Courier New',Courier,monospace;font-weight:bold;">${money(f.amount)}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="background:#2F4A3B;color:#F4F1E8;border-radius:8px;padding:16px 18px;margin-bottom:16px;">
      <div style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:2px;color:#C9D3C6;">PAYMENTS TO FOLLOW UP</div>
      <div style="font-family:'Courier New',Courier,monospace;font-size:24px;font-weight:bold;margin-top:4px;">${money(total)}</div>
      <div style="font-size:12px;color:#C9D3C6;">${items.length} payment${items.length === 1 ? '' : 's'} outstanding</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
    <p style="margin-top:18px;"><a href="${baseUrl}/admin/follow-ups">Open Follow-ups to send reminders</a></p>`;

  return sendEmail({
    to: [process.env.ADMIN_EMAIL],
    subject: `Payment reminder: ${items.length} outstanding (${money(total)})`,
    html,
  });
}

// ================= Domains =================

const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONO = "'Courier Prime','Courier New',Courier,monospace";
const domainListHtml = (domains) => `<ul style="font-family:${MONO};padding-left:18px;margin:8px 0;">${(domains || []).map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`;
const serviceLabel = (p) => (p.domain_service === 'manage' ? 'management of your existing domain(s)' : 'registration of new domain(s)');

async function sendDomainReceivedEmail({ project, baseUrl }) {
  const html = `
    ${head('Thank you for choosing us.', `Domain request received · ${escapeHtml(project.project_id)}`, { big: true })}
    <p style="font-size:15px;">Hi ${escapeHtml(project.name || 'there')}, we've received your request for ${serviceLabel(project)} and we appreciate the opportunity to help:</p>
    ${domainListHtml(project.domains)}
    <p>We're checking availability and pricing now, and will send you a quote shortly.
       Popular names can be taken quickly, so we treat domain requests as a priority.</p>
    <p>Your reference is <strong style="font-family:${HS.mono};">${escapeHtml(project.project_id)}</strong>. You can check progress anytime at <a href="${baseUrl}/track">${baseUrl}/track</a>.</p>`;
  return sendEmail({ to: [project.email], subject: `Domain request received — ${project.project_id}`, preheader: `Thank you for choosing us. We're checking availability and pricing now.`, paper: true, html });
}

async function sendDomainAdminAlert({ project, baseUrl }) {
  const html = `
    <h2 style="color:#A33A2E;">Urgent: new domain request</h2>
    <p><strong>${escapeHtml(project.company_name)}</strong> — ${escapeHtml([project.name, project.surname].filter(Boolean).join(' '))}
       (${escapeHtml(project.email)}${project.phone ? `, ${escapeHtml(project.phone)}` : ''})</p>
    ${websiteLine(project.company_website)}
    <p>Service: <strong>${project.domain_service === 'manage' ? 'Manage existing domain(s)' : 'Register new domain(s)'}</strong></p>
    ${domainListHtml(project.domains)}
    ${project.details ? `<p><strong>Notes:</strong><br>${nl2br(project.details)}</p>` : ''}
    <p><a href="${baseUrl}/admin/domains">Check availability and send a quote</a></p>`;
  return sendEmail({ to: [process.env.ADMIN_EMAIL], subject: `URGENT: domain request — ${project.company_name} — ${project.project_id}`, html });
}

async function sendDomainQuoteEmail({ project, baseUrl }) {
  const q = project.domain_quote;
  const lines = q.lines.map((l) => (l.available
    ? [`<span style="font-family:${MONO};">${escapeHtml(l.domain)}</span>${l.years > 1 ? ` (${l.years} years)` : ''}`, fmtMoney(l.price * l.years)]
    : [`<span style="font-family:${MONO};color:#7B7B70;text-decoration:line-through;">${escapeHtml(l.domain)}</span> <span style="color:#A33A2E;">unavailable</span>`, '—']));
  const html = `
    ${head('Your domain quote', `Domain quote · ${escapeHtml(project.project_id)}`)}
    <p>Here's what it costs to ${project.domain_service === 'manage' ? 'take over management of' : 'register'} your domain${q.lines.length === 1 ? '' : 's'}:</p>
    ${priceTable([
    ...lines,
    ['Service fee', fmtMoney(q.service_fee)],
    ['Subtotal', fmtMoney(q.subtotal)],
    q.vat_applicable && [`VAT (${q.vat_rate}%)`, fmtMoney(q.vat)],
  ], ['Total', fmtMoney(q.total)])}
    ${q.note ? `<p>${nl2br(q.note)}</p>` : ''}
    ${button(`${baseUrl}/confirm/${project.confirm_token}`, 'Review the quote')}
    <p style="color:#7B7B70;font-size:13px;">Domain availability can change quickly, so we recommend confirming as soon as you can.</p>`;
  return sendEmail({ to: [project.email], subject: `Your domain quote — ${project.project_id}`, preheader: `Total ${fmtMoney(q.total)}. Availability can change quickly, so confirm when you can.`, html });
}

// Sent when you mark a domain request complete: confirms it's done and that
// you're on hand for DNS changes, since you manage the domain for them
async function sendDomainCompleteEmail({ project, records }) {
  const managed = project.domain_service === 'manage';
  const rows = (records.length ? records : (project.domains || []).map((d) => ({ domain: d }))).map((r) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;font-family:${MONO};font-weight:bold;">${escapeHtml(r.domain)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;text-align:right;font-size:13px;color:#5A5A5A;">${r.renewal_date ? `Renews ${escapeHtml(require('./followups').fmtDate(r.renewal_date))}` : ''}</td>
    </tr>`).join('');
  const remindsClient = records.some((r) => r.client_reminder_enabled && r.client_email);
  const html = `
    ${head(`Your domain${(project.domains || []).length === 1 ? ' is' : 's are'} ${managed ? 'now managed by us' : 'registered and ready'}`, `Domains · ${escapeHtml(project.project_id)}`)}
    <p>Good news: ${managed ? "we've taken over management of" : "we've registered"} the following for ${escapeHtml(project.company_name)}:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:8px 0 18px;">${rows}</table>
    <div class="aw-cream" style="background:#F4F1E8;border-radius:6px;padding:12px 14px;margin:0 0 12px;font-size:14px;line-height:1.55;">
      <strong>Need DNS records added or changed?</strong><br>
      Because we manage your domain, we can set up or update records whenever you need them: pointing your website,
      setting up email (for example Microsoft 365), adding verification records for other services, and more.
      Just reply to this email or contact us with what you need.
    </div>
    ${remindsClient ? '<p style="margin-top:16px;">We\'ll also email you a reminder before each renewal is due.</p>' : ''}
    <p>Thanks for choosing us.</p>`;
  return sendEmail({
    to: [project.email],
    subject: `${managed ? 'Domain management confirmed' : 'Your domain is registered'} — ${project.project_id}`,
    preheader: managed ? "We've taken over management of your domain." : 'Your domain is registered and ready to use.',
    html,
  });
}

async function sendRenewalDigest({ items, baseUrl }) {
  const rows = items.map((r) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;font-family:${MONO};"><strong>${escapeHtml(r.domain)}</strong><br><span style="color:#7B7B70;">${escapeHtml(r.client_company)}</span></td>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;font-size:13px;">${r.days_left < 0 ? `<span style="color:#A33A2E;font-weight:bold;">Expired ${-r.days_left} day${r.days_left === -1 ? '' : 's'} ago</span>` : r.days_left === 0 ? '<strong>Renews today</strong>' : `Renews in ${r.days_left} day${r.days_left === 1 ? '' : 's'}`}<br><span style="color:#7B7B70;">${escapeHtml(r.renewal_date)}${r.registrar_name ? ` · ${escapeHtml(r.registrar_name)}` : ''}</span></td>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;text-align:right;font-family:${MONO};">${r.renewal_total ? fmtMoney(r.renewal_total) : r.renewal_price ? fmtMoney(r.renewal_price) : '—'}${r.renewal_email_ready ? '<br><span style="font-family:Arial,sans-serif;font-size:11px;color:#2F4A3B;font-weight:bold;">EMAIL READY TO SEND</span>' : ''}</td>
    </tr>`).join('');
  const html = `
    <h2>Domain renewals coming up</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rows}</table>
    ${items.some((r) => r.renewal_email_ready) ? '<p>Renewal emails for these have been prepared with the cost breakdown. Review and send them from the registry.</p>' : ''}
    <p><a href="${baseUrl}/admin/domains">Open the domain registry</a></p>`;
  return sendEmail({ to: [process.env.ADMIN_EMAIL], subject: `Domain renewals: ${items.length} coming up`, html });
}

// An admin's own reminders that just came due (Dates & reminders accessory). One email per admin.
async function sendAdminReminderEmail({ to, name, items, baseUrl }) {
  const adminBase = (process.env.ADMIN_URL || baseUrl || '').replace(/\/+$/, '');
  const rows = items.map((r) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;">
        <strong style="font-family:${MONO};">${escapeHtml(r.title)}</strong>${r.ref ? `<br><span style="color:#7B7B70;font-family:${MONO};">${escapeHtml(r.ref)}</span>` : ''}
        ${r.note ? `<br><span style="font-size:13px;color:#3D4640;">${nl2br(r.note)}</span>` : ''}
      </td>
      <td style="padding:9px 0;border-bottom:1px solid #E0DCD0;text-align:right;font-family:${MONO};font-size:13px;white-space:nowrap;">${escapeHtml(r.whenText || '')}</td>
    </tr>`).join('');
  const html = `
    <h2>${items.length === 1 ? 'Reminder' : `${items.length} reminders`}</h2>
    <p>Hi ${escapeHtml(String(name || '').split(' ')[0] || 'there')}, you asked to be reminded:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rows}</table>
    <p><a href="${adminBase}/admin">Open the admin</a> to tick ${items.length === 1 ? 'it' : 'them'} off or snooze.</p>`;
  const subject = items.length === 1 ? `Reminder: ${items[0].title}` : `${items.length} reminders: ${items[0].title} and more`;
  return sendEmail({ to: [to], subject: subject.slice(0, 180), html });
}

// The debrief (Debrief accessory, lib/debrief.js): where everything stands, to one admin.
// Sent on request (30-minute cool-down) or every Monday morning if they turned that on.
async function sendDebriefEmail({ to, name, debrief: d, baseUrl, auto = false }) {
  const adminBase = (process.env.ADMIN_URL || baseUrl || '').replace(/\/+$/, '');
  const c = d.counts;
  const td = `padding:9px 0;border-bottom:1px solid ${HS.line};vertical-align:top;`;
  const right = `${td}text-align:right;font-family:${MONO};font-size:13px;white-space:nowrap;padding-left:12px;`;
  const refLine = (ref, company) => `<span style="font-family:${MONO};font-size:12px;color:${HS.muted};">${escapeHtml(ref || '')}${company ? ` · ${escapeHtml(company)}` : ''}</span>`;
  const late = (txt) => `<span style="color:#A33A2E;font-weight:bold;">${txt}</span>`;
  const ago = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);
  const section = (label, rows, empty) => `
    <div style="font-family:${HS.mono};font-size:11.5px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${HS.green};margin:22px 0 2px;">${label}</div>
    ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rows.join('')}</table>`
      : `<p style="margin:6px 0 0;font-size:13.5px;color:${HS.muted};">${empty}</p>`}`;

  const ongoing = d.ongoing.map((p) => `<tr>
      <td style="${td}"><strong>${escapeHtml(p.title || p.label)}</strong><br>${refLine(p.ref, p.company)}
        <br><span style="font-size:13px;color:#3D4640;">${escapeHtml(p.label)}${p.detail ? ` · ${escapeHtml(p.detail)}` : ''}</span></td>
      <td style="${right}">${p.days >= 7 ? late(`untouched ${ago(p.days)}`) : p.days ? `updated ${ago(p.days)} ago` : 'updated today'}</td></tr>`);
  const waiting = d.waiting.map((p) => `<tr>
      <td style="${td}"><strong>${escapeHtml(p.title || p.label)}</strong><br>${refLine(p.ref, p.company)}
        <br><span style="font-size:13px;color:#3D4640;">${escapeHtml(p.label)}</span></td>
      <td style="${right}">${p.days >= 7 ? late(`waiting ${ago(p.days)}`) : `waiting ${ago(p.days)}`}</td></tr>`);
  const reminders = d.reminders.map((r) => `<tr>
      <td style="${td}"><strong>${escapeHtml(r.title)}</strong>${r.ref ? `<br>${refLine(r.ref)}` : ''}</td>
      <td style="${right}">${r.overdue ? late(`${escapeHtml(r.when)} · due`) : escapeHtml(r.when)}</td></tr>`);
  const money = d.invoices.map((i) => `<tr>
      <td style="${td}"><strong style="font-family:${MONO};">${escapeHtml(i.number)}</strong><br><span style="font-size:13px;color:#3D4640;">${escapeHtml(i.company)}${i.left === null ? '' : i.left < 0 ? ` · ${late(`${-i.left} day${i.left === -1 ? '' : 's'} overdue`)}` : i.left === 0 ? ' · due today' : ` · due in ${i.left} day${i.left === 1 ? '' : 's'}`}</span></td>
      <td style="${right}font-weight:bold;">${fmtMoney(i.total)}</td></tr>`);
  const renewals = d.renewals.map((r) => `<tr>
      <td style="${td}"><strong style="font-family:${MONO};">${escapeHtml(r.domain)}</strong><br><span style="font-size:13px;color:#3D4640;">${escapeHtml(r.company)}</span></td>
      <td style="${right}">${r.left < 0 ? late(`lapsed ${-r.left} day${r.left === -1 ? '' : 's'} ago`) : r.left === 0 ? 'renews today' : `renews in ${r.left} day${r.left === 1 ? '' : 's'}`}</td></tr>`);

  const dayName = new Date(`${d.today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const stat = (n, label) => `<td style="padding:0 18px 0 0;font-family:${HS.mono};vertical-align:top;"><div style="font-size:24px;font-weight:bold;color:${HS.paper};">${n}</div><div style="font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:${HS.pale};">${label}</div></td>`;
  const html = `
    ${head('Debrief', escapeHtml(`${auto ? 'Monday debrief' : 'Debrief'} · ${dayName}`))}
    <p style="margin:0 0 4px;">Hi ${escapeHtml(String(name || '').split(' ')[0] || 'there')}, here's where everything stands.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${HS.green};border-radius:8px;margin:14px 0 4px;"><tr><td style="padding:14px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
        ${stat(c.ongoing, 'with us')}${stat(c.waiting, 'on hold')}${stat(c.reminders, 'reminders')}${c.unpaid ? stat(fmtMoney(c.unpaidTotal), 'unpaid') : ''}
      </tr></table></td></tr></table>
    ${section('Ongoing work · with us', ongoing, 'Nothing in our court right now.')}
    ${section('On hold · waiting on clients', waiting, 'Nobody owes us anything.')}
    ${section('Your reminders · overdue and next 7 days', reminders, 'No reminders in the next week.')}
    ${money.length ? section('Unpaid invoices', money, '') : ''}
    ${renewals.length ? section('Domain renewals · next 30 days', renewals, '') : ''}
    ${button(`${adminBase}/admin`, 'Open the pipeline')}
    <p style="font-size:12px;color:${HS.muted};margin:14px 0 0;">${auto ? 'Sent every Monday morning because you turned it on in Accessories → Debrief.' : 'Sent from Accessories → Debrief.'}</p>`;

  const bits = [`${c.ongoing} with us`, `${c.waiting} on hold`];
  if (c.overdueReminders) bits.push(`${c.overdueReminders} reminder${c.overdueReminders === 1 ? '' : 's'} due`);
  if (c.overdueInvoices) bits.push(`${c.overdueInvoices} overdue invoice${c.overdueInvoices === 1 ? '' : 's'}`);
  const short = new Date(`${d.today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return sendEmail({ to: [to], subject: `${auto ? 'Monday debrief' : 'Debrief'}, ${short}: ${bits.join(', ')}`, html, preheader: bits.join(' · ') });
}

// The renewal email you reviewed (and maybe edited) and chose to send
async function sendRenewalEmailToClient({ record, subject, body }) {
  return sendEmail({ to: [record.client_email], subject, html: `<div style="font-size:14px;line-height:1.6;">${nl2br(body)}</div>` });
}

async function sendClientRenewalReminder({ record }) {
  const when = record.days_left === 0 ? 'today' : `in ${record.days_left} day${record.days_left === 1 ? '' : 's'} (${record.renewal_date})`;
  const html = `
    ${head('Your domain renews soon', 'Domain renewal')}
    <p>This is a friendly reminder that <strong style="font-family:${MONO};">${escapeHtml(record.domain)}</strong> is due for renewal ${escapeHtml(when)}.</p>
    ${record.renewal_price ? `<p>Renewal price: <strong style="font-family:${MONO};">${fmtMoney(record.renewal_price)}</strong></p>` : ''}
    <p>We manage this domain for you, so there's nothing you need to do unless you'd like to make changes, or would prefer not to renew. Just reply to this email.</p>`;
  return sendEmail({ to: [record.client_email], subject: `Domain renewal reminder — ${record.domain}`, preheader: `${record.domain} renews ${when}. Nothing for you to do unless you want changes.`, html });
}

// ================= Consultancy =================

async function sendConsultReceivedEmail({ project }) {
  const html = `
    ${head('Thank you for choosing us.', `Consultancy request received · ${escapeHtml(project.project_id)}`, { big: true })}
    <p style="font-size:15px;">Hi ${escapeHtml(project.name || 'there')}, we've received your consultancy request and we appreciate the opportunity to help.</p>
    <p>A consultant is reviewing what you've shared, and you can expect a response from us soon.
       Your reference is <strong style="font-family:${HS.mono};">${escapeHtml(project.project_id)}</strong>.</p>
    <p>If anything else comes to mind in the meantime, just reply to this email.</p>`;
  return sendEmail({ to: [project.email], subject: `Consultancy request received — ${project.project_id}`, preheader: 'Thank you for choosing us. A consultant is reviewing your question.', paper: true, html });
}

async function sendConsultAdminDraft({ project, draft, suggestMeeting, baseUrl }) {
  const html = `
    <h2>New consultancy request — draft ready</h2>
    <p><strong>${escapeHtml(project.company_name)}</strong> — ${escapeHtml([project.name, project.surname].filter(Boolean).join(' '))} (${escapeHtml(project.email)})</p>
    ${websiteLine(project.company_website)}
    <p><strong>Their challenge:</strong></p>
    <div style="background:#F4F1E8;padding:12px 14px;border-radius:6px;">${nl2br(project.details)}</div>
    <p style="margin-top:18px;"><strong>AI draft response${suggestMeeting ? ' (suggests a discovery meeting)' : ''}:</strong></p>
    <div style="border-left:3px solid #DEDACD;padding:4px 14px;">${nl2br(draft)}</div>
    <p style="margin-top:18px;"><a href="${baseUrl}/admin/consultancy">Review, edit and send</a> — nothing goes to the client until you send it.</p>`;
  return sendEmail({ to: [process.env.ADMIN_EMAIL], subject: `Consultancy draft ready — ${project.company_name} — ${project.project_id}`, html });
}

async function sendConsultResponseEmail({ project, body, inviteMeeting, baseUrl, fee = 0 }) {
  const vatRate = Number(process.env.VAT_RATE || 15.5);
  const feeHtml = fee > 0
    ? `<div class="aw-cream" style="background:#F4F1E8;border-radius:6px;padding:10px 14px;margin-top:16px;font-size:13.5px;"><strong>Fee:</strong> $${fee.toFixed(2)} excl. VAT ($${(fee * (1 + vatRate / 100)).toFixed(2)} incl. ${vatRate}% VAT)${inviteMeeting ? ' for the discovery meeting' : ''}. We'll send an invoice; nothing is due until then.</div>`
    : `<p style="color:#2F4A3B;font-size:13.5px;margin-top:16px;"><strong>This consultation is free of charge.</strong></p>`;
  const cta = inviteMeeting
    ? greenPanel('NEXT STEP · DISCOVERY MEETING', 'Choose Teams, Zoom or a phone call, add any colleagues, and tell us which weekdays and times suit you.',
      button(`${baseUrl}/confirm/${project.confirm_token}`, 'Choose your meeting preferences', { onGreen: true }))
    : '';
  const html = `<div style="font-size:14px;line-height:1.6;">${nl2br(body)}</div>${feeHtml}${cta}`;
  return sendEmail({
    to: [project.email],
    subject: inviteMeeting ? `Re: your consultancy request — let's set up a discovery meeting (${project.project_id})` : `Re: your consultancy request — ${project.project_id}`,
    html,
  });
}

async function sendMeetingRequestedAdmin({ project, baseUrl }) {
  const m = project.consult_meeting || {};
  const { fmtDay, PLATFORMS } = require('./consult');
  const slots = (m.slots || []).map((s) => `<li style="font-family:${MONO};">${escapeHtml(fmtDay(s.date))}, ${escapeHtml(s.from)}–${escapeHtml(s.to)}</li>`).join('');
  const html = `
    <h2>Meeting preferences received</h2>
    <p><strong>${escapeHtml(project.company_name)}</strong> — ${escapeHtml(project.project_id)}</p>
    <p>${m.type === 'online' ? `<strong>${escapeHtml(PLATFORMS[m.platform] || '')}</strong> meeting${m.recipients && m.recipients.length ? `, also inviting: ${escapeHtml(m.recipients.join(', '))}` : ''}` : `<strong>Discovery call</strong> to ${escapeHtml(m.phone || '')}`}</p>
    <p>Times that suit them (${escapeHtml(m.timezone || '')}):</p><ul>${slots}</ul>
    ${m.note ? `<p><strong>Note:</strong> ${nl2br(m.note)}</p>` : ''}
    <p><a href="${baseUrl}/admin/consultancy">Pick a time and confirm</a></p>`;
  return sendEmail({ to: [process.env.ADMIN_EMAIL], subject: `Meeting preferences received — ${project.company_name} — ${project.project_id}`, html });
}

async function sendMeetingConfirmedEmail({ project, confirmed, ics }) {
  const { fmtDay, PLATFORMS } = require('./consult');
  const online = confirmed.type === 'online';
  const html = `
    ${head(`Your discovery ${online ? 'meeting' : 'call'} is confirmed`, `Discovery ${online ? 'meeting' : 'call'} · ${escapeHtml(project.project_id)}`)}
    ${figurePanel(online ? escapeHtml(PLATFORMS[confirmed.platform] || 'ONLINE MEETING').toUpperCase() : 'PHONE CALL',
    escapeHtml(fmtDay(confirmed.date)),
    `${escapeHtml(confirmed.start)}–${escapeHtml(confirmed.end)} (${escapeHtml(confirmed.timezone)})`)}
    ${online ? '' : `<p>We'll call you on <strong>${escapeHtml(confirmed.phone)}</strong>.</p>`}
    ${confirmed.message ? `<p>${nl2br(confirmed.message)}</p>` : ''}
    ${online ? button(confirmed.link, `Join the ${escapeHtml(PLATFORMS[confirmed.platform] || 'online')} meeting`) : ''}
    <p>A calendar invite is attached. Need a different time? Just reply to this email.</p>`;
  return sendEmail({
    to: [project.email, ...(confirmed.recipients || [])],
    subject: `Confirmed: discovery ${online ? 'meeting' : 'call'} on ${fmtDay(confirmed.date)} — ${project.project_id}`,
    preheader: `${fmtDay(confirmed.date)}, ${confirmed.start}–${confirmed.end} (${confirmed.timezone}). Calendar invite attached.`,
    html,
    attachments: [{ filename: 'discovery-meeting.ics', content: Buffer.from(ics).toString('base64') }],
  });
}

// ================= One-time codes =================

// Each character in its own box, in the house style. Table-based so every email app renders it.
function codeBoxes(code) {
  const cells = String(code).split('').map((ch) => `
      <td style="padding:0 3px;">
        <div class="aw-cream" style="width:38px;height:48px;line-height:48px;text-align:center;background:#F4F1E8;border:2px solid #2F4A3B;border-radius:7px;font-family:'Courier New',Courier,monospace;font-size:24px;font-weight:bold;color:#1F2622;">${escapeHtml(ch)}</div>
      </td>`).join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:18px auto;"><tr>${cells}</tr></table>`;
}

async function sendAdminLoginCode({ admin, code, minutes }) {
  const html = `
    <h2>Your sign-in code</h2>
    <p>Hi ${escapeHtml(admin.name.split(' ')[0])}, use this code to finish signing in to the admin centre:</p>
    ${codeBoxes(code)}
    <p style="text-align:center;font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;color:#A33A2E;">EXPIRES IN ${minutes} MINUTES · SINGLE USE</p>
    <p style="font-size:13px;color:#5A5A5A;">If you didn't just try to sign in, someone may know your password. Change it from the admin centre as soon as you can. Nobody can get in without this code.</p>`;
  return sendEmail({ to: [admin.email], subject: `Your admin sign-in code: ${code}`, html });
}

// Asked for from the tracking page: the client's private page link, to the address on file only
async function sendPortalLinkEmail({ project, baseUrl = process.env.BASE_URL }) {
  const first = String(project.name || '').split(' ')[0] || 'there';
  const html = `
    ${head('Your private page', `${escapeHtml(project.project_id)}${project.project_title ? ` · ${escapeHtml(project.project_title)}` : ''}`)}
    <p>Hi ${escapeHtml(first)}, here's the link to your private page for <strong>${escapeHtml(project.project_id)}</strong>. It's where you approve, sign and download everything for this request.</p>
    ${button(`${baseUrl}/confirm/${project.confirm_token}`, 'Open your private page')}
    <p style="font-size:13px;color:#5A5A5A;">Someone asked for this link on our tracking page using your reference and email. If that wasn't you, you can ignore this email: the link only ever goes to you.</p>`;
  return sendEmail({ to: [project.email], subject: `Your private page for ${project.project_id}`, preheader: 'The link to approve, sign and download everything for your request.', html });
}

async function sendSignoffCode({ project, code, codeMinutes, sessionMinutes }) {
  const first = String(project.name || '').split(' ')[0] || 'there';
  const html = `
    ${head('Your sign-off code', `Sign-off · ${escapeHtml(project.project_id)}`)}
    <p>Hi ${escapeHtml(first)}, here's your one-time code to open the sign-off for <strong>${escapeHtml(project.project_id)}</strong>${project.project_title ? ` (${escapeHtml(project.project_title)})` : ''}:</p>
    ${codeBoxes(code)}
    <p style="text-align:center;font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;color:#A33A2E;">CODE EXPIRES IN ${codeMinutes} MINUTES · SINGLE USE</p>
    <div class="aw-cream" style="background:#F4F1E8;border-radius:6px;padding:12px 14px;margin:0 0 12px;font-size:13.5px;line-height:1.55;">
      <strong>Before you start:</strong> once you enter the code, your secure sign-off session lasts <strong>${sessionMinutes} minutes</strong>.
      Have any purchase order or proof of payment ready to upload. The page shows a countdown and warns you before time runs out.
    </div>
    <p style="font-size:13px;color:#5A5A5A;">Didn't request this? You can ignore this email. Nothing happens without the code.</p>`;
  return sendEmail({ to: [project.email], subject: `Your sign-off code for ${project.project_id}`, html });
}

async function sendSignedOnlineEmails({ project, esign, signedPdf, total }) {
  const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const clientHtml = `
    ${head('Thank you, your sign-off is complete', `Signed · ${escapeHtml(project.project_id)}`)}
    ${project.project_title ? `<p><strong>${escapeHtml(project.project_title)}</strong></p>` : ''}
    ${figurePanel('SIGNED ELECTRONICALLY', escapeHtml(esign.name), `${escapeHtml(new Date(esign.signed_at).toUTCString())}${total ? ` · ${fmt(total)}` : ''}`)}
    <p>Your signed copy is attached. Its last page is the signature certificate, which records how and when it was signed.</p>
    <p>Thank you for choosing us. It's been a pleasure working with you.</p>`;
  const attachments = [{ filename: `${project.project_id}-signed.pdf`, content: signedPdf.toString('base64') }];
  await sendEmail({ to: [project.email], subject: `Signed: ${project.project_id} sign-off`, preheader: 'Your signed copy, with its signature certificate, is attached.', html: clientHtml, attachments });

  const adminHtml = `
    <h2>Signed online: ${escapeHtml(project.project_id)}</h2>
    <p><strong>${escapeHtml(project.company_name)}</strong> completed the online sign-off.</p>
    <p>Signed by <strong>${escapeHtml(esign.name)}</strong> (${escapeHtml(esign.email)}) by ${escapeHtml(esign.method)} · ${escapeHtml(new Date(esign.signed_at).toUTCString())} · IP ${escapeHtml(esign.ip)}</p>
    ${esign.po_number ? `<p>PO number: <strong>${escapeHtml(esign.po_number)}</strong></p>` : ''}
    ${(esign.documents || []).length ? `<p>Documents uploaded: ${esign.documents.map((d) => `<a href="${escapeHtml(d.url)}">${escapeHtml(d.name)}</a>`).join(' · ')}</p>` : ''}
    <p><a href="${escapeHtml(esign.signed_pdf_url)}">Signed PDF with certificate</a></p>`;
  return sendEmail({ to: [process.env.ADMIN_EMAIL], subject: `Signed online: ${project.project_id} — ${project.company_name}`, html: adminHtml, attachments });
}

// ================= Billing =================

async function sendInvoiceEmail({ invoice, pdf }) {
  const { money, fmtDate } = require('./billing');
  const due = invoice.due_date ? `Due ${fmtDate(invoice.due_date)}` : 'Due on receipt';
  const html = `
    ${head(`Invoice ${escapeHtml(invoice.number)}`, `Invoice${invoice.ref ? ` · ${escapeHtml(invoice.ref)}` : ''}`)}
    <p>Hi${invoice.contact_name ? ` ${escapeHtml(invoice.contact_name.split(' ')[0])}` : ''}, please find your invoice attached${invoice.ref ? ` for <strong>${escapeHtml(invoice.ref)}</strong>` : ''}.</p>
    ${figurePanel('AMOUNT DUE', money(invoice.total), escapeHtml(due))}
    <p>Payment details are on the invoice. Please use <strong style="font-family:${HS.mono};">${escapeHtml(invoice.number)}</strong> as your reference. We'll send a receipt once payment arrives.</p>
    <p>Thank you for your business.</p>`;
  return sendEmail({ to: [invoice.email], subject: `Invoice ${invoice.number} — ${money(invoice.total)}`, preheader: `${money(invoice.total)}, ${due.toLowerCase()}. Your invoice is attached.`, html, attachments: [{ filename: `${invoice.number}.pdf`, content: pdf.toString('base64') }] });
}

async function sendReceiptEmail({ receipt, pdf, filename }) {
  const { money, fmtDate } = require('./billing');
  const how = [receipt.received_on && `Received ${fmtDate(receipt.received_on)}`, receipt.method].filter(Boolean).join(' · ');
  const html = `
    ${head('Payment received, thank you', `Receipt · ${escapeHtml(receipt.number)}`)}
    ${figurePanel('AMOUNT RECEIVED', money(receipt.amount), escapeHtml(how))}
    <p>Thank you for your payment${receipt.ref ? ` for <strong>${escapeHtml(receipt.ref)}</strong>` : ''}. Your receipt <strong style="font-family:${HS.mono};">${escapeHtml(receipt.number)}</strong> is attached for your records.</p>`;
  return sendEmail({ to: [receipt.email], subject: `Receipt ${receipt.number} — ${money(receipt.amount)}`, preheader: `We've received ${money(receipt.amount)}. Thank you. Your receipt is attached.`, html, attachments: [{ filename: filename || `${receipt.number}.pdf`, content: pdf.toString('base64') }] });
}

async function sendAdminNotification({ project, event }) {
  const subjectMap = {
    client_confirmed: `Client confirmed scope — ${project.project_id}`,
    changes_requested: `Client requested changes — ${project.project_id}`,
    proceeding: `Client wants to proceed — ${project.project_id}`,
    declined: `Client declined — ${project.project_id}`,
    signed: `Signed contract received — ${project.project_id}`,
    estimate_approved: `Client approved the estimate — ${project.project_id}`,
    ticket_completed: `Support ticket marked complete — ${project.project_id}`,
    signoff_signed: `Project closed: signed sign-off received — ${project.project_id}`,
    support_signoff_signed: `Support ticket completed: signed sign-off received — ${project.project_id}`,
    domain_accepted: `Domain quote accepted — register now — ${project.project_id}`,
  };

  const bodyMap = {
    client_confirmed: `<p><strong>${escapeHtml(project.company_name)}</strong> confirmed the scope for ${escapeHtml(project.project_id)}. Ready to move to pricing.</p>`,
    changes_requested: `<p><strong>${escapeHtml(project.company_name)}</strong> requested changes on ${escapeHtml(project.project_id)}:</p><p>${nl2br(project.change_request)}</p>`,
    proceeding: `<p><strong>${escapeHtml(project.company_name)}</strong> wants to proceed with ${escapeHtml(project.project_id)}. Contract is now available for them to download and sign.</p>`,
    declined: `<p><strong>${escapeHtml(project.company_name)}</strong> declined to proceed with ${escapeHtml(project.project_id)}.</p>`,
    signed: `<p><strong>${escapeHtml(project.company_name)}</strong> uploaded a signed contract for ${escapeHtml(project.project_id)}: <a href="${escapeHtml(project.signed_contract_url)}">view file</a></p>`,
    estimate_approved: `<p><strong>${escapeHtml(project.company_name)}</strong> returned the signed work estimate for ${escapeHtml(project.project_id)}${project.estimate_signed_url ? ` (<a href="${escapeHtml(project.estimate_signed_url)}">view signed copy</a>)` : ''}. You can start logging hours.</p>`,
    ticket_completed: `<p>Support ticket ${escapeHtml(project.project_id)} for <strong>${escapeHtml(project.company_name)}</strong> was marked complete.</p>`,
    signoff_signed: `<p><strong>${escapeHtml(project.company_name)}</strong> returned the signed sign-off for ${escapeHtml(project.project_id)}: <a href="${escapeHtml(project.signoff_signed_url)}">view file</a>. The project is now officially closed.</p>`,
    domain_accepted: `<p><strong>${escapeHtml(project.company_name)}</strong> accepted the domain quote for ${escapeHtml(project.project_id)} (total ${fmtMoney(project.domain_quote && project.domain_quote.total)}). Register the domain(s), then add them to the registry in Admin → Domains.</p>`,
    support_signoff_signed: `<p><strong>${escapeHtml(project.company_name)}</strong> signed off support ticket ${escapeHtml(project.project_id)}: <a href="${escapeHtml(project.signoff_signed_url)}">view signed copy</a>. The ticket is completed and now counts as earned.</p>`,
  };

  return sendEmail({
    to: [process.env.ADMIN_EMAIL],
    subject: subjectMap[event],
    html: bodyMap[event],
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Escape first, then turn newlines into <br> so line breaks survive in email
function nl2br(str = '') {
  return escapeHtml(str).replace(/\r?\n/g, '<br>');
}

module.exports = {
  sendEmail,
  sendPortalLinkEmail,
  sendReviewEmail,
  sendRequestReceivedEmail,
  sendClientConfirmationEmail,
  sendAdminNotification,
  sendPricingEmail,
  sendEstimateEmail,
  sendProgressUpdateEmail,
  sendSignoffEmail,
  sendConversionEmail,
  sendSupportSignoffEmail,
  sendFollowupEmail,
  sendReminderDigest,
  sendDomainReceivedEmail,
  sendDomainAdminAlert,
  sendDomainQuoteEmail,
  sendRenewalDigest,
  sendAdminReminderEmail,
  sendDebriefEmail,
  sendClientRenewalReminder,
  sendDomainCompleteEmail,
  sendRenewalEmailToClient,
  sendAdminLoginCode,
  sendSignoffCode,
  sendInvoiceEmail,
  sendReceiptEmail,
  sendSignedOnlineEmails,
  codeBoxes,
  sendConsultReceivedEmail,
  sendConsultAdminDraft,
  sendConsultResponseEmail,
  sendMeetingRequestedAdmin,
  sendMeetingConfirmedEmail,
};
