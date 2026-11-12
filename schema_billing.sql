-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- Invoices, receipts, app settings (your pre-applied signature), consultancy fees,
-- and consent records. Run BEFORE schema_rls.sql.

-- Requests: consultancy fee (0 = free) + when/which version of the terms they agreed to
alter table projects add column if not exists consult_fee numeric;
alter table projects add column if not exists consent_at timestamptz;
alter table projects add column if not exists consent_version text;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,                   -- AW-INV-2026-0001
  request_id uuid references projects(id) on delete set null,
  ref text,                                      -- the request reference, e.g. TANNER-5422
  company text not null,
  contact_name text,
  email text not null,
  lines jsonb not null,                          -- [{ description, qty, unit_price }]
  subtotal numeric not null,
  vat_rate numeric not null default 0,
  vat numeric not null default 0,
  total numeric not null,
  currency text not null default 'USD',
  issued_at timestamptz not null default now(),
  due_date date,
  status text not null default 'issued',         -- issued | paid | void
  paid_at timestamptz,
  notes text,
  pdf_url text,
  follow_up_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_request on invoices(request_id);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,                   -- AW-RCT-2026-0001 (or the external number if uploaded)
  invoice_id uuid references invoices(id) on delete set null,
  request_id uuid references projects(id) on delete set null,
  ref text,
  company text,
  email text,
  amount numeric not null,
  method text,                                   -- Bank transfer | EcoCash | Cash | Card | Other
  reference text,                                -- e.g. the bank or EcoCash transaction reference
  received_on date not null,
  source text not null default 'generated',      -- generated | uploaded
  external_number text,                          -- a receipt issued by another system
  file_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_receipts_invoice on receipts(invoice_id);

create table if not exists app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

NOTIFY pgrst, 'reload schema';
