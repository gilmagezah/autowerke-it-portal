-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- LOCKDOWN: run it LAST, after every other schema file (including schema_billing.sql).
--
-- 1. Row Level Security on every table, with NO policies. That means the public "anon" key
--    (and any logged-in Supabase user) can read and write NOTHING. The app is unaffected:
--    it uses the server-only service key, which bypasses RLS. This is a second wall: even
--    if the anon key ever leaked, the data stays closed.
-- 2. The storage bucket becomes private. Files are then only reachable through the app's
--    /files route, which checks who's asking and hands out 60-second links.

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'follow_ups', 'domain_registry',
    'admin_users', 'admin_sessions', 'auth_codes', 'signoff_sessions',
    'workspaces', 'workspace_items', 'workspace_shares', 'workspace_time',
    'invoices', 'receipts', 'app_settings',
    'admin_reminders', 'admin_notes', 'admin_saved_notes'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
      raise notice 'RLS on: %', t;
    else
      raise notice 'skipped (not created yet): %', t;
    end if;
  end loop;
end $$;

update storage.buckets set public = false where id = 'contracts';

-- Check: every row below should say rls_enabled = true
select relname as table_name, relrowsecurity as rls_enabled
from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
