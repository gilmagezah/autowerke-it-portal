// Admin workspace: a private working area per ticket/project.
// Notes canvas, templated items (logins + MFA register, access expiry, change log,
// scope requests, "waiting on", email drafts, contacts, checklists, network,
// licences, meetings), documents, sharing, and a time-on-task timer.
//
// Secret fields (passwords, backup codes, keys) are AES-256-GCM encrypted and only
// decrypted on an explicit Reveal. Sharing can be the whole workspace or chosen sections.

const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('./db');
const { encryptSecret, decryptSecret } = require('./secrets');
const storage = require('./storage');
const { detectImageType } = require('./attachments');
const { statusInfo } = require('../public/status-info');

// kind -> section, and which fields are secret (encrypted). The browser holds the full field layout.
const KINDS = {
  login:     { section: 'logins',     secret: ['password', 'mfa_backup'] },
  access:    { section: 'logins',     secret: [] },
  email:     { section: 'emails',     secret: [] },
  contact:   { section: 'people',     secret: [] },
  checklist: { section: 'checklists', secret: [] },
  change:    { section: 'changes',    secret: [] },
  scope:     { section: 'changes',    secret: [] },
  waiting:   { section: 'changes',    secret: [] },
  network:   { section: 'tech',       secret: ['wifi_key'] },
  licence:   { section: 'tech',       secret: ['licence_key'] },
  meeting:   { section: 'meetings',   secret: [] },
  document:  { section: 'documents',  secret: [] },
};
const SECTIONS = ['notes', 'logins', 'emails', 'people', 'checklists', 'changes', 'tech', 'meetings', 'documents'];

// ---------- Access ----------
async function accessFor(ws, admin) {
  if (!ws) return null;
  if (ws.owner_id === admin.id) return { owner: true, sections: null };
  const share = await db.getShare(ws.id, admin.id);
  if (!share) return null;
  return { owner: false, sections: share.sections && share.sections.length ? share.sections : null };
}
const canSection = (access, section) => access && (access.sections === null || access.sections.includes(section));

// ---------- Item cleaning ----------
function cleanData(kind, input) {
  const data = {};
  const src = input && typeof input === 'object' ? input : {};
  Object.keys(src).slice(0, 30).forEach((k) => {
    if (!/^[a-z_]{1,30}$/.test(k) || KINDS[kind].secret.includes(k)) return; // secrets never stored here
    const v = src[k];
    if (k === 'items' && Array.isArray(v)) {
      data.items = v.slice(0, 150).map((x) => ({ text: String((x && x.text) || '').slice(0, 300), done: Boolean(x && x.done) })).filter((x) => x.text);
    } else if (typeof v === 'string') data[k] = v.slice(0, 8000);
    else if (typeof v === 'boolean') data[k] = v;
  });
  return data;
}

function mergeSecrets(kind, existingEnc, incoming, clear) {
  const fields = KINDS[kind].secret;
  if (!fields.length) return null;
  let current = {};
  if (existingEnc) current = JSON.parse(decryptSecret(existingEnc));
  (clear || []).forEach((k) => { if (fields.includes(k)) delete current[k]; });
  Object.entries(incoming || {}).forEach(([k, v]) => {
    if (fields.includes(k) && typeof v === 'string' && v.length) current[k] = v.slice(0, 2000); // blank = keep existing
  });
  return Object.keys(current).length ? encryptSecret(JSON.stringify(current)) : null;
}

function publicItem(it) {
  const { secret_enc, ...rest } = it;
  return { ...rest, has_secret: Boolean(secret_enc), secret_fields: secret_enc && KINDS[it.kind] ? KINDS[it.kind].secret : [] };
}

// The client contact on the request, in the Contact template's fields
function contactFromRequest(p) {
  return {
    role: p.position || '', company: p.company_name || '', email: p.email || '', phone: p.phone || '',
    notes: 'Client contact from the request', source: 'request',
  };
}

// ---------- Documents ----------
// Stored under "ws_<REF>/". References are only A-Z, 0-9 and "-", so this can't collide with a request's folder.
const WS_FOLDER_PREFIX = 'ws_';
const workspaceFolder = (ref) => `${WS_FOLDER_PREFIX}${ref}`;
// Which workspace a stored file belongs to, or null if it's not a workspace file.
// Older uploads (before the separate folder) sit in "<REF>/" with "-workspace-<time>" in the name.
function workspaceRefForFile(filePath) {
  const [folder, name] = String(filePath).split('/');
  if (folder.startsWith(WS_FOLDER_PREFIX)) return folder.slice(WS_FOLDER_PREFIX.length);
  if (/-workspace-\d+\./.test(name || '')) return folder;
  return null;
}

const DOC_EXT = /\.(pdf|docx?|xlsx?|csv|txt|pptx?|png|jpe?g|vsdx?)$/i;
// The type a document is stored (and later served) with: from its content, plus its extension
// only to tell Office formats apart. Never the type the browser claims.
const OFFICE_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  vsdx: 'application/vnd.ms-visio.drawing',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
};
function storedType(detected, filename) {
  if (detected === 'application/zip-office' || detected === 'application/ole-office') {
    const ext = (String(filename).match(/\.([a-z]+)$/i) || [])[1];
    return OFFICE_TYPES[String(ext).toLowerCase()] || 'application/octet-stream';
  }
  return detected;
}
function docType(f) {
  const b = f.buffer;
  const head = b.slice(0, 8);
  if (b.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const img = detectImageType(b);
  if (img) return img;
  if (head[0] === 0x50 && head[1] === 0x4b) return 'application/zip-office';              // docx/xlsx/pptx/vsdx
  if (head.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return 'application/ole-office'; // doc/xls
  if (/\.(csv|txt)$/i.test(f.originalname) && !b.slice(0, 2048).includes(0)) return 'text/plain';
  return null;
}

// ---------- Routes ----------
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

function wrap(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error('Workspace:', err.message);
    // Admin-only area, so show the real reason: it makes problems diagnosable from the screen
    res.status(err.status || 500).json({ error: err.status ? err.message : `Something went wrong in the workspace: ${err.message}` });
  });
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function loadWs(req, section) {
  const ws = await db.getWorkspace(req.params.id);
  const access = await accessFor(ws, req.admin);
  if (!access) throw httpError(404, 'Workspace not found, or it has not been shared with you.');
  if (section && !canSection(access, section)) throw httpError(403, 'That section has not been shared with you.');
  return { ws, access };
}

async function loadItem(req) {
  const item = await db.getItem(req.params.itemId);
  if (!item || !KINDS[item.kind]) throw httpError(404, 'Item not found.');
  req.params.id = item.workspace_id;
  const { ws, access } = await loadWs(req, KINDS[item.kind].section);
  return { item, ws, access };
}

module.exports = (adminAuth) => {
  router.get(['/admin/workspace', '/admin/workspace/:id'], adminAuth, (req, res) => res.sendFile(path.join(__dirname, '..', 'views', 'workspace.html')));

  router.get('/api/admin/workspaces', adminAuth, wrap(async (req, res) => {
    const [owned, shares] = await Promise.all([db.listOwnedWorkspaces(req.admin.id), db.listSharesForAdmin(req.admin.id)]);
    res.json({
      owned: owned || [],
      shared: (shares || []).filter((s) => s.workspace).map((s) => ({ ...s.workspace, sections: s.sections })),
    });
  }));

  // Open the workspace for a ticket, creating it the first time
  router.post('/api/admin/workspaces', adminAuth, wrap(async (req, res) => {
    const ref = db.cleanRef(req.body.ref);
    if (!ref) throw httpError(400, 'Enter a ticket or project reference, e.g. TANNER-5422.');
    const existing = await db.getWorkspaceByRef(ref);
    if (existing) {
      if (!(await accessFor(existing, req.admin))) throw httpError(403, 'Someone else owns the workspace for that ticket. Ask them to share it with you.');
      return res.json(existing);
    }
    const project = await db.getProjectByRef(ref);
    if (!project) throw httpError(404, `There's no ticket or project with the reference ${ref}.`);
    const ws = await db.createWorkspace({ ref, request_id: project.id, title: project.project_title || `${project.company_name} ${project.request_type}`, owner_id: req.admin.id });
    // Start People with the client contact from the request
    const contactName = [project.name, project.surname].filter(Boolean).join(' ').trim();
    if (contactName || project.email) {
      await db.createItem({
        workspace_id: ws.id, kind: 'contact', title: contactName || project.email, created_by: req.admin.id,
        data: cleanData('contact', { ...contactFromRequest(project) }),
      }).catch((e) => console.warn('Could not add the client contact to the new workspace:', e.message));
    }
    res.json(ws);
  }));

  router.get('/api/admin/workspaces/:id', adminAuth, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { ws, access } = await loadWs(req);
    const [items, project, shares, time] = await Promise.all([
      db.listItems(ws.id),
      ws.request_id ? db.getProjectById(ws.request_id).catch(() => null) : null,
      access.owner ? db.listShares(ws.id) : [],
      db.listTime(ws.id),
    ]);
    const visible = (items || []).filter((it) => KINDS[it.kind] && canSection(access, KINDS[it.kind].section)).map(publicItem);
    const secondsBy = {};
    (time || []).forEach((t) => {
      const end = new Date(t.ended_at || t.last_beat_at).getTime();
      const sec = Math.max(0, Math.round((end - new Date(t.started_at).getTime()) / 1000));
      const who = (t.admin && t.admin.name) || 'Admin';
      secondsBy[who] = (secondsBy[who] || 0) + sec;
    });
    const info = project ? statusInfo(project.status, { requestType: project.request_type, signoffSentAt: project.signoff_sent_at, signoffSignedAt: project.signoff_signed_at }) : null;
    res.json({
      workspace: { ...ws, notes: canSection(access, 'notes') ? ws.notes : null },
      access,
      me: { id: req.admin.id, name: req.admin.name },
      request: project && {
        ref: project.project_id, type: project.request_type, company: project.company_name, title: project.project_title,
        contact: [project.name, project.surname].filter(Boolean).join(' '), position: project.position, email: project.email, phone: project.phone,
        status: info.label, owner: info.adminOwner, details: project.details,
        phases: (project.phases || []).map((p) => ({ title: p.title, done: p.done })),
      },
      items: visible,
      shares: (shares || []).map((s) => ({ id: s.id, sections: s.sections, admin: s.admin })),
      time: secondsBy,
      sections: SECTIONS,
    });
  }));

  router.patch('/api/admin/workspaces/:id', adminAuth, wrap(async (req, res) => {
    const { ws, access } = await loadWs(req);
    const f = {};
    if (typeof req.body.notes === 'string') {
      if (!canSection(access, 'notes')) throw httpError(403, 'Notes have not been shared with you.');
      f.notes = req.body.notes.slice(0, 200000);
    }
    if (access.owner && typeof req.body.title === 'string') f.title = req.body.title.trim().slice(0, 160);
    if (access.owner && typeof req.body.environment === 'string') f.environment = req.body.environment.trim().slice(0, 200);
    const updated = await db.updateWorkspace(ws.id, f);
    res.json({ updated_at: updated.updated_at });
  }));

  router.post('/api/admin/workspaces/:id/items', adminAuth, wrap(async (req, res) => {
    const kind = String(req.body.kind || '');
    if (!KINDS[kind] || kind === 'document') throw httpError(400, 'Unknown template.');
    const { ws } = await loadWs(req, KINDS[kind].section);
    const item = await db.createItem({
      workspace_id: ws.id, kind, title: String(req.body.title || '').trim().slice(0, 160) || null,
      data: cleanData(kind, req.body.data), secret_enc: mergeSecrets(kind, null, req.body.secrets), created_by: req.admin.id,
    });
    await db.updateWorkspace(ws.id, {});
    res.json(publicItem(item));
  }));

  router.patch('/api/admin/workspace-items/:itemId', adminAuth, wrap(async (req, res) => {
    const { item } = await loadItem(req);
    const f = {};
    if (typeof req.body.title === 'string') f.title = req.body.title.trim().slice(0, 160) || null;
    if (req.body.data) f.data = item.kind === 'document' ? { ...item.data, description: String(req.body.data.description || '').slice(0, 2000) } : cleanData(item.kind, req.body.data);
    if (req.body.secrets || req.body.clear_secrets) f.secret_enc = mergeSecrets(item.kind, item.secret_enc, req.body.secrets, req.body.clear_secrets);
    res.json(publicItem(await db.updateItem(item.id, f)));
  }));

  router.delete('/api/admin/workspace-items/:itemId', adminAuth, wrap(async (req, res) => {
    const { item } = await loadItem(req);
    await db.deleteItem(item.id);
    res.json({ success: true });
  }));

  router.post('/api/admin/workspace-items/:itemId/reveal', adminAuth, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { item, ws } = await loadItem(req);
    if (!item.secret_enc) return res.json({ secrets: {} });
    console.log(`Workspace secret revealed: ${ws.ref} / ${item.kind} "${item.title || ''}" by ${req.admin.email}`); // who, never the value
    res.json({ secrets: JSON.parse(decryptSecret(item.secret_enc)) });
  }));

  router.post('/api/admin/workspaces/:id/documents', adminAuth, upload.single('file'), wrap(async (req, res) => {
    const { ws } = await loadWs(req, 'documents');
    const f = req.file;
    if (!f) throw httpError(400, 'Choose a file to upload.');
    const description = String(req.body.description || '').trim().slice(0, 2000);
    if (description.length < 3) throw httpError(400, 'Add a short description of the document.');
    const type = docType(f);
    if (!type || (!DOC_EXT.test(f.originalname) && !type.startsWith('image/'))) throw httpError(400, 'Upload a PDF, Word, Excel, PowerPoint, Visio, CSV, text or image file.');
    const safeName = String(f.originalname).replace(/[^\w .()-]/g, '').slice(0, 100) || 'document';
    // Own folder ("ws_<REF>"), apart from the client's "<REF>" folder: a portal link can never open it
    const url = await storage.uploadSignedContract(workspaceFolder(ws.ref), f.buffer, safeName, storedType(type, f.originalname), `workspace-${Date.now()}`);
    const item = await db.createItem({
      workspace_id: ws.id, kind: 'document', title: safeName,
      data: { description, name: safeName, url, size: f.size, type }, created_by: req.admin.id,
    });
    res.json(publicItem(item));
  }));

  // ---------- Sharing (owner only) ----------
  router.post('/api/admin/workspaces/:id/shares', adminAuth, wrap(async (req, res) => {
    const { ws, access } = await loadWs(req);
    if (!access.owner) throw httpError(403, 'Only the owner can share this workspace.');
    const colleague = await db.getAdminByEmail(String(req.body.email || '').trim().toLowerCase());
    if (!colleague || !colleague.active) throw httpError(404, "There's no active admin with that email. Add them under Team first.");
    if (colleague.id === req.admin.id) throw httpError(400, 'You already own this workspace.');
    const sections = Array.isArray(req.body.sections) ? req.body.sections.filter((s) => SECTIONS.includes(s)) : null;
    const share = await db.upsertShare({ workspace_id: ws.id, admin_id: colleague.id, sections: sections && sections.length ? sections : null, created_by: req.admin.id });
    res.json({ id: share.id, sections: share.sections, admin: { id: colleague.id, name: colleague.name, email: colleague.email } });
  }));

  router.delete('/api/admin/workspaces/:id/shares/:shareId', adminAuth, wrap(async (req, res) => {
    const { ws, access } = await loadWs(req);
    if (!access.owner) throw httpError(403, 'Only the owner can change sharing.');
    await db.deleteShare(req.params.shareId, ws.id);
    res.json({ success: true });
  }));

  // ---------- Timer ----------
  router.post('/api/admin/workspaces/:id/time/start', adminAuth, wrap(async (req, res) => {
    const { ws } = await loadWs(req);
    const t = await db.startTime({ workspace_id: ws.id, admin_id: req.admin.id });
    res.json({ id: t.id, started_at: t.started_at });
  }));

  async function ownTime(req) {
    const t = await db.getTime(req.params.tid);
    if (!t || t.admin_id !== req.admin.id) throw httpError(404, 'Timer not found.');
    return t;
  }
  router.post('/api/admin/workspace-time/:tid/beat', adminAuth, wrap(async (req, res) => {
    const t = await ownTime(req);
    if (t.ended_at) return res.json({ ended: true });
    await db.updateTime(t.id, { last_beat_at: new Date().toISOString() });
    res.json({ ok: true });
  }));
  router.post('/api/admin/workspace-time/:tid/end', adminAuth, wrap(async (req, res) => {
    const t = await ownTime(req);
    if (!t.ended_at) await db.updateTime(t.id, { ended_at: new Date().toISOString(), last_beat_at: new Date().toISOString() });
    res.json({ ok: true });
  }));

  return router;
};

module.exports.KINDS = KINDS;
module.exports.SECTIONS = SECTIONS;
module.exports.cleanData = cleanData;
module.exports.accessFor = accessFor;
module.exports.canSection = canSection;
module.exports.workspaceFolder = workspaceFolder;
module.exports.workspaceRefForFile = workspaceRefForFile;
module.exports.contactFromRequest = contactFromRequest;
module.exports.storedType = storedType;
