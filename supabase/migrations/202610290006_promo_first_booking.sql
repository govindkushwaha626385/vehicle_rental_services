-- 202610290006_promo_first_booking.sql
--
-- "First booking only" promotions.
--
-- A common acquisition offer: a discount that applies only to customers who
-- have not completed a trip yet. The demo adapter enforces the rule at quote
-- time (a returning customer is told the code is for first bookings); this
-- column lets the SQL side store and surface the flag identically.

alter table public.promos
  add column if not exists first_booking_only boolean not null default false;

comment on column public.promos.first_booking_only is
  'When true the promo applies only to customers with no completed booking. Enforced at quote time by the adapters.';