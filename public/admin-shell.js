// Admin shell: wraps every admin page in the sidebar layout.
// Pages declare which nav item is active with <body data-page="...">.
// Pages fill the green header band's numbers with window.setBandStats([...]).
(function () {
  const NAV = [
    { key: 'pipeline', href: '/admin', label: 'Pipeline',
      icon: '<path d="M4 6h16M4 12h10M4 18h6" />' },
    { key: 'delivery', href: '/admin/projects', label: 'Project delivery',
      icon: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 9.5l2 2 4-4M7.5 15h9"/>' },
    { key: 'earnings', href: '/admin/earnings', label: 'Earnings',
      icon: '<path d="M4 19V10M10 19V5M16 19v-6M22 19H2"/>' },
    { key: 'domains', href: '/admin/domains', label: 'Domains',
      icon: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.5 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.5-3.5-8.5s1.1-5.9 3.5-8.5z"/>' },
    { key: 'consultancy', href: '/admin/consultancy', label: 'Consultancy',
      icon: '<path d="M4 5.5h16v10H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>' },
    { key: 'workspace', href: '/admin/workspace', label: 'Workspace',
      icon: '<rect x="3.5" y="4.5" width="17" height="13" rx="2"/><path d="M8 20.5h8M12 17.5v3M7.5 9l2.5 2-2.5 2M12.5 13h4"/>' },
    { key: 'contacts', href: '/admin/contacts', label: 'Contacts',
      icon: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.4c1.7.6 2.7 2.2 3 4.6"/>' },
    { key: 'billing', href: '/admin/billing', label: 'Billing',
      icon: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>' },
    { key: 'followups', href: '/admin/follow-ups', label: 'Follow-ups',
      icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' },
  ];

  const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const page = document.body.dataset.page;
  const main = document.querySelector('main');
  if (!main) return;

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <aside class="side">
      <a class="side-brand" href="/admin" aria-label="AutoWerke | IT admin">
        <img src="/brand/autowerke-it-logo-light.svg" alt="AutoWerke | IT">
      </a>
      <div class="side-label">Workspace</div>
      <nav class="side-nav">
        ${NAV.map((n) => `
          <a href="${n.href}" class="${n.key === page ? 'on' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${n.icon}</svg>
            <span>${n.label}</span>
            <span class="side-count" data-count="${n.key}"></span>
          </a>`).join('')}
      </nav>
      <div class="side-user">
        <div class="side-user-name" id="sideUser">Signed in</div>
        <div class="side-user-meta"><button type="button" class="side-clock" id="sideClockBtn" title="Click to switch between this session and all time" aria-live="off"><span id="sideClock">00:00</span> <span id="sideClockLabel">this session</span></button></div>
        <button type="button" class="side-signout" id="signOut">Sign out</button>
      </div>
      <div class="side-foot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        <span>Internal admin. Nothing here is visible to clients.</span>
      </div>
    </aside>
    <div class="shell-main"></div>`;

  main.before(shell);
  shell.querySelector('.shell-main').appendChild(main);

  // Header band numbers: [{ label, value, sub }]
  window.setBandStats = function (stats) {
    const el = document.querySelector('.band-stats');
    if (!el) return;
    el.innerHTML = stats.map((s) => `
      <div class="band-stat">
        <div class="band-stat-label">${esc(s.label)}</div>
        <div class="band-stat-value">${esc(s.value)}</div>
        ${s.sub ? `<div class="band-stat-sub">${esc(s.sub)}</div>` : ''}
      </div>`).join('');
  };

  // ---------- Who's signed in, sign out, session clock ----------
  // Shared so other shell add-ons (the accessories' VAT rate and timezone) don't ask again
  window.AdminMe = fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  window.AdminMe.then((me) => {
    if (me) document.getElementById('sideUser').textContent = me.name;
  });

  // ---------- Accessories (button under the session time; see accessories.js) ----------
  ['/acc-core.js', '/accessories.js'].forEach((src) => {
    const s = document.createElement('script');
    s.src = `${src}?v=acc-4`; s.async = false; // bump with V in accessories.js
    document.body.appendChild(s);
  });

  // Accessories can finish up first (Notes saves to your account, then forgets this browser's copy).
  // Never holds sign-out up for more than 1.5 seconds.
  window.AdminBeforeSignOut = window.AdminBeforeSignOut || [];
  async function signOut(reason) {
    try {
      await Promise.race([
        Promise.all(window.AdminBeforeSignOut.map((fn) => Promise.resolve().then(fn).catch(() => {}))),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch { /* signing out anyway */ }
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* signing out anyway */ }
    location.href = `/admin/login${reason ? `?next=${encodeURIComponent(location.pathname)}` : ''}`;
  }
  document.getElementById('signOut').addEventListener('click', () => signOut());

  // The clock counts from when you signed in (the server's record), so a refresh doesn't reset it.
  // Click it to switch to all-time signed-in time (every session added up, see /api/auth/time).
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };
  const CLOCK_KEY = 'aw.clock.mode';
  let clockMode = 'session';
  try { if (localStorage.getItem(CLOCK_KEY) === 'all') clockMode = 'all'; } catch { /* private window */ }
  // Times are kept as "server time minus this computer's time", so a wrong PC clock doesn't matter
  let sessionStart = Date.now(); // until /api/auth/me answers
  let skew = 0;
  let allTime = null; // { ms, at } all-time total as of local time "at"
  let allTimeInfo = '';
  window.AdminMe.then((me) => {
    if (!me || !me.sessionStartedAt) return;
    const server = Date.parse(me.serverNow);
    if (Number.isFinite(server)) skew = server - Date.now();
    const st = Date.parse(me.sessionStartedAt);
    if (Number.isFinite(st)) sessionStart = st - skew;
    tick();
  });
  let loadingAll = null;
  function loadAllTime() {
    if (loadingAll) return loadingAll;
    loadingAll = fetch('/api/auth/time').then((r) => (r.ok ? r.json() : null)).then((t) => {
      if (!t || !Number.isFinite(t.allTimeMs)) return;
      allTime = { ms: t.allTimeMs, at: Date.now() };
      const since = t.since ? new Date(t.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      allTimeInfo = `${t.sessions} session${t.sessions === 1 ? '' : 's'}${since ? ` since ${since}` : ''}`;
      tick();
    }).catch(() => {}).finally(() => { loadingAll = null; });
    return loadingAll;
  }
  const clockBtn = document.getElementById('sideClockBtn');
  function tick() {
    const el = document.getElementById('sideClock');
    const label = document.getElementById('sideClockLabel');
    if (clockMode === 'all') {
      el.textContent = allTime ? fmt(allTime.ms + Date.now() - allTime.at) : '…';
      label.textContent = 'all time';
      clockBtn.title = `Signed in all time${allTimeInfo ? ` (${allTimeInfo})` : ''}. Click for this session.`;
    } else {
      el.textContent = fmt(Date.now() - sessionStart);
      label.textContent = 'this session';
      clockBtn.title = 'Signed in this session. Click for all time.';
    }
    clockBtn.setAttribute('aria-label', `${el.textContent} ${label.textContent}. Switch to ${clockMode === 'all' ? 'this session' : 'all time'}`);
  }
  clockBtn.addEventListener('click', () => {
    clockMode = clockMode === 'all' ? 'session' : 'all';
    try { localStorage.setItem(CLOCK_KEY, clockMode); } catch { /* fine */ }
    if (clockMode === 'all') loadAllTime(); // fresh total each time you switch to it
    tick();
  });
  if (clockMode === 'all') loadAllTime();
  tick();
  setInterval(tick, 1000);

  // Any API call that finds the session ended sends you to sign in
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await realFetch(...args);
    if (res.status === 401 && String(args[0]).startsWith('/api/admin')) location.href = `/admin/login?next=${encodeURIComponent(location.pathname)}`;
    return res;
  };

  // ---------- "Still there?" after 20 minutes idle; signed out 2 minutes later ----------
  window.AdminIdle = (function () {
    const IDLE_MS = 20 * 60 * 1000;
    const GRACE_S = 120;
    let last = Date.now();
    let prompting = false;
    let countdown = null;
    const bump = () => { if (!prompting) last = Date.now(); };
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, bump, { passive: true }));

    function prompt() {
      prompting = true;
      let left = GRACE_S;
      const el = document.createElement('div');
      el.className = 'idle-overlay';
      el.innerHTML = `<div class="idle-card" role="alertdialog" aria-labelledby="idleT">
          <div class="idle-emoji">👀</div>
          <h2 id="idleT">Still there?</h2>
          <p>You've been quiet for a while. For security, we'll sign you out in <strong id="idleLeft">${GRACE_S}</strong> seconds.</p>
          <button type="button" class="btn-primary" id="idleStay">I'm here, keep me signed in</button>
          <button type="button" class="link-btn" id="idleOut">Sign out now</button>
        </div>`;
      document.body.appendChild(el);
      document.getElementById('idleStay').focus();
      const done = () => { clearInterval(countdown); el.remove(); prompting = false; last = Date.now(); };
      document.getElementById('idleStay').addEventListener('click', () => { done(); fetch('/api/auth/me'); });
      document.getElementById('idleOut').addEventListener('click', () => signOut());
      countdown = setInterval(() => {
        left -= 1;
        const n = document.getElementById('idleLeft');
        if (n) n.textContent = left;
        if (left <= 0) { clearInterval(countdown); signOut(true); }
      }, 1000);
    }
    setInterval(() => { if (!prompting && Date.now() - last > IDLE_MS) prompt(); }, 15000);
    return { signOut, _promptNow: prompt };
  })();

  // Small count next to a nav item (e.g. items needing attention)
  window.setNavCount = function (key, n) {
    const el = document.querySelector(`.side-count[data-count="${key}"]`);
    if (el) el.textContent = n ? String(n) : '';
  };
})();
