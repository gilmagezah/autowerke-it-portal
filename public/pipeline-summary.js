// The pipeline's category tiles: what each one says (count, state, newest item). Pure logic, so the
// admin page (browser) and the tests (Node) use exactly the same rules.
//
// state: 'new'     = something arrived since you last opened this category
//        'action'  = waiting on you (nothing new since you last looked)
//        'ongoing' = work in progress
//        'waiting' = the ball is in the client's court
//        'clear'   = nothing here

(function (root) {
  // key: tile id (also the URL hash) · list: key in /api/admin/projects · kind: whose move it is
  const CATEGORIES = [
    { key: 'reviews', list: 'pending', label: 'Pending reviews', kind: 'action' },
    { key: 'changes', list: 'changesRequested', label: 'Changes requested', kind: 'action' },
    { key: 'pricing', list: 'awaitingPricing', label: 'Awaiting pricing', sub: 'IT Project', kind: 'action' },
    { key: 'estimate', list: 'awaitingEstimate', label: 'Awaiting estimate', sub: 'IT Support', kind: 'action' },
    { key: 'progress', list: 'inProgress', label: 'In progress', sub: 'Log hours', kind: 'ongoing' },
    { key: 'signoff', list: 'awaitingSupportSignoff', label: 'Awaiting sign-off', sub: 'Support', kind: 'waiting' },
  ];

  // When an item entered this stage (the best timestamp each stage has)
  function stageTime(p, key) {
    const t = key === 'reviews' ? p.created_at
      : key === 'signoff' ? (p.signoff_sent_at || p.updated_at)
        : key === 'progress' ? (p.estimate_signed_at || p.updated_at)
          : p.updated_at;
    const ms = Date.parse(t || p.created_at || '');
    return Number.isFinite(ms) ? ms : 0;
  }

  // "just now", "5 min ago", "2 h ago", "3 days ago", or a date for anything older than a month
  function ago(ms, now) {
    if (!ms) return '';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    if (d < 31) return `${d} day${d === 1 ? '' : 's'} ago`;
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Never opened before (a new browser): anything from the last 2 days counts as new
  const FIRST_LOOK_MS = 2 * 86400 * 1000;

  // lists: the /api/admin/projects response (already filtered by company if a filter is on)
  // seen:  { [key]: ms when that category was last opened }
  function summarize(lists, seen = {}, now = Date.now()) {
    return CATEGORIES.map((c) => {
      const items = (lists && lists[c.list]) || [];
      const since = Number(seen[c.key]) || now - FIRST_LOOK_MS;
      const times = items.map((p) => stageTime(p, c.key));
      const isNew = items.map((p, i) => times[i] > since);
      const fresh = isNew.filter(Boolean).length;
      let latest = null;
      items.forEach((p, i) => { if (!latest || times[i] > latest.ms) latest = { p, ms: times[i] }; });

      let state = 'clear';
      let pill = 'All clear';
      if (items.length) {
        if (fresh) { state = 'new'; pill = `${fresh} new`; }
        else if (c.kind === 'ongoing') { state = 'ongoing'; pill = 'Ongoing'; }
        else if (c.kind === 'waiting') { state = 'waiting'; pill = 'Waiting on client'; }
        else { state = 'action'; pill = 'Needs you'; }
      }
      const verb = c.key === 'signoff' ? 'sent ' : '';
      const latestWho = latest ? String(latest.p.company_name || latest.p.name || latest.p.project_id || '').trim() : '';
      const latestWhen = latest && latest.ms ? `${verb}${ago(latest.ms, now)}` : '';
      const latestLine = [latestWho, latestWhen].filter(Boolean).join(' · ');
      return { ...c, count: items.length, fresh, state, pill, latestWho, latestWhen, latestLine, newIds: items.filter((p, i) => isNew[i]).map((p) => p.id) };
    });
  }

  const api = { CATEGORIES, summarize, stageTime, ago };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PipelineSummary = api;
})(typeof window !== 'undefined' ? window : this);
