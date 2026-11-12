-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- Adds the Domains and Consultancy services.

-- ---------- Domain requests (stored as requests, request_type = 'Domains') ----------
--   domain_requested -> domain_quoted -> domain_accepted -> domain_registered
--                                     -> declined
alter table projects add column if not exists domain_service text;     -- register | manage
alter table projects add column if not exists domains jsonb;           -- ["example.co.zw", ...]
alter table projects add column if not exists domain_quote jsonb;      -- lines, service fee, VAT, total

-- ---------- Consultancy requests (request_type = 'Consultancy') ----------
--   consult_requested -> consult_answered (advice sent)
--                     -> consult_meeting_invited -> consult_meeting_requested -> consult_meeting_confirmed -> consult_closed
alter table projects add column if not exists consult_draft text;       -- AI draft for you to edit
alter table projects add column if not exists consult_response text;    -- what was actually sent
alter table projects add column if not exists consult_meeting jsonb;    -- client's meeting preferences
alter table projects add column if not exists consult_confirmed jsonb;  -- the slot + link you confirmed

-- ---------- Managed domains registry ----------
create table if not exists domain_registry (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references projects(id) on delete set null,   -- the request it came from (optional)
  client_company text not null,                                 -- the larger client, for grouping/filtering
  client_email text,                                            -- renewal reminders to the client go here
  domain text not null,
  registrar_name text,                                          -- where it's bought/managed, e.g. Porkbun
  registrar_url text,                                           -- login link
  account_username text,
  account_password_enc text,                                    -- ENCRYPTED (AES-256-GCM), never plain text
  vault_reference text,                                         -- or: where it lives in your password manager
  renewal_date date,
  renewal_price numeric,
  admin_reminder_days int not null default 7,                   -- remind you N days before renewal
  client_reminder_enabled boolean not null default true,
  client_reminder_days int not null default 7,                  -- remind the client N days before renewal
  admin_reminded_for date,                                      -- renewal date we've already reminded about
  client_reminded_for date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_domain_registry_renewal on domain_registry(renewal_date);

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
