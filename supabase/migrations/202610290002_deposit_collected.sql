-- 202610290002_deposit_collected.sql
--
-- Recorded security-deposit collection.
--
-- The pick-up desk previously acknowledged the deposit with a checklist tick,
-- but nothing recorded *when, how or by whom* the money was taken, so finance
-- could not trace the float ("the desk says collected — where is the ₹5,000?").
-- Collection is now a staff action at pick-up: amount, method and reference
-- are stored on the booking and surfaced through the same booking_json
-- serializer the desks, voucher, account and analytics already read, so every
-- surface sees one consistent record without a second lookup.

alter table public.bookings
  add column if not exists deposit_collected jsonb;

comment on column public.bookings.deposit_collected is
  'Staff record of the security deposit taken at pick-up: {"amount","method","reference","at","byName"}. Null until collected.';

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