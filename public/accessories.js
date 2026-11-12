// Accessories: small retro tools that float over every admin page (calculator, quick find,
// notes, support timer, passwords, world clock, currency, dates & reminders, debrief, business card).
// This file is the frame they share:
//   - the long "Accessories" button under the session time, and the menu it opens
//   - draggable windows (pin + close in the top strip), remembered per browser
//   - a dock of up to 4 pinned favourites that lives in the top quarter of the screen
//   - Ctrl+K for Quick find, and #find=REF links that scroll to and flash a card on arrival
// Each accessory is its own file and calls Accessories.register({...}). Loaded by admin-shell.js.
//
// Window positions, pins and open state are per browser (localStorage). Storage can be blocked
// (private windows), so every read and write is wrapped and the tools still work without it.
(function () {
  const Core = window.AccCore;
  if (!Core || window.Accessories) return;

  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: fine */ } };
  const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const KEY = { pins: 'aw.acc.pins', dock: 'aw.acc.dock', open: (id) => `aw.acc.${id}.open`, pos: (id) => `aw.acc.${id}.pos` };
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MARGIN = 8;
  const svg = (inner, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const PIN = '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>';

  const registry = [];
  const wins = {};
  const status = {};
  let z = 90;

  // The signed-in admin (VAT rate, timezone) as admin-shell.js fetched it
  const me = Promise.resolve(window.AdminMe).then((m) => m || {}).catch(() => ({}));

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('accToast');
    if (!t) { t = document.createElement('div'); t.id = 'accToast'; t.className = 'acc-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  // ---------- Dragging (windows and the dock) ----------
  // place(el, pos, bounds) clamps a fixed element inside the viewport (or the dock's top quarter)
  function clampTo(el, p, maxYFn) {
    const w = el.offsetWidth; const h = el.offsetHeight;
    const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxY = Math.max(MARGIN, maxYFn ? maxYFn(h) : window.innerHeight - h - MARGIN);
    const x = Math.min(Math.max(MARGIN, p.x), maxX);
    const y = Math.min(Math.max(MARGIN, p.y), maxY);
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    return { x, y };
  }

  function draggable(el, handle, { getPos, setPos, maxY }) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, input, select, textarea, a')) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
      handle.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = (ev) => setPos(clampTo(el, { x: start.left + ev.clientX - start.x, y: start.top + ev.clientY - start.y }, maxY), false);
      const up = () => {
        el.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        setPos(getPos(), true);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    // Keyboard users: focus the strip and use the arrow keys
    handle.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
      if (!d || e.target !== handle) return;
      e.preventDefault(); e.stopPropagation();
      setPos(clampTo(el, { x: el.offsetLeft + d[0], y: el.offsetTop + d[1] }, maxY), true);
    });
  }

  // ---------- Windows ----------
  function makeWindow(def) {
    const el = document.createElement('div');
    el.className = `acc-win acc-${def.id} hidden`;
    el.id = `acc-${def.id}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', def.name);
    el.tabIndex = -1;
    if (def.width) el.style.width = `${def.width}px`;
    el.innerHTML = `
      <div class="acc-head" tabindex="0" aria-label="Move ${esc(def.name)} (arrow keys)">
        <span class="acc-grip" aria-hidden="true"></span>
        <span class="acc-model">${esc(def.model)}<small>${esc(def.label || def.name)}</small></span>
        <span class="acc-head-extra"></span>
        <button type="button" class="acc-icon" data-acc="pin" aria-pressed="false">${svg(PIN, 1.8)}</button>
        <button type="button" class="acc-icon" data-acc="close" title="Close" aria-label="Close ${esc(def.name)}">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 2)}</button>
      </div>
      <div class="acc-body"></div>`;
    document.body.appendChild(el);

    const win = {
      id: def.id, def, el,
      head: el.querySelector('.acc-head'),
      extra: el.querySelector('.acc-head-extra'),
      body: el.querySelector('.acc-body'),
      pos: load(KEY.pos(def.id), null),
      onOpen: [], onClose: [],
      place() {
        const w = el.offsetWidth; const h = el.offsetHeight;
        const idx = registry.indexOf(def);
        const fallback = def.defaultPos ? def.defaultPos(w, h) : { x: window.innerWidth - w - 24 - idx * 26, y: window.innerHeight - h - 24 - idx * 26 };
        win.pos = clampTo(el, win.pos || fallback);
      },
    };
    draggable(el, win.head, {
      getPos: () => win.pos,
      setPos: (p, done) => { win.pos = p; if (done) save(KEY.pos(def.id), p); },
    });
    // Clicking a window brings it to the front
    el.addEventListener('pointerdown', () => { el.style.zIndex = String(++z); }, true);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-acc]');
      if (!a || !el.contains(a)) return;
      if (a.dataset.acc === 'close') close(def.id);
      if (a.dataset.acc === 'pin') togglePin(def.id);
    });
    wins[def.id] = win;
    // Content that grows after opening (rates arriving, a list filling) must not push the
    // window off the screen: keep it inside whenever its size changes
    if (window.ResizeObserver) new ResizeObserver(() => { if (isOpen(def.id) && !el.classList.contains('dragging')) win.pos = clampTo(el, win.pos || { x: el.offsetLeft, y: el.offsetTop }); }).observe(el);
    def.build(win, api);
    syncPins();
    return win;
  }

  const isOpen = (id) => !!(wins[id] && !wins[id].el.classList.contains('hidden'));

  function open(id, { focus = true } = {}) {
    const def = registry.find((d) => d.id === id);
    if (!def) return null;
    const win = wins[id] || makeWindow(def);
    const was = isOpen(id);
    win.el.classList.remove('hidden');
    win.el.style.zIndex = String(++z);
    win.place();
    if (!was && !reduced()) { win.el.classList.remove('enter'); void win.el.offsetWidth; win.el.classList.add('enter'); }
    save(KEY.open(id), true);
    win.onOpen.forEach((fn) => fn({ focus }));
    if (focus && !win.el.contains(document.activeElement)) (win.focusTarget ? win.focusTarget() : win.el).focus({ preventScroll: true });
    syncState();
    return win;
  }

  function close(id) {
    const win = wins[id];
    if (!win) return;
    const hadFocus = win.el.contains(document.activeElement);
    win.el.classList.add('hidden');
    save(KEY.open(id), false);
    win.onClose.forEach((fn) => fn());
    syncState();
    if (hadFocus) (document.getElementById('accToggle') || document.body).focus({ preventScroll: true });
  }

  const toggle = (id) => (isOpen(id) ? close(id) : open(id));

  // ---------- Pins ----------
  const knownIds = () => registry.map((d) => d.id);
  let pins = [];
  function togglePin(id) {
    const out = Core.togglePin(pins, id, knownIds());
    if (out.full) toast(`You can pin up to ${Core.MAX_PINS}. Unpin one first.`);
    pins = out.pins;
    save(KEY.pins, pins);
    syncPins();
  }

  // ---------- Sidebar button + menu ----------
  let btn; let menu; let dock;
  function buildLauncher() {
    const meta = document.querySelector('.side-user-meta');
    if (!meta) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'accToggle';
    btn.className = 'side-acc';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'accMenu');
    btn.innerHTML = `${svg('<rect x="3.5" y="4" width="7" height="7" rx="1.5"/><rect x="13.5" y="4" width="7" height="7" rx="1.5"/><rect x="3.5" y="13" width="7" height="7" rx="1.5"/><path d="M17 13.5v6M14 16.5h6"/>')}
      <span>Accessories</span><span class="side-acc-count" aria-hidden="true"></span><span class="side-acc-led" aria-hidden="true"></span>`;
    meta.after(btn);

    menu = document.createElement('div');
    menu.id = 'accMenu';
    menu.className = 'acc-menu hidden';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Accessories');
    document.body.appendChild(menu);

    btn.addEventListener('click', () => (menu.classList.contains('hidden') ? showMenu() : hideMenu()));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) hideMenu(false);
    });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); hideMenu(); } });
    menu.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { const id = o.dataset.open; const opening = !isOpen(id); toggle(id); if (opening) hideMenu(false); return; }
      const p = e.target.closest('[data-pin]');
      if (p) togglePin(p.dataset.pin);
    });
  }

  function renderMenu() {
    if (!menu) return;
    menu.innerHTML = `
      <div class="acc-menu-head"><span>Accessories</span><span class="acc-menu-pins">Pinned ${pins.length}/${Core.MAX_PINS}</span></div>
      <ul class="acc-menu-list">
        ${registry.map((d) => {
          const on = isOpen(d.id); const pinned = pins.includes(d.id);
          const full = !pinned && pins.length >= Core.MAX_PINS;
          return `<li class="acc-item${status[d.id] ? ` is-${status[d.id]}` : ''}">
            <button type="button" class="acc-item-open" data-open="${esc(d.id)}" aria-pressed="${on}">
              <span class="acc-item-icon">${svg(d.icon)}</span>
              <span class="acc-item-text"><strong>${esc(d.name)}</strong><small>${esc(d.desc)}</small></span>
              <span class="acc-led${on ? ' on' : ''}" aria-hidden="true"></span>
            </button>
            <button type="button" class="acc-item-pin" data-pin="${esc(d.id)}" aria-pressed="${pinned}"${full ? ' aria-disabled="true"' : ''}
              title="${pinned ? 'Unpin from the dock' : full ? `Dock is full (${Core.MAX_PINS})` : 'Pin to the dock'}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${esc(d.name)}">${svg(PIN, 1.8)}</button>
          </li>`;
        }).join('')}
      </ul>
      <div class="acc-menu-foot">Pin up to ${Core.MAX_PINS} to the dock at the top of the page. <kbd>Ctrl</kbd>+<kbd>K</kbd> opens Quick find.</div>`;
  }

  function placeMenu() {
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth; const h = menu.offsetHeight;
    let x; let y;
    if (window.innerWidth > 860) { x = r.right + 12; y = r.bottom - h; } // beside the sidebar, bottoms level
    else { x = r.right - w; y = r.bottom + 6; } // under the button on phones
    clampTo(menu, { x, y });
  }

  function showMenu() {
    renderMenu();
    menu.classList.remove('hidden');
    menu.style.zIndex = String(++z + 5);
    placeMenu();
    btn.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('[data-open]');
    if (first) first.focus({ preventScroll: true });
  }
  function hideMenu(refocus = true) {
    if (!menu || menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus({ preventScroll: true });
  }

  // ---------- Dock: pinned favourites, kept in the top quarter of the screen ----------
  let dockPos = load(KEY.dock, null);
  const dockMaxY = (h) => Math.max(MARGIN, Math.round(window.innerHeight * 0.25) - h);
  function buildDock() {
    dock = document.createElement('div');
    dock.id = 'accDock';
    dock.className = 'acc-dock hidden';
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Pinned accessories');
    document.body.appendChild(dock);
    dock.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) toggle(o.dataset.open); });
  }
  function renderDock() {
    if (!dock) return;
    const list = pins.map((id) => registry.find((d) => d.id === id)).filter(Boolean);
    dock.classList.toggle('hidden', !list.length);
    if (!list.length) return;
    const focused = dock.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.open : null;
    dock.innerHTML =`<span class="acc-dock-grip" tabindex="0" aria-label="Move the dock (arrow keys)" title="Drag to move"></span>
      ${list.map((d) => `<button type="button" class="acc-dock-btn${status[d.id] ? ` is-${status[d.id]}` : ''}" data-open="${esc(d.id)}" aria-pressed="${isOpen(d.id)}" title="${esc(d.name)}">
        ${svg(d.icon)}<span>${esc(d.short || d.name)}</span><span class="acc-led${isOpen(d.id) ? ' on' : ''}" aria-hidden="true"></span></button>`).join('')}`;
    const grip = dock.querySelector('.acc-dock-grip');
    draggable(dock, grip, {
      getPos: () => dockPos,
      setPos: (p, done) => { dockPos = p; if (done) save(KEY.dock, p); },
      maxY: dockMaxY,
    });
    placeDock();
    if (focused) { const b = dock.querySelector(`[data-open="${CSS.escape(focused)}"]`); if (b) b.focus({ preventScroll: true }); }
  }
  function placeDock() {
    if (!dock || dock.classList.contains('hidden')) return;
    const fallback = { x: window.innerWidth - dock.offsetWidth - 22, y: 14 };
    dockPos = clampTo(dock, dockPos || fallback, dockMaxY);
  }

  // Keep the button, menu, dock and pin buttons in step with what's open
  function syncState() {
    if (btn) {
      const openCount = registry.filter((d) => isOpen(d.id)).length;
      btn.querySelector('.side-acc-count').textContent = openCount ? String(openCount) : '';
      btn.classList.toggle('is-running', Object.values(status).includes('running'));
      btn.classList.toggle('is-due', Object.values(status).includes('due'));
    }
    if (menu && !menu.classList.contains('hidden')) { renderMenu(); placeMenu(); }
    renderDock();
  }
  function syncPins() {
    Object.values(wins).forEach((w) => {
      const b = w.el.querySelector('[data-acc="pin"]');
      const pinned = pins.includes(w.id);
      b.setAttribute('aria-pressed', String(pinned));
      b.title = pinned ? 'Unpin from the dock' : 'Pin to the dock';
      b.setAttribute('aria-label', b.title);
    });
    syncState();
  }

  // An accessory can flag itself (e.g. the timer while it's running)
  function setStatus(id, s) { if (status[id] === (s || undefined)) return; if (s) status[id] = s; else delete status[id]; syncState(); }

  // ---------- #find=REF: scroll to and flash the card showing that text ----------
  function findOnPage(needle) {
    const root = document.querySelector('.shell-main') || document.body;
    const lower = needle.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.toLowerCase().includes(lower) && n.parentElement && n.parentElement.offsetParent !== null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const n = walker.nextNode();
    if (!n) return null;
    return n.parentElement.closest('.card, article, li, tr, .ws-tile, [class*="card"], [class*="row"]') || n.parentElement;
  }
  function highlightFromHash() {
    const m = location.hash.match(/^#find=(.+)$/);
    if (!m) return;
    let needle = '';
    try { needle = decodeURIComponent(m[1]).trim().slice(0, 120); } catch { return; }
    history.replaceState(null, '', location.pathname + location.search);
    if (!needle) return;
    const t0 = Date.now();
    (function tryFind() {
      const el = findOnPage(needle);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        el.classList.remove('acc-found'); void el.offsetWidth; el.classList.add('acc-found');
        setTimeout(() => el.classList.remove('acc-found'), 2600);
        return;
      }
      if (Date.now() - t0 < 6000) setTimeout(tryFind, 250);
      else toast(`${needle} isn't listed on this page. It may be finished or closed.`);
    })();
  }

  // ---------- Start-up ----------
  function register(def) { if (!registry.some((d) => d.id === def.id)) registry.push(def); }

  function init() {
    pins = Core.togglePin(load(KEY.pins, []), '__none__', knownIds()).pins;
    buildLauncher();
    buildDock();
    registry.forEach((d) => { if (d.init) d.init(api); });
    registry.forEach((d) => { if (load(KEY.open(d.id), false)) open(d.id, { focus: false }); });
    syncState();
    highlightFromHash();
    window.addEventListener('hashchange', highlightFromHash);
    window.addEventListener('resize', () => {
      Object.values(wins).forEach((w) => { if (isOpen(w.id)) w.place(); });
      placeDock();
      if (menu && !menu.classList.contains('hidden')) placeMenu();
    });
    // Ctrl+K (Cmd+K on a Mac): Quick find from anywhere in the admin
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' && registry.some((d) => d.id === 'find')) {
        e.preventDefault();
        open('find');
      }
    });
  }

  const api = { register, open, close, toggle, isOpen, setStatus, toast, me, load, save, esc, svg };
  window.Accessories = api;

  // Load the accessories in order (async = false keeps the order), then start. Bump V when any of
  // these files change, so browsers fetch the new copy instead of a cached one.
  const V = 'acc-4';
  const PARTS = ['/calc-core.js', '/calculator.js', '/quickfind.js', '/notes.js', '/timer.js', '/passgen.js', '/worldclock.js', '/fx.js', '/dates.js', '/debrief.js', '/bizcard.js'];
  ['/accessories.css', '/calculator.css'].forEach((href) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `${href}?v=${V}`; document.head.appendChild(l);
  });
  PARTS.forEach((src, i) => {
    const s = document.createElement('script');
    s.src = `${src}?v=${V}`; s.async = false;
    if (i === PARTS.length - 1) { s.onload = init; s.onerror = init; } // whatever loaded still works
    document.body.appendChild(s);
  });
})();
