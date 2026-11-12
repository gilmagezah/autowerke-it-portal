-- Optional company website on the intake form (helps spell the company's name right).
-- Run in the Supabase SQL Editor after schema_billing.sql and before schema_rls.sql.
-- Until it's run, requests that include a website are still saved, just without it.
alter table projects add column if not exists company_website text;

NOTIFY pgrst, 'reload schema';
