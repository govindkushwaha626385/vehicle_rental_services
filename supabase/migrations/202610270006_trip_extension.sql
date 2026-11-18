-- 202610270006_trip_extension.sql
--
-- Self-serve trip extension for a trip that is already out.
--
-- The change-request flow (202610220005) is for upcoming bookings: it moves
-- hubs and dates and needs staff sign-off. An extension is narrower — the
-- vehicle is already in the customer's hands, so only the drop-off moves
-- later. When the vehicle is free for the new window the extension is applied
-- immediately (extra days are simply due at drop-off, exactly what the desk
-- would agree over the phone); when the new window overlaps another booking
-- the server refuses with a clear message so no operator has to reconcile a
-- conflict later.
--
-- The same rules as src/lib/extend.js (both adapters must agree):
--   - the new drop-off must be strictly later than the booked one;
--   - the new drop-off must not be in the past;
--   - the total trip length stays within the configured max rental days.

alter table public.bookings
  add column if not exists change_request jsonb;

create or replace function public.extend_booking_dropoff(
  p_booking_id uuid,
  p_end_date date,
  p_dropoff_time text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_quote jsonb;
  v_enabled text;
  v_problem text;
  v_previous numeric;
  v_delta numeric;
  v_actor_name text;
  v_max_days integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  select value into v_enabled from public.settings where key = 'extensions_enabled';
  if v_enabled = 'false' then
    raise exception 'Trip extensions are currently unavailable — please contact support.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id;

  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;
  if not public.is_staff() and v_booking.user_id <> auth.uid() then
    raise exception 'Booking not found.';
  end if;
  if v_booking.status <> 'active' then
    raise exception 'Only a trip that is still out can be extended.';
  end if;
  if v_booking.change_request is not null and v_booking.change_request->>'status' = 'pending' then
    raise exception 'You already have a change request pending. Withdraw it before extending.';
  end if;
  if p_end_date is null or p_dropoff_time is null
     or p_dropoff_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Choose a valid return date and drop-off slot.';
  end if;

  -- Same wall-clock guard as src/lib/extend.js extendProblem().
  if (p_end_date, p_dropoff_time::time)
     <= (v_booking.end_date, coalesce(v_booking.dropoff_time, '10:00')::time) then
    raise exception 'The new return must be later than the current drop-off.';
  end if;
  if (p_end_date, p_dropoff_time::time) <= (current_date, now()::time) then
    raise exception 'This return time has already passed — choose a later date or time.';
  end if;

  select coalesce((select value from public.settings where key = 'max_rental_days')::integer, 45)
    into v_max_days;
  if p_end_date - v_booking.start_date > v_max_days then
    raise exception 'Rentals are limited to % days.', v_max_days;
  end if;

  v_quote := public.quote_rental(
    v_booking.vehicle_id, v_booking.start_date, p_end_date,
    v_booking.extras, v_booking.insurance, v_booking.promo_code,
    v_booking.pickup_location, v_booking.dropoff_location,
    v_booking.payment_plan, v_booking.id
  );
  if not (v_quote->>'available')::boolean then
    raise exception '%', coalesce(v_quote->>'unavailableReason', 'That return window is not available for this vehicle — another booking may be scheduled. Try a different time.');
  end if;

  v_previous := coalesce(v_booking.total, 0);
  v_delta := coalesce((v_quote->>'total')::numeric, 0) - v_previous;

  select coalesce(p.full_name, 'A Rove customer') into v_actor_name
  from public.profiles p where p.id = auth.uid();
  update public.bookings
  set end_date = p_end_date,
      dropoff_time = p_dropoff_time,
      days = (v_quote->>'days')::integer,
      base_total = coalesce((v_quote->>'baseTotal')::numeric, v_booking.base_total),
      extras_total = coalesce((v_quote->>'extrasTotal')::numeric, v_booking.extras_total),
      insurance_total = coalesce((v_quote->>'insuranceTotal')::numeric, v_booking.insurance_total),
      one_way_fee = coalesce((v_quote->>'oneWayFee')::numeric, v_booking.one_way_fee),
      fees = coalesce((v_quote->>'fees')::numeric, v_booking.fees),
      tax_rate = coalesce((v_quote->>'taxRate')::numeric, v_booking.tax_rate),
      tax_inclusive = coalesce((v_quote->>'taxInclusive')::boolean, v_booking.tax_inclusive),
      discount = coalesce((v_quote->>'discount')::numeric, v_booking.discount),
      total = (v_quote->>'total')::numeric,
      -- The deposit was captured at pick-up; extending later days must not
      -- rewrite the figure the customer already paid.
      deposit_due = coalesce(v_booking.deposit_due, (v_quote->>'depositDue')::numeric),
      trip_changes = coalesce(v_booking.trip_changes, '[]'::jsonb) || jsonb_build_object(
        'type', 'extension',
        'at', now(),
        'by', v_actor_name,
        'summary', v_booking.end_date || ' ' || coalesce(v_booking.dropoff_time, '10:00')
               || ' → ' || p_end_date || ' ' || p_dropoff_time,
        'from', v_booking.end_date,
        'to', p_end_date,
        'delta', v_delta
      )
  where id = v_booking.id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_actor_name, 'customer', 'update', 'bookings', v_booking.code,
          'Customer extended return for ' || v_booking.code || ' to ' || p_end_date || ' ' || p_dropoff_time,
          jsonb_build_object(
            'change', 'extension',
            'delta', jsonb_build_object('from', v_previous, 'to', (v_quote->>'total')::numeric)
          ));

  if v_booking.user_id is not null then
    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'trip_extension', 'Return extended',
            'Your ' || v_booking.code || ' return is now ' || p_end_date || ' at ' || p_dropoff_time || '.',
            v_booking.code, '/confirmation/' || v_booking.code);
  end if;

  -- Desk awareness only when the customer extended themselves; a staff member
  -- applying the change already knows about it.
  if v_booking.user_id = auth.uid() then
    insert into public.notifications (audience, kind, title, body, booking_code, link)
    values ('staff', 'trip_extension', 'Return extended for ' || v_booking.code,
            'A customer extended ' || v_booking.code || ' to ' || p_end_date || ' at ' || p_dropoff_time
            || case when v_delta > 0 then ' — ₹' || v_delta || ' due at drop-off.' else '' end,
            v_booking.code, '/admin/bookings');
  end if;

  return jsonb_build_object('ok', true, 'endDate', p_end_date, 'dropoffTime', p_dropoff_time, 'delta', v_delta);
end;
$$;

revoke all on function public.extend_booking_dropoff(uuid, date, text) from public, anon;
grant execute on function public.extend_booking_dropoff(uuid, date, text) to authenticated;
