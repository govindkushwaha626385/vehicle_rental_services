-- 202610200006_contact_inbox_quote_rules.sql
-- Contact inbox workflow plus admin-controlled rental duration/advance rules.

-- ---------------------------------------------------------------------------
-- 1. Contact inbox: status, private staff notes and update/delete access
-- ---------------------------------------------------------------------------
alter table public.contact_messages add column if not exists status text not null default 'new';
alter table public.contact_messages add column if not exists staff_notes text not null default '';
alter table public.contact_messages add column if not exists updated_at timestamptz not null default now();

alter table public.bookings add column if not exists cancellation_reason text not null default '';
alter table public.bookings add column if not exists cancelled_by text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_cancelled_by_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_cancelled_by_check check (cancelled_by in ('', 'customer', 'staff'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contact_messages_status_check'
      and conrelid = 'public.contact_messages'::regclass
  ) then
    alter table public.contact_messages
      add constraint contact_messages_status_check check (status in ('new', 'read', 'resolved'));
  end if;
end $$;

drop trigger if exists contact_messages_updated_at on public.contact_messages;
create trigger contact_messages_updated_at before update on public.contact_messages
  for each row execute function public.set_updated_at();

drop policy if exists contact_messages_staff_update on public.contact_messages;
create policy contact_messages_staff_update on public.contact_messages
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists contact_messages_staff_delete on public.contact_messages;
create policy contact_messages_staff_delete on public.contact_messages
  for delete to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. Content and policy defaults (never overwrite an admin's saved values)
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('bikes_enabled', 'true'),
  ('guest_checkout_enabled', 'true'),
  ('reviews_enabled', 'true'),
  ('cancellation_window_hours', '48'),
  ('cancellation_refund_percent', '50'),
  ('late_fee_per_hour', '500'),
  ('min_rental_days', '1'),
  ('max_advance_days', '365'),
  ('min_bike_rider_age', '18'),
  ('fuel_refill_fee', '300'),
  ('bike_fuel_refill_fee', '200'),
  ('whatsapp_number', '+91 80 5555 0100'),
  ('support_hours', 'Every day, 7am–11pm IST'),
  ('hero_eyebrow', 'Self-drive rentals across India'),
  ('hero_title', 'Cars and bikes, ready when you are.'),
  ('hero_subtitle', 'Beautifully kept cars and two-wheelers, honest all-in pricing and a handover that takes minutes — not an afternoon. Pick a set of wheels, pick a road, and go.'),
  ('hero_cta_label', 'Explore the fleet'),
  ('hero_badge', 'New: 2026 fleet'),
  ('hero_image_url', 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=2000&q=85'),
  ('hero_image_alt', 'A sports car on an open mountain road'),
  ('hero_rating', '4.9'),
  ('hero_trip_count', '2,400+'),
  ('hero_trip_label', 'verified trips this year'),
  ('footer_tagline', 'Premium self-drive rentals across India. Transparent pricing, beautifully kept cars and bikes, and people who actually pick up the phone.'),
  ('company_legal_name', 'Rove Mobility Pvt. Ltd.'),
  ('gstin', '29AABCR1234F1Z5'),
  ('registered_address', 'Indiranagar, Bengaluru 560038, Karnataka, India'),
  ('social_instagram', ''),
  ('social_twitter', ''),
  ('social_linkedin', ''),
  ('legal_updated', '20 October 2026')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Re-serialise cancellation context for both the customer and admin apps
-- ---------------------------------------------------------------------------
create or replace function public.booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'code', b.code,
    'status', b.status,
    'paymentStatus', b.payment_status,
    'paymentPlan', b.payment_plan,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'startDate', b.start_date,
    'endDate', b.end_date,
    'pickupTime', b.pickup_time,
    'dropoffTime', b.dropoff_time,
    'days', b.days,
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object('key', e.key, 'label', e.label, 'pricePerDay', e.price_per_day) order by e.id)
      from unnest(b.extras) as k(key)
      join public.extras e on e.key = k.key
    ), '[]'::jsonb),
    'extraKeys', to_jsonb(b.extras),
    'insurance', jsonb_build_object(
      'key', b.insurance,
      'label', coalesce(it.label, initcap(b.insurance)),
      'pricePerDay', coalesce(it.price_per_day, 0),
      'deductible', coalesce(it.deductible, 0),
      'blurb', coalesce(it.blurb, '')
    ),
    'baseTotal', b.base_total,
    'extrasTotal', b.extras_total,
    'insuranceTotal', b.insurance_total,
    'oneWayFee', b.one_way_fee,
    'fees', b.fees,
    'discount', b.discount,
    'total', b.total,
    'depositDue', b.deposit_due,
    'amountPaid', b.amount_paid,
    'balanceDue', greatest(0, b.total - b.amount_paid),
    'promoCode', b.promo_code,
    'driver', jsonb_build_object(
      'name', b.driver_name,
      'email', b.driver_email,
      'phone', b.driver_phone,
      'license', b.driver_license,
      'dob', b.driver_dob
    ),
    'notes', b.notes,
    'createdAt', b.created_at,
    'cancelledAt', b.cancelled_at,
    'cancellationReason', b.cancellation_reason,
    'cancelledBy', b.cancelled_by,
    'pickupAt', (b.start_date::text || 'T' || b.pickup_time || ':00'),
    'holdAmount', coalesce((select value::integer from public.settings where key = 'hold_amount'), 5000),
    'vehicle', jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'brand', v.brand,
      'type', v.type,
      'imageUrl', v.image_url,
      'pricePerDay', v.price_per_day,
      'location', v.location
    ),
    'customer', jsonb_build_object(
      'name', coalesce(p.full_name, b.guest_name),
      'email', coalesce(p.email, b.guest_email),
      'phone', coalesce(p.phone, b.guest_phone),
      'isGuest', b.user_id is null
    ),
    'reviewed', exists(select 1 from public.reviews r where r.booking_id = b.id),
    'canCancel', b.status in ('pending','confirmed')
      and (b.start_date + b.pickup_time::time) > (now() at time zone 'Asia/Kolkata'),
    'canReview', b.status = 'completed' and b.user_id is not null
      and not exists(select 1 from public.reviews r where r.booking_id = b.id),
    'hasHold', exists(select 1 from public.payments pay where pay.booking_id = b.id and pay.kind = 'hold' and pay.status = 'authorized'),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'kind', pay.kind, 'amount', pay.amount, 'status', pay.status,
        'brand', pay.brand, 'last4', pay.last4, 'reference', pay.reference, 'createdAt', pay.created_at
      ) order by pay.created_at)
      from public.payments pay where pay.booking_id = b.id
    ), '[]'::jsonb)
  )
  from public.bookings b
  join public.vehicles v on v.id = b.vehicle_id
  left join public.insurance_tiers it on it.key = b.insurance
  left join public.profiles p on p.id = b.user_id
  where b.id = p_booking_id;
$$;


-- ---------------------------------------------------------------------------
-- 4. Quote engine: enforce minimum days and the admin advance window
-- ---------------------------------------------------------------------------
create or replace function public.quote_rental(
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

  v_tax := coalesce((select value::numeric from public.settings where key = 'tax_rate'), 18);
  v_deposit_pct := coalesce((select value::numeric from public.settings where key = 'deposit_percent'), 25);
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
      v_discount := round(v_base * v_promo.value / 100.0)::integer;
    else
      v_discount := least(v_promo.value, v_base);
    end if;
  end if;

  v_fees := round(
    greatest(0, v_base + v_extras_total + v_insurance_total + v_one_way - v_discount) * v_tax / 100.0
  )::integer;
  v_total := greatest(0, v_base + v_extras_total + v_insurance_total + v_one_way - v_discount + v_fees);
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
    'taxRate', v_tax,
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


-- Quote functions are readable by anon/authenticated through the API role, but
-- only staff can edit settings. The function remains SECURITY DEFINER because it
-- reads bookings for availability without exposing the bookings table.
