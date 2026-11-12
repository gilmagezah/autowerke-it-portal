const listEl = document.getElementById('list');
const pricingListEl = document.getElementById('pricingList');
const estimateListEl = document.getElementById('estimateList');
const inProgressListEl = document.getElementById('inProgressList');
const changesListEl = document.getElementById('changesList');
const supportSignoffListEl = document.getElementById('supportSignoffList');
const statCardsEl = document.getElementById('statCards');
const companyTableEl = document.getElementById('companyTable');
const filterBannerEl = document.getElementById('filterBanner');
const tilesEl = document.getElementById('pipeTiles');
const hintEl = document.getElementById('pipeHint');

// Keep the last-loaded data so filtering doesn't need a refetch
let allLists = { pending: [], changesRequested: [], awaitingPricing: [], awaitingEstimate: [], inProgress: [] };
let stats = { totals: {}, companies: [] };
let companyFilter = null; // lowercase company name, or null for "all"

async function loadProjects() {
  const [listsRes, statsRes] = await Promise.all([
    fetch('/api/admin/projects'),
    fetch('/api/admin/stats'),
  ]);

  if (!listsRes.ok) {
    listEl.innerHTML = '<p class="empty-state">Could not load projects.</p>';
    return;
  }

  allLists = await listsRes.json();
  if (allLists.vatRate) VAT_RATE = allLists.vatRate;
  updateBand();
  if (statsRes.ok) stats = await statsRes.json();

  renderStats();
  if (firstLoad) {
    firstLoad = false;
    openCategory(location.hash.slice(1) || null, { fromHash: true });
  } else {
    renderTiles();
    renderAllLists();
  }
}
let firstLoad = true;

function updateBand() {
  if (!window.setBandStats) return;
  const n = (k) => (allLists[k] || []).length;
  const needsYou = n('pending') + n('changesRequested') + n('awaitingPricing') + n('awaitingEstimate');
  window.setBandStats([
    { label: 'Needs you', value: String(needsYou), sub: 'reviews · pricing · estimates' },
    { label: 'In progress', value: String(n('inProgress')), sub: 'support tickets' },
    { label: 'Awaiting sign-off', value: String(n('awaitingSupportSignoff')) },
  ]);
  if (window.setNavCount) window.setNavCount('pipeline', needsYou);
}

function matchesFilter(project) {
  if (!companyFilter) return true;
  return (project.company_name || '').trim().toLowerCase() === companyFilter;
}

// ---------- Category tiles (click one to open its list) ----------

const SEEN_KEY = 'aw.pipeline.seen';
let openCat = null; // the open category's key, kept in the URL hash so a reload keeps it
let newShown = new Set(); // ids tagged "New" in the open list (what was new when you opened it)

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
function markSeen(key) {
  const seen = readSeen();
  seen[key] = Date.now();
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private window: "new" just isn't remembered */ }
}

function filteredLists() {
  const out = {};
  for (const [k, v] of Object.entries(allLists)) out[k] = Array.isArray(v) ? v.filter(matchesFilter) : v;
  return out;
}

function renderTiles() {
  const tiles = window.PipelineSummary.summarize(filteredLists(), readSeen());
  tilesEl.innerHTML = tiles.map((t) => `
    <button type="button" class="pipe-tile is-${t.state}${t.key === openCat ? ' open' : ''}" data-cat="${t.key}"
            aria-pressed="${t.key === openCat}" aria-controls="panel-${t.key}">
      <span class="pipe-tile-label">${escapeHtml(t.label)}</span>
      ${t.sub ? `<span class="pipe-tile-sub">${escapeHtml(t.sub)}</span>` : '<span class="pipe-tile-sub">&nbsp;</span>'}
      <span class="pipe-tile-count">${t.count}</span>
      <span class="pipe-pill ${t.state}">${escapeHtml(t.pill)}</span>
      <span class="pipe-tile-latest">${t.latestLine
    ? `<span class="who">${escapeHtml(t.latestWho)}</span>${t.latestWhen ? `<span class="when">${t.latestWho ? ' · ' : ''}${escapeHtml(t.latestWhen)}</span>` : ''}`
    : '&nbsp;'}</span>
    </button>`).join('');
  tilesEl.querySelectorAll('.pipe-tile').forEach((b) => b.addEventListener('click', () => openCategory(b.dataset.cat === openCat ? null : b.dataset.cat)));
  hintEl.classList.toggle('hidden', Boolean(openCat));
}

function openCategory(key, { fromHash = false } = {}) {
  if (key && !document.getElementById(`panel-${key}`)) key = null;
  openCat = key;
  if (key) {
    // Remember what's new before marking the category seen, so those cards keep their "New" tag
    const tile = window.PipelineSummary.summarize(filteredLists(), readSeen()).find((t) => t.key === key);
    newShown = new Set(tile ? tile.newIds : []);
    markSeen(key);
  } else {
    newShown = new Set();
  }
  document.querySelectorAll('.pipe-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.cat !== key));
  if (!fromHash) history.replaceState(null, '', key ? `#${key}` : location.pathname + location.search);
  renderTiles();
  renderAllLists();
  const panel = key && document.getElementById(`panel-${key}`);
  if (panel && !fromHash && panel.getBoundingClientRect().top > window.innerHeight - 80) {
    panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
}

document.querySelectorAll('.pipe-close').forEach((b) => b.addEventListener('click', () => {
  openCategory(null);
  tilesEl.querySelector(`[data-cat="${b.dataset.close}"]`)?.focus();
}));

function newTagHtml(project) {
  return newShown.has(project.id) ? ' <span class="pipe-new-tag">New</span>' : '';
}

function renderAllLists() {
  renderReviewList(allLists.pending.filter(matchesFilter));
  renderChangesList((allLists.changesRequested || []).filter(matchesFilter));
  renderPricingList(allLists.awaitingPricing.filter(matchesFilter));
  renderEstimateList(allLists.awaitingEstimate.filter(matchesFilter));
  renderInProgressList(allLists.inProgress.filter(matchesFilter));
  renderSupportSignoffList((allLists.awaitingSupportSignoff || []).filter(matchesFilter));
}

// ---------- Overview stats ----------

function renderStats() {
  const t = stats.totals || {};
  statCardsEl.innerHTML = `
    <div class="stat-card"><div class="stat-value">${t.companies ?? 0}</div><div class="stat-label">Companies</div></div>
    <div class="stat-card"><div class="stat-value">${t.projects ?? 0}</div><div class="stat-label">IT Projects</div></div>
    <div class="stat-card"><div class="stat-value">${t.support ?? 0}</div><div class="stat-label">Support tickets</div></div>
    <div class="stat-card accent"><div class="stat-value">${t.active ?? 0}</div><div class="stat-label">Active right now</div></div>
  `;

  const companies = stats.companies || [];
  if (companies.length === 0) {
    companyTableEl.innerHTML = '<tbody><tr><td class="empty-state" style="cursor:default;">No companies yet.</td></tr></tbody>';
    return;
  }

  const rows = companies.map((c) => {
    const key = c.company.trim().toLowerCase();
    const selected = key === companyFilter ? 'selected' : '';
    return `
      <tr class="${selected}" data-company="${escapeAttr(key)}" data-label="${escapeAttr(c.company)}">
        <td>${escapeHtml(c.company)}</td>
        <td class="num">${c.projects}</td>
        <td class="num">${c.support}</td>
        <td class="num"><span class="active-pill ${c.active === 0 ? 'zero' : ''}">${c.active}</span></td>
      </tr>
    `;
  }).join('');

  companyTableEl.innerHTML = `
    <thead><tr>
      <th>Company</th><th class="num">Projects</th><th class="num">Support</th><th class="num">Active</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;

  companyTableEl.querySelectorAll('tbody tr[data-company]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const key = tr.dataset.company;
      setFilter(companyFilter === key ? null : key, tr.dataset.label);
    });
  });
}

function setFilter(key, label) {
  companyFilter = key;

  if (key) {
    filterBannerEl.innerHTML = `<span>Showing only <strong>${escapeHtml(label)}</strong></span><button type="button" id="clearFilter">Show all companies</button>`;
    filterBannerEl.classList.remove('hidden');
    document.getElementById('clearFilter').addEventListener('click', () => setFilter(null));
  } else {
    filterBannerEl.classList.add('hidden');
  }

  renderStats();
  renderTiles();
  renderAllLists();
}

// ---------- Pending review + changes requested (shared scope editor) ----------

function renderReviewList(projects) {
  if (!projects || projects.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No pending reviews.</p>';
    return;
  }
  listEl.innerHTML = '';
  projects.forEach((p) => renderScopeCard(p, listEl, 'review'));
}

function renderChangesList(projects) {
  if (!projects || projects.length === 0) {
    changesListEl.innerHTML = '<p class="empty-state">No change requests waiting.</p>';
    return;
  }
  changesListEl.innerHTML = '';
  projects.forEach((p) => renderScopeCard(p, changesListEl, 'changes'));
}

function reqRowHtml(value = '') {
  return `
    <div class="req-item">
      <input type="text" value="${escapeAttr(value)}" placeholder="Requirement">
      <button type="button" class="remove-req" title="Remove requirement">✕</button>
    </div>`;
}

// mode 'review'  = first review of the AI draft
// mode 'changes' = client asked for changes; start from what they last saw
function renderScopeCard(project, container, mode) {
  const isChanges = mode === 'changes';
  const reqs = isChanges
    ? (project.reviewed_requirements || project.ai_requirements || [])
    : (project.ai_requirements || []);
  const summary = isChanges
    ? (project.reviewed_scope_summary || project.ai_scope_summary || '')
    : (project.ai_scope_summary || '');
  const buttonLabel = isChanges ? 'Send revised scope to client' : 'Approve & send to client';

  const card = document.createElement('div');
  card.className = 'card';

  const supportDetailsHtml = project.request_type === 'IT Support' ? `
    <p class="meta">
      Users affected: ${escapeHtml(project.users_affected || 'N/A')} &middot;
      Devices affected: ${escapeHtml(project.devices_affected || 'N/A')}
    </p>
    <p class="meta">Already tried: ${escapeHtml(project.attempts_taken || 'N/A')}</p>
  ` : '';

  const changeHtml = isChanges ? `
    <div class="change-request">
      <div class="change-request-label">Client asked for:</div>
      <div class="preserve-lines">${escapeHtml(project.change_request || '(no details given)')}</div>
    </div>
  ` : '';

  card.innerHTML = `
    <h3>${escapeHtml(project.company_name)} — ${escapeHtml(project.request_type)}${newTagHtml(project)}</h3>
    <div class="meta">
      Ref: ${escapeHtml(project.project_id)} &middot;
      ${escapeHtml(project.name)} ${escapeHtml(project.surname || '')} &middot;
      ${escapeHtml(project.email)}${websiteHtml(project)}
    </div>
    ${changeHtml}
    ${priorityHtml(project)}
    ${shotsHtml(project)}
    <label>Project title <span class="so-hint">(short name you'll recognise later)</span></label>
    <input type="text" class="title-input-inline" maxlength="120" value="${escapeAttr(project.project_title || '')}" placeholder="e.g. Microsoft 365 Migration">
    <p class="preserve-lines"><strong>Original request:</strong> ${escapeHtml(project.details)}</p>
    ${supportDetailsHtml}

    <label>Requirements (edit as needed)</label>
    <div class="req-list">${reqs.map(reqRowHtml).join('')}</div>
    <button type="button" class="link-btn add-req">+ Add requirement</button>

    <label>Scope summary (edit as needed)</label>
    <textarea rows="3" class="scope-input">${escapeHtml(summary)}</textarea>

    <button type="button" class="approve-btn">${buttonLabel}</button>
    ${project.request_type === 'IT Support' ? convertPanelHtml() : ''}
  `;

  if (project.request_type === 'IT Support') wireConvertPanel(card, project);

  const reqList = card.querySelector('.req-list');

  card.querySelector('.add-req').addEventListener('click', () => {
    reqList.insertAdjacentHTML('beforeend', reqRowHtml(''));
    reqList.lastElementChild.querySelector('input').focus();
  });

  reqList.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-req')) {
      e.target.closest('.req-item').remove();
    }
  });

  card.querySelector('.approve-btn').addEventListener('click', () =>
    approve(project.id, card, { revised: isChanges, buttonLabel })
  );

  container.appendChild(card);
}

async function approve(projectId, card, { revised, buttonLabel }) {
  const requirements = Array.from(card.querySelectorAll('.req-item input'))
    .map((input) => input.value.trim())
    .filter(Boolean);
  const scopeSummary = card.querySelector('.scope-input').value.trim();
  const title = card.querySelector('.title-input-inline')?.value.trim() || '';

  if (requirements.length === 0 || !scopeSummary) {
    alert('Please keep at least one requirement and a scope summary.');
    return;
  }

  const btn = card.querySelector('.approve-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const res = await fetch(`/api/admin/projects/${projectId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirements, scopeSummary, revised, title }),
  });

  if (res.ok) {
    loadProjects(); // refresh lists + stats so the cache stays in sync
  } else {
    btn.disabled = false;
    btn.textContent = buttonLabel;
    alert('Something went wrong sending this to the client.');
  }
}

// ---------- Awaiting pricing (IT Project) ----------

function renderPricingList(projects) {
  if (!projects || projects.length === 0) {
    pricingListEl.innerHTML = '<p class="empty-state">Nothing waiting on pricing.</p>';
    return;
  }
  pricingListEl.innerHTML = '';
  projects.forEach(renderPricingCard);
}

function renderPricingCard(project) {
  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = `
    <h3>${escapeHtml(project.company_name)} — ${escapeHtml(project.request_type)}${newTagHtml(project)}</h3>
    ${project.project_title ? `<div class="card-title-line">${escapeHtml(project.project_title)}</div>` : ''}
    <div class="meta">Ref: ${escapeHtml(project.project_id)} &middot; ${escapeHtml(project.email)}${websiteHtml(project)}</div>
    <p class="preserve-lines"><strong>Confirmed scope:</strong> ${escapeHtml(project.reviewed_scope_summary || '')}</p>

    <label>Pricing estimate (brief, not detailed) <span class="so-hint">shown to the client as written</span></label>
    <textarea rows="5" class="pricing-input" placeholder="One item per line, e.g.&#10;50 devices x $20 = $1000&#10;VAT 15.5%&#10;Total = $1155"></textarea>

    <div class="value-row">
      <label>Contract value (excl. VAT) <span class="so-hint">for earnings tracking, not shown to the client</span>
        <input type="number" min="0" step="0.01" class="value-input" placeholder="e.g. 1000">
      </label>
      <label class="vat-check"><input type="checkbox" class="vat-input" checked> Charge VAT (${VAT_RATE}%)</label>
      <span class="value-preview"></span>
    </div>

    <button type="button" class="approve-btn">Send pricing to client</button>
  `;

  const updatePreview = () => {
    const v = Number(card.querySelector('.value-input').value);
    const vat = card.querySelector('.vat-input').checked;
    card.querySelector('.value-preview').textContent = v > 0
      ? `= ${money(vat ? v * (1 + VAT_RATE / 100) : v)} ${vat ? 'incl. VAT' : '(no VAT)'}`
      : '';
  };
  card.querySelector('.value-input').addEventListener('input', updatePreview);
  card.querySelector('.vat-input').addEventListener('change', updatePreview);

  card.querySelector('.approve-btn').addEventListener('click', () => sendPricing(project.id, card));
  pricingListEl.appendChild(card);
}

async function sendPricing(projectId, card) {
  const pricingEstimate = card.querySelector('.pricing-input').value.trim();
  const contractValue = card.querySelector('.value-input').value.trim();
  const vatApplicable = card.querySelector('.vat-input').checked;

  if (!pricingEstimate) {
    alert('Please enter a pricing estimate.');
    return;
  }
  if (contractValue === '' || Number(contractValue) < 0) {
    alert('Please enter the contract value (excl. VAT). It feeds your earnings dashboard.');
    return;
  }

  const btn = card.querySelector('.approve-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const res = await fetch(`/api/admin/projects/${projectId}/send-pricing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pricingEstimate, contractValue, vatApplicable }),
  });

  if (res.ok) {
    loadProjects(); // refresh lists + stats so the cache stays in sync
  } else {
    btn.disabled = false;
    btn.textContent = 'Send pricing to client';
    let msg = 'Something went wrong sending pricing.';
    try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
    alert(msg);
  }
}

// ---------- Awaiting estimate (IT Support) ----------

function renderEstimateList(projects) {
  if (!projects || projects.length === 0) {
    estimateListEl.innerHTML = '<p class="empty-state">Nothing waiting on an estimate.</p>';
    return;
  }
  estimateListEl.innerHTML = '';
  projects.forEach(renderEstimateCard);
}

function renderEstimateCard(project) {
  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = `
    <h3>${escapeHtml(project.company_name)} — IT Support${newTagHtml(project)}</h3>
    ${project.project_title ? `<div class="card-title-line">${escapeHtml(project.project_title)}</div>` : ''}
    <div class="meta">Ref: ${escapeHtml(project.project_id)} &middot; ${escapeHtml(project.email)}${websiteHtml(project)}</div>
    <p class="preserve-lines"><strong>Confirmed situation:</strong> ${escapeHtml(project.reviewed_scope_summary || '')}</p>

    <div class="field-row">
      <label>Estimated hours<input type="number" step="0.5" min="0" class="hours-input" placeholder="e.g. 3"></label>
      <label>Hourly rate <span class="so-hint">$50–$75</span><input type="number" step="1" min="50" max="75" class="rate-input" placeholder="e.g. 60"></label>
    </div>

    <button type="button" class="approve-btn">Send estimate to client</button>
    ${convertPanelHtml()}
  `;

  wireConvertPanel(card, project);
  card.querySelector('.approve-btn').addEventListener('click', () => sendEstimate(project.id, card));
  estimateListEl.appendChild(card);
}

async function sendEstimate(projectId, card) {
  const estimatedHours = card.querySelector('.hours-input').value.trim();
  const hourlyRate = card.querySelector('.rate-input').value.trim();

  if (!estimatedHours || !hourlyRate) {
    alert('Please enter both estimated hours and hourly rate.');
    return;
  }

  const btn = card.querySelector('.approve-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const res = await fetch(`/api/admin/projects/${projectId}/send-estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estimatedHours, hourlyRate }),
  });

  if (res.ok) {
    loadProjects(); // refresh lists + stats so the cache stays in sync
  } else {
    btn.disabled = false;
    btn.textContent = 'Send estimate to client';
    alert('Something went wrong sending the estimate.');
  }
}

// ---------- In progress (log hours) ----------

function renderInProgressList(projects) {
  if (!projects || projects.length === 0) {
    inProgressListEl.innerHTML = '<p class="empty-state">Nothing in progress.</p>';
    return;
  }
  inProgressListEl.innerHTML = '';
  projects.forEach(renderInProgressCard);
}

function renderInProgressCard(project) {
  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = `
    <h3>${escapeHtml(project.company_name)} — IT Support${newTagHtml(project)}</h3>
    ${project.project_title ? `<div class="card-title-line">${escapeHtml(project.project_title)}</div>` : ''}
    <div class="meta">Ref: ${escapeHtml(project.project_id)} &middot; ${escapeHtml(project.email)}${websiteHtml(project)}</div>
    ${project.estimate_signed_url
      ? `<div class="meta"><a href="${escapeAttr(project.estimate_signed_url)}" target="_blank" rel="noopener">✓ Signed estimate</a> &middot; ${project.estimated_hours} h at $${project.hourly_rate}/h approved</div>`
      : ''}
    ${priorityHtml(project)}
    ${shotsHtml(project)}

    <div class="timeline-container"></div>

    <div class="log-entry-form">
      <label class="f-date"><span>Date</span><input type="date" class="entry-date"></label>
      <label class="f-time"><span>Start</span><input type="time" class="entry-start"></label>
      <label class="f-time"><span>End</span><input type="time" class="entry-end"></label>
      <label class="f-note"><span>Note</span><input type="text" class="entry-note" placeholder="Optional"></label>
      <button type="button" class="btn-outline add-entry-btn">Add entry</button>
    </div>

    <div class="complete-row">
      <button type="button" class="approve-btn complete-btn">Complete &amp; send sign-off</button>
      <a class="link-btn" href="/api/admin/projects/${encodeURIComponent(project.id)}/support-signoff/preview" target="_blank" rel="noopener">Preview sign-off PDF</a>
    </div>
  `;

  const timelineContainer = card.querySelector('.timeline-container');
  renderTimeline(timelineContainer, project.work_log, { editable: true, projectId: project.id });

  timelineContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-entry')) {
      removeLogEntry(project.id, e.target.dataset.entryId, card, timelineContainer);
    }
  });

  card.querySelector('.add-entry-btn').addEventListener('click', () => addLogEntry(project.id, card, timelineContainer));
  card.querySelector('.complete-btn').addEventListener('click', () => markCompleted(project.id, card));

  inProgressListEl.appendChild(card);
}

async function addLogEntry(projectId, card, timelineContainer) {
  const date = card.querySelector('.entry-date').value;
  const start = card.querySelector('.entry-start').value;
  const end = card.querySelector('.entry-end').value;
  const note = card.querySelector('.entry-note').value.trim();

  if (!date || !start || !end) {
    alert('Please fill in date, start, and end.');
    return;
  }

  const res = await fetch(`/api/admin/projects/${projectId}/log-hours`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, start, end, note }),
  });

  const data = await res.json();

  if (res.ok) {
    syncWorkLog(projectId, data.workLog);
    renderTimeline(timelineContainer, data.workLog, { editable: true, projectId });
    card.querySelector('.entry-date').value = '';
    card.querySelector('.entry-start').value = '';
    card.querySelector('.entry-end').value = '';
    card.querySelector('.entry-note').value = '';
  } else {
    alert(data.error || 'Something went wrong adding that entry.');
  }
}

async function removeLogEntry(projectId, entryId, card, timelineContainer) {
  const res = await fetch(`/api/admin/projects/${projectId}/log-hours/${entryId}`, { method: 'DELETE' });
  const data = await res.json();

  if (res.ok) {
    syncWorkLog(projectId, data.workLog);
    renderTimeline(timelineContainer, data.workLog, { editable: true, projectId });
  } else {
    alert(data.error || 'Something went wrong removing that entry.');
  }
}

// Same rule as the server: bill logged hours, or the approved estimate if none were logged
function billingFor(project) {
  const minutes = (project.work_log || []).reduce((sum, e) => {
    const toMin = (t) => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + m; };
    const d = toMin(e.end) - toMin(e.start);
    return sum + (Number.isFinite(d) && d > 0 ? d : 0);
  }, 0);
  const logged = Math.round((minutes / 60) * 100) / 100;
  const est = Number(project.estimated_hours) || 0;
  const rate = Number(project.hourly_rate) || 0;
  const hours = logged > 0 ? logged : est;
  const subtotal = Math.round(hours * rate * 100) / 100;
  const vat = project.vat_applicable === false ? 0 : Math.round(subtotal * VAT_RATE) / 100;
  return { logged, est, hours, rate, subtotal, vat, total: Math.round((subtotal + vat) * 100) / 100, usedEstimate: logged === 0 };
}

async function markCompleted(projectId, card) {
  const project = allLists.inProgress.find((p) => p.id === projectId) || {};
  const b = billingFor(project);
  const lines = [
    `Send the completion sign-off to ${project.email}?`,
    '',
    b.usedEstimate
      ? `⚠ No hours were logged - this will bill the approved estimate of ${b.est} h.`
      : `Hours logged: ${b.logged} h (estimate was ${b.est} h)`,
    `Rate: ${money(b.rate)} / h`,
    `Total due: ${money(b.total)}${b.vat ? ` incl. ${VAT_RATE}% VAT` : ''}`,
    '',
    'Hours are locked once it is sent.',
  ];
  if (!confirm(lines.join('\n'))) return;

  const btn = card.querySelector('.complete-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  const res = await fetch(`/api/admin/projects/${projectId}/complete`, { method: 'POST' });

  if (res.ok) {
    loadProjects(); // moves to "Awaiting client sign-off"
  } else {
    btn.disabled = false;
    btn.textContent = 'Complete & send sign-off';
    let msg = 'Something went wrong sending the sign-off.';
    try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
    alert(msg);
  }
}

// ---------- Awaiting client sign-off (support) ----------

function renderSupportSignoffList(projects) {
  if (!projects || projects.length === 0) {
    supportSignoffListEl.innerHTML = '<p class="empty-state">No support sign-offs waiting.</p>';
    return;
  }
  supportSignoffListEl.innerHTML = '';
  projects.forEach(renderSupportSignoffCard);
}

function renderSupportSignoffCard(project) {
  const b = project.billing || {};
  const sent = project.signoff_sent_at ? new Date(project.signoff_sent_at).toLocaleString() : '';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>${escapeHtml(project.company_name)} — IT Support${newTagHtml(project)}</h3>
    ${project.project_title ? `<div class="card-title-line">${escapeHtml(project.project_title)}</div>` : ''}
    <div class="meta">Ref: ${escapeHtml(project.project_id)} &middot; ${escapeHtml(project.email)}${websiteHtml(project)}</div>
    <div class="signoff-summary">
      <span><strong>${b.billableHours ?? '—'} h</strong> ${b.usedEstimate ? 'billed (estimate)' : 'logged'}</span>
      <span>${money(b.rate)} / h</span>
      <span>Total due <strong>${money(b.total)}</strong>${b.vatApplies ? ' incl. VAT' : ''}</span>
    </div>
    <div class="signoff-waiting">Sent ${escapeHtml(sent)}. Waiting for ${escapeHtml(project.company_name)} to return the signed copy.</div>
    <div class="complete-row">
      <a class="link-btn" href="/api/admin/projects/${encodeURIComponent(project.id)}/support-signoff/preview" target="_blank" rel="noopener">View sign-off PDF</a>
      <button type="button" class="link-btn resend-btn">Resend to client</button>
      <button type="button" class="link-btn close-support-btn">Close manually</button>
    </div>`;

  card.querySelector('.resend-btn').addEventListener('click', async (e) => {
    if (!confirm(`Email the sign-off to ${project.email} again?`)) return;
    e.target.disabled = true;
    const res = await fetch(`/api/admin/projects/${project.id}/support-signoff/resend`, { method: 'POST' });
    e.target.disabled = false;
    alert(res.ok ? 'Sign-off resent.' : 'Something went wrong resending it.');
  });

  card.querySelector('.close-support-btn').addEventListener('click', async () => {
    if (!confirm('Complete this ticket without an uploaded sign-off?\n\nNormally it completes by itself when the client uploads the signed copy. Only do this if they signed some other way (e.g. on paper).')) return;
    const res = await fetch(`/api/admin/projects/${project.id}/close-support`, { method: 'POST' });
    if (res.ok) loadProjects();
    else alert('Something went wrong closing this ticket.');
  });

  supportSignoffListEl.appendChild(card);
}

// ---------- Convert support -> project ----------

const CONVERT_REASON_TEMPLATE =
  "Based on the details you shared, this goes beyond a quick support fix: it needs planning, " +
  "configuration across several users/devices, and a structured rollout. Handling it as a project " +
  "gives you a fixed price, a clear plan, and progress updates along the way.";

function convertPanelHtml() {
  return `
    <div class="convert-wrap">
      <button type="button" class="link-btn convert-toggle">Too complex for support? Convert to project</button>
      <div class="convert-panel hidden">
        <div class="convert-title">Convert this support request into an IT project</div>
        <p class="meta">The client gets an email explaining why, and it continues from the equivalent project stage. The reference number stays the same.</p>
        <label>Reason for the client <span class="so-hint">edit to fit this request</span></label>
        <textarea rows="4" class="convert-reason">${escapeHtml(CONVERT_REASON_TEMPLATE)}</textarea>
        <div class="convert-actions">
          <button type="button" class="btn-convert">Convert & email client</button>
          <button type="button" class="link-btn convert-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
}

function wireConvertPanel(card, project) {
  const panel = card.querySelector('.convert-panel');
  const toggle = card.querySelector('.convert-toggle');
  toggle.addEventListener('click', () => {
    panel.classList.remove('hidden');
    toggle.classList.add('hidden');
    card.querySelector('.convert-reason').focus();
  });
  card.querySelector('.convert-cancel').addEventListener('click', () => {
    panel.classList.add('hidden');
    toggle.classList.remove('hidden');
  });
  card.querySelector('.btn-convert').addEventListener('click', async (e) => {
    const reason = card.querySelector('.convert-reason').value.trim();
    if (reason.length < 10) return alert('Please explain to the client why (at least a sentence).');
    if (!confirm(`Convert ${project.project_id} to an IT project and email ${project.email}?`)) return;

    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Converting...';
    const res = await fetch(`/api/admin/projects/${project.id}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      loadProjects(); // it reappears as an IT Project in the matching section
    } else {
      btn.disabled = false;
      btn.textContent = 'Convert & email client';
      let msg = 'Something went wrong converting this request.';
      try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
      alert(msg);
    }
  });
}

// ---------- Priority + screenshots on cards ----------

const PRIORITY_LABELS = {
  1: 'Whenever you get a chance', 2: "Annoying, but managing", 3: 'Really slowing them down',
  4: "Stuck, can't get work done", 5: "Everything's on fire",
};

function priorityHtml(p) {
  if (!p.priority) return '';
  return `<div class="prio-pill p${p.priority}"><strong>P${p.priority}</strong> ${escapeHtml(PRIORITY_LABELS[p.priority] || '')}${p.can_work === false ? ' · <em>can\'t work</em>' : ''}</div>`;
}

function shotsHtml(p) {
  const shots = p.attachments || [];
  if (!shots.length) return '';
  const texts = shots.filter((a) => /^text\//.test(a.type)).length;
  const images = shots.length - texts;
  const note = [images && `${images} screenshot${images === 1 ? '' : 's'}`, texts && `${texts} text file${texts === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  return `<div class="card-shots">${shots.map((a, i) => `
    <a href="${escapeAttr(a.url)}" target="_blank" rel="noopener" title="${escapeAttr(a.name || `Attachment ${i + 1}`)}">
      ${/^text\//.test(a.type)
    ? `<span class="card-file"><strong>TXT</strong><span>${escapeHtml(a.name || 'Text file')}</span></span>`
    : `<img src="${escapeAttr(a.url)}" alt="Screenshot ${i + 1}" loading="lazy">`}
    </a>`).join('')}<span class="card-shots-note">${note} · click to open</span></div>`;
}

// ---------- Shared helpers ----------

let VAT_RATE = 15.5; // replaced by the server's VAT_RATE setting on load

function money(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function syncWorkLog(projectId, workLog) {
  const p = allLists.inProgress.find((x) => x.id === projectId);
  if (p) p.work_log = workLog;
}

// The client's website (stored only as a checked https/http address), opened in a new tab
function websiteHtml(project) {
  const url = project.company_website;
  if (!url || !/^https?:\/\/[^\s"'<>]+$/i.test(url)) return '';
  const shown = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return ` &middot; <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(shown)}</a>`;
}

function escapeHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str = '') {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

loadProjects();
