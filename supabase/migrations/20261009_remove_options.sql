-- Westridge Ceramics, third setup file: lets logged-in people remove dropdown choices
-- that were added from the upload form (e.g. "Cone 3"). The site asks for the studio
-- password first. Run once in Supabase (SQL Editor → New query → paste → Run).

drop policy if exists "glaze options: logged in can remove" on public.glaze_options;
create policy "glaze options: logged in can remove" on public.glaze_options
  for delete to authenticated using (true);
