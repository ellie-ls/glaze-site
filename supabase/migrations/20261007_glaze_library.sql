-- Westridge Ceramics glaze library: run once in Supabase (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to run again: it only adds what's missing.

-- 1. Columns for everything the site shows. The original columns stay:
--    title = glaze name, image_url = photo, user_id = who added it, created_at = when.
alter table public.glazes
  add column if not exists code           text not null default '',
  add column if not exists brand          text not null default '',
  add column if not exists firing_range   text not null default '',
  add column if not exists application    text not null default '',
  add column if not exists finish         text not null default '',
  add column if not exists opacity        text not null default '',
  add column if not exists food_safe      text not null default '',
  add column if not exists fluidity       text not null default '',
  add column if not exists tags           text[] not null default '{}',
  add column if not exists color          text not null default '',  -- painted tile color when there's no photo
  add column if not exists accent         text not null default '',
  add column if not exists speckled       boolean not null default false,
  add column if not exists color_family   text not null default '',  -- for the color filter
  add column if not exists sort_color     text not null default '',  -- average photo color, for rainbow sort
  add column if not exists base_favorites integer not null default 0; -- sample heart counts

-- Sample glazes have no owner and no photo yet (they show a painted tile instead)
alter table public.glazes alter column user_id drop not null;
alter table public.glazes alter column image_url drop not null;
alter table public.glazes alter column notes drop not null;

-- 2. Who can do what. Everyone can browse; logged-in people can add glazes;
--    the sample glazes (no owner) can be edited or deleted by any logged-in person,
--    and glazes people add can only be edited or deleted by whoever added them.
alter table public.glazes enable row level security;

drop policy if exists "glaze library: anyone can read" on public.glazes;
create policy "glaze library: anyone can read" on public.glazes
  for select using (true);

drop policy if exists "glaze library: logged in can add" on public.glazes;
create policy "glaze library: logged in can add" on public.glazes
  for insert to authenticated with check (user_id is null or user_id = auth.uid());

drop policy if exists "glaze library: edit samples or your own" on public.glazes;
create policy "glaze library: edit samples or your own" on public.glazes
  for update to authenticated
  using (user_id is null or user_id = auth.uid())
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "glaze library: delete samples or your own" on public.glazes;
create policy "glaze library: delete samples or your own" on public.glazes
  for delete to authenticated using (user_id is null or user_id = auth.uid());

-- 3. Photos: logged-in people can upload to the glaze-images bucket, and anyone can view them.
drop policy if exists "glaze library: logged in can upload photos" on storage.objects;
create policy "glaze library: logged in can upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'glaze-images');

drop policy if exists "glaze library: anyone can view photos" on storage.objects;
create policy "glaze library: anyone can view photos" on storage.objects
  for select using (bucket_id = 'glaze-images');

-- 4. The 21 sample glazes. Each is only added if no glaze with that code exists yet, so this
--    never makes duplicates. (Running the file again does re-add any sample you've deleted.)
insert into public.glazes
  (title, code, brand, firing_range, application, finish, opacity, food_safe, fluidity,
   tags, color, accent, speckled, color_family, base_favorites, created_at)
select v.* from (values
  ('Coyote Cobalt Blue', 'MBG008', 'Coyote', 'Midfire, Cone 5-6', 'Brush On', 'Glossy', 'Opaque', 'Yes, AP non-toxic', 'Stable, does not run', array['Smooth', 'Blue', 'Coyote', 'Cobalt']::text[], '#1d2257', '#7e86c4', false, 'blue', 28, '2026-09-28T12:00:00Z'::timestamptz),
  ('Shino Gold', 'MBG045', 'Coyote', 'Midfire, Cone 5-6', 'Brush On', 'Satin', 'Opaque', 'Yes, AP non-toxic', 'Stable, does not run', array['Shino', 'Warm']::text[], '#c9853f', '#f0d3a2', false, 'orange', 41, '2026-08-14T12:00:00Z'::timestamptz),
  ('Blue Rutile', 'PC-20', 'Amaco', 'Midfire, Cone 5-6', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Fluid, may run', array['Variegated', 'Speckled', 'Blue']::text[], '#3b5a78', '#c9b892', false, 'blue', 63, '2026-07-02T12:00:00Z'::timestamptz),
  ('Seaweed', 'PC-25', 'Amaco', 'Midfire, Cone 5-6', 'Brush On', 'Glossy', 'Translucent', 'Yes, dinnerware safe', 'Fluid, may run', array['Green', 'Breaking']::text[], '#3c5a3a', '#a7b46f', false, 'green', 37, '2026-09-05T12:00:00Z'::timestamptz),
  ('Sapphire', 'SW-123', 'Mayco', 'Midfire, Cone 6', 'Brush On', 'Glossy', 'Semi-transparent', 'Yes, dinnerware safe', 'Stable, does not run', array['Blue', 'Mirror']::text[], '#22346e', '#6a5d9e', false, 'blue', 22, '2026-09-19T12:00:00Z'::timestamptz),
  ('Alabaster Satin', 'MBG074', 'Coyote', 'Midfire, Cone 5-6', 'Dip', 'Satin', 'Opaque', 'Yes, AP non-toxic', 'Stable, does not run', array['White', 'Smooth']::text[], '#ece6d8', '#c8bea6', false, 'white', 19, '2026-06-21T12:00:00Z'::timestamptz),
  ('Firebrick Red', 'SW-158', 'Mayco', 'Midfire, Cone 6', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Stable, does not run', array['Red', 'Warm']::text[], '#8f2a20', '#d06a3a', false, 'red', 30, '2026-08-30T12:00:00Z'::timestamptz),
  ('Honey Flux', 'PC-1', 'Amaco', 'Midfire, Cone 5-6', 'Brush On', 'Glossy', 'Translucent', 'Yes, dinnerware safe', 'Very fluid', array['Yellow', 'Runny']::text[], '#c49a2c', '#f2d66b', false, 'yellow', 12, '2026-05-11T12:00:00Z'::timestamptz),
  ('Lavender Mist', 'MBG118', 'Coyote', 'Midfire, Cone 5-6', 'Brush On', 'Matte', 'Opaque', 'Yes, AP non-toxic', 'Stable, does not run', array['Purple', 'Soft']::text[], '#8c7aa8', '#d4c7e3', false, 'purple', 17, '2026-09-25T12:00:00Z'::timestamptz),
  ('Speckled Oatmeal', 'SW-401', 'Mayco', 'Midfire, Cone 6', 'Dip', 'Matte', 'Opaque', 'Yes, dinnerware safe', 'Stable, does not run', array['Speckled', 'Neutral']::text[], '#d9c7a3', '#8a6b45', true, 'beige', 52, '2026-09-30T12:00:00Z'::timestamptz),
  ('Turquoise Matt', 'MBG027', 'Coyote', 'Midfire, Cone 5-6', 'Brush On', 'Matte', 'Opaque', 'Yes, AP non-toxic', 'Stable, does not run', array['Teal', 'Textured']::text[], '#3b9b9a', '#9fd4c9', false, 'teal', 33, '2026-07-17T12:00:00Z'::timestamptz),
  ('Obsidian', 'SW-102', 'Mayco', 'Midfire, Cone 6', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Stable, does not run', array['Black', 'Smooth']::text[], '#141414', '#4a4038', false, 'black', 26, '2026-04-03T12:00:00Z'::timestamptz),
  ('Rose Quartz', 'MBG132', 'Coyote', 'Midfire, Cone 5-6', 'Brush On', 'Satin', 'Translucent', 'Yes, AP non-toxic', 'Stable, does not run', array['Pink', 'Soft']::text[], '#d9a3a6', '#f3d7d2', false, 'pink', 44, '2026-09-12T12:00:00Z'::timestamptz),
  ('Iron Lustre', 'PC-23', 'Amaco', 'Midfire, Cone 5-6', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Fluid, may run', array['Brown', 'Breaking']::text[], '#4e3020', '#b07a42', false, 'brown', 21, '2026-06-08T12:00:00Z'::timestamptz),
  ('Galaxy Speckle', 'SW-506', 'Mayco', 'Midfire, Cone 6', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Stable, does not run', array['Speckled', 'Multicolor']::text[], '#33264f', '#d97d55', true, 'multi', 15, '2026-10-01T12:00:00Z'::timestamptz),
  ('Ash Grey', 'MBG071', 'Coyote', 'Midfire, Cone 5-6', 'Dip', 'Matte', 'Opaque', 'Yes, AP non-toxic', 'Stable, does not run', array['Grey', 'Textured']::text[], '#8f8c86', '#c9c5bc', false, 'grey', 9, '2026-03-22T12:00:00Z'::timestamptz),
  ('Tangerine', 'LG-61', 'Amaco', 'Lowfire, Cone 05', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Stable, does not run', array['Orange', 'Bright']::text[], '#e2732e', '#f6b267', false, 'orange', 11, '2026-08-02T12:00:00Z'::timestamptz),
  ('Celadon', 'C-21', 'Amaco', 'Midfire, Cone 4-6', 'Dip', 'Glossy', 'Transparent', 'Yes, dinnerware safe', 'Stable, does not run', array['Green', 'Celadon', 'Smooth']::text[], '#9dbba0', '#d6e3cf', false, 'green', 48, '2026-09-08T12:00:00Z'::timestamptz),
  ('Butter Yellow', 'SC-75', 'Mayco', 'Lowfire, Cone 06', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Stable, does not run', array['Yellow', 'Smooth']::text[], '#efd77e', '#fbecb4', false, 'yellow', 7, '2026-02-15T12:00:00Z'::timestamptz),
  ('Plum Crawl', 'MBG066', 'Coyote', 'Midfire, Cone 5-6', 'Brush On', 'Matte', 'Opaque', 'No, decorative only', 'Stable, does not run', array['Purple', 'Textured', 'Crawl']::text[], '#5a2c4c', '#c9a6b8', false, 'purple', 24, '2026-07-29T12:00:00Z'::timestamptz),
  ('Chun Plum', 'PC-58', 'Amaco', 'Midfire, Cone 5-6', 'Brush On', 'Glossy', 'Opaque', 'Yes, dinnerware safe', 'Fluid, may run', array['Red', 'Variegated']::text[], '#6e2033', '#9fb0d6', false, 'red', 35, '2026-09-02T12:00:00Z'::timestamptz)
) as v(title, code, brand, firing_range, application, finish, opacity, food_safe, fluidity,
       tags, color, accent, speckled, color_family, base_favorites, created_at)
where not exists (select 1 from public.glazes g where g.code = v.code);
