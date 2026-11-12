// Accessory: Notes. A lined notepad for calls and workings, with up to 9 pages.
// Saved to your admin account, ENCRYPTED on the server (CREDENTIALS_KEY, /api/admin/notes), so
// the same notes follow you to any device. This browser keeps a working copy so typing is
// instant and nothing is lost offline; it syncs a moment after you stop typing, and the copy is
// removed when you sign out. Without CREDENTIALS_KEY (or before schema_accessories.sql is run)
// the notes stay in this browser only, as before.
//
// "Save" files the page under its first line as a saved note (also encrypted, /api/admin/notes/
// saved); saving again updates that same note. "Saved" lists them: search, open one back onto a
// page, or delete it. Browser-only mode keeps saved notes in this browser and moves them to your
// account once it can.
// Not for passwords or client secrets: those belong in the workspace's secrets.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { load, save, esc } = A;
  const KEY = 'aw.notes';
  const SAVED_KEY = 'aw.notes.saved';
  const MAX_PAGES = 9;
  const MAX_CHARS = 20000;
  const MAX_LOCAL_SAVED = 50;
  const SYNC_MS = 1500;

  const clean = (s) => {
    const pages = Array.isArray(s && s.pages) ? s.pages.filter((p) => p && typeof p.text === 'string').slice(0, MAX_PAGES) : [];
    if (!pages.length) pages.push({ text: '', at: Date.now() });
    const i = Math.min(Math.max(0, Number(s && s.i) || 0), pages.length - 1);
    return { pages, i, owner: (s && s.owner) || null, base: (s && s.base) || null, dirty: !!(s && s.dirty) };
  };
  const hasText = (pages) => pages.some((p) => p.text.trim());
  const beforeSignOut = (fn) => { (window.AdminBeforeSignOut = window.AdminBeforeSignOut || []).push(fn); };
  // Same rule as the server: the first line, without a leading [date] stamp
  const titleOf = (text) => {
    const line = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    return (line.replace(/^\[[^\]]{1,40}\]\s*/, '') || line || 'Untitled note').slice(0, 80);
  };
  const when = (t) => {
    const d = new Date(t); const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };

  A.register({
    id: 'notes',
    name: 'Notes',
    short: 'Notes',
    desc: 'A notepad for calls and workings. Save notes to keep them. Encrypted in your account.',
    model: 'AW-NOTE',
    label: 'notepad',
    width: 300,
    icon: '<path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5v3h3M9 11h6M9 14h6M9 17h4"/>',
    // First opening: left of the timer, which sits left of the calculator (bottom right)
    defaultPos: (w, h) => ({ x: window.innerWidth - 24 - 236 - 14 - 256 - 14 - w, y: window.innerHeight - h - 24 }),

    // Runs on every admin page, even when the notepad isn't open: on sign-out, forget this
    // browser's copy if it's safely in the account (unsynced or browser-only notes are kept)
    init() {
      beforeSignOut(() => {
        const s = load(KEY, null);
        if (s && s.base && !s.dirty) { try { localStorage.removeItem(KEY); } catch { /* fine */ } }
      });
    },

    build(win) {
      let st = clean(load(KEY, null));
      let timeZone = 'Africa/Harare';
      // 'checking' → 'synced' | 'saving' | 'offline' | 'local' (browser only: no key / no table)
      let mode = 'checking';
      let loaded = false;
      let me = {};

      win.body.innerHTML = `
        <div class="nt-paper">
          <textarea class="nt-text" aria-label="Note" maxlength="${MAX_CHARS}" placeholder="Type a note…" spellcheck="true"></textarea>
          <section class="nt-saved hidden" aria-label="Saved notes">
            <div class="nt-saved-head">
              <input type="search" class="nt-search" placeholder="Search saved notes" aria-label="Search saved notes" autocomplete="off">
              <button type="button" class="nt-back" data-nt="back" title="Back to the notepad">Back</button>
            </div>
            <ul class="nt-saved-list" aria-live="polite"></ul>
            <p class="nt-saved-foot"></p>
          </section>
        </div>
        <div class="nt-bar">
          <button type="button" class="nt-key" data-nt="prev" aria-label="Previous page">◀</button>
          <span class="nt-page" aria-live="polite"></span>
          <button type="button" class="nt-key" data-nt="next" aria-label="Next page">▶</button>
          <button type="button" class="nt-key wide" data-nt="new" title="Start a new page">+ Page</button>
        </div>
        <div class="nt-bar">
          <button type="button" class="nt-key wide save" data-nt="save" title="Keep this page as a saved note">Save</button>
          <button type="button" class="nt-key wide" data-nt="saved" title="See saved notes" aria-pressed="false">Saved<span class="nt-count"></span></button>
        </div>
        <div class="nt-bar">
          <button type="button" class="nt-key wide" data-nt="stamp" title="Insert the date and time">Stamp</button>
          <button type="button" class="nt-key wide" data-nt="copy" title="Copy this page">Copy</button>
          <button type="button" class="nt-key wide danger" data-nt="clear"></button>
        </div>
        <div class="nt-meta" aria-live="polite"></div>`;

      const $ = (s) => win.body.querySelector(s);
      const ta = $('.nt-text');
      const pageEl = $('.nt-page');
      const meta = $('.nt-meta');
      const clearBtn = $('[data-nt="clear"]');
      const savedPanel = $('.nt-saved');
      const savedList = $('.nt-saved-list');
      const search = $('.nt-search');
      win.focusTarget = () => (viewing ? search : ta);
      let armed = null;
      let saveTimer = null;
      let syncTimer = null;
      let syncing = null;
      let flash = '';
      let viewing = false;
      let savedNotes = null; // [{ id, title, preview, chars, updated_at }] once loaded
      let delArmed = null;

      const page = () => st.pages[st.i];
      function persist() { save(KEY, st); }
      function disarm() { clearTimeout(armed); armed = null; renderBar(); }

      const WHERE = {
        checking: 'checking your account…',
        synced: 'saved to your account',
        saving: 'saving…',
        offline: 'not synced yet · kept in this browser',
        local: 'kept in this browser only',
      };
      function renderBar() {
        pageEl.textContent = `Page ${st.i + 1}/${st.pages.length}`;
        $('[data-nt="prev"]').disabled = viewing || st.i === 0;
        $('[data-nt="next"]').disabled = viewing || st.i === st.pages.length - 1;
        $('[data-nt="new"]').disabled = viewing || st.pages.length >= MAX_PAGES;
        $('[data-nt="save"]').disabled = viewing || !page().text.trim();
        ['stamp', 'copy', 'clear'].forEach((k) => { $(`[data-nt="${k}"]`).disabled = viewing; });
        const removing = !page().text && st.pages.length > 1;
        clearBtn.textContent = armed ? 'Sure?' : removing ? 'Remove' : 'Clear';
        clearBtn.title = removing ? 'Remove this empty page' : 'Clear this page (a saved copy stays saved)';
        clearBtn.classList.toggle('armed', !!armed);
        const savedBtn = $('[data-nt="saved"]');
        savedBtn.setAttribute('aria-pressed', String(viewing));
        $('.nt-count').textContent = savedNotes && savedNotes.length ? ` (${savedNotes.length})` : '';
        const p = page();
        const saveState = !p.savedId ? '' : p.at > (p.savedAt || 0) + 500 ? ' · edited since saved' : ` · saved ${when(p.savedAt)}`;
        $('[data-nt="save"]').textContent = p.savedId ? 'Save again' : 'Save';
        const n = p.text.length;
        meta.textContent = flash || (viewing
          ? `${savedNotes ? savedNotes.length : '…'} saved note${savedNotes && savedNotes.length === 1 ? '' : 's'} · ${savedMode === 'local' ? 'in this browser only' : 'encrypted in your account'}`
          : `${n.toLocaleString('en-US')} character${n === 1 ? '' : 's'} · ${WHERE[mode]}${saveState}`);
        meta.dataset.mode = mode;
      }
      function show() { ta.value = page().text; renderBar(); }
      function note(msg) { flash = msg; renderBar(); setTimeout(() => { flash = ''; renderBar(); }, 2200); }

      // ---------- Sync the pages with the server ----------
      async function request(method, body, url = '/api/admin/notes') {
        const r = await fetch(url, {
          method, cache: 'no-store',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, ok: r.ok, j };
      }

      async function push(retry = true) {
        if (mode === 'local' || !loaded) return;
        clearTimeout(syncTimer); syncTimer = null;
        const sent = JSON.stringify(st.pages);
        mode = 'saving'; renderBar();
        try {
          const { status, ok, j } = await request('PUT', { pages: st.pages, base: st.base });
          if (ok) {
            st.base = j.updated_at;
            st.dirty = JSON.stringify(st.pages) !== sent; // typed more while it was saving?
            persist();
            mode = 'synced';
            if (st.dirty) schedule();
          } else if (status === 409 && Array.isArray(j.pages) && retry) {
            // Changed on another device since we loaded: keep both, then save the merge
            st.pages = Core.mergeNotes(j.pages, st.pages, { maxPages: MAX_PAGES, maxChars: MAX_CHARS });
            st.base = j.updated_at; st.i = Math.min(st.i, st.pages.length - 1); persist();
            if (document.activeElement !== ta) show();
            note('Merged with notes from another device');
            return push(false);
          } else if (status === 400 && j.configured === false) {
            mode = 'local';
          } else {
            mode = 'offline';
          }
        } catch { mode = 'offline'; }
        renderBar();
      }
      function schedule() {
        if (mode === 'local' || !loaded) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => { syncing = push().finally(() => { syncing = null; }); }, SYNC_MS);
      }

      async function pull() {
        try {
          const { status, ok, j } = await request('GET');
          if (!ok || j.configured === false) { mode = ok || status === 503 ? 'local' : 'offline'; renderBar(); return; }
          loaded = true;
          if (!j.pages) {
            // Nothing in the account yet: move this browser's notes up (a one-off)
            mode = 'synced';
            if (hasText(st.pages)) { st.dirty = true; await push(); } else renderBar();
            return;
          }
          if (st.dirty && hasText(st.pages)) {
            // Unsynced typing here: keep it, merging if the account moved on meanwhile
            if (st.base !== j.updated_at) {
              st.pages = Core.mergeNotes(j.pages, st.pages, { maxPages: MAX_PAGES, maxChars: MAX_CHARS });
              st.i = Math.min(st.i, st.pages.length - 1);
              note('Merged with notes from another device');
            }
            st.base = j.updated_at; persist(); show();
            await push();
            return;
          }
          mode = 'synced';
          st = clean({ pages: j.pages, i: st.i, owner: st.owner, base: j.updated_at, dirty: false });
          persist();
          if (document.activeElement !== ta) show(); else renderBar();
        } catch { mode = 'offline'; renderBar(); }
      }

      // ---------- Saved notes: in your account (encrypted), or in this browser as a fallback ----------
      let savedMode = 'unknown'; // 'server' | 'local'
      const localSaved = () => { const v = load(SAVED_KEY, null); return v && v.owner === (me.id || null) && Array.isArray(v.notes) ? v.notes : []; };
      const putLocalSaved = (notes) => save(SAVED_KEY, { owner: me.id || null, notes: notes.slice(0, MAX_LOCAL_SAVED) });
      const preview = (text) => text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      const local = {
        list: () => localSaved().map((n) => ({ id: n.id, title: n.title, preview: preview(n.text), chars: n.text.length, updated_at: n.updated_at })),
        get: (id) => localSaved().find((n) => n.id === id) || null,
        create(text) {
          const notes = localSaved();
          if (notes.length >= MAX_LOCAL_SAVED) throw new Error(`This browser holds up to ${MAX_LOCAL_SAVED} saved notes. Delete some first.`);
          const now = new Date().toISOString();
          const n = { id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, title: titleOf(text), text, created_at: now, updated_at: now };
          putLocalSaved([n, ...notes]); return n;
        },
        update(id, text) {
          const notes = localSaved(); const n = notes.find((x) => x.id === id);
          if (!n) return null;
          Object.assign(n, { text, title: titleOf(text), updated_at: new Date().toISOString() });
          putLocalSaved([n, ...notes.filter((x) => x.id !== id)]); return n;
        },
        remove(id) { putLocalSaved(localSaved().filter((x) => x.id !== id)); },
      };
      async function api(method, url, body) {
        const { ok, status, j } = await request(method, body, url);
        if (!ok) throw Object.assign(new Error(j.error || 'Could not reach your saved notes.'), { status, configured: j.configured });
        return j;
      }

      async function loadSaved() {
        try {
          const j = await api('GET', '/api/admin/notes/saved');
          if (j.configured === false) throw Object.assign(new Error('no key'), { status: 400 });
          savedMode = 'server';
          // Notes saved here while browser-only: move them into your account (a one-off)
          const pending = localSaved();
          if (pending.length) {
            for (const n of pending.slice().reverse()) {
              try {
                const made = await api('POST', '/api/admin/notes/saved', { text: n.text });
                st.pages.forEach((p) => { if (p.savedId === n.id) p.savedId = made.id; });
                local.remove(n.id);
              } catch { break; }
            }
            persist(); schedule();
            return loadSaved();
          }
          savedNotes = j.notes;
        } catch (e) {
          // No table yet (503), no CREDENTIALS_KEY (400 / configured:false): keep them in this browser
          if (e.status === 503 || e.status === 400 || e.configured === false) { savedMode = 'local'; savedNotes = local.list(); } else if (!savedNotes) savedNotes = null;
        }
        renderBar();
        if (viewing) renderSaved();
      }

      async function saveNote() {
        const p = page();
        const text = p.text;
        if (!text.trim()) { note('Nothing on this page to save'); return; }
        if (savedMode === 'unknown') await loadSaved();
        const btn = $('[data-nt="save"]'); btn.disabled = true;
        try {
          let made = null;
          if (savedMode === 'server') {
            if (p.savedId && !/^local-/.test(p.savedId)) {
              try { made = await api('PUT', `/api/admin/notes/saved/${encodeURIComponent(p.savedId)}`, { text }); } catch (e) { if (e.status !== 404) throw e; } // deleted meanwhile: save a new one
            }
            if (!made) made = await api('POST', '/api/admin/notes/saved', { text });
          } else {
            made = (p.savedId && local.update(p.savedId, text)) || local.create(text);
          }
          p.savedId = made.id; p.savedAt = Date.now(); p.at = p.savedAt;
          changed();
          await loadSaved();
          note(`Saved as “${made.title}”`);
        } catch (e) { note(e.message); }
        renderBar();
      }

      function renderSaved() {
        const q = search.value.trim().toLowerCase();
        const all = savedNotes || [];
        const list = q ? all.filter((n) => `${n.title} ${n.preview || ''}`.toLowerCase().includes(q)) : all;
        savedList.innerHTML = savedNotes === null
          ? '<li class="nt-saved-empty">Couldn’t load your saved notes. Check your connection.</li>'
          : list.map((n) => `<li class="nt-saved-item">
              <button type="button" class="nt-saved-open" data-open-note="${esc(n.id)}" title="Open on a page">
                <strong>${esc(n.title)}</strong>
                <span class="nt-saved-when">${esc(when(n.updated_at))}</span>
                ${n.preview ? `<span class="nt-saved-preview">${esc(n.preview)}</span>` : ''}
              </button>
              <button type="button" class="nt-saved-del${delArmed === n.id ? ' armed' : ''}" data-del-note="${esc(n.id)}" aria-label="Delete ${esc(n.title)}" title="Delete">${delArmed === n.id ? 'Sure?' : '×'}</button>
            </li>`).join('') || `<li class="nt-saved-empty">${q ? `Nothing matches “${esc(q)}”.` : 'No saved notes yet. Write something on a page and press <strong>Save</strong>.'}</li>`;
        $('.nt-saved-foot').textContent = savedMode === 'local'
          ? 'Kept in this browser only (they move to your account once notes sync is on).'
          : 'Encrypted in your account. Opening one puts it on a page; Save again updates it.';
      }

      function showSaved(on) {
        viewing = on;
        delArmed = null;
        savedPanel.classList.toggle('hidden', !on);
        ta.classList.toggle('hidden', on);
        if (on) { renderSaved(); loadSaved(); setTimeout(() => search.focus({ preventScroll: true }), 0); } else { search.value = ''; ta.focus({ preventScroll: true }); }
        renderBar();
      }

      async function openNote(id) {
        // Already on a page? Just go there
        const already = st.pages.findIndex((p) => p.savedId === id);
        if (already >= 0) { st.i = already; persist(); showSaved(false); show(); return; }
        let n;
        try { n = savedMode === 'server' ? await api('GET', `/api/admin/notes/saved/${encodeURIComponent(id)}`) : local.get(id); } catch (e) { note(e.message); return; }
        if (!n) { note('That note has gone (deleted on another device?)'); loadSaved(); return; }
        let target = st.i;
        if (page().text.trim()) {
          const empty = st.pages.findIndex((p) => !p.text.trim());
          if (empty >= 0) target = empty;
          else if (st.pages.length < MAX_PAGES) { st.pages.push({ text: '', at: Date.now() }); target = st.pages.length - 1; } else { note(`All ${MAX_PAGES} pages are in use. Clear one first.`); return; }
        }
        st.i = target;
        Object.assign(page(), { text: n.text, savedId: n.id, savedAt: Date.now(), at: Date.now() });
        changed(); showSaved(false); show();
        note(`Opened “${n.title}”`);
      }

      async function deleteNote(id) {
        if (delArmed !== id) { delArmed = id; renderSaved(); setTimeout(() => { if (delArmed === id) { delArmed = null; if (viewing) renderSaved(); } }, 3000); return; }
        delArmed = null;
        try {
          if (savedMode === 'server') await api('DELETE', `/api/admin/notes/saved/${encodeURIComponent(id)}`); else local.remove(id);
        } catch (e) { note(e.message); return; }
        // A page showing that note stays as it is, just no longer linked to it
        st.pages.forEach((p) => { if (p.savedId === id) { delete p.savedId; delete p.savedAt; } });
        changed();
        savedNotes = (savedNotes || []).filter((n) => n.id !== id);
        renderSaved(); renderBar();
        loadSaved();
      }

      // A different admin signed in on this browser? Their copy isn't yours: start from the account
      A.me.then((m) => {
        me = m || {};
        if (me.timezone) timeZone = me.timezone;
        if (me.id) {
          if (st.owner && st.owner !== me.id) st = clean(null);
          st.owner = me.id; persist();
        }
        show();
        pull();
        loadSaved();
      });

      // Signing out with the notepad open: save anything waiting first
      beforeSignOut(async () => {
        if (st.dirty && loaded && mode !== 'local') await push();
        else if (syncing) await syncing;
      });

      ta.addEventListener('input', () => {
        page().text = ta.value; page().at = Date.now(); st.dirty = true;
        clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250);
        schedule();
        if (armed) disarm(); else renderBar();
      });
      // Leaving the notepad: don't wait for the pause, save now
      ta.addEventListener('blur', () => { if (st.dirty && syncTimer) { persist(); push(); } });
      // Ctrl+S saves the page as a note (instead of the browser's "save web page")
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveNote(); }
      });
      search.addEventListener('input', renderSaved);
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (search.value) { search.value = ''; renderSaved(); } else showSaved(false); }
        if (e.key === 'Enter') { const first = savedList.querySelector('[data-open-note]'); if (first) { e.preventDefault(); openNote(first.dataset.openNote); } }
      });

      function changed() { st.dirty = true; persist(); schedule(); }

      function stamp() {
        const at = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
        const text = `[${at}] `;
        const s = ta.selectionStart; const e = ta.selectionEnd;
        const before = ta.value.slice(0, s);
        const lead = before && !before.endsWith('\n') ? '\n' : '';
        ta.setRangeText(lead + text, s, e, 'end');
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }

      win.body.addEventListener('click', async (e) => {
        const o = e.target.closest('[data-open-note]'); if (o) { openNote(o.dataset.openNote); return; }
        const d = e.target.closest('[data-del-note]'); if (d) { deleteNote(d.dataset.delNote); return; }
        const b = e.target.closest('[data-nt]');
        if (!b || b.disabled) return;
        const act = b.dataset.nt;
        if (act !== 'clear' && armed) disarm();
        if (act === 'prev' && st.i > 0) { st.i -= 1; persist(); show(); }
        if (act === 'next' && st.i < st.pages.length - 1) { st.i += 1; persist(); show(); }
        if (act === 'new' && st.pages.length < MAX_PAGES) { st.pages.push({ text: '', at: Date.now() }); st.i = st.pages.length - 1; changed(); show(); ta.focus(); }
        if (act === 'save') saveNote();
        if (act === 'saved') showSaved(!viewing);
        if (act === 'back') showSaved(false);
        if (act === 'stamp') stamp();
        if (act === 'copy') {
          try { await navigator.clipboard.writeText(page().text); note('Copied this page'); } catch { note('Copy is blocked in this browser'); }
        }
        if (act === 'clear') {
          // Two steps, so a stray click never wipes a page
          if (!armed) { armed = setTimeout(disarm, 3000); renderBar(); return; }
          clearTimeout(armed); armed = null;
          if (!page().text && st.pages.length > 1) { st.pages.splice(st.i, 1); st.i = Math.max(0, st.i - 1); } else { page().text = ''; delete page().savedId; delete page().savedAt; }
          changed(); show(); ta.focus();
        }
      });

      // Another tab changed the notes: follow it unless you're typing here right now
      window.addEventListener('storage', (e) => {
        if (e.key === SAVED_KEY && savedMode === 'local') { savedNotes = local.list(); renderBar(); if (viewing) renderSaved(); return; }
        if (e.key !== KEY || document.activeElement === ta) return;
        const next = load(KEY, null);
        if (!next) return;
        st = clean(next);
        show();
      });
      // Back to this tab with nothing unsaved: pick up edits made on another device
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && loaded && mode === 'synced' && !st.dirty && A.isOpen('notes')) pull();
      });
      win.onClose.push(() => { if (viewing) showSaved(false); });

      show();
    },
  });
})();
