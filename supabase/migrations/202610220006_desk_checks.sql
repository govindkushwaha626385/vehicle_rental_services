-- 202610220006_desk_checks.sql
-- Handover desk: per-booking checklist state kept by the ops team.

alter table public.bookings
  add column desk_checks jsonb not null default '{}'::jsonb;

comment on column public.bookings.desk_checks
  is 'Handover checklist state (licence/age/insurance/payment/deposit) confirmed by staff at pick-up.';

-- Re-wrap the booking serializer so the desk page can read the checklist
-- through the same booking_json consumers (the wrapper was introduced in
-- 202610220005; this just adds the new field alongside the existing ones).
create or replace function public.booking_json(p_booking_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.booking_json_base(p_booking_id) || jsonb_build_object(
    'changeRequest', (select b.change_request from public.bookings b where b.id = p_booking_id),
    'tripChanges', (select coalesce(b.trip_changes, '[]'::jsonb) from public.bookings b where b.id = p_booking_id),
    'deskChecks', (select coalesce(b.desk_checks, '{}'::jsonb) from public.bookings b where b.id = p_booking_id)
  );
$$;

grant execute on function public.booking_json(uuid) to authenticated;