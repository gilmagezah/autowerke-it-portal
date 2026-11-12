// Groups raw project rows into dashboard stats.
// Kept as a pure function (no DB access) so it's easy to unit test.

// Statuses that count as "active" (still needs attention / work underway)
const ACTIVE_STATUSES = new Set([
  'pending_review',
  'reviewed',
  'changes_requested',
  'client_confirmed',
  'pricing_sent',
  'estimate_sent',
  'proceeding',
  'in_progress',
  'signed', // contract signed = project now in delivery
  'delivered', // legacy: marked delivered but not yet signed off / closed
  'awaiting_signoff', // support work done, waiting on the client's signed copy
  'domain_requested', 'domain_quoted', 'domain_accepted',
  'consult_requested', 'consult_meeting_invited', 'consult_meeting_requested', 'consult_meeting_confirmed',
]);

function buildStats(rows) {
  const totals = { projects: 0, support: 0, active: 0, companies: 0 };
  const byCompany = {};

  rows.forEach((row) => {
    const name = (row.company_name || 'Unknown').trim();
    // Group case-insensitively so "Acme" and "ACME" land together
    const key = name.toLowerCase();

    if (!byCompany[key]) {
      byCompany[key] = { company: name, projects: 0, support: 0, active: 0 };
    }
    const c = byCompany[key];

    if (row.request_type === 'IT Support') {
      c.support += 1;
      totals.support += 1;
    } else {
      c.projects += 1;
      totals.projects += 1;
    }

    if (ACTIVE_STATUSES.has(row.status)) {
      c.active += 1;
      totals.active += 1;
    }
  });

  const companies = Object.values(byCompany).sort(
    (a, b) => b.active - a.active || (b.projects + b.support) - (a.projects + a.support)
  );
  totals.companies = companies.length;

  return { totals, companies };
}

module.exports = { buildStats, ACTIVE_STATUSES };
