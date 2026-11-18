-- 202610220009_availability_alert_dispatch.sql
-- Waitlist alerts can be matched and notified by staff (and by the notify
-- dispatcher) without weakening the owner-scoped read/write rules.

alter table public.availability_alerts
  add column if not exists matched_at timestamptz,
  add column if not exists match_reason text,
  add column if not exists match_vehicle_name text;

comment on column public.availability_alerts.matched_at
  is 'When staff (or the dispatcher) told the customer their window opened.';
comment on column public.availability_alerts.match_reason
  is 'Why the window opened: booking cancelled, dates changed, block released, manual.';
comment on column public.availability_alerts.match_vehicle_name
  is 'Vehicle name snapshot for the customer notification and admin audit trail.';

create index if not exists availability_alerts_window_idx
  on public.availability_alerts (vehicle_id, start_date, end_date)
  where active;

drop policy if exists availability_alerts_staff_update on public.availability_alerts;
create policy availability_alerts_staff_update on public.availability_alerts
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());
