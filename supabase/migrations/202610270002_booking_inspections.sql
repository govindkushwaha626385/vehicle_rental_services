-- 202610270002_booking_inspections.sql
--
-- Hand-over condition report.
--
-- A rental dispute almost always comes down to "what did the car look like when
-- I took it?" — fuel, odometer, cleanliness and pre-existing damage. The pick-up
-- record is stored on the booking so the return desk can compare it against the
-- drop-off read before settling the deposit.
--
-- pickup_odometer / return_odometer already exist from 202610200004; this adds
-- the structured report and surfaces both readings through the admin list.

alter table public.bookings
  add column if not exists pickup_inspection jsonb;

comment on column public.bookings.pickup_inspection is
  'Condition report captured at hand-over: odometer, fuel, cleanliness, damage areas and note.';

alter table public.bookings
  drop constraint if exists bookings_pickup_inspection_shape;
alter table public.bookings
  add constraint bookings_pickup_inspection_shape
  check (pickup_inspection is null or jsonb_typeof(pickup_inspection) = 'object');

-- Both desks read bookings through admin_bookings(), so merge the inspection in
-- there rather than duplicating the full booking_json serializer. Staff-only:
-- condition notes are internal evidence, not customer-facing copy.
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
      public.booking_json(b.id) || jsonb_build_object(
        'pickupInspection', b.pickup_inspection,
        'pickupOdometer', b.pickup_odometer,
        'returnOdometer', b.return_odometer
      )
      order by b.created_at desc
    ), '[]'::jsonb)
    from public.bookings b
  );
end;
$$;

grant execute on function public.admin_bookings() to authenticated;
