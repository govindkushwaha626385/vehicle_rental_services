-- 202610220008_returns_deposit_settlement.sql
-- Drop-off inspection and deposit settlement kept on the booking itself.

alter table public.bookings
  add column if not exists return_checks jsonb not null default '{}'::jsonb,
  add column if not exists inspection jsonb,
  add column if not exists deposit_settlement jsonb;

comment on column public.bookings.return_checks
  is 'Return checklist state (keys/fuel/condition/cleaning/deposit) confirmed by staff at drop-off.';
comment on column public.bookings.inspection
  is 'Drop-off inspection: fuel level, damage severity/amount, cleaning fee, late-fee policy and staff note.';
comment on column public.bookings.deposit_settlement
  is 'Immutable deposit settlement: deposit held, charges, refund due, extra due and status.';

create index if not exists bookings_active_end_date_idx
  on public.bookings (end_date)
  where status = 'active';

-- Keep the single booking serializer authoritative for every new field.
create or replace function public.booking_json(p_booking_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.booking_json_base(p_booking_id) || jsonb_build_object(
    'changeRequest', (select b.change_request from public.bookings b where b.id = p_booking_id),
    'tripChanges', (select coalesce(b.trip_changes, '[]'::jsonb) from public.bookings b where b.id = p_booking_id),
    'deskChecks', (select coalesce(b.desk_checks, '{}'::jsonb) from public.bookings b where b.id = p_booking_id),
    'returnChecks', (select coalesce(b.return_checks, '{}'::jsonb) from public.bookings b where b.id = p_booking_id),
    'inspection', (select b.inspection from public.bookings b where b.id = p_booking_id),
    'depositSettlement', (select b.deposit_settlement from public.bookings b where b.id = p_booking_id)
  );
$$;

grant execute on function public.booking_json(uuid) to authenticated;
