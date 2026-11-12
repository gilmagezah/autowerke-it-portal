-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- Screenshots on support/project requests, and support priority.

alter table projects add column if not exists attachments jsonb;     -- [{ url, name, type, size }], max 4
alter table projects add column if not exists priority int;          -- support only: 1 (low) .. 5 (critical)
alter table projects add column if not exists can_work boolean;      -- support only: "can you still work at all?"

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
