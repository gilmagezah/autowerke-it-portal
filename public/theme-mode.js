// Dark mode for the homepage and the tracking page (home-dark.css holds the dark colours; track.css
// adds the tracking page's own few rules).
// Loaded in <head>, before the page paints, so a saved choice never flashes the light theme first.
// The choice is remembered on this device; ?theme=dark or ?theme=light in the address overrides it.
(function () {
  const KEY = 'aw-theme';
  const root = document.documentElement;
  const LOGOS = { light: '/brand/autowerke-it-logo-light.svg', dark: '/brand/autowerke-it-logo-dark.svg' };

  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private window: just don't remember */ } };

  const fromUrl = new URLSearchParams(location.search).get('theme');
  let theme = fromUrl === 'dark' || fromUrl === 'light' ? fromUrl : (read() === 'dark' ? 'dark' : 'light');
  root.dataset.theme = theme;

  // The SVG logos (header fallback + footer) have a light and a dark version
  function syncLogos() {
    document.querySelectorAll('img[data-logo]').forEach((img) => {
      if (!img.src.endsWith(LOGOS[theme])) img.src = LOGOS[theme];
    });
  }

  function apply(next, btn) {
    theme = next;
    root.dataset.theme = next;
    save(next);
    syncLogos();
    btn.setAttribute('aria-pressed', String(next === 'dark'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    syncLogos();
    // footer.js adds its logo later; catch it when it arrives
    new MutationObserver(syncLogos).observe(document.body, { childList: true });

    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.hidden = false;
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.addEventListener('click', () => {
      const next = theme === 'dark' ? 'light' : 'dark';
      const go = () => apply(next, btn);
      // A short cross-fade where the browser supports it; an instant switch otherwise, or with reduced motion
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(go);
      else go();
    });
  });
})();
