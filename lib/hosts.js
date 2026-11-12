// Separate admin site, the way Microsoft splits admin.microsoft.com from its public sites.
// Set ADMIN_URL (e.g. https://admin.autowerkeit.com) and point that domain at this same app.
//
//   Admin host:  admin pages + admin APIs + sign-in, /files, static assets. "/" opens the
//                dashboard; client pages are sent over to the public site (BASE_URL).
//   Public host: admin pages redirect to the admin host; admin APIs answer 404, so the client
//                site exposes no back-office surface at all.
//
// The admin sign-in cookie is host-only (no Domain attribute), so once the admin site has its
// own host the cookie is never sent to the public site. Without ADMIN_URL, everything runs on
// one host as before (handy locally; try ADMIN_URL=http://admin.localhost:3000 to see the split).
// The bare domain (autowerkeit.com, www.) is redirected to the portal first: see redirectHosts().

const { ADMIN_PATH } = require('./security');

const STATIC_ASSET = /\.(js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map)$/i;
// Public endpoints the admin pages use too: footer/brand details, and the client's documents
// (the delivery page links to the sign-off PDF exactly as the client sees it)
const SHARED_API = /^\/api\/(brand|site-config)$|^\/api\/(signoff|contract|estimate)\/[0-9a-f-]{36}$/i;

const parse = (u) => { try { return u ? new URL(u) : null; } catch { return null; } };

function adminUrl() {
  const admin = parse(process.env.ADMIN_URL);
  const pub = parse(process.env.BASE_URL);
  // Same host for both would redirect in circles: treat it as "not split"
  if (!admin || (pub && pub.hostname === admin.hostname)) return null;
  return admin;
}

const publicOrigin = () => (parse(process.env.BASE_URL) || { origin: '' }).origin;

// The bare domain forwards to the portal: autowerkeit.com and www.autowerkeit.com -> BASE_URL.
// By default the hosts come from BASE_URL (portal.autowerkeit.com -> autowerkeit.com plus
// www.autowerkeit.com). REDIRECT_HOSTS overrides that with a comma list, or "none" switches it
// off. localhost and IP addresses never derive any, and the portal and admin hosts are never
// redirected (that would loop).
function redirectHosts() {
  const raw = String(process.env.REDIRECT_HOSTS || '').trim().toLowerCase();
  if (raw === 'none') return [];
  const pub = parse(process.env.BASE_URL);
  const admin = adminUrl();
  let hosts;
  if (raw) {
    hosts = raw.split(',').map((h) => h.trim()).filter(Boolean);
  } else {
    const labels = pub ? pub.hostname.toLowerCase().split('.') : [];
    if (labels.length < 3 || /^\d+$/.test(labels[labels.length - 1])) return [];
    const parent = labels.slice(1).join('.');
    hosts = [parent, `www.${parent}`];
  }
  const own = [pub && pub.hostname.toLowerCase(), admin && admin.hostname.toLowerCase()];
  return hosts.filter((h) => !own.includes(h));
}

function isRedirectHost(req) {
  const host = String(req.hostname || '').toLowerCase();
  return Boolean(host) && redirectHosts().includes(host);
}
const isAdminHost = (req) => { const a = adminUrl(); return Boolean(a && String(req.hostname || '').toLowerCase() === a.hostname.toLowerCase()); };

function hostRouting(req, res, next) {
  // Same path and query on the portal. 301 for page loads; 308 keeps the method for anything else
  if (isRedirectHost(req)) {
    return res.redirect(req.method === 'GET' || req.method === 'HEAD' ? 301 : 308, publicOrigin() + req.originalUrl);
  }
  const admin = adminUrl();
  if (!admin) return next();
  const isAdminPath = ADMIN_PATH.test(req.path);
  const isPage = req.method === 'GET' && !req.path.startsWith('/api/');

  if (isAdminHost(req)) {
    res.set('X-Robots-Tag', 'noindex, nofollow'); // keep the back office out of search engines
    if (isAdminPath || req.path.startsWith('/files/') || STATIC_ASSET.test(req.path) || SHARED_API.test(req.path)) return next();
    if (req.path === '/') return res.redirect('/admin');
    if (isPage) return res.redirect(publicOrigin() + req.originalUrl);
    return res.status(404).json({ error: 'Not found.' });
  }

  // Public host
  if (isAdminPath) {
    if (isPage) return res.redirect(admin.origin + req.originalUrl);
    return res.status(404).json({ error: 'Not found.' });
  }
  // File links in admin emails are built on the public URL: without a client token they're the admin's
  if (req.path.startsWith('/files/') && typeof req.query.t !== 'string') return res.redirect(admin.origin + req.originalUrl);
  return next();
}

module.exports = { hostRouting, adminUrl, isAdminHost, redirectHosts };
