// In-memory stand-in for the new tables, patched onto the real db module before the server loads.
const crypto = require('crypto');
module.exports = function install(db) {
  // Tests never fetch real currency rates (a suite that tests them turns this back on, with fetch stubbed)
  process.env.FX_RATES_AUTO = 'off';
  const T = { admin_users: [], admin_sessions: [], auth_codes: [], signoff_sessions: [], workspaces: [], workspace_items: [], workspace_shares: [], workspace_time: [], projects: [] };
  const now = () => new Date().toISOString();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const ins = (t, f) => { const r = { id: crypto.randomUUID(), created_at: now(), ...f }; T[t].push(r); return clone(r); };
  const upd = (t, id, f) => { const r = T[t].find((x) => x.id === id); if (!r) return null; Object.assign(r, f); return clone(r); };
  const adminPub = (a) => a && { id: a.id, email: a.email, name: a.name, role: a.role, active: a.active };
  Object.assign(db, {
    countAdmins: async () => T.admin_users.length,
    getAdminByEmail: async (e) => clone(T.admin_users.find((a) => a.email === String(e).toLowerCase()) || null),
    getAdminById: async (id) => clone(T.admin_users.find((a) => a.id === id) || null),
    listAdmins: async () => T.admin_users.map((a) => ({ ...adminPub(a), last_login_at: a.last_login_at })),
    createAdmin: async (f) => ins('admin_users', { active: true, role: 'admin', ...f, email: f.email.toLowerCase() }),
    updateAdmin: async (id, f) => upd('admin_users', id, f),
    createAdminSession: async (f) => ins('admin_sessions', { last_seen_at: now(), revoked_at: null, ...f }),
    getAdminSession: async (h) => { const s = T.admin_sessions.find((x) => x.token_hash === h); return s ? { ...clone(s), admin: adminPub(T.admin_users.find((a) => a.id === s.admin_id)) } : null; },
    touchAdminSession: async (id, f) => upd('admin_sessions', id, f),
    listAdminSessionTimes: async (aid) => clone(T.admin_sessions.filter((x) => x.admin_id === aid).map(({ id, created_at, last_seen_at, revoked_at, expires_at }) => ({ id, created_at, last_seen_at, revoked_at, expires_at }))),
    revokeAdminSessions: async (aid) => { T.admin_sessions.filter((s) => s.admin_id === aid).forEach((s) => { s.revoked_at = now(); }); },
    createCode: async (f) => ins('auth_codes', { attempts: 0, used_at: null, ...f }),
    latestCode: async (p, sid) => clone(T.auth_codes.filter((c) => c.purpose === p && c.subject_id === sid).slice(-1)[0] || null),
    updateCode: async (id, f) => upd('auth_codes', id, f),
    invalidateCodes: async (p, sid) => { T.auth_codes.filter((c) => c.purpose === p && c.subject_id === sid && !c.used_at).forEach((c) => { c.used_at = now(); }); },
    getProjectByRef: async (ref) => { const r = db.cleanRef(ref); return r ? clone(T.projects.find((p) => p.project_id === r) || null) : null; },
    // Exact match on both, like the real query (lib/db.js)
    getProjectByIdAndEmail: async (ref, email) => { const p = T.projects.find((x) => x.project_id === ref && x.email === email); if (!p) throw new Error("No matching project found for that reference and email."); return clone(p); },
    getProjectById: async (id) => { const p = T.projects.find((x) => x.id === id); if (!p) throw new Error('not found'); return clone(p); },
    updateProject: async (id, f) => upd('projects', id, f),
    markSupportSignoffSigned: async (tok, url) => { const p = T.projects.find((x) => x.confirm_token === tok); Object.assign(p, { status: 'completed', signoff_signed_url: url, signoff_signed_at: now(), completed_at: now() }); return clone(p); },
    markSignoffSigned: async (tok, url) => { const p = T.projects.find((x) => x.confirm_token === tok); Object.assign(p, { status: 'closed', signoff_signed_url: url, signoff_signed_at: now(), closed_at: now() }); return clone(p); },
    createSignoffSession: async (f) => ins('signoff_sessions', { completed_at: null, ...f }),
    getSignoffSession: async (h) => clone(T.signoff_sessions.find((s) => s.token_hash === h) || null),
    updateSignoffSession: async (id, f) => upd('signoff_sessions', id, f),
    getWorkspace: async (id) => clone(T.workspaces.find((w) => w.id === id) || null),
    getWorkspaceByRef: async (ref) => { const r = db.cleanRef(ref); return r ? clone(T.workspaces.find((w) => w.ref === r) || null) : null; },
    createWorkspace: async (f) => ins('workspaces', { updated_at: now(), notes: null, environment: null, ...f }),
    updateWorkspace: async (id, f) => upd('workspaces', id, { ...f, updated_at: now() }),
    listOwnedWorkspaces: async (aid) => clone(T.workspaces.filter((w) => w.owner_id === aid)),
    listSharesForAdmin: async (aid) => T.workspace_shares.filter((s) => s.admin_id === aid).map((s) => ({ ...clone(s), workspace: clone(T.workspaces.find((w) => w.id === s.workspace_id)) })),
    listShares: async (wid) => T.workspace_shares.filter((s) => s.workspace_id === wid).map((s) => ({ ...clone(s), admin: adminPub(T.admin_users.find((a) => a.id === s.admin_id)) })),
    getShare: async (wid, aid) => clone(T.workspace_shares.find((s) => s.workspace_id === wid && s.admin_id === aid) || null),
    upsertShare: async (f) => { const ex = T.workspace_shares.find((s) => s.workspace_id === f.workspace_id && s.admin_id === f.admin_id); return ex ? upd('workspace_shares', ex.id, f) : ins('workspace_shares', f); },
    deleteShare: async (id, wid) => { T.workspace_shares = T.workspace_shares.filter((s) => !(s.id === id && s.workspace_id === wid)); },
    listItems: async (wid) => clone(T.workspace_items.filter((i) => i.workspace_id === wid)),
    getItem: async (id) => clone(T.workspace_items.find((i) => i.id === id) || null),
    createItem: async (f) => ins('workspace_items', { updated_at: now(), ...f }),
    updateItem: async (id, f) => upd('workspace_items', id, f),
    deleteItem: async (id) => { T.workspace_items = T.workspace_items.filter((i) => i.id !== id); },
    startTime: async (f) => ins('workspace_time', { started_at: now(), last_beat_at: now(), ended_at: null, ...f }),
    getTime: async (id) => clone(T.workspace_time.find((t) => t.id === id) || null),
    updateTime: async (id, f) => upd('workspace_time', id, f),
    listTime: async (wid) => T.workspace_time.filter((t) => t.workspace_id === wid).map((t) => ({ ...clone(t), admin: { name: (T.admin_users.find((a) => a.id === t.admin_id) || {}).name } })),
    listRegistry: async () => [],
    schemaStatus: async () => ({ ok: true, messages: [] }),
  });
  return T;
};

// Billing + follow-up extensions (added for the billing tests)
module.exports.extend = function extend(db, T) {
  const crypto = require('crypto');
  const now = () => new Date().toISOString();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  Object.assign(T, { invoices: [], receipts: [], app_settings: {}, follow_ups: [] });
  const numbered = (table, kind) => (f) => {
    const prefix = `AW-${kind}-${new Date().getFullYear()}-`;
    const n = f.number || `${prefix}${String(T[table].filter((x) => x.number.startsWith(prefix)).length + 1).padStart(4, '0')}`;
    if (T[table].some((x) => x.number === n)) throw new Error('duplicate number');
    const r = { id: crypto.randomUUID(), created_at: now(), issued_at: now(), status: 'issued', ...f, number: n }; T[table].push(r); return clone(r);
  };
  Object.assign(db, {
    createInvoice: async (f) => numbered('invoices', 'INV')(f),
    createReceipt: async (f) => numbered('receipts', 'RCT')(f),
    listInvoices: async () => clone(T.invoices), listReceipts: async () => clone(T.receipts),
    getInvoice: async (id) => clone(T.invoices.find((x) => x.id === id) || null),
    updateInvoice: async (id, f) => { const r = T.invoices.find((x) => x.id === id); Object.assign(r, f); return clone(r); },
    listInvoicesForRequest: async (rid) => clone(T.invoices.filter((x) => x.request_id === rid)),
    listReceiptsForRequest: async (rid) => clone(T.receipts.filter((x) => x.request_id === rid)),
    listReceiptsForInvoice: async (iid) => clone(T.receipts.filter((x) => x.invoice_id === iid)),
    updateReceiptFile: async (id, url) => { const r = T.receipts.find((x) => x.id === id); r.file_url = url; return clone(r); },
    getSetting: async (k) => clone(T.app_settings[k] ?? null), setSetting: async (k, v) => { T.app_settings[k] = v; return { key: k, value: v }; },
    listBillable: async () => clone(T.projects.filter((p) => !['pending_review', 'declined'].includes(p.status))),
    createFollowUp: async (f) => { const r = { id: crypto.randomUUID(), status: 'open', ...f }; T.follow_ups.push(r); return clone(r); },
    updateFollowUp: async (id, f) => { const r = T.follow_ups.find((x) => x.id === id); Object.assign(r, f); return clone(r); },
    getProjectByToken: async (t) => { const p = T.projects.find((x) => x.confirm_token === t); if (!p) throw Object.assign(new Error('Project not found for this link.'), { status: 404 }); return clone(p); },
    // Same contract as the real one: no row at an expected stage -> 409
    updateByToken: async (t, f, expected) => {
      const p = T.projects.find((x) => x.confirm_token === t && (!expected || expected.includes(x.status)));
      if (!p) throw Object.assign(new Error('This link is not expecting that action right now.'), { status: 409 });
      Object.assign(p, f, { updated_at: now() }); return clone(p);
    },
    markSigned: async (t, url) => { const p = T.projects.find((x) => x.confirm_token === t); Object.assign(p, { status: 'signed', signed_at: now(), signed_contract_url: url }); return clone(p); },
    // Whole rows on purpose (tokens included): the Quick find test checks the server slims them
    listForDirectory: async () => clone(T.projects),
    addWorkLogEntry: async (id, e) => { const p = T.projects.find((x) => x.id === id); if (!p) throw new Error('not found'); p.work_log = [...(p.work_log || []), { id: crypto.randomUUID(), ...e }]; return clone(p); },
  });
};

// Accessories extensions: admin reminders and synced notes (schema_accessories.sql)
module.exports.accessories = function accessories(db, T) {
  const crypto = require('crypto');
  const now = () => new Date().toISOString();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  Object.assign(T, { admin_reminders: [], admin_notes: [], admin_saved_notes: [] });
  const open = (aid) => T.admin_reminders.filter((r) => r.admin_id === aid && !r.done_at);
  const byDue = (a, b) => new Date(a.due_at) - new Date(b.due_at);
  Object.assign(db, {
    listReminders: async (aid) => clone(open(aid).sort(byDue).slice(0, 100)),
    listRecentDoneReminders: async (aid, since) => clone(T.admin_reminders.filter((r) => r.admin_id === aid && r.done_at && r.done_at >= since)),
    countOpenReminders: async (aid) => open(aid).length,
    createReminder: async (f) => { const r = { id: crypto.randomUUID(), created_at: now(), note: null, ref: null, source: null, emailed_at: null, done_at: null, email: true, ...f }; T.admin_reminders.push(r); return clone(r); },
    updateReminder: async (id, aid, f) => { const r = T.admin_reminders.find((x) => x.id === id && x.admin_id === aid); if (!r) return null; Object.assign(r, f); return clone(r); },
    deleteReminder: async (id, aid) => { T.admin_reminders = T.admin_reminders.filter((x) => !(x.id === id && x.admin_id === aid)); },
    listDueAdminReminders: async (at) => clone(T.admin_reminders
      .filter((r) => !r.done_at && r.email && !r.emailed_at && new Date(r.due_at) <= new Date(at))
      .map((r) => { const a = T.admin_users.find((x) => x.id === r.admin_id); return { ...r, admin: a && { email: a.email, name: a.name, active: a.active } }; })),
    markRemindersEmailed: async (ids, at) => { T.admin_reminders.filter((r) => ids.includes(r.id)).forEach((r) => { r.emailed_at = at; }); },
    getNotes: async (aid) => clone(T.admin_notes.find((n) => n.admin_id === aid) || null),
    saveNotes: async (aid, pagesEnc, updatedAt) => {
      const ex = T.admin_notes.find((n) => n.admin_id === aid);
      if (ex) Object.assign(ex, { pages_enc: pagesEnc, updated_at: updatedAt }); else T.admin_notes.push({ admin_id: aid, pages_enc: pagesEnc, updated_at: updatedAt });
      return { updated_at: updatedAt };
    },
    listSavedNotes: async (aid) => clone(T.admin_saved_notes.filter((n) => n.admin_id === aid).sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1))),
    getSavedNote: async (id, aid) => clone(T.admin_saved_notes.find((n) => n.id === id && n.admin_id === aid) || null),
    countSavedNotes: async (aid) => T.admin_saved_notes.filter((n) => n.admin_id === aid).length,
    createSavedNote: async (f) => { const r = { id: crypto.randomUUID(), ...f }; T.admin_saved_notes.push(r); const { body_enc, ...rest } = r; return clone(rest); },
    updateSavedNote: async (id, aid, f) => { const r = T.admin_saved_notes.find((n) => n.id === id && n.admin_id === aid); if (!r) return null; Object.assign(r, f); const { body_enc, ...rest } = r; return clone(rest); },
    deleteSavedNote: async (id, aid) => { T.admin_saved_notes = T.admin_saved_notes.filter((n) => !(n.id === id && n.admin_id === aid)); },
    listForReminders: async () => clone(T.projects.filter((p) => !['declined', 'closed', 'completed', 'consult_closed'].includes(p.status))),
  });
};
