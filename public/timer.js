// Accessory: Support timer. A stopwatch for support work that keeps running as you move between
// admin pages (and tabs), then logs the time to an in-progress support ticket: the same work-log
// entry as "Log hours" on the Pipeline card, so billing picks it up as normal.
//
// The timer itself lives in this browser (localStorage: when it started and how much is banked),
// so a reload, a new tab or even a sign-in prompt doesn't lose it. Nothing is sent until you log.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { load, save, esc } = A;
  const KEY = 'aw.timer';

  const clean = (s) => ({
    running: !!(s && s.running && Number(s.startedAt)),
    startedAt: Number(s && s.startedAt) || null,
    accMs: Math.max(0, Number(s && s.accMs) || 0),
    ticketId: String((s && s.ticketId) || ''),
    note: String((s && s.note) || '').slice(0, 200),
  });
  let st = clean(load(KEY, null));
  const elapsed = () => st.accMs + (st.running ? Date.now() - st.startedAt : 0);

  A.register({
    id: 'timer',
    name: 'Support timer',
    short: 'Timer',
    desc: 'Time support work, then log it to the ticket’s hours.',
    model: 'AW-TIME',
    label: 'support timer',
    width: 256,
    icon: '<circle cx="12" cy="13.5" r="7"/><path d="M12 9.5v4l2.5 1.5M10 3.5h4M12 3.5v3"/>',
    // First opening: just left of where the calculator sits (bottom right)
    defaultPos: (w, h) => ({ x: window.innerWidth - 24 - 236 - 14 - w, y: window.innerHeight - h - 24 }),

    // Runs at start-up even while closed, so the dock and menu show a running timer
    init() { A.setStatus('timer', st.running ? 'running' : null); },

    build(win) {
      let timeZone = 'Africa/Harare';
      A.me.then((me) => { if (me.timezone) timeZone = me.timezone; });
      let tickets = [];
      let tick = null;
      let armed = null;

      win.body.innerHTML = `
        <div class="tm-lcd" role="timer" aria-label="Time on the clock">
          <span class="tm-state"></span>
          <span class="tm-time">00:00:00</span>
        </div>
        <div class="tm-keys">
          <button type="button" class="calc-key eq tm-go" data-tm="go"></button>
          <button type="button" class="calc-key fn tm-reset" data-tm="reset"></button>
        </div>
        <div class="tm-paper">
          <label class="tm-field"><span>Ticket</span>
            <select class="tm-ticket" aria-label="Support ticket to log to"><option value="">Loading tickets…</option></select>
          </label>
          <label class="tm-field"><span>Note</span>
            <input type="text" class="tm-note" maxlength="200" placeholder="What you did (optional)">
          </label>
          <button type="button" class="calc-key op tm-log" data-tm="log">Log time</button>
          <div class="tm-status" aria-live="polite"></div>
        </div>`;

      const $ = (sel) => win.body.querySelector(sel);
      const timeEl = $('.tm-time');
      const stateEl = $('.tm-state');
      const goBtn = $('[data-tm="go"]');
      const resetBtn = $('[data-tm="reset"]');
      const select = $('.tm-ticket');
      const noteEl = $('.tm-note');
      const statusEl = $('.tm-status');
      win.focusTarget = () => goBtn;
      const say = (msg, kind = '') => { statusEl.textContent = msg; statusEl.className = `tm-status ${kind}`; };

      function persist() { save(KEY, st); A.setStatus('timer', st.running ? 'running' : null); }

      function render() {
        const ms = elapsed();
        timeEl.textContent = Core.clock(ms);
        const label = st.running ? 'Running' : ms ? 'Paused' : 'Ready';
        stateEl.textContent = label;
        win.el.classList.toggle('is-running', st.running);
        goBtn.textContent = st.running ? 'Pause' : ms ? 'Resume' : 'Start';
        goBtn.setAttribute('aria-label', `${goBtn.textContent} the timer`);
        resetBtn.textContent = armed ? 'Sure?' : 'Reset';
        resetBtn.disabled = !ms;
        $('[data-tm="log"]').disabled = !ms || !select.value;
      }

      function loop() {
        clearInterval(tick); tick = null;
        if (st.running && A.isOpen('timer')) tick = setInterval(render, 1000);
        render();
      }

      async function loadTickets() {
        try {
          const r = await fetch('/api/admin/projects', { cache: 'no-store' });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Could not load tickets.');
          tickets = (j.inProgress || []).filter((p) => p.request_type === 'IT Support');
          if (!tickets.some((t) => t.id === st.ticketId)) st.ticketId = '';
          select.innerHTML = `<option value="">${tickets.length ? 'Choose an in-progress ticket…' : 'No support tickets in progress'}</option>`
            + tickets.map((t) => `<option value="${esc(t.id)}">${esc(t.project_id)} · ${esc(t.company_name || '')}</option>`).join('');
          select.value = st.ticketId;
        } catch (e) { select.innerHTML = '<option value="">Tickets unavailable</option>'; say(e.message, 'err'); }
        render();
      }

      async function logTime() {
        const t = tickets.find((x) => x.id === select.value);
        if (!t) { say('Choose the ticket to log to.', 'err'); return; }
        const entry = Core.logEntry(elapsed(), new Date(), timeZone);
        if (entry.error) { say(entry.error, 'err'); return; }
        const btn = $('[data-tm="log"]');
        btn.disabled = true;
        say(`Logging ${Core.clock(entry.minutes * 60000).slice(0, 5)} to ${t.project_id}…`);
        try {
          const r = await fetch(`/api/admin/projects/${encodeURIComponent(t.id)}/log-hours`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: entry.date, start: entry.start, end: entry.end, note: noteEl.value.trim() || 'Support timer' }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Could not log the time.');
          const h = Math.floor(entry.minutes / 60); const m = entry.minutes % 60;
          st = { ...st, running: false, startedAt: null, accMs: 0, note: '' };
          noteEl.value = '';
          persist();
          say(`Logged ${h ? `${h}h ` : ''}${m}m to ${t.project_id} (${entry.start}–${entry.end}).${location.pathname === '/admin' ? ' Reload to see it on the card.' : ''}`, 'ok');
        } catch (e) { say(e.message, 'err'); }
        loop();
      }

      win.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tm]');
        if (!b || b.disabled) return;
        const act = b.dataset.tm;
        if (act !== 'reset' && armed) { clearTimeout(armed); armed = null; }
        if (act === 'go') {
          if (st.running) st = { ...st, running: false, accMs: elapsed(), startedAt: null };
          else st = { ...st, running: true, startedAt: Date.now() };
          say('');
          persist(); loop();
        }
        if (act === 'reset') {
          // Two steps once there's more than a minute on the clock
          if (!armed && elapsed() > 60000) { armed = setTimeout(() => { armed = null; render(); }, 3000); render(); return; }
          clearTimeout(armed); armed = null;
          st = { ...st, running: false, startedAt: null, accMs: 0 };
          say(''); persist(); loop();
        }
        if (act === 'log') logTime();
      });
      select.addEventListener('change', () => { st.ticketId = select.value; persist(); render(); });
      noteEl.value = st.note;
      noteEl.addEventListener('input', () => { st.note = noteEl.value.slice(0, 200); persist(); });

      // Another tab started, paused or logged: follow it
      window.addEventListener('storage', (e) => {
        if (e.key !== KEY) return;
        st = clean(load(KEY, null));
        if (document.activeElement !== noteEl) noteEl.value = st.note;
        if (tickets.some((t) => t.id === st.ticketId)) select.value = st.ticketId;
        A.setStatus('timer', st.running ? 'running' : null);
        loop();
      });

      win.onOpen.push(() => { loadTickets(); loop(); });
      win.onClose.push(() => { clearInterval(tick); tick = null; });
      render();
    },
  });

  // Keep the dock/menu light right when another tab changes the timer and this window was never opened
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    st = clean(load(KEY, null));
    A.setStatus('timer', st.running ? 'running' : null);
  });
})();
