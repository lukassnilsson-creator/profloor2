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
