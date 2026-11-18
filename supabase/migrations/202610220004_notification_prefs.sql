-- 202610220004_notification_prefs.sql
-- Per-customer notification preferences, stored as JSON on the profile.

alter table public.profiles
  add column notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs
  is 'Canonical toggles: booking_confirmed, trip_updates, cancellations_refunds, promotions.';