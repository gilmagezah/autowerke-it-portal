const appEl = document.getElementById('app');
let state = { requests: [], registry: [], credentialsConfigured: false, vatRate: 15.5 };
let clientFilter = '';
let search = '';
let editing = null;      // registry record being edited (or {} for new)
let prefill = null;      // prefill for a new record (from an accepted request)
let quoteOpen = {};      // request id -> quote editor open

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function load() {
  try {
    state = await api('/api/admin/domains');
    render();
  } catch (err) {
    appEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

// ---------- Render ----------

function render() {
  const open = state.requests.filter((r) => ['domain_requested', 'domain_quoted', 'domain_accepted'].includes(r.status));
  const soon = state.registry.filter((r) => r.days_left !== null && r.days_left <= 30);
  if (window.setBandStats) {
    window.setBandStats([
      { label: 'Open requests', value: String(open.length), sub: `${open.filter((r) => r.status === 'domain_requested').length} need a quote` },
      { label: 'Managed domains', value: String(state.registry.length), sub: ((n) => `${n} client${n === 1 ? '' : 's'}`)(new Set(state.registry.map((r) => r.client_company.toLowerCase())).size) },
      { label: 'Renewing ≤ 30 days', value: String(soon.length) },
    ]);
  }
  if (window.setNavCount) window.setNavCount('domains', open.filter((r) => r.status !== 'domain_quoted').length);

  appEl.innerHTML = `
    <div class="svc-section"><h2>Requests</h2><span class="count">${open.length} open</span></div>
    ${open.length ? open.map(requestCard).join('') : '<p class="empty-state">No open domain requests.</p>'}

    <div class="svc-section"><h2>Managed domains registry</h2><span class="count">${state.registry.length} domain${state.registry.length === 1 ? '' : 's'}</span></div>
    ${state.credentialsConfigured ? '' : `<div class="warn-box"><strong>Password storage is off.</strong> To store registrar passwords (encrypted), add <code>CREDENTIALS_KEY</code> to your <code>.env</code> and restart. See BUILD-LOG section 18. Until then, use the vault reference field.</div>`}
    <div class="reg-toolbar">
      <label class="fu-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
        <input type="search" id="regSearch" placeholder="Search domain, registrar, client" value="${attr(search)}"></label>
      <select id="clientFilter"><option value="">All clients</option>${clientNames().map((c) => `<option ${c === clientFilter ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button type="button" class="btn-outline" id="addReg">+ Add domain</button>
    </div>
    <div id="regEditor">${editing ? registryForm(editing) : ''}</div>
    ${registryHtml()}
  `;
  wire();
}

function clientNames() {
  return [...new Map(state.registry.map((r) => [r.client_company.toLowerCase(), r.client_company])).values()].sort((a, b) => a.localeCompare(b));
}

function requestCard(r) {
  const who = [r.name, r.surname].filter(Boolean).join(' ');
  const urgent = r.status === 'domain_requested';
  const pill = { domain_requested: '<span class="svc-pill red">Urgent · needs quote</span>', domain_quoted: '<span class="svc-pill amber">Quote sent · waiting</span>', domain_accepted: '<span class="svc-pill solid">Accepted · register now</span>' }[r.status];
  const q = r.domain_quote;
  let body = '';

  if (r.status === 'domain_accepted') {
    const inRegistry = new Set(state.registry.filter((x) => x.request_id === r.id).map((x) => x.domain));
    const billable = (q ? q.lines.filter((l) => l.available).map((l) => l.domain) : r.domains) || [];
    body = `
      <div class="svc-label">Register these, then add each to the registry</div>
      <div class="svc-actions" style="margin-top:4px;">
        ${billable.map((d) => inRegistry.has(d)
          ? `<span class="svc-pill">✓ ${esc(d)}</span>`
          : `<button type="button" class="btn-outline" data-act="to-registry" data-id="${attr(r.id)}" data-domain="${attr(d)}">+ ${esc(d)}</button>`).join('')}
      </div>
      <div class="svc-actions">
        <button type="button" class="btn-primary" data-act="registered" data-id="${attr(r.id)}" ${billable.every((d) => inRegistry.has(d)) ? '' : 'disabled title="Add every domain to the registry first"'}>Mark request complete</button>
        <span class="svc-hint">Quote total ${money(q && q.total)}</span>
      </div>`;
  } else if (r.status === 'domain_quoted' && !quoteOpen[r.id]) {
    body = `${quoteSummary(q)}
      <div class="svc-actions"><button type="button" class="btn-outline" data-act="edit-quote" data-id="${attr(r.id)}">Edit & resend quote</button>
      <span class="svc-hint">Waiting for the client to accept in their portal.</span></div>`;
  } else {
    body = quoteEditor(r);
  }

  return `
    <div class="svc-card ${urgent ? 'urgent' : ''}" data-req="${attr(r.id)}">
      <div class="svc-head">
        <div>
          <div class="svc-title">${esc(r.company_name)}</div>
          <div class="svc-meta">${esc(r.project_id)} · ${esc(who)} · ${esc(r.email)}${r.phone ? ` · ${esc(r.phone)}` : ''}</div>
          <div class="svc-meta">${r.domain_service === 'manage' ? 'Manage existing domain(s)' : 'Register new domain(s)'} · received ${esc(shortDate(r.created_at))}</div>
        </div>
        ${pill}
      </div>
      ${r.status === 'domain_requested' ? `<div class="svc-box svc-domains">${(r.domains || []).map(esc).join('<br>')}</div>` : ''}
      ${r.details ? `<div class="svc-box preserve-lines">${esc(r.details)}</div>` : ''}
      ${body}
    </div>`;
}

function quoteEditor(r) {
  const q = r.domain_quote || {};
  const prev = Object.fromEntries((q.lines || []).map((l) => [l.domain, l]));
  const rows = (r.domains || []).map((d) => {
    const l = prev[d] || {};
    return `<tr data-domain="${attr(d)}">
      <td class="q-dom">${esc(d)}</td>
      <td><label class="fu-toggle" style="padding:0;"><input type="checkbox" class="q-avail" ${l.available === false ? '' : 'checked'}> Available</label></td>
      <td><select class="q-years">${[1, 2, 3, 5, 10].map((y) => `<option ${Number(l.years || 1) === y ? 'selected' : ''}>${y}</option>`).join('')}</select></td>
      <td><input type="number" step="0.01" min="0" class="q-price" placeholder="per year" value="${attr(l.price ?? '')}"></td>
    </tr>`;
  }).join('');
  return `
    <div class="svc-label">Quote</div>
    <table class="q-grid"><thead><tr><th>Domain</th><th>Availability</th><th>Years</th><th>Price / year ($)</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="q-row-inline">
      <label class="fu-field">Service fee ($)<input type="number" step="0.01" min="0" class="q-fee" value="${attr(q.service_fee ?? '')}"></label>
      <label class="fu-toggle"><input type="checkbox" class="q-vat" ${q.vat_applicable === false ? '' : 'checked'}> Charge VAT (${state.vatRate}%)</label>
    </div>
    <label class="fu-field" style="margin-top:10px;">Note to client (optional)<textarea class="q-note" rows="2" placeholder="e.g. .com is taken - we've quoted .co.zw and .africa instead.">${esc(q.note || '')}</textarea></label>
    <div class="q-totals" data-totals></div>
    <div class="svc-actions"><button type="button" class="btn-primary" data-act="send-quote" data-id="${attr(r.id)}">${r.status === 'domain_quoted' ? 'Resend quote' : 'Send quote to client'}</button>
      <span class="svc-hint">Totals are recalculated on the server before sending.</span></div>`;
}

function readQuote(card) {
  return {
    lines: [...card.querySelectorAll('.q-grid tbody tr')].map((tr) => ({
      domain: tr.dataset.domain,
      available: tr.querySelector('.q-avail').checked,
      years: Number(tr.querySelector('.q-years').value),
      price: tr.querySelector('.q-price').value,
    })),
    service_fee: card.querySelector('.q-fee').value,
    vat_applicable: card.querySelector('.q-vat').checked,
    note: card.querySelector('.q-note').value,
  };
}

// Live preview only - the server recomputes everything
function updateTotals(card) {
  const el = card.querySelector('[data-totals]');
  if (!el) return;
  const q = readQuote(card);
  const domains = q.lines.filter((l) => l.available).reduce((s, l) => s + (Number(l.price) || 0) * l.years, 0);
  const sub = domains + (Number(q.service_fee) || 0);
  const vat = q.vat_applicable ? Math.round(sub * state.vatRate) / 100 : 0;
  el.innerHTML = `<div><span>Domains</span><span>${money(domains)}</span></div><div><span>Service fee</span><span>${money(Number(q.service_fee) || 0)}</span></div>
    ${q.vat_applicable ? `<div><span>VAT ${state.vatRate}%</span><span>${money(vat)}</span></div>` : ''}<div class="t"><span>Total</span><span>${money(sub + vat)}</span></div>`;
}

function quoteSummary(q) {
  if (!q) return '';
  return `<div class="svc-box" style="font-family:var(--mono);font-size:13px;">
    ${q.lines.map((l) => `${esc(l.domain)}${l.available ? ` · ${l.years}y · ${money(l.price * l.years)}` : ' · unavailable'}`).join('<br>')}
    <br>Service fee ${money(q.service_fee)}${q.vat_applicable ? ` · VAT ${money(q.vat)}` : ''} · <strong>Total ${money(q.total)}</strong></div>`;
}

function registryHtml() {
  const q = search.trim().toLowerCase();
  const rows = state.registry
    .filter((r) => !clientFilter || r.client_company.toLowerCase() === clientFilter.toLowerCase())
    .filter((r) => !q || [r.domain, r.registrar_name, r.client_company, r.notes].join(' ').toLowerCase().includes(q));
  if (!rows.length) return `<p class="empty-state">${state.registry.length ? 'Nothing matches.' : 'No managed domains yet. They appear here once you add them.'}</p>`;

  const groups = {};
  rows.forEach((r) => { (groups[r.client_company] = groups[r.client_company] || []).push(r); });
  return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map((client) => `
    <div class="reg-group">
      <div class="reg-group-head"><strong>${esc(client)}</strong><span>${groups[client].length} domain${groups[client].length === 1 ? '' : 's'}</span></div>
      <div class="reg-table">
        <div class="reg-row head"><span>Domain</span><span>Registrar</span><span>Renews</span><span>Renewal</span><span>Reminders</span><span></span></div>
        ${groups[client].map(regRow).join('')}
      </div>
    </div>`).join('');
}

function regRow(r) {
  let flag = '';
  if (r.days_left !== null) {
    if (r.days_left < 0) flag = `<div class="reg-flag red">Expired ${-r.days_left}d ago</div>`;
    else if (r.days_left <= r.admin_reminder_days) flag = `<div class="reg-flag red">In ${r.days_left} day${r.days_left === 1 ? '' : 's'}</div>`;
    else if (r.days_left <= 30) flag = `<div class="reg-flag amber">In ${r.days_left} days</div>`;
    else flag = `<div class="reg-flag muted">In ${r.days_left} days</div>`;
  }
  const creds = r.has_password ? 'password stored' : r.vault_reference ? 'in vault' : 'no password';
  return `
    <div class="reg-row" data-reg="${attr(r.id)}">
      <div><div class="reg-domain">${esc(r.domain)}</div>${r.notes ? `<div class="reg-sub">${esc(r.notes)}</div>` : ''}</div>
      <div class="reg-cell">${esc(r.registrar_name || '—')}<div class="reg-sub">${esc(r.account_username || '')}${r.account_username ? ' · ' : ''}${creds}</div></div>
      <div class="reg-cell">${r.renewal_date ? esc(fmtDate(r.renewal_date)) : '—'}${flag}</div>
      <div class="reg-cell">${r.renewal_quote && r.renewal_quote.hasPrice
        ? `${money(r.renewal_quote.total)}<div class="reg-sub">${money(r.renewal_quote.price)} × ${r.renewal_quote.years}y${r.renewal_quote.fee ? ` + ${money(r.renewal_quote.fee)} fee` : ''}${r.renewal_quote.vatApplicable ? ' + VAT' : ''}</div>`
        : '—'}
        ${r.renewal_email_ready ? '<div class="reg-flag ready">Email ready</div>' : r.renewal_email_sent ? '<div class="reg-flag muted">Email sent</div>' : ''}</div>
      <div class="reg-cell">You: ${r.admin_reminder_days}d before<div class="reg-sub">Client: ${r.client_reminder_enabled ? `${r.client_reminder_days}d before` : 'off'}</div></div>
      <div class="fu-actions">
        ${r.registrar_url ? `<button type="button" data-act="open" data-url="${attr(r.registrar_url)}">Open ↗</button>` : ''}
        ${r.has_password || r.account_username ? '<button type="button" data-act="reveal">Login</button>' : ''}
        ${r.renewal_date && r.client_email ? `<button type="button" data-act="renewal-email" class="${r.renewal_email_ready ? 'primary' : ''}">Renewal email</button>` : ''}
        ${r.renewal_date ? '<button type="button" data-act="renewed" title="Move the renewal date on one year">Renewed</button>' : ''}
        <button type="button" data-act="edit">Edit</button>
        <button type="button" data-act="delete" title="Delete">✕</button>
      </div>
    </div>`;
}

function registryForm(r) {
  const v = { admin_reminder_days: 7, client_reminder_days: 7, client_reminder_enabled: true, ...(prefill || {}), ...r };
  const isNew = !r.id;
  return `
    <form class="fu-editor" id="regForm" novalidate>
      <h2>${isNew ? 'Add a managed domain' : `Edit · ${esc(r.domain)}`}</h2>
      <datalist id="clientList">${clientNames().map((c) => `<option value="${attr(c)}">`).join('')}</datalist>
      <div class="fu-grid">
        <label class="fu-field">Client (larger company)<input name="client_company" list="clientList" value="${attr(v.client_company || '')}" required></label>
        <label class="fu-field">Client email (renewal reminders)<input type="email" name="client_email" value="${attr(v.client_email || '')}"></label>
        <label class="fu-field">Domain<input name="domain" value="${attr(v.domain || '')}" required spellcheck="false"></label>
        <label class="fu-field">Bought / managed at<input name="registrar_name" value="${attr(v.registrar_name || '')}" placeholder="e.g. Porkbun"></label>
        <label class="fu-field two">Login link<input name="registrar_url" value="${attr(v.registrar_url || '')}" placeholder="https://porkbun.com/account/login"></label>
        <label class="fu-field">Username / email<input name="account_username" value="${attr(v.account_username || '')}" autocomplete="off"></label>
        <label class="fu-field">Password ${r.has_password ? '(stored - leave blank to keep)' : ''}
          <input type="password" name="password" autocomplete="new-password" ${state.credentialsConfigured ? '' : 'disabled placeholder="Set CREDENTIALS_KEY to enable"'}></label>
        <label class="fu-field">Or vault reference<input name="vault_reference" value="${attr(v.vault_reference || '')}" placeholder="e.g. Bitwarden: Clients/Tanner/Porkbun"></label>
        <label class="fu-field">Renewal date<input type="date" name="renewal_date" value="${attr(v.renewal_date || '')}"></label>
        <label class="fu-field">Remind me (days before)<input type="number" min="0" max="365" name="admin_reminder_days" value="${attr(v.admin_reminder_days)}"></label>
        <label class="fu-field">&nbsp;<span></span></label>
      </div>
      <div class="renew-box">
        <div class="renew-title">Renewal pricing <span>used for the ready-to-send renewal email</span></div>
        <div class="fu-grid">
          <label class="fu-field">Domain price per year ($)<input type="number" step="0.01" min="0" name="renewal_price" value="${attr(v.renewal_price ?? '')}"></label>
          <label class="fu-field">Renewal period
            <select name="renewal_years">${[1, 2, 3, 5, 10].map((y) => `<option value="${y}" ${Number(v.renewal_years || 1) === y ? 'selected' : ''}>${y} year${y === 1 ? '' : 's'}</option>`).join('')}</select></label>
          <label class="fu-field">Service fee ($)<input type="number" step="0.01" min="0" name="renewal_service_fee" value="${attr(v.renewal_service_fee ?? '')}"></label>
        </div>
        <div class="renew-row">
          <label class="fu-toggle"><input type="checkbox" name="renewal_vat_applicable" ${v.renewal_vat_applicable === false ? '' : 'checked'}> Charge VAT (${state.vatRate}%)</label>
          <div class="renew-total" id="renewTotal"></div>
        </div>
      </div>
      <div class="fu-grid">
        <label class="fu-field wide">Notes (internal)<input name="notes" value="${attr(v.notes || '')}"></label>
      </div>
      <div class="fu-reminder">
        <div class="fu-reminder-row">
          <label class="fu-toggle"><input type="checkbox" name="client_reminder_enabled" ${v.client_reminder_enabled ? 'checked' : ''}> Also remind the client</label>
          <label class="fu-field">Days before<input type="number" min="0" max="365" name="client_reminder_days" value="${attr(v.client_reminder_days)}"></label>
          ${r.has_password ? '<label class="fu-toggle"><input type="checkbox" name="clear_password"> Remove stored password</label>' : ''}
        </div>
        <div class="fu-hint">Renewal reminders go out from 08:00 your time, once per renewal date. Passwords are encrypted and only shown when you click Login.</div>
      </div>
      <div class="fu-editor-actions">
        <button type="submit" class="btn-primary">${isNew ? 'Add to registry' : 'Save changes'}</button>
        <button type="button" class="link-btn" id="regCancel">Cancel</button>
      </div>
    </form>`;
}

// ---------- Events ----------

function wire() {
  document.getElementById('regSearch').addEventListener('input', (e) => { search = e.target.value; rerenderRegistry(); });
  document.getElementById('clientFilter').addEventListener('change', (e) => { clientFilter = e.target.value; render(); });
  document.getElementById('addReg').addEventListener('click', () => { prefill = null; editing = {}; render(); focusForm(); });

  appEl.querySelectorAll('.svc-card').forEach((card) => {
    card.addEventListener('input', () => updateTotals(card));
    card.addEventListener('change', () => updateTotals(card));
    updateTotals(card);
  });

  const form = document.getElementById('regForm');
  if (form) {
    const updateRenewTotal = () => {
      const q = renewalQuote({
        renewal_price: form.renewal_price.value, renewal_years: form.renewal_years.value,
        renewal_service_fee: form.renewal_service_fee.value, renewal_vat_applicable: form.renewal_vat_applicable.checked,
      });
      document.getElementById('renewTotal').innerHTML = q.price
        ? `${money(q.price)} × ${q.years}y = ${money(q.domainCost)}${q.fee ? ` + fee ${money(q.fee)}` : ''}${q.vat ? ` + VAT ${money(q.vat)}` : ''} = <strong>${money(q.total)}</strong>`
        : '<span class="svc-hint">Enter the domain price to see the renewal total.</span>';
    };
    form.addEventListener('input', updateRenewTotal);
    form.addEventListener('change', updateRenewTotal);
    updateRenewTotal();
    form.addEventListener('submit', (e) => { e.preventDefault(); saveRegistry(form); });
    document.getElementById('regCancel').addEventListener('click', () => { editing = null; prefill = null; render(); });
  }
}

function rerenderRegistry() {
  // Re-render just the registry list while typing in search (keeps focus)
  const groups = appEl.querySelectorAll('.reg-group, .reg-empty');
  groups.forEach((g) => g.remove());
  const after = document.getElementById('regEditor');
  const empties = [...appEl.querySelectorAll(':scope > p.empty-state')].filter((p) => p.previousElementSibling === after);
  empties.forEach((p) => p.remove());
  after.insertAdjacentHTML('afterend', registryHtml());
}

function focusForm() {
  const f = document.getElementById('regForm');
  if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); (f.domain.value ? f.account_username : f.client_company).focus(); }
}

appEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  try {
    if (act === 'send-quote') {
      const card = btn.closest('.svc-card');
      const r = state.requests.find((x) => x.id === btn.dataset.id);
      if (!confirm(`Send this quote to ${r.email}?`)) return;
      btn.disabled = true;
      await api(`/api/admin/domains/requests/${r.id}/quote`, { method: 'POST', body: JSON.stringify({ quote: readQuote(card) }) });
      delete quoteOpen[r.id];
      return load();
    }
    if (act === 'edit-quote') { quoteOpen[btn.dataset.id] = true; return render(); }
    if (act === 'to-registry') {
      const r = state.requests.find((x) => x.id === btn.dataset.id);
      const line = (r.domain_quote && r.domain_quote.lines || []).find((l) => l.domain === btn.dataset.domain) || {};
      prefill = { client_company: r.company_name, client_email: r.email, domain: btn.dataset.domain, request_id: r.id, renewal_price: line.price ?? '' };
      editing = {};
      render();
      return focusForm();
    }
    if (act === 'registered') {
      await api(`/api/admin/domains/requests/${btn.dataset.id}/registered`, { method: 'POST' });
      return load();
    }

    const row = btn.closest('.reg-row');
    const rec = row && state.registry.find((x) => x.id === row.dataset.reg);
    if (act === 'open') return window.open(btn.dataset.url, '_blank', 'noopener');
    if (act === 'edit') { prefill = null; editing = rec; render(); return focusForm(); }
    if (act === 'delete') {
      if (!confirm(`Remove ${rec.domain} from the registry? Its stored login details are deleted too.`)) return;
      await api(`/api/admin/domains/registry/${rec.id}`, { method: 'DELETE' });
      return load();
    }
    if (act === 'renewed') {
      if (!confirm(`Mark ${rec.domain} as renewed? The renewal date moves on one year.`)) return;
      await api(`/api/admin/domains/registry/${rec.id}/renewed`, { method: 'POST' });
      return load();
    }
    if (act === 'reveal') return revealCreds(row, rec);
    if (act === 'renewal-email') return openRenewalEmail(rec);
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

async function revealCreds(row, rec) {
  const existing = row.querySelector('.creds');
  if (existing) { existing.remove(); return; }
  const data = await api(`/api/admin/domains/registry/${rec.id}/reveal`, { method: 'POST' });
  const box = document.createElement('div');
  box.className = 'creds';
  box.innerHTML = `
    <span>User: <code>${esc(data.username || '—')}</code></span>
    <span>Password: ${data.password ? `<code class="pw" data-pw="${attr(data.password)}">••••••••</code> <button type="button" class="link-btn pw-show">Show</button> <button type="button" class="link-btn pw-copy">Copy</button>` : (rec.vault_reference ? `in vault: <code>${esc(rec.vault_reference)}</code>` : 'not stored')}</span>
    <span class="svc-hint">Hides automatically in 30 seconds</span>`;
  row.appendChild(box);
  const pw = box.querySelector('.pw');
  box.querySelector('.pw-show')?.addEventListener('click', (e) => {
    const shown = pw.textContent !== '••••••••';
    pw.textContent = shown ? '••••••••' : pw.dataset.pw;
    e.target.textContent = shown ? 'Show' : 'Hide';
  });
  box.querySelector('.pw-copy')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(pw.dataset.pw); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
  });
  setTimeout(() => box.remove(), 30000);
}

async function saveRegistry(form) {
  const f = (n) => (form[n] ? form[n].value : '');
  const payload = {
    client_company: f('client_company'), client_email: f('client_email'), domain: f('domain'),
    registrar_name: f('registrar_name'), registrar_url: f('registrar_url'), account_username: f('account_username'),
    vault_reference: f('vault_reference'), renewal_date: f('renewal_date'), renewal_price: f('renewal_price'),
    admin_reminder_days: f('admin_reminder_days'), client_reminder_days: f('client_reminder_days'),
    client_reminder_enabled: form.client_reminder_enabled.checked, notes: f('notes'),
    renewal_years: f('renewal_years'), renewal_service_fee: f('renewal_service_fee'),
    renewal_vat_applicable: form.renewal_vat_applicable.checked,
    request_id: (prefill && prefill.request_id) || null,
  };
  if (form.password && form.password.value) payload.password = form.password.value;
  if (form.clear_password && form.clear_password.checked) payload.clear_password = true;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api(editing.id ? `/api/admin/domains/registry/${editing.id}` : '/api/admin/domains/registry', {
      method: editing.id ? 'PATCH' : 'POST', body: JSON.stringify(payload),
    });
    form.password && (form.password.value = ''); // don't leave it in the page
    editing = null;
    prefill = null;
    load();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
}

// ---------- Renewal email composer ----------

async function openRenewalEmail(rec) {
  const data = await api(`/api/admin/domains/registry/${rec.id}/renewal-email`);
  let modal = document.getElementById('renewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'renewModal';
    modal.className = 'fu-modal';
    document.body.appendChild(modal);
  }
  const q = data.quote;
  modal.innerHTML = `
    <div class="fu-dialog" role="dialog" aria-modal="true">
      <div class="fu-dialog-head">
        <h2>Renewal · ${esc(rec.domain)}</h2>
        <div>${esc(rec.client_company)} · renews ${esc(fmtDate(rec.renewal_date))} · total ${money(q.total)}${data.sentAt ? ` · sent ${esc(shortDate(data.sentAt))}` : data.saved ? ' · draft saved' : ''}</div>
      </div>
      <div class="fu-dialog-body">
        <label class="fu-field">To<input value="${attr(data.to || '')}" disabled></label>
        <label class="fu-field">Subject<input id="rnSubject" value="${attr(data.subject)}"></label>
        <label class="fu-field">Message<textarea id="rnBody" rows="15">${esc(data.body)}</textarea></label>
        <div class="fu-hint">${data.saved ? 'This is your saved draft.' : 'Written from the current renewal pricing.'} Changed the pricing since? Use <strong>Rebuild from pricing</strong>.</div>
      </div>
      <div class="fu-dialog-foot">
        <button type="button" class="link-btn" id="rnRebuild" style="margin-right:auto;">Rebuild from pricing</button>
        <button type="button" class="link-btn" id="rnClose">Close</button>
        <button type="button" class="btn-outline" id="rnSave">Save draft</button>
        <button type="button" class="btn-primary" id="rnSend">${data.sentAt ? 'Send again' : 'Send to client'}</button>
      </div>
    </div>`;
  modal.classList.remove('hidden');
  const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
  const read = () => ({ subject: document.getElementById('rnSubject').value, body: document.getElementById('rnBody').value });

  document.getElementById('rnClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); }, { once: true });
  document.getElementById('rnRebuild').addEventListener('click', () => {
    if (!confirm('Replace the message with a fresh one built from the current renewal pricing?')) return;
    const fresh = defaultRenewalText(rec);
    document.getElementById('rnSubject').value = fresh.subject;
    document.getElementById('rnBody').value = fresh.body;
  });
  document.getElementById('rnSave').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api(`/api/admin/domains/registry/${rec.id}/renewal-email`, { method: 'PUT', body: JSON.stringify(read()) }); e.target.textContent = 'Saved ✓'; load(); }
    catch (err) { alert(err.message); }
    e.target.disabled = false;
  });
  document.getElementById('rnSend').addEventListener('click', async (e) => {
    if (!confirm(`Send this renewal email to ${data.to}?`)) return;
    e.target.disabled = true;
    e.target.textContent = 'Sending...';
    try {
      await api(`/api/admin/domains/registry/${rec.id}/renewal-email/send`, { method: 'POST', body: JSON.stringify(read()) });
      close();
      load();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Send to client';
    }
  });
}

// Mirrors the server's renewal maths, for the live preview and "Rebuild from pricing"
function renewalQuote(r) {
  const years = Math.min(Math.max(parseInt(r.renewal_years, 10) || 1, 1), 10);
  const price = Number(r.renewal_price) || 0;
  const fee = Number(r.renewal_service_fee) || 0;
  const r2 = (n) => Math.round(n * 100) / 100;
  const domainCost = r2(price * years);
  const subtotal = r2(domainCost + fee);
  const vat = r.renewal_vat_applicable !== false ? r2((subtotal * state.vatRate) / 100) : 0;
  return { years, price, fee, domainCost, subtotal, vat, total: r2(subtotal + vat) };
}

function defaultRenewalText(r) {
  const q = renewalQuote(r);
  const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, m, d] = r.renewal_date.split('-').map(Number);
  const when = `${d} ${LONG[m - 1]} ${y}`;
  const period = `${q.years} year${q.years === 1 ? '' : 's'}`;
  const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [`Domain: ${r.domain}`, `Renewal date: ${when}`, `Renewal period: ${period}`, '',
    `Domain renewal (${usd(q.price)} x ${period}): ${usd(q.domainCost)}`,
    ...(q.fee ? [`Service fee: ${usd(q.fee)}`] : []), ...(q.vat ? [`VAT (${state.vatRate}%): ${usd(q.vat)}`] : []), `Total: ${usd(q.total)}`];
  return {
    subject: `Domain renewal — ${r.domain} — due ${when}`,
    body: 'Hello,\n\n' +
      `Your domain ${r.domain} is due for renewal on ${when}. As we manage it for you, we'll take care of the renewal so your website and email keep running without interruption.\n\n` +
      lines.join('\n') + '\n\n' +
      "Please reply to confirm you'd like us to go ahead, or let us know if you'd prefer a different renewal period or would rather not renew.\n\nKind regards,\nAutoWerke | IT",
  };
}

// ---------- Helpers ----------

function money(n) { return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; }
function shortDate(ts) { if (!ts) return ''; const d = new Date(ts); return `${d.getDate()} ${MON[d.getMonth()]}`; }
function esc(str = '') { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function attr(str = '') { return esc(str).replace(/"/g, '&quot;'); }

load();
