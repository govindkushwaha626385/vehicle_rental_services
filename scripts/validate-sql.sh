#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres cluster and assert the parts
# that are easy to break: block-aware quoting, trigger guards and function ACLs.
#
# Requires PostgreSQL client/server binaries (initdb, pg_ctl, psql, createdb).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$(mktemp -d "${TMPDIR:-/tmp}/rove-pg.XXXXXX")"
PORT="${ROVE_TEST_PG_PORT:-55439}"
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"

cleanup() {
  pg_ctl -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

for binary in initdb pg_ctl psql createdb; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "Missing PostgreSQL binary: $binary" >&2
    echo "Install PostgreSQL or add its bin directory to PATH." >&2
    exit 1
  fi
done

initdb -D "$DIR/data" -A trust -U postgres --no-locale >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/pg.log" start >/dev/null
createdb -h "$DIR" -p "$PORT" -U postgres rove

# Supabase-owned schemas the migrations expect.
psql -h "$DIR" -p "$PORT" -U postgres -d rove -q -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- The auth.uid() stub is GUC-backed so owner-gated RPCs can be integration
-- tested: a test sets app.test_uid to a profile id (and clears it afterwards).
-- When the GUC is unset it behaves exactly like Supabase's "no session".
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('app.test_uid', true), '')::uuid $$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
SQL

for file in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$file")"
  psql -h "$DIR" -p "$PORT" -U postgres -d rove -q -v ON_ERROR_STOP=1 -f "$file"
done

# Re-apply the two most recent migrations to catch non-idempotent DDL.
for file in \
  "$ROOT/supabase/migrations/202610200006_contact_inbox_quote_rules.sql" \
  "$ROOT/supabase/migrations/202610210001_vehicle_blocks_audit_logs.sql" \
  "$ROOT/supabase/migrations/202610210002_finance_invoices.sql" \
  "$ROOT/supabase/migrations/202610210003_day_rates.sql" \
  "$ROOT/supabase/migrations/202610210004_booking_contact.sql" \
  "$ROOT/supabase/migrations/202610210005_notifications.sql" \
  "$ROOT/supabase/migrations/202610210006_review_moderation.sql" \
  "$ROOT/supabase/migrations/202610220002_tax_booking_fleet_controls.sql" \
  "$ROOT/supabase/migrations/202610220003_security_deposit_due_at_pickup.sql" \
  "$ROOT/supabase/migrations/202610220010_fleet_maintenance.sql" \
  "$ROOT/supabase/migrations/202610220011_booking_serializer_lockdown.sql" \
  "$ROOT/supabase/migrations/202610220012_availability_strip.sql" \
  "$ROOT/supabase/migrations/202610220013_calculation_fixes.sql" \
  "$ROOT/supabase/migrations/202610270004_booking_km_terms.sql" \
  "$ROOT/supabase/migrations/202610270005_booking_km_snapshot.sql" \
  "$ROOT/supabase/migrations/202610270006_trip_extension.sql" \
  "$ROOT/supabase/migrations/202610270007_quote_past_start_guard.sql" \
  "$ROOT/supabase/migrations/202610270008_return_due_reminders.sql" \
  "$ROOT/supabase/migrations/202610270009_notification_pref_gate.sql" \
  "$ROOT/supabase/migrations/202610280001_resend_notification.sql" \
  "$ROOT/supabase/migrations/202610300001_review_replies.sql"; do
  psql -h "$DIR" -p "$PORT" -U postgres -d rove -q -v ON_ERROR_STOP=1 -f "$file"
done

echo "Checking availability blocks, quotes, tax controls, fleet merchandising, finance settings, day rates, contact and audit writes"
psql -h "$DIR" -p "$PORT" -U postgres -d rove -q -v ON_ERROR_STOP=1 <<'SQL'
create temp table picked as
select v.id
from public.vehicles v
where not exists (
  select 1
  from public.bookings b
  where b.vehicle_id = v.id
    and b.status in ('pending', 'confirmed', 'active')
)
order by v.name
limit 1;

insert into public.vehicle_blocks (vehicle_id, start_date, end_date, kind, reason)
select id, current_date + 10, current_date + 13, 'maintenance', 'Migration test'
from picked;

do $$
declare
  vehicle_id uuid;
  result jsonb;
begin
  select id into vehicle_id from picked;

  result := public.quote_rental(
    vehicle_id, current_date + 11, current_date + 12,
    '{}'::text[], 'basic', null, null, null, 'full'
  );
  if (result->>'available')::boolean is not false then
    raise exception 'Block-aware quote did not mark the dates unavailable: %', result;
  end if;
  if result->>'unavailableReason' not like '%maintenance%' then
    raise exception 'Block-aware quote lost the maintenance reason: %', result;
  end if;

  begin
    insert into public.vehicle_blocks (vehicle_id, start_date, end_date, kind)
    values (vehicle_id, current_date + 12, current_date + 14, 'private');
    raise exception 'Overlapping block unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%already has a block%' then
      raise;
    end if;
  end;

  begin
    insert into public.bookings (
      vehicle_id, start_date, end_date, days, total, amount_paid,
      status, driver_name, driver_email, driver_phone, driver_license, driver_dob
    ) values (
      vehicle_id, current_date + 11, current_date + 12, 1, 1000, 1000,
      'confirmed', 'Block Test', 'block@example.com', '9999999999', 'TEST', '1990-01-01'
    );
    raise exception 'Booking into a block unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%blocked for this vehicle%' then
      raise;
    end if;
  end;
end $$;

-- A customer changing their own trip must be able to quote the same dates;
-- everyone else must still see the conflict.
do $$
declare
  vehicle_id uuid;
  booking_id uuid;
  result jsonb;
begin
  select id into vehicle_id from picked;
  insert into public.bookings (
    vehicle_id, start_date, end_date, days, total, amount_paid,
    status, driver_name, driver_email, driver_phone, driver_license, driver_dob,
    pickup_location, dropoff_location
  ) values (
    vehicle_id, current_date + 50, current_date + 52, 2, 2000, 2000,
    'confirmed', 'Change Test', 'change@example.com', '9999999999', 'TEST', '1990-01-01',
    'Mumbai', 'Mumbai'
  ) returning id into booking_id;

  result := public.quote_rental(
    vehicle_id, current_date + 50, current_date + 52,
    '{}'::text[], 'basic', null, null, null, 'full', null
  );
  if (result->>'available')::boolean is not false then
    raise exception 'Overlapping booking should make the quote unavailable: %', result;
  end if;

  result := public.quote_rental(
    vehicle_id, current_date + 50, current_date + 52,
    '{}'::text[], 'basic', null, null, null, 'full', booking_id
  );
  if (result->>'available')::boolean is not true then
    raise exception 'A trip change could not exclude its own booking: %', result;
  end if;

  delete from public.bookings where id = booking_id;
end $$;

-- The availability strip RPC must be callable by anon, return only busy
-- dates inside the window, and never leak a free day or a private column.
do $$
declare
  row_count integer;
  reason_text text;
begin
  if not has_function_privilege('anon', 'public.vehicle_busy_days(uuid,date,date)', 'execute') then
    raise exception 'anon cannot read public availability days';
  end if;
  select count(*) into row_count
  from public.vehicle_busy_days((select id from picked limit 1), current_date + 12, current_date + 13);
  if row_count < 1 then
    raise exception 'the migration-test block did not appear in the availability strip';
  end if;
  select count(*) into row_count
  from public.vehicle_busy_days((select id from picked limit 1), current_date + 20, current_date + 21);
  if row_count <> 0 then
    raise exception 'a free day leaked into the availability strip';
  end if;
  -- The block ends on +13, so that day is free again (half-open, matching the
  -- quote engine and the admin calendar).
  select count(*) into row_count
  from public.vehicle_busy_days((select id from picked limit 1), current_date + 13, current_date + 13);
  if row_count <> 0 then
    raise exception 'a block end day must be free again, got % busy row(s)', row_count;
  end if;
  select reason into reason_text
  from public.vehicle_busy_days((select id from picked limit 1), current_date + 12, current_date + 12)
  limit 1;
  if reason_text not like 'block:%' then
    raise exception 'availability strip lost the block reason: %', reason_text;
  end if;
end $$;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.quote_rental_core(uuid,date,date,text[],text,text,text,text,text,uuid)',
    'execute'
  ) then
    raise exception 'anon can bypass the block-aware wrapper';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.quote_rental_core(uuid,date,date,text[],text,text,text,text,text,uuid)',
    'execute'
  ) then
    raise exception 'authenticated can bypass the block-aware wrapper';
  end if;
  if not has_function_privilege(
    'anon',
    'public.quote_rental(uuid,date,date,text[],text,text,text,text,text,uuid)',
    'execute'
  ) then
    raise exception 'anon cannot call the public quote wrapper';
  end if;
  if not exists (
    select 1 from public.audit_logs where entity_type = 'vehicle_blocks'
  ) then
    raise exception 'vehicle block changes were not audited';
  end if;
end $$;

do $$
declare
  vehicle_id uuid;
  booking_id uuid;
  result jsonb;
  base_rate integer;
  weekend_rate integer;
  weekday_rate integer;
  rates jsonb;
begin
  if not exists (select 1 from public.settings where key = 'invoice_prefix') then
    raise exception 'invoice prefix setting is missing';
  end if;
  if not exists (select 1 from public.settings where key = 'tax_label' and value = 'GST') then
    raise exception 'tax label setting is missing';
  end if;

  select id into vehicle_id from picked;
  -- Snapshot fixture: the booking below must freeze these terms.
  update public.vehicles set km_cap = 300, km_extra_rate = 10 where id = vehicle_id;
  insert into public.bookings (
    vehicle_id, pickup_location, dropoff_location, start_date, end_date, days,
    fees, tax_rate, total, amount_paid, status,
    driver_name, driver_email, driver_phone, driver_license, driver_dob
  ) values (
    vehicle_id, 'Bengaluru', 'Bengaluru', current_date + 20, current_date + 21, 1,
    180, 18, 1180, 1180, 'confirmed',
    'Finance Test', 'finance@example.com', '9999999999', 'TEST', '1990-01-01'
  ) returning id into booking_id;

  result := public.booking_json(booking_id);
  if (result->>'taxRate')::numeric <> 18 then
    raise exception 'booking_json lost the stored tax rate: %', result->>'taxRate';
  end if;
  if (result->>'taxInclusive')::boolean is not false then
    raise exception 'booking_json lost the stored tax mode: %', result->>'taxInclusive';
  end if;
  update public.bookings set tax_inclusive = true where id = booking_id;
  result := public.booking_json(booking_id);
  if (result->>'taxInclusive')::boolean is not true then
    raise exception 'booking_json did not expose an inclusive tax mode: %', result->>'taxInclusive';
  end if;
  update public.bookings set tax_inclusive = false where id = booking_id;
  if has_function_privilege('anon', 'public.booking_json(uuid)', 'execute') then
    raise exception 'anon can call the internal booking serializer';
  end if;
  if has_function_privilege('authenticated', 'public.booking_json(uuid)', 'execute') then
    raise exception 'authenticated can call the internal booking serializer directly';
  end if;
  if not has_function_privilege('authenticated', 'public.get_booking(text,text)', 'execute') then
    raise exception 'authenticated lost the checked booking reader';
  end if;

  select price_per_day into base_rate from public.vehicles where id = vehicle_id;
  rates := public.vehicle_day_rates(vehicle_id, current_date, current_date + 59);
  select (row->>'rate')::int into weekend_rate
    from jsonb_array_elements(rates) row
    where extract(dow from (row->>'date')::date)::int = 6
      and not (row->>'seasonal')::boolean
    limit 1;
  select (row->>'rate')::int into weekday_rate
    from jsonb_array_elements(rates) row
    where extract(dow from (row->>'date')::date)::int = 4
      and not (row->>'seasonal')::boolean
    limit 1;
  if weekend_rate is null or weekday_rate is null then
    raise exception 'day rates did not cover a weekend and a weekday night';
  end if;
  if weekend_rate <> round(base_rate * 1.15)::integer then
    raise exception 'weekend day rate should apply the weekend multiplier: % vs %', weekend_rate, round(base_rate * 1.15)::integer;
  end if;
  if weekday_rate <> base_rate then
    raise exception 'weekday day rate should be the base rate: % vs %', weekday_rate, base_rate;
  end if;
  if not has_function_privilege('anon', 'public.vehicle_day_rates(uuid,date,date)', 'execute') then
    raise exception 'anon cannot read day rates';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contact_messages' and column_name = 'booking_code'
  ) then
    raise exception 'contact messages are missing the booking code column';
  end if;

  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'notifications'
  ) then
    raise exception 'notifications table is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_select_own_or_staff'
  ) then
    raise exception 'notifications RLS select policy is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_log' and policyname = 'notification_log_staff_insert'
  ) then
    raise exception 'notification_log staff insert policy is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_staff_delete'
  ) then
    raise exception 'reviews staff delete policy is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_staff_update'
  ) then
    raise exception 'reviews staff update policy is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'reply'
  ) then
    raise exception 'reviews reply column is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_reply_length' and conrelid = 'public.reviews'::regclass
  ) then
    raise exception 'reviews reply length constraint is missing';
  end if;
end $$;

do $$
declare
  vehicle_id uuid;
  exclusive_result jsonb;
  inclusive_result jsonb;
  reduced_result jsonb;
  insurance_result jsonb;
  one_way_result jsonb;
  base integer;
  extras integer;
begin
  if not exists (select 1 from public.settings where key = 'booking_auto_confirm') then
    raise exception 'booking auto-confirm setting is missing';
  end if;
  if not exists (select 1 from public.settings where key = 'tax_inclusive') then
    raise exception 'tax inclusive setting is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'tax_inclusive'
  ) then
    raise exception 'bookings are missing the tax mode snapshot';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'featured'
  ) then
    raise exception 'vehicles are missing the featured column';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'display_order'
  ) then
    raise exception 'vehicles are missing the display order column';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'badge'
  ) then
    raise exception 'vehicles are missing the badge column';
  end if;

  select id into vehicle_id from picked;

  -- Default mode: tax is added to the taxable subtotal.
  exclusive_result := public.quote_rental(
    vehicle_id, current_date + 30, current_date + 32,
    array['gps']::text[], 'basic', null, 'Bengaluru', 'Bengaluru', 'full'
  );
  base := (exclusive_result->>'baseTotal')::integer;
  extras := (exclusive_result->>'extrasTotal')::integer;
  if extras <> 600 then
    raise exception 'two-day GPS should cost 600, got %', extras;
  end if;
  if (exclusive_result->>'taxInclusive')::boolean is not false then
    raise exception 'quotes should default to exclusive tax: %', exclusive_result;
  end if;
  if (exclusive_result->>'fees')::integer <> round((base + extras) * 18 / 100.0)::integer then
    raise exception 'exclusive tax was not applied to base and extras: %', exclusive_result;
  end if;
  if (exclusive_result->>'total')::integer <> base + extras + (exclusive_result->>'fees')::integer then
    raise exception 'exclusive total should add tax on top: %', exclusive_result;
  end if;
  if (exclusive_result->>'untaxedTotal')::integer <> 0 then
    raise exception 'every component is taxable by default: %', exclusive_result;
  end if;

  -- Inclusive mode extracts tax from the same total.
  update public.settings set value = 'true' where key = 'tax_inclusive';
  inclusive_result := public.quote_rental(
    vehicle_id, current_date + 30, current_date + 32,
    array['gps']::text[], 'basic', null, 'Bengaluru', 'Bengaluru', 'full'
  );
  if (inclusive_result->>'total')::integer <> base + extras then
    raise exception 'inclusive total should equal the listed subtotal: %', inclusive_result;
  end if;
  if (inclusive_result->>'fees')::integer <> round((base + extras) * 18 / 118.0)::integer then
    raise exception 'inclusive tax was not extracted from the total: %', inclusive_result;
  end if;
  if (inclusive_result->>'taxable')::integer <> (inclusive_result->>'total')::integer - (inclusive_result->>'fees')::integer then
    raise exception 'inclusive taxable value was not net of tax: %', inclusive_result;
  end if;

  -- Extras can be excluded from the tax base independently.
  update public.settings set value = 'false' where key = 'tax_inclusive';
  update public.settings set value = 'false' where key = 'tax_on_extras';
  reduced_result := public.quote_rental(
    vehicle_id, current_date + 30, current_date + 32,
    array['gps']::text[], 'basic', null, 'Bengaluru', 'Bengaluru', 'full'
  );
  if (reduced_result->>'fees')::integer <> round(base * 18 / 100.0)::integer then
    raise exception 'tax on extras toggle did not shrink the tax base: %', reduced_result;
  end if;
  if (reduced_result->>'taxOnExtras')::boolean is not false then
    raise exception 'quote did not report the extras tax toggle: %', reduced_result;
  end if;
  if (reduced_result->>'untaxedTotal')::integer <> extras then
    raise exception 'untaxed extras should be charged but kept out of the tax base: %', reduced_result;
  end if;
  if (reduced_result->>'total')::integer <> base + extras + (reduced_result->>'fees')::integer then
    raise exception 'untaxed extras must still appear in the total: %', reduced_result;
  end if;

  update public.settings set value = 'true' where key = 'tax_on_extras';

  -- Protection can be excluded independently of the rental and extras.
  update public.settings set value = 'false' where key = 'tax_on_insurance';
  insurance_result := public.quote_rental(
    vehicle_id, current_date + 30, current_date + 32,
    array['gps']::text[], 'standard', null, 'Bengaluru', 'Bengaluru', 'full'
  );
  if (insurance_result->>'taxOnInsurance')::boolean is not false then
    raise exception 'quote did not report the insurance tax toggle: %', insurance_result;
  end if;
  if (insurance_result->>'fees')::integer <> round((base + extras) * 18 / 100.0)::integer then
    raise exception 'tax on insurance toggle did not shrink the tax base: %', insurance_result;
  end if;
  if (insurance_result->>'untaxedTotal')::integer <> (insurance_result->>'insuranceTotal')::integer then
    raise exception 'untaxed protection should be charged but kept out of the tax base: %', insurance_result;
  end if;
  if (insurance_result->>'total')::integer
    <> (insurance_result->>'taxable')::integer + (insurance_result->>'untaxedTotal')::integer
      + (insurance_result->>'fees')::integer then
    raise exception 'untaxed protection must still appear in the total: %', insurance_result;
  end if;

  -- One-way fees can be excluded independently as well.
  update public.settings set value = 'true' where key = 'tax_on_insurance';
  update public.settings set value = 'false' where key = 'tax_on_one_way';
  one_way_result := public.quote_rental(
    vehicle_id, current_date + 30, current_date + 32,
    array['gps']::text[], 'standard', null, 'Bengaluru', 'Mumbai', 'full'
  );
  if (one_way_result->>'taxOnOneWay')::boolean is not false then
    raise exception 'quote did not report the one-way tax toggle: %', one_way_result;
  end if;
  if (one_way_result->>'oneWayFee')::integer <= 0 then
    raise exception 'the one-way tax test needs a one-way fee: %', one_way_result;
  end if;
  if (one_way_result->>'fees')::integer
    <> round(((one_way_result->>'baseTotal')::integer
      + (one_way_result->>'extrasTotal')::integer
      + (one_way_result->>'insuranceTotal')::integer
      - (one_way_result->>'discount')::integer) * 18 / 100.0)::integer then
    raise exception 'tax on one-way toggle did not shrink the tax base: %', one_way_result;
  end if;
  if (one_way_result->>'untaxedTotal')::integer <> (one_way_result->>'oneWayFee')::integer then
    raise exception 'untaxed one-way fee should be charged but kept out of the tax base: %', one_way_result;
  end if;
  if (one_way_result->>'total')::integer
    <> (one_way_result->>'taxable')::integer + (one_way_result->>'untaxedTotal')::integer
      + (one_way_result->>'fees')::integer then
    raise exception 'untaxed one-way fee must still appear in the total: %', one_way_result;
  end if;

  update public.settings set value = 'true' where key = 'tax_on_one_way';
end $$;

do $$
declare
  booking_id uuid;
  result jsonb;
  payment_count integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'hold_amount'
  ) then
    raise exception 'bookings are missing the security deposit snapshot';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'completed_at'
  ) then
    raise exception 'bookings are missing the completed_at timestamp';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'taxable_amount'
  ) then
    raise exception 'bookings are missing the taxable amount snapshot';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'untaxed_total'
  ) then
    raise exception 'bookings are missing the untaxed total snapshot';
  end if;

  if exists (select 1 from public.payments where kind = 'hold') then
    raise exception 'simulated security deposit holds were not removed';
  end if;

  select id into booking_id
  from public.bookings
  where driver_email = 'finance@example.com'
  order by created_at desc
  limit 1;
  if booking_id is null then
    raise exception 'could not find the finance booking for the deposit test';
  end if;

  update public.bookings set hold_amount = 7500 where id = booking_id;
  insert into public.payments (booking_id, kind, amount, currency, status)
  values (booking_id, 'hold', 7500, 'INR', 'authorized');

  result := public.booking_json(booking_id);
  if (result->>'holdAmount')::integer <> 7500 then
    raise exception 'booking_json did not use the booking deposit snapshot: %', result->>'holdAmount';
  end if;
  if not (result ? 'completedAt') then
    raise exception 'booking_json is missing completedAt';
  end if;
  if not (result ? 'taxable') or not (result ? 'untaxedTotal') then
    raise exception 'booking_json is missing the taxable split';
  end if;
  if not (result ? 'creditDue') then
    raise exception 'booking_json is missing creditDue';
  end if;
  if (result->>'creditDue')::integer <> greatest(0,
       coalesce((select amount_paid from public.bookings where id = booking_id), 0)
       - coalesce((select total from public.bookings where id = booking_id), 0)) then
    raise exception 'booking_json creditDue does not match the overpayment: %', result->>'creditDue';
  end if;
  -- Customer reads must carry the same kilometre terms the checkout quoted.
  result := public.booking_json(booking_id);
  if (result->>'kmCap')::integer <> 300 or (result->>'kmExtraRate')::integer <> 10 then
    raise exception 'booking_json lost the vehicle kilometre terms: %', result;
  end if;
  if (result->'vehicle'->>'kmCap')::integer <> 300
     or (result->'vehicle'->>'kmExtraRate')::integer <> 10 then
    raise exception 'booking_json lost the customer-facing vehicle kilometre terms: %', result->'vehicle';
  end if;
  -- Repricing the vehicle must never rewrite an already-sold trip.
  update public.vehicles
     set km_cap = 150, km_extra_rate = 7
   where id = (select vehicle_id from public.bookings where id = booking_id);
  result := public.booking_json(booking_id);
  if (result->>'kmCap')::integer <> 300 or (result->>'kmExtraRate')::integer <> 10 then
    raise exception 'booking_json followed a later vehicle reprice instead of the sold terms: %', result;
  end if;
  -- An explicit booking snapshot still wins (admin correction / migration path).
  update public.bookings set km_cap = 150, km_extra_rate = 7 where id = booking_id;
  result := public.booking_json(booking_id);
  if (result->>'kmCap')::integer <> 150 or (result->>'kmExtraRate')::integer <> 7 then
    raise exception 'booking_json ignored the booking kilometre snapshot: %', result;
  end if;
  if (result->'vehicle'->>'kmCap')::integer <> 150
     or (result->'vehicle'->>'kmExtraRate')::integer <> 7 then
    raise exception 'booking_json did not merge the booking snapshot into the vehicle: %', result->'vehicle';
  end if;
  if result ? 'hasHold' then
    raise exception 'booking_json still exposes a card hold flag';
  end if;
  if exists (
    select 1 from jsonb_array_elements(result->'payments') payment
    where payment->>'kind' = 'hold'
  ) then
    raise exception 'booking_json leaked a simulated hold into the payment list';
  end if;

  -- Deposits collected at pick-up must flow through the same serializer.
  update public.bookings
     set deposit_collected = jsonb_build_object(
       'amount', 7500, 'method', 'upi', 'reference', 'tid-7f2c1', 'byName', 'Desk Ops'
     )
   where id = booking_id;
  result := public.booking_json(booking_id);
  if (result->'depositCollected'->>'amount')::integer <> 7500
     or result->'depositCollected'->>'method' <> 'upi'
     or result->'depositCollected'->>'reference' <> 'tid-7f2c1' then
    raise exception 'booking_json lost the recorded deposit collection: %', result->'depositCollected';
  end if;
  update public.bookings set deposit_collected = null where id = booking_id;

  -- The driver's licence expiry flows through the same serializer for the
  -- checkout promise → desk handover check.
  update public.bookings
     set driver_license_expiry = '2026-12-31'
   where id = booking_id;
  result := public.booking_json(booking_id);
  if result->'driver'->>'licenseExpiry' <> '2026-12-31' then
    raise exception 'booking_json lost the driver licence expiry: %', result->'driver';
  end if;
  update public.bookings set driver_license_expiry = null where id = booking_id;

  select count(*) into payment_count
  from jsonb_array_elements(result->'payments') payment;
  if payment_count <> 0 then
    raise exception 'the deposit test booking should have no captured payment rows, found %', payment_count;
  end if;

  delete from public.payments where kind = 'hold';
end $$;

-- ---------------------------------------------------------------------------
-- Trip extension: owner + staff paths, validation, repricing and history
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_other uuid;
  v_booking uuid;
  v_vehicle uuid;
  v_result jsonb;
  v_row public.bookings%rowtype;
  v_raise boolean;
begin
  select id into v_vehicle from picked;
  update public.vehicles set status = 'available' where id = v_vehicle;

  insert into auth.users (email) values ('extend@example.com') returning id into v_user;

  insert into public.bookings (
    vehicle_id, user_id, pickup_location, dropoff_location,
    start_date, end_date, days, fees, tax_rate, total, amount_paid,
    status, pickup_time, dropoff_time, deposit_due
  ) values (
    v_vehicle, v_user, 'Bengaluru', 'Bengaluru',
    current_date - 2, current_date + 1, 3, 180, 18, 3540, 3540,
    'active', '10:00', '10:00', 9999
  ) returning id into v_booking;

  perform set_config('app.test_uid', v_user::text, true);

  v_result := public.extend_booking_dropoff(v_booking, current_date + 2, '10:00');
  if (v_result->>'endDate')::date <> current_date + 2 then
    raise exception 'extension did not move the end date: %', v_result;
  end if;
  select * into v_row from public.bookings where id = v_booking;
  if v_row.end_date <> current_date + 2 then
    raise exception 'extension did not persist the new end date';
  end if;
  if v_row.days <> 4 then
    raise exception 'extension did not reprice the day count (got %)', v_row.days;
  end if;
  if v_row.total <= 3540 then
    raise exception 'extension did not add the extra day to the total';
  end if;
  if v_row.deposit_due <> 9999 then
    raise exception 'extension rewrote a deposit already collected at pick-up (got %)', v_row.deposit_due;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_row.trip_changes) entry
    where entry->>'type' = 'extension' and entry->>'to' = to_char(current_date + 2, 'YYYY-MM-DD')
  ) then
    raise exception 'extension did not write a trip-change log';
  end if;

  -- The new return must be strictly later than the booked one.
  v_raise := false;
  begin
    perform public.extend_booking_dropoff(v_booking, current_date + 2, '10:00');
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'extension accepted an unchanged return'; end if;

  -- A return in the past is rejected.
  v_raise := false;
  begin
    perform public.extend_booking_dropoff(v_booking, current_date - 1, '10:00');
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'extension accepted a past return'; end if;

  -- The total trip length stays within the configured cap.
  v_raise := false;
  begin
    perform public.extend_booking_dropoff(v_booking, current_date + 60, '10:00');
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'extension ignored the max rental cap'; end if;

  -- A non-owner caller is told the booking does not exist (no identity leak).
  insert into auth.users (email) values ('other@example.com') returning id into v_other;
  perform set_config('app.test_uid', v_other::text, true);
  v_raise := false;
  begin
    perform public.extend_booking_dropoff(v_booking, current_date + 3, '10:00');
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'extension leaked another customer booking'; end if;

  -- The feature toggle must block everyone when switched off.
  insert into public.settings (key, value) values ('extensions_enabled', 'false')
    on conflict (key) do update set value = excluded.value;
  perform set_config('app.test_uid', v_user::text, true);
  v_raise := false;
  begin
    perform public.extend_booking_dropoff(v_booking, current_date + 3, '10:00');
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'extension ran with the feature disabled'; end if;
  delete from public.settings where key = 'extensions_enabled';

  -- Only trips still out can be extended.
  update public.bookings set status = 'completed' where id = v_booking;
  v_raise := false;
  begin
    perform public.extend_booking_dropoff(v_booking, current_date + 3, '10:00');
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'extension accepted a completed trip'; end if;

  -- ---------------------------------------------------------------------------
  -- Return-due reminders: staff-only, overdue-only, once per day
  -- ---------------------------------------------------------------------------
  declare
    v_reminder uuid;
    v_staff uuid;
  begin
    insert into public.bookings (
      vehicle_id, user_id, pickup_location, dropoff_location,
      start_date, end_date, days, fees, tax_rate, total, amount_paid,
      status, pickup_time, dropoff_time
    ) values (
      v_vehicle, v_user, 'Bengaluru', 'Bengaluru',
      current_date - 6, current_date - 3, 3, 180, 18, 3540, 3540,
      'active', '10:00', '10:00'
    ) returning id into v_reminder;

    -- A customer (non-staff) cannot send reminders.
    perform set_config('app.test_uid', v_user::text, true);
    v_raise := false;
    begin
      perform public.send_return_reminder(v_reminder);
    exception when others then v_raise := true; end;
    if not v_raise then raise exception 'return reminder ran without staff access'; end if;

    insert into auth.users (email, raw_user_meta_data) values ('manager@example.com', '{"full_name":"Return Desk"}')
      returning id into v_staff;
    -- Role/status changes require an admin session (or the seed-time null
    -- session), so switch to the null session, promote, then act as the desk.
    perform set_config('app.test_uid', '', true);
    update public.profiles set role = 'manager', status = 'active' where id = v_staff;

    perform set_config('app.test_uid', v_staff::text, true);
    v_result := public.send_return_reminder(v_reminder);
    if (v_result->>'days')::integer <> 3 then
      raise exception 'return reminder did not report the late days: %', v_result;
    end if;
    if coalesce((select last_return_reminder_day from public.bookings where id = v_reminder), current_date) <> current_date then
      raise exception 'return reminder did not stamp the reminder day';
    end if;
    if not exists (
      select 1 from public.audit_logs where entity_id = (select code from public.bookings where id = v_reminder)
        and summary like 'Reminded the customer%'
    ) then
      raise exception 'return reminder did not leave an audit entry';
    end if;

    -- A second reminder on the same day is a no-op.
    v_raise := false;
    begin
      perform public.send_return_reminder(v_reminder);
    exception when others then v_raise := true; end;
    if not v_raise then raise exception 'return reminder ignored the once-per-day dedupe'; end if;

    perform set_config('app.test_uid', '', true);
    delete from public.bookings where id = v_reminder;
    delete from public.profiles where id = v_staff;
    delete from auth.users where id = v_staff;
  end;

  -- ---------------------------------------------------------------------------
  -- Pick-up reminders: confirmed bookings starting today or tomorrow
  -- ---------------------------------------------------------------------------
  declare
    v_pickup_uuid uuid;
    v_pickup_staff uuid;
  begin
    insert into public.bookings (
      vehicle_id, user_id, pickup_location, dropoff_location,
      start_date, end_date, days, fees, tax_rate, total, amount_paid,
      status, pickup_time, dropoff_time
    ) values (
      v_vehicle, v_user, 'Bengaluru', 'Bengaluru',
      current_date, current_date + 2, 2, 180, 18, 3540, 3540,
      'confirmed', '10:00', '10:00'
    ) returning id into v_pickup_uuid;

    -- A customer (non-staff) cannot send pick-up reminders.
    perform set_config('app.test_uid', v_user::text, true);
    v_raise := false;
    begin
      perform public.send_pickup_reminder(v_pickup_uuid);
    exception when others then v_raise := true; end;
    if not v_raise then raise exception 'pick-up reminder ran without staff access'; end if;

    insert into auth.users (email, raw_user_meta_data) values ('manager@example.com', '{"full_name":"Pick-up Desk"}')
      returning id into v_pickup_staff;
    perform set_config('app.test_uid', '', true);
    update public.profiles set role = 'manager', status = 'active' where id = v_pickup_staff;

    -- The booking starts tomorrow, so reminded equally by the today/tomorrow rule.
    update public.bookings set start_date = current_date + 1 where id = v_pickup_uuid;
    perform set_config('app.test_uid', v_pickup_staff::text, true);
    v_result := public.send_pickup_reminder(v_pickup_uuid);
    if (v_result->>'ok')::boolean <> true then
      raise exception 'pick-up reminder did not succeed: %', v_result;
    end if;
    if coalesce((select last_pickup_reminder_day from public.bookings where id = v_pickup_uuid), current_date) <> current_date then
      raise exception 'pick-up reminder did not stamp the reminder day';
    end if;
    if not exists (
      select 1 from public.audit_logs where entity_id = (select code from public.bookings where id = v_pickup_uuid)
        and summary like 'Sent the pick-up reminder%'
    ) then
      raise exception 'pick-up reminder did not leave an audit entry';
    end if;

    -- A booking starting in four days is out of the reminder window.
    update public.bookings set start_date = current_date + 4, end_date = current_date + 6 where id = v_pickup_uuid;
    v_raise := false;
    begin
      perform public.send_pickup_reminder(v_pickup_uuid);
    exception when others then v_raise := true; end;
    if not v_raise then raise exception 'pick-up reminder ignored the reminder window'; end if;

    -- The master switch stops all reminders regardless of the booking state.
    update public.bookings set start_date = current_date + 1, end_date = current_date + 3 where id = v_pickup_uuid;
    insert into public.settings (key, value) values ('operational_reminders', 'false')
      on conflict (key) do update set value = excluded.value;
    v_raise := false;
    begin
      perform public.send_pickup_reminder(v_pickup_uuid);
    exception when others then v_raise := true; end;
    if not v_raise then raise exception 'operational reminders toggle did not block the send'; end if;
    insert into public.settings (key, value) values ('operational_reminders', 'true')
      on conflict (key) do update set value = excluded.value;

    perform set_config('app.test_uid', '', true);
    delete from public.bookings where id = v_pickup_uuid;
    delete from public.profiles where id = v_pickup_staff;
    delete from auth.users where id = v_pickup_staff;
    delete from public.settings where key = 'operational_reminders';
  end;

  -- ---------------------------------------------------------------------------
  -- Notification preferences gate in-app alerts (email gate is in the dispatcher)
  -- ---------------------------------------------------------------------------
  update public.profiles
     set notification_prefs = '{"trip_updates":false}'::jsonb
   where id = v_user;
  insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
  values ('user', v_user, 'booking_active', 'Trip started', 'test', 'RV-NOTIF', '/confirmation/RV-NOTIF');
  insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
  values ('user', v_user, 'booking_confirmed', 'Booking confirmed', 'test', 'RV-NOTIF', '/confirmation/RV-NOTIF');
  if (select count(*) from public.notifications where user_id = v_user and kind in ('booking_active', 'booking_confirmed')) <> 1 then
    raise exception 'notification preferences did not gate in-app alerts by kind';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_user and kind = 'booking_confirmed') then
    raise exception 'an allowed notification kind was dropped by the preference gate';
  end if;
  delete from public.notifications where user_id = v_user;
  update public.profiles set notification_prefs = '{}'::jsonb where id = v_user;

  perform set_config('app.test_uid', '', true);
  delete from public.bookings where id = v_booking;
  delete from public.profiles where id in (v_user, v_other);
  delete from auth.users where id in (v_user, v_other);
end $$;

do $$
declare
  v_vehicle uuid;
  service_a uuid;
  service_b uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'odometer'
  ) then
    raise exception 'vehicles are missing the odometer column';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'last_service_date'
  ) then
    raise exception 'vehicles are missing the service baseline';
  end if;
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'vehicle_service_logs'
  ) then
    raise exception 'vehicle service log table is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vehicle_service_logs'
      and policyname = 'vehicle_service_logs_staff_insert'
  ) then
    raise exception 'service log staff insert policy is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vehicle_service_logs'
      and policyname = 'vehicle_service_logs_admin_delete'
  ) then
    raise exception 'service log admin delete policy is missing';
  end if;

  select id into v_vehicle from picked;
  update public.vehicles
    set odometer = 50000, last_service_date = null, last_service_odometer = null
    where id = v_vehicle;

  insert into public.vehicle_service_logs
    (vehicle_id, service_date, odometer, kind, cost, vendor, notes)
  values
    (v_vehicle, current_date - 10, 50400, 'service', 3200, 'Migration Workshop', 'Baseline service')
  returning id into service_a;

  if not exists (
    select 1 from public.vehicles
    where id = v_vehicle and odometer = 50400
      and last_service_date = current_date - 10 and last_service_odometer = 50400
  ) then
    raise exception 'a resetting service did not move the vehicle baseline';
  end if;

  insert into public.vehicle_service_logs
    (vehicle_id, service_date, odometer, kind, cost, resets_service)
  values
    (v_vehicle, current_date - 5, 50500, 'repair', 900, false);

  if not exists (
    select 1 from public.vehicles
    where id = v_vehicle and odometer = 50500
      and last_service_odometer = 50400
  ) then
    raise exception 'a repair should move the odometer without resetting the service baseline';
  end if;

  insert into public.vehicle_service_logs
    (vehicle_id, service_date, odometer, kind, cost)
  values
    (v_vehicle, current_date - 2, 50600, 'inspection', 1500)
  returning id into service_b;

  if (select last_service_odometer from public.vehicles where id = v_vehicle) <> 50600 then
    raise exception 'the latest resetting service should own the baseline';
  end if;

  delete from public.vehicle_service_logs where id = service_b;
  if (select last_service_odometer from public.vehicles where id = v_vehicle) <> 50400 then
    raise exception 'deleting the latest service should restore the previous baseline';
  end if;

  begin
    insert into public.vehicle_service_logs
      (vehicle_id, service_date, odometer, kind, cost)
    values
      (v_vehicle, current_date + 1, 50700, 'service', 1000);
    raise exception 'a future service entry unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%future%' then
      raise;
    end if;
  end;

  begin
    insert into public.vehicle_service_logs
      (vehicle_id, service_date, odometer, kind, cost)
    values
      (v_vehicle, current_date, 50300, 'service', 1000);
    raise exception 'a backwards odometer unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%lower than the current reading%' then
      raise;
    end if;
  end;

  if not exists (
    select 1 from public.audit_logs
    where entity_type = 'vehicle_service_logs' and action = 'insert'
  ) then
    raise exception 'service log writes were not audited';
  end if;

  begin
    update public.vehicles set odometer = 100 where id = v_vehicle;
    raise exception 'a backwards vehicle odometer unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%cannot be lower than the current reading%' then
      raise;
    end if;
  end;

  delete from public.vehicle_service_logs where vehicle_id = v_vehicle;
end $$;

-- ---------------------------------------------------------------------------
-- Email outbox resend: staff-only, pref-aware, never rewrites history
-- ---------------------------------------------------------------------------
do $$
declare
  v_staff uuid;
  v_customer uuid;
  v_source public.notification_log;
  v_copy public.notification_log;
  v_raise boolean;
begin
  if not has_function_privilege('authenticated', 'public.resend_notification(uuid)', 'execute') then
    raise exception 'authenticated cannot resend an email';
  end if;
  if has_function_privilege('anon', 'public.resend_notification(uuid)', 'execute') then
    raise exception 'anon can call the resend RPC';
  end if;

  insert into auth.users (email) values ('outbox-customer@example.com') returning id into v_customer;
  insert into auth.users (email, raw_user_meta_data) values ('outbox-staff@example.com', '{"full_name":"Outbox Staff"}')
    returning id into v_staff;
  perform set_config('app.test_uid', '', true);
  update public.profiles set role = 'manager', status = 'active' where id = v_staff;

  insert into public.notification_log (kind, channel, recipient, subject, body, meta, status)
  values (
    'booking_confirmed', 'email', 'outbox-customer@example.com',
    'Your booking', 'Hi there', '{"code":"RV-OUTBOX"}'::jsonb, 'sent'
  ) returning * into v_source;

  -- A customer may not resend, even for their own address.
  perform set_config('app.test_uid', v_customer::text, true);
  v_raise := false;
  begin
    perform public.resend_notification(v_source.id);
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'a customer could resend an email'; end if;

  -- Staff can: a fresh queued row, original untouched.
  perform set_config('app.test_uid', v_staff::text, true);
  v_copy := public.resend_notification(v_source.id);
  if v_copy.id = v_source.id or v_copy.status <> 'queued' then
    raise exception 'resend did not create a fresh queued row: %', v_copy;
  end if;
  if (v_copy.meta->>'resentFrom')::uuid <> v_source.id then
    raise exception 'resend lost the source reference: %', v_copy.meta;
  end if;
  if v_copy.body <> v_source.body or v_copy.subject <> v_source.subject then
    raise exception 'resend changed the rendered message';
  end if;
  if (select status from public.notification_log where id = v_source.id) <> 'sent' then
    raise exception 'resend rewrote the original delivery history';
  end if;

  -- Opted-out customers are refused, not silently queued.
  insert into public.notification_log (kind, channel, recipient, subject, body, status)
  values ('return-due-reminder', 'email', 'outbox-customer@example.com', 'Return due', 'Hi', 'sent')
  returning * into v_source;
  update public.profiles set notification_prefs = '{"trip_updates":false}'::jsonb where id = v_customer;
  v_raise := false;
  begin
    perform public.resend_notification(v_source.id);
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'resend ignored the customer opt-out'; end if;
  update public.profiles set notification_prefs = '{}'::jsonb where id = v_customer;

  -- Only email rows are resendable.
  insert into public.notification_log (kind, channel, recipient, subject, body, status)
  values ('customer_message', 'log', '', 'Note', 'Hi', 'sent')
  returning * into v_source;
  v_raise := false;
  begin
    perform public.resend_notification(v_source.id);
  exception when others then v_raise := true; end;
  if not v_raise then raise exception 'resend accepted a non-email channel'; end if;

  perform set_config('app.test_uid', '', true);
  delete from public.notification_log where recipient in ('outbox-customer@example.com', '');
  delete from public.profiles where id in (v_staff, v_customer);
  delete from auth.users where id in (v_staff, v_customer);
end $$;

-- Hub coordinates are optional: "not mapped" must be NULL, never the 0,0
-- sentinel that the old schema defaulted to (a real point in the Gulf of
-- Guinea). Guard the column contract and the insert path.
do $$
declare
  v_nullable text;
  v_id uuid;
begin
  select is_nullable into v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'locations' and column_name = 'lat';
  if v_nullable is distinct from 'YES' then
    raise exception 'locations.lat must be nullable for un-mapped hubs';
  end if;
  select is_nullable into v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'locations' and column_name = 'lng';
  if v_nullable is distinct from 'YES' then
    raise exception 'locations.lng must be nullable for un-mapped hubs';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'locations'
       and column_name in ('lat', 'lng') and column_default is not null
  ) then
    raise exception 'locations coordinates must not default to 0';
  end if;

  insert into public.locations (name) values ('SQL Coordinate Probe') returning id into v_id;
  if (select lat from public.locations where id = v_id) is not null then
    raise exception 'a hub without coordinates stored a latitude';
  end if;
  if (select lng from public.locations where id = v_id) is not null then
    raise exception 'a hub without coordinates stored a longitude';
  end if;
  delete from public.locations where id = v_id;
end $$;
SQL

echo "SQL migration validation passed."
