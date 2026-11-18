-- ============================================================================
--  Rove Rentals · Webhooks, KYC, contact, notifications + pricing ops schema
--  Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Webhook idempotency ledger
--    Razorpay delivers at-least-once with retries for 24h; dedupe on the
--    X-Razorpay-Event-Id so a replay can never double-create a booking.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique,
  event_type   text not null,
  entity       jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  last_error   text
);

-- Server-side checkout intent: captured at order creation so a customer who
-- closes the tab mid-payment can be reconciled by the webhook later without
-- the browser draft. This is the fix for the "paid but no booking" hole.
create table if not exists public.checkout_intents (
  id         uuid primary key default gen_random_uuid(),
  order_id   text not null unique,
  draft      jsonb not null,
  quote      jsonb not null,
  status     text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  created_at timestamptz not null default now()
);

-- These two tables contain payment internals and customer PII. They are only
-- touched by the service role inside Edge Functions, never by a browser.
alter table public.webhook_events enable row level security;
alter table public.checkout_intents enable row level security;
revoke all on public.webhook_events from anon, authenticated;
revoke all on public.checkout_intents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Forward-looking pricing/operations columns (cars + bikes)
--    Additive scaffolding for hourly rates, km caps and odometer reconciliation.
--    The current checkout still prices per rental day; older clients ignore these.
-- ---------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists price_per_hour integer,
  add column if not exists km_cap integer,
  add column if not exists fuel_policy text not null default 'full_to_full'
    check (fuel_policy in ('full_to_full','same_to_same'));

alter table public.bookings
  add column if not exists km_cap integer,
  add column if not exists km_extra_rate integer not null default 0,
  add column if not exists pickup_odometer integer,
  add column if not exists return_odometer integer,
  add column if not exists actual_returned_at timestamptz,
  add column if not exists penalty_charged integer not null default 0;

-- Expose the new fields through the booking serialiser so the admin console
-- and customer voucher see them in production, not just demo mode.
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
    'kmCap', b.km_cap,
    'kmExtraRate', b.km_extra_rate,
    'pickupOdometer', b.pickup_odometer,
    'returnOdometer', b.return_odometer,
    'actualReturnedAt', b.actual_returned_at,
    'penaltyCharged', b.penalty_charged,
    'vehicle', jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'brand', v.brand,
      'type', v.type,
      'imageUrl', v.image_url,
      'pricePerDay', v.price_per_day,
      'location', v.location,
      'fuelPolicy', v.fuel_policy
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

-- ---------------------------------------------------------------------------
-- 3. Contact form submissions (public /contact page)
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 120),
  email      text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  phone      text not null default '',
  message    text not null check (char_length(message) between 10 and 2000),
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists contact_messages_insert on public.contact_messages;
create policy contact_messages_insert on public.contact_messages
  for insert to anon, authenticated
  with check (true);

drop policy if exists contact_messages_staff_select on public.contact_messages;
create policy contact_messages_staff_select on public.contact_messages
  for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 4. Notification log (edge function writes here; staff reads)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                 -- booking_confirmed, payment_recovered, ...
  channel     text not null,                 -- email | whatsapp | log
  recipient   text not null default '',
  subject     text not null default '',
  body        text not null default '',
  meta        jsonb not null default '{}'::jsonb,
  status      text not null default 'queued',-- queued | sent | failed | skipped
  created_at  timestamptz not null default now()
);

alter table public.notification_log enable row level security;
drop policy if exists notification_log_staff_select on public.notification_log;
create policy notification_log_staff_select on public.notification_log
  for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 5. Private licence-verification storage (KYC)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('licences', 'licences', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Owners may read/manage their own uploads; staff may read all for review.
drop policy if exists licences_own_read on storage.objects;
create policy licences_own_read on storage.objects
  for select to authenticated
  using (bucket_id = 'licences' and (owner_id::text = auth.uid()::text or public.is_staff()));

drop policy if exists licences_own_insert on storage.objects;
create policy licences_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'licences' and owner_id::text = auth.uid()::text);

drop policy if exists licences_own_update on storage.objects;
create policy licences_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'licences' and owner_id::text = auth.uid()::text);

drop policy if exists licences_own_delete on storage.objects;
create policy licences_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'licences' and owner_id::text = auth.uid()::text);

-- KYC state lives on the profile. Columns are additive and idempotent.
alter table public.profiles add column if not exists licence_verified boolean not null default false;
alter table public.profiles add column if not exists licence_url text;

-- ---------------------------------------------------------------------------
-- 6. Settings defaults for the new rules (no-op if already configured)
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('hourly_min_hours', '2'),
  ('default_km_cap', '200'),
  ('km_extra_rate', '12'),
  ('fuel_policy', 'full_to_full')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Grants for the webhook / notify functions (service-role only)
-- ---------------------------------------------------------------------------
revoke all on function public.booking_json(uuid) from public, anon, authenticated;