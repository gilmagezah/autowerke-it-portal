// Accessory: Business card. The company details you keep being asked for, one tap to copy:
// email, phone, website and the bank details printed on invoices (INVOICE_PAYMENT_DETAILS).
// Tap the card (or the turn button) to flip it: the back has our Microsoft certifications and
// today's date, time and week number in Harare, with an office-hours light.
// Server: GET /api/admin/business-card (lib/businessCard.js). Admin-only; nothing is stored here.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { esc } = A;
  const TURN = '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/>';

  A.register({
    id: 'card',
    name: 'Business card',
    short: 'Card',
    desc: 'Bank details, email and phone, one tap to copy. Flip it for certifications and the date.',
    model: 'AW-CARD',
    label: 'business card',
    width: 420,
    icon: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.8 15.5c.6-1.3 1.6-2 2.7-2s2.1.7 2.7 2"/><path d="M14 10h4M14 13h3"/>',
    defaultPos: (w) => ({ x: Math.round(window.innerWidth / 2 - w / 2), y: Math.round(window.innerHeight * 0.16) }),

    build(win) {
      let info = null; let clock = null;
      win.body.innerHTML = `
        <div class="bc-stage">
          <div class="bc-card" data-side="front">
            <div class="bc-face bc-front" aria-label="Front: details to copy">
              <p class="bc-empty">Loading…</p>
            </div>
            <div class="bc-face bc-back" aria-label="Back: certifications, date and time" inert></div>
          </div>
        </div>
        <div class="bc-keys">
          <button type="button" class="calc-key op" data-bc="bank">Copy bank details</button>
          <button type="button" class="calc-key op" data-bc="contact">Copy contact</button>
        </div>
        <p class="pg-foot">Tap a line to copy it. Tap the card to turn it over.</p>`;
      const $ = (s) => win.body.querySelector(s);
      const card = $('.bc-card'); const front = $('.bc-front'); const back = $('.bc-back');
      const flipHead = document.createElement('button');
      flipHead.type = 'button'; flipHead.className = 'acc-icon'; flipHead.dataset.bc = 'flip';
      flipHead.title = 'Turn the card over'; flipHead.setAttribute('aria-label', 'Turn the card over');
      flipHead.innerHTML = A.svg(TURN, 1.9);
      win.extra.appendChild(flipHead);
      win.focusTarget = () => front.querySelector('.bc-line') || flipHead;

      const line = (label, value, copy = value) => `<button type="button" class="bc-line" data-copy="${esc(copy)}" data-what="${esc(label)}" title="Copy ${esc(label.toLowerCase())}">
          <small>${esc(label)}</small><span>${esc(value)}</span><i class="bc-copied" aria-hidden="true">Copied</i></button>`;

      function renderFront() {
        const pay = info.payment || [];
        front.innerHTML = `
          <div class="bc-top">
            <img class="bc-logo" src="/brand/autowerke-it-logo-light.svg" alt="${esc(info.name)}" width="150" height="23">
            <span class="bc-place">${esc(info.location)}</span>
          </div>
          <span class="bc-rule" aria-hidden="true"></span>
          <div class="bc-cols">
            <div class="bc-contact">
              ${line('Email', info.email)}
              ${line('Phone', info.phone)}
              ${line('Web', info.website)}
            </div>
            <div class="bc-bank${pay.length > 4 ? ' many' : ''}">
              <small class="bc-head">Bank details</small>
              ${pay.length ? pay.map((p, i) => line(p.label || (i === 0 ? 'Bank' : 'Detail'), p.value)).join('')
                : '<p class="bc-none">Not set yet. Add INVOICE_PAYMENT_DETAILS to .env (it also prints on invoices).</p>'}
            </div>
          </div>
          ${info.tagline ? `<p class="bc-tagline">${esc(info.tagline)}</p>` : ''}
          <button type="button" class="bc-turn" data-bc="flip" aria-label="Turn the card over">${A.svg(TURN, 2)}</button>`;
        $('[data-bc="bank"]').disabled = !pay.length;
      }

      function renderBack() {
        back.innerHTML = `
          <div class="bc-back-top">
            <span>Microsoft certified</span>
            <img class="bc-mark" src="/brand/autowerke-icon-dark.svg" alt="" width="22" height="22">
          </div>
          <ul class="bc-certs">
            ${(info.certs || []).map((c) => `<li><b>${esc(c.code)}</b><span>${esc(c.title)}</span></li>`).join('')}
          </ul>
          ${(info.focus || []).length ? `<ul class="bc-focus" aria-label="What we do">${info.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          <div class="bc-now">
            <span class="bc-date"></span><span class="bc-time"></span><span class="bc-week"></span>
          </div>
          <div class="bc-status"><i class="bc-led"></i><span class="bc-status-text"></span></div>
          <button type="button" class="bc-turn" data-bc="flip" aria-label="Turn the card back">${A.svg(TURN, 2)}</button>`;
      }

      // ISO week number of a YYYY-MM-DD date
      function isoWeek(date) {
        const [y, m, d] = date.split('-').map(Number);
        const t = new Date(Date.UTC(y, m - 1, d));
        t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
        return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
      }
      function tickClock() {
        if (!info) return;
        const now = new Date(); const tz = info.timezone || 'Africa/Harare';
        const c = Core.clockAt(now, tz);
        const date = now.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const secs = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        const off = c.offset; const sign = off < 0 ? '−' : '+';
        const utc = `UTC${sign}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, '0')}` : ''}`;
        const state = Core.officeState(c);
        back.querySelector('.bc-date').textContent = date;
        back.querySelector('.bc-time').textContent = secs;
        back.querySelector('.bc-week').textContent = `Wk ${isoWeek(c.date)}`;
        back.querySelector('.bc-led').className = `bc-led ${state}`;
        back.querySelector('.bc-status-text').textContent = `${state === 'open' ? 'Office open' : state === 'edge' ? 'Office opening or closing' : 'Office closed'} · ${tz.split('/').pop().replace(/_/g, ' ')} ${utc} · VAT ${info.vatRate}%`;
      }
      function startClock() { stopClock(); tickClock(); clock = setInterval(tickClock, 1000); }
      function stopClock() { clearInterval(clock); clock = null; }

      function flip() {
        const toBack = card.dataset.side !== 'back';
        card.dataset.side = toBack ? 'back' : 'front';
        // Only the face you can see takes clicks and keyboard focus
        front.inert = toBack; back.inert = !toBack;
        if (toBack) startClock(); else stopClock();
        const target = (toBack ? back : front).querySelector('.bc-turn');
        if (target && win.el.contains(document.activeElement)) target.focus({ preventScroll: true });
      }

      async function copy(text, what, btn) {
        try {
          await navigator.clipboard.writeText(text);
          if (btn) { btn.classList.remove('copied'); void btn.offsetWidth; btn.classList.add('copied'); }
          A.toast(`Copied ${what}.`);
        } catch { A.toast('The browser blocked copying. Select the text instead.'); }
      }

      win.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-bc], .bc-line');
        if (b && win.el.contains(b)) {
          if (b.classList.contains('bc-line')) return copy(b.dataset.copy, b.dataset.what.toLowerCase(), b);
          if (b.dataset.bc === 'flip') return flip();
          if (b.dataset.bc === 'bank') return copy(info.payment.map((p) => (p.label ? `${p.label}: ${p.value}` : p.value)).join('\n'), 'the bank details');
          if (b.dataset.bc === 'contact') return copy([info.name, info.email, info.phone, info.website].join('\n'), 'the contact details');
          return undefined;
        }
        // A tap anywhere else on the card turns it over
        if (card.contains(e.target)) flip();
        return undefined;
      });

      async function load() {
        try {
          const r = await fetch('/api/admin/business-card');
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not load the card.');
          info = await r.json();
          renderFront(); renderBack();
          if (card.dataset.side === 'back') startClock();
        } catch (e) { front.innerHTML = `<p class="bc-empty">${esc(e.message)}</p>`; }
      }
      win.onOpen.push(() => { if (!info) load(); else if (card.dataset.side === 'back') startClock(); });
      win.onClose.push(stopClock);
    },
  });
})();
