-- 202610210002_finance_invoices.sql
-- GST invoice settings and the tax rate on the admin booking payload.
--
-- Invoice prefix and tax label are ordinary settings, so they are editable from
-- Admin → Settings without a schema change. booking_json exposes the rate that
-- was used when the trip was priced, which keeps the finance register accurate
-- after the GST rate changes.

insert into public.settings (key, value) values
  ('tax_label', 'GST'),
  ('invoice_prefix', 'INV/26-27/')
on conflict (key) do nothing;

-- Store the rate used when each trip was priced. Settings can change later;
-- the invoice register must still show the GST that was actually charged.
alter table public.bookings
  add column if not exists tax_rate numeric(5,2) not null default 18;

alter table public.bookings drop constraint if exists bookings_tax_rate_valid;
alter table public.bookings
  add constraint bookings_tax_rate_valid check (tax_rate between 0 and 30);

create or replace function public.booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'code', b.code,
    'status', b.status,
    'paymentStatus', b.payment_status,
    'paymentPlan', b.payment_plan,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'startDate', b.start_date,
    'endDate', b.end_date,
    'pickupTime', b.pickup_time,
    'dropoffTime', b.dropoff_time,
    'days', b.days,
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object('key', e.key, 'label', e.label, 'pricePerDay', e.price_per_day) order by e.id)
      from unnest(b.extras) as k(key)
      join public.extras e on e.key = k.key
    ), '[]'::jsonb),
    'extraKeys', to_jsonb(b.extras),
    'insurance', jsonb_build_object(
      'key', b.insurance,
      'label', coalesce(it.label, initcap(b.insurance)),
      'pricePerDay', coalesce(it.price_per_day, 0),
      'deductible', coalesce(it.deductible, 0),
      'blurb', coalesce(it.blurb, '')
    ),
    'baseTotal', b.base_total,
    'extrasTotal', b.extras_total,
    'insuranceTotal', b.insurance_total,
    'oneWayFee', b.one_way_fee,
    'fees', b.fees,
    'taxRate', b.tax_rate,
    'discount', b.discount,
    'total', b.total,
    'depositDue', b.deposit_due,
    'amountPaid', b.amount_paid,
    'balanceDue', greatest(0, b.total - b.amount_paid),
    'promoCode', b.promo_code,
    'driver', jsonb_build_object(
      'name', b.driver_name,
      'email', b.driver_email,
      'phone', b.driver_phone,
      'license', b.driver_license,
      'dob', b.driver_dob
    ),
    'notes', b.notes,
    'createdAt', b.created_at,
    'cancelledAt', b.cancelled_at,
    'cancellationReason', b.cancellation_reason,
    'cancelledBy', b.cancelled_by,
    'pickupAt', (b.start_date::text || 'T' || b.pickup_time || ':00'),
    'holdAmount', coalesce((select value::integer from public.settings where key = 'hold_amount'), 5000),
    'vehicle', jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'brand', v.brand,
      'type', v.type,
      'imageUrl', v.image_url,
      'pricePerDay', v.price_per_day,
      'location', v.location
    ),
    'customer', jsonb_build_object(
      'name', coalesce(p.full_name, b.guest_name),
      'email', coalesce(p.email, b.guest_email),
      'phone', coalesce(p.phone, b.guest_phone),
      'isGuest', b.user_id is null
    ),
    'reviewed', exists(select 1 from public.reviews r where r.booking_id = b.id),
    'canCancel', b.status in ('pending','confirmed')
      and (b.start_date + b.pickup_time::time) > (now() at time zone 'Asia/Kolkata'),
    'canReview', b.status = 'completed' and b.user_id is not null
      and not exists(select 1 from public.reviews r where r.booking_id = b.id),
    'hasHold', exists(select 1 from public.payments pay where pay.booking_id = b.id and pay.kind = 'hold' and pay.status = 'authorized'),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'kind', pay.kind, 'amount', pay.amount, 'status', pay.status,
        'brand', pay.brand, 'last4', pay.last4, 'reference', pay.reference, 'createdAt', pay.created_at
      ) order by pay.created_at)
      from public.payments pay where pay.booking_id = b.id
    ), '[]'::jsonb)
  )
  from public.bookings b
  join public.vehicles v on v.id = b.vehicle_id
  left join public.insurance_tiers it on it.key = b.insurance
  left join public.profiles p on p.id = b.user_id
  where b.id = p_booking_id;
$$;

revoke all on function public.booking_json(uuid) from public, anon, authenticated;
