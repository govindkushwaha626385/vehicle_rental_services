-- Public per-day availability for the vehicle detail page ("availability strip").
-- Returns only dates + a coarse reason (booked / block:kind) — never customer
-- or booking identity — so it is safe to expose to anon and authenticated.
-- Quotes already reveal availability per window; this gives the same facts
-- enumerated day-by-day without leaking who is renting.

create or replace function public.vehicle_busy_days(p_vehicle_id uuid, p_from date, p_to date)
returns table (busy_date date, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_vehicle_id is null or p_from is null or p_to is null or p_to < p_from then
    return;
  end if;

  return query
    with recursive span(d) as (
      select p_from::date as d
      union all
      select d + 1 from span where d < p_to::date
    )
    select s.d, 'booked'::text
    from span s
    where exists (
      select 1 from public.bookings b
      where b.vehicle_id = p_vehicle_id
        and b.status in ('pending', 'confirmed', 'active')
        and b.start_date <= s.d
        and b.end_date >= s.d
    )
    union all
    select s.d, 'block:' || coalesce(vb.kind, 'other')::text
    from span s
    join public.vehicle_blocks vb
      on vb.vehicle_id = p_vehicle_id
     and vb.start_date <= s.d
     and vb.end_date >= s.d;
end;
$$;

grant execute on function public.vehicle_busy_days(uuid, date, date) to anon, authenticated;