-- Westridge Ceramics, fifth setup file: only @westridge.org accounts can add glazes.
-- The site already hides "Upload Glaze" for other accounts; this makes the database refuse them too.
-- Run once in Supabase (SQL Editor → New query → paste → Run). Safe to run again.
--
-- These are "restrictive" rules: they apply on top of every other rule on the table,
-- so no older "anyone logged in can add" rule can let other accounts through.

drop policy if exists "glaze library: only westridge accounts add glazes" on public.glazes;
create policy "glaze library: only westridge accounts add glazes" on public.glazes
  as restrictive
  for insert to authenticated
  with check (lower(auth.jwt() ->> 'email') like '%@westridge.org');

-- Glaze photos: same rule, for the glaze-images bucket only (other buckets are left alone)
drop policy if exists "glaze library: only westridge accounts add photos" on storage.objects;
create policy "glaze library: only westridge accounts add photos" on storage.objects
  as restrictive
  for insert to authenticated
  with check (bucket_id <> 'glaze-images' or lower(auth.jwt() ->> 'email') like '%@westridge.org');
