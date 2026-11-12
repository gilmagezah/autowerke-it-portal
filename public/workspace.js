const app = document.getElementById('app');
const esc = (s = '') => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (s = '') => esc(s).replace(/"/g, '&quot;');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? d : `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`; };
const daysUntil = (d) => (d ? Math.round((new Date(`${d}T00:00:00`) - new Date(new Date().toDateString())) / 86400000) : null);
const { TEMPLATES, SECTIONS, CHECKLISTS, EMAILS } = window.WS;
const byId = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) { location.href = `/admin/login?next=${encodeURIComponent(location.pathname)}`; throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// State for the workspace view (declared before anything runs)
let S = null;
let section = 'notes';
let timerId = null;
let timeSegment = null;
let sessionStart = Date.now();
let saveTimer = null;

const wsId = (location.pathname.match(/^\/admin\/workspace\/([0-9a-f-]{36})$/) || [])[1];

// =====================================================================
// Launcher + team
// =====================================================================
async function renderLauncher() {
  app.innerHTML = `
    <header class="band"><div class="band-title"><h1>Workspace</h1><div class="band-sub">Notes · logins & MFA · docs · per ticket</div></div><div class="band-stats"></div></header>
    <div class="svc-card">
      <div class="svc-label" style="margin-top:0;">Start or open a workspace</div>
      <div class="ws-start">
        <label class="fu-field">Ticket / project reference<input id="wsRef" placeholder="TANNER-5422" autocomplete="off" spellcheck="false"></label>
        <button type="button" class="btn-primary" id="wsGo">Open workspace ↗</button>
      </div>
      <p class="svc-hint" id="wsMsg" style="margin:8px 0 0;">Opens in a new tab. Your time there is tracked until you finish or step away.</p>
    </div>
    <div class="svc-section"><h2>Your workspaces</h2></div><div class="ws-list" id="owned"><p class="empty-state">Loading...</p></div>
    <div class="svc-section"><h2>Shared with you</h2></div><div class="ws-list" id="shared"></div>
    <div class="svc-section"><h2>Team</h2><span class="count">admins who can sign in</span></div><div id="team"></div>`;

  const go = async () => {
    const ref = byId('wsRef').value.trim();
    if (!ref) return;
    const tab = window.open('', '_blank'); // open now so pop-up blockers allow it
    try {
      const ws = await api('/api/admin/workspaces', { method: 'POST', body: JSON.stringify({ ref }) });
      if (tab) tab.location = `/admin/workspace/${ws.id}`; else location.href = `/admin/workspace/${ws.id}`;
      loadLists();
    } catch (err) {
      if (tab) tab.close();
      byId('wsMsg').textContent = err.message;
    }
  };
  byId('wsGo').addEventListener('click', go);
  byId('wsRef').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  loadLists();
  loadTeam();
}

async function loadLists() {
  const { owned, shared } = await api('/api/admin/workspaces');
  const tile = (w, extra = '') => `<a class="ws-tile" href="/admin/workspace/${attr(w.id)}" target="_blank" rel="noopener">
      <div class="ref">${esc(w.ref)}</div><div class="t">${esc(w.title || '')}</div><div class="m">updated ${esc(fmtDate(w.updated_at))}${extra}</div></a>`;
  byId('owned').innerHTML = owned.length ? owned.map((w) => tile(w)).join('') : '<p class="empty-state">None yet. Enter a reference above to start one.</p>';
  byId('shared').innerHTML = shared.length
    ? shared.map((w) => tile(w, ` · ${w.sections ? `${w.sections.length} section${w.sections.length === 1 ? '' : 's'}` : 'full access'}`)).join('')
    : '<p class="empty-state">Nothing shared with you yet.</p>';
  if (window.setBandStats) window.setBandStats([{ label: 'Your workspaces', value: String(owned.length) }, { label: 'Shared with you', value: String(shared.length) }]);
}

async function loadTeam() {
  const el = byId('team');
  const { team, me, role } = await api('/api/admin/team');
  const owner = role === 'owner';
  el.innerHTML = `
    <div class="svc-card">
      <div class="ct-table">${team.map((a) => `
        <div class="ct-row" style="grid-template-columns:1.2fr 1.4fr 1fr auto;">
          <div><strong>${esc(a.name)}</strong>${a.id === me ? ' <span class="ws-pill">you</span>' : ''}<div class="reg-sub">${esc(a.role)}</div></div>
          <div>${esc(a.email)}</div>
          <div class="reg-sub">${a.active ? `last sign-in ${esc(a.last_login_at ? fmtDate(a.last_login_at) : 'never')}` : '<span class="ws-pill red">deactivated</span>'}</div>
          <div>${owner && a.id !== me ? `<button type="button" class="btn-outline" data-toggle="${attr(a.id)}" data-active="${a.active ? '1' : ''}">${a.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}</div>
        </div>`).join('')}</div>
      ${owner ? `
        <div class="svc-label">Add a colleague</div>
        <div class="q-row-inline">
          <label class="fu-field">Name<input id="tmName"></label>
          <label class="fu-field">Email<input id="tmEmail" type="email"></label>
          <label class="fu-field">Temporary password<input id="tmPw" type="text" autocomplete="off" placeholder="12+ chars, Aa1"></label>
          <button type="button" class="btn-primary" id="tmAdd">Add admin</button>
        </div>
        <p class="svc-hint" style="margin-top:6px;">Share the temporary password with them in person or by phone, not email. Every sign-in also needs a code sent to their inbox.</p>` : ''}
      <div class="svc-label">Change your password</div>
      <div class="q-row-inline">
        <label class="fu-field">Current<input id="pwCur" type="password" autocomplete="current-password"></label>
        <label class="fu-field">New (12+ chars, Aa1)<input id="pwNew" type="password" autocomplete="new-password"></label>
        <button type="button" class="btn-outline" id="pwSave">Change password</button>
      </div>
      <p class="secure-msg" id="tmMsg" style="color:var(--red);font-size:13px;"></p>
    </div>`;
  const msg = (t) => { byId('tmMsg').textContent = t; };
  const v = (id) => byId(id).value;
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/team/${b.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: !b.dataset.active }) }); loadTeam(); } catch (e) { msg(e.message); }
  }));
  const add = byId('tmAdd');
  if (add) add.addEventListener('click', async () => {
    try {
      await api('/api/admin/team', { method: 'POST', body: JSON.stringify({ name: v('tmName'), email: v('tmEmail'), password: v('tmPw') }) });
      loadTeam();
    } catch (e) { msg(e.message); }
  });
  byId('pwSave').addEventListener('click', async () => {
    try {
      const r = await api('/api/admin/me/password', { method: 'POST', body: JSON.stringify({ current: v('pwCur'), next: v('pwNew') }) });
      alert(r.message);
      location.href = '/admin/login';
    } catch (e) { msg(e.message); }
  });
}

// =====================================================================
// The workspace (own tab)
// =====================================================================
const allowed = (s) => S.access.sections === null || S.access.sections.includes(s);
const itemsOf = (kinds) => S.items.filter((i) => kinds.includes(i.kind));

async function openWorkspace(id) {
  document.body.classList.add('ws-mode');
  try {
    S = await api(`/api/admin/workspaces/${id}`);
  } catch (err) {
    app.innerHTML = `<div style="padding:40px;"><p class="empty-state">${esc(err.message)}</p><p><a href="/admin/workspace">Back to workspaces</a></p></div>`;
    return;
  }
  document.title = `${S.workspace.ref} — Workspace`;
  section = SECTIONS.find((s) => allowed(s.key)).key;
  sessionStart = Date.now();
  renderWorkspace();
  startTimer();
}

function renderWorkspace() {
  const w = S.workspace;
  app.innerHTML = `
    <div class="ws-top">
      <img src="/brand/autowerke-it-logo-light.svg" alt="">
      <span class="ws-ref">${esc(w.ref)}</span><span class="ws-title">${esc(w.title || '')}</span>
      <span class="grow"></span>
      <span class="ws-chip" title="Time in this workspace">⏱ <strong id="wsClock">${clockText()}</strong> <span class="quip" id="wsQuip">${quipText()}</span></span>
      ${allowed('notes') ? '<button type="button" id="focusBtn">Focus</button>' : ''}
      ${S.access.owner ? '<button type="button" id="shareBtn">Share</button>' : ''}
      <button type="button" id="doneBtn">Finish</button>
    </div>
    <div class="ws-env ${w.environment ? '' : 'empty'}">
      <strong>${w.environment ? 'ENVIRONMENT' : 'SET THE ENVIRONMENT'}</strong>
      <input id="envInput" value="${attr(w.environment || '')}" placeholder="e.g. Tenant: tanner.onmicrosoft.com · Head office" ${S.access.owner ? '' : 'disabled'}>
      <span class="reg-sub" style="color:inherit;">so you never make a change in the wrong tenant</span>
    </div>
    <div class="ws-body">
      <nav class="ws-rail">${SECTIONS.map((s) => {
        const n = s.key === 'notes' ? '' : itemsOf(s.kinds).length || '';
        return `<a data-s="${s.key}" class="${s.key === section ? 'on' : ''} ${allowed(s.key) ? '' : 'locked'}" title="${allowed(s.key) ? '' : 'Not shared with you'}">${esc(s.label)}<span class="n">${allowed(s.key) ? n : '🔒'}</span></a>`;
      }).join('')}</nav>
      <main class="ws-main" id="wsMain"></main>
      <aside class="ws-side" id="wsSide"></aside>
    </div>
    <div class="fu-modal hidden" id="wsModal"></div>`;

  app.querySelectorAll('.ws-rail a').forEach((a) => a.addEventListener('click', () => {
    if (!allowed(a.dataset.s)) return;
    section = a.dataset.s;
    app.querySelectorAll('.ws-rail a').forEach((x) => x.classList.toggle('on', x === a));
    renderSection();
  }));
  const env = byId('envInput');
  env.addEventListener('change', async () => {
    await api(`/api/admin/workspaces/${w.id}`, { method: 'PATCH', body: JSON.stringify({ environment: env.value }) });
    w.environment = env.value.trim();
    env.closest('.ws-env').classList.toggle('empty', !w.environment);
    env.closest('.ws-env').querySelector('strong').textContent = w.environment ? 'ENVIRONMENT' : 'SET THE ENVIRONMENT';
  });
  byId('focusBtn')?.addEventListener('click', openFocus);
  byId('shareBtn')?.addEventListener('click', openShare);
  byId('doneBtn').addEventListener('click', finish);
  renderSection();
  renderSide();
}

async function showTrail() {
  const el = byId('wsTrail');
  el.textContent = 'Loading...';
  try {
    const t = await api(`/api/admin/trail/${S.workspace.request_id}`);
    el.innerHTML = t.trail.map((e) => `<div class="kv">${e.url ? `<a href="${attr(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}<br><span>${esc(e.when ? fmtDate(e.when) : '')}${e.detail ? ` · ${esc(e.detail)}` : ''}</span></div>`).join('');
  } catch (err) { el.textContent = err.message; }
}

function renderSide() {
  const r = S.request;
  const time = Object.entries(S.time || {});
  const h = (s) => `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
  byId('wsSide').innerHTML = `
    ${r ? `<h4>Request</h4>
      <div class="kv"><strong>${esc(r.company)}</strong></div>
      <div class="kv">${esc(r.type)} · ${esc(r.status)}</div>
      <div class="kv"><span>${esc(r.owner)}</span></div>
      <h4>Client contact</h4>
      <div class="kv">${esc(r.contact)}${r.position ? `, ${esc(r.position)}` : ''}</div>
      <div class="kv"><a href="mailto:${attr(r.email)}">${esc(r.email)}</a></div>
      ${r.phone ? `<div class="kv"><a href="tel:${attr(r.phone.replace(/[^+\d]/g, ''))}">${esc(r.phone)}</a></div>` : ''}
      ${r.details ? `<h4>What they asked for</h4><div class="kv" style="white-space:pre-wrap;max-height:180px;overflow:auto;">${esc(r.details)}</div>` : ''}` : ''}
    ${S.workspace.request_id ? '<h4>Document trail</h4><div id="wsTrail"><button type="button" class="link-btn" id="wsTrailBtn">Show every document, request to receipt</button></div>' : ''}
    <h4>Time logged here</h4>
    ${time.length ? time.map(([n, s]) => `<div class="kv">${esc(n)}: <strong>${h(s)}</strong></div>`).join('') : '<div class="kv"><span>This is the first session.</span></div>'}
    ${S.access.owner ? `<h4>Shared with</h4>${S.shares.length ? S.shares.map((x) => `<div class="kv">${esc(x.admin.name)} <span>· ${x.sections ? x.sections.join(', ') : 'everything'}</span></div>`).join('') : '<div class="kv"><span>Only you</span></div>'}` : `<h4>Access</h4><div class="kv"><span>${S.access.sections ? `Shared sections: ${S.access.sections.join(', ')}` : 'Full access (shared)'}</span></div>`}`;
}

// ---------- Sections ----------
document.addEventListener('click', (e) => { if (e.target && e.target.id === 'wsTrailBtn') showTrail(); });

function renderSection() {
  const main = byId('wsMain');
  const sec = SECTIONS.find((s) => s.key === section);
  if (section === 'notes') return renderNotes(main);
  const kinds = sec.kinds;
  const items = itemsOf(kinds);
  const addButtons = section === 'documents'
    ? '<button type="button" class="btn-primary" id="docAdd">+ Upload document</button>'
    : kinds.map((k) => `<button type="button" class="btn-outline" data-add="${k}">+ ${esc(TEMPLATES[k].label)}</button>`).join('');
  main.innerHTML = `
    <div class="ws-h"><h2>${esc(sec.label)}</h2><div class="ws-add">${addButtons}</div></div>
    ${section === 'logins' ? '<p class="svc-hint" style="margin:-6px 0 14px;">Record who holds each MFA and the recovery route, so the project never stalls when someone is away. Passwords and backup codes are encrypted.</p>' : ''}
    ${section === 'people' ? fromRequestBanner() : ''}
    <div class="ws-items">${items.length ? items.map(itemCard).join('') : '<p class="empty-state">Nothing here yet.</p>'}</div>`;
  main.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.add)));
  byId('addReqContact')?.addEventListener('click', addRequestContact);
  byId('docAdd')?.addEventListener('click', openUpload);
  main.querySelectorAll('.ws-item').forEach(wireItem);
}

// The request's client contact, if they aren't already in People (matched by email, else name)
function missingRequestContact() {
  const r = S.request;
  if (!r || (!r.contact && !r.email)) return null;
  const email = String(r.email || '').toLowerCase();
  const listed = itemsOf(['contact']).some((c) => (email && String((c.data || {}).email || '').toLowerCase() === email)
    || (!email && String(c.title || '').toLowerCase() === String(r.contact).toLowerCase()));
  return listed ? null : r;
}

function fromRequestBanner() {
  const r = missingRequestContact();
  if (!r) return '';
  return `<div class="ws-from-req"><span>👤</span><span class="grow"><strong>${esc(r.contact || r.email)}</strong>${r.position ? `, ${esc(r.position)}` : ''} is the client contact on this ${esc((r.type || 'request').toLowerCase())}.</span>
    <button type="button" class="btn-primary" id="addReqContact">+ Add from the request</button></div>`;
}

async function addRequestContact(e) {
  const r = S.request;
  e.target.disabled = true;
  try {
    const saved = await api(`/api/admin/workspaces/${S.workspace.id}/items`, { method: 'POST', body: JSON.stringify({
      kind: 'contact', title: r.contact || r.email,
      data: { role: r.position || '', company: r.company || '', email: r.email || '', phone: r.phone || '', notes: 'Client contact from the request', source: 'request' },
    }) });
    S.items.push(saved);
    renderWorkspace();
  } catch (err) {
    alert(err.message);
    e.target.disabled = false;
  }
}

function fieldRow(label, value) {
  return value ? `<div class="f"><span>${esc(label)}</span><span>${esc(value)}</span></div>` : '';
}

function itemCard(it) {
  const t = TEMPLATES[it.kind];
  const d = it.data || {};
  let body = '';
  let flag = false;
  let pills = '';

  if (it.kind === 'document') {
    const kb = d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB` : '';
    return `<div class="ws-item" data-id="${attr(it.id)}"><div class="k">Document</div><h3>${esc(d.name || it.title)}</h3>
      <div class="f"><span>About</span><span>${esc(d.description || '')}</span></div>
      <div class="f"><span>Size</span><span>${esc(kb)}</span></div>
      <div class="acts"><a href="${attr(d.url)}" target="_blank" rel="noopener">Open ↗</a><button type="button" data-act="edit-doc">Edit note</button><button type="button" data-act="del">Delete</button></div></div>`;
  }
  if (it.kind === 'checklist') {
    const items = d.items || [];
    const done = items.filter((x) => x.done).length;
    body = `<div class="ws-progress"><div style="width:${items.length ? (done / items.length) * 100 : 0}%"></div></div>
      <div class="reg-sub">${done} of ${items.length} done</div>
      <ul class="ws-check">${items.map((x, i) => `<li class="${x.done ? 'done' : ''}"><input type="checkbox" data-ci="${i}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}</span></li>`).join('')}</ul>`;
  } else {
    body = t.fields.filter((f) => !f.secret && f.type !== 'checkbox').map((f) => fieldRow(f.label, f.type === 'date' ? fmtDate(d[f.key]) : d[f.key])).join('');
    if (it.has_secret) body += '<div class="f secret"><span>Secrets</span><span class="sec-slot">•••••••• <button type="button" class="link-btn" data-act="reveal">Reveal</button></span></div>';
  }
  if (it.kind === 'login' && d.breakglass) pills += '<span class="ws-pill red">break-glass</span>';
  if (it.kind === 'login' && d.mfa_method && !d.mfa_holder && d.mfa_method !== 'None') { pills += '<span class="ws-pill amber">who holds MFA?</span>'; flag = true; }
  if (it.kind === 'access' && d.expires_on) {
    const left = daysUntil(d.expires_on);
    if (left < 0) { pills += '<span class="ws-pill red">expired</span>'; flag = true; } else if (left <= 7) { pills += `<span class="ws-pill amber">expires in ${left}d</span>`; flag = true; }
  }
  if (it.kind === 'waiting' && !d.resolved && d.since) pills += `<span class="ws-pill amber">${-daysUntil(d.since)}d waiting</span>`;
  if (it.kind === 'waiting' && d.resolved) pills += '<span class="ws-pill">resolved</span>';
  if (it.kind === 'scope' && d.in_scope === 'Out of scope') pills += '<span class="ws-pill red">out of scope</span>';
  if (it.kind === 'change' && d.result) pills += `<span class="ws-pill ${d.result === 'Rolled back' ? 'red' : ''}">${esc(d.result)}</span>`;

  const extra = it.kind === 'email'
    ? `<button type="button" data-act="copy">Copy</button><a href="mailto:${attr(d.to || '')}?subject=${encodeURIComponent(d.subject || '')}&body=${encodeURIComponent(d.body || '')}">Open in mail</a>`
    : '';
  return `<div class="ws-item ${flag ? 'flag' : ''}" data-id="${attr(it.id)}">
    <div class="k">${esc(t.label)}</div><h3>${esc(it.title || t.label)}${pills}</h3>${body}
    <div class="acts">${extra}<button type="button" data-act="edit">Edit</button><button type="button" data-act="del">Delete</button></div></div>`;
}

function wireItem(card) {
  const it = S.items.find((x) => x.id === card.dataset.id);
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    const ci = e.target.closest('[data-ci]');
    try {
      if (ci) { // tick a checklist item: saved straight away
        const items = it.data.items.map((x, i) => (i === Number(ci.dataset.ci) ? { ...x, done: ci.checked } : x));
        Object.assign(it, await api(`/api/admin/workspace-items/${it.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...it.data, items } }) }));
        return renderSection();
      }
      if (!b) return;
      if (b.dataset.act === 'edit') return openEditor(it.kind, it);
      if (b.dataset.act === 'edit-doc') {
        const description = prompt('Describe this document:', it.data.description || '');
        if (description === null) return;
        Object.assign(it, await api(`/api/admin/workspace-items/${it.id}`, { method: 'PATCH', body: JSON.stringify({ data: { description } }) }));
        return renderSection();
      }
      if (b.dataset.act === 'del') {
        if (!confirm(`Delete "${it.title || (TEMPLATES[it.kind] && TEMPLATES[it.kind].label) || 'this item'}"? This can't be undone.`)) return;
        await api(`/api/admin/workspace-items/${it.id}`, { method: 'DELETE' });
        S.items = S.items.filter((x) => x.id !== it.id);
        renderWorkspace();
        return;
      }
      if (b.dataset.act === 'copy') {
        await navigator.clipboard.writeText(`Subject: ${it.data.subject || ''}\n\n${it.data.body || ''}`);
        b.textContent = 'Copied ✓';
        return;
      }
      if (b.dataset.act === 'reveal') {
        const { secrets } = await api(`/api/admin/workspace-items/${it.id}/reveal`, { method: 'POST' });
        const t = TEMPLATES[it.kind];
        const slot = card.querySelector('.sec-slot');
        slot.innerHTML = Object.entries(secrets).map(([k, val]) => {
          const f = t.fields.find((x) => x.key === k);
          return `<div>${esc(f ? f.label : k)}: <code>${esc(val)}</code> <button type="button" class="link-btn" data-copy="${attr(val)}">Copy</button></div>`;
        }).join('') || '—';
        slot.querySelectorAll('[data-copy]').forEach((c) => c.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          await navigator.clipboard.writeText(c.dataset.copy);
          c.textContent = 'Copied';
        }));
        setTimeout(() => { if (slot.isConnected) renderSection(); }, 30000); // hide again after 30s
      }
    } catch (err) {
      alert(err.message);
    }
  });
}

// ---------- Notes canvas ----------
function renderNotes(main) {
  main.innerHTML = `
    <div class="ws-h"><h2>Notes canvas</h2></div>
    <div class="ws-canvas-tools">
      <button type="button" class="btn-outline" data-ins="stamp">+ Timestamp</button>
      <button type="button" class="btn-outline" data-ins="heading">+ Heading</button>
      <button type="button" class="btn-outline" data-ins="todo">+ To-do line</button>
      <button type="button" class="btn-outline" data-ins="decision">+ Decision</button>
      <span class="saved" id="savedAt">${S.workspace.updated_at ? `saved ${new Date(S.workspace.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
    </div>
    <textarea class="ws-canvas" id="canvas" spellcheck="true" placeholder="Document as you go: what you found, what you changed, what's next...">${esc(S.workspace.notes || '')}</textarea>`;
  const ta = byId('canvas');
  ta.addEventListener('input', () => queueSave(ta.value));
  main.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => {
    const now = new Date();
    const snippets = {
      stamp: `\n— ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} —\n`,
      heading: '\n\n## ',
      todo: '\n[ ] ',
      decision: '\nDECISION: ',
    };
    insertAt(ta, snippets[b.dataset.ins]);
    queueSave(ta.value);
  }));
}

function insertAt(ta, text) {
  const s = ta.selectionStart;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus();
}

function queueSave(value) {
  S.workspace.notes = value;
  const el = byId('savedAt');
  if (el) el.textContent = 'saving...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api(`/api/admin/workspaces/${S.workspace.id}`, { method: 'PATCH', body: JSON.stringify({ notes: S.workspace.notes }) });
      const t = `saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      document.querySelectorAll('#savedAt, #focusSaved').forEach((x) => { x.textContent = t; });
    } catch (err) {
      document.querySelectorAll('#savedAt, #focusSaved').forEach((x) => { x.textContent = `not saved: ${err.message}`; });
    }
  }, 900);
}

function openFocus() {
  const el = document.createElement('div');
  el.className = 'ws-focus';
  el.innerHTML = `<div class="bar"><span>${esc(S.workspace.ref)} · focus mode · Esc to leave</span><span id="focusSaved">saved</span></div><textarea id="focusTa">${esc(S.workspace.notes || '')}</textarea>`;
  document.body.appendChild(el);
  const ta = byId('focusTa');
  ta.focus();
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  ta.addEventListener('input', () => queueSave(ta.value));
  const close = (e) => {
    if (e.key !== 'Escape') return;
    el.remove();
    document.removeEventListener('keydown', close);
    if (section === 'notes') renderSection();
  };
  document.addEventListener('keydown', close);
}

// ---------- Editor ----------
function fill(text) {
  const r = S.request || {};
  return String(text).replace(/{{ref}}/g, S.workspace.ref).replace(/{{title}}/g, S.workspace.title || 'the work').replace(/{{first}}/g, (r.contact || '').split(' ')[0] || 'there');
}

function openEditor(kind, existing) {
  const t = TEMPLATES[kind];
  const d = existing ? existing.data || {} : {};
  const modal = byId('wsModal');
  const input = (f) => {
    const val = d[f.key] ?? '';
    const ph = f.placeholder ? ` placeholder="${attr(f.placeholder)}"` : '';
    if (f.type === 'textarea') return `<label class="fu-field wide">${esc(f.label)}<textarea name="${f.key}" rows="${f.rows || 4}"${ph}>${esc(val)}</textarea></label>`;
    if (f.type === 'select') return `<label class="fu-field">${esc(f.label)}<select name="${f.key}">${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.type === 'checkbox') return `<label class="fu-toggle wide"><input type="checkbox" name="${f.key}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
    if (f.secret) {
      const stored = existing && existing.has_secret;
      return `<label class="fu-field">${esc(f.label)} 🔒<input type="password" name="${f.key}" autocomplete="new-password" placeholder="${stored ? 'stored - leave blank to keep' : 'encrypted when saved'}"></label>`;
    }
    return `<label class="fu-field">${esc(f.label)}<input type="${f.type}" name="${f.key}" value="${attr(val)}"${ph}></label>`;
  };
  const presets = kind === 'checklist'
    ? `<label class="fu-field wide">Start from a template<select id="preset"><option value="">Blank checklist</option>${Object.keys(CHECKLISTS).map((k) => `<option>${esc(k)}</option>`).join('')}${(S.request && S.request.phases.length) ? '<option value="__phases">Project delivery phases</option>' : ''}</select></label>`
    : kind === 'email' && !existing
      ? `<label class="fu-field wide">Start from a template<select id="preset"><option value="">Blank email</option>${Object.keys(EMAILS).map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>`
      : kind === 'contact' && !existing && S.request ? '<button type="button" class="link-btn wide" id="fromReq" style="text-align:left;">Fill in from the request contact</button>' : '';

  modal.innerHTML = `
    <div class="fu-dialog ws-form" role="dialog" aria-modal="true">
      <div class="fu-dialog-head"><h2>${existing ? 'Edit' : 'New'} · ${esc(t.label)}</h2><div>${esc(S.workspace.ref)}</div></div>
      <form class="fu-dialog-body" id="edForm" novalidate>
        <div class="fu-grid">
          ${presets}
          <label class="fu-field wide">${esc(t.titleLabel)}<input name="__title" value="${attr(existing ? existing.title || '' : '')}" placeholder="${attr(t.placeholder || '')}"></label>
          ${t.fields.map(input).join('')}
          ${kind === 'checklist' ? '<div class="wide" id="ckList"></div><button type="button" class="link-btn wide" id="ckAdd" style="text-align:left;">+ Add item</button>' : ''}
        </div>
      </form>
      <div class="fu-dialog-foot">
        <button type="button" class="link-btn" id="edCancel">Cancel</button>
        <button type="button" class="btn-primary" id="edSave">${existing ? 'Save' : 'Add'}</button>
      </div>
    </div>`;
  modal.classList.remove('hidden');
  const form = byId('edForm');
  const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
  byId('edCancel').addEventListener('click', close);

  // Checklist editor
  let ck = kind === 'checklist' ? (d.items || []).map((x) => ({ ...x })) : [];
  const drawCk = () => {
    const el = byId('ckList');
    if (!el) return;
    el.innerHTML = ck.map((x, i) => `<div class="ws-check-edit"><input type="checkbox" data-d="${i}" ${x.done ? 'checked' : ''}><input type="text" data-t="${i}" value="${attr(x.text)}"><button type="button" class="link-btn" data-r="${i}">✕</button></div>`).join('');
    el.querySelectorAll('[data-t]').forEach((n) => n.addEventListener('input', () => { ck[n.dataset.t].text = n.value; }));
    el.querySelectorAll('[data-d]').forEach((n) => n.addEventListener('change', () => { ck[n.dataset.d].done = n.checked; }));
    el.querySelectorAll('[data-r]').forEach((n) => n.addEventListener('click', () => { ck.splice(Number(n.dataset.r), 1); drawCk(); }));
  };
  drawCk();
  byId('ckAdd')?.addEventListener('click', () => { ck.push({ text: '', done: false }); drawCk(); });

  byId('preset')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (kind === 'checklist') {
      if (val === '__phases') { ck = S.request.phases.map((p) => ({ text: p.title, done: p.done })); form.__title.value ||= 'Delivery phases'; }
      else if (CHECKLISTS[val]) { ck = CHECKLISTS[val].map((text) => ({ text, done: false })); form.__title.value ||= val; }
      drawCk();
    } else if (EMAILS[val]) {
      form.__title.value ||= val;
      form.to.value ||= (S.request && S.request.email) || '';
      form.subject.value = fill(EMAILS[val].subject);
      form.body.value = fill(EMAILS[val].body);
    }
  });
  byId('fromReq')?.addEventListener('click', () => {
    const r = S.request;
    form.__title.value = r.contact; form.role.value = r.position || ''; form.company.value = r.company || '';
    form.email.value = r.email || ''; form.phone.value = r.phone || '';
  });

  byId('edSave').addEventListener('click', async (e) => {
    const data = {};
    const secrets = {};
    t.fields.forEach((f) => {
      const el = form[f.key];
      if (!el) return;
      if (f.secret) { if (el.value) secrets[f.key] = el.value; return; }
      data[f.key] = f.type === 'checkbox' ? el.checked : el.value;
    });
    if (kind === 'checklist') data.items = ck.filter((x) => x.text.trim());
    const body = { kind, title: form.__title.value, data, secrets };
    e.target.disabled = true;
    try {
      const saved = existing
        ? await api(`/api/admin/workspace-items/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api(`/api/admin/workspaces/${S.workspace.id}/items`, { method: 'POST', body: JSON.stringify(body) });
      form.querySelectorAll('input[type=password]').forEach((x) => { x.value = ''; });
      if (existing) Object.assign(existing, saved); else S.items.push(saved);
      close();
      renderWorkspace();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
    }
  });
}

function openUpload() {
  const modal = byId('wsModal');
  modal.innerHTML = `
    <div class="fu-dialog ws-form" role="dialog" aria-modal="true">
      <div class="fu-dialog-head"><h2>Upload document</h2><div>${esc(S.workspace.ref)} · PDF, Word, Excel, PowerPoint, Visio, CSV, text or images · 15 MB max</div></div>
      <div class="fu-dialog-body">
        <label class="fu-field">File<input type="file" id="upFile" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.vsd,.vsdx,.csv,.txt,.png,.jpg,.jpeg"></label>
        <label class="fu-field">What is it?<textarea id="upDesc" rows="3" placeholder="e.g. Network diagram from the client's previous provider (may be outdated)"></textarea></label>
      </div>
      <div class="fu-dialog-foot"><button type="button" class="link-btn" id="upCancel">Cancel</button><button type="button" class="btn-primary" id="upGo">Upload</button></div>
    </div>`;
  modal.classList.remove('hidden');
  const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
  byId('upCancel').addEventListener('click', close);
  byId('upGo').addEventListener('click', async (e) => {
    const f = byId('upFile').files[0];
    if (!f) return alert('Choose a file.');
    const fd = new FormData();
    fd.append('file', f);
    fd.append('description', byId('upDesc').value);
    e.target.disabled = true;
    e.target.textContent = 'Uploading...';
    try {
      S.items.push(await api(`/api/admin/workspaces/${S.workspace.id}/documents`, { method: 'POST', body: fd }));
      close();
      renderWorkspace();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Upload';
    }
  });
}

// ---------- Sharing ----------
async function openShare() {
  const { team } = await api('/api/admin/team');
  const others = team.filter((a) => a.active && a.id !== S.me.id);
  const modal = byId('wsModal');
  modal.innerHTML = `
    <div class="fu-dialog" role="dialog" aria-modal="true">
      <div class="fu-dialog-head"><h2>Share workspace</h2><div>${esc(S.workspace.ref)} · colleagues still sign in with their own password + code</div></div>
      <div class="fu-dialog-body">
        ${others.length ? `
          <label class="fu-field">Colleague<select id="shWho">${others.map((a) => `<option value="${attr(a.email)}">${esc(a.name)} (${esc(a.email)})</option>`).join('')}</select></label>
          <div class="mode-row"><label><input type="radio" name="shScope" value="all" checked> Everything</label><label><input type="radio" name="shScope" value="some"> Only these sections:</label></div>
          <div class="slot-pick" id="shSections" style="display:none;">${SECTIONS.map((s) => `<label><input type="checkbox" value="${s.key}"> ${esc(s.label)}</label>`).join('')}</div>`
          : '<p class="empty-state">No other active admins yet. Add colleagues under Workspace → Team.</p>'}
        ${S.shares.length ? `<div class="svc-label">Currently shared with</div>${S.shares.map((x) => `<div class="done-list"><div class="row"><span>${esc(x.admin.name)} · ${x.sections ? esc(x.sections.join(', ')) : 'everything'}</span><button type="button" class="link-btn" data-unshare="${attr(x.id)}">Remove</button></div></div>`).join('')}` : ''}
      </div>
      <div class="fu-dialog-foot"><button type="button" class="link-btn" id="shClose">Close</button>${others.length ? '<button type="button" class="btn-primary" id="shGo">Share</button>' : ''}</div>
    </div>`;
  modal.classList.remove('hidden');
  const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
  byId('shClose').addEventListener('click', close);
  modal.querySelectorAll('input[name=shScope]').forEach((r) => r.addEventListener('change', () => {
    byId('shSections').style.display = r.value === 'some' && r.checked ? '' : 'none';
  }));
  modal.querySelectorAll('[data-unshare]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/admin/workspaces/${S.workspace.id}/shares/${b.dataset.unshare}`, { method: 'DELETE' });
    S.shares = S.shares.filter((x) => x.id !== b.dataset.unshare);
    close(); renderSide(); openShare();
  }));
  byId('shGo')?.addEventListener('click', async () => {
    const some = modal.querySelector('input[name=shScope]:checked').value === 'some';
    const sections = some ? [...modal.querySelectorAll('#shSections input:checked')].map((x) => x.value) : null;
    if (some && !sections.length) return alert('Pick at least one section.');
    try {
      const share = await api(`/api/admin/workspaces/${S.workspace.id}/shares`, { method: 'POST', body: JSON.stringify({ email: byId('shWho').value, sections }) });
      S.shares = S.shares.filter((x) => x.admin.id !== share.admin.id).concat(share);
      close(); renderSide();
    } catch (err) { alert(err.message); }
  });
}

// ---------- Timer + idle ----------
const QUIPS = [[0, 'on the clock'], [10, 'warming up'], [25, 'in the zone 🔍'], [45, 'deep in it'], [60, 'hydrate! 💧'], [90, 'stretch break? 🧘'], [120, 'legend status ☕']];

// Shared by the tick and by every redraw, so the clock never flickers back to 00:00
const elapsedS = () => Math.floor((Date.now() - sessionStart) / 1000);
function clockText() {
  const s = elapsedS();
  const pad = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
const quipText = () => QUIPS.filter(([m]) => elapsedS() / 60 >= m).pop()[1];

async function startTimer() {
  try { timeSegment = (await api(`/api/admin/workspaces/${S.workspace.id}/time/start`, { method: 'POST' })).id; } catch { timeSegment = null; }
  clearInterval(timerId);
  let beats = 0;
  timerId = setInterval(() => {
    const clock = byId('wsClock');
    if (clock) clock.textContent = clockText();
    const q = byId('wsQuip');
    if (q) q.textContent = quipText();
    if (++beats % 60 === 0 && timeSegment) api(`/api/admin/workspace-time/${timeSegment}/beat`, { method: 'POST' }).catch(() => {});
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  if (timeSegment) navigator.sendBeacon(`/api/admin/workspace-time/${timeSegment}/end`);
  timeSegment = null;
}

function finish() {
  stopTimer();
  window.close();
  location.href = '/admin/workspace'; // if the tab can't close itself
}

function startIdleWatch() {
  // "Still there?" after 20 minutes idle; paused + signed out 2 minutes later
  const IDLE_MS = 20 * 60 * 1000;
  let last = Date.now();
  let prompting = false;
  ['mousemove', 'keydown', 'click', 'scroll'].forEach((ev) => window.addEventListener(ev, () => { if (!prompting) last = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (prompting || Date.now() - last < IDLE_MS) return;
    prompting = true;
    let left = 120;
    const el = document.createElement('div');
    el.className = 'idle-overlay';
    el.innerHTML = `<div class="idle-card" role="alertdialog"><div class="idle-emoji">☕</div><h2>Still there?</h2>
      <p>Your workspace timer is still running. For security we'll pause it and sign you out in <strong id="wsIdleLeft">120</strong> seconds.</p>
      <button type="button" class="btn-primary" id="wsStay">I'm here, keep going</button></div>`;
    document.body.appendChild(el);
    const iv = setInterval(async () => {
      left -= 1;
      const n = byId('wsIdleLeft');
      if (n) n.textContent = left;
      if (left <= 0) {
        clearInterval(iv);
        stopTimer();
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        location.href = `/admin/login?next=${encodeURIComponent(location.pathname)}`;
      }
    }, 1000);
    byId('wsStay').addEventListener('click', () => { clearInterval(iv); el.remove(); prompting = false; last = Date.now(); fetch('/api/auth/me'); });
  }, 15000);
}

// ---------- Start ----------
if (wsId) {
  window.addEventListener('pagehide', stopTimer);
  startIdleWatch();
  openWorkspace(wsId);
} else {
  // The launcher sits inside the normal admin layout
  const s = document.createElement('script');
  s.src = '/admin-shell.js';
  s.onload = renderLauncher;
  document.body.appendChild(s);
}
