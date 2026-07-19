-- Körs manuellt av ägaren i Supabase SQL Editor. Ingen appkod kör detta.

-- product_cache: endast service role får läsa/skriva.
alter table product_cache enable row level security;
-- Ta bort ev. befintliga policies som ger anon/authenticated åtkomst:
-- (lista dem först med: select * from pg_policies where tablename = 'product_cache';)
-- drop policy "<policy-namn>" on product_cache;
-- Inga policies alls = bara service role (som kringgår RLS) kommer åt tabellen.

-- shared_floors: begränsa payload-storlek till 2 MB (spam-/lagringsskydd).
alter table shared_floors
  add constraint shared_floors_data_max_size
  check (pg_column_size(floor_data) < 2097152);

-- Automatisk städning (kräver pg_cron; aktiveras under Database → Extensions i Supabase).
create extension if not exists pg_cron;

-- Delningslänkar äldre än 180 dagar tas bort. OBS: innebär att gamla länkar slutar fungera —
-- medvetet beslut, ändra intervallet vid behov.
select cron.schedule('purge-old-shared-floors', '0 3 * * *',
  $$delete from shared_floors where created_at < now() - interval '180 days'$$);

-- Analytics-events äldre än 365 dagar tas bort.
select cron.schedule('purge-old-app-events', '30 3 * * *',
  $$delete from app_events where created_at < now() - interval '365 days'$$);
