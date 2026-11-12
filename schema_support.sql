-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- Support-specific intake details (null for IT Project requests)
alter table projects add column if not exists users_affected text;
alter table projects add column if not exists attempts_taken text;
alter table projects add column if not exists devices_affected text;

-- Hourly work estimate (support side's equivalent of pricing_estimate)
alter table projects add column if not exists estimated_hours numeric;
alter table projects add column if not exists hourly_rate numeric;

-- Logged work sessions, e.g. [{"id":"...", "date":"2026-09-29", "start":"09:30", "end":"11:00", "note":"..."}]
alter table projects add column if not exists work_log jsonb not null default '[]';

-- Support status flow (parallel to the project one):
-- client_confirmed -> estimate_sent -> in_progress -> completed
--                                    -> declined

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
