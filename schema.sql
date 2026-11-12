-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  project_id text unique not null,
  confirm_token uuid unique not null default gen_random_uuid(),
  status text not null default 'pending_review',
  -- pending_review -> reviewed -> client_confirmed
  --                            -> changes_requested

  request_type text not null,
  name text not null,
  surname text,
  company_name text not null,
  position text,
  email text not null,
  phone text,
  details text not null,

  ai_requirements jsonb,
  ai_scope_summary text,

  reviewed_requirements jsonb,
  reviewed_scope_summary text,

  change_request text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_status on projects(status);
create index if not exists idx_projects_project_id on projects(project_id);

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
