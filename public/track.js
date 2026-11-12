// Tracking page: look a request up by reference + email, then show where it stands.
// Everything shown comes from /api/track (built by lib/track.js), and every value is escaped.
// Actions (approving, signing, uploading) live on the client's private page; from here the
// client can only ask for that link to be emailed to them.

const $ = (id) => document.getElementById(id);
const form = $('lookupForm');
const lookupEl = $('lookup');
const resultEl = $('trackResult');
const errorEl = $('lookupError');

const esc = (s = '') => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// "1h 20m", "45m", "2h"
const hrs = (min) => {
  const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); const r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};
const day = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => {
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', opts);
};
const longDay = (iso) => day(iso, { day: 'numeric', month: 'short', year: 'numeric' });
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Our contact address lives on the server (lib/brand.js): use it wherever the page names it
let brandEmail = 'services@autowerkeit.com';
fetch('/api/brand').then((r) => r.json()).then((c) => {
  if (!c || !c.email) return;
  brandEmail = c.email;
  document.querySelectorAll('.js-brand-email').forEach((a) => { a.textContent = c.email; a.href = `mailto:${c.email}`; });
}).catch(() => {});

// The steps of each kind of request
const FLOWS = {
  Domains: {
    steps: ['Submitted', 'Quote', 'Accepted', 'Registered'],
    index: { domain_requested: 0, domain_quoted: 1, domain_accepted: 2, domain_registered: 3 },
    done: ['domain_registered'],
  },
  Consultancy: {
    steps: ['Submitted', 'Response', 'Meeting', 'Done'],
    index: { consult_requested: 0, consult_answered: 3, consult_meeting_invited: 1, consult_meeting_requested: 2, consult_meeting_confirmed: 2, consult_closed: 3 },
    done: ['consult_answered', 'consult_closed'],
  },
  'IT Project': {
    steps: ['Submitted', 'Scope review', 'Scope confirmed', 'Pricing', 'Contract', 'In delivery', 'Closed'],
    index: { pending_review: 0, reviewed: 1, changes_requested: 1, client_confirmed: 2, pricing_sent: 3, proceeding: 4, signed: 5, delivered: 5, closed: 6 },
    done: ['closed'],
  },
  'IT Support': {
    steps: ['Submitted', 'Review', 'Confirmed', 'Estimate', 'In progress', 'Sign-off', 'Resolved'],
    index: { pending_review: 0, reviewed: 1, changes_requested: 1, client_confirmed: 2, estimate_sent: 3, in_progress: 4, awaiting_signoff: 5, completed: 6 },
    done: ['completed'],
  },
};
const TYPE_LABEL = { 'IT Support': 'Support ticket', 'IT Project': 'Project', Domains: 'Domain request', Consultancy: 'Consultancy' };
const OWNER_PILL = { you: 'Waiting on you', us: 'With us', both: 'Meeting booked', done: 'Finished' };

// ---------- Lookup ----------
let lastLookup = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const projectId = $('projectId').value.trim();
  const email = $('email').value.trim();
  if (!projectId || !email) return showError('Enter your reference number and the email you used.');
  const btn = $('trackBtn');
  btn.disabled = true; btn.classList.add('busy');
  showError('');
  try {
    const res = await fetch(`/api/track?projectId=${encodeURIComponent(projectId)}&email=${encodeURIComponent(email)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showError(data.error || "We couldn't find that request.");
    lastLookup = { projectId: data.projectId, email };
    render(data);
  } catch {
    showError('Something went wrong. Please try again.');
  } finally {
    btn.disabled = false; btn.classList.remove('busy');
  }
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

function backToLookup() {
  resultEl.hidden = true;
  resultEl.innerHTML = '';
  lookupEl.hidden = false;
  document.title = 'Track a request — AutoWerke | IT';
  window.scrollTo({ top: 0 });
  $('projectId').focus();
}

// ---------- The request ----------
function render(d) {
  const info = window.StatusInfo.statusInfo(d.status, { requestType: d.requestType, signoffSentAt: d.signoffSentAt, signoffSignedAt: d.signoffSignedAt });
  const flow = FLOWS[d.requestType] || FLOWS['IT Project'];
  const support = d.requestType === 'IT Support';
  const title = d.projectTitle || `${TYPE_LABEL[d.requestType] || 'Request'} for ${d.companyName}`;

  const main = [documentsHtml(d), phasesHtml(d), support ? timeHtml(d) : '', activityHtml(d)].filter(Boolean).join('');
  const side = [support ? estimateHtml(d) : '', detailsHtml(d), questionsHtml(d)].join('');

  resultEl.innerHTML = `
    <button type="button" class="tr-back" id="backBtn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      Track another request
    </button>

    <section class="tr-head">
      <div class="tr-meta">
        <span class="tr-ref">${esc(d.projectId)}</span>
        <span class="tr-pill">${esc(TYPE_LABEL[d.requestType] || d.requestType)}</span>
        <span class="tr-pill tr-state owner-${esc(info.owner)}"><span class="tr-dot" aria-hidden="true"></span>${esc(d.status === 'declined' ? 'Not proceeding' : OWNER_PILL[info.owner])}</span>
      </div>
      <h1 id="resultTitle" tabindex="-1">${esc(title)}</h1>
      <p class="tr-company">${esc(d.companyName)}</p>
    </section>

    ${courtHtml(d, info)}
    ${d.status === 'declined' ? '' : stepsHtml(d, flow, info)}

    <div class="tr-cols">
      <div class="tr-col-main">${main}</div>
      <aside class="tr-col-side">${side}</aside>
    </div>`;

  lookupEl.hidden = true;
  resultEl.hidden = false;
  document.title = `${d.projectId} — AutoWerke | IT`;
  window.scrollTo({ top: 0 });
  $('resultTitle').focus({ preventScroll: true });

  $('backBtn').addEventListener('click', backToLookup);
  const linkBtn = $('sendLink');
  if (linkBtn) linkBtn.addEventListener('click', sendLink);
  placeTimeBlocks();
  serve();
}

// "Ball's in whose court": the little court, served from the middle to whoever's move it is
function courtHtml(d, info) {
  const side = { you: 'left', us: 'right', both: 'center', done: 'center' }[info.owner];
  const actions = info.owner === 'you' && d.privateLink
    ? `<div class="tr-actions">
        <button type="button" class="tr-btn tr-btn-primary" id="sendLink">Email me my private link</button>
        ${signsOnline(d) ? '<a class="tr-btn tr-btn-quiet" href="/signoff">Sign online instead</a>' : ''}
      </div>
      <p class="tr-note" id="sendLinkNote" role="status">Approve, sign and upload from your private page. We'll email you the link.</p>`
    : info.owner === 'us' ? '<p class="tr-note">Nothing needed from you right now.</p>' : '';
  return `
    <section class="tr-court owner-${esc(info.owner)}" aria-labelledby="courtTitle">
      <div class="court" role="img" aria-label="${esc(info.headline)}">
        <span class="court-side court-you ${info.owner === 'you' ? 'on' : ''}">YOU</span>
        <span class="court-net"></span>
        <span class="court-side court-us ${info.owner === 'us' ? 'on' : ''}">US</span>
        <span class="court-shadow ball-center" data-side="ball-${side}"></span>
        <span class="court-ball ball-center" data-side="ball-${side}">${info.owner === 'done' ? '✓' : ''}</span>
      </div>
      <div class="tr-court-text">
        <h2 id="courtTitle">${esc(info.headline)}</h2>
        <p>${esc(info.line)}</p>
        ${actions}
      </div>
    </section>`;
}
// Online sign-off exists for these two moments
const signsOnline = (d) => d.status === 'awaiting_signoff' || (d.requestType === 'IT Project' && ['signed', 'delivered'].includes(d.status) && d.signoffSentAt && !d.signoffSignedAt);

function serve() {
  const parts = resultEl.querySelectorAll('.court-ball, .court-shadow');
  const land = () => parts.forEach((el) => { el.classList.remove('ball-center'); el.classList.add(el.dataset.side); });
  if (reduceMotion()) return land();
  requestAnimationFrame(() => requestAnimationFrame(land)); // two frames, so the move animates
}

function stepsHtml(d, flow, info) {
  const at = flow.index[d.status] ?? 0;
  const finished = flow.done.includes(d.status);
  const items = flow.steps.map((label, i) => {
    const state = i < at || (finished && i === at) ? 'done' : i === at ? 'now' : 'later';
    const phases = d.phases || [];
    const phaseNote = d.requestType === 'IT Project' && phases.length && info.owner !== 'you' ? `${phases.filter((p) => p.done).length} of ${phases.length} phases done` : 'Now';
    const sub = state === 'now' ? (info.owner === 'you' ? info.label : phaseNote) : '';
    return `<li class="tr-step ${state} ${state === 'now' ? `owner-${esc(info.owner)}` : ''}" ${state === 'now' ? 'aria-current="step"' : ''}>
      <span class="tr-bar" aria-hidden="true"></span>
      <span class="tr-step-label">${esc(label)}</span>
      ${sub ? `<span class="tr-step-sub">${esc(sub)}</span>` : ''}
    </li>`;
  }).join('');
  return `<section class="tr-steps" aria-label="Progress"><ol>${items}</ol></section>`;
}

const ICON = {
  done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  you: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
const DOC_STATE = { done: 'Complete', you: 'Waiting on you', us: 'With us', later: 'Not yet' };

function documentsHtml(d) {
  if (!d.documents || !d.documents.length) return '';
  const rows = d.documents.map((x) => `
    <li class="tr-doc">
      <div><strong>${esc(x.name)}</strong><span>${esc(x.note)}</span></div>
      <span class="tr-doc-state state-${esc(x.state)}">${ICON[x.state] || ''}${esc(DOC_STATE[x.state] || '')}</span>
    </li>`).join('');
  return `<section class="tr-block"><h2>Documents</h2><ul class="tr-card tr-docs">${rows}</ul></section>`;
}

// Delivery phases (set on our delivery board): what's done and when, what's being worked on
// now, and what's planned. Shown once the contract is signed.
const shortDay = (iso) => day(iso, { day: 'numeric', month: 'short' });
function plannedText(p) {
  if (p.plannedStart && p.plannedEnd && p.plannedStart !== p.plannedEnd) return `Planned ${shortDay(p.plannedStart)} – ${shortDay(p.plannedEnd)}`;
  if (p.plannedEnd) return `Planned by ${shortDay(p.plannedEnd)}`;
  if (p.plannedStart) return `Planned from ${shortDay(p.plannedStart)}`;
  return '';
}
function phasesHtml(d) {
  if (!d.phases || !d.phases.length) return '';
  const total = d.phases.length;
  const doneCount = d.phases.filter((p) => p.done).length;
  const finished = d.status === 'closed' || doneCount === total;
  // Phases can be finished out of order: the one being worked on is the first open phase after
  // the last finished one, and an earlier phase still open is "still to finish", not "in progress"
  const lastDone = d.phases.reduce((at, p, i) => (p.done ? i : at), -1);
  let current = finished ? -1 : d.phases.findIndex((p, i) => !p.done && i > lastDone);
  if (!finished && current === -1) current = d.phases.findIndex((p) => !p.done);
  const state = (p, i) => (p.done ? 'done' : i === current ? 'now' : i < current ? 'open' : 'later');
  const meter = d.phases.map((p, i) => `<span class="${state(p, i)}"></span>`).join('');
  const rows = d.phases.map((p, i) => {
    const s = state(p, i);
    const when = s === 'done' ? (p.completedDate ? `Done ${shortDay(p.completedDate)}` : 'Done')
      : s === 'now' ? ['In progress', plannedText(p).replace(/^Planned /, 'planned ')].filter(Boolean).join(' · ')
        : s === 'open' ? 'Still to finish'
          : plannedText(p);
    return `<li class="${s}">
      <span class="tr-tick" aria-hidden="true">${s === 'done' ? ICON.done : ''}</span>
      <span class="tr-phase-title">${esc(p.title)}<span class="sr-only">${s === 'done' ? ' (done)' : s === 'now' ? ' (in progress)' : s === 'open' ? ' (still to finish)' : ' (to do)'}</span></span>
      ${when ? `<span class="tr-phase-when">${esc(when)}</span>` : ''}
    </li>`;
  }).join('');
  return `<section class="tr-block">
    <div class="tr-block-head"><h2>Delivery phases</h2><span class="tr-count">${doneCount} of ${total} done</span></div>
    <div class="tr-card tr-phase-card">
      <div class="tr-meter" role="img" aria-label="${doneCount} of ${total} phases done">${meter}</div>
      <ol class="tr-phases">${rows}</ol>
    </div>
  </section>`;
}

// Hours on a working day, one row per day (newest first). The day runs 08:00-18:00, stretched
// to the whole hour around anything logged earlier or later (an evening fix at 18:44 shows
// where it happened, not squashed against the edge).
const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function dayWindow(days) {
  const blocks = days.flatMap((x) => x.blocks);
  const from = Math.min(8 * 60, ...blocks.map((b) => Math.floor(mins(b.start) / 60) * 60));
  const to = Math.max(18 * 60, ...blocks.map((b) => Math.ceil(mins(b.end) / 60) * 60));
  return { from, to: Math.min(to, 24 * 60) };
}
function timeHtml(d) {
  if (!['in_progress', 'awaiting_signoff', 'completed'].includes(d.status)) return '';
  const days = (d.workDays || []).slice(0, 10);
  const est = Number(d.estimatedHours) * 60;
  const left = est ? est - d.loggedMinutes : null;
  const summary = left == null ? '' : left >= 0
    ? `${hrs(left)} left on the ${hrs(est)} estimate`
    : `${hrs(-left)} over the ${hrs(est)} estimate`;
  const win = dayWindow(days);
  const mid = Math.round((win.from + win.to) / 120) * 60;
  const rows = days.length ? days.map((x) => `
    <div class="tr-time-row">
      <span class="tr-time-day">${esc(day(x.date))}</span>
      <div class="tr-time-track" role="img" aria-label="${esc(`${hrs(x.minutes)} logged on ${day(x.date)}`)}">
        ${x.blocks.map((b) => `<span class="tr-time-block" data-start="${esc(b.start)}" data-end="${esc(b.end)}" title="${esc(`${b.start}–${b.end}`)}"></span>`).join('')}
      </div>
      <span class="tr-time-hrs">${esc(hrs(x.minutes))}</span>
    </div>`).join('') : '<p class="tr-empty">No time logged yet.</p>';
  return `<section class="tr-block"><h2>Time logged</h2>
    <div class="tr-card tr-time" data-from="${win.from}" data-to="${win.to}">
      ${rows}
      ${days.length ? `<div class="tr-time-row tr-time-scale" aria-hidden="true"><span></span><div><span>${hhmm(win.from)}</span><span>${hhmm(mid)}</span><span>${hhmm(win.to)}</span></div><span></span></div>` : ''}
      <div class="tr-time-total"><span><strong>${esc(hrs(d.loggedMinutes || 0))}</strong> logged</span>${summary ? `<span>${esc(summary)}</span>` : ''}</div>
    </div></section>`;
}
// Positions are set as properties, not style attributes, so the CSP never needs inline styles here
function placeTimeBlocks() {
  const chart = resultEl.querySelector('.tr-time');
  if (!chart) return;
  const from = Number(chart.dataset.from); const to = Number(chart.dataset.to); const span = to - from;
  chart.querySelectorAll('.tr-time-block').forEach((b) => {
    const s = Math.min(Math.max(mins(b.dataset.start), from), to);
    const e = Math.min(Math.max(mins(b.dataset.end), from), to);
    b.style.left = `${((s - from) / span) * 100}%`;
    b.style.width = `${Math.max(((e - s) / span) * 100, 1.5)}%`;
  });
}

function activityHtml(d) {
  if (!d.activity || !d.activity.length) return '';
  const rows = d.activity.slice(0, 12).map((a, i) => `
    <li class="${i === 0 ? 'latest' : ''}">
      <span class="tr-node" aria-hidden="true"></span>
      <div>
        <div class="tr-act-line"><strong>${esc(a.label)}</strong><time datetime="${esc(a.at)}">${esc(a.day ? day(a.at.slice(0, 10)) : longDay(a.at))}</time></div>
        ${a.note ? `<p>${esc(a.note)}</p>` : ''}
      </div>
    </li>`).join('');
  return `<section class="tr-block"><h2>Activity</h2><ol class="tr-activity">${rows}</ol></section>`;
}

function estimateHtml(d) {
  if (!d.estimatedHours || !d.hourlyRate) return '';
  const e = d.estimate || { subtotal: Number(d.estimatedHours) * Number(d.hourlyRate), vatApplies: false };
  return `<section class="tr-card tr-side">
    <h2>Estimate</h2>
    <dl class="tr-sum">
      <dt>${esc(String(d.estimatedHours))} hrs × ${esc(usd(d.hourlyRate))}/hr</dt><dd>${esc(usd(e.subtotal))}</dd>
      ${e.vatApplies ? `<dt>VAT ${esc(String(e.vatRate))}%</dt><dd>${esc(usd(e.vat))}</dd>` : ''}
      <dt class="total">Total</dt><dd class="total">${esc(usd(e.vatApplies ? e.total : e.subtotal))}</dd>
    </dl>
    <p class="tr-side-note">The estimate PDF is on your private page.</p>
  </section>`;
}

function detailsHtml(d) {
  const rows = [
    ['Company', d.companyName],
    ['Contact', d.contactName],
    ['Submitted', longDay(d.createdAt)],
    d.completedAt ? ['Resolved', longDay(d.completedAt)] : null,
    d.closedAt ? ['Closed', longDay(d.closedAt)] : null,
  ].filter((r) => r && r[1]);
  return `<section class="tr-card tr-side">
    <h2>Details</h2>
    <dl class="tr-details">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  </section>`;
}

function questionsHtml(d) {
  const what = d.requestType === 'IT Support' ? 'ticket' : d.requestType === 'IT Project' ? 'project' : 'request';
  return `<section class="tr-card tr-side tr-ask">
    <h2>${d.requestType === 'IT Support' ? 'Something not right?' : `Questions about this ${what}?`}</h2>
    <p>Write to us quoting <span class="tr-ref">${esc(d.projectId)}</span>.</p>
    <a class="tr-btn tr-btn-quiet" href="mailto:${esc(brandEmail)}?subject=${encodeURIComponent(d.projectId)}">Email about this ${what}</a>
  </section>`;
}

// ---------- "Email me my private link" ----------
async function sendLink(e) {
  const btn = e.currentTarget;
  const note = $('sendLinkNote');
  if (!lastLookup) return;
  btn.disabled = true; btn.classList.add('busy');
  try {
    const res = await fetch('/api/track/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastLookup),
    });
    const data = await res.json().catch(() => ({}));
    note.textContent = data.message || data.error || 'Please try again.';
    if (res.ok) { btn.textContent = 'Link sent'; btn.classList.add('sent'); return; }
  } catch {
    note.textContent = 'Something went wrong. Please try again.';
  }
  btn.disabled = false;
  btn.classList.remove('busy');
}
