-- Review moderation: staff need read + delete access to keep customer reviews
-- fair and family-friendly. Deletes are recorded through the audit path on the
-- client; the table keeps its public read and owner-insert policies from init.

drop policy if exists reviews_staff_select on public.reviews;
create policy reviews_staff_select on public.reviews
  for select to authenticated
  using (public.is_staff());

drop policy if exists reviews_staff_delete on public.reviews;
create policy reviews_staff_delete on public.reviews
  for delete to authenticated
  using (public.is_staff());

create index if not exists reviews_created_idx on public.reviews (created_at desc);