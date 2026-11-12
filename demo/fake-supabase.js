// In-memory stand-in for the Supabase client, used ONLY by the demo (npm run demo).
//
// lib/db.js and lib/storage.js call `createClient()` and then build queries with the fluent
// supabase-js API (`from().select().eq().order()...`). This file implements the part of that API
// the app uses, over plain arrays, so the real query code runs unchanged against seed data.
// It is deliberately small: no SQL, no persistence (a restart starts from the seed again).
const crypto = require('crypto');

// Primary keys that aren't `id`, and column defaults the real schema fills in
const PRIMARY = { app_settings: 'key', admin_notes: 'admin_id' };
const DEFAULTS = {
  projects: () => ({ status: 'pending_review', confirm_token: crypto.randomUUID(), phases: [], work_log: [], vat_applicable: true }),
  follow_ups: () => ({ status: 'open', reminder_enabled: true, reminder_frequency: 'weekly', reminder_weekday: 1, reminder_time: '08:00', followups_sent: 0 }),
  invoices: () => ({ status: 'issued', currency: 'USD', vat_rate: 0, vat: 0, issued_at: new Date().toISOString() }),
  receipts: () => ({ source: 'generated' }),
  admin_users: () => ({ role: 'admin', active: true }),
  admin_sessions: () => ({ last_seen_at: new Date().toISOString(), revoked_at: null }),
  auth_codes: () => ({ attempts: 0, used_at: null }),
  admin_reminders: () => ({ email: true, done_at: null, emailed_at: null }),
  admin_saved_notes: () => ({ chars: 0 }),
  workspace_items: () => ({ data: {} }),
  workspace_time: () => ({ started_at: new Date().toISOString(), last_beat_at: new Date().toISOString(), ended_at: null }),
  domain_registry: () => ({ renewal_years: 1, renewal_vat_applicable: true, admin_reminder_days: 7, client_reminder_enabled: true, client_reminder_days: 7 }),
};

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);
const listOf = (s) => String(s).replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''));

// "*, admin:admin_users!admin_id(id, email)" -> { star, cols, embeds: [{ alias, table, fk, cols }] }
function parseSelect(sel = '*') {
  const out = { star: false, cols: [], embeds: [] };
  let depth = 0; let cur = ''; const parts = [];
  for (const ch of String(sel)) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  for (const p of parts) {
    const m = p.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s);
    if (m) out.embeds.push({ alias: m[1] || m[2], table: m[2], fk: m[3] || `${m[2].replace(/s$/, '')}_id`, cols: parseSelect(m[4]) });
    else if (p === '*') out.star = true;
    else out.cols.push(p.split(':').pop());
  }
  return out;
}

function createFakeSupabase(tables = {}) {
  const T = tables;
  const table = (name) => (T[name] ||= []);

  function project(row, spec) {
    const base = spec.star || !spec.cols.length ? { ...row } : Object.fromEntries(spec.cols.map((c) => [c, row[c] ?? null]));
    for (const e of spec.embeds) {
      const target = table(e.table).find((r) => r.id === row[e.fk]);
      base[e.alias] = target ? project(target, e.cols) : null;
    }
    return base;
  }

  class Query {
    constructor(name) { this.name = name; this.filters = []; this.sorts = []; this.op = 'select'; this.spec = parseSelect('*'); }
    select(cols = '*', opts = {}) { if (this.op === 'select') this.op = 'select'; this.spec = parseSelect(cols); this.countMode = opts.count; this.headOnly = opts.head; this.returning = true; return this; }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(fields) { this.op = 'update'; this.payload = fields; return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.payload = rows; this.conflict = opts.onConflict; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v))); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c, v) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c, op, v) {
      if (op === 'in') { const vs = listOf(v); this.filters.push((r) => !vs.includes(r[c])); }
      else if (op === 'is') this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v));
      else this.filters.push((r) => r[c] !== v);
      return this;
    }
    gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
    lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
    like(c, pat) { const re = new RegExp(`^${String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`); this.filters.push((r) => re.test(String(r[c] ?? ''))); return this; }
    ilike(c, pat) { const re = new RegExp(`^${String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i'); this.filters.push((r) => re.test(String(r[c] ?? ''))); return this; }
    order(c, o = {}) { this.sorts.push({ c, asc: o.ascending !== false, nullsFirst: o.nullsFirst }); return this; }
    limit(n) { this.max = n; return this; }
    range(a, b) { this.from = a; this.max = b - a + 1; return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

    run() {
      const rows = table(this.name);
      const match = (r) => this.filters.every((f) => f(r));
      const now = new Date().toISOString();
      let out = [];
      if (this.op === 'insert' || this.op === 'upsert') {
        const pk = this.conflict ? this.conflict.split(',') : [PRIMARY[this.name] || 'id'];
        for (const f of [].concat(this.payload)) {
          const existing = this.op === 'upsert' && rows.find((r) => pk.every((k) => f[k] !== undefined && r[k] === f[k]));
          if (existing) { Object.assign(existing, clone(f)); out.push(existing); continue; }
          const row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...(DEFAULTS[this.name] ? DEFAULTS[this.name]() : {}), ...clone(f) };
          rows.push(row); out.push(row);
        }
      } else if (this.op === 'update') {
        out = rows.filter(match); out.forEach((r) => Object.assign(r, clone(this.payload)));
      } else if (this.op === 'delete') {
        out = rows.filter(match); T[this.name] = rows.filter((r) => !match(r));
      } else {
        out = rows.filter(match);
      }
      if (this.sorts.length) {
        out = [...out].sort((a, b) => {
          for (const s of this.sorts) {
            const x = a[s.c]; const y = b[s.c];
            if (x == null || y == null) { if (x == null && y == null) continue; const nullFirst = s.nullsFirst ?? !s.asc; return (x == null) === nullFirst ? -1 : 1; }
            const d = cmp(x, y); if (d) return s.asc ? d : -d;
          }
          return 0;
        });
      }
      const count = out.length;
      if (this.from) out = out.slice(this.from);
      if (this.max != null) out = out.slice(0, this.max);
      if (this.headOnly) return { data: null, error: null, count };
      let data = (this.op === 'select' || this.returning) ? out.map((r) => clone(project(r, this.spec))) : null;
      if (this.one) {
        if (data && data.length === 1) data = data[0];
        else if (this.one === 'maybe' && (!data || !data.length)) data = null;
        else return { data: null, error: { message: data && data.length ? 'JSON object requested, multiple rows returned' : 'JSON object requested, no rows returned', code: 'PGRST116' }, count };
      }
      return { data, error: null, count: this.countMode ? count : null };
    }
  }

  // Storage: files kept in memory. Signed links point at the demo's own /files route, which
  // the real app serves (it redirects to this URL, which is then answered from memory).
  const files = new Map();
  const storage = {
    from: () => ({
      upload: async (p, buf, opts = {}) => { files.set(p, { buf: Buffer.from(buf), type: opts.contentType }); return { data: { path: p }, error: null }; },
      download: async (p) => (files.has(p) ? { data: new Blob([files.get(p).buf], { type: files.get(p).type }), error: null } : { data: null, error: { message: 'Object not found' } }),
      createSignedUrl: async (p) => ({ data: { signedUrl: `data:${files.get(p)?.type || 'application/octet-stream'};base64,${(files.get(p)?.buf || Buffer.alloc(0)).toString('base64')}` }, error: null }),
      remove: async (ps) => { ps.forEach((p) => files.delete(p)); return { data: [], error: null }; },
      list: async () => ({ data: [...files.keys()].map((name) => ({ name })), error: null }),
    }),
  };

  return { from: (name) => new Query(name), storage, rpc: async () => ({ data: null, error: null }), _tables: T, _files: files };
}

module.exports = { createFakeSupabase };
