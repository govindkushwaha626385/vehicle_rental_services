-- 202610290003_driver_license_expiry.sql
--
-- Licence expiry for the driver.
--
-- Rentals in India require a licence that stays valid for the whole trip —
-- an expiry inside the rental makes the second half illegal to drive. The
-- customer can enter the expiry at checkout (optional, encouraged); the
-- handover desk then flags an expiry that lands inside the rental. This just
-- stores the date and surfaces it through the same booking_json serializer
-- the voucher, account, desk and admin reads use, merged over the base driver
-- object exactly like the vehicle override.

alter table public.bookings
  add column if not exists driver_license_expiry date;

comment on column public.bookings.driver_license_expiry is
  'Driving licence expiry for the rental driver. Null when the customer did not enter it; used by the desk to refuse an expiry inside the rental.';

create or replace function public.booking_json(p_booking_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with base as (
    select public.booking_json_base(p_booking_id) as doc
  )
  select base.doc || jsonb_build_object(
    'completedAt', (select b.completed_at from public.bookings b where b.id = p_booking_id),
    'taxable', (select b.taxable_amount from public.bookings b where b.id = p_booking_id),
    'untaxedTotal', (select b.untaxed_total from public.bookings b where b.id = p_booking_id),
    'creditDue', greatest(0,
      coalesce((select b.amount_paid from public.bookings b where b.id = p_booking_id), 0)
      - coalesce((select b.total from public.bookings b where b.id = p_booking_id), 0)
    ),
    -- Demo bookings expose a top-level vehicle id; mirror it here so admin
    -- links, change-request previews and exports do not need to guess where
    -- the id lives.
    'vehicleId', (select b.vehicle_id from public.bookings b where b.id = p_booking_id),
    -- The base serializer only checks status + review count. Reviews can be
    -- switched off in Settings, and the demo hides the review action then;
    -- mirror that so the button cannot open a form the server will reject.
    'canReview', (
      select b.status = 'completed'
        and b.user_id is not null
        and not exists (select 1 from public.reviews r where r.booking_id = b.id)
        and coalesce((select s.value from public.settings s where s.key = 'reviews_enabled'), 'true') <> 'false'
      from public.bookings b where b.id = p_booking_id
    ),
    -- Kilometre terms are customer promises, not internal notes: expose them
    -- at both levels so the voucher and the fleet/desk screens read the same
    -- numbers without a second lookup.
    'kmCap', coalesce((
      select coalesce(b.km_cap, v.km_cap, 0)
      from public.bookings b
      left join public.vehicles v on v.id = b.vehicle_id
      where b.id = p_booking_id
    ), 0),
    'kmExtraRate', coalesce((
      select coalesce(nullif(b.km_extra_rate, 0), v.km_extra_rate, 0)
      from public.bookings b
      left join public.vehicles v on v.id = b.vehicle_id
      where b.id = p_booking_id
    ), 0),
    -- The desk checklist needs the vehicle kind and its own minimum age to
    -- match the checkout validator. The base serializer only exposes the
    -- display fields, so merge them into the vehicle object here.
    'vehicle', (base.doc -> 'vehicle') || coalesce((
      select jsonb_build_object(
        'kind', v.kind,
        'minAge', v.min_age,
        'registrationNumber', v.registration_number,
        'insuranceExpiry', v.insurance_expiry,
        'pucExpiry', v.puc_expiry,
        'kmCap', coalesce(b.km_cap, v.km_cap, 0),
        'kmExtraRate', coalesce(nullif(b.km_extra_rate, 0), v.km_extra_rate, 0)
      )
      from public.bookings b
      join public.vehicles v on v.id = b.vehicle_id
      where b.id = p_booking_id
    ), '{}'::jsonb),
    -- The driver record carries the licence expiry the desk validates against
    -- the rental end; merge it over the base driver object so every surface
    -- reads one driver shape.
    'driver', (base.doc -> 'driver') || coalesce((
      select jsonb_build_object('licenseExpiry', b.driver_license_expiry)
      from public.bookings b where b.id = p_booking_id
    ), '{}'::jsonb),
    'changeRequest', (select b.change_request from public.bookings b where b.id = p_booking_id),
    'tripChanges', (select coalesce(b.trip_changes, '[]'::jsonb) from public.bookings b where b.id = p_booking_id),
    'deskChecks', (select coalesce(b.desk_checks, '{}'::jsonb) from public.bookings b where b.id = p_booking_id),
    'returnChecks', (select coalesce(b.return_checks, '{}'::jsonb) from public.bookings b where b.id = p_booking_id),
    'inspection', (select b.inspection from public.bookings b where b.id = p_booking_id),
    'pickupInspection', (select b.pickup_inspection from public.bookings b where b.id = p_booking_id),
    'depositSettlement', (select b.deposit_settlement from public.bookings b where b.id = p_booking_id),
    'depositCollected', (select b.deposit_collected from public.bookings b where b.id = p_booking_id)
  )
  from base;
$$;

-- booking_json stays internal: customers reach it through the checked
-- get_booking()/my_bookings() RPCs, never directly.
revoke all on function public.booking_json(uuid) from public, anon, authenticated;