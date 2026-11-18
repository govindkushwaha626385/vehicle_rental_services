-- 202610200003_bikes.sql
-- Add "bike" as a first-class vehicle kind alongside "car".
--
-- Idempotent: safe to run more than once against the same database.

alter table public.vehicles
  add column if not exists kind         text not null default 'car',
  add column if not exists engine_cc    integer,
  add column if not exists mileage      text,
  add column if not exists gears        text,
  add column if not exists helmet_count integer default 1,
  add column if not exists license_class text,
  add column if not exists min_age      integer;

-- Keep kind constrained to the two supported values.
alter table public.vehicles drop constraint if exists vehicles_kind_check;
alter table public.vehicles
  add constraint vehicles_kind_check check (kind in ('car', 'bike'));

-- Widen the type check so bike body types are valid too.
alter table public.vehicles drop constraint if exists vehicles_type_check;
alter table public.vehicles
  add constraint vehicles_type_check check (type in (
    'Sports', 'SUV', 'Sedan', 'Electric', 'Convertible', 'Van', 'Economy',
    'Commuter', 'Scooter', 'Cruiser', 'Sport Bike', 'Adventure', 'Electric Bike'
  ));

-- Sensible defaults for existing rows that pre-date the bike fields.
update public.vehicles set kind = 'car' where kind is null;
update public.vehicles set helmet_count = 1 where helmet_count is null;
