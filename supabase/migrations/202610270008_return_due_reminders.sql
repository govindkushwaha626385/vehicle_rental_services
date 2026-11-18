-- 202610270008_return_due_reminders.sql
--
-- Staff-sent "your return was due" reminders.
--
-- The returns desk already groups overdue trips; this adds the nudge. One
-- reminder per calendar day per booking (tracked on the row) so rehearsing
-- the overdue list cannot spam a customer. The reminder email links to the
-- Manage Booking page, where the same customer can extend the return in a
-- tap — closing the loop that this whole extension feature exists for.

alter table public.bookings
  add column if not exists last_return_reminder_day date;

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

revoke all on function public.send_return_reminder(uuid) from public, anon;
grant execute on function public.send_return_reminder(uuid) to authenticated;