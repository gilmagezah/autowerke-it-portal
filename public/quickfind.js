// Accessory: Quick find. Type a reference, company, contact, email or phone number and jump to
// the request: it opens the page that lists it and flashes the card (#find=REF, accessories.js).
// Ctrl+K opens it from anywhere in the admin.
//
// The list comes from /api/admin/find-index (admin only) and is matched here in the browser
// (acc-core.js), never with a pattern in a database query.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { esc } = A;
  const FRESH_MS = 60 * 1000;

  A.register({
    id: 'find',
    name: 'Quick find',
    short: 'Find',
    desc: 'Jump to any request by reference, company, name, email or phone.',
    model: 'AW-FIND',
    label: 'quick find',
    width: 340,
    icon: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
    defaultPos: (w) => ({ x: Math.round((window.innerWidth - w) / 2), y: Math.round(window.innerHeight * 0.12) }),

    build(win) {
      let rows = null;
      let loadedAt = 0;
      let loading = null;
      let hits = [];
      let active = 0;

      win.body.innerHTML = `
        <label class="qf-lcd">
          <span class="qf-prompt" aria-hidden="true">&gt;</span>
          <input type="search" class="qf-input" placeholder="REF, company, name, email, phone" autocomplete="off" spellcheck="false"
            aria-label="Find a request" role="combobox" aria-expanded="false" aria-controls="qfResults" aria-autocomplete="list">
        </label>
        <div class="qf-paper">
          <div class="qf-status" aria-live="polite"></div>
          <ol class="qf-results" id="qfResults" role="listbox" aria-label="Matching requests"></ol>
        </div>
        <div class="qf-hint"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere</span></div>`;

      const input = win.body.querySelector('.qf-input');
      const list = win.body.querySelector('.qf-results');
      const statusEl = win.body.querySelector('.qf-status');
      win.focusTarget = () => input;
      const say = (msg) => { statusEl.textContent = msg; };

      async function ensureIndex(force = false) {
        if (rows && !force && Date.now() - loadedAt < FRESH_MS) return rows;
        if (loading) return loading;
        loading = fetch('/api/admin/find-index', { cache: 'no-store' })
          .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load the list.'); return j.rows || []; })
          .then((list2) => { rows = list2; loadedAt = Date.now(); return rows; })
          .finally(() => { loading = null; });
        return loading;
      }

      function render() {
        const q = input.value.trim();
        input.setAttribute('aria-expanded', String(!!hits.length));
        if (!q) { list.innerHTML = ''; say(rows ? `${rows.length} requests on file. Start typing.` : ''); return; }
        if (!hits.length) { list.innerHTML = ''; say(`Nothing matches “${q}”.`); return; }
        say(`${hits.length === 8 ? 'Top 8' : hits.length} match${hits.length === 1 ? '' : 'es'}`);
        list.innerHTML = hits.map((h, i) => `
          <li class="qf-hit${i === active ? ' active' : ''}" id="qf-${i}" role="option" aria-selected="${i === active}" data-i="${i}">
            <button type="button" class="qf-main" data-go="${i}" tabindex="-1">
              <span class="qf-line1"><strong class="qf-ref">${esc(h.ref)}</strong><span class="qf-type">${esc(h.type || '')}</span><span class="qf-state">${esc(h.statusLabel || '')}</span></span>
              <span class="qf-line2">${esc(h.company)}${h.contact ? ` · ${esc(h.contact)}` : ''}</span>
              ${h.title ? `<span class="qf-line3">${esc(h.title)}</span>` : ''}
            </button>
            <span class="qf-actions">
              <button type="button" class="qf-act" data-ws="${i}" tabindex="-1" title="Open its workspace">Workspace</button>
              ${h.email ? `<button type="button" class="qf-act" data-copy="email" data-ci="${i}" tabindex="-1" title="${esc(h.email)}">Copy email</button>` : ''}
              ${h.phone ? `<button type="button" class="qf-act" data-copy="phone" data-ci="${i}" tabindex="-1" title="${esc(h.phone)}">Copy phone</button>` : ''}
            </span>
          </li>`).join('');
        input.setAttribute('aria-activedescendant', `qf-${active}`);
      }

      async function run() {
        const q = input.value;
        if (!q.trim()) { hits = []; render(); return; }
        try {
          const data = await ensureIndex();
          if (q !== input.value) return; // a newer keystroke is already on its way
          hits = Core.search(data, q, 8);
          active = 0;
          render();
        } catch (e) { say(e.message); }
      }

      function go(h) {
        if (!h) return;
        const dest = Core.destination(h);
        const hash = `#find=${encodeURIComponent(h.ref)}`;
        A.close('find'); // you've found it: don't reopen over the card on the next page
        if (location.pathname === dest) location.hash = hash; else location.href = dest + hash;
      }

      async function openWorkspace(h) {
        say(`Opening the workspace for ${h.ref}…`);
        try {
          const r = await fetch('/api/admin/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: h.ref }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Could not open the workspace.');
          location.href = `/admin/workspace/${encodeURIComponent(j.id)}`;
        } catch (e) { say(e.message); }
      }

      input.addEventListener('input', run);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!hits.length) return;
          e.preventDefault();
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
          render();
          const a = list.querySelector('.qf-hit.active'); if (a) a.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          go(hits[active]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (input.value) { input.value = ''; hits = []; render(); } else A.close('find');
        }
      });

      list.addEventListener('click', async (e) => {
        const g = e.target.closest('[data-go]');
        if (g) { go(hits[Number(g.dataset.go)]); return; }
        const w = e.target.closest('[data-ws]');
        if (w) { openWorkspace(hits[Number(w.dataset.ws)]); return; }
        const c = e.target.closest('[data-copy]');
        if (c) {
          const h = hits[Number(c.dataset.ci)];
          const value = h && h[c.dataset.copy];
          try { await navigator.clipboard.writeText(value); say(`Copied ${c.dataset.copy}: ${value}`); } catch { say('Copy is blocked in this browser.'); }
        }
      });
      list.addEventListener('pointermove', (e) => {
        const li = e.target.closest('.qf-hit');
        if (li && Number(li.dataset.i) !== active) {
          active = Number(li.dataset.i);
          list.querySelectorAll('.qf-hit').forEach((x, i) => { x.classList.toggle('active', i === active); x.setAttribute('aria-selected', String(i === active)); });
          input.setAttribute('aria-activedescendant', `qf-${active}`);
        }
      });

      // Other accessories (reminders) can ask Quick find to look something up
      window.addEventListener('acc:find', (e) => {
        input.value = String(e.detail || '').slice(0, 120);
        run();
        setTimeout(() => { input.focus({ preventScroll: true }); }, 0);
      });

      // Each time it opens: fresh list (at most a minute old), text selected for a new search
      win.onOpen.push(({ focus }) => {
        ensureIndex().then(() => { if (!input.value.trim()) render(); else run(); }).catch((e) => say(e.message));
        if (focus) setTimeout(() => { input.focus({ preventScroll: true }); input.select(); }, 0);
      });
    },
  });
})();
