-- Public replies to customer reviews.
--
-- A reply is written by staff, shown under the review on the vehicle page and
-- kept with the review even if the reviewer's account is later removed. The
-- reply is capped so a pasted essay cannot break the layout, and staff get an
-- update policy limited to reviews (never customer bookings).

alter table public.reviews
  add column if not exists reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists replied_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reviews_reply_length'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_reply_length
      check (reply is null or char_length(reply) <= 1200);
  end if;
end $$;

drop policy if exists reviews_staff_update on public.reviews;
create policy reviews_staff_update on public.reviews
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create index if not exists reviews_replied_idx on public.reviews (replied_at desc nulls last);
