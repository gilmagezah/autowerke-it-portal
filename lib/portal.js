// Client portal links stop working 30 days after a request is finished. One rule, used by
// the portal API (server.js) and by file links (fileAccess.js), so they can't disagree.

const FINAL = new Set(['closed', 'completed', 'declined', 'domain_registered', 'consult_answered', 'consult_closed']);
const PORTAL_DAYS = 30;

function portalExpired(p, now = Date.now()) {
  if (!p || !FINAL.has(p.status)) return false;
  const finished = new Date(p.closed_at || p.completed_at || p.signoff_signed_at || p.updated_at).getTime();
  return Number.isFinite(finished) && now - finished > PORTAL_DAYS * 86400000;
}

module.exports = { portalExpired, FINAL, PORTAL_DAYS };
