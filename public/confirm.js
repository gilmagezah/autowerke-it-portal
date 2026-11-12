const token = window.location.pathname.split('/').pop();
const contentEl = document.getElementById('content');

async function load() {
  try {
    const res = await fetch(`/api/confirm/${token}`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Unexpected server response. Please try again shortly.');
    }

    if (!res.ok) {
      contentEl.innerHTML = `<p class="empty-state">${escapeHtml(data.error || 'This link is not valid.')}</p>${data.expired ? '<p><a href="/track">Check your request on the tracking page →</a></p>' : ''}`;
      return;
    }

    renderByStatus(data);
  } catch (err) {
    contentEl.innerHTML = `<p class="empty-state">${escapeHtml(err.message || 'Something went wrong loading this page.')}</p>`;
  }
}

function renderByStatus(data) {
  switch (data.status) {
    case 'reviewed':
      return renderConfirmScope(data);
    case 'client_confirmed':
      return renderWaiting(data);
    case 'pricing_sent':
      return renderPricingDecision(data);
    case 'estimate_sent':
      return renderEstimateDecision(data);
    case 'proceeding':
      return renderContractStage(data);
    case 'in_progress':
      return renderInProgress(data);
    case 'signed':
      return renderSigned(data);
    case 'awaiting_signoff':
      return renderSupportSignoff(data);
    case 'domain_requested':
      return renderSimple(data, 'Checking availability', "We're checking availability and pricing for your domain(s), and will email you a quote shortly.", domainList(data));
    case 'domain_quoted':
      return renderDomainQuote(data);
    case 'domain_accepted':
      return renderSimple(data, 'Thanks - we\'re on it', "You've accepted the quote. We're registering and setting up your domain(s) now, and will confirm once it's done.", domainList(data));
    case 'domain_registered':
      return renderSimple(data, 'Your domains are set up', 'Your domain(s) are registered and managed by us. We\'ll remind you before any renewal is due.', domainList(data));
    case 'consult_requested':
      return renderSimple(data, 'A consultant is on it', "We're reviewing what you shared and will respond by email soon.");
    case 'consult_answered':
    case 'consult_closed':
      return renderSimple(data, 'Response sent', "We've emailed you our response. If you have follow-up questions, just reply to that email.");
    case 'consult_meeting_invited':
      return renderMeetingForm(data);
    case 'consult_meeting_requested':
      return renderMeetingRequested(data);
    case 'consult_meeting_confirmed':
      return renderMeetingConfirmed(data);
    case 'completed':
      return renderCompleted(data);
    case 'delivered':
      // Legacy "delivered" projects behave like signed ones until the client uploads
      return renderSigned(data);
    case 'closed':
      return renderClosed(data);
    case 'declined':
      return renderDeclined(data);
    case 'changes_requested':
      return renderChangesRequested(data);
    default:
      contentEl.innerHTML = `<p class="empty-state">Status: ${escapeHtml(data.status)}</p>`;
  }
}

function renderConfirmScope(data) {
  const requirementsHtml = (data.requirements || [])
    .map((r) => `<li>${escapeHtml(r)}</li>`).join('');

  contentEl.innerHTML = `
    <h1>Confirm your ${data.requestType === 'IT Support' ? 'situation' : 'project scope'}</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p class="preserve-lines">${escapeHtml(data.scopeSummary)}</p>
    <ul>${requirementsHtml}</ul>

    <label>Not quite right? Tell us what to change (optional if confirming)</label>
    <textarea id="changeMsg" rows="3" placeholder="Only fill this in if you're requesting changes"></textarea>

    <div class="confirm-actions">
      <button class="btn-confirm" id="confirmBtn">Yes, this is correct</button>
      <button class="btn-changes" id="changesBtn">Request changes</button>
    </div>
  `;

  document.getElementById('confirmBtn').addEventListener('click', () => submit('confirm'));
  document.getElementById('changesBtn').addEventListener('click', () => {
    const message = document.getElementById('changeMsg')?.value.trim();
    if (!message) return alert('Please describe what needs to change.');
    submit('request_changes', message);
  });
}

function renderWaiting(data) {
  contentEl.innerHTML = `
    <h1>Thanks for confirming!</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>We're preparing your estimate. Check back on this link shortly, or watch your email.</p>
  `;
}

function renderPricingDecision(data) {
  contentEl.innerHTML = `
    <h1>Your project estimate</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p class="preserve-lines">${escapeHtml(data.pricingEstimate)}</p>
    <p>Would you like to proceed with the full project contract?</p>

    <div class="confirm-actions">
      <button class="btn-confirm" id="proceedBtn">Yes, proceed</button>
      <button class="btn-changes" id="declineBtn">No, not right now</button>
    </div>
  `;

  document.getElementById('proceedBtn').addEventListener('click', () => submit('proceed'));
  document.getElementById('declineBtn').addEventListener('click', () => submit('decline'));
}

function renderEstimateDecision(data) {
  // The server works out the totals (same maths as the PDF); fall back to hours x rate
  const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const e = data.estimate || { subtotal: Number(data.estimatedHours) * Number(data.hourlyRate), vatApplies: false };
  const totalLines = e.vatApplies
    ? `<p>Subtotal: <strong>${usd(e.subtotal)}</strong><br>VAT (${escapeHtml(String(e.vatRate))}%): <strong>${usd(e.vat)}</strong></p>
    <p>Estimated total: <strong>${usd(e.total)}</strong> incl. VAT</p>`
    : `<p>Estimated total: <strong>${usd(e.total ?? e.subtotal)}</strong></p>`;

  contentEl.innerHTML = `
    <h1>Your work estimate</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>Estimated hours: <strong>${escapeHtml(String(data.estimatedHours))}</strong></p>
    <p>Rate: <strong>${usd(data.hourlyRate)}/hour</strong></p>
    ${totalLines}

    <div class="estimate-steps">
      <p><strong>To approve and have us start work:</strong></p>
      <ol>
        <li>Download the estimate</li>
        <li>Sign the approval section</li>
        <li>Upload the signed copy below</li>
      </ol>
    </div>

    <p><a href="/api/estimate/${token}" class="btn-confirm" style="display:inline-block;text-decoration:none;text-align:center;padding:12px 20px;border-radius:6px;">Download estimate (PDF)</a></p>

    <label>Upload signed estimate</label>
    <input type="file" id="estimateFile" accept=".pdf,.jpg,.jpeg,.png">
    <div class="confirm-actions">
      <button class="btn-confirm" id="estimateUploadBtn">Upload signed copy &amp; approve</button>
      <button class="btn-changes" id="declineBtn">No, not right now</button>
    </div>
    <p id="estimateUploadStatus"></p>
  `;

  document.getElementById('estimateUploadBtn').addEventListener('click', uploadSignedEstimate);
  document.getElementById('declineBtn').addEventListener('click', () => submit('decline_estimate'));
}

async function uploadSignedEstimate() {
  const fileInput = document.getElementById('estimateFile');
  const statusEl = document.getElementById('estimateUploadStatus');
  if (!fileInput.files.length) {
    statusEl.textContent = 'Please choose your signed estimate first.';
    return;
  }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  statusEl.textContent = 'Uploading...';
  try {
    const res = await fetch(`/api/confirm/${token}/upload-estimate`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    load(); // now shows "work in progress"
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function renderContractStage(data) {
  contentEl.innerHTML = `
    <h1>Almost there</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>Download your contract, sign it, then upload the signed copy below.</p>

    <p><a href="/api/contract/${token}" class="btn-confirm" style="display:inline-block;text-decoration:none;text-align:center;padding:12px 20px;">Download contract (PDF)</a></p>

    <label>Upload signed contract</label>
    <input type="file" id="signedFile" accept=".pdf,.jpg,.jpeg,.png">
    <button class="btn-confirm" id="uploadBtn" style="margin-top:12px;">Upload signed copy</button>
    <p id="uploadStatus"></p>
  `;

  document.getElementById('uploadBtn').addEventListener('click', uploadSignedFile);
}

async function uploadSignedFile() {
  const fileInput = document.getElementById('signedFile');
  const statusEl = document.getElementById('uploadStatus');

  if (!fileInput.files.length) {
    statusEl.textContent = 'Please choose a file first.';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  statusEl.textContent = 'Uploading...';

  try {
    const res = await fetch(`/api/confirm/${token}/upload-signed`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload failed.');

    contentEl.innerHTML = `<h1>All set!</h1><p>We've received your signed contract. We'll be in touch to kick things off.</p>`;
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function renderInProgress(data) {
  contentEl.innerHTML = `
    <h1>Work in progress</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>Here's the time logged on your support ticket so far. This updates as work happens.</p>
    <div id="workTimeline"></div>
  `;

  renderTimeline(document.getElementById('workTimeline'), data.workLog, { editable: false });
}

function renderSigned(data) {
  const titleLine = data.projectTitle ? `<p class="sub" style="margin-top:-8px;">${escapeHtml(data.projectTitle)}</p>` : '';

  if (data.signoffSignedAt) {
    contentEl.innerHTML = `
      <h1>Sign-off received</h1>
      <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>${titleLine}
      <p>Thank you — we've received your signed sign-off document and are wrapping up the project.</p>
    `;
    return;
  }

  if (data.signoffSentAt) {
    contentEl.innerHTML = `
      <h1>Please sign off your project</h1>
      <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>${titleLine}
      <p>All phases are complete. Download the sign-off document, sign the acceptance section, then upload the signed copy below.</p>

      <p><a href="/api/signoff/${token}" class="btn-confirm" style="display:inline-block;text-decoration:none;text-align:center;padding:12px 20px;border-radius:6px;">Download sign-off document (PDF)</a></p>

      <label>Upload signed sign-off</label>
      <input type="file" id="signoffFile" accept=".pdf,.jpg,.jpeg,.png">
      <button class="btn-confirm" id="signoffUploadBtn" style="margin-top:12px;padding:12px 20px;border:none;border-radius:6px;cursor:pointer;">Upload signed copy</button>
      <p id="signoffUploadStatus"></p>
    `;
    document.getElementById('signoffUploadBtn').addEventListener('click', uploadSignoffFile);
    return;
  }

  contentEl.innerHTML = `
    <h1>Project in delivery</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>${titleLine}
    <p>Thanks — your signed contract is on file and work is underway. We'll email you progress updates as each phase is completed.</p>
  `;
}

async function uploadSignoffFile() {
  const fileInput = document.getElementById('signoffFile');
  const statusEl = document.getElementById('signoffUploadStatus');
  if (!fileInput.files.length) {
    statusEl.textContent = 'Please choose a file first.';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  statusEl.textContent = 'Uploading...';

  try {
    const res = await fetch(`/api/confirm/${token}/upload-signoff`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    load(); // re-render with the "received" state
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function billingTable(b) {
  if (!b) return '';
  const row = (k, v, strong) => `<tr${strong ? ' class="bill-total"' : ''}><td>${k}</td><td>${v}</td></tr>`;
  return `
    <table class="bill-table">
      ${row(b.usedEstimate ? 'Hours billed (approved estimate)' : 'Hours logged', `${b.billableHours} h`)}
      ${row('Rate', `${money(b.rate)} / h`)}
      ${row('Subtotal', money(b.subtotal))}
      ${b.vatApplies ? row(`VAT (${b.vatRate}%)`, money(b.vat)) : ''}
      ${row('Total due', money(b.total), true)}
    </table>`;
}

function renderSupportSignoff(data) {
  const titleLine = data.projectTitle ? `<p class="sub" style="margin-top:-8px;">${escapeHtml(data.projectTitle)}</p>` : '';
  contentEl.innerHTML = `
    <h1>Please sign off your support ticket</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>${titleLine}
    <p>The work is complete. Here's the time we logged and the amount due. Download the sign-off, sign the acceptance section, then upload the signed copy below.</p>
    <div id="workTimeline"></div>
    ${billingTable(data.billing)}

    <p><a href="/api/signoff/${token}" class="btn-confirm" style="display:inline-block;text-decoration:none;text-align:center;padding:12px 20px;border-radius:6px;">Download sign-off (PDF)</a></p>

    <label>Upload signed sign-off</label>
    <input type="file" id="signoffFile" accept=".pdf,.jpg,.jpeg,.png">
    <button class="btn-confirm" id="signoffUploadBtn" style="margin-top:12px;padding:12px 20px;border:none;border-radius:6px;cursor:pointer;">Upload signed copy</button>
    <p id="signoffUploadStatus"></p>
  `;
  renderTimeline(document.getElementById('workTimeline'), data.workLog, { editable: false });
  document.getElementById('signoffUploadBtn').addEventListener('click', uploadSignoffFile);
}

function renderCompleted(data) {
  contentEl.innerHTML = `
    ${data.completedAt ? `<div class="closed-badge">Ticket completed — ${escapeHtml(formatClosed(data.completedAt))}</div>` : ''}
    <h1>Support ticket completed</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>${data.signoffSignedAt ? 'Thank you — your signed sign-off has been received. ' : ''}Here's a summary of the time logged on this ticket.</p>
    <div id="workTimeline"></div>
    ${billingTable(data.billing)}
    ${data.signoffSentAt ? `<p><a href="/api/signoff/${token}">Download your sign-off (PDF)</a></p>` : ''}
  `;

  renderTimeline(document.getElementById('workTimeline'), data.workLog, { editable: false });
}

function formatClosed(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function renderClosed(data) {
  const titleLine = data.projectTitle ? `<p class="sub" style="margin-top:-8px;">${escapeHtml(data.projectTitle)}</p>` : '';
  const signoffLink = data.signoffSentAt
    ? `<p><a href="/api/signoff/${token}">Download your sign-off document (PDF)</a></p>`
    : '';
  contentEl.innerHTML = `
    <div class="closed-badge">Project Closed — ${escapeHtml(formatClosed(data.closedAt))}</div>
    <h1>Thank you!</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>${titleLine}
    <p>Your signed sign-off has been received and this project is officially closed. Thanks for working with us!</p>
    ${signoffLink}
  `;
}

function renderDeclined(data) {
  contentEl.innerHTML = `
    <h1>No problem</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>Thanks for considering us. Feel free to reach out anytime if things change.</p>
  `;
}

function renderChangesRequested(data) {
  contentEl.innerHTML = `
    <h1>Changes received</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>We've received your requested changes and will follow up with an updated scope soon.</p>
  `;
}

async function submit(action, message) {
  const res = await fetch(`/api/confirm/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, message }),
  });

  if (res.ok) {
    load(); // re-fetch to show the new status
  } else {
    alert('Something went wrong. Please try again.');
  }
}

function escapeHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

load();


// ================= Domains + Consultancy =================

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const money2 = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDayStr = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]} ${dd} ${MON[m - 1]} ${y}`; };
const isWeekend = (d) => { const [y, m, dd] = d.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); return w === 0 || w === 6; };

function domainList(data) {
  return (data.domains || []).length
    ? `<div class="meet-summary">${data.domains.map((d) => escapeHtml(d)).join('<br>')}</div>`
    : '';
}

function renderSimple(data, title, text, extra = '') {
  contentEl.innerHTML = `
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}${data.projectTitle ? ` · ${escapeHtml(data.projectTitle)}` : ''}</p>
    <p>${escapeHtml(text)}</p>
    ${extra}`;
}

async function postAction(body) {
  const res = await fetch(`/api/confirm/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function renderDomainQuote(data) {
  const q = data.domainQuote || { lines: [] };
  const lines = q.lines.map((l) => l.available
    ? `<tr><td class="q-domain">${escapeHtml(l.domain)}${l.years > 1 ? ` <span class="sub">(${l.years} years)</span>` : ''}</td><td>${money2(l.price * l.years)}</td></tr>`
    : `<tr><td class="q-domain q-off">${escapeHtml(l.domain)}</td><td>Unavailable</td></tr>`).join('');
  contentEl.innerHTML = `
    <h1>Your domain quote</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <table class="quote-table">
      ${lines}
      <tr><td>Service fee</td><td>${money2(q.service_fee)}</td></tr>
      <tr><td>Subtotal</td><td>${money2(q.subtotal)}</td></tr>
      ${q.vat_applicable ? `<tr><td>VAT (${q.vat_rate}%)</td><td>${money2(q.vat)}</td></tr>` : ''}
      <tr class="q-total"><td>Total</td><td>${money2(q.total)}</td></tr>
    </table>
    ${q.note ? `<p class="preserve-lines">${escapeHtml(q.note)}</p>` : ''}
    <p>Domain availability can change quickly, so we recommend confirming soon.</p>
    <div class="confirm-actions">
      <button class="btn-confirm" id="acceptQuote">Yes, proceed</button>
      <button class="btn-changes" id="declineQuote">No, not right now</button>
    </div>
    <p id="quoteStatus"></p>`;
  const run = async (action, btn) => {
    btn.disabled = true;
    try { await postAction({ action }); load(); } catch (e) { document.getElementById('quoteStatus').textContent = e.message; btn.disabled = false; }
  };
  document.getElementById('acceptQuote').addEventListener('click', (e) => run('accept_domain_quote', e.target));
  document.getElementById('declineQuote').addEventListener('click', (e) => {
    if (confirm('Decline this quote?')) run('decline_domain_quote', e.target);
  });
}

function timeZoneOptions(selected) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browsers */ }
  if (!zones.length) zones = ['Africa/Harare', 'Africa/Johannesburg', 'Africa/Lusaka', 'Africa/Nairobi', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Dubai', 'UTC'];
  if (!zones.includes(selected)) zones.unshift(selected);
  return zones.map((z) => `<option value="${escapeHtml(z)}" ${z === selected ? 'selected' : ''}>${escapeHtml(z.replace(/_/g, ' '))}</option>`).join('');
}

function slotRowHtml(slot = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="slot-row">
      <label>Day<input type="date" class="slot-date" min="${today}" value="${escapeHtml(slot.date || '')}"></label>
      <label>Free from<input type="time" class="slot-from" value="${escapeHtml(slot.from || '09:00')}"></label>
      <label>Until<input type="time" class="slot-to" value="${escapeHtml(slot.to || '12:00')}"></label>
      <button type="button" class="slot-remove" title="Remove">✕</button>
    </div>`;
}

function renderMeetingForm(data, prev) {
  const p = prev || {};
  const tz = p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Harare';
  const type = p.type || 'online';
  contentEl.innerHTML = `
    <h1>Set up your discovery meeting</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}${data.projectTitle ? ` · ${escapeHtml(data.projectTitle)}` : ''}</p>
    <p>Tell us how you'd like to meet and when you're free. We'll confirm a time and send a calendar invite.</p>

    <div class="form-title">How would you like to meet?</div>
    <div class="meet-option">
      <label class="radio"><input type="radio" name="mtype" value="online" ${type === 'online' ? 'checked' : ''}> Online meeting</label>
      <label class="radio"><input type="radio" name="mtype" value="call" ${type === 'call' ? 'checked' : ''}> General discovery call (phone)</label>
    </div>

    <div id="onlineFields">
      <div class="form-title">Platform</div>
      <div class="meet-option">
        <label class="radio"><input type="radio" name="platform" value="teams" ${p.platform !== 'zoom' ? 'checked' : ''}> Microsoft Teams</label>
        <label class="radio"><input type="radio" name="platform" value="zoom" ${p.platform === 'zoom' ? 'checked' : ''}> Zoom</label>
      </div>
      <label>Invite colleagues too (optional)
        <input type="text" id="recipients" placeholder="name@company.com, another@company.com" value="${escapeHtml((p.recipients || []).join(', '))}">
      </label>
    </div>
    <div id="callFields">
      <label>Number we should call<input type="tel" id="callPhone" placeholder="+263 ..." value="${escapeHtml(p.phone || '')}"></label>
    </div>

    <div class="form-title">When are you free? (Monday to Friday)</div>
    <label>Your timezone<select id="tz">${timeZoneOptions(tz)}</select></label>
    <div id="slots">${(p.slots && p.slots.length ? p.slots : [{}]).map(slotRowHtml).join('')}</div>
    <button type="button" class="link-btn" id="addSlot">+ Add another option</button>
    <p class="meet-hint" id="slotHint">Suggest one or more weekday windows. We'll pick a time inside one of them.</p>

    <label>Anything we should know before the meeting? (optional)<textarea id="mnote" rows="3">${escapeHtml(p.note || '')}</textarea></label>

    <button class="btn-confirm" id="sendPrefs">Send my preferences</button>
    <p id="prefsStatus"></p>`;

  const callPhone = window.PhoneInput ? PhoneInput(document.getElementById('callPhone')) : null;
  const sync = () => {
    const isOnline = document.querySelector('input[name=mtype]:checked').value === 'online';
    document.getElementById('onlineFields').style.display = isOnline ? '' : 'none';
    document.getElementById('callFields').style.display = isOnline ? 'none' : '';
  };
  document.querySelectorAll('input[name=mtype]').forEach((r) => r.addEventListener('change', sync));
  sync();

  const slotsEl = document.getElementById('slots');
  slotsEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('slot-remove')) return;
    if (slotsEl.querySelectorAll('.slot-row').length > 1) e.target.closest('.slot-row').remove();
  });
  slotsEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('slot-date') && e.target.value && isWeekend(e.target.value)) {
      document.getElementById('slotHint').textContent = `${fmtDayStr(e.target.value)} is a weekend - please pick a weekday (Monday to Friday).`;
      e.target.value = '';
    }
  });
  document.getElementById('addSlot').addEventListener('click', () => {
    if (slotsEl.querySelectorAll('.slot-row').length >= 5) return;
    slotsEl.insertAdjacentHTML('beforeend', slotRowHtml());
  });

  document.getElementById('sendPrefs').addEventListener('click', async (e) => {
    const statusEl = document.getElementById('prefsStatus');
    const prefs = {
      type: document.querySelector('input[name=mtype]:checked').value,
      platform: (document.querySelector('input[name=platform]:checked') || {}).value,
      recipients: document.getElementById('recipients').value,
      phone: callPhone ? callPhone.value() : document.getElementById('callPhone').value,
      timezone: document.getElementById('tz').value,
      note: document.getElementById('mnote').value,
      slots: [...slotsEl.querySelectorAll('.slot-row')].map((r) => ({
        date: r.querySelector('.slot-date').value, from: r.querySelector('.slot-from').value, to: r.querySelector('.slot-to').value,
      })).filter((x) => x.date),
    };
    e.target.disabled = true;
    statusEl.textContent = 'Sending...';
    try { await postAction({ action: 'meeting_prefs', prefs }); load(); } catch (err) { statusEl.textContent = err.message; e.target.disabled = false; }
  });
}

function prefsSummary(m) {
  const how = m.type === 'online'
    ? `${m.platform === 'zoom' ? 'Zoom' : 'Microsoft Teams'} meeting${m.recipients && m.recipients.length ? `<br>Also inviting: ${m.recipients.map(escapeHtml).join(', ')}` : ''}`
    : `Discovery call to ${escapeHtml(m.phone || '')}`;
  const slots = (m.slots || []).map((x) => `${escapeHtml(fmtDayStr(x.date))}, ${escapeHtml(x.from)}–${escapeHtml(x.to)}`).join('<br>');
  return `<div class="meet-summary">${how}<br><br>${slots}<br><span class="sub">${escapeHtml(m.timezone || '')}</span></div>`;
}

function renderMeetingRequested(data) {
  contentEl.innerHTML = `
    <h1>Thanks - we'll confirm a time</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <p>Here's what you sent us. We'll pick a time and email you a calendar invite.</p>
    ${prefsSummary(data.consultMeeting || {})}
    <button class="btn-changes" id="changePrefs">Change my preferences</button>`;
  document.getElementById('changePrefs').addEventListener('click', () => renderMeetingForm(data, data.consultMeeting));
}

function renderMeetingConfirmed(data) {
  const c = data.consultConfirmed || {};
  const where = c.type === 'online'
    ? `<p><a href="${escapeHtml(c.link || '#')}" class="btn-confirm" style="display:inline-block;text-decoration:none;">Join on ${c.platform === 'zoom' ? 'Zoom' : 'Teams'}</a></p>`
    : `<p>We'll call you on <strong>${escapeHtml(c.phone || '')}</strong>.</p>`;
  contentEl.innerHTML = `
    <div class="closed-badge">Confirmed</div>
    <h1>Your discovery ${c.type === 'online' ? 'meeting' : 'call'}</h1>
    <p class="sub">Reference: ${escapeHtml(data.projectId)}</p>
    <div class="meet-summary"><strong>${escapeHtml(c.date ? fmtDayStr(c.date) : '')}</strong><br>${escapeHtml(c.start || '')}–${escapeHtml(c.end || '')} (${escapeHtml(c.timezone || '')})</div>
    ${where}
    <p>The calendar invite is in your email. Need a different time? Just reply to that email.</p>`;
}
