-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- (Run schema.sql first if you haven't already - this just adds to it)

alter table projects add column if not exists pricing_estimate text;
alter table projects add column if not exists signed_contract_url text;

-- Status now also flows through:
-- client_confirmed -> pricing_sent -> proceeding -> signed
--                                   -> declined

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
