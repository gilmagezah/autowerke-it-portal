-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- Secure admin login, online sign-off, and the admin workspace.
-- Nothing secret is stored readable: codes and session tokens are hashed,
-- passwords are scrypt-hashed, workspace secrets are AES-256-GCM encrypted.

-- ---------- Admin accounts + sessions ----------
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'admin',            -- owner | admin
  password_hash text not null,                   -- scrypt
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,               -- the cookie value is never stored, only its hash
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  revoked_at timestamptz
);

-- One-time codes for admin login and client sign-off
create table if not exists auth_codes (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,                         -- admin_login | signoff
  subject_id uuid not null,                      -- admin_users.id or projects.id
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  ip text
);
create index if not exists idx_auth_codes_subject on auth_codes(purpose, subject_id, created_at desc);

-- ---------- Online sign-off ----------
create table if not exists signoff_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  ip text,
  user_agent text
);
alter table projects add column if not exists esign jsonb;             -- e-signature audit record

-- ---------- Admin workspace ----------
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,                      -- the ticket / project reference
  request_id uuid references projects(id) on delete set null,
  title text,
  environment text,                              -- e.g. "Tenant: tanner.onmicrosoft.com"
  notes text,                                    -- the notes canvas
  owner_id uuid not null references admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null,                            -- login | access | email | contact | checklist | change | scope | waiting | network | licence | meeting | document
  title text,
  data jsonb not null default '{}',
  secret_enc text,                               -- encrypted secret fields (e.g. passwords)
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workspace_items on workspace_items(workspace_id, kind);

create table if not exists workspace_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  admin_id uuid not null references admin_users(id) on delete cascade,
  sections text[],                               -- null = the whole workspace
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, admin_id)
);

create table if not exists workspace_time (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  admin_id uuid not null references admin_users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Refresh Supabase's API schema cache so the new tables can be written to straight away
NOTIFY pgrst, 'reload schema';
