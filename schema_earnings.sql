-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

-- Structured money for earnings analytics. Amounts are stored EXCLUDING VAT;
-- VAT is added on top where vat_applicable is true.
alter table projects add column if not exists contract_value numeric;           -- IT projects (excl. VAT)
alter table projects add column if not exists vat_applicable boolean not null default true;

-- When a support ticket was completed (its earnings date)
alter table projects add column if not exists completed_at timestamptz;

-- Support -> project conversions
alter table projects add column if not exists converted_from_support_at timestamptz;
alter table projects add column if not exists conversion_reason text;

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
