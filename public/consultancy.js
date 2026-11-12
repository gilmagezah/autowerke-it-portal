const appEl = document.getElementById('app');
let items = [];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PLATFORM = { teams: 'Microsoft Teams', zoom: 'Zoom' };

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function load() {
  try {
    items = (await api('/api/admin/consultancy')).items;
    render();
  } catch (err) {
    appEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

function render() {
  const by = (s) => items.filter((x) => s.includes(x.status));
  const fresh = by(['consult_requested']);
  const toConfirm = by(['consult_meeting_requested']);
  const waiting = by(['consult_meeting_invited']);
  const upcoming = by(['consult_meeting_confirmed']);
  const done = by(['consult_answered', 'consult_closed']);

  if (window.setBandStats) {
    window.setBandStats([
      { label: 'Needs your reply', value: String(fresh.length) },
      { label: 'Meetings to confirm', value: String(toConfirm.length) },
      { label: 'Upcoming meetings', value: String(upcoming.length) },
    ]);
  }
  if (window.setNavCount) window.setNavCount('consultancy', fresh.length + toConfirm.length);

  appEl.innerHTML = `
    <div class="svc-section"><h2>Needs your reply</h2><span class="count">${fresh.length}</span></div>
    ${fresh.length ? fresh.map(replyCard).join('') : '<p class="empty-state">No new consultancy requests.</p>'}

    <div class="svc-section"><h2>Meetings to confirm</h2><span class="count">${toConfirm.length}</span></div>
    ${toConfirm.length ? toConfirm.map(confirmCard).join('') : '<p class="empty-state">Nothing to confirm.</p>'}

    ${upcoming.length ? `<div class="svc-section"><h2>Upcoming meetings</h2><span class="count">${upcoming.length}</span></div>${upcoming.map(upcomingCard).join('')}` : ''}

    ${waiting.length ? `<div class="svc-section"><h2>Waiting on the client</h2><span class="count">${waiting.length}</span></div>
      <div class="done-list">${waiting.map((x) => `<div class="row"><span><strong>${esc(x.company_name)}</strong> · ${esc(x.project_title || '')}</span><span>Invited ${esc(shortDate(x.updated_at))} · choosing a time</span></div>`).join('')}</div>` : ''}

    ${done.length ? `<div class="svc-section"><h2>Done</h2><span class="count">${done.length}</span></div>
      <div class="done-list">${done.slice(0, 30).map((x) => `<div class="row"><span><strong>${esc(x.company_name)}</strong> · ${esc(x.project_title || '')}</span><span>${x.status === 'consult_answered' ? 'Advice sent' : 'Meeting done'} · ${esc(shortDate(x.updated_at))}</span></div>`).join('')}</div>` : ''}
  `;
}

function head(x, pill) {
  return `
    <div class="svc-head">
      <div>
        <div class="svc-title">${esc(x.project_title || 'Consultancy request')}</div>
        <div class="svc-meta">${esc(x.company_name)} · ${esc([x.name, x.surname].filter(Boolean).join(' '))}${x.position ? `, ${esc(x.position)}` : ''} · ${esc(x.email)}</div>
        <div class="svc-meta">${esc(x.project_id)} · received ${esc(shortDate(x.created_at))}</div>
      </div>
      ${pill}
    </div>`;
}

function replyCard(x) {
  return `
    <div class="svc-card" data-id="${attr(x.id)}">
      ${head(x, '<span class="svc-pill red">Needs reply</span>')}
      <div class="svc-label">Their challenge</div>
      <div class="svc-box preserve-lines">${esc(x.details)}</div>
      <div class="svc-label">Your response <span style="text-transform:none;letter-spacing:0;font-weight:400;">(AI draft - edit freely)</span></div>
      <textarea class="draft-input" rows="14">${esc(x.consult_draft || '')}</textarea>
      <div class="mode-row">
        <label><input type="radio" name="mode-${attr(x.id)}" value="advice" checked> Send as advice</label>
        <label><input type="radio" name="mode-${attr(x.id)}" value="meeting"> Invite to a discovery meeting</label>
      </div>
      <div class="svc-hint" style="margin-top:6px;">A meeting invitation adds a button letting them choose Teams, Zoom or a call, add colleagues, and suggest weekday times.</div>
      <div class="q-row-inline">
        <label class="fu-field">Fee, excl. VAT ($)<input type="number" min="0" step="0.01" class="c-fee" placeholder="0 = free"></label>
        <span class="svc-hint" style="padding-bottom:8px;">Leave at 0 for free advice. The email tells them either way.</span>
      </div>
      <div class="svc-actions">
        <button type="button" class="btn-primary" data-act="send">Send response</button>
        <button type="button" class="btn-outline" data-act="redraft">Redraft with AI</button>
      </div>
    </div>`;
}

function fmtDay(d) { const [y, m, dd] = d.split('-').map(Number); return `${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]} ${dd} ${MON[m - 1]}`; }

function confirmCard(x) {
  const m = x.consult_meeting || {};
  const how = m.type === 'online'
    ? `${PLATFORM[m.platform] || ''} meeting${(m.recipients || []).length ? ` · also inviting ${esc(m.recipients.join(', '))}` : ''}`
    : `Discovery call to ${esc(m.phone || '')}`;
  return `
    <div class="svc-card" data-id="${attr(x.id)}">
      ${head(x, '<span class="svc-pill amber">Pick a time</span>')}
      <div class="svc-box"><strong>${how}</strong><br><span class="svc-meta">Their times (${esc(m.timezone || '')})</span>${m.note ? `<br><br><span class="preserve-lines">${esc(m.note)}</span>` : ''}</div>
      <div class="slot-pick">
        ${(m.slots || []).map((s, i) => `<label><input type="radio" name="slot-${attr(x.id)}" value="${i}" data-from="${attr(s.from)}" ${i === 0 ? 'checked' : ''}> ${esc(fmtDay(s.date))} · free ${esc(s.from)}–${esc(s.to)}</label>`).join('')}
      </div>
      <div class="q-row-inline">
        <label class="fu-field">Start time<input type="time" class="c-start" value="${attr((m.slots && m.slots[0] && m.slots[0].from) || '09:00')}"></label>
        <label class="fu-field">Length<select class="c-duration"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option></select></label>
        ${m.type === 'online' ? `<label class="fu-field" style="flex:1;min-width:240px;">${esc(PLATFORM[m.platform] || '')} meeting link<input type="url" class="c-link" placeholder="https://..."></label>` : ''}
      </div>
      <label class="fu-field" style="margin-top:10px;">Message (optional)<textarea class="c-message" rows="2" placeholder="e.g. Please have your current licence list handy."></textarea></label>
      <div class="svc-actions">
        <button type="button" class="btn-primary" data-act="confirm">Confirm &amp; send calendar invite</button>
        <span class="svc-hint">Times are in the client's timezone (${esc(m.timezone || '')}).</span>
      </div>
    </div>`;
}

function upcomingCard(x) {
  const c = x.consult_confirmed || {};
  return `
    <div class="svc-card" data-id="${attr(x.id)}">
      ${head(x, '<span class="svc-pill solid">Confirmed</span>')}
      <div class="svc-box" style="font-family:var(--mono);">
        <strong>${esc(c.date ? fmtDay(c.date) : '')}</strong> · ${esc(c.start || '')}–${esc(c.end || '')} (${esc(c.timezone || '')})<br>
        ${c.type === 'online' ? `${esc(PLATFORM[c.platform] || '')} · <a href="${attr(c.link || '#')}" target="_blank" rel="noopener">join link</a>` : `Call ${esc(c.phone || '')}`}
        ${(c.recipients || []).length ? `<br>Also invited: ${esc(c.recipients.join(', '))}` : ''}
      </div>
      <div class="svc-actions"><button type="button" class="btn-outline" data-act="close">Mark done</button></div>
    </div>`;
}

appEl.addEventListener('change', (e) => {
  // Picking a slot moves the start time to that window's start
  if (e.target.name && e.target.name.startsWith('slot-')) {
    e.target.closest('.svc-card').querySelector('.c-start').value = e.target.dataset.from;
  }
});

appEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.svc-card');
  const x = items.find((i) => i.id === card.dataset.id);
  const act = btn.dataset.act;
  const busy = (label) => { const old = btn.textContent; btn.disabled = true; btn.textContent = label; return () => { btn.disabled = false; btn.textContent = old; }; };

  try {
    if (act === 'redraft') {
      if (!confirm('Replace the current text with a fresh AI draft?')) return;
      const done = busy('Drafting...');
      try { card.querySelector('.draft-input').value = (await api(`/api/admin/consultancy/${x.id}/redraft`, { method: 'POST' })).draft; } finally { done(); }
      return;
    }
    if (act === 'send') {
      const body = card.querySelector('.draft-input').value.trim();
      const invite = card.querySelector(`input[name="mode-${x.id}"]:checked`).value === 'meeting';
      if (!confirm(invite ? `Send this and invite ${x.email} to a discovery meeting?` : `Send this advice to ${x.email}?`)) return;
      busy('Sending...');
      const fee = card.querySelector('.c-fee').value;
      await api(`/api/admin/consultancy/${x.id}/respond`, { method: 'POST', body: JSON.stringify({ body, invite_meeting: invite, fee }) });
      return load();
    }
    if (act === 'confirm') {
      const slot = card.querySelector(`input[name="slot-${x.id}"]:checked`);
      const payload = {
        slot_index: Number(slot.value),
        start: card.querySelector('.c-start').value,
        duration: Number(card.querySelector('.c-duration').value),
        link: (card.querySelector('.c-link') || {}).value || '',
        message: card.querySelector('.c-message').value,
      };
      const done = busy('Sending...');
      try { await api(`/api/admin/consultancy/${x.id}/confirm`, { method: 'POST', body: JSON.stringify(payload) }); } catch (err) { done(); throw err; }
      return load();
    }
    if (act === 'close') {
      await api(`/api/admin/consultancy/${x.id}/close`, { method: 'POST' });
      return load();
    }
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

function shortDate(ts) { if (!ts) return ''; const d = new Date(ts); return `${d.getDate()} ${MON[d.getMonth()]}`; }
function esc(str = '') { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function attr(str = '') { return esc(str).replace(/"/g, '&quot;'); }

load();
