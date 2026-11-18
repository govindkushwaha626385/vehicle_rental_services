-- 202610210001_vehicle_blocks_audit_logs.sql
-- Admin-controlled availability blocks and an immutable staff audit trail.
--
-- Vehicle blocks are deliberately separate from bookings: they can represent
-- scheduled servicing, private use, photography or a turnaround buffer. Both
-- the quote engine and the public availability RPC treat them exactly like a
-- booking conflict, so a blocked vehicle can never be booked through a stale
-- tab or a crafted API request.

-- ---------------------------------------------------------------------------
-- 1. Vehicle blocks
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_blocks (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  kind        text not null default 'maintenance'
              check (kind in ('maintenance','private','buffer','other')),
  reason      text not null default '',
  notes       text not null default '',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vehicle_blocks_dates_valid check (end_date > start_date)
);

create index if not exists vehicle_blocks_vehicle_dates_idx
  on public.vehicle_blocks (vehicle_id, start_date, end_date);

create index if not exists vehicle_blocks_dates_idx
  on public.vehicle_blocks (start_date, end_date);

alter table public.vehicle_blocks enable row level security;

drop policy if exists vehicle_blocks_staff_read on public.vehicle_blocks;
create policy vehicle_blocks_staff_read on public.vehicle_blocks
  for select to authenticated
  using (public.is_staff());

drop policy if exists vehicle_blocks_staff_insert on public.vehicle_blocks;
create policy vehicle_blocks_staff_insert on public.vehicle_blocks
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists vehicle_blocks_staff_update on public.vehicle_blocks;
create policy vehicle_blocks_staff_update on public.vehicle_blocks
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists vehicle_blocks_staff_delete on public.vehicle_blocks;
create policy vehicle_blocks_staff_delete on public.vehicle_blocks
  for delete to authenticated
  using (public.is_staff());

drop trigger if exists vehicle_blocks_updated_at on public.vehicle_blocks;
create trigger vehicle_blocks_updated_at
  before update on public.vehicle_blocks
  for each row execute function public.set_updated_at();

-- Blocks cannot overlap another block for the same vehicle.
create or replace function public.guard_vehicle_block_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.vehicle_blocks b
    where b.vehicle_id = new.vehicle_id
      and b.id <> new.id
      and b.start_date < new.end_date
      and b.end_date > new.start_date
  ) then
    raise exception 'This vehicle already has a block that overlaps those dates.';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_blocks_no_overlap on public.vehicle_blocks;
create trigger vehicle_blocks_no_overlap
  before insert or update of vehicle_id, start_date, end_date on public.vehicle_blocks
  for each row execute function public.guard_vehicle_block_overlap();

-- The trigger gives staff a friendly error. The exclusion constraint is the
-- concurrency-safe guarantee if two admins save overlapping blocks at once.
alter table public.vehicle_blocks drop constraint if exists vehicle_blocks_no_overlap_range;
alter table public.vehicle_blocks
  add constraint vehicle_blocks_no_overlap_range
  exclude using gist (
    vehicle_id with =,
    daterange(start_date, end_date, '[)') with &&
  );

-- A block must not silently strand an active booking. Staff should move or
-- cancel the booking first, so the customer still gets a clear message.
create or replace function public.guard_vehicle_block_booking_conflict()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.bookings b
    where b.vehicle_id = new.vehicle_id
      and b.status in ('pending','confirmed','active')
      and b.start_date < new.end_date
      and b.end_date > new.start_date
  ) then
    raise exception 'Those dates overlap an active booking. Move or cancel the booking first.';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_blocks_booking_conflict on public.vehicle_blocks;
create trigger vehicle_blocks_booking_conflict
  before insert or update of vehicle_id, start_date, end_date on public.vehicle_blocks
  for each row execute function public.guard_vehicle_block_booking_conflict();

-- Bookings cannot be inserted or moved into a blocked range. This is the final
-- server-side guard, independent of the quote result shown in the browser.
create or replace function public.guard_booking_vehicle_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('pending','confirmed','active') and exists (
    select 1
    from public.vehicle_blocks b
    where b.vehicle_id = new.vehicle_id
      and b.start_date < new.end_date
      and b.end_date > new.start_date
  ) then
    raise exception 'Those dates are blocked for this vehicle. Choose different dates or another vehicle.';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_no_vehicle_block on public.bookings;
create trigger bookings_no_vehicle_block
  before insert or update of vehicle_id, start_date, end_date, status on public.bookings
  for each row execute function public.guard_booking_vehicle_block();

-- Public availability must include blocks, not just bookings.
create or replace function public.unavailable_vehicle_ids(p_start_date date, p_end_date date)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct vehicle_id), '{}'::uuid[])
  from (
    select b.vehicle_id
    from public.bookings b
    where b.status in ('pending','confirmed','active')
      and b.start_date < p_end_date
      and b.end_date > p_start_date
    union
    select vb.vehicle_id
    from public.vehicle_blocks vb
    where vb.start_date < p_end_date
      and vb.end_date > p_start_date
  ) blocked;
$$;

-- ---------------------------------------------------------------------------
-- 2. Quote integration
-- ---------------------------------------------------------------------------
-- Keep the existing pricing rules exactly as they are, but route every quote
-- through a small wrapper that can add block conflicts. The original function
-- is renamed once; re-running this migration is safe.
do $$
begin
  if to_regprocedure('public.quote_rental_core(uuid,date,date,text[],text,text,text,text,text,uuid)') is null
     and to_regprocedure('public.quote_rental(uuid,date,date,text[],text,text,text,text,text,uuid)') is not null then
    alter function public.quote_rental(uuid,date,date,text[],text,text,text,text,text,uuid)
      rename to quote_rental_core;
  end if;
end $$;

-- Renaming a function keeps its ACL. The original quote_rental was callable by
-- anon and authenticated, so revoke those grants explicitly or a crafted RPC
-- call could skip the block-aware wrapper below.
revoke all on function public.quote_rental_core(uuid,date,date,text[],text,text,text,text,text,uuid)
  from public, anon, authenticated;

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
  v_result jsonb;
  v_block public.vehicle_blocks%rowtype;
  v_reason text;
begin
  select * into v_block
  from public.vehicle_blocks vb
  where vb.vehicle_id = p_vehicle_id
    and vb.start_date < p_end_date
    and vb.end_date > p_start_date
  order by vb.start_date
  limit 1;

  v_result := public.quote_rental_core(
    p_vehicle_id, p_start_date, p_end_date, p_extras, p_insurance,
    p_promo_code, p_pickup_location, p_dropoff_location, p_payment_plan,
    p_exclude_booking_id
  );

  if v_block.id is not null then
    v_reason := case v_block.kind
      when 'maintenance' then 'This vehicle is scheduled for maintenance during those dates.'
      when 'private' then 'This vehicle is reserved for an internal booking during those dates.'
      when 'buffer' then 'This vehicle needs a turnaround buffer between rentals.'
      else 'This vehicle is unavailable for those dates.'
    end;
    v_result := jsonb_set(v_result, '{available}', 'false'::jsonb, true);
    v_result := jsonb_set(v_result, '{unavailableReason}', to_jsonb(v_reason), true);
  end if;

  return v_result;
end;
$$;

grant execute on function public.quote_rental(uuid,date,date,text[],text,text,text,text,text,uuid) to anon, authenticated;
grant execute on function public.unavailable_vehicle_ids(date,date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Immutable audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text not null default 'System',
  actor_role  text not null default 'system',
  action      text not null,
  entity_type text not null,
  entity_id   text not null default '',
  summary     text not null default '',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, created_at desc);

create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_id, created_at desc);

alter table public.audit_logs enable row level security;

-- Audit history is super-admin only, and read-only from the API. There are no
-- insert/update/delete policies: the security-definer trigger writes entries.
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated
  using (public.is_admin());

create or replace function public.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text := 'System';
  v_actor_role text := 'system';
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_entity_id text;
  v_changed jsonb := '{}'::jsonb;
  v_summary text;
begin
  if v_actor is not null then
    select coalesce(nullif(full_name, ''), email, 'Staff'), role
      into v_actor_name, v_actor_role
    from public.profiles
    where id = v_actor;
  end if;

  if tg_table_name = 'bookings' then
    v_entity_id := coalesce(v_new->>'code', v_old->>'code', '');
  elsif tg_table_name = 'settings' then
    v_entity_id := coalesce(v_new->>'key', v_old->>'key', '');
  else
    v_entity_id := coalesce(v_new->>'id', v_old->>'id', v_new->>'key', v_old->>'key', '');
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(
      jsonb_object_agg(key, jsonb_build_object('from', v_old->key, 'to', v_new->key)),
      '{}'::jsonb
    )
    into v_changed
    from jsonb_object_keys(v_new) key
    where key <> 'updated_at'
      and (v_old->key) is distinct from (v_new->key);
  end if;

  v_summary := initcap(replace(tg_table_name, '_', ' ')) || ' ' || lower(tg_op)
    || case when v_entity_id <> '' then ' · ' || v_entity_id else '' end;

  insert into public.audit_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata
  ) values (
    v_actor, v_actor_name, v_actor_role, lower(tg_op), tg_table_name, v_entity_id,
    v_summary, jsonb_build_object('changed', v_changed)
  );

  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'vehicles',
    'locations',
    'insurance_tiers',
    'extras',
    'promos',
    'settings',
    'bookings',
    'payments',
    'reviews',
    'contact_messages',
    'vehicle_blocks'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || table_name, table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_table_change()',
      'audit_' || table_name,
      table_name
    );
  end loop;
end $$;

grant select on public.audit_logs to authenticated;
grant select, insert, update, delete on public.vehicle_blocks to authenticated;
