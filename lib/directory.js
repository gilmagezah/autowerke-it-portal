// Contacts directory: every company you've worked with, the people there, and their requests.
const { statusInfo } = require('../public/status-info');

const TYPE_LABEL = { 'IT Support': 'Support', 'IT Project': 'Project', Domains: 'Domain', Consultancy: 'Consultancy' };

function buildDirectory(rows, registry = []) {
  const companies = new Map();
  const keyOf = (name) => String(name || 'Unknown').trim().toLowerCase();
  const get = (name) => {
    const k = keyOf(name);
    if (!companies.has(k)) companies.set(k, { company: String(name || 'Unknown').trim(), people: new Map(), requests: [], domains: 0, lastActivity: null });
    return companies.get(k);
  };

  for (const r of rows) {
    const c = get(r.company_name);
    const when = r.updated_at || r.created_at;
    if (!c.lastActivity || when > c.lastActivity) c.lastActivity = when;

    // One person per email address; keep their most recent details
    const email = String(r.email || '').trim().toLowerCase();
    const pk = email || `${r.name} ${r.surname}`.toLowerCase();
    const prev = c.people.get(pk);
    if (!prev || (r.created_at || '') > (prev.lastSeen || '')) {
      c.people.set(pk, {
        name: [r.name, r.surname].filter(Boolean).join(' ').trim(),
        position: r.position || (prev && prev.position) || '',
        email,
        phone: r.phone || (prev && prev.phone) || '',
        lastSeen: r.created_at,
        requestCount: (prev ? prev.requestCount : 0) + 1,
      });
    } else {
      prev.requestCount += 1;
      if (!prev.phone && r.phone) prev.phone = r.phone;
      if (!prev.position && r.position) prev.position = r.position;
    }

    const info = statusInfo(r.status, { requestType: r.request_type, signoffSentAt: r.signoff_sent_at, signoffSignedAt: r.signoff_signed_at });
    c.requests.push({
      ref: r.project_id, title: r.project_title || '', type: TYPE_LABEL[r.request_type] || r.request_type,
      status: r.status, label: info.label, owner: info.owner, adminOwner: info.adminOwner,
      date: r.created_at, contact: [r.name, r.surname].filter(Boolean).join(' '),
    });
  }
  for (const d of registry) get(d.client_company).domains += 1;

  return [...companies.values()].map((c) => ({
    ...c,
    people: [...c.people.values()].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '')),
    requests: c.requests.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    active: c.requests.filter((r) => r.owner !== 'done').length,
  })).sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
}

module.exports = { buildDirectory, TYPE_LABEL };
