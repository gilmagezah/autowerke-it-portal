-- Run this in Supabase: Project -> SQL Editor -> New Query -> paste -> Run
-- Renewal pricing + a ready-to-send renewal email for each managed domain.

alter table domain_registry add column if not exists renewal_years int not null default 1;         -- renewal period
alter table domain_registry add column if not exists renewal_service_fee numeric;                   -- your fee for handling the renewal
alter table domain_registry add column if not exists renewal_vat_applicable boolean not null default true;
alter table domain_registry add column if not exists renewal_email jsonb;                           -- saved draft: subject, body, prepared_for
alter table domain_registry add column if not exists renewal_email_sent_for date;                   -- renewal date it was sent for
alter table domain_registry add column if not exists renewal_email_sent_at timestamptz;

-- Refresh Supabase's API schema cache so the new columns can be written to straight away
NOTIFY pgrst, 'reload schema';
