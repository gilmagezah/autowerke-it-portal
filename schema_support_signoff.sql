-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- When a project's contract was signed (drives the "New" badge in delivery)
alter table projects add column if not exists signed_at timestamptz;

-- Support tickets now finish with a client sign-off:
--   in_progress -> awaiting_signoff (completion PDF sent) -> completed (client uploaded the signed copy)
-- They reuse the existing signoff_sent_at / signoff_signed_url / signoff_signed_at columns.

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
