const appEl = document.getElementById('app');
let companies = [];
let q = '';
const open = {}; // company -> show all requests

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const esc = (s = '') => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (s = '') => esc(s).replace(/"/g, '&quot;');
const tel = (p) => `tel:${String(p).replace(/[^+\d]/g, '')}`;
const OWNER_CLASS = { you: 'amber', us: '', both: 'solid', done: 'muted' };

async function load() {
  try {
    const res = await fetch('/api/admin/directory');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load contacts.');
    companies = data.companies;
    render();
  } catch (err) {
    appEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

function render() {
  const people = companies.reduce((n, c) => n + c.people.length, 0);
  const requests = companies.reduce((n, c) => n + c.requests.length, 0);
  if (window.setBandStats) {
    window.setBandStats([
      { label: 'Companies', value: String(companies.length) },
      { label: 'People', value: String(people) },
      { label: 'Requests', value: String(requests), sub: `${companies.reduce((n, c) => n + c.active, 0)} active` },
    ]);
  }

  const needle = q.trim().toLowerCase();
  const shown = companies.filter((c) => !needle || [c.company, ...c.people.flatMap((p) => [p.name, p.email, p.position, p.phone]), ...c.requests.flatMap((r) => [r.ref, r.title])]
    .join(' ').toLowerCase().includes(needle));

  appEl.innerHTML = `
    <div class="reg-toolbar">
      <label class="fu-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
        <input type="search" id="cSearch" placeholder="Search company, person, email, phone, reference" value="${attr(q)}"></label>
      <a class="btn-outline" href="/api/admin/directory/pdf" style="text-decoration:none;">Download PDF · all</a>
    </div>
    <p class="svc-hint" style="margin:-4px 0 14px;">Contact details are confidential. The PDF is for internal use.</p>
    ${shown.length ? shown.map(companyCard).join('') : `<p class="empty-state">${companies.length ? 'Nothing matches.' : 'No clients yet. They appear here as requests come in.'}</p>`}`;

  const input = document.getElementById('cSearch');
  input.addEventListener('input', (e) => { q = e.target.value; render(); const i = document.getElementById('cSearch'); i.focus(); i.setSelectionRange(q.length, q.length); });
}

function companyCard(c) {
  const showAll = open[c.company];
  const reqs = showAll ? c.requests : c.requests.slice(0, 5);
  return `
    <div class="svc-card contact-card">
      <div class="svc-head">
        <div>
          <div class="svc-title">${esc(c.company)}</div>
          <div class="svc-meta">${c.people.length} ${c.people.length === 1 ? 'person' : 'people'} · ${c.requests.length} request${c.requests.length === 1 ? '' : 's'} · ${c.active} active${c.domains ? ` · ${c.domains} managed domain${c.domains === 1 ? '' : 's'}` : ''} · last activity ${esc(short(c.lastActivity))}</div>
        </div>
        <a class="btn-outline" style="text-decoration:none;" href="/api/admin/directory/pdf?company=${encodeURIComponent(c.company)}">PDF</a>
      </div>
      <div class="svc-label">People</div>
      <div class="ct-table">
        ${c.people.map((p) => `
          <div class="ct-row">
            <div><strong>${esc(p.name || '—')}</strong><div class="reg-sub">${esc(p.position || 'Role not given')}</div></div>
            <div>${p.email ? `<a href="mailto:${attr(p.email)}">${esc(p.email)}</a>` : '—'}</div>
            <div>${p.phone ? `<a href="${attr(tel(p.phone))}">${esc(p.phone)}</a>` : '—'}</div>
            <div class="reg-sub">${p.requestCount} request${p.requestCount === 1 ? '' : 's'} · since ${esc(short(p.lastSeen))}</div>
          </div>`).join('')}
      </div>
      <div class="svc-label">Requests</div>
      <div class="ct-table">
        ${reqs.map((r) => `
          <div class="ct-row req">
            <div class="reg-domain" style="font-size:13px;">${esc(r.ref)}</div>
            <div>${esc(r.title || '—')}<div class="reg-sub">${esc(r.type)} · ${esc(r.contact)} · ${esc(short(r.date))}</div></div>
            <div><span class="svc-pill ${OWNER_CLASS[r.owner] || ''}">${esc(r.label)}</span><div class="reg-sub" style="margin-top:4px;">${esc(r.adminOwner)}</div></div>
          </div>`).join('')}
      </div>
      ${c.requests.length > 5 ? `<button type="button" class="link-btn" data-toggle="${attr(c.company)}">${showAll ? 'Show fewer' : `Show all ${c.requests.length} requests`}</button>` : ''}
    </div>`;
}

appEl.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (!t) return;
  open[t.dataset.toggle] = !open[t.dataset.toggle];
  render();
});

load();
