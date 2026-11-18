-- 202610270003_km_allowance.sql
--
-- Kilometre allowance & excess-distance billing.
--
-- Self-drive rentals usually include a daily distance allowance and charge for
-- the difference at drop-off. 202610200004 added the forward-looking columns
-- (vehicles.km_cap, bookings.km_cap/km_extra_rate, pickup/return odometers) but
-- nothing wrote or read them. This migration makes the terms first-class:
--
--   vehicles.km_cap        included km per rental day (0/NULL = unlimited)
--   vehicles.km_extra_rate ₹ per km beyond the allowance
--   bookings.*             an optional snapshot; when absent the vehicle's
--                          current terms are used, which is also what the demo
--                          adapter does
--
-- The return desk computes the fee from the two odometer readings captured by
-- the hand-over report, so no operator has to type a distance.

alter table public.vehicles
  add column if not exists km_cap integer,
  add column if not exists km_extra_rate integer not null default 0;

comment on column public.vehicles.km_cap is
  'Included kilometres per rental day. 0 or NULL means unlimited.';
comment on column public.vehicles.km_extra_rate is
  'Rupees per kilometre beyond the included allowance. Only billed when km_cap > 0.';

-- Additive, idempotent copies keep this migration runnable on its own even if
-- the inspection migration has not run yet (the function below needs them).
alter table public.bookings
  add column if not exists km_cap integer,
  add column if not exists km_extra_rate integer not null default 0,
  add column if not exists pickup_inspection jsonb,
  add column if not exists pickup_odometer integer,
  add column if not exists return_odometer integer;

-- Range guards mirror the JS validator (src/lib/km.js). NOT VALID avoids
-- failing the migration on any historical row; new writes are checked.
alter table public.vehicles drop constraint if exists vehicles_km_cap_range;
alter table public.vehicles
  add constraint vehicles_km_cap_range
  check (km_cap is null or (km_cap >= 0 and km_cap <= 2000)) not valid;

alter table public.vehicles drop constraint if exists vehicles_km_extra_rate_range;
alter table public.vehicles
  add constraint vehicles_km_extra_rate_range
  check (km_extra_rate >= 0 and km_extra_rate <= 500) not valid;

-- The admin booking serializer is the single read path for both desks, so the
-- effective terms are merged there. A non-zero booking snapshot wins; zero is
-- treated as "not recorded" and falls back to the vehicle.
create or replace function public.admin_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff access required.';
  end if;
  return (
    select coalesce(jsonb_agg(
      j.doc || jsonb_build_object(
        'pickupInspection', b.pickup_inspection,
        'pickupOdometer', b.pickup_odometer,
        'returnOdometer', b.return_odometer,
        'kmCap', coalesce(b.km_cap, v.km_cap, 0),
        'kmExtraRate', coalesce(nullif(b.km_extra_rate, 0), v.km_extra_rate, 0),
        'vehicle', coalesce(j.doc -> 'vehicle', '{}'::jsonb) || jsonb_build_object(
          'kmCap', coalesce(b.km_cap, v.km_cap, 0),
          'kmExtraRate', coalesce(nullif(b.km_extra_rate, 0), v.km_extra_rate, 0)
        )
      )
      order by b.created_at desc
    ), '[]'::jsonb)
    from public.bookings b
    left join public.vehicles v on v.id = b.vehicle_id
    cross join lateral (select public.booking_json(b.id) as doc) j
  );
end;
$$;

grant execute on function public.admin_bookings() to authenticated;
