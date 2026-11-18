-- 202610270007_quote_past_start_guard.sql
--
-- Let a trip that is already on the road be re-priced at its own dates.
--
-- quote_rental_core rejects any start date in the past. That is right for the
-- storefront, but it also blocked every legitimate re-price of an ACTIVE
-- booking (extension at the desk, customer self-serve extension, staff date
-- change mid-trip): the vehicle left yesterday, so the new quote starts in
-- the past. Demo mode re-prices through calculateQuote(skipValidation) and was
-- unaffected, so this migration restores Supabase parity.
--
-- The guard is relaxed *only* for the booking being worked on: the caller
-- must pass that booking's id as p_exclude_booking_id, the booking must be
-- active, and its pick-up date must match the quote's start date. Anything
-- else still gets the hard "Pick-up date cannot be in the past." error, so a
-- stray client cannot re-price a trip it does not own.
--
-- The body is otherwise byte-for-byte 202610220013's quote_rental_core, so
-- every quote number the console has shipped stays identical.

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
    if p_exclude_booking_id is null then
      raise exception 'Pick-up date cannot be in the past.';
    end if;
    -- Only the active booking whose own pick-up this is may be re-priced with
    -- a past start (extension / desk date change). No other caller can.
    if not exists (
      select 1 from public.bookings b
      where b.id = p_exclude_booking_id
        and b.status = 'active'
        and b.vehicle_id = p_vehicle_id
        and b.start_date = p_start_date
    ) then
      raise exception 'Pick-up date cannot be in the past.';
    end if;
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

-- The core stays internal; clients quote through the checked wrapper.
revoke all on function public.quote_rental_core(uuid,date,date,text[],text,text,text,text,text,uuid) from public, anon, authenticated;