-- 202610220010_fleet_maintenance.sql
-- Fleet maintenance: odometer, service baselines, service intervals and an
-- immutable workshop history. Workshop downtime stays in vehicle_blocks so
-- the availability calendar remains the single source of truth for dates a
-- vehicle cannot be rented.
--
-- Service logs are staff-only. A trigger keeps the vehicle's odometer and
-- last-service baseline in lockstep with the history, and the standard audit
-- trigger records every insert/update/delete for the Audit log page.

-- ---------------------------------------------------------------------------
-- 1. Service baseline on every vehicle
-- ---------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists odometer integer,
  add column if not exists service_interval_km integer not null default 10000,
  add column if not exists service_interval_days integer not null default 180,
  add column if not exists last_service_date date,
  add column if not exists last_service_odometer integer;

create index if not exists vehicles_service_baseline_idx
  on public.vehicles (last_service_date, service_interval_days);

create or replace function public.guard_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.odometer is not null and (new.odometer is null or new.odometer < old.odometer) then
    raise exception 'Odometer cannot be lower than the current reading (% km).', old.odometer;
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_guard_odometer on public.vehicles;
create trigger vehicles_guard_odometer before update of odometer on public.vehicles
  for each row execute function public.guard_vehicle_odometer();

-- ---------------------------------------------------------------------------
-- 2. Workshop history
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_service_logs (
  id                 uuid primary key default gen_random_uuid(),
  vehicle_id         uuid not null references public.vehicles(id) on delete cascade,
  service_date       date not null,
  odometer           integer not null check (odometer >= 0),
  kind               text not null default 'service'
                       check (kind in ('service', 'inspection', 'tyre', 'repair', 'bodywork')),
  cost               integer not null default 0 check (cost >= 0),
  vendor             text not null default '',
  reference          text not null default '',
  notes              text not null default '',
  resets_service     boolean not null default true,
  created_by         uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists vehicle_service_logs_vehicle_idx
  on public.vehicle_service_logs (vehicle_id, service_date desc, created_at desc);

create index if not exists vehicle_service_logs_date_idx
  on public.vehicle_service_logs (service_date desc);

drop trigger if exists vehicle_service_logs_updated_at on public.vehicle_service_logs;
create trigger vehicle_service_logs_updated_at before update on public.vehicle_service_logs
  for each row execute function public.set_updated_at();

alter table public.vehicle_service_logs enable row level security;

drop policy if exists vehicle_service_logs_staff_read on public.vehicle_service_logs;
create policy vehicle_service_logs_staff_read on public.vehicle_service_logs
  for select to authenticated
  using (public.is_staff());

drop policy if exists vehicle_service_logs_staff_insert on public.vehicle_service_logs;
create policy vehicle_service_logs_staff_insert on public.vehicle_service_logs
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists vehicle_service_logs_staff_update on public.vehicle_service_logs;
create policy vehicle_service_logs_staff_update on public.vehicle_service_logs
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Removing a work order changes the service baseline, so it is admin-only.
drop policy if exists vehicle_service_logs_admin_delete on public.vehicle_service_logs;
create policy vehicle_service_logs_admin_delete on public.vehicle_service_logs
  for delete to authenticated
  using (public.is_admin());

grant select, insert, update on public.vehicle_service_logs to authenticated;
grant delete on public.vehicle_service_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Keep the vehicle row in lockstep with its history
-- ---------------------------------------------------------------------------
create or replace function public.validate_vehicle_service_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_odometer integer;
begin
  if new.service_date > current_date then
    raise exception 'Service date cannot be in the future.';
  end if;
  select odometer into v_odometer from public.vehicles where id = new.vehicle_id;
  if not found then
    raise exception 'Vehicle not found.';
  end if;
  if v_odometer is not null and new.odometer < v_odometer then
    raise exception 'Odometer cannot be lower than the current reading (% km).', v_odometer;
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_service_logs_validate on public.vehicle_service_logs;
create trigger vehicle_service_logs_validate before insert or update on public.vehicle_service_logs
  for each row execute function public.validate_vehicle_service_log();

create or replace function public.sync_vehicle_service_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_latest record;
  v_should_recompute boolean := false;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.vehicle_id];
    update public.vehicles
      set odometer = greatest(coalesce(odometer, 0), new.odometer)
      where id = new.vehicle_id;
    if new.resets_service then
      update public.vehicles
        set last_service_date = new.service_date,
            last_service_odometer = new.odometer
        where id = new.vehicle_id
          and (last_service_date is null or new.service_date >= last_service_date);
    end if;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_ids := array[old.vehicle_id, new.vehicle_id];
    v_should_recompute := old.resets_service or new.resets_service;
    update public.vehicles
      set odometer = greatest(coalesce(odometer, 0), new.odometer)
      where id = new.vehicle_id;
  else
    v_ids := array[old.vehicle_id];
    v_should_recompute := old.resets_service;
  end if;

  if not v_should_recompute then
    return null;
  end if;

  foreach v_id in array v_ids loop
    select l.service_date, l.odometer
      into v_latest
      from public.vehicle_service_logs l
      where l.vehicle_id = v_id and l.resets_service
      order by l.service_date desc, l.odometer desc
      limit 1;

    if found then
      update public.vehicles
        set last_service_date = v_latest.service_date,
            last_service_odometer = v_latest.odometer
        where id = v_id;
    else
      update public.vehicles
        set last_service_date = null,
            last_service_odometer = null
        where id = v_id;
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists vehicle_service_logs_sync on public.vehicle_service_logs;
create trigger vehicle_service_logs_sync
  after insert or update or delete on public.vehicle_service_logs
  for each row execute function public.sync_vehicle_service_baseline();

-- ---------------------------------------------------------------------------
-- 4. Audit history
-- ---------------------------------------------------------------------------
drop trigger if exists audit_vehicle_service_logs on public.vehicle_service_logs;
create trigger audit_vehicle_service_logs
  after insert or update or delete on public.vehicle_service_logs
  for each row execute function public.audit_table_change();

comment on table public.vehicle_service_logs is
  'Workshop history for a vehicle. Resetting logs move the service baseline; repairs and bodywork do not.';
comment on column public.vehicles.odometer is
  'Latest confirmed odometer reading in kilometres. Never decreased by the service log trigger.';
