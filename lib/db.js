// All database access goes through here. Uses the Supabase service_role
// key, which must ONLY ever be used server-side (never sent to the browser).

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { checkSchema, describe, isStaleCache, isMissingColumn, RELOAD_SQL } = require('./schemaCheck');

// Database errors caused by schema drift get the fix appended, so the message
// you see in an alert box tells you exactly what to run.
function dbError(prefix, error) {
  let msg = `${prefix}: ${error.message}`;
  if (isStaleCache(error)) msg += ` - Fix: run  ${RELOAD_SQL}  in the Supabase SQL Editor.`;
  else if (isMissingColumn(error)) msg += ' - A schema_*.sql file probably hasn\'t been run yet (see the banner in /admin).';
  return new Error(msg);
}

// Cached for 30s so admin page loads don't hammer the database
let schemaCache = { at: 0, result: null };
async function schemaStatus({ fresh = false } = {}) {
  if (!fresh && schemaCache.result && Date.now() - schemaCache.at < 30000) return schemaCache.result;
  const result = await checkSchema(supabase);
  schemaCache = { at: Date.now(), result: { ok: result.ok, messages: describe(result), detail: result } };
  return schemaCache.result;
}

// "TANNER-7KQ-4X9": the company's name, then six characters in two groups of three, from an
// alphabet with no look-alikes (no 0/O, 1/I/L). That's 887 million possibilities per company
// (the old four digits gave 9,000), so a reference can't be guessed, and it still reads aloud
// and types easily. Older references (TANNER-5422) keep working everywhere.
const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateProjectId(companyName) {
  const slug = String(companyName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'CLIENT';
  const pick = () => REF_CHARS[crypto.randomInt(REF_CHARS.length)]; // unpredictable, unlike Math.random
  const group = () => pick() + pick() + pick();
  return `${slug}-${group()}-${group()}`;
}

// Inserts a new request under a fresh reference. Two companies can share a slug (TANNER-...),
// so if the reference is already taken (unique violation 23505), try another instead of
// losing the client's submission.
async function insertWithFreshRef(row, companyName) {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await supabase.from('projects').insert({ ...row, project_id: generateProjectId(companyName) }).select().single();
    if (!error) return data;
    // Until schema_website.sql is run, a request that includes a website is still saved (without it)
    if ('company_website' in row && /company_website/.test(`${error.message || ''} ${error.details || ''}`)) {
      console.warn('company_website column missing: run schema_website.sql. Saved the request without the website.');
      const { company_website: _dropped, ...rest } = row;
      row = rest;
      continue;
    }
    if (error.code !== '23505' || attempt >= 5) throw dbError('DB insert failed', error);
  }
}

async function createProject({
  requestType, name, surname, companyName, companyWebsite = null, email, phone, position, details,
  aiRequirements, aiScopeSummary, aiTitle,
  usersAffected, attemptsTaken, devicesAffected,
  priority = null, canWork = null, consentAt = null, consentVersion = null,
}) {
  return insertWithFreshRef({
      request_type: requestType,
      name,
      surname,
      company_name: companyName,
      ...(companyWebsite ? { company_website: companyWebsite } : {}),
      email,
      phone,
      position,
      details,
      ai_requirements: aiRequirements,
      ai_scope_summary: aiScopeSummary,
      project_title: aiTitle || null,
      users_affected: usersAffected || null,
      attempts_taken: attemptsTaken || null,
      devices_affected: devicesAffected || null,
      priority,
      can_work: canWork,
      consent_at: consentAt,
      consent_version: consentVersion,
      status: 'pending_review',
  }, companyName);
}

async function listPendingReview() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  // Highest priority first (P5 -> P1), then oldest first; no priority sorts after
  return data.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

async function getProjectById(id) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw dbError('DB query failed', error);
  return data;
}

async function getProjectByToken(token) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('confirm_token', token)
    .single();

  if (error) throw Object.assign(new Error('Project not found for this link.'), { status: 404 });
  return data;
}

async function approveProject(id, { requirements, scopeSummary, title }) {
  const fields = {
    reviewed_requirements: requirements,
    reviewed_scope_summary: scopeSummary,
    status: 'reviewed',
    updated_at: new Date().toISOString(),
  };
  if (title) fields.project_title = title;

  const { data, error } = await supabase
    .from('projects')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

// Client decisions from the portal (confirm, request changes, proceed, decline) go through
// updateByToken with the stages each one is allowed from. See POST /api/confirm/:token.

async function listChangesRequested() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'changes_requested')
    .order('updated_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  return data;
}

// ---------- IT Project side: pricing + contract ----------

async function listAwaitingPricing() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'client_confirmed')
    .eq('request_type', 'IT Project')
    .order('created_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  return data;
}

async function sendPricing(id, pricingEstimate, { contractValue, vatApplicable } = {}) {
  const { data, error } = await supabase
    .from('projects')
    .update({
      pricing_estimate: pricingEstimate,
      contract_value: contractValue,
      vat_applicable: vatApplicable,
      status: 'pricing_sent',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

async function markSigned(token, signedContractUrl) {
  const { data, error } = await supabase
    .from('projects')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_contract_url: signedContractUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('confirm_token', token)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

// ---------- IT Support side: hourly estimate + time tracking ----------

async function listAwaitingEstimate() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'client_confirmed')
    .eq('request_type', 'IT Support')
    .order('created_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  return data;
}

async function sendEstimate(id, { estimatedHours, hourlyRate }) {
  const { data, error } = await supabase
    .from('projects')
    .update({
      estimated_hours: estimatedHours,
      hourly_rate: hourlyRate,
      status: 'estimate_sent',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

async function listInProgress() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'in_progress')
    .order('created_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  return data;
}

async function addWorkLogEntry(id, { date, start, end, note }) {
  const project = await getProjectById(id);
  const entry = { id: crypto.randomUUID(), date, start, end, note: note || '' };
  const updatedLog = [...(project.work_log || []), entry];

  const { data, error } = await supabase
    .from('projects')
    .update({ work_log: updatedLog, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

async function removeWorkLogEntry(id, entryId) {
  const project = await getProjectById(id);
  const updatedLog = (project.work_log || []).filter((e) => e.id !== entryId);

  const { data, error } = await supabase
    .from('projects')
    .update({ work_log: updatedLog, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

// ---------- Support completion sign-off ----------

async function listAwaitingSupportSignoff() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('status', 'awaiting_signoff')
    .order('signoff_sent_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  return data;
}

// Work is done: lock in the hours and wait for the client's signed copy
const markSupportSignoffSent = (id) => updateProject(id, {
  status: 'awaiting_signoff',
  signoff_sent_at: new Date().toISOString(),
  signoff_signed_url: null,
  signoff_signed_at: null,
});

// The client's signed upload completes the ticket (and makes it "earned")
async function markSupportSignoffSigned(token, url) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('projects')
    .update({ status: 'completed', completed_at: now, signoff_signed_url: url, signoff_signed_at: now, updated_at: now })
    .eq('confirm_token', token)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

async function markCompleted(id) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('projects')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

// ---------- IT Project delivery (internal phase tracking) ----------

async function listDelivery() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('request_type', 'IT Project')
    .in('status', ['signed', 'delivered', 'closed'])
    .order('created_at', { ascending: true });

  if (error) throw dbError('DB query failed', error);
  return data;
}

async function updateProject(id, fields) {
  const { data, error } = await supabase
    .from('projects')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

const savePhases = (id, phases) => updateProject(id, { phases });
const markClosed = (id) => updateProject(id, { status: 'closed', closed_at: new Date().toISOString() });
const markProgressUpdateSent = (id) => updateProject(id, { last_progress_update_at: new Date().toISOString() });
const setProjectTitle = (id, title) => updateProject(id, { project_title: title });
const saveSignoff = (id, signoff) => updateProject(id, { signoff });
const markSignoffSent = (id, signoff) =>
  updateProject(id, { signoff, signoff_sent_at: new Date().toISOString(), signoff_signed_url: null, signoff_signed_at: null });

// The client's signed upload officially closes the project (one atomic update)
async function markSignoffSigned(token, url) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('projects')
    .update({
      signoff_signed_url: url,
      signoff_signed_at: now,
      status: 'closed',
      closed_at: now,
      updated_at: now,
    })
    .eq('confirm_token', token)
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

// ---------- Support -> project conversion ----------

// Which support stages can convert, and the project stage each maps to.
// in_progress / completed can't convert: hours are already logged against them.
const CONVERSION_MAP = {
  pending_review: 'pending_review',
  reviewed: 'reviewed',
  changes_requested: 'changes_requested',
  client_confirmed: 'client_confirmed',
  estimate_sent: 'client_confirmed', // support estimate withdrawn -> awaiting project pricing
};

async function convertToProject(id, reason) {
  const project = await getProjectById(id);
  if (project.request_type !== 'IT Support') {
    const err = new Error('Only IT Support requests can be converted.'); err.status = 400; throw err;
  }
  const newStatus = CONVERSION_MAP[project.status];
  if (!newStatus) {
    const err = new Error('This ticket can no longer be converted - work has already started on it.'); err.status = 400; throw err;
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('projects')
    .update({
      request_type: 'IT Project',
      status: newStatus,
      estimated_hours: null, // a withdrawn support estimate shouldn't linger
      hourly_rate: null,
      converted_from_support_at: now,
      conversion_reason: reason,
      updated_at: now,
    })
    .eq('id', id)
    .eq('request_type', 'IT Support') // guard against a double-click converting twice
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return { project: data, previousStatus: project.status };
}

// ---------- Earnings ----------

async function listForAnalytics() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_id, project_title, company_name, request_type, status, created_at, updated_at, closed_at, completed_at, contract_value, vat_applicable, pricing_estimate, estimated_hours, hourly_rate, work_log, domain_quote, consult_fee');

  if (error) throw dbError('DB query failed', error);
  return data;
}

const setContractValue = (id, contractValue, vatApplicable) =>
  updateProject(id, { contract_value: contractValue, vat_applicable: vatApplicable });

// ---------- Signed support estimates ----------

// The client's signed estimate is their approval: work can start
async function markEstimateSigned(token, url) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('projects')
    .update({ status: 'in_progress', estimate_signed_url: url, estimate_signed_at: now, updated_at: now })
    .eq('confirm_token', token)
    .eq('status', 'estimate_sent') // only from the right stage, even on a double upload
    .select()
    .single();

  if (error) throw dbError('DB update failed', error);
  return data;
}

// ---------- Payment follow-ups ----------

async function listFollowUps() {
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .order('status', { ascending: true })    // 'open' sorts before 'paid'
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw dbError('DB query failed', error);
  return data;
}

async function getFollowUp(id) {
  const { data, error } = await supabase.from('follow_ups').select('*').eq('id', id).single();
  if (error) throw dbError('DB query failed', error);
  return data;
}

async function createFollowUp(fields) {
  const { data, error } = await supabase.from('follow_ups').insert(fields).select().single();
  if (error) throw dbError('DB insert failed', error);
  return data;
}

async function updateFollowUp(id, fields) {
  const { data, error } = await supabase
    .from('follow_ups')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw dbError('DB update failed', error);
  return data;
}

async function deleteFollowUp(id) {
  const { error } = await supabase.from('follow_ups').delete().eq('id', id);
  if (error) throw dbError('DB update failed', error);
}

async function listDueReminders(now = new Date()) {
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('status', 'open')
    .eq('reminder_enabled', true)
    .lte('next_reminder_at', now.toISOString());
  if (error) throw dbError('DB query failed', error);
  return data;
}

// Work you can pick from when adding a follow-up (pre-fills company, email, amount)
async function listFollowUpSources() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_id, project_title, company_name, name, surname, email, request_type, status, contract_value, vat_applicable, estimated_hours, hourly_rate, work_log, closed_at, completed_at, updated_at')
    .in('status', ['proceeding', 'signed', 'delivered', 'closed', 'in_progress', 'awaiting_signoff', 'completed'])
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) throw dbError('DB query failed', error);
  return data;
}

// ---------- Domains + Consultancy requests (stored as requests) ----------

// Generic insert for the newer services: reference number + confirm token come for free
async function createRequest(fields) {
  return insertWithFreshRef(fields, fields.company_name);
}

async function listByType(requestType, statuses) {
  let q = supabase.from('projects').select('*').eq('request_type', requestType);
  if (statuses) q = q.in('status', statuses);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) throw dbError('DB query failed', error);
  return data;
}

// Client-side actions: only apply when the request is at the expected stage
async function updateByToken(token, fields, expectedStatuses) {
  let q = supabase.from('projects')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('confirm_token', token);
  if (expectedStatuses) q = q.in('status', expectedStatuses);
  const { data, error } = await q.select().single();
  if (error) {
    const err = dbError('DB update failed', error);
    if (error.code === 'PGRST116') { err.message = 'This link is not expecting that action right now.'; err.status = 409; }
    throw err;
  }
  return data;
}

// ---------- Managed domains registry ----------

async function listRegistry() {
  const { data, error } = await supabase
    .from('domain_registry')
    .select('*')
    .order('client_company', { ascending: true })
    .order('renewal_date', { ascending: true, nullsFirst: false });
  if (error) throw dbError('DB query failed', error);
  return data;
}

async function getRegistry(id) {
  const { data, error } = await supabase.from('domain_registry').select('*').eq('id', id).single();
  if (error) throw dbError('DB query failed', error);
  return data;
}

async function createRegistry(fields) {
  const { data, error } = await supabase.from('domain_registry').insert(fields).select().single();
  if (error) throw dbError('DB insert failed', error);
  return data;
}

async function updateRegistry(id, fields) {
  const { data, error } = await supabase
    .from('domain_registry')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw dbError('DB update failed', error);
  return data;
}

async function deleteRegistry(id) {
  const { error } = await supabase.from('domain_registry').delete().eq('id', id);
  if (error) throw dbError('DB update failed', error);
}

// ---------- Contacts directory ----------

async function listForDirectory() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_id, project_title, company_name, name, surname, position, email, phone, request_type, status, created_at, updated_at, signoff_sent_at, signoff_signed_at')
    .order('created_at', { ascending: false });
  if (error) throw dbError('DB query failed', error);
  return data;
}

// ================= Secure admin accounts =================
// Joins always name the link they use (e.g. admin_users!admin_id). workspace_shares has two
// links to admin_users (admin_id and created_by), and an unnamed join there is ambiguous:
// Supabase refuses it. scripts/check-joins.js checks this for every join.

const one = async (q, label = 'DB query failed') => {
  const { data, error } = await q;
  if (error && error.code === 'PGRST116') return null; // no row
  if (error) throw dbError(label, error);
  return data;
};

async function countAdmins() {
  const { count, error } = await supabase.from('admin_users').select('id', { count: 'exact', head: true });
  if (error) throw dbError('DB query failed', error);
  return count || 0;
}
const getAdminByEmail = (email) => one(supabase.from('admin_users').select('*').eq('email', String(email).toLowerCase()).single());
const getAdminById = (id) => one(supabase.from('admin_users').select('*').eq('id', id).single());
const listAdmins = () => one(supabase.from('admin_users').select('id, email, name, role, active, created_at, last_login_at').order('created_at'));
const createAdmin = (f) => one(supabase.from('admin_users').insert({ ...f, email: String(f.email).toLowerCase() }).select().single(), 'DB insert failed');
const updateAdmin = (id, f) => one(supabase.from('admin_users').update(f).eq('id', id).select().single(), 'DB update failed');

const createAdminSession = (f) => one(supabase.from('admin_sessions').insert(f).select().single(), 'DB insert failed');
const getAdminSession = (tokenHash) => one(supabase.from('admin_sessions').select('*, admin:admin_users!admin_id(id, email, name, role, active)').eq('token_hash', tokenHash).single());
const touchAdminSession = (id, f) => one(supabase.from('admin_sessions').update(f).eq('id', id).select('id').single(), 'DB update failed');
// Every session this admin has had (for the all-time signed-in clock). Paged: Supabase returns at most 1,000 rows per call.
async function listAdminSessionTimes(adminId) {
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await supabase.from('admin_sessions').select('id, created_at, last_seen_at, revoked_at, expires_at')
      .eq('admin_id', adminId).order('created_at').range(from, from + 999);
    if (error) throw dbError('DB query failed', error);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function revokeAdminSessions(adminId) {
  const { error } = await supabase.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', adminId).is('revoked_at', null);
  if (error) throw dbError('DB update failed', error);
}

// ---------- One-time codes ----------
const createCode = (f) => one(supabase.from('auth_codes').insert(f).select().single(), 'DB insert failed');
const latestCode = (purpose, subjectId) => one(supabase.from('auth_codes').select('*').eq('purpose', purpose).eq('subject_id', subjectId)
  .order('created_at', { ascending: false }).limit(1).single());
const updateCode = (id, f) => one(supabase.from('auth_codes').update(f).eq('id', id).select().single(), 'DB update failed');
async function invalidateCodes(purpose, subjectId) {
  const { error } = await supabase.from('auth_codes').update({ used_at: new Date().toISOString() }).eq('purpose', purpose).eq('subject_id', subjectId).is('used_at', null);
  if (error) throw dbError('DB update failed', error);
}

// ---------- Online sign-off ----------
// References are stored uppercase (e.g. TANNER-5422). Exact match only, never a pattern:
// a pattern match would let "%" match any request.
const REF_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const cleanRef = (ref) => { const r = String(ref || '').trim().toUpperCase().replace(/\s+/g, '-'); return REF_RE.test(r) ? r : null; };
const getProjectByRef = async (ref) => { const r = cleanRef(ref); return r ? one(supabase.from('projects').select('*').eq('project_id', r).single()) : null; };
const createSignoffSession = (f) => one(supabase.from('signoff_sessions').insert(f).select().single(), 'DB insert failed');
const getSignoffSession = (tokenHash) => one(supabase.from('signoff_sessions').select('*').eq('token_hash', tokenHash).single());
const updateSignoffSession = (id, f) => one(supabase.from('signoff_sessions').update(f).eq('id', id).select().single(), 'DB update failed');

// ---------- Admin workspace ----------
const getWorkspace = (id) => one(supabase.from('workspaces').select('*').eq('id', id).single());
const getWorkspaceByRef = async (ref) => { const r = cleanRef(ref); return r ? one(supabase.from('workspaces').select('*').eq('ref', r).single()) : null; };
const createWorkspace = (f) => one(supabase.from('workspaces').insert(f).select().single(), 'DB insert failed');
const updateWorkspace = (id, f) => one(supabase.from('workspaces').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id).select().single(), 'DB update failed');
const listOwnedWorkspaces = (adminId) => one(supabase.from('workspaces').select('*').eq('owner_id', adminId).order('updated_at', { ascending: false }));
const listSharesForAdmin = (adminId) => one(supabase.from('workspace_shares').select('*, workspace:workspaces!workspace_id(*)').eq('admin_id', adminId));
const listShares = (wsId) => one(supabase.from('workspace_shares').select('*, admin:admin_users!admin_id(id, email, name)').eq('workspace_id', wsId));
const getShare = (wsId, adminId) => one(supabase.from('workspace_shares').select('*').eq('workspace_id', wsId).eq('admin_id', adminId).single());
const upsertShare = (f) => one(supabase.from('workspace_shares').upsert(f, { onConflict: 'workspace_id,admin_id' }).select().single(), 'DB update failed');
async function deleteShare(id, wsId) {
  const { error } = await supabase.from('workspace_shares').delete().eq('id', id).eq('workspace_id', wsId);
  if (error) throw dbError('DB update failed', error);
}
const listItems = (wsId) => one(supabase.from('workspace_items').select('*').eq('workspace_id', wsId).order('created_at'));
const getItem = (id) => one(supabase.from('workspace_items').select('*').eq('id', id).single());
const createItem = (f) => one(supabase.from('workspace_items').insert(f).select().single(), 'DB insert failed');
const updateItem = (id, f) => one(supabase.from('workspace_items').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id).select().single(), 'DB update failed');
async function deleteItem(id) {
  const { error } = await supabase.from('workspace_items').delete().eq('id', id);
  if (error) throw dbError('DB update failed', error);
}
const startTime = (f) => one(supabase.from('workspace_time').insert(f).select().single(), 'DB insert failed');
const getTime = (id) => one(supabase.from('workspace_time').select('*').eq('id', id).single());
const updateTime = (id, f) => one(supabase.from('workspace_time').update(f).eq('id', id).select().single(), 'DB update failed');
const listTime = (wsId) => one(supabase.from('workspace_time').select('*, admin:admin_users!admin_id(name)').eq('workspace_id', wsId));

// ================= Billing: invoices, receipts, settings =================

const listInvoices = () => one(supabase.from('invoices').select('*').order('issued_at', { ascending: false }).limit(500));
const getInvoice = (id) => one(supabase.from('invoices').select('*').eq('id', id).single());
const updateInvoice = (id, f) => one(supabase.from('invoices').update(f).eq('id', id).select().single(), 'DB update failed');
const listInvoicesForRequest = (requestId) => one(supabase.from('invoices').select('*').eq('request_id', requestId).order('issued_at'));
const listReceipts = () => one(supabase.from('receipts').select('*').order('received_on', { ascending: false }).limit(500));
const listReceiptsForInvoice = (invoiceId) => one(supabase.from('receipts').select('*').eq('invoice_id', invoiceId));
const updateReceiptFile = (id, url) => one(supabase.from('receipts').update({ file_url: url }).eq('id', id).select().single(), 'DB update failed');
const listReceiptsForRequest = (requestId) => one(supabase.from('receipts').select('*').eq('request_id', requestId).order('received_on'));

// Next sequential number for this year, e.g. AW-INV-2026-0007. Inserts retry on a clash.
async function nextNumber(table, kind) {
  const prefix = `AW-${kind}-${new Date().getFullYear()}-`;
  const { data, error } = await supabase.from(table).select('number').like('number', `${prefix}%`).order('number', { ascending: false }).limit(1);
  if (error) throw dbError('DB query failed', error);
  const last = data && data[0] ? parseInt(data[0].number.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(last + 1).padStart(4, '0')}`;
}

async function insertNumbered(table, kind, fields) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = fields.number || await nextNumber(table, kind);
    const { data, error } = await supabase.from(table).insert({ ...fields, number }).select().single();
    if (!error) return data;
    if (error.code !== '23505' || fields.number) throw dbError('DB insert failed', error); // 23505 = number already taken
  }
  throw new Error('Could not allocate a document number. Please try again.');
}
const createInvoice = (f) => insertNumbered('invoices', 'INV', f);
const createReceipt = (f) => insertNumbered('receipts', 'RCT', f);

const getSetting = async (key) => { const r = await one(supabase.from('app_settings').select('value').eq('key', key).single()); return r ? r.value : null; };
const setSetting = (key, value) => one(supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }).select().single(), 'DB update failed');

// Requests that can be invoiced, with what's needed to suggest invoice lines
const listBillable = () => one(supabase.from('projects')
  .select('id, project_id, project_title, company_name, name, surname, email, request_type, status, contract_value, vat_applicable, estimated_hours, hourly_rate, work_log, domain_quote, consult_fee, created_at')
  .not('status', 'in', '(pending_review,declined)').order('created_at', { ascending: false }).limit(200));

// ================= Accessories: reminders, notes (schema_accessories.sql) =================
// Every reminder query names the admin it belongs to, so one admin can never read or change
// another's reminders, even with a guessed id.

const listReminders = (adminId) => one(supabase.from('admin_reminders').select('*')
  .eq('admin_id', adminId).is('done_at', null).order('due_at').limit(100));
const listRecentDoneReminders = (adminId, since) => one(supabase.from('admin_reminders').select('*')
  .eq('admin_id', adminId).gte('done_at', since).order('done_at', { ascending: false }).limit(10));
const countOpenReminders = async (adminId) => {
  const { count, error } = await supabase.from('admin_reminders').select('id', { count: 'exact', head: true }).eq('admin_id', adminId).is('done_at', null);
  if (error) throw dbError('DB query failed', error);
  return count || 0;
};
const createReminder = (f) => one(supabase.from('admin_reminders').insert(f).select().single(), 'DB insert failed');
const updateReminder = (id, adminId, f) => one(supabase.from('admin_reminders').update(f).eq('id', id).eq('admin_id', adminId).select().single(), 'DB update failed');
async function deleteReminder(id, adminId) {
  const { error } = await supabase.from('admin_reminders').delete().eq('id', id).eq('admin_id', adminId);
  if (error) throw dbError('DB update failed', error);
}
// For the cron: due, not done, wants an email, not emailed yet - with whose it is
const listDueAdminReminders = (now) => one(supabase.from('admin_reminders')
  .select('*, admin:admin_users!admin_id(email, name, active)')
  .is('done_at', null).eq('email', true).is('emailed_at', null).lte('due_at', now.toISOString()).order('due_at').limit(200));
const markRemindersEmailed = async (ids, at) => {
  if (!ids.length) return;
  const { error } = await supabase.from('admin_reminders').update({ emailed_at: at }).in('id', ids);
  if (error) throw dbError('DB update failed', error);
};
const getNotes = (adminId) => one(supabase.from('admin_notes').select('*').eq('admin_id', adminId).single());
const saveNotes = (adminId, pagesEnc, updatedAt) => one(supabase.from('admin_notes')
  .upsert({ admin_id: adminId, pages_enc: pagesEnc, updated_at: updatedAt }).select('updated_at').single(), 'DB update failed');
// Saved notes: title and body arrive here already encrypted; every query names the admin
const SAVED_COLS = 'id, admin_id, title_enc, chars, created_at, updated_at';
const listSavedNotes = (adminId) => one(supabase.from('admin_saved_notes').select(SAVED_COLS + ', body_enc')
  .eq('admin_id', adminId).order('updated_at', { ascending: false }).limit(200));
const getSavedNote = (id, adminId) => one(supabase.from('admin_saved_notes').select('*').eq('id', id).eq('admin_id', adminId).single());
const countSavedNotes = async (adminId) => {
  const { count, error } = await supabase.from('admin_saved_notes').select('id', { count: 'exact', head: true }).eq('admin_id', adminId);
  if (error) throw dbError('DB query failed', error);
  return count || 0;
};
const createSavedNote = (f) => one(supabase.from('admin_saved_notes').insert(f).select(SAVED_COLS).single(), 'DB insert failed');
const updateSavedNote = (id, adminId, f) => one(supabase.from('admin_saved_notes').update(f).eq('id', id).eq('admin_id', adminId).select(SAVED_COLS).single(), 'DB update failed');
async function deleteSavedNote(id, adminId) {
  const { error } = await supabase.from('admin_saved_notes').delete().eq('id', id).eq('admin_id', adminId);
  if (error) throw dbError('DB update failed', error);
}
// What the suggested reminders and the debrief look at
const listForReminders = () => one(supabase.from('projects')
  .select('id, project_id, project_title, company_name, request_type, status, created_at, updated_at, signoff_sent_at, signoff_signed_at, consult_confirmed, work_log, phases, estimated_hours')
  .not('status', 'in', '(declined,closed,completed,consult_closed)').order('updated_at', { ascending: false }).limit(300));

// ---------- Admin stats ----------

async function listAllForStats() {
  const { data, error } = await supabase
    .from('projects')
    .select('company_name, request_type, status');

  if (error) throw dbError('DB query failed', error);
  return data;
}

// ---------- Public tracking ----------

async function getProjectByIdAndEmail(projectId, email) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('project_id', projectId)
    .eq('email', email)
    .single();

  if (error) throw new Error('No matching project found for that reference and email.');
  return data;
}

module.exports = {
  listInvoices, getInvoice, updateInvoice, listInvoicesForRequest, listReceipts, listReceiptsForRequest, listReceiptsForInvoice, updateReceiptFile,
  nextNumber, createInvoice, createReceipt, getSetting, setSetting, listBillable,
  listReminders, listRecentDoneReminders, countOpenReminders, createReminder, updateReminder, deleteReminder,
  listDueAdminReminders, markRemindersEmailed, getNotes, saveNotes, listForReminders,
  listSavedNotes, getSavedNote, countSavedNotes, createSavedNote, updateSavedNote, deleteSavedNote,
  countAdmins, getAdminByEmail, getAdminById, listAdmins, createAdmin, updateAdmin,
  createAdminSession, getAdminSession, touchAdminSession, revokeAdminSessions, listAdminSessionTimes,
  createCode, latestCode, updateCode, invalidateCodes,
  getProjectByRef, cleanRef, generateProjectId, createSignoffSession, getSignoffSession, updateSignoffSession,
  getWorkspace, getWorkspaceByRef, createWorkspace, updateWorkspace, listOwnedWorkspaces, listSharesForAdmin,
  listShares, getShare, upsertShare, deleteShare, listItems, getItem, createItem, updateItem, deleteItem,
  startTime, getTime, updateTime, listTime,
  createProject,
  listPendingReview,
  getProjectById,
  getProjectByToken,
  getProjectByIdAndEmail,
  approveProject,
  listAwaitingPricing,
  sendPricing,
  markSigned,
  listAwaitingEstimate,
  sendEstimate,
  listInProgress,
  addWorkLogEntry,
  removeWorkLogEntry,
  markCompleted,
  listAllForStats,
  listChangesRequested,
  listDelivery,
  savePhases,
  markClosed,
  markProgressUpdateSent,
  setProjectTitle,
  saveSignoff,
  markSignoffSent,
  markSignoffSigned,
  convertToProject,
  CONVERSION_MAP,
  listForAnalytics,
  listForDirectory,
  setContractValue,
  schemaStatus,
  listAwaitingSupportSignoff,
  markSupportSignoffSent,
  markSupportSignoffSigned,
  markEstimateSigned,
  listFollowUps,
  getFollowUp,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
  listDueReminders,
  listFollowUpSources,
  createRequest,
  updateProject,
  listByType,
  updateByToken,
  listRegistry,
  getRegistry,
  createRegistry,
  updateRegistry,
  deleteRegistry,
};
