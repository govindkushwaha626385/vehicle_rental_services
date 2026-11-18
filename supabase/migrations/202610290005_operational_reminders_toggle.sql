-- 202610290005_operational_reminders_toggle.sql
--
-- Master switch for staff-sent operational reminders.
--
-- Settings → "Operational reminders" (default on) lets an operator stop all
-- pick-up and return nudges at once. The guard lives in the RPCs so a switch
-- flipped mid-shift cannot be bypassed by any client; combined with the desk
-- hiding the buttons, off means no customer email or in-app notice is sent.

create or replace function public.send_return_reminder(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_actor_name text;
  v_days integer;
begin
  if not public.is_staff() then
    raise exception 'This area is for Rove staff only.';
  end if;

  if coalesce((select value from public.settings where key = 'operational_reminders'), 'true') = 'false' then
    raise exception 'Reminders are switched off — enable them in Admin → Settings.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;
  if v_booking.status <> 'active' then
    raise exception 'Only a trip still out can be reminded.';
  end if;

  v_days := greatest(0, current_date - v_booking.end_date);
  if v_days <= 0 then
    raise exception 'No reminder needed — this trip is not overdue yet.';
  end if;
  if v_booking.last_return_reminder_day = current_date then
    raise exception 'This customer was already reminded today.';
  end if;

  select coalesce(p.full_name, 'Rove staff') into v_actor_name
  from public.profiles p where p.id = auth.uid();

  update public.bookings
  set last_return_reminder_day = current_date
  where id = v_booking.id;

  if v_booking.user_id is not null then
    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'return_due_reminder', 'Return was due',
            'Your ' || v_booking.code || ' return was due ' || v_booking.end_date
            || '. If you need more time, extend it from Manage Booking.',
            v_booking.code, '/manage?code=' || v_booking.code);
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_actor_name, 'manager', 'update', 'bookings', v_booking.code,
          'Reminded the customer that ' || v_booking.code || ' is ' || v_days || ' day'
          || case when v_days = 1 then '' else 's' end || ' late',
          jsonb_build_object('change', 'returnReminder', 'days', v_days));

  return jsonb_build_object('ok', true, 'days', v_days, 'remindedAt', now());
end;
$$;

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

  if coalesce((select value from public.settings where key = 'operational_reminders'), 'true') = 'false' then
    raise exception 'Reminders are switched off — enable them in Admin → Settings.';
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

revoke all on function public.send_return_reminder(uuid) from public, anon;
revoke all on function public.send_pickup_reminder(uuid) from public, anon;
grant execute on function public.send_return_reminder(uuid) to authenticated;
grant execute on function public.send_pickup_reminder(uuid) to authenticated;