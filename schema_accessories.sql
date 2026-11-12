-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- Admin accessories (BUILD-LOG sections 29-30): personal reminders, synced notes and saved notes.
-- Needs schema_secure.sql first (admin_users). Safe to run more than once.
--
-- Both tables are private to the app: Row Level Security is on with NO policies, so the public
-- "anon" key can read and write nothing. The server's service key bypasses RLS as usual.

-- ---------- Reminders: "remind me at 09:00 tomorrow to nudge Tanner" ----------
create table if not exists admin_reminders (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admin_users(id) on delete cascade,  -- whose reminder (only they see it)
  title text not null check (char_length(title) between 1 and 200),
  note text check (note is null or char_length(note) <= 1000),
  ref text check (ref is null or char_length(ref) <= 40),             -- optional ticket / project reference
  due_at timestamptz not null,
  email boolean not null default true,                               -- also email the admin when it's due
  emailed_at timestamptz,                                            -- set once the email has gone
  done_at timestamptz,
  source text check (source is null or char_length(source) <= 120),  -- which suggestion it came from (stops duplicates)
  created_at timestamptz not null default now()
);
create index if not exists admin_reminders_open on admin_reminders (admin_id, done_at, due_at);
create index if not exists admin_reminders_email on admin_reminders (due_at) where done_at is null and email and emailed_at is null;

-- ---------- Notes: each admin's notepad, ENCRYPTED (AES-256-GCM with CREDENTIALS_KEY) ----------
create table if not exists admin_notes (
  admin_id uuid primary key references admin_users(id) on delete cascade,
  pages_enc text not null,                                           -- never plain text
  updated_at timestamptz not null default now()
);

-- ---------- Saved notes: notepad pages you chose to keep ("Save" / "See saved notes") ----------
-- Title and text are both ENCRYPTED (the title is the note's first line, so it can be sensitive too).
create table if not exists admin_saved_notes (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admin_users(id) on delete cascade,  -- whose note (only they see it)
  title_enc text not null,
  body_enc text not null,
  chars integer not null default 0 check (chars between 0 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_saved_notes_admin on admin_saved_notes (admin_id, updated_at desc);

alter table admin_reminders enable row level security;
alter table admin_reminders force row level security;
alter table admin_notes enable row level security;
alter table admin_notes force row level security;
alter table admin_saved_notes enable row level security;
alter table admin_saved_notes force row level security;

NOTIFY pgrst, 'reload schema';
