// Accessory: Debrief. Emails you where everything stands: ongoing work (ball in our court), what's
// on hold waiting on clients, your reminders for the week, unpaid invoices and domain renewals.
// Send it whenever you like (once every 30 minutes), and switch on "every Monday" to have it
// arrive at 07:00 Harare time each week. The window shows a preview of what the email will say.
// Server: lib/debrief.js and /api/admin/debrief in lib/accessoriesRoutes.js.
(function () {
  const A = window.Accessories;
  if (!A) return;
  const { esc } = A;
  const MAX_ROWS = 3;

  A.register({
    id: 'debrief',
    name: 'Debrief',
    short: 'Brief',
    desc: 'Ongoing work, things on hold and reminders, emailed to you. Every Monday if you like.',
    model: 'AW-BRIEF',
    label: 'debrief',
    width: 310,
    icon: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/><path d="M8 15.5h3"/>',
    defaultPos: () => ({ x: Math.round(window.innerWidth / 2 - 155), y: Math.round(window.innerHeight * 0.14) }),

    build(win) {
      let state = null; let tick = null; let busy = false;
      win.body.innerHTML = `
        <div class="db-lcd" aria-live="polite">
          <span><strong data-n="ongoing">--</strong><small>with us</small></span>
          <span><strong data-n="waiting">--</strong><small>on hold</small></span>
          <span><strong data-n="reminders">--</strong><small>reminders</small></span>
        </div>
        <div class="db-paper"><p class="db-empty">Loading…</p></div>
        <button type="button" class="db-switch" role="switch" aria-checked="false">
          <span class="db-knob" aria-hidden="true"></span>
          <span class="db-switch-text">Every Monday at 07:00<small>Sent to you automatically</small></span>
        </button>
        <div class="db-keys"><button type="button" class="calc-key eq" data-db="send">Send now</button></div>
        <p class="db-foot" aria-live="polite"></p>`;
      const $ = (s) => win.body.querySelector(s);
      const paper = $('.db-paper'); const sw = $('.db-switch'); const sendBtn = $('[data-db="send"]'); const foot = $('.db-foot');
      win.focusTarget = () => sendBtn;

      const two = (n) => String(n).padStart(2, '0');
      const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      const ago = (n) => (n === 0 ? 'today' : `${n}d`);

      function section(label, rows, render, empty) {
        const more = rows.length > MAX_ROWS ? `<li class="db-more">+${rows.length - MAX_ROWS} more in the email</li>` : '';
        return `<section><h3>${esc(label)}</h3>${rows.length
          ? `<ul>${rows.slice(0, MAX_ROWS).map(render).join('')}${more}</ul>`
          : `<p class="db-empty">${esc(empty)}</p>`}</section>`;
      }
      const row = (main, sub, side, late) => `<li><span class="db-main">${main}<small>${sub}</small></span><span class="db-side${late ? ' late' : ''}">${side}</span></li>`;

      function renderPreview(p) {
        if (!p) return;
        win.body.querySelectorAll('[data-n]').forEach((el) => { el.textContent = two(p.counts[el.dataset.n] || 0); });
        const extra = [];
        if (p.counts.unpaid) extra.push(`${p.counts.unpaid} unpaid invoice${p.counts.unpaid === 1 ? '' : 's'}`);
        if (p.counts.renewals) extra.push(`${p.counts.renewals} domain renewal${p.counts.renewals === 1 ? '' : 's'}`);
        paper.innerHTML = [
          section('Ongoing · with us', p.ongoing, (x) => row(esc(x.ref), esc(x.detail || x.label), ago(x.days), x.days >= 7), 'Nothing in our court.'),
          section('On hold · waiting on clients', p.waiting, (x) => row(esc(x.ref), esc(`${x.company} · ${x.label}`), ago(x.days), x.days >= 7), 'Nobody owes us anything.'),
          section('Reminders · next 7 days', p.reminders, (x) => row(esc(x.title), esc(x.ref || ''), esc(x.when), x.overdue), 'Nothing this week.'),
          extra.length ? `<p class="db-extra">Also in the email: ${esc(extra.join(' and '))}.</p>` : '',
        ].join('');
      }

      function renderState() {
        if (!state) return;
        sw.setAttribute('aria-checked', String(!!state.autoMonday));
        $('.db-switch-text').firstChild.textContent = `Every Monday at ${two(state.autoHour ?? 7)}:00`;
        $('.db-switch-text small').textContent = state.autoMonday ? `On · to ${state.to}` : 'Off · switch on to get it weekly';
        const waitMs = state.nextAt ? new Date(state.nextAt) - Date.now() : 0;
        const waiting = waitMs > 0;
        sendBtn.disabled = waiting || busy;
        sendBtn.textContent = busy ? 'Sending…' : waiting ? `Ready in ${Math.ceil(waitMs / 60000)} min` : 'Send now';
        foot.textContent = state.lastSentAt
          ? `Last sent ${day(state.lastSentAt)}, ${time(state.lastSentAt)} · one every ${state.cooldownMinutes} min`
          : `Goes to ${state.to}`;
        clearInterval(tick); tick = null;
        if (waiting) tick = setInterval(renderState, 15000);
      }

      async function api(method, url, body) {
        const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { data: j });
        return j;
      }

      async function refresh() {
        try {
          const j = await api('GET', '/api/admin/debrief');
          state = j; renderPreview(j.preview); renderState();
        } catch (e) {
          paper.innerHTML = `<p class="db-empty">${esc(e.message)}</p>`;
        }
      }

      sendBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true; renderState();
        try {
          const j = await api('POST', '/api/admin/debrief/send');
          state = j; renderPreview(j.preview);
          A.toast(`Debrief sent to ${j.to}.`);
        } catch (e) {
          if (e.data && e.data.nextAt && state) state.nextAt = e.data.nextAt;
          A.toast(e.message);
        } finally { busy = false; renderState(); }
      });

      sw.addEventListener('click', async () => {
        if (!state) return;
        const want = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(want)); // show it at once; put back if saving fails
        try {
          state = { ...state, ...(await api('PUT', '/api/admin/debrief/settings', { autoMonday: want })) };
          A.toast(want ? `Your debrief will arrive every Monday at ${two(state.autoHour ?? 7)}:00.` : 'Monday debrief turned off.');
        } catch (e) { A.toast(e.message); }
        renderState();
      });

      win.onOpen.push(refresh);
      win.onClose.push(() => { clearInterval(tick); tick = null; });
    },
  });
})();
