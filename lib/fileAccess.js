// Private file access.
//   GET /files/<path>            -> signed-in admins: any file, except workspace documents,
//                                   which need access to that workspace's Documents section
//   GET /files/<path>?t=<token>  -> a client: only files in their own request's folder,
//                                   and never a workspace document
// Either way we redirect to a signed link that expires in 60 seconds.
//
// Stored file URLs are rewritten to /files/... automatically on the way out:
//   - admin + portal API responses (rewriteJson middleware)
//   - emails (rewriteForEmail, used by the email sender)

const express = require('express');
const db = require('./db');
const storage = require('./storage');
const workspace = require('./workspace');
const { portalExpired } = require('./portal');

const SAFE_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/; // "<REF>/<file>", nothing else (no "..", no nesting)

function toProxy(str, { absolute = false, token = null } = {}) {
  if (typeof str !== 'string' || !str.includes(storage.PUBLIC_PREFIX)) return str;
  const base = absolute ? `${String(process.env.BASE_URL || '').replace(/\/$/, '')}/files/` : '/files/';
  return str.split(storage.PUBLIC_PREFIX).join(base).replace(/\/files\/([^"'\s<)]+)/g, (m, p) => (token ? `${m}${p.includes('?') ? '&' : '?'}t=${token}` : m));
}

function deepRewrite(value, opts) {
  if (typeof value === 'string') return toProxy(value, opts);
  if (Array.isArray(value)) return value.map((v) => deepRewrite(v, opts));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRewrite(v, opts);
    return out;
  }
  return value;
}

// Wraps res.json so stored file URLs leave the server as /files/ links
function rewriteJson(getToken) {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => json(deepRewrite(body, { token: getToken ? getToken(req) : null }));
    next();
  };
}

const rewriteForEmail = (html) => toProxy(html, { absolute: true });

module.exports = function fileRoutes(getAdminFromRequest) {
  const router = express.Router();

  router.get(/^\/files\/(.+)$/, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Express has already decoded the path once. A second decodeURIComponent here used to throw
    // on "%25E0" (outside any try), and that one request stopped the whole server.
    const path = String(req.params[0] || '');
    if (!SAFE_PATH.test(path)) return res.status(404).send('Not found');
    try {
      let allowed = false;
      const admin = await getAdminFromRequest(req);
      const wsRef = workspace.workspaceRefForFile(path);
      if (wsRef !== null) {
        // Internal working files: the same sharing rules as the workspace itself. No client token works here.
        if (admin) {
          const access = await workspace.accessFor(await db.getWorkspaceByRef(wsRef), admin);
          allowed = workspace.canSection(access, 'documents');
        }
      } else if (admin) allowed = true;
      else if (typeof req.query.t === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.t)) {
        // A client's portal token only opens files in their own request's folder, and only
        // while the link is live (30 days after the request is finished, like the portal itself)
        const p = await db.getProjectByToken(req.query.t).catch(() => null);
        allowed = Boolean(p && path.startsWith(`${p.project_id}/`) && !portalExpired(p));
      }
      if (!allowed) {
        const browser = (req.get('accept') || '').includes('text/html');
        return browser ? res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`) : res.status(404).send('Not found');
      }
      res.redirect(await storage.signedUrl(path, 60));
    } catch (err) {
      console.error('File access:', err.message);
      res.status(404).send('Not found');
    }
  });
  return router;
};

module.exports.rewriteJson = rewriteJson;
module.exports.rewriteForEmail = rewriteForEmail;
module.exports.toProxy = toProxy;
module.exports.SAFE_PATH = SAFE_PATH;
