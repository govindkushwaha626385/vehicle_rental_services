-- 202610220011_booking_serializer_lockdown.sql
-- `booking_json` is an internal serializer that returns guest contact details,
-- driver licence/DOB, payments and notes. It must only be reachable through the
-- checked readers (`get_booking`, `my_bookings`, `admin_bookings`), never
-- directly from the anon/authenticated PostgREST roles.
--
-- Migration 202610220006 and 202610220008 re-granted it while adding new
-- fields. This closes that hole without changing the readers.

revoke all on function public.booking_json(uuid) from public, anon, authenticated;
revoke all on function public.booking_json_base(uuid) from public, anon, authenticated;

-- Keep the access-controlled entry points working. These functions are
-- security-definer and own the internal serializer call.
grant execute on function public.get_booking(text, text) to anon, authenticated;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.admin_bookings() to authenticated;

comment on function public.booking_json(uuid)
  is 'Internal booking serializer. Execute is restricted to the security-definer readers.';
