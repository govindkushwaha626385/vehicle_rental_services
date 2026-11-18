-- 202610270005_booking_km_snapshot.sql
--
-- Freeze the kilometre terms a customer booked under.
--
-- 202610270003 gave bookings optional km_cap / km_extra_rate snapshot columns,
-- but nothing wrote them, so every read fell back to the vehicle's *current*
-- terms. Changing a bike from 250 km/day to 150 km/day would quietly rewrite
-- the allowance on trips that were already sold (and already in a voucher).
-- A BEFORE INSERT trigger snapshots the terms once; later edits to the vehicle
-- or to the booking's dates never move them.

alter table public.bookings
  add column if not exists km_cap integer,
  add column if not exists km_extra_rate integer not null default 0;

create or replace function public.snapshot_booking_km_terms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vehicle_id is not null then
    select coalesce(v.km_cap, 0), coalesce(v.km_extra_rate, 0)
      into new.km_cap, new.km_extra_rate
      from public.vehicles v
     where v.id = new.vehicle_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_km_snapshot on public.bookings;
create trigger bookings_km_snapshot before insert on public.bookings
  for each row execute function public.snapshot_booking_km_terms();
