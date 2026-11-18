-- 202610220013_calculation_fixes.sql
-- Calculation-correctness pass:
--
-- 0. Fleet compliance columns referenced later by the booking serializer must
--    exist before this migration's wrapper compiles (idempotent — mirrored by
--    202610270001 for live DBs that already ran 013).
alter table public.vehicles
  add column if not exists registration_number text not null default '',
  add column if not exists insurance_expiry date,
  add column if not exists puc_expiry date;
--
-- 1. `quote_rental_core` used to drop any component the admin excluded from the
--    tax base out of the total entirely (an untaxed extra became free). The
--    engine now keeps a taxed bucket and an untaxed bucket: untaxed components
--    are still charged, they simply attract no tax. Both inclusive and
--    exclusive modes stay correct, and `untaxedTotal` is exposed for the UI.
-- 2. The deposit percentage is clamped to 1–100 like the client engine, so a
--    malformed settings row can never create a >100% deposit.
-- 3. Bookings get a `completed_at` timestamp. Late fees for a completed but
--    unsettled return must use the real drop-off time, not the scheduled
--    `end_date`; demo already stored this, Supabase did not.
-- 4. `vehicle_busy_days` now matches the quote/calendar convention: a booking
--    ending on date D is free again on D (half-open window), so the vehicle
--    page's "next free day" is never one day late.

-- ---------------------------------------------------------------------------
-- 1. Completed timestamp + taxable split
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists completed_at timestamptz;

comment on column public.bookings.completed_at
  is 'When the trip was actually closed. Late fees for completed-unsettled returns are measured from here, not the scheduled end date.';

-- The invoice register must know the real taxable value. Deriving it as
-- `total - tax` breaks as soon as an untaxed component exists (the untaxed
-- money would be reported as taxable). Backfill once, only when the columns are
-- first created, so re-applying the migration never rewrites live bookings.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'taxable_amount'
  ) then
    alter table public.bookings
      add column taxable_amount integer not null default 0,
      add column untaxed_total integer not null default 0;
    -- Every pre-existing booking was priced before untaxed components were
    -- charged, so `total - fees` is exactly its taxable value.
    update public.bookings
       set taxable_amount = greatest(0, total - fees),
           untaxed_total = 0
     where total > 0;
  end if;
end $$;

comment on column public.bookings.taxable_amount
  is 'Net taxable value (exclusive of tax) snapshotted from the quote.';
comment on column public.bookings.untaxed_total
  is 'Charged components the admin excluded from the tax base.';

-- A trigger is the only reliable place: admin completion, desk settlement and
-- any future server path all go through this row update.
create or replace function public.set_booking_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed' or new.completed_at is null) then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_completed_at on public.bookings;
create trigger bookings_completed_at before update on public.bookings
  for each row execute function public.set_booking_completed_at();

-- ---------------------------------------------------------------------------
-- 2. Serializer exposes completedAt (demo/Supabase shape parity)
-- ---------------------------------------------------------------------------
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
    -- The desk checklist needs the vehicle kind and its own minimum age to
    -- match the checkout validator. The base serializer only exposes the
    -- display fields, so merge them into the vehicle object here.
    'vehicle', (base.doc -> 'vehicle') || coalesce((
      select jsonb_build_object(
        'kind', v.kind,
        'minAge', v.min_age,
        'registrationNumber', v.registration_number,
        'insuranceExpiry', v.insurance_expiry,
        'pucExpiry', v.puc_expiry
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
    'depositSettlement', (select b.deposit_settlement from public.bookings b where b.id = p_booking_id)
  )
  from base;
$$;

revoke all on function public.booking_json(uuid) from public, anon, authenticated;

-- Keep the customer lookup failure identical to the demo adapter. The old
-- message ("those details") is a different string live users would see for the
-- same miss, and the checkpoint contract is one uniform message.
create or replace function public.get_booking(p_code text, p_email text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select b.id into v_id
  from public.bookings b
  left join public.profiles p on p.id = b.user_id
  where b.code = upper(trim(p_code))
    and (
      (auth.uid() is not null and (b.user_id = auth.uid() or public.is_staff()))
      or (p_email is not null and lower(coalesce(p.email, b.guest_email)) = lower(trim(p_email)))
    )
  limit 1;

  if v_id is null then
    raise exception 'We could not find a booking with that code and email.';
  end if;

  return public.booking_json(v_id);
end;
$$;

revoke all on function public.get_booking(text, text) from public, anon, authenticated;
grant execute on function public.get_booking(text, text) to anon, authenticated;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.admin_bookings() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Corrected quote engine (taxed + untaxed buckets)
-- ---------------------------------------------------------------------------
create or replace function public.quote_rental_core(
  p_vehicle_id uuid,
  p_start_date date,
  p_end_date date,
  p_extras text[] default '{}',
  p_insurance text default 'basic',
  p_promo_code text default null,
  p_pickup_location text default null,
  p_dropoff_location text default null,
  p_payment_plan text default 'full',
  p_exclude_booking_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_days integer;
  v_min_days integer;
  v_max_days integer;
  v_max_advance integer;
  v_tax numeric;
  v_tax_label text;
  v_tax_inclusive boolean;
  v_tax_extras boolean;
  v_tax_insurance boolean;
  v_tax_one_way boolean;
  v_deposit_pct numeric;
  v_weekend_mult numeric;
  v_seasonal_mult numeric;
  v_seasonal_start date;
  v_seasonal_end date;
  v_one_way_fee integer;
  v_base integer := 0;
  v_extras_total integer := 0;
  v_insurance_total integer := 0;
  v_insurance public.insurance_tiers%rowtype;
  v_one_way integer := 0;
  v_discount integer := 0;
  v_promo public.promos%rowtype;
  v_has_promo boolean := false;
  v_tax_base integer;
  v_untaxed_total integer := 0;
  v_taxable integer;
  v_fees integer;
  v_total integer;
  v_deposit integer;
  v_amount_due integer;
  v_conflict boolean;
  v_weekend boolean;
  v_seasonal boolean;
  v_mult numeric;
  v_extras_json jsonb;
  i integer;
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'Vehicle not found.';
  end if;
  if v_vehicle.status = 'maintenance' then
    raise exception 'This vehicle is currently in service.';
  end if;
  if v_vehicle.kind = 'bike' and coalesce((select value from public.settings where key = 'bikes_enabled'), 'true') = 'false' then
    raise exception 'Two-wheelers are temporarily unavailable.';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Please choose pick-up and drop-off dates.';
  end if;
  if p_start_date < current_date then
    raise exception 'Pick-up date cannot be in the past.';
  end if;

  v_days := p_end_date - p_start_date;
  select coalesce((select value::integer from public.settings where key = 'min_rental_days'), 1) into v_min_days;
  select coalesce((select value::integer from public.settings where key = 'max_rental_days'), 45) into v_max_days;
  select coalesce((select value::integer from public.settings where key = 'max_advance_days'), 365) into v_max_advance;
  if v_days < v_min_days then
    raise exception 'The minimum rental is % days.', v_min_days;
  end if;
  if v_days > v_max_days then
    raise exception 'Rentals are limited to % days.', v_max_days;
  end if;
  if p_start_date > current_date + v_max_advance then
    raise exception 'Bookings can be made up to % days in advance.', v_max_advance;
  end if;

  v_tax := greatest(0, coalesce((select value::numeric from public.settings where key = 'tax_rate'), 18));
  v_tax_label := coalesce((select value from public.settings where key = 'tax_label'), 'GST');
  v_tax_inclusive := coalesce((select value from public.settings where key = 'tax_inclusive'), 'false') = 'true';
  v_tax_extras := coalesce((select value from public.settings where key = 'tax_on_extras'), 'true') <> 'false';
  v_tax_insurance := coalesce((select value from public.settings where key = 'tax_on_insurance'), 'true') <> 'false';
  v_tax_one_way := coalesce((select value from public.settings where key = 'tax_on_one_way'), 'true') <> 'false';
  v_deposit_pct := greatest(1, least(100, coalesce((select value::numeric from public.settings where key = 'deposit_percent'), 25)));
  v_weekend_mult := coalesce((select value::numeric from public.settings where key = 'weekend_multiplier'), 1);
  v_seasonal_mult := coalesce((select value::numeric from public.settings where key = 'seasonal_multiplier'), 1);
  v_one_way_fee := coalesce((select value::integer from public.settings where key = 'one_way_fee'), 0);
  v_seasonal_start := (select value::date from public.settings where key = 'seasonal_start');
  v_seasonal_end := (select value::date from public.settings where key = 'seasonal_end');

  for i in 0..(v_days - 1) loop
    v_weekend := extract(isodow from (p_start_date + i)) in (5, 6, 7);
    v_seasonal := v_seasonal_start is not null and v_seasonal_end is not null
      and (p_start_date + i) between v_seasonal_start and v_seasonal_end;
    v_mult := greatest(
      case when v_weekend then v_weekend_mult else 1 end,
      case when v_seasonal then v_seasonal_mult else 1 end
    );
    v_base := v_base + round(v_vehicle.price_per_day * v_mult)::integer;
  end loop;

  -- Extras are priced per rental day, matching the catalogue copy and the
  -- client-side calculator used in demo mode.
  select coalesce(sum(price_per_day), 0)::integer * v_days into v_extras_total
  from public.extras
  where key = any(coalesce(p_extras, '{}'::text[])) and active = true;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', key, 'label', label, 'pricePerDay', price_per_day
         ) order by id), '[]'::jsonb)
    into v_extras_json
  from public.extras
  where key = any(coalesce(p_extras, '{}'::text[])) and active = true;

  select * into v_insurance from public.insurance_tiers where key = p_insurance and active = true;
  if not found then
    select * into v_insurance from public.insurance_tiers
    where active = true
    order by case key when 'basic' then 0 when 'standard' then 1 when 'full' then 2 else 3 end
    limit 1;
  end if;
  if v_insurance.key is null then
    v_insurance.key := 'basic';
    v_insurance.label := 'Basic';
    v_insurance.price_per_day := 0;
    v_insurance.deductible := 75000;
  end if;
  v_insurance_total := v_insurance.price_per_day * v_days;

  if coalesce(p_pickup_location, '') <> '' and coalesce(p_dropoff_location, '') <> ''
     and p_pickup_location <> p_dropoff_location then
    v_one_way := v_one_way_fee;
  end if;

  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select * into v_promo from public.promos where code = upper(trim(p_promo_code));
    if not found then
      raise exception 'That promo code does not exist.';
    end if;
    if not v_promo.active then
      raise exception 'This promo code is no longer active.';
    end if;
    if v_promo.expires_at is not null and v_promo.expires_at < current_date then
      raise exception 'This promo code has expired.';
    end if;
    if v_promo.usage_limit > 0 and v_promo.used_count >= v_promo.usage_limit then
      raise exception 'This promo code has reached its usage limit.';
    end if;
    if v_days < v_promo.min_days then
      raise exception 'This code requires a rental of at least % days.', v_promo.min_days;
    end if;
    v_has_promo := true;
    if v_promo.type = 'percent' then
      v_discount := least(v_base, greatest(0, round(v_base * v_promo.value / 100.0)::integer));
    else
      v_discount := least(v_base, greatest(0, v_promo.value));
    end if;
  end if;

  -- Admin chooses which components enter the tax base. Excluded components are
  -- still charged, so they live in a separate untaxed bucket instead of being
  -- dropped. Inclusive pricing extracts tax from the taxed bucket; exclusive
  -- pricing adds it on top.
  v_tax_base := greatest(0,
    v_base
    + case when v_tax_extras then v_extras_total else 0 end
    + case when v_tax_insurance then v_insurance_total else 0 end
    + case when v_tax_one_way then v_one_way else 0 end
    - v_discount
  );

  v_untaxed_total :=
    case when v_tax_extras then 0 else v_extras_total end
    + case when v_tax_insurance then 0 else v_insurance_total end
    + case when v_tax_one_way then 0 else v_one_way end;

  if v_tax_inclusive then
    if v_tax > 0 then
      v_fees := round(v_tax_base * v_tax / (100.0 + v_tax))::integer;
    else
      v_fees := 0;
    end if;
    v_total := v_tax_base + v_untaxed_total;
    v_taxable := v_tax_base - v_fees;
  else
    v_fees := round(v_tax_base * v_tax / 100.0)::integer;
    v_total := v_tax_base + v_untaxed_total + v_fees;
    v_taxable := v_tax_base;
  end if;

  v_deposit := round(v_total * v_deposit_pct / 100.0)::integer;
  v_amount_due := case when p_payment_plan = 'deposit' then v_deposit else v_total end;

  select exists (
    select 1 from public.bookings b
    where b.vehicle_id = p_vehicle_id
      and b.status in ('pending','confirmed','active')
      and b.start_date < p_end_date
      and b.end_date > p_start_date
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
  ) into v_conflict;

  return jsonb_build_object(
    'days', v_days,
    'nightlyRate', round(v_base::numeric / v_days),
    'baseTotal', v_base,
    'extrasTotal', v_extras_total,
    'insuranceTotal', v_insurance_total,
    'oneWayFee', v_one_way,
    'discount', v_discount,
    'fees', v_fees,
    'untaxedTotal', v_untaxed_total,
    'taxRate', v_tax,
    'taxLabel', v_tax_label,
    'taxInclusive', v_tax_inclusive,
    'taxOnExtras', v_tax_extras,
    'taxOnInsurance', v_tax_insurance,
    'taxOnOneWay', v_tax_one_way,
    'taxable', v_taxable,
    'total', v_total,
    'depositDue', v_deposit,
    'depositPercent', v_deposit_pct,
    'amountDue', v_amount_due,
    'balanceDue', v_total - v_amount_due,
    'extras', v_extras_json,
    'insurance', jsonb_build_object(
      'key', v_insurance.key,
      'label', v_insurance.label,
      'pricePerDay', v_insurance.price_per_day,
      'deductible', v_insurance.deductible,
      'blurb', v_insurance.blurb
    ),
    'promoApplied', case when v_has_promo and v_discount > 0
      then jsonb_build_object('code', v_promo.code, 'type', v_promo.type, 'value', v_promo.value)
      else null end,
    'available', not coalesce(v_conflict, false),
    'unavailableReason', case when coalesce(v_conflict, false)
      then 'Those dates are already booked. Try different dates or another vehicle.' else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Half-open availability strip
-- ---------------------------------------------------------------------------
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
        and b.end_date > s.d
    )
    union all
    select s.d, 'block:' || coalesce(vb.kind, 'other')::text
    from span s
    join public.vehicle_blocks vb
      on vb.vehicle_id = p_vehicle_id
     and vb.start_date <= s.d
     and vb.end_date > s.d;
end;
$$;

grant execute on function public.vehicle_busy_days(uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Change-request approval keeps the taxable snapshot in step
-- ---------------------------------------------------------------------------
-- Migration 005 repriced approved changes but predates the taxable split. On a
-- downward reprice the invoice register would otherwise keep the old taxable
-- value (or fall back to `total - tax`, which counts untaxed components).
create or replace function public.resolve_booking_change_request(
  p_booking_id uuid,
  p_decision text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_request jsonb;
  v_quote jsonb;
  v_previous numeric;
  v_delta numeric;
  v_actor_name text;
  v_reason text := coalesce(btrim(p_reason), '');
  v_pending jsonb;
begin
  if not public.is_staff() then
    raise exception 'This area is for Rove staff only.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.change_request is null
     or v_booking.change_request->>'status' <> 'pending' then
    raise exception 'No pending change request for this booking.';
  end if;
  v_request := v_booking.change_request;

  select coalesce(p.full_name, 'Staff') into v_actor_name
  from public.profiles p where p.id = auth.uid();

  if p_decision = 'approve' then
    v_quote := public.quote_rental(
      v_booking.vehicle_id,
      (v_request->>'startDate')::date,
      (v_request->>'endDate')::date,
      v_booking.extras, v_booking.insurance, v_booking.promo_code,
      v_request->>'pickupLocation',
      v_request->>'dropoffLocation',
      v_booking.payment_plan,
      v_booking.id
    );
    if not (v_quote->>'available')::boolean then
      raise exception 'Those dates just became unavailable — decline the request and tell the customer.';
    end if;

    v_previous := coalesce(v_booking.total, 0);
    v_delta := coalesce((v_quote->>'total')::numeric, 0) - v_previous;

    update public.bookings
    set start_date = (v_request->>'startDate')::date,
        end_date = (v_request->>'endDate')::date,
        pickup_location = v_request->>'pickupLocation',
        dropoff_location = v_request->>'dropoffLocation',
        pickup_time = v_request->>'pickupTime',
        dropoff_time = v_request->>'dropoffTime',
        days = (v_quote->>'days')::integer,
        base_total = coalesce((v_quote->>'baseTotal')::numeric, v_booking.base_total),
        extras_total = coalesce((v_quote->>'extrasTotal')::numeric, v_booking.extras_total),
        insurance_total = coalesce((v_quote->>'insuranceTotal')::numeric, v_booking.insurance_total),
        one_way_fee = coalesce((v_quote->>'oneWayFee')::numeric, v_booking.one_way_fee),
        fees = coalesce((v_quote->>'fees')::numeric, v_booking.fees),
        tax_rate = coalesce((v_quote->>'taxRate')::numeric, v_booking.tax_rate),
        tax_inclusive = coalesce((v_quote->>'taxInclusive')::boolean, v_booking.tax_inclusive),
        taxable_amount = coalesce((v_quote->>'taxable')::integer, v_booking.taxable_amount),
        untaxed_total = coalesce((v_quote->>'untaxedTotal')::integer, v_booking.untaxed_total),
        discount = coalesce((v_quote->>'discount')::numeric, v_booking.discount),
        total = (v_quote->>'total')::numeric,
        deposit_due = (v_quote->>'depositDue')::numeric,
        trip_changes = v_booking.trip_changes || jsonb_build_object(
          'type', 'change',
          'at', now(),
          'by', v_actor_name,
          'summary', (v_request->>'startDate') || ' → ' || (v_request->>'endDate')
                 || ' · ' || (v_request->>'pickupLocation') || ' → ' || (v_request->>'dropoffLocation'),
          'delta', v_delta
        ),
        change_request = v_request || jsonb_build_object(
          'status', 'approved',
          'resolvedAt', now(),
          'resolvedBy', auth.uid(),
          'reason', v_reason
        )
    where id = v_booking.id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), v_actor_name, 'manager', 'update', 'bookings', v_booking.code,
            'Approved change request for ' || v_booking.code, jsonb_build_object(
              'change', 'approve',
              'reason', v_reason,
              'delta', jsonb_build_object('from', v_previous, 'to', v_booking.total)
            ));

    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'trip_change_approved', 'Trip change approved',
            'Your ' || v_booking.code || ' change was approved — new dates '
            || (v_request->>'startDate') || ' to ' || (v_request->>'endDate') || '.',
            v_booking.code, '/confirmation/' || v_booking.code);

  elsif p_decision = 'decline' then
    update public.bookings
    set change_request = v_request || jsonb_build_object(
      'status', 'declined',
      'resolvedAt', now(),
      'resolvedBy', auth.uid(),
      'reason', v_reason
    )
    where id = v_booking.id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), v_actor_name, 'manager', 'update', 'bookings', v_booking.code,
            'Declined change request for ' || v_booking.code, jsonb_build_object('change', 'decline', 'reason', v_reason));

    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'trip_change_declined', 'Change request declined',
            case when v_reason = '' then 'Your ' || v_booking.code || ' change was declined — the original booking is unchanged.'
                 else 'Your ' || v_booking.code || ' change was declined: ' || v_reason end,
            v_booking.code, '/account?tab=trips');
  else
    raise exception 'Invalid decision.';
  end if;

  select change_request into v_pending from public.bookings where id = v_booking.id;
  return jsonb_build_object('ok', true, 'decision', p_decision, 'changeRequest', v_pending);
end;
$$;

grant execute on function public.resolve_booking_change_request(uuid, text, text) to authenticated;
