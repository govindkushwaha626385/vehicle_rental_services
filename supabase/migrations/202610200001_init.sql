-- ============================================================================
--  Rove Rentals · Supabase schema
--  Postgres + RLS + Auth-triggered profiles + secure pricing RPCs
--  Currency: INR (Razorpay)
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function public.generate_booking_code()
returns text
language sql
volatile
as $$
  select 'RV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null default '',
  email          text,
  phone          text not null default '',
  license_number text not null default '',
  role           text not null default 'customer' check (role in ('customer','manager','admin')),
  status         text not null default 'active' check (status in ('active','suspended')),
  card_brand     text not null default '',
  card_last4     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand         text not null,
  type          text not null check (type in ('Sports','SUV','Sedan','Electric','Convertible','Van','Economy')),
  year          integer not null check (year between 1990 and 2100),
  seats         integer not null check (seats between 1 and 9),
  luggage       integer not null default 2 check (luggage between 0 and 8),
  transmission  text not null check (transmission in ('Automatic','Manual')),
  fuel          text not null check (fuel in ('Petrol','Diesel','Electric','Hybrid')),
  awd           boolean not null default false,
  efficiency    text not null default '',
  price_per_day integer not null check (price_per_day between 500 and 200000),
  location      text not null,
  image_url     text not null,
  images        text[] not null default '{}',
  description   text not null default '',
  features      text[] not null default '{}',
  status        text not null default 'available' check (status in ('available','rented','maintenance')),
  rating        numeric(2,1) not null default 4.8,
  trips         integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.locations (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  address text not null default '',
  city    text not null default '',
  region  text not null default '',
  lat     double precision not null default 0,
  lng     double precision not null default 0,
  phone   text not null default '',
  hours   text not null default 'Mon–Sun, 8:00–20:00',
  active  boolean not null default true
);

create table if not exists public.insurance_tiers (
  key           text primary key check (key in ('basic','standard','full')),
  label         text not null,
  price_per_day integer not null default 0,
  deductible    integer not null default 0,
  blurb         text not null default '',
  active        boolean not null default true
);

create table if not exists public.extras (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  label         text not null,
  description   text not null default '',
  price_per_day integer not null default 0 check (price_per_day between 0 and 20000),
  active        boolean not null default true
);

create table if not exists public.promos (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code = upper(code)),
  description text not null default '',
  type        text not null check (type in ('percent','fixed')),
  value       integer not null check (value > 0),
  min_days    integer not null default 1 check (min_days between 1 and 60),
  active      boolean not null default true,
  expires_at  date,
  usage_limit integer not null default 0,
  used_count  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.settings (
  key   text primary key,
  value text not null
);

create table if not exists public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique default public.generate_booking_code(),
  user_id            uuid references public.profiles(id) on delete set null,
  guest_name         text not null default '',
  guest_email        text not null default '',
  guest_phone        text not null default '',
  vehicle_id         uuid not null references public.vehicles(id) on delete restrict,
  pickup_location    text not null,
  dropoff_location   text not null,
  start_date         date not null,
  end_date           date not null,
  pickup_time        text not null default '10:00',
  dropoff_time       text not null default '10:00',
  days               integer not null check (days between 1 and 60),
  extras             text[] not null default '{}',
  insurance          text not null default 'basic' references public.insurance_tiers(key),
  base_total         integer not null default 0,
  extras_total       integer not null default 0,
  insurance_total    integer not null default 0,
  one_way_fee        integer not null default 0,
  fees               integer not null default 0,
  discount           integer not null default 0,
  total              integer not null default 0,
  deposit_due        integer not null default 0,
  amount_paid        integer not null default 0,
  promo_code         text not null default '',
  payment_plan       text not null default 'full' check (payment_plan in ('full','deposit')),
  payment_status     text not null default 'unpaid' check (payment_status in ('unpaid','deposit_paid','paid','partially_refunded','refunded')),
  status             text not null default 'pending' check (status in ('pending','confirmed','active','completed','cancelled','rejected')),
  driver_name        text not null default '',
  driver_email       text not null default '',
  driver_phone       text not null default '',
  driver_license     text not null default '',
  driver_dob         date,
  notes              text not null default '',
  razorpay_order_id  text,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bookings_dates_valid check (end_date > start_date)
);

-- Hard guarantee against double-booking the same car for overlapping dates.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    vehicle_id with =,
    daterange(start_date, end_date, '[)') with &&
  ) where (status in ('pending','confirmed','active'));

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind       text not null check (kind in ('payment','deposit','balance','hold','refund')),
  amount     integer not null check (amount >= 0),
  currency   text not null default 'INR',
  status     text not null check (status in ('succeeded','authorized','refunded','failed','created')),
  brand      text not null default '',
  last4      text not null default '',
  reference  text,
  order_id   text,
  created_at timestamptz not null default now()
);

create unique index if not exists payments_reference_unique
  on public.payments(reference) where reference is not null;

create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  author     text not null default '',
  rating     integer not null check (rating between 1 and 5),
  comment    text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists reviews_booking_unique
  on public.reviews(booking_id) where booking_id is not null;

create table if not exists public.favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

create unique index if not exists bookings_razorpay_order_unique
  on public.bookings(razorpay_order_id) where razorpay_order_id is not null;
create index if not exists bookings_user_idx on public.bookings(user_id);
create index if not exists bookings_vehicle_dates_idx on public.bookings(vehicle_id, start_date, end_date);
create index if not exists bookings_status_idx on public.bookings(status);
create index if not exists payments_booking_idx on public.payments(booking_id);
create index if not exists reviews_vehicle_idx on public.reviews(vehicle_id);
create index if not exists profiles_email_idx on public.profiles(lower(email));

-- ---------------------------------------------------------------------------
-- 2. Utility functions & triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists vehicles_updated_at on public.vehicles;
create trigger vehicles_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

drop trigger if exists bookings_updated_at on public.bookings;
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

-- Closing a rental must always release the (modelled) security hold, even when
-- staff cancel without moving money through the refund Edge Function.
create or replace function public.release_hold_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('cancelled','rejected')
     and old.status is distinct from new.status then
    update public.payments
       set status = 'refunded'
     where booking_id = new.id
       and kind = 'hold'
       and status = 'authorized';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_release_hold on public.bookings;
create trigger bookings_release_hold
  after update of status on public.bookings
  for each row execute function public.release_hold_on_close();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(coalesce(new.email, 'driver'), '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('manager','admin') and status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role calls run without auth.uid(). Only admins may change role/status.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'Only super admins can change account role or status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.recalc_vehicle_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle uuid;
begin
  if tg_op = 'DELETE' then
    v_vehicle := old.vehicle_id;
  else
    v_vehicle := new.vehicle_id;
  end if;

  update public.vehicles v
     set rating = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r where r.vehicle_id = v_vehicle), v.rating)
   where v.id = v_vehicle;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_recalc_rating on public.reviews;
create trigger reviews_recalc_rating
  after insert or update or delete on public.reviews
  for each row execute function public.recalc_vehicle_rating();

-- ---------------------------------------------------------------------------
-- 3. RPC: pricing & availability (authoritative, server-side)
-- ---------------------------------------------------------------------------

-- Drop the original nine-argument signature so re-running this migration on an
-- existing project does not create an ambiguous overload.
drop function if exists public.quote_rental(uuid, date, date, text[], text, text, text, text, text);

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
  v_max_days integer;
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

  if p_start_date is null or p_end_date is null then
    raise exception 'Please choose pick-up and drop-off dates.';
  end if;
  if p_start_date < current_date then
    raise exception 'Pick-up date cannot be in the past.';
  end if;

  v_days := p_end_date - p_start_date;
  if v_days < 1 then
    raise exception 'Drop-off must be at least one day after pick-up.';
  end if;

  select coalesce((select value::integer from public.settings where key = 'max_rental_days'), 45) into v_max_days;
  if v_days > v_max_days then
    raise exception 'Rentals are limited to % days.', v_max_days;
  end if;
  if p_start_date > current_date + 365 then
    raise exception 'Bookings can be made up to 12 months in advance.';
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
    select * into v_insurance from public.insurance_tiers where key = 'basic';
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

-- Availability is public information, but individual bookings are private.
-- This security-definer RPC exposes only the set of unavailable vehicle IDs for
-- a date window, so browse filtering works for guests and customers without
-- weakening the bookings RLS policy.
create or replace function public.unavailable_vehicle_ids(p_start_date date, p_end_date date)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct b.vehicle_id), '{}'::uuid[])
  from public.bookings b
  where b.status in ('pending','confirmed','active')
    and b.start_date < p_end_date
    and b.end_date > p_start_date;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC: booking serialisation & access-controlled readers
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
    'canCancel', b.status in ('pending','confirmed') and b.start_date >= current_date,
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

revoke all on function public.booking_json(uuid) from public, anon, authenticated;

create or replace function public.my_bookings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.booking_json(b.id)
           order by case b.status
                      when 'active' then 0 when 'confirmed' then 1 when 'pending' then 2 else 3 end,
                    b.start_date desc), '[]'::jsonb)
  from public.bookings b
  where b.user_id = auth.uid();
$$;

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
    raise exception 'We could not find a booking with those details.';
  end if;

  return public.booking_json(v_id);
end;
$$;

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
    select coalesce(jsonb_agg(public.booking_json(b.id) order by b.created_at desc), '[]'::jsonb)
    from public.bookings b
  );
end;
$$;

create or replace function public.admin_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Super admin access required.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
      'role', p.role, 'status', p.status, 'licenseNumber', p.license_number,
      'cardBrand', p.card_brand, 'cardLast4', p.card_last4, 'createdAt', p.created_at,
      'bookings', (select count(*) from public.bookings b where b.user_id = p.id),
      'spend', (select coalesce(sum(b.total),0) from public.bookings b where b.user_id = p.id and b.status = 'completed')
    ) order by p.created_at desc), '[]'::jsonb)
    from public.profiles p
  );
end;
$$;

create or replace function public.admin_update_user(p_user_id uuid, p_role text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
  v_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Super admin access required.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role or status.';
  end if;
  select * into v_target from public.profiles where id = p_user_id;
  if not found then raise exception 'User not found.'; end if;

  if p_role is not null and p_role not in ('customer','manager','admin') then
    raise exception 'Invalid role.';
  end if;
  if p_status is not null and p_status not in ('active','suspended') then
    raise exception 'Invalid status.';
  end if;

  if v_target.role = 'admin' and (coalesce(p_role, v_target.role) <> 'admin' or coalesce(p_status, v_target.status) <> 'active') then
    select count(*) into v_admins from public.profiles where role = 'admin' and status = 'active';
    if v_admins <= 1 then
      raise exception 'There must always be at least one active super admin.';
    end if;
  end if;

  update public.profiles
     set role = coalesce(p_role, role), status = coalesce(p_status, status)
   where id = p_user_id;

  select * into v_target from public.profiles where id = p_user_id;
  return jsonb_build_object(
    'id', v_target.id, 'name', v_target.full_name, 'email', v_target.email,
    'phone', v_target.phone, 'role', v_target.role, 'status', v_target.status,
    'createdAt', v_target.created_at
  );
end;
$$;

create or replace function public.increment_promo_usage(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.promos
     set used_count = used_count + 1
   where code = upper(trim(p_code));
$$;

revoke all on function public.increment_promo_usage(text) from public, anon, authenticated;
grant execute on function public.increment_promo_usage(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.locations enable row level security;
alter table public.insurance_tiers enable row level security;
alter table public.extras enable row level security;
alter table public.promos enable row level security;
alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;

-- Profiles ------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Catalogue ------------------------------------------------------------------
drop policy if exists vehicles_public_read on public.vehicles;
create policy vehicles_public_read on public.vehicles
  for select to anon, authenticated
  using (status <> 'maintenance' or public.is_staff());

drop policy if exists vehicles_staff_write on public.vehicles;
create policy vehicles_staff_write on public.vehicles
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists locations_public_read on public.locations;
create policy locations_public_read on public.locations
  for select to anon, authenticated
  using (active = true or public.is_staff());

drop policy if exists locations_staff_write on public.locations;
create policy locations_staff_write on public.locations
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists insurance_public_read on public.insurance_tiers;
create policy insurance_public_read on public.insurance_tiers
  for select to anon, authenticated
  using (active = true or public.is_staff());

drop policy if exists insurance_staff_write on public.insurance_tiers;
create policy insurance_staff_write on public.insurance_tiers
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists extras_public_read on public.extras;
create policy extras_public_read on public.extras
  for select to anon, authenticated
  using (active = true or public.is_staff());

drop policy if exists extras_staff_write on public.extras;
create policy extras_staff_write on public.extras
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists promos_staff_all on public.promos;
create policy promos_staff_all on public.promos
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (true);

drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Bookings & payments --------------------------------------------------------
drop policy if exists bookings_select_own_or_staff on public.bookings;
create policy bookings_select_own_or_staff on public.bookings
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

drop policy if exists bookings_staff_update on public.bookings;
create policy bookings_staff_update on public.bookings
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists payments_select_own_or_staff on public.payments;
create policy payments_select_own_or_staff on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and (b.user_id = auth.uid() or public.is_staff())
    )
  );

-- Reviews --------------------------------------------------------------------
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select to anon, authenticated
  using (true);

drop policy if exists reviews_insert_own_completed on public.reviews;
create policy reviews_insert_own_completed on public.reviews
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.user_id = auth.uid()
        and b.vehicle_id = reviews.vehicle_id
        and b.status = 'completed'
    )
  );

-- Favorites ------------------------------------------------------------------
drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Storage bucket for fleet photography
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-images', 'vehicle-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists vehicle_images_public_read on storage.objects;
create policy vehicle_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'vehicle-images');

drop policy if exists vehicle_images_staff_insert on storage.objects;
create policy vehicle_images_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-images' and public.is_staff());

drop policy if exists vehicle_images_staff_update on storage.objects;
create policy vehicle_images_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'vehicle-images' and public.is_staff());

drop policy if exists vehicle_images_staff_delete on storage.objects;
create policy vehicle_images_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'vehicle-images' and public.is_staff());

-- ---------------------------------------------------------------------------
-- 7. Function grants
-- ---------------------------------------------------------------------------

grant execute on function public.quote_rental(uuid,date,date,text[],text,text,text,text,text,uuid) to anon, authenticated;
grant execute on function public.unavailable_vehicle_ids(date,date) to anon, authenticated;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.get_booking(text,text) to anon, authenticated;
grant execute on function public.admin_bookings() to authenticated;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_update_user(uuid,text,text) to authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
