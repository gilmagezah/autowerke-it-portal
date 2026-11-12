// What the public tracking page shows (reference + email lookup). Built in one place so it's
// easy to see, and test, that nothing private leaves: no portal token, no file links, no
// prices for projects, no work-log notes. Actions (signing, uploading) stay on the client's
// private page; the tracking page can only email that link to the address on file.

const { portalExpired } = require('./portal');

// Each request type's statuses, in order (a later index = further along)
const ORDER = {
  'IT Project': ['pending_review', 'reviewed', 'changes_requested', 'client_confirmed', 'pricing_sent', 'proceeding', 'signed', 'delivered', 'closed'],
  'IT Support': ['pending_review', 'reviewed', 'changes_requested', 'client_confirmed', 'estimate_sent', 'in_progress', 'awaiting_signoff', 'completed'],
  Domains: ['domain_requested', 'domain_quoted', 'domain_accepted', 'domain_registered'],
  Consultancy: ['consult_requested', 'consult_meeting_invited', 'consult_meeting_requested', 'consult_meeting_confirmed', 'consult_answered', 'consult_closed'],
};

const dateOnly = (v) => (/^\d{4}-\d{2}-\d{2}/.exec(String(v || '')) || [null])[0];
// "1h 20m", "45m", "2h": how hours read on the page
function duration(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60); const r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
}
const minutesOf = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// One paperwork row. state: done | you (waiting on the client) | us | later (not reached yet)
const doc = (name, state, note) => ({ name, state, note });

function documentsFor(p) {
  const order = ORDER[p.request_type] || [];
  const at = order.indexOf(p.status);
  const past = (s) => at > order.indexOf(s);
  const here = (s) => p.status === s;
  if (p.status === 'declined') return [];

  if (p.request_type === 'IT Project') {
    return [
      here('pricing_sent') ? doc('Price', 'you', 'Sent by us · waiting for your go-ahead')
        : past('pricing_sent') ? doc('Price', 'done', 'Sent by us · accepted by you')
          : doc('Price', 'later', 'Once the scope is confirmed'),
      here('proceeding') ? doc('Contract', 'you', 'Signed by us · waiting for your signed copy')
        : past('proceeding') ? doc('Contract', 'done', 'Signed by both sides')
          : doc('Contract', 'later', 'Once you accept the price'),
      p.signoff_signed_at || p.status === 'closed' ? doc('Project sign-off', 'done', 'Signed by both sides')
        : p.signoff_sent_at ? doc('Project sign-off', 'you', 'Signed by us · waiting for your signature')
          : doc('Project sign-off', 'later', 'At the end of delivery'),
    ];
  }
  if (p.request_type === 'IT Support') {
    return [
      here('estimate_sent') ? doc('Work estimate', 'you', 'Sent by us · sign it to approve')
        : past('estimate_sent') ? doc('Work estimate', 'done', 'Approved by you')
          : doc('Work estimate', 'later', 'Once the ticket is confirmed'),
      here('completed') ? doc('Sign-off', 'done', 'Signed by you')
        : here('awaiting_signoff') ? doc('Sign-off', 'you', 'Work done · waiting for your signature')
          : doc('Sign-off', 'later', 'When the work is done'),
    ];
  }
  if (p.request_type === 'Domains') {
    return [
      here('domain_quoted') ? doc('Domain quote', 'you', 'Sent by us · waiting for your go-ahead')
        : past('domain_quoted') ? doc('Domain quote', 'done', 'Accepted by you')
          : doc('Domain quote', 'later', "Once we've checked availability"),
    ];
  }
  return [];
}

function workDays(log) {
  const days = new Map();
  for (const e of Array.isArray(log) ? log : []) {
    const start = minutesOf(e.start); const end = minutesOf(e.end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) || start == null || end == null || end <= start) continue;
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push({ start: e.start, end: e.end, minutes: end - start });
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, blocks]) => ({ date, blocks, minutes: blocks.reduce((s, b) => s + b.minutes, 0) }));
}

function activityFor(p, days) {
  const support = p.request_type === 'IT Support';
  const items = [
    [p.created_at, support ? 'Ticket submitted' : 'Request submitted'],
    [p.estimate_signed_at, 'Estimate approved', 'Signed copy received'],
    [p.request_type === 'IT Project' && p.signed_at, 'Contract signed'],
    [p.signoff_sent_at, 'Sign-off sent to you'],
    [p.signoff_signed_at, 'Signed off'],
    [p.completed_at, 'Ticket resolved'],
    [p.closed_at, 'Project closed'],
  ].filter(([at]) => at && Number.isFinite(new Date(at).getTime()))
    .map(([at, label, note]) => ({ at: new Date(at).toISOString(), label, ...(note ? { note } : {}) }));
  // A day's work sits at the time it ended (logged times are Harare time, UTC+2 all year), so
  // an evening fix lands after a request submitted that afternoon, not before it
  for (const d of days) {
    const lastEnd = d.blocks.reduce((m, b) => Math.max(m, minutesOf(b.end)), 0);
    const hhmm = `${String(Math.floor(lastEnd / 60)).padStart(2, '0')}:${String(lastEnd % 60).padStart(2, '0')}`;
    const at = new Date(`${d.date}T${hhmm}:00+02:00`);
    items.push({ at: Number.isFinite(at.getTime()) ? at.toISOString() : `${d.date}T12:00:00.000Z`, day: true, label: `${duration(d.minutes)} logged` });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

function trackView(p, { supportBilling } = {}) {
  const support = p.request_type === 'IT Support';
  const days = support ? workDays(p.work_log) : [];
  const out = {
    projectId: p.project_id,
    companyName: p.company_name,
    contactName: [p.name, p.surname].filter(Boolean).join(' ') || null,
    requestType: p.request_type,
    status: p.status,
    projectTitle: p.project_title || null,
    createdAt: p.created_at,
    signoffSentAt: p.signoff_sent_at || null,
    signoffSignedAt: p.signoff_signed_at || null,
    closedAt: p.closed_at || null,
    completedAt: p.completed_at || null,
    documents: documentsFor(p),
    activity: activityFor(p, days),
    // The private page exists once we've reviewed the request, until 30 days after it's finished
    privateLink: p.status !== 'pending_review' && !portalExpired(p),
  };
  if (p.request_type === 'IT Project' && Array.isArray(p.phases)) {
    // Title, done and dates only: each phase's instructions and notes are internal
    out.phases = p.phases.map((ph) => ({
      title: String(ph.title || ''),
      done: Boolean(ph.done),
      completedDate: ph.done ? dateOnly(ph.completed_date) : null,
      plannedStart: dateOnly(ph.planned_start),
      plannedEnd: dateOnly(ph.planned_end),
    })).filter((ph) => ph.title);
  }
  if (support) {
    out.estimatedHours = p.estimated_hours ?? null;
    out.hourlyRate = p.hourly_rate ?? null;
    out.workDays = days;
    out.loggedMinutes = days.reduce((s, d) => s + d.minutes, 0);
    if (supportBilling && Number(p.estimated_hours) > 0) {
      const { subtotal, vatApplies, vatRate, vat, total } = supportBilling({ ...p, work_log: [] });
      out.estimate = { subtotal, vatApplies, vatRate, vat, total };
    }
  }
  return out;
}

module.exports = { trackView, documentsFor, workDays, duration, ORDER };
