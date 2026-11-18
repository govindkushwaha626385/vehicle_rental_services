-- 202610290004_send_pickup_reminder.sql
--
-- Staff-sent "your pick-up is coming" reminders.
--
-- The pick-up desk already groups confirmed commitments by date; this adds the
-- pre-trip nudge a customer actually needs ("tomorrow, bring your licence,
-- your ID and the deposit"). Mirrors the return reminder exactly: one per
-- calendar day per booking so the desk cannot spam someone arriving in a few
-- hours. The email and in-app note link to Manage Booking.

alter table public.bookings
  add column if not exists last_pickup_reminder_day date;

create or replace function public.send_pickup_reminder(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_actor_name text;
  v_deposit text;
begin
  if not public.is_staff() then
    raise exception 'This area is for Rove staff only.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'Only a confirmed pick-up can be reminded.';
  end if;
  if v_booking.start_date not in (current_date, current_date + 1) then
    raise exception 'Pick-up reminders are for pick-ups today or tomorrow.';
  end if;
  if v_booking.last_pickup_reminder_day = current_date then
    raise exception 'This customer was already reminded today.';
  end if;

  select coalesce(p.full_name, 'Rove staff') into v_actor_name
  from public.profiles p where p.id = auth.uid();

  update public.bookings
  set last_pickup_reminder_day = current_date
  where id = v_booking.id;

  select '₹' || coalesce(
    (select value::integer from public.settings where key = 'hold_amount'),
    5000
  )::text into v_deposit;

  if v_booking.user_id is not null then
    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'pickup_reminder', 'Pick-up tomorrow',
            v_booking.code || ' · collect your vehicle ' || v_booking.start_date
            || ' at ' || coalesce(v_booking.pickup_time, '10:00')
            || ' from ' || v_booking.pickup_location
            || '. Bring your licence and government ID; the ' || v_deposit
            || ' deposit is collected at pick-up.',
            v_booking.code, '/manage?code=' || v_booking.code);
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_actor_name, 'manager', 'update', 'bookings', v_booking.code,
          'Sent the pick-up reminder for ' || v_booking.code,
          jsonb_build_object('change', 'pickupReminder'));

  return jsonb_build_object('ok', true, 'remindedAt', now());
end;
$$;

revoke all on function public.send_pickup_reminder(uuid) from public, anon;
grant execute on function public.send_pickup_reminder(uuid) to authenticated;