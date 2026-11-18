-- Fleet compliance documents: RC number, insurance and PUC expiry dates.
-- A rental is legally void once insurance or the pollution certificate lapses,
-- so the console tracks when each is due (pure logic in src/lib/fleetDocs.js).
alter table public.vehicles
  add column if not exists registration_number text not null default '',
  add column if not exists insurance_expiry date,
  add column if not exists puc_expiry date;

comment on column public.vehicles.registration_number is 'Registration certificate (RC) number, shown on the voucher.';
comment on column public.vehicles.insurance_expiry is 'When the vehicle insurance policy lapses — rentals after this date are not covered.';
comment on column public.vehicles.puc_expiry is 'When the pollution under control (PUC) certificate lapses.';