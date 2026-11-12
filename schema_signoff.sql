-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- Short human-readable project name (AI-drafted at intake, editable)
alter table projects add column if not exists project_title text;

-- Sign-off document: the editable content, plus its lifecycle
alter table projects add column if not exists signoff jsonb;
alter table projects add column if not exists signoff_sent_at timestamptz;
alter table projects add column if not exists signoff_signed_url text;
alter table projects add column if not exists signoff_signed_at timestamptz;

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
