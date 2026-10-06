-- Westridge Ceramics, fourth setup file: lets any dropdown choice be removed, including the
-- built-in ones (Low Fire, Glossy, ...), and lets a removal be undone.
-- A removed choice is kept as a row marked "removed", so Undo can bring it back.
-- Run once in Supabase (SQL Editor → New query → paste → Run). Safe to run again.

alter table public.glaze_options
  add column if not exists removed boolean not null default false;

-- Removing and restoring a choice updates its row
drop policy if exists "glaze options: logged in can update" on public.glaze_options;
create policy "glaze options: logged in can update" on public.glaze_options
  for update to authenticated using (true) with check (true);

-- Built-in choices get a row the first time they're removed, added by whoever removed them
drop policy if exists "glaze options: logged in can add" on public.glaze_options;
create policy "glaze options: logged in can add" on public.glaze_options
  for insert to authenticated with check (true);
