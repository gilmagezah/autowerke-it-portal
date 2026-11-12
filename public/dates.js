// Accessory: Dates & reminders.
//   Reminders: "remind me at 09:00 tomorrow to nudge Tanner". Saved to your account (works on any
//   device), shown as an alert on whatever admin page is open when due, and emailed to you
//   (via the reminder cron) unless you untick it. Suggestions come from what's going on:
//   clients you're waiting on, meetings coming up, quiet tickets, invoices and domain renewals.
//   Date maths: add calendar or working days (weekends and Zimbabwe public holidays skipped),
//   and count working days between two dates.
// Needs schema_accessories.sql for reminders; the date maths works without it.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { load, save, esc } = A;
  const POLL_MS = 60 * 1000;
  const HIDDEN_KEY = 'aw.rem.hidden';
  const ALERTED_KEY = 'aw.rem.alerted';

  let timeZone = 'Africa/Harare';
  A.me.then((me) => { if (me.timezone) timeZone = me.timezone; });
  const today = () => Core.localParts(new Date(), timeZone).date;
  const nowLocal = (plusMin = 0) => Core.localParts(new Date(Date.now() + plusMin * 60000), timeZone);
  const fmtDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  function whenLabel(r) {
    const t = today(); const { date, time } = r.local;
    if (new Date(r.due_at) <= new Date()) return { text: date === t ? `Due ${time}` : `Overdue · ${fmtDate(date).slice(0, -5)}`, late: true };
    const d = Core.daysBetween(t, date);
    if (d === 0) return { text: `Today ${time}` };
    if (d === 1) return { text: `Tomorrow ${time}` };
    if (d < 7) return { text: `${fmtDate(date).slice(0, 3)} ${time}` };
    return { text: `${fmtDate(date).slice(4, -5)} ${time}` };
  }
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { status: r.status });
    return j;
  };

  // ---------- Due alerts on every page (runs even while the window is closed) ----------
  let pollTimer = null;
  let disabled = false;
  let onDue = () => {};
  const alerted = new Set((() => { try { return JSON.parse(sessionStorage.getItem(ALERTED_KEY) || '[]'); } catch { return []; } })());
  const remember = () => { try { sessionStorage.setItem(ALERTED_KEY, JSON.stringify([...alerted].slice(-100))); } catch { /* fine */ } };

  async function poll() {
    if (disabled || document.visibilityState !== 'visible') return;
    try {
      // X-Background: this check mustn't keep an idle session alive (lib/auth.js)
      const j = await api('/api/admin/reminders?due=1', { headers: { 'X-Background': '1' } });
      A.setStatus('dates', j.due.length ? 'due' : null);
      j.due.forEach((r) => { const k = `${r.id}|${r.due_at}`; if (!alerted.has(k)) { alerted.add(k); remember(); showAlert(r); } });
      onDue(j.due);
    } catch (e) {
      if (e.status === 503 || e.status === 401) { disabled = true; clearInterval(pollTimer); } // no table yet, or signed out
    }
  }

  function alertBox() {
    let box = document.getElementById('accAlerts');
    if (!box) { box = document.createElement('div'); box.id = 'accAlerts'; box.className = 'acc-alerts'; box.setAttribute('aria-live', 'assertive'); document.body.appendChild(box); }
    return box;
  }
  function showAlert(r) {
    const box = alertBox();
    if (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'acc-alert';
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <div class="acc-alert-head"><span class="acc-alert-bell" aria-hidden="true"></span>Reminder<span class="acc-alert-when">${esc(r.local.time)}</span><button type="button" class="acc-alert-x" data-al="close" aria-label="Dismiss" title="Dismiss (it stays on your list)">×</button></div>
      <div class="acc-alert-title">${esc(r.title)}</div>
      ${r.ref ? `<div class="acc-alert-ref">${esc(r.ref)}</div>` : ''}
      ${r.note ? `<div class="acc-alert-note">${esc(r.note)}</div>` : ''}
      <div class="acc-alert-keys">
        <button type="button" data-al="done">Done</button>
        <button type="button" data-al="60">+1 hour</button>
        <button type="button" data-al="1440">Tomorrow</button>
        ${r.ref ? '<button type="button" data-al="find">Find</button>' : ''}
      </div>`;
    box.appendChild(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-al]');
      if (!b) return;
      const act = b.dataset.al;
      try {
        if (act === 'done') await api(`/api/admin/reminders/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
        if (act === '60' || act === '1440') await api(`/api/admin/reminders/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ snooze: Number(act) }) });
        if (act === 'find') { A.open('find'); window.dispatchEvent(new CustomEvent('acc:find', { detail: r.ref })); }
      } catch (err) { A.toast(err.message); return; }
      el.remove();
      if (act !== 'close' && act !== 'find') poll();
      refreshWindow();
    });
  }
  let refreshWindow = () => {};

  A.register({
    id: 'dates',
    name: 'Dates & reminders',
    short: 'Dates',
    desc: 'Reminders (emailed when due), suggestions, and working-day date maths.',
    model: 'AW-DATE',
    label: 'dates & reminders',
    width: 330,
    icon: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M12 13v3l2 1.2"/>',
    defaultPos: (w, h) => ({ x: Math.round(window.innerWidth / 2 - w / 2), y: Math.max(8, Math.round(window.innerHeight * 0.1)) }),

    init() {
      setTimeout(poll, 2500);
      pollTimer = setInterval(poll, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
    },

    build(win) {
      let tab = load('aw.dates.tab', 'rem');
      let state = { reminders: [], done: [], suggestions: [], error: '' };
      const hidden = new Set(load(HIDDEN_KEY, []));

      win.body.innerHTML = `
        <div class="dt-tabs" role="tablist">
          <button type="button" role="tab" data-tab="rem">Reminders<span class="dt-count"></span></button>
          <button type="button" role="tab" data-tab="calc">Date maths</button>
        </div>

        <section class="dt-panel" data-panel="rem">
          <form class="dt-form" novalidate>
            <input type="text" class="dt-title" maxlength="200" placeholder="Remind me to…" aria-label="Reminder" required>
            <div class="dt-presets" aria-label="Quick times">
              <button type="button" data-preset="60">+1 hour</button>
              <button type="button" data-preset="tomorrow">Tomorrow 9:00</button>
              <button type="button" data-preset="workday">Next work day</button>
              <button type="button" data-preset="monday">Monday 9:00</button>
            </div>
            <div class="dt-when">
              <input type="date" class="dt-date" aria-label="Date">
              <input type="time" class="dt-time" aria-label="Time" step="300">
            </div>
            <div class="dt-row">
              <input type="text" class="dt-ref" maxlength="40" placeholder="Ref (optional)" aria-label="Reference" autocapitalize="characters">
              <label class="dt-email"><input type="checkbox" class="dt-email-on" checked> Email me</label>
            </div>
            <button type="submit" class="calc-key eq dt-add">Add reminder</button>
            <div class="dt-msg" aria-live="polite"></div>
          </form>
          <div class="dt-paper">
            <div class="dt-h">Coming up</div>
            <ul class="dt-list" data-list="open"></ul>
            <div class="dt-h dt-h-sug">Suggested for you <button type="button" class="dt-link" data-act="refresh-sug">Refresh</button></div>
            <ul class="dt-list" data-list="sug"></ul>
            <details class="dt-done"><summary>Done this week</summary><ul class="dt-list" data-list="done"></ul></details>
          </div>
        </section>

        <section class="dt-panel hidden" data-panel="calc">
          <div class="dt-paper dt-calc">
            <div class="dt-h">Add or take away</div>
            <div class="dt-calc-row">
              <input type="date" class="dc-from" aria-label="Start date">
              <select class="dc-sign" aria-label="Add or take away"><option value="1">+</option><option value="-1">−</option></select>
              <input type="number" class="dc-n" min="0" max="3650" value="10" aria-label="How many">
              <select class="dc-unit" aria-label="Unit">
                <option value="wd">working days</option><option value="d">days</option><option value="w">weeks</option><option value="m">months</option>
              </select>
            </div>
            <div class="dc-lcd" aria-live="polite"><span class="dc-result"></span><span class="dc-note"></span></div>
            <button type="button" class="dt-link dc-remind" data-act="remind-result">Remind me on this date</button>

            <div class="dt-h">Between two dates</div>
            <div class="dt-calc-row between">
              <input type="date" class="db-a" aria-label="From">
              <span class="dt-arrow" aria-hidden="true">→</span>
              <input type="date" class="db-b" aria-label="To">
            </div>
            <div class="db-out" aria-live="polite"></div>

            <div class="dt-h">Next public holidays</div>
            <ul class="dt-hols"></ul>
            <p class="dt-foot">Zimbabwe public holidays, with Sunday holidays moved to the Monday. Check the gazette for one-off days.</p>
          </div>
        </section>`;

      const $ = (s) => win.body.querySelector(s);
      const form = $('.dt-form');
      const msg = (t, kind = '') => { const m = $('.dt-msg'); m.textContent = t; m.className = `dt-msg ${kind}`; };

      // ---------- Tabs ----------
      function showTab(t) {
        tab = t; save('aw.dates.tab', t);
        win.body.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
        win.body.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== t));
        if (t === 'calc') renderCalc();
      }
      win.focusTarget = () => (tab === 'rem' ? $('.dt-title') : $('.dc-n'));

      // ---------- Presets ----------
      function preset(p) {
        const t = today();
        let date; let time = '09:00';
        if (p === '60') { const l = nowLocal(60); date = l.date; const [h, m] = l.time.split(':').map(Number); const r = Math.ceil(m / 5) * 5; time = r === 60 ? `${String((h + 1) % 24).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(r).padStart(2, '0')}`; if (r === 60 && h === 23) date = Core.addDays(date, 1); }
        if (p === 'tomorrow') date = Core.addDays(t, 1);
        if (p === 'workday') date = Core.nextWorkingDay(t);
        if (p === 'monday') { date = Core.addDays(t, 1); while (Core.weekday(date) !== 1) date = Core.addDays(date, 1); }
        $('.dt-date').value = date; $('.dt-time').value = time;
      }

      // ---------- Lists ----------
      function row(r, kind) {
        const w = whenLabel(r);
        return `<li class="dt-item${w.late ? ' late' : ''}">
          <div class="dt-item-main">
            <span class="dt-when-label">${esc(w.text)}${r.email ? '' : ' · no email'}</span>
            <strong>${esc(r.title)}</strong>
            ${r.ref ? `<button type="button" class="dt-ref-link" data-findref="${esc(r.ref)}">${esc(r.ref)}</button>` : ''}
          </div>
          <div class="dt-item-keys">
            ${kind === 'open'
              ? `<button type="button" data-done="${esc(r.id)}" title="Done" aria-label="Mark done">✓</button>
                 <button type="button" data-snooze="${esc(r.id)}" title="Snooze 1 hour" aria-label="Snooze 1 hour">+1h</button>
                 <button type="button" data-del="${esc(r.id)}" title="Delete" aria-label="Delete">×</button>`
              : `<button type="button" data-undo="${esc(r.id)}" title="Not done yet">Undo</button>`}
          </div>
        </li>`;
      }
      function renderLists() {
        if (state.error) {
          $('[data-list="open"]').innerHTML = `<li class="dt-empty">${esc(state.error)}</li>`;
          $('[data-list="sug"]').innerHTML = ''; $('[data-list="done"]').innerHTML = '';
          return;
        }
        $('[data-list="open"]').innerHTML = state.reminders.map((r) => row(r, 'open')).join('') || '<li class="dt-empty">Nothing coming up. Add one above, or take a suggestion.</li>';
        $('[data-list="done"]').innerHTML = state.done.map((r) => row(r, 'done')).join('') || '<li class="dt-empty">Nothing yet.</li>';
        const sug = state.suggestions.filter((s) => !hidden.has(s.key));
        $('[data-list="sug"]').innerHTML = sug.map((s) => `<li class="dt-sug">
            <div class="dt-item-main">
              <strong>${esc(s.title)}</strong>
              <span class="dt-why">${esc(s.why)} · remind ${esc(fmtDate(s.date).slice(0, -5))} ${esc(s.time)}</span>
            </div>
            <div class="dt-item-keys">
              <button type="button" data-take="${esc(s.key)}" title="Add this reminder">Remind me</button>
              <button type="button" data-hide="${esc(s.key)}" aria-label="Hide this suggestion" title="Hide">×</button>
            </div>
          </li>`).join('') || '<li class="dt-empty">No suggestions right now.</li>';
        const late = state.reminders.filter((r) => new Date(r.due_at) <= new Date()).length;
        $('.dt-count').textContent = state.reminders.length ? ` ${state.reminders.length}${late ? '!' : ''}` : '';
      }

      async function refresh({ suggestions = false } = {}) {
        try {
          const j = await api('/api/admin/reminders');
          state = { ...state, reminders: j.reminders, done: j.done, error: '' };
          if (suggestions || !state.suggestions.length) state.suggestions = (await api('/api/admin/reminders/suggestions')).suggestions;
        } catch (e) { state.error = e.message; }
        renderLists();
      }
      refreshWindow = () => { if (A.isOpen('dates')) refresh(); };
      onDue = () => { if (A.isOpen('dates')) renderLists(); };

      async function add(body) {
        const r = await api('/api/admin/reminders', { method: 'POST', body: JSON.stringify(body) });
        await refresh({ suggestions: true });
        poll();
        return r;
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('.dt-title').value.trim();
        if (!title) { msg('What should we remind you about?', 'err'); $('.dt-title').focus(); return; }
        if (!$('.dt-date').value || !$('.dt-time').value) { msg('Pick a time (or a quick time above).', 'err'); return; }
        try {
          const r = await add({ title, date: $('.dt-date').value, time: $('.dt-time').value, ref: $('.dt-ref').value.trim(), email: $('.dt-email-on').checked });
          msg(`Added for ${whenLabel(r).text}.`, 'ok');
          $('.dt-title').value = ''; $('.dt-ref').value = '';
          $('.dt-title').focus();
        } catch (err) { msg(err.message, 'err'); }
      });

      win.body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-tab]'); if (t) { showTab(t.dataset.tab); return; }
        const p = e.target.closest('[data-preset]'); if (p) { preset(p.dataset.preset); return; }
        const f = e.target.closest('[data-findref]');
        if (f) { A.open('find'); window.dispatchEvent(new CustomEvent('acc:find', { detail: f.dataset.findref })); return; }
        const hide = e.target.closest('[data-hide]');
        if (hide) { hidden.add(hide.dataset.hide); save(HIDDEN_KEY, [...hidden].slice(-200)); renderLists(); return; }
        const act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'refresh-sug') { refresh({ suggestions: true }); return; }
        if (act && act.dataset.act === 'remind-result') {
          const d = $('.dc-result').dataset.date; if (!d) return;
          showTab('rem'); $('.dt-date').value = d; $('.dt-time').value = '09:00'; $('.dt-title').focus();
          return;
        }
        const id = (k) => { const b = e.target.closest(`[data-${k}]`); return b ? b.dataset[k] : null; };
        try {
          if (id('done')) await api(`/api/admin/reminders/${encodeURIComponent(id('done'))}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
          else if (id('undo')) await api(`/api/admin/reminders/${encodeURIComponent(id('undo'))}`, { method: 'PATCH', body: JSON.stringify({ done: false }) });
          else if (id('snooze')) await api(`/api/admin/reminders/${encodeURIComponent(id('snooze'))}`, { method: 'PATCH', body: JSON.stringify({ snooze: 60 }) });
          else if (id('del')) await api(`/api/admin/reminders/${encodeURIComponent(id('del'))}`, { method: 'DELETE' });
          else if (id('take')) {
            const s = state.suggestions.find((x) => x.key === id('take'));
            if (!s) return;
            await add({ title: s.title, ref: s.ref || '', date: s.date, time: s.time, source: s.key, email: true });
            A.toast(`Reminder set: ${s.title}`);
            return;
          } else return;
          await refresh(); poll();
        } catch (err) { A.toast(err.message); }
      });

      // ---------- Date maths ----------
      function renderCalc() {
        const from = $('.dc-from').value; const n = Math.trunc(Number($('.dc-n').value));
        const sign = Number($('.dc-sign').value); const unit = $('.dc-unit').value;
        const out = $('.dc-result'); const note = $('.dc-note');
        if (!Core.isDate(from) || !(n >= 0 && n <= 3650)) { out.textContent = '—'; note.textContent = ''; out.dataset.date = ''; }
        else {
          const k = sign * n;
          const d = unit === 'wd' ? Core.addWorkingDays(from, k) : unit === 'w' ? Core.addDays(from, k * 7) : unit === 'm' ? Core.addMonths(from, k) : Core.addDays(from, k);
          out.textContent = fmtDate(d); out.dataset.date = d;
          const hol = Core.holidayName(d); const wd = Core.weekday(d);
          note.textContent = hol ? `Public holiday: ${hol}` : wd === 0 || wd === 6 ? 'That’s a weekend' : `${Math.abs(Core.daysBetween(today(), d))} day${Math.abs(Core.daysBetween(today(), d)) === 1 ? '' : 's'} ${d >= today() ? 'from' : 'before'} today`;
          note.classList.toggle('warn', !!hol || wd === 0 || wd === 6);
        }
        const a = $('.db-a').value; const b = $('.db-b').value;
        if (Core.isDate(a) && Core.isDate(b)) {
          const days = Core.daysBetween(a, b); const wdays = Core.workingDaysBetween(a, b);
          const weeks = Math.trunc(Math.abs(days) / 7); const rest = Math.abs(days) % 7;
          $('.db-out').innerHTML = `<strong>${Math.abs(days)}</strong> day${Math.abs(days) === 1 ? '' : 's'} · <strong>${Math.abs(wdays)}</strong> working day${Math.abs(wdays) === 1 ? '' : 's'}<small>${weeks ? `${weeks} week${weeks === 1 ? '' : 's'}${rest ? ` ${rest} day${rest === 1 ? '' : 's'}` : ''} · ` : ''}${days < 0 ? 'counting backwards' : 'not counting the start date'}</small>`;
        } else $('.db-out').textContent = '';
        $('.dt-hols').innerHTML = Core.upcomingHolidays(today(), 3).map((h) => `<li><span>${esc(fmtDate(h.date))}</span>${esc(h.name)}</li>`).join('');
      }
      ['.dc-from', '.dc-sign', '.dc-n', '.dc-unit', '.db-a', '.db-b'].forEach((s) => $(s).addEventListener('input', renderCalc));

      win.onOpen.push(() => {
        const t = today();
        if (!$('.dc-from').value) $('.dc-from').value = t;
        if (!$('.db-a').value) { $('.db-a').value = t; $('.db-b').value = Core.addDays(t, 30); }
        if (!$('.dt-date').value) preset('tomorrow');
        showTab(tab);
        refresh();
      });
    },
  });
})();
