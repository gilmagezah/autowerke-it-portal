// Site footer for client-facing pages, built from the server's contact settings
// so details only ever live in one place (lib/brand.js / .env).
(async function () {
  const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  try {
    const c = await (await fetch('/api/brand')).json();
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="sf-row">
        <img src="/brand/autowerke-it-logo-light.svg" alt="${esc(c.name)}" class="sf-logo" data-logo>
        <span class="sf-divider"></span>
        <div class="sf-contact">
          <a href="mailto:${esc(c.email)}"><strong>${esc(c.email)}</strong></a>
          <span class="sf-muted">${esc(c.location)}</span>
        </div>
      </div>
      <div class="sf-tagline">${esc(c.tagline)}</div>
      <div class="sf-copy">&copy; ${new Date().getFullYear()} ${esc(c.name)}</div>
      <div class="sf-legal"><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a><a href="/terms">Terms</a><a href="/service-terms">Service terms</a><a href="#" data-cookie-settings>Cookie settings</a></div>`;
    document.body.appendChild(footer);
  } catch {
    /* footer is decoration - never break the page over it */
  }
})();
