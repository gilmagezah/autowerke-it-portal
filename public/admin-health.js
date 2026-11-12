// Shows a warning banner on admin pages when the database is missing columns
// or Supabase's schema cache is stale - with the exact fix to run.
(async function () {
  const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  async function check(fresh) {
    const res = await fetch(`/api/admin/health${fresh ? '?fresh=1' : ''}`);
    return res.json();
  }
  try {
    const status = await check(false);
    if (status.ok) return;
    const banner = document.createElement('div');
    banner.className = 'health-banner';
    const render = (s) => {
      banner.innerHTML = `
        <strong>Database needs attention</strong>
        <ul>${s.messages.map((m) => `<li>${esc(m).replace(/(NOTIFY pgrst, 'reload schema';|schema[\w]*\.sql)/g, '<code>$1</code>')}</li>`).join('')}</ul>
        <button type="button" class="health-recheck">I've done this — check again</button>`;
      banner.querySelector('.health-recheck').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Checking...';
        const again = await check(true);
        if (again.ok) {
          banner.innerHTML = '<strong>All good — the database is up to date.</strong> Reloading...';
          banner.classList.add('ok');
          setTimeout(() => location.reload(), 900);
        } else render(again);
      });
    };
    render(status);
    const main = document.querySelector('main');
    const band = main.querySelector('.band');
    if (band) band.after(banner);
    else main.prepend(banner);
  } catch {
    /* the banner is a helper - never break the page over it */
  }
})();
