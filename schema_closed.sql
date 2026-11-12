-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- When the project was officially closed (normally: when the client uploaded
-- the signed sign-off). Status flow for IT projects is now:
--   signed (in delivery) -> closed
-- ("delivered" is kept only for projects marked delivered before this change;
--  they still accept the signed upload, which then closes them.)
alter table projects add column if not exists closed_at timestamptz;

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
