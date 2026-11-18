-- 202610220007_availability_alerts.sql
-- "Notify me when it's free" watchlist, owned by the customer.

create table if not exists public.availability_alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  active      boolean not null default true,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint availability_alerts_dates check (end_date > start_date)
);

create index if not exists availability_alerts_user_idx
  on public.availability_alerts (user_id, created_at desc);

create index if not exists availability_alerts_vehicle_idx
  on public.availability_alerts (vehicle_id);

alter table public.availability_alerts enable row level security;

drop policy if exists availability_alerts_owner_all on public.availability_alerts;
create policy availability_alerts_owner_all on public.availability_alerts
  for all to authenticated
  using (user_id = auth.uid());

drop policy if exists availability_alerts_staff_read on public.availability_alerts;
create policy availability_alerts_staff_read on public.availability_alerts
  for select to authenticated
  using (public.is_staff());