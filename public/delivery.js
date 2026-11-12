const listEl = document.getElementById('deliveryList');

// projectId -> { project, phases (working copy), dirty }
const state = {};

async function load() {
  try {
    const res = await fetch('/api/admin/delivery');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load projects.');

    if (!data.length) {
      listEl.innerHTML = '<p class="empty-state">No signed projects yet. They appear here once a client uploads a signed contract.</p>';
      return;
    }

    if (window.setBandStats) {
      const active = data.filter((p) => p.status !== 'closed');
      const awaiting = active.filter((p) => p.signoff_sent_at && !p.signoff_signed_at).length;
      const fresh = active.filter((p) => isNewProject(p)).length;
      window.setBandStats([
        { label: 'In delivery', value: String(active.length), sub: fresh ? `${fresh} new` : '' },
        { label: 'Awaiting sign-off', value: String(awaiting) },
        { label: 'Closed', value: String(data.length - active.length) },
      ]);
      if (window.setNavCount) window.setNavCount('delivery', fresh);
    }

    listEl.innerHTML = '';
    // Active projects first (newest signed at the top), closed ones at the bottom
    const signedTime = (p) => new Date(p.signed_at || p.created_at || 0).getTime();
    data.sort((a, b) =>
      ((a.status === 'closed') - (b.status === 'closed')) || (signedTime(b) - signedTime(a)));
    data.forEach((p) => {
      // openOverride: phaseId -> true/false once the admin toggles a row;
      // otherwise only the current phase is expanded
      state[p.id] = {
        project: p,
        phases: (p.phases || []).map((x) => ({ ...x })),
        dirty: false,
        openOverride: {},
        editingTitle: false,
        signoff: null,        // working copy of the sign-off editor
        signoffOpen: false,
        signoffDirty: false,
      };
      const card = document.createElement('div');
      card.className = 'card delivery-card';
      card.dataset.id = p.id;
      listEl.appendChild(card);
      renderCard(p.id);
    });
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

// ---------- Rendering ----------

function cardEl(id) {
  return listEl.querySelector(`.delivery-card[data-id="${id}"]`);
}

function progress(phases) {
  const total = phases.length;
  const done = phases.filter((p) => p.done).length;
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    currentIndex: phases.findIndex((p) => !p.done),
  };
}

function renderCard(id) {
  const s = state[id];
  const p = s.project;
  const card = cardEl(id);

  if (p.status === 'closed') return renderClosedCard(card, s);

  // Keep whatever the admin was typing (update message, title) across re-renders
  const prevMessage = card.querySelector('.update-message')?.value || '';
  const prevTitleInput = card.querySelector('.title-input')?.value;

  const prog = progress(s.phases);
  const delivered = p.status === 'delivered'; // legacy status: awaiting the signed sign-off
  const lastSent = p.last_progress_update_at ? new Date(p.last_progress_update_at).toLocaleString() : 'never';

  let body;
  if (!s.phases.length) {
    body = `
      <div class="phase-empty">
        <p>No phases set up yet. Start from the default IT project template, then rename, reorder, or remove phases to fit this project.</p>
        <button type="button" class="approve-btn" data-action="init">Set up default phases</button>
      </div>`;
  } else {
    body = `
      <div class="phase-list">${s.phases.map((ph, i) => phaseRow(ph, i, prog.currentIndex, s.phases.length, s.openOverride)).join('')}</div>
      <button type="button" class="link-btn" data-action="add">+ Add phase</button>

      <div class="save-row">
        <button type="button" class="approve-btn" data-action="save">Save phases</button>
        <span class="dirty-flag ${s.dirty ? '' : 'hidden'}">Unsaved changes</span>
        <span class="saved-flag hidden">Saved</span>
      </div>

      <div class="update-box">
        <h4>Send the client a progress update</h4>
        <p class="meta">The email shows phase headings and completion only, never instructions or notes. Unsaved changes are saved first.</p>
        <textarea rows="3" class="update-message" placeholder="Optional message to the client, e.g. 'Pilot went well, full rollout starts Monday.'"></textarea>
        <div class="update-actions">
          <button type="button" class="btn-changes" data-action="preview">Preview email</button>
          <button type="button" class="approve-btn" data-action="send">Send progress update</button>
        </div>
        <p class="meta" style="margin-bottom:0;">Last update sent: ${esc(lastSent)}</p>
      </div>

      ${signoffSection(s)}

      <div class="close-row">
        <span class="meta">The project closes automatically when the client uploads the signed sign-off.</span>
        <button type="button" class="link-btn close-manual" data-action="close-project">Close manually</button>
      </div>`;
  }

  card.innerHTML = `
    <div class="delivery-head">
      <div class="delivery-title-wrap">
        ${titleHtml(s)}
        <div class="meta">${esc(p.company_name)} — ${esc(p.project_id)} &middot; ${esc(p.name)} ${esc(p.surname || '')} &middot; ${esc(p.email)}</div>
        ${p.reviewed_scope_summary ? `<p class="scope-snippet" title="${attr(p.reviewed_scope_summary)}">${esc(p.reviewed_scope_summary)}</p>` : ''}
      </div>
      <span class="status-pill">${delivered ? 'Awaiting sign-off' : 'In delivery'}</span>
    </div>
    ${s.phases.length ? `
      <div class="overall">
        <div class="overall-bar"><div style="width:${prog.percent}%"></div></div>
        <span>${prog.done} of ${prog.total} phases &middot; ${prog.percent}%</span>
      </div>` : ''}
    ${body}
  `;

  const msg = card.querySelector('.update-message');
  if (msg) msg.value = prevMessage;
  const titleInput = card.querySelector('.title-input');
  if (titleInput && prevTitleInput !== undefined) titleInput.value = prevTitleInput;
}

function renderClosedCard(card, s) {
  const p = s.project;
  const phaseItems = (s.phases || []).map((ph) => `
    <li class="${ph.done ? 'done' : ''}">
      <span class="closed-phase-dot">${ph.done ? '✓' : '–'}</span>
      <span>${esc(ph.title)}</span>
      ${ph.completed_date ? `<span class="closed-phase-date">${esc(shortDate(ph.completed_date))}</span>` : ''}
    </li>`).join('');

  const links = [
    p.signoff_signed_url ? `<a href="${attr(p.signoff_signed_url)}" target="_blank" rel="noopener">View signed sign-off</a>` : '',
    p.signoff_sent_at ? `<a href="/api/signoff/${attr(p.confirm_token)}" target="_blank" rel="noopener">Download sign-off we sent</a>` : '',
  ].filter(Boolean).join(' &middot; ');

  const how = p.signoff_signed_at
    ? 'Closed when the client uploaded the signed sign-off.'
    : 'Closed manually.';

  card.classList.add('closed');
  card.innerHTML = `
    <div class="delivery-head">
      <div class="delivery-title-wrap">
        <h3 class="project-title">${p.project_title ? esc(p.project_title) : '<span class="untitled">Untitled project</span>'}</h3>
        <div class="meta">${esc(p.company_name)} — ${esc(p.project_id)} &middot; ${esc(p.name)} ${esc(p.surname || '')} &middot; ${esc(p.email)}</div>
      </div>
      <span class="status-pill closed">Closed</span>
    </div>
    <div class="closed-badge">Project Closed — ${esc(fmtClosed(p.closed_at))}</div>
    <p class="meta" style="margin:0 0 10px;">${how}${links ? ` ${links}` : ''}</p>
    ${phaseItems ? `<details class="closed-phases"><summary>${(s.phases || []).filter((x) => x.done).length} of ${(s.phases || []).length} phases completed</summary><ul>${phaseItems}</ul></details>` : ''}
  `;
}

function fmtClosed(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const NEW_DAYS = 7;

// "New" = contract signed in the last 7 days. Projects signed before signed_at
// was recorded count as new until delivery is set up (no phases yet).
function isNewProject(p) {
  if (p.status === 'closed') return false;
  if (p.signed_at) return Date.now() - new Date(p.signed_at).getTime() < NEW_DAYS * 24 * 60 * 60 * 1000;
  return !(p.phases && p.phases.length);
}

function newBadge(p) {
  if (!isNewProject(p)) return '';
  const when = p.signed_at ? `Contract signed ${new Date(p.signed_at).toLocaleDateString()}` : 'Delivery not set up yet';
  return `<span class="new-badge" title="${attr(when)}">New</span>`;
}

function titleHtml(s) {
  const title = s.project.project_title;
  if (s.editingTitle) {
    return `
      <div class="title-editor">
        <input type="text" class="title-input" maxlength="120" value="${attr(title || '')}" placeholder="e.g. Microsoft 365 Migration" aria-label="Project title">
        <button type="button" class="btn-small secondary" data-action="suggest-title" title="Suggest a title with AI">✨ Suggest</button>
        <button type="button" class="btn-small primary" data-action="save-title">Save</button>
        <button type="button" class="link-btn" data-action="cancel-title">Cancel</button>
      </div>`;
  }
  return `
    <h3 class="project-title">
      ${newBadge(s.project)}
      ${title ? esc(title) : '<span class="untitled">Untitled project</span>'}
      <button type="button" class="link-btn rename-btn" data-action="rename">${title ? 'Rename' : 'Add a title'}</button>
    </h3>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(d) {
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}

// One-line summary shown on the collapsed row
function phaseSummary(ph) {
  const parts = [];
  if (ph.done) parts.push(ph.completed_date ? `Done ${shortDate(ph.completed_date)}` : 'Done');
  else if (ph.planned_start || ph.planned_end) {
    parts.push(`Planned ${shortDate(ph.planned_start) || '?'} – ${shortDate(ph.planned_end) || '?'}`);
  }
  if (ph.notes && ph.notes.trim()) parts.push('Has notes');
  return parts.join(' · ');
}

function phaseRow(ph, i, currentIndex, total, openOverride = {}) {
  const isCurrent = i === currentIndex;
  const open = ph.id in openOverride ? openOverride[ph.id] : isCurrent;
  const summary = phaseSummary(ph);

  return `
    <div class="phase-row ${ph.done ? 'done' : ''} ${isCurrent ? 'current' : ''}" data-index="${i}">
      <div class="phase-main">
        <label class="phase-check" title="Mark phase complete">
          <input type="checkbox" data-field="done" ${ph.done ? 'checked' : ''}>
        </label>
        <span class="phase-num">${ph.done ? '✓' : i + 1}</span>
        <input type="text" class="phase-title" data-field="title" value="${attr(ph.title)}" aria-label="Phase title">
        ${isCurrent ? '<span class="current-tag">Current</span>' : ''}
        <div class="phase-tools">
          <button type="button" data-action="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button type="button" data-action="down" ${i === total - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button type="button" data-action="remove" title="Remove phase">✕</button>
        </div>
      </div>

      <details class="phase-body" data-phase-id="${attr(ph.id)}" ${open ? 'open' : ''}>
        <summary>
          <span class="phase-body-toggle">Details</span>
          ${summary ? `<span class="phase-summary">${esc(summary)}</span>` : ''}
        </summary>

        <div class="phase-dates">
          <label>Planned start<input type="date" data-field="planned_start" value="${attr(ph.planned_start || '')}"></label>
          <label>Planned end<input type="date" data-field="planned_end" value="${attr(ph.planned_end || '')}"></label>
          <label>Completed<input type="date" data-field="completed_date" value="${attr(ph.completed_date || '')}" ${ph.done ? '' : 'disabled'}></label>
        </div>

        <div class="phase-field-label">What to do at this stage</div>
        <textarea rows="4" class="phase-instructions-input" data-field="instructions">${esc(ph.instructions || '')}</textarea>

        <label class="phase-notes-label">Internal notes
          <textarea rows="2" data-field="notes" placeholder="e.g. Waiting on client for licence keys">${esc(ph.notes || '')}</textarea>
        </label>
      </details>
    </div>`;
}

function fmtWhen(iso) {
  return iso ? new Date(iso).toLocaleString() : '';
}

function signoffSection(s) {
  const p = s.project;
  const prog = progress(s.phases);
  const allDone = prog.total > 0 && prog.done === prog.total;
  const sent = p.signoff_sent_at;
  const signed = p.signoff_signed_at;

  if (!allDone && !sent) {
    return `
      <div class="signoff-box locked">
        <h4>Sign-off document</h4>
        <p class="meta" style="margin:0;">Unlocks once every phase is ticked off (${prog.done} of ${prog.total} done).</p>
      </div>`;
  }

  let status = '';
  if (signed) {
    status = `<div class="signoff-status ok">✓ Signed copy received ${esc(fmtWhen(signed))} &middot;
      <a href="${attr(p.signoff_signed_url || '#')}" target="_blank" rel="noopener">View signed copy</a></div>`;
  } else if (sent) {
    status = `<div class="signoff-status waiting">Sent ${esc(fmtWhen(sent))}. Waiting for ${esc(p.company_name)} to return the signed copy.</div>`;
  }

  const openBtn = s.signoffOpen || signed ? '' : `
    <button type="button" class="approve-btn" data-action="open-signoff">
      ${sent ? 'Edit & resend sign-off' : 'Prepare sign-off document'}
    </button>`;

  return `
    <div class="signoff-box">
      <h4>Sign-off document</h4>
      <p class="meta">Pre-filled from the project. Add any outstanding issues and recommendations, preview it, then send.
        The client gets the PDF by email and can upload the signed copy from their portal link.</p>
      ${status}
      ${openBtn}
      ${s.signoffOpen ? signoffEditor(s) : ''}
    </div>`;
}

function signoffEditor(s) {
  const so = s.signoff || {};
  const list = (v) => (Array.isArray(v) ? v.join('\n') : (v || ''));
  const field = (label, name, value, { rows = 0, placeholder = '', hint = '' } = {}) => `
    <label class="so-field">${label}${hint ? ` <span class="so-hint">${hint}</span>` : ''}
      ${rows
        ? `<textarea rows="${rows}" data-sfield="${name}" placeholder="${attr(placeholder)}">${esc(value)}</textarea>`
        : `<input type="text" data-sfield="${name}" value="${attr(value)}" placeholder="${attr(placeholder)}">`}
    </label>`;

  return `
    <div class="signoff-editor">
      ${field('Project name (cover page)', 'project_title', so.project_title || '', { placeholder: 'e.g. Microsoft 365 Migration' })}
      ${field('1.1 Introduction', 'introduction', so.introduction || '', { rows: 4 })}
      ${field('2.1 Project objectives', 'objectives', list(so.objectives), { rows: 5, hint: 'one per line' })}
      ${field('2.2 Outstanding issues', 'outstanding_issues', list(so.outstanding_issues), { rows: 3, hint: 'one per line · leave empty for "None"', placeholder: 'e.g. One laptop awaiting TPM firmware update' })}
      ${field('2.3 Recommendations', 'recommendations', list(so.recommendations), { rows: 3, hint: 'one per line', placeholder: 'e.g. Enable Conditional Access policies' })}
      ${field('3.1 Acceptance statement', 'acceptance_statement', so.acceptance_statement || '', { rows: 3 })}
      <div class="so-row">
        ${field('Client signatory name', 'client_signatory_name', so.client_signatory_name || '')}
        ${field('Client signatory title', 'client_signatory_title', so.client_signatory_title || '')}
      </div>
      <div class="so-actions">
        <button type="button" class="btn-small secondary" data-action="save-signoff">Save draft</button>
        <button type="button" class="btn-small secondary" data-action="preview-signoff">Preview PDF</button>
        <button type="button" class="btn-small primary" data-action="send-signoff">Send sign-off to client</button>
        <button type="button" class="link-btn" data-action="close-signoff">Close</button>
        <span class="dirty-flag signoff-dirty ${s.signoffDirty ? '' : 'hidden'}">Unsaved changes</span>
      </div>
    </div>`;
}

// ---------- State changes ----------

function markDirty(id) {
  state[id].dirty = true;
  const card = cardEl(id);
  card.querySelector('.dirty-flag')?.classList.remove('hidden');
  card.querySelector('.saved-flag')?.classList.add('hidden');
}

function today() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function newPhaseId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function contextFor(target) {
  const card = target.closest('.delivery-card');
  if (!card) return null;
  const row = target.closest('.phase-row');
  return { id: card.dataset.id, index: row ? Number(row.dataset.index) : null };
}

// Remember rows the admin opens/closes. Uses the summary click (fires for
// mouse and keyboard) rather than the 'toggle' event, which also fires for
// rows that are merely *rendered* open.
listEl.addEventListener('click', (e) => {
  const summary = e.target.closest('details.phase-body > summary');
  if (!summary) return;
  const d = summary.parentElement;
  const card = d.closest('.delivery-card');
  // The click hasn't toggled the element yet, so the new state is !d.open
  state[card.dataset.id].openOverride[d.dataset.phaseId] = !d.open;
});

// Typing in the sign-off editor: update state only, no re-render
listEl.addEventListener('input', (e) => {
  const sfield = e.target.dataset.sfield;
  if (!sfield) return;
  const ctx = contextFor(e.target);
  if (!ctx) return;
  const s = state[ctx.id];
  s.signoff[sfield] = e.target.value;
  s.signoffDirty = true;
  cardEl(ctx.id).querySelector('.signoff-dirty')?.classList.remove('hidden');
});

// Enter in the title box saves it
listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('title-input')) return;
  e.preventDefault();
  const ctx = contextFor(e.target);
  if (ctx) saveTitle(ctx.id, cardEl(ctx.id).querySelector('[data-action="save-title"]'));
});

// Typing: update state only, no re-render (so focus is never lost)
listEl.addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  if (!field || field === 'done') return;
  const ctx = contextFor(e.target);
  if (!ctx || ctx.index === null) return;
  state[ctx.id].phases[ctx.index][field] = e.target.value || (field.includes('date') || field.startsWith('planned') ? null : '');
  markDirty(ctx.id);
});

// Ticking a phase: auto-fill today's date, then re-render progress
listEl.addEventListener('change', (e) => {
  if (e.target.dataset.field !== 'done') return;
  const ctx = contextFor(e.target);
  if (!ctx || ctx.index === null) return;

  const phase = state[ctx.id].phases[ctx.index];
  phase.done = e.target.checked;
  phase.completed_date = phase.done ? (phase.completed_date || today()) : null;
  state[ctx.id].dirty = true;
  renderCard(ctx.id);
});

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const ctx = contextFor(btn);
  if (!ctx) return;
  const s = state[ctx.id];
  const action = btn.dataset.action;

  if (action === 'up' || action === 'down') {
    const to = action === 'up' ? ctx.index - 1 : ctx.index + 1;
    [s.phases[ctx.index], s.phases[to]] = [s.phases[to], s.phases[ctx.index]];
    s.dirty = true;
    return renderCard(ctx.id);
  }

  if (action === 'remove') {
    const title = s.phases[ctx.index].title || 'this phase';
    if (!confirm(`Remove "${title}"?`)) return;
    s.phases.splice(ctx.index, 1);
    s.dirty = true;
    return renderCard(ctx.id);
  }

  if (action === 'add') {
    const newId = newPhaseId();
    s.phases.push({
      id: newId, title: 'New phase', instructions: '', notes: '',
      done: false, completed_date: null, planned_start: null, planned_end: null,
    });
    s.openOverride[newId] = true;
    s.dirty = true;
    renderCard(ctx.id);
    const titles = cardEl(ctx.id).querySelectorAll('.phase-title');
    const last = titles[titles.length - 1];
    last.focus();
    last.select();
    return;
  }

  if (action === 'rename') {
    s.editingTitle = true;
    renderCard(ctx.id);
    const input = cardEl(ctx.id).querySelector('.title-input');
    input.focus();
    input.select();
    return;
  }
  if (action === 'cancel-title') {
    s.editingTitle = false;
    cardEl(ctx.id).querySelector('.title-input').remove(); // don't carry the discarded text over
    return renderCard(ctx.id);
  }
  if (action === 'save-title') return saveTitle(ctx.id, btn);
  if (action === 'suggest-title') return suggestTitle(ctx.id, btn);
  if (action === 'open-signoff') return openSignoff(ctx.id, btn);
  if (action === 'close-signoff') {
    if (s.signoffDirty && !confirm('Close without saving your sign-off changes?')) return;
    s.signoffOpen = false;
    s.signoffDirty = false;
    s.signoff = null;
    return renderCard(ctx.id);
  }
  if (action === 'save-signoff') return saveSignoff(ctx.id, btn);
  if (action === 'preview-signoff') return previewSignoff(ctx.id);
  if (action === 'send-signoff') return sendSignoff(ctx.id, btn);
  if (action === 'init') return initPhases(ctx.id, btn);
  if (action === 'save') return savePhases(ctx.id, btn);
  if (action === 'preview') return previewUpdate(ctx.id);
  if (action === 'send') return sendUpdate(ctx.id, btn);
  if (action === 'close-project') return closeProject(ctx.id, btn);
});

// ---------- Server calls ----------

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function withBusy(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    return await fn();
  } catch (err) {
    alert(err.message);
    return null;
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

async function initPhases(id, btn) {
  await withBusy(btn, 'Setting up...', async () => {
    const data = await api(`/api/admin/projects/${id}/phases/init`, { method: 'POST' });
    state[id].phases = data.phases;
    state[id].dirty = false;
    renderCard(id);
  });
}

// Returns true if saved (or nothing to save)
async function persist(id) {
  const s = state[id];
  if (s.phases.some((p) => !String(p.title || '').trim())) {
    throw new Error('Every phase needs a title before saving.');
  }
  const data = await api(`/api/admin/projects/${id}/phases`, {
    method: 'PUT',
    body: JSON.stringify({ phases: s.phases }),
  });
  s.phases = data.phases;
  s.dirty = false;
  return true;
}

async function savePhases(id, btn) {
  const ok = await withBusy(btn, 'Saving...', () => persist(id));
  if (!ok) return;
  renderCard(id);
  cardEl(id).querySelector('.saved-flag')?.classList.remove('hidden');
}

async function previewUpdate(id) {
  const message = cardEl(id).querySelector('.update-message').value;
  // Open the window first (inside the click) so popup blockers allow it
  const win = window.open('', '_blank');
  if (!win) return alert('Please allow popups for this site to preview the email.');
  win.document.write('<p style="font-family:sans-serif;padding:20px;">Building preview...</p>');

  try {
    const res = await fetch(`/api/admin/projects/${id}/update-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phases: state[id].phases, message }),
    });
    const html = await res.text();
    if (!res.ok) {
      let msg = 'Could not build preview.';
      try { msg = JSON.parse(html).error || msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (err) {
    win.close();
    alert(err.message);
  }
}

async function sendUpdate(id, btn) {
  const s = state[id];
  const message = cardEl(id).querySelector('.update-message').value;
  if (!confirm(`Email a progress update to ${s.project.email}?`)) return;

  const result = await withBusy(btn, 'Sending...', async () => {
    if (s.dirty) await persist(id);
    return api(`/api/admin/projects/${id}/send-update`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  });
  if (!result) return;

  s.project.last_progress_update_at = result.lastSentAt;
  cardEl(id).querySelector('.update-message').value = '';
  renderCard(id);
  alert('Progress update sent.');
}

async function closeProject(id, btn) {
  const s = state[id];
  const { done, total } = progress(s.phases);
  let prompt = 'Close this project now?\n\nNormally it closes by itself when the client uploads the signed sign-off. Only close manually if they signed some other way (e.g. on paper).';
  if (done < total) prompt = `Only ${done} of ${total} phases are ticked.\n\n${prompt}`;
  if (!confirm(prompt)) return;

  const result = await withBusy(btn, 'Closing...', async () => {
    if (s.dirty) await persist(id);
    return api(`/api/admin/projects/${id}/close`, { method: 'POST' });
  });
  if (!result) return;

  s.project.status = 'closed';
  s.project.closed_at = result.closedAt;
  renderCard(id);
}

async function saveTitle(id, btn) {
  const input = cardEl(id).querySelector('.title-input');
  const title = input.value.trim();
  if (!title) return alert('Please enter a title.');
  const data = await withBusy(btn, 'Saving...', () =>
    api(`/api/admin/projects/${id}/title`, { method: 'PATCH', body: JSON.stringify({ title }) })
  );
  if (!data) return;
  const s = state[id];
  s.project.project_title = data.title;
  s.editingTitle = false;
  input.remove();
  renderCard(id);
}

async function suggestTitle(id, btn) {
  const data = await withBusy(btn, 'Thinking...', () =>
    api(`/api/admin/projects/${id}/suggest-title`, { method: 'POST' })
  );
  if (!data) return;
  const input = cardEl(id).querySelector('.title-input');
  input.value = data.title; // shown for review - saved only when you click Save
  input.focus();
}

async function openSignoff(id, btn) {
  const s = state[id];
  const draft = s.project.signoff;
  if (draft) {
    s.signoff = { ...draft };
  } else {
    const defaults = await withBusy(btn, 'Loading...', () => api(`/api/admin/projects/${id}/signoff/defaults`));
    if (!defaults) return;
    s.signoff = defaults;
  }
  // The project's current title wins over an empty default
  if (!s.signoff.project_title) s.signoff.project_title = s.project.project_title || '';
  s.signoffOpen = true;
  s.signoffDirty = false;
  renderCard(id);
  cardEl(id).querySelector('.signoff-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveSignoff(id, btn) {
  const s = state[id];
  const data = await withBusy(btn, 'Saving...', () =>
    api(`/api/admin/projects/${id}/signoff`, { method: 'PUT', body: JSON.stringify({ signoff: s.signoff }) })
  );
  if (!data) return;
  s.signoff = { ...data.signoff };
  s.project.signoff = data.signoff;
  s.signoffDirty = false;
  renderCard(id);
}

async function previewSignoff(id) {
  const win = window.open('', '_blank'); // open inside the click so popup blockers allow it
  if (!win) return alert('Please allow popups for this site to preview the PDF.');
  win.document.write('<p style="font-family:sans-serif;padding:20px;">Building PDF preview...</p>');
  try {
    const res = await fetch(`/api/admin/projects/${id}/signoff/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signoff: state[id].signoff }),
    });
    if (!res.ok) {
      let msg = 'Could not build the preview.';
      try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    win.location.href = URL.createObjectURL(blob);
  } catch (err) {
    win.close();
    alert(err.message);
  }
}

async function sendSignoff(id, btn) {
  const s = state[id];
  const resend = Boolean(s.project.signoff_sent_at);
  if (!confirm(`${resend ? 'Resend' : 'Send'} the sign-off document to ${s.project.email}?`)) return;

  const result = await withBusy(btn, 'Sending...', async () => {
    if (s.dirty) await persist(id); // server checks the SAVED phases are all done
    return api(`/api/admin/projects/${id}/signoff/send`, {
      method: 'POST',
      body: JSON.stringify({ signoff: s.signoff }),
    });
  });
  if (!result) return;

  s.project.signoff = { ...s.signoff };
  s.project.signoff_sent_at = result.sentAt;
  s.project.signoff_signed_at = null;
  s.project.signoff_signed_url = null;
  s.signoffOpen = false;
  s.signoffDirty = false;
  s.signoff = null;
  renderCard(id);
  alert('Sign-off document sent.');
}

// ---------- Helpers ----------

function esc(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function attr(str = '') {
  return esc(str).replace(/"/g, '&quot;');
}

load();
