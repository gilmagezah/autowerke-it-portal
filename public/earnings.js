const { normalize, aggregate } = window.AnalyticsCore;

const contentEl = document.getElementById('content');
const missingEl = document.getElementById('missingBox');
const rangeSelect = document.getElementById('rangeSelect');
const companySelect = document.getElementById('companySelect');

const COLORS = { project: '#2F4A3B', support: '#C9B79C', domain: '#7FA6B5', consultancy: '#B88A5A', committed: '#8AA393', quoted: '#D9DDD2' };
// Stacked in this order, bottom to top
const SERIES = [
  { key: 'project', label: 'Projects' },
  { key: 'support', label: 'Support' },
  { key: 'domain', label: 'Domains' },
  { key: 'consultancy', label: 'Consultancy' },
];
const monthTotal = (m) => SERIES.reduce((sum, s) => sum + (m[s.key] || 0), 0);
const CHART_FONT = "Courier Prime, 'Courier New', monospace";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let rows = [];
let deals = [];
let vatRate = 15.5;
const filters = { type: 'all', range: '12m', company: null };
let vatMode = 'excl';

// ---------- Data ----------

async function load() {
  try {
    const res = await fetch('/api/admin/analytics');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load earnings.');
    rows = data.rows;
    vatRate = data.vatRate;
    deals = normalize(rows, vatRate);
    fillCompanies();
    render();
  } catch (err) {
    contentEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
  }
}

function fillCompanies() {
  const names = [...new Map(deals.map((d) => [d.company.toLowerCase(), d.company])).values()]
    .sort((a, b) => a.localeCompare(b));
  const current = companySelect.value;
  companySelect.innerHTML = '<option value="">All companies</option>' +
    names.map((n) => `<option value="${attr(n)}">${esc(n)}</option>`).join('');
  companySelect.value = names.includes(current) ? current : '';
}

// ---------- Filters ----------

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    if (seg.dataset.filter === 'type') filters.type = btn.dataset.value;
    else vatMode = btn.dataset.value;
    render();
  });
});

rangeSelect.addEventListener('change', () => { filters.range = rangeSelect.value; render(); });
companySelect.addEventListener('change', () => { filters.company = companySelect.value || null; render(); });

function setCompany(name) {
  filters.company = filters.company && filters.company.toLowerCase() === name.toLowerCase() ? null : name;
  companySelect.value = filters.company || '';
  render();
}

// ---------- Render ----------

function render() {
  const a = aggregate(deals, filters, vatMode);
  renderMissing(a.missingValues);
  if (window.setBandStats) {
    // At-a-glance numbers that don't change with the period filter (the cards below do)
    const glance = (range) => aggregate(deals, { ...filters, range }, vatMode).totals.earned;
    const vatNote = vatMode === 'incl' ? 'incl. VAT' : 'excl. VAT';
    window.setBandStats([
      { label: 'This month', value: money(glance('month')), sub: vatNote },
      { label: 'Year to date', value: money(glance('ytd')), sub: vatNote },
      { label: 'Pipeline', value: money(a.pipeline.total), sub: `${a.pipeline.committedCount + a.pipeline.quotedCount} not yet landed` },
    ]);
  }

  const vatLabel = vatMode === 'incl' ? 'incl. VAT' : 'excl. VAT';
  const t = a.totals;
  const p = a.pipeline;

  contentEl.innerHTML = `
    <div class="kpis">
      ${kpi('Earned', money(t.earned), `${plural(t.projectCount, 'project')} · ${plural(t.supportCount, 'ticket')} · ${plural(t.domainCount, 'domain')} · ${vatLabel}`, 'hero')}
      ${kpi('In the pipeline', money(p.total), `${money(p.committed)} committed · ${money(p.quoted)} quoted`)}
      ${kpi('Average project value', t.avgProjectValue ? money(t.avgProjectValue) : '—', vatLabel)}
      ${kpi('Win rate', a.winRate === null ? '—' : `${a.winRate}%`, `${a.won} won · ${a.lost} declined after pricing`)}
    </div>
    <div class="kpis small">
      ${kpi('VAT collected', money(t.vatCollected), `projects + domain fees, at ${vatRate}%`)}
      ${kpi('Support hours billed', `${t.supportHours} h`, 'completed tickets')}
      ${kpi('Effective hourly rate', t.effectiveHourlyRate ? money(t.effectiveHourlyRate) : '—', 'support, excl. VAT')}
      ${kpi('Avg. request → close', a.avgDaysToClose === null ? '—' : `${a.avgDaysToClose} days`, 'projects')}
    </div>

    <div class="panel">
      <h2>Earnings by month</h2>
      <p class="p-sub">${vatLabel}${filters.company ? ` · ${esc(filters.company)}` : ''}</p>
      ${filters.type === 'all' ? `<div class="legend">${SERIES.map((x) => `<span><i style="background:${COLORS[x.key]}"></i>${x.label}</span>`).join('')}</div>` : ''}
      <div class="chart" id="monthChart"></div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2>Money pipeline</h2>
        <p class="p-sub">Earned in this period, plus everything not yet landed (${vatLabel})</p>
        ${funnelHtml(t.earned, p)}
      </div>
      <div class="panel">
        <h2>Earnings by company</h2>
        <p class="p-sub">Click a company to filter the whole page</p>
        ${companyBarsHtml(a.byCompany)}
      </div>
    </div>

    <div class="panel">
      <h2>Earned in this period</h2>
      <p class="p-sub">${a.earned.length} item${a.earned.length === 1 ? '' : 's'}, newest first</p>
      ${tableHtml(a.earned)}
    </div>
  `;

  renderMonthChart(document.getElementById('monthChart'), a.byMonth);

  document.getElementById('toggleRows')?.addEventListener('click', () => { showAllRows = !showAllRows; render(); });

  contentEl.querySelectorAll('.cbar-row').forEach((row) =>
    row.addEventListener('click', () => setCompany(row.dataset.company))
  );
}

function kpi(label, value, sub, cls = '') {
  return `<div class="kpi ${cls}"><div class="k-label">${label}</div><div class="k-value">${value}</div><div class="k-sub">${sub}</div></div>`;
}

// Stacked monthly bars, drawn as SVG (no chart library needed)
function renderMonthChart(el, byMonth) {
  if (!byMonth.length || byMonth.every((m) => monthTotal(m) === 0)) {
    el.innerHTML = '<p class="empty-state" style="padding:24px 0;">No earnings in this period yet.</p>';
    return;
  }

  const W = 960, H = 260, padL = 64, padR = 12, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = niceMax(Math.max(...byMonth.map(monthTotal)));
  const slot = plotW / byMonth.length;
  const barW = Math.min(46, slot * 0.62);
  const y = (v) => padT + plotH - (v / max) * plotH;
  const showEvery = byMonth.length > 18 ? 3 : byMonth.length > 12 ? 2 : 1;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#E9E5D9"/>
      <text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7B7B70" font-family="${CHART_FONT}">${shortMoney(v)}</text>`;
  }

  const bars = byMonth.map((m, i) => {
    const x0 = padL + slot * i + (slot - barW) / 2;
    const label = monthLabel(m.key);
    const parts = SERIES.filter((x) => m[x.key] > 0).map((x) => `${x.label.toLowerCase()} ${money(m[x.key])}`);
    const tip = `${label}: ${money(monthTotal(m))}` + (filters.type === 'all' && parts.length > 1 ? ` (${parts.join(', ')})` : '');
    let base = 0;
    const rects = SERIES.map((x) => {
      const v = m[x.key] || 0;
      if (v <= 0) return '';
      const r = `<rect class="bar" x="${x0}" y="${y(base + v)}" width="${barW}" height="${y(base) - y(base + v)}" fill="${COLORS[x.key]}"><title>${esc(tip)}</title></rect>`;
      base += v;
      return r;
    }).join('');
    const lbl = i % showEvery === 0 ? `<text x="${x0 + barW / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#7B7B70" font-family="${CHART_FONT}">${label}</text>` : '';
    return rects + lbl;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Earnings by month">${grid}${bars}</svg>`;
}

function funnelHtml(earned, p) {
  const total = earned + p.committed + p.quoted;
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0);
  return `
    <div class="funnel">
      <div style="width:${pct(earned)}%;background:${COLORS.project}" title="Earned"></div>
      <div style="width:${pct(p.committed)}%;background:${COLORS.committed}" title="Committed"></div>
      <div style="width:${pct(p.quoted)}%;background:${COLORS.quoted}" title="Quoted"></div>
    </div>
    <div class="funnel-rows">
      <div><span><i style="background:${COLORS.project}"></i>Earned (this period)</span><strong>${money(earned)}</strong></div>
      <div><span><i style="background:${COLORS.committed}"></i>Committed — agreed, not yet closed (${p.committedCount})</span><strong>${money(p.committed)}</strong></div>
      <div><span><i style="background:${COLORS.quoted}"></i>Quoted — waiting on the client (${p.quotedCount})</span><strong>${money(p.quoted)}</strong></div>
    </div>`;
}

function companyBarsHtml(byCompany) {
  if (!byCompany.length) return '<p class="empty-state" style="padding:12px 0;">No earnings in this period yet.</p>';
  const top = byCompany.slice(0, 10);
  const max = top[0].amount || 1;
  return top.map((c) => `
    <div class="cbar-row ${filters.company && filters.company.toLowerCase() === c.company.toLowerCase() ? 'on' : ''}" data-company="${attr(c.company)}">
      <span class="cbar-name" title="${attr(c.company)}">${esc(c.company)}</span>
      <span class="cbar-track"><span class="cbar-fill" style="display:block;width:${(c.amount / max) * 100}%"></span></span>
      <span class="cbar-amt">${money(c.amount)}</span>
    </div>`).join('');
}

const TABLE_LIMIT = 10;
let showAllRows = false;

function tableHtml(earned) {
  if (!earned.length) return '<p class="empty-state" style="padding:12px 0;">Nothing earned in this period yet.</p>';
  const all = [...earned].sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt));
  const sorted = showAllRows ? all : all.slice(0, TABLE_LIMIT);
  const more = all.length > TABLE_LIMIT
    ? `<button type="button" class="link-btn" id="toggleRows" style="margin-top:8px;">${showAllRows ? 'Show fewer' : `Show all ${all.length}`}</button>`
    : '';
  return `
    <div style="overflow-x:auto;">
    <table class="e-table">
      <thead><tr><th>Date</th><th>Reference</th><th>Company</th><th>Type</th><th class="num">Excl. VAT</th><th class="num">VAT</th><th class="num">Incl. VAT</th></tr></thead>
      <tbody>${sorted.map((d) => `
        <tr>
          <td>${esc(new Date(d.earnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
          <td>${esc(d.ref)}${d.title ? `<br><span class="meta" style="margin:0;">${esc(d.title)}</span>` : ''}</td>
          <td>${esc(d.company)}</td>
          <td><span class="type-tag ${d.type}">${{ project: 'Project', support: 'Support', domain: 'Domain', consultancy: 'Consult' }[d.type] || d.type}</span></td>
          <td class="num">${d.missingValue ? '<em style="color:#d97706">not set</em>' : money(d.amountExcl)}</td>
          <td class="num">${d.missingValue ? '' : money(d.vat)}</td>
          <td class="num">${d.missingValue ? '' : money(d.amountIncl)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>${more}`;
}

// ---------- Missing values (projects priced before values were tracked) ----------

function renderMissing(list) {
  if (!list.length) { missingEl.innerHTML = ''; return; }
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  missingEl.innerHTML = `
    <div class="missing">
      <h2>${list.length} project${list.length === 1 ? '' : 's'} need${list.length === 1 ? 's' : ''} a contract value</h2>
      <p>These were priced before earnings tracking. They're left out of the totals until you enter a value (excl. VAT). Your pricing text is shown to help.</p>
      ${list.map((d) => {
        const hint = (byId[d.id] && byId[d.id].pricing_estimate || '').replace(/\s+/g, ' ');
        return `
        <div class="missing-row" data-id="${attr(d.id)}">
          <span class="m-name"><strong>${esc(d.ref)}</strong> · ${esc(d.company)}${d.title ? ` · ${esc(d.title)}` : ''}
            ${hint ? `<span class="m-hint" title="${attr(hint)}">${esc(hint)}</span>` : ''}</span>
          <input type="number" min="0" step="0.01" placeholder="Value excl. VAT" aria-label="Contract value">
          <label style="font-size:12px;display:flex;gap:4px;align-items:center;"><input type="checkbox" class="m-vat" ${d.vatApplicable ? 'checked' : ''}> VAT</label>
          <button type="button">Save</button>
        </div>`;
      }).join('')}
    </div>`;

  missingEl.querySelectorAll('.missing-row').forEach((row) => {
    row.querySelector('button').addEventListener('click', () => saveValue(row));
    row.querySelector('input[type=number]').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveValue(row); });
  });
}

async function saveValue(row) {
  const id = row.dataset.id;
  const value = row.querySelector('input[type=number]').value.trim();
  const vatApplicable = row.querySelector('.m-vat').checked;
  if (value === '' || Number(value) < 0) return alert('Enter the value excl. VAT.');

  const btn = row.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const res = await fetch(`/api/admin/projects/${id}/value`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractValue: value, vatApplicable }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save.');
    const r = rows.find((x) => x.id === id);
    r.contract_value = data.contractValue;
    r.vat_applicable = data.vatApplicable;
    deals = normalize(rows, vatRate);
    render();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Save';
    alert(err.message);
  }
}

// ---------- Helpers ----------

function niceMax(v) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortMoney(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}k`;
  return `$${Math.round(n)}`;
}

function esc(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function attr(str = '') {
  return esc(str).replace(/"/g, '&quot;');
}

load();
