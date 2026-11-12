// Cookie consent (POPIA-style opt-in) + Google Analytics only after "Accept".
// The choice is remembered for 12 months; "Cookie settings" in the footer reopens it.
(function () {
  const KEY = 'aw_consent';
  const VERSION = 1;
  const read = () => { try { const c = JSON.parse(localStorage.getItem(KEY)); return c && c.v === VERSION && Date.now() - c.at < 365 * 86400000 ? c : null; } catch { return null; } };
  const save = (analytics) => { try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, analytics, at: Date.now() })); } catch { /* private mode */ } };
  let gaId = null;

  function loadAnalytics() {
    if (!gaId || window.__awGa) return;
    window.__awGa = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', gaId, { anonymize_ip: true });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(s);
  }

  // Withdrawing consent removes what analytics already stored, not just future tracking.
  // GA sets _ga / _ga_* on the site's registrable domain, so clear both this host and its parents.
  function clearAnalyticsCookies() {
    const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /^_ga($|_)/.test(n));
    const parts = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
    names.forEach((n) => domains.forEach((d) => { document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`; }));
  }

  function banner() {
    if (document.getElementById('awConsent')) return;
    const el = document.createElement('div');
    el.id = 'awConsent';
    el.className = 'consent-bar';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie choices');
    el.innerHTML = `
      <div class="consent-text"><strong>Cookies, briefly.</strong> We use essential cookies to keep secure features working. With your OK we'd also use Google Analytics to see which pages help people. <a href="/cookies">Cookie Policy</a></div>
      <div class="consent-actions">
        <button type="button" class="btn-changes" id="awEssential">Essential only</button>
        <button type="button" class="btn-confirm" id="awAccept">Accept analytics</button>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('awAccept').addEventListener('click', () => { save(true); el.remove(); loadAnalytics(); });
    document.getElementById('awEssential').addEventListener('click', () => {
      save(false);
      el.remove();
      clearAnalyticsCookies();
      if (window.__awGa) location.reload(); // switching analytics off: reload so it stops immediately
    });
  }

  window.openCookieSettings = banner;

  fetch('/api/site-config').then((r) => r.json()).then((cfg) => {
    gaId = cfg.gaMeasurementId || null;
    const c = read();
    if (!c) { if (gaId) banner(); return; } // nothing to ask about if analytics isn't set up
    if (c.analytics) loadAnalytics();
  }).catch(() => {});

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cookie-settings]')) { e.preventDefault(); banner(); }
  });
})();
