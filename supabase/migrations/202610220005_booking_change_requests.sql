-- 202610220005_booking_change_requests.sql
-- Self-serve "change trip" requests.
--
-- Customers request a date/hub/time change on an upcoming booking; nothing
-- changes until staff approve it. All reads/writes are server-authoritative
-- through security-definer functions (the existing bookings update RLS only
-- allows staff, so customer writes must NOT go through the API).

alter table public.bookings
  add column change_request jsonb;

alter table public.bookings
  add column trip_changes jsonb not null default '[]'::jsonb;

comment on column public.bookings.change_request
  is 'Proposed trip change awaiting staff decision (status: pending/approved/declined).';
comment on column public.bookings.trip_changes
  is 'Append-only record of approved trip edits with price deltas.';

-- ---------------------------------------------------------------------------
-- Customer requests a change. Returns {"ok":true} or raises a friendly error.
-- ---------------------------------------------------------------------------
create or replace function public.request_booking_change(
  p_booking_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_location text,
  p_dropoff_location text,
  p_pickup_time text,
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
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.';
  end if;

  select value into v_enabled from public.settings where key = 'change_request_enabled';
  if v_enabled = 'false' then
    raise exception 'Trip changes are currently unavailable — please contact support.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and user_id = auth.uid();

  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Only upcoming bookings can be changed.';
  end if;
  if v_booking.change_request is not null and v_booking.change_request->>'status' = 'pending' then
    raise exception 'You already have a change request pending.';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
    raise exception 'Choose a valid date range.';
  end if;
  if p_pickup_location is null or btrim(p_pickup_location) = ''
     or p_dropoff_location is null or btrim(p_dropoff_location) = '' then
    raise exception 'Choose pick-up and drop-off hubs.';
  end if;
  if p_pickup_time is null or p_pickup_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Choose a valid pick-up time.';
  end if;
  if p_dropoff_time is null or p_dropoff_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Choose a valid drop-off time.';
  end if;

  v_quote := public.quote_rental(
    v_booking.vehicle_id, p_start_date, p_end_date,
    v_booking.extras, v_booking.insurance, v_booking.promo_code,
    p_pickup_location, p_dropoff_location, v_booking.payment_plan,
    v_booking.id
  );
  if not (v_quote->>'available')::boolean then
    raise exception '%', coalesce(v_quote->>'unavailableReason', 'Those dates are not available for this vehicle. Try another window.');
  end if;

  update public.bookings
  set change_request = jsonb_build_object(
    'status', 'pending',
    'startDate', p_start_date,
    'endDate', p_end_date,
    'pickupLocation', p_pickup_location,
    'dropoffLocation', p_dropoff_location,
    'pickupTime', p_pickup_time,
    'dropoffTime', p_dropoff_time,
    'days', v_quote->>'days',
    'total', v_quote->>'total',
    'fees', v_quote->>'fees',
    'taxRate', v_quote->>'taxRate',
    'taxInclusive', v_quote->>'taxInclusive',
    'requestedAt', now()
  )
  where id = v_booking.id and user_id = auth.uid();

  insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
  values ('user', auth.uid(), 'trip_change_requested', 'Change request received',
          'Your change request for ' || v_booking.code || ' is with our team. We will confirm by email.',
          v_booking.code, '/account?tab=trips');
  insert into public.notifications (audience, kind, title, body, booking_code, link)
  values ('staff', 'trip_change_requested', 'Change request for ' || v_booking.code,
          'A customer asked to move ' || v_booking.code || '. Approve or decline from Bookings.',
          v_booking.code, '/admin/bookings?change=pending');

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer withdraws a pending request.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking_change_request(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id and user_id = auth.uid();

  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;
  if v_booking.change_request is null or v_booking.change_request->>'status' <> 'pending' then
    raise exception 'No pending change request to withdraw.';
  end if;

  update public.bookings
  set change_request = null
  where id = v_booking.id and user_id = auth.uid();

  insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
  values ('user', auth.uid(), 'trip_change_withdrawn', 'Change request withdrawn',
          'Your change request for ' || v_booking.code || ' was withdrawn.',
          v_booking.code, '/account?tab=trips');

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff approve or decline a pending request. Approving applies the quoted
-- change server-side (dates, hubs, times, totals) and appends to the audit
-- trail and the booking's trip-change log.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_booking_change_request(
  p_booking_id uuid,
  p_decision text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_request jsonb;
  v_quote jsonb;
  v_previous numeric;
  v_delta numeric;
  v_actor_name text;
  v_reason text := coalesce(btrim(p_reason), '');
  v_pending jsonb;
begin
  if not public.is_staff() then
    raise exception 'This area is for Rove staff only.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.change_request is null
     or v_booking.change_request->>'status' <> 'pending' then
    raise exception 'No pending change request for this booking.';
  end if;
  v_request := v_booking.change_request;

  select coalesce(p.full_name, 'Staff') into v_actor_name
  from public.profiles p where p.id = auth.uid();

  if p_decision = 'approve' then
    v_quote := public.quote_rental(
      v_booking.vehicle_id,
      (v_request->>'startDate')::date,
      (v_request->>'endDate')::date,
      v_booking.extras, v_booking.insurance, v_booking.promo_code,
      v_request->>'pickupLocation',
      v_request->>'dropoffLocation',
      v_booking.payment_plan,
      v_booking.id
    );
    if not (v_quote->>'available')::boolean then
      raise exception 'Those dates just became unavailable — decline the request and tell the customer.';
    end if;

    v_previous := coalesce(v_booking.total, 0);
    v_delta := coalesce((v_quote->>'total')::numeric, 0) - v_previous;

    update public.bookings
    set start_date = (v_request->>'startDate')::date,
        end_date = (v_request->>'endDate')::date,
        pickup_location = v_request->>'pickupLocation',
        dropoff_location = v_request->>'dropoffLocation',
        pickup_time = v_request->>'pickupTime',
        dropoff_time = v_request->>'dropoffTime',
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
        deposit_due = (v_quote->>'depositDue')::numeric,
        trip_changes = v_booking.trip_changes || jsonb_build_object(
          'type', 'change',
          'at', now(),
          'by', v_actor_name,
          'summary', (v_request->>'startDate') || ' → ' || (v_request->>'endDate')
                 || ' · ' || (v_request->>'pickupLocation') || ' → ' || (v_request->>'dropoffLocation'),
          'delta', v_delta
        ),
        change_request = v_request || jsonb_build_object(
          'status', 'approved',
          'resolvedAt', now(),
          'resolvedBy', auth.uid(),
          'reason', v_reason
        )
    where id = v_booking.id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), v_actor_name, 'manager', 'update', 'bookings', v_booking.code,
            'Approved change request for ' || v_booking.code, jsonb_build_object(
              'change', 'approve',
              'reason', v_reason,
              'delta', jsonb_build_object('from', v_previous, 'to', v_booking.total)
            ));

    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'trip_change_approved', 'Trip change approved',
            'Your ' || v_booking.code || ' change was approved — new dates '
            || (v_request->>'startDate') || ' to ' || (v_request->>'endDate') || '.',
            v_booking.code, '/confirmation/' || v_booking.code);

  elsif p_decision = 'decline' then
    update public.bookings
    set change_request = v_request || jsonb_build_object(
      'status', 'declined',
      'resolvedAt', now(),
      'resolvedBy', auth.uid(),
      'reason', v_reason
    )
    where id = v_booking.id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), v_actor_name, 'manager', 'update', 'bookings', v_booking.code,
            'Declined change request for ' || v_booking.code, jsonb_build_object('change', 'decline', 'reason', v_reason));

    insert into public.notifications (audience, user_id, kind, title, body, booking_code, link)
    values ('user', v_booking.user_id, 'trip_change_declined', 'Change request declined',
            case when v_reason = '' then 'Your ' || v_booking.code || ' change was declined — the original booking is unchanged.'
                 else 'Your ' || v_booking.code || ' change was declined: ' || v_reason end,
            v_booking.code, '/account?tab=trips');
  else
    raise exception 'Invalid decision.';
  end if;

  select change_request into v_pending from public.bookings where id = v_booking.id;
  return jsonb_build_object('ok', true, 'decision', p_decision, 'changeRequest', v_pending);
end;
$$;

-- ---------------------------------------------------------------------------
-- Expose the new fields through the booking serializer. Preserve the original
-- body by renaming it, then wrap it so every consumer (my_bookings,
-- get_booking, admin views) carries changeRequest and tripChanges.
-- ---------------------------------------------------------------------------
alter function public.booking_json(uuid) rename to booking_json_base;
revoke all on function public.booking_json_base(uuid) from public, anon, authenticated;

create or replace function public.booking_json(p_booking_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.booking_json_base(p_booking_id) || jsonb_build_object(
    'changeRequest', (select b.change_request from public.bookings b where b.id = p_booking_id),
    'tripChanges', (select coalesce(b.trip_changes, '[]'::jsonb) from public.bookings b where b.id = p_booking_id)
  );
$$;

grant execute on function public.booking_json(uuid) to authenticated;

grant execute on function public.request_booking_change(uuid,date,date,text,text,text,text) to authenticated;
grant execute on function public.cancel_booking_change_request(uuid) to authenticated;
grant execute on function public.resolve_booking_change_request(uuid,text,text) to authenticated;