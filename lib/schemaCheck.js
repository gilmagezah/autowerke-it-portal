// Checks the database matches what the code expects, so a missed SQL file
// shows up as a clear instruction instead of a confusing error mid-workflow.
//
// Two different problems are detected:
//   1. MISSING COLUMN - a schema_*.sql file hasn't been run yet
//   2. STALE CACHE    - the column exists, but Supabase's API layer (PostgREST)
//                       hasn't reloaded its cached copy of the table, so WRITES
//                       to it fail with "Could not find the ... column ... in the
//                       schema cache". Reads still work, which makes this one sneaky.

// Columns each schema file adds, in the order the files should be run.
const SCHEMA_FILES = [
  { file: 'schema.sql', columns: ['project_id', 'confirm_token', 'status', 'reviewed_requirements', 'change_request'] },
  { file: 'schema_phase3.sql', columns: ['pricing_estimate', 'signed_contract_url'] },
  { file: 'schema_support.sql', columns: ['users_affected', 'attempts_taken', 'devices_affected', 'estimated_hours', 'hourly_rate', 'work_log'] },
  { file: 'schema_delivery.sql', columns: ['phases', 'last_progress_update_at'] },
  { file: 'schema_signoff.sql', columns: ['project_title', 'signoff', 'signoff_sent_at', 'signoff_signed_url', 'signoff_signed_at'] },
  { file: 'schema_closed.sql', columns: ['closed_at'] },
  { file: 'schema_earnings.sql', columns: ['contract_value', 'vat_applicable', 'completed_at', 'converted_from_support_at', 'conversion_reason'] },
  { file: 'schema_support_signoff.sql', columns: ['signed_at'] },
  { file: 'schema_followups.sql', columns: ['estimate_signed_url', 'estimate_signed_at'] },
  { file: 'schema_services.sql', columns: ['domain_service', 'domains', 'domain_quote', 'consult_draft', 'consult_response', 'consult_meeting', 'consult_confirmed'] },
  { file: 'schema_intake_extras.sql', columns: ['attachments', 'priority', 'can_work'] },
  { file: 'schema_secure.sql', columns: ['esign'] },
  { file: 'schema_billing.sql', columns: ['consult_fee', 'consent_at', 'consent_version'] },
  { file: 'schema_website.sql', columns: ['company_website'] },
];

// Whole tables (not just columns) that a schema file creates
const SCHEMA_TABLES = [
  { file: 'schema_followups.sql', table: 'follow_ups', columns: ['reminder_frequency', 'next_reminder_at', 'followups_sent'] },
  { file: 'schema_services.sql', table: 'domain_registry', columns: ['account_password_enc', 'renewal_date', 'admin_reminded_for'] },
  { file: 'schema_billing.sql', table: 'invoices', columns: ['number', 'lines', 'follow_up_id'] },
  { file: 'schema_billing.sql', table: 'receipts', columns: ['number', 'source', 'external_number'] },
  { file: 'schema_billing.sql', table: 'app_settings', columns: ['key', 'value'] },
  { file: 'schema_secure.sql', table: 'admin_users', columns: ['email', 'password_hash', 'role'] },
  { file: 'schema_secure.sql', table: 'admin_sessions', columns: ['token_hash', 'expires_at'] },
  { file: 'schema_secure.sql', table: 'auth_codes', columns: ['purpose', 'code_hash', 'attempts'] },
  { file: 'schema_secure.sql', table: 'signoff_sessions', columns: ['token_hash', 'completed_at'] },
  { file: 'schema_secure.sql', table: 'workspaces', columns: ['ref', 'environment', 'notes'] },
  { file: 'schema_secure.sql', table: 'workspace_items', columns: ['kind', 'secret_enc'] },
  { file: 'schema_secure.sql', table: 'workspace_shares', columns: ['sections'] },
  { file: 'schema_secure.sql', table: 'workspace_time', columns: ['last_beat_at'] },
  { file: 'schema_accessories.sql', table: 'admin_reminders', columns: ['due_at', 'emailed_at', 'done_at', 'source'] },
  { file: 'schema_accessories.sql', table: 'admin_notes', columns: ['pages_enc', 'updated_at'] },
  { file: 'schema_accessories.sql', table: 'admin_saved_notes', columns: ['title_enc', 'body_enc', 'chars'] },
  { file: 'schema_renewals.sql', table: 'domain_registry', columns: ['renewal_years', 'renewal_service_fee', 'renewal_vat_applicable', 'renewal_email', 'renewal_email_sent_for', 'renewal_email_sent_at'] },
];

const RELOAD_SQL = "NOTIFY pgrst, 'reload schema';";
// A row id that can never exist, so the write probe never changes real data
const NO_ROW = '00000000-0000-0000-0000-000000000000';

const isMissingColumn = (error) => error && (error.code === '42703' || /does not exist/i.test(error.message || ''));
const isMissingTable = (error) => error && (error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|relation .* does not exist/i.test(error.message || ''));
const isStaleCache = (error) => error && (error.code === 'PGRST204' || /schema cache/i.test(error.message || ''));

// Returns { ok, missing: [{file, columns}], staleCache: [columns], error }
async function checkSchema(supabase) {
  const result = { ok: true, missing: [], staleCache: [], error: null };

  try {
    for (const group of SCHEMA_FILES) {
      // 1. Do the columns exist? (one cheap read per file)
      const { error: readError } = await supabase.from('projects').select(group.columns.join(',')).limit(1);
      if (readError) {
        if (!isMissingColumn(readError)) throw new Error(readError.message);
        // Find exactly which columns are missing
        const missingCols = [];
        for (const col of group.columns) {
          const { error } = await supabase.from('projects').select(col).limit(1);
          if (isMissingColumn(error)) missingCols.push(col);
        }
        result.missing.push({ file: group.file, columns: missingCols });
        continue; // no point probing the cache for columns that don't exist
      }

      // 2. Can the API write to them? A no-op update on a row that can't exist
      //    touches nothing, but fails fast if the schema cache is stale.
      const probe = Object.fromEntries(group.columns
        .filter((c) => !['project_id', 'confirm_token', 'status'].includes(c)) // NOT NULL / unique columns
        .map((c) => [c, null]));
      if (Object.keys(probe).length) {
        const { error: writeError } = await supabase.from('projects').update(probe).eq('id', NO_ROW);
        if (isStaleCache(writeError)) result.staleCache.push(...Object.keys(probe));
        else if (writeError && !isMissingColumn(writeError)) {
          // e.g. a NOT NULL column rejecting null - not a schema problem, ignore
        }
      }
    }
    // Tables a schema file creates (e.g. follow_ups)
    for (const t of SCHEMA_TABLES) {
      if (result.missing.some((m) => m.file === t.file)) continue; // already reported for this file
      // Same table created by an earlier file that's missing? Report that file only.
      if (result.missing.some((m) => m.columns.includes(`table ${t.table}`))) continue;
      const { error } = await supabase.from(t.table).select(t.columns.join(',')).limit(1);
      if (isMissingTable(error)) result.missing.push({ file: t.file, columns: [`table ${t.table}`] });
      else if (isMissingColumn(error)) result.missing.push({ file: t.file, columns: t.columns });
      else if (isStaleCache(error)) result.staleCache.push(t.table);
      else if (error) throw new Error(error.message);
    }
  } catch (err) {
    result.error = err.message;
  }

  result.ok = !result.error && result.missing.length === 0 && result.staleCache.length === 0;
  return result;
}

// Plain-English instructions for the console and the admin banner
function describe(result) {
  if (result.ok) return [];
  const lines = [];
  if (result.error) lines.push(`Could not check the database: ${result.error}`);
  result.missing.forEach((m) => {
    lines.push(`Run ${m.file} in the Supabase SQL Editor (missing: ${m.columns.join(', ')}).`);
  });
  // Every schema file ends with the cache reload, so only ask for it separately
  // when the cache is stale on its own (not as a follow-up to running a file)
  if (result.staleCache.length && !result.missing.length) {
    lines.push(`Supabase's schema cache is out of date. Run this in the SQL Editor: ${RELOAD_SQL}`);
  }
  return lines;
}

module.exports = { checkSchema, describe, SCHEMA_FILES, SCHEMA_TABLES, RELOAD_SQL, isStaleCache, isMissingColumn, isMissingTable };
