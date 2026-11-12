const rowsEl = document.getElementById('fuRows');
const footEl = document.getElementById('fuFoot');
const editorEl = document.getElementById('fuEditor');
const modalEl = document.getElementById('fuModal');
const searchEl = document.getElementById('fuSearch');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let items = [];
let sources = null; // loaded lazily when the editor opens
let timeZone = 'Africa/Harare';
let filter = 'open';

// ---------- Data ----------

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function load() {
  try {
    const data = await api('/api/admin/follow-ups');
    items = data.items;
    timeZone = data.timeZone || timeZone;
    render();
  } catch (err) {
    rowsEl.innerHTML = `<p class="empty-state" style="padding:24px;">${esc(err.message)}</p>`;
  }
}

function upsert(item) {
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = item; else items.push(item);
}

// ---------- Rendering ----------

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const visible = items
    .filter((f) => filter === 'all' || f.status === filter)
    .filter((f) => !q || [f.company_name, f.project_ref, f.email, f.notes, f.contact_name].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.status === 'paid') - (b.status === 'paid') || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));

  rowsEl.innerHTML = visible.length
    ? visible.map(rowHtml).join('')
    : `<p class="empty-state" style="padding:28px 18px;">${items.length ? 'Nothing matches.' : 'No follow-ups yet. Click “New follow-up” to add a payment to chase.'}</p>`;

  // Totals (always across all open items, not just the filtered view)
  const open = items.filter((f) => f.status === 'open');
  const overdue = open.filter((f) => f.days_overdue > 0);
  const sum = (arr) => arr.reduce((s, f) => s + Number(f.amount || 0), 0);
  const monthKey = new Date().toISOString().slice(0, 7);
  const paidThisMonth = items.filter((f) => f.status === 'paid' && (f.paid_at || '').slice(0, 7) === monthKey);

  footEl.innerHTML = `<span>${items.length} follow-up${items.length === 1 ? '' : 's'} · ${open.length} open</span><span>Outstanding ${money(sum(open))}</span>`;
  if (window.setBandStats) {
    window.setBandStats([
      { label: 'Outstanding', value: money(sum(open)), sub: `${open.length} open` },
      { label: 'Overdue', value: money(sum(overdue)), sub: `${overdue.length} payment${overdue.length === 1 ? '' : 's'}` },
      { label: 'Paid this month', value: money(sum(paidThisMonth)), sub: `${paidThisMonth.length} received` },
    ]);
  }
  if (window.setNavCount) window.setNavCount('followups', overdue.length);
}

function rowHtml(f) {
  const paid = f.status === 'paid';
  let flag = '';
  if (!paid && f.due_date) {
    if (f.days_overdue > 0) flag = `<div class="fu-flag overdue">${f.days_overdue} day${f.days_overdue === 1 ? '' : 's'} overdue</div>`;
    else if (f.days_overdue === 0) flag = '<div class="fu-flag today">Due today</div>';
    else flag = '<div class="fu-flag upcoming">Upcoming</div>';
  }
  if (paid) flag = `<div class="fu-flag upcoming">Paid ${esc(shortDate(f.paid_at))}</div>`;

  const sent = f.followups_sent
    ? `<span class="fu-sent">${f.followups_sent} follow-up${f.followups_sent === 1 ? '' : 's'} sent</span> · last ${esc(shortDate(f.last_followup_at))}`
    : 'No follow-up sent yet';
  const note = [f.contact_name, f.notes].filter(Boolean).join(' · ');

  const reminder = !f.reminder_enabled || paid
    ? `<div class="fu-rem off">${paid ? '—' : 'Reminders off'}</div>`
    : `<div class="fu-rem">${f.reminder_frequency === 'daily' ? 'Daily' : `Weekly · ${DAYS[f.reminder_weekday].slice(0, 3)}`} ${esc(f.reminder_time)}
         <div class="fu-next">next ${esc(fmtInstant(f.next_reminder_at))}</div></div>`;

  return `
    <div class="fu-row ${paid ? 'paid' : ''}" data-id="${attr(f.id)}">
      <div><div class="fu-date">${f.due_date ? esc(dueLabel(f.due_date)) : '—'}</div>${flag}</div>
      <div class="fu-ref">${esc(f.project_ref || '—')}</div>
      <div>
        <div class="fu-company">${esc(f.company_name)}</div>
        <div class="fu-note">${note ? `${esc(note)}<br>` : ''}${sent}</div>
      </div>
      ${reminder}
      <div class="fu-check">${paid ? '✓' : '<span class="dot">·</span>'}</div>
      <div class="fu-amount">${money(f.amount)}</div>
      <div class="fu-actions">
        ${paid
          ? '<button type="button" data-act="reopen">Reopen</button>'
          : `<button type="button" class="primary" data-act="email">Follow up</button>
             <button type="button" data-act="paid">Paid</button>`}
        <button type="button" data-act="edit">Edit</button>
        <button type="button" data-act="delete" title="Delete">✕</button>
      </div>
    </div>`;
}

// ---------- Row actions ----------

rowsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.fu-row').dataset.id;
  const f = items.find((x) => x.id === id);
  const act = btn.dataset.act;

  try {
    if (act === 'email') return openComposer(f);
    if (act === 'edit') return openEditor(f);
    if (act === 'paid') {
      if (!confirm(`Mark ${money(f.amount)} from ${f.company_name} as paid? Reminders for it will stop.`)) return;
      upsert(await api(`/api/admin/follow-ups/${id}/paid`, { method: 'POST' }));
    }
    if (act === 'reopen') upsert(await api(`/api/admin/follow-ups/${id}/reopen`, { method: 'POST' }));
    if (act === 'delete') {
      if (!confirm(`Delete the follow-up for ${f.company_name}? This can't be undone.`)) return;
      await api(`/api/admin/follow-ups/${id}`, { method: 'DELETE' });
      items = items.filter((x) => x.id !== id);
    }
    render();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('fuFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  filter = btn.dataset.value;
  document.querySelectorAll('#fuFilter button').forEach((b) => b.classList.toggle('on', b === btn));
  render();
});

searchEl.addEventListener('input', render);
document.getElementById('fuNew').addEventListener('click', () => openEditor(null));

// ---------- Add / edit ----------

async function openEditor(f) {
  const isNew = !f;
  const v = f || { reminder_enabled: true, reminder_frequency: 'weekly', reminder_weekday: 1, reminder_time: '08:00' };

  editorEl.innerHTML = `
    <form class="fu-editor" id="fuForm" novalidate>
      <h2>${isNew ? 'New follow-up' : `Edit · ${esc(f.company_name)}`}</h2>
      ${isNew ? `
        <div class="fu-source">
          <label class="fu-field">Start from existing work (optional)
            <select id="fuSource"><option value="">Loading your projects and tickets...</option></select>
          </label>
        </div>` : ''}
      <div class="fu-grid">
        <label class="fu-field two">Company<input name="company_name" value="${attr(v.company_name || '')}" required></label>
        <label class="fu-field">Reference<input name="project_ref" value="${attr(v.project_ref || '')}" placeholder="e.g. TANNER-5422"></label>
        <label class="fu-field">Contact name<input name="contact_name" value="${attr(v.contact_name || '')}"></label>
        <label class="fu-field two">Company email (follow-ups go here)<input type="email" name="email" value="${attr(v.email || '')}" required></label>
        <label class="fu-field">Amount due ($)<input type="number" step="0.01" min="0" name="amount" value="${attr(v.amount ?? '')}" required></label>
        <label class="fu-field">Due date<input type="date" name="due_date" value="${attr(v.due_date || '')}"></label>
        <label class="fu-field">&nbsp;<span></span></label>
        <label class="fu-field wide">Notes (internal)<input name="notes" value="${attr(v.notes || '')}" placeholder="e.g. Invoice INV-104, promised payment by month end"></label>
      </div>
      <div class="fu-reminder">
        <div class="fu-reminder-row">
          <label class="fu-toggle"><input type="checkbox" name="reminder_enabled" ${v.reminder_enabled ? 'checked' : ''}> Remind me about this payment</label>
          <label class="fu-field">How often
            <select name="reminder_frequency">
              <option value="weekly" ${v.reminder_frequency !== 'daily' ? 'selected' : ''}>Weekly</option>
              <option value="daily" ${v.reminder_frequency === 'daily' ? 'selected' : ''}>Daily</option>
            </select>
          </label>
          <label class="fu-field fu-weekday">On
            <select name="reminder_weekday">${DAYS.map((d, i) => `<option value="${i}" ${Number(v.reminder_weekday) === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
          </label>
          <label class="fu-field">At<input type="time" name="reminder_time" value="${attr(v.reminder_time || '08:00')}"></label>
        </div>
        <div class="fu-hint">Reminders are emailed to you (not the client) at this time, ${esc(timeZone)} time, until the payment is marked paid.</div>
      </div>
      <div class="fu-editor-actions">
        <button type="submit" class="btn-primary">${isNew ? 'Add follow-up' : 'Save changes'}</button>
        <button type="button" class="link-btn" id="fuCancel">Cancel</button>
        ${!isNew ? '<button type="button" class="btn-outline" id="fuTestReminder" style="margin-left:auto;">Send me a test reminder</button>' : ''}
      </div>
    </form>`;

  const form = document.getElementById('fuForm');
  const syncWeekday = () => {
    form.querySelector('.fu-weekday').style.display = form.reminder_frequency.value === 'weekly' ? '' : 'none';
    form.querySelectorAll('.fu-reminder select, .fu-reminder input[type=time]')
      .forEach((el) => { el.disabled = !form.reminder_enabled.checked; });
  };
  form.reminder_frequency.addEventListener('change', syncWeekday);
  form.reminder_enabled.addEventListener('change', syncWeekday);
  syncWeekday();

  document.getElementById('fuCancel').addEventListener('click', () => { editorEl.innerHTML = ''; });
  form.addEventListener('submit', (e) => { e.preventDefault(); saveEditor(form, f); });
  document.getElementById('fuTestReminder')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/api/admin/follow-ups/${f.id}/test-reminder`, { method: 'POST' });
      alert(`Test reminder sent to ${r.to}.`);
    } catch (err) { alert(err.message); }
    e.target.disabled = false;
  });

  editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.company_name.focus();
  if (isNew) fillSources(form);
}

async function fillSources(form) {
  const select = document.getElementById('fuSource');
  try {
    if (!sources) sources = await api('/api/admin/follow-ups/sources');
    select.innerHTML = '<option value="">— Enter details manually —</option>' + sources.map((s) =>
      `<option value="${attr(s.id)}">${esc(s.ref)} · ${esc(s.company)}${s.title ? ` · ${esc(s.title)}` : ''}${s.amount ? ` · ${money(s.amount)}` : ''}</option>`).join('');
  } catch {
    select.innerHTML = '<option value="">Could not load your projects - enter details manually</option>';
  }
  select.addEventListener('change', () => {
    const s = (sources || []).find((x) => x.id === select.value);
    if (!s) return;
    form.company_name.value = s.company || '';
    form.project_ref.value = s.ref || '';
    form.contact_name.value = s.contact || '';
    form.email.value = s.email || '';
    if (s.amount) form.amount.value = s.amount;
    form.dataset.projectId = s.id;
  });
}

async function saveEditor(form, existing) {
  const payload = {
    company_name: form.company_name.value,
    project_ref: form.project_ref.value,
    contact_name: form.contact_name.value,
    email: form.email.value,
    amount: form.amount.value,
    due_date: form.due_date.value,
    notes: form.notes.value,
    reminder_enabled: form.reminder_enabled.checked,
    reminder_frequency: form.reminder_frequency.value,
    reminder_weekday: Number(form.reminder_weekday.value),
    reminder_time: form.reminder_time.value,
    project_id: form.dataset.projectId || existing?.project_id || null,
  };
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const saved = await api(existing ? `/api/admin/follow-ups/${existing.id}` : '/api/admin/follow-ups', {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    upsert(saved);
    editorEl.innerHTML = '';
    if (filter === 'paid' && saved.status === 'open') filter = 'open';
    render();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
}

// ---------- Follow-up email composer ----------

async function openComposer(f) {
  modalEl.innerHTML = `
    <div class="fu-dialog">
      <div class="fu-dialog-head">
        <h2 id="fuModalTitle">Follow up · ${esc(f.company_name)}</h2>
        <div>${money(f.amount)} outstanding${f.project_ref ? ` · ${esc(f.project_ref)}` : ''}${f.followups_sent ? ` · ${f.followups_sent} sent before` : ''}</div>
      </div>
      <div class="fu-dialog-body">
        <label class="fu-field">To<input value="${attr(f.email)}" disabled></label>
        <label class="fu-field">Subject<input id="fuSubject" value="Loading..."></label>
        <label class="fu-field">Message<textarea id="fuBody" rows="11">Loading...</textarea></label>
        <div class="fu-hint">Sent from your business email address with your signature. Edit anything before sending.</div>
      </div>
      <div class="fu-dialog-foot">
        <button type="button" class="link-btn" id="fuClose">Cancel</button>
        <button type="button" class="btn-primary" id="fuSend">Send follow-up</button>
      </div>
    </div>`;
  modalEl.classList.remove('hidden');

  const close = () => { modalEl.classList.add('hidden'); modalEl.innerHTML = ''; };
  document.getElementById('fuClose').addEventListener('click', close);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); }, { once: true });

  try {
    const draft = await api(`/api/admin/follow-ups/${f.id}/draft`);
    document.getElementById('fuSubject').value = draft.subject;
    document.getElementById('fuBody').value = draft.body;
  } catch (err) {
    document.getElementById('fuBody').value = '';
    alert(err.message);
  }

  document.getElementById('fuSend').addEventListener('click', async (e) => {
    const subject = document.getElementById('fuSubject').value.trim();
    const body = document.getElementById('fuBody').value.trim();
    if (!subject || body.length < 10) return alert('Please add a subject and a message.');
    e.target.disabled = true;
    e.target.textContent = 'Sending...';
    try {
      upsert(await api(`/api/admin/follow-ups/${f.id}/send`, { method: 'POST', body: JSON.stringify({ subject, body }) }));
      close();
      render();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Send follow-up';
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) { modalEl.classList.add('hidden'); modalEl.innerHTML = ''; }
});

// ---------- Helpers ----------

function money(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dueLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

function shortDate(isoTs) {
  if (!isoTs) return '';
  const d = new Date(isoTs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// A UTC timestamp shown in the reminder timezone, e.g. "Mon 26 Oct 08:00"
function fmtInstant(isoTs) {
  if (!isoTs) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(isoTs)).replace(',', '');
}

function esc(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function attr(str = '') {
  return esc(str).replace(/"/g, '&quot;');
}

load();
