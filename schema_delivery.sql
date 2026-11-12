-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- Internal delivery phases for signed IT projects, e.g.
-- [{"id":"...","title":"Kickoff & Discovery","instructions":"...","notes":"...",
--   "done":true,"completed_date":"2026-09-30","planned_start":null,"planned_end":null}]
alter table projects add column if not exists phases jsonb not null default '[]';

-- When the client was last emailed a progress update
alter table projects add column if not exists last_progress_update_at timestamptz;

-- IT Project status flow now continues past signing:
-- signed (in delivery) -> delivered

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
