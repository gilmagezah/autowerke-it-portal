-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- Support estimates now come back signed before work starts
alter table projects add column if not exists estimate_signed_url text;
alter table projects add column if not exists estimate_signed_at timestamptz;

-- Payment follow-ups
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,  -- optional link to a project/ticket
  project_ref text,                                             -- e.g. TANNER-5422
  company_name text not null,
  contact_name text,
  email text not null,
  amount numeric not null,                                      -- amount due (what the client owes, incl. VAT if charged)
  due_date date,
  notes text,
  status text not null default 'open',                          -- open | paid

  -- Reminders to YOU (the admin) about this payment
  reminder_enabled boolean not null default true,
  reminder_frequency text not null default 'weekly',            -- daily | weekly
  reminder_weekday int not null default 1,                      -- 0=Sun ... 6=Sat (weekly only)
  reminder_time text not null default '08:00',                  -- HH:MM in REMINDER_TIMEZONE
  next_reminder_at timestamptz,
  last_reminded_at timestamptz,

  -- Follow-up emails sent to the client
  followups_sent int not null default 0,
  last_followup_at timestamptz,

  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_follow_ups_due on follow_ups(status, next_reminder_at);

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
