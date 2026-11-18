-- Hub coordinates are optional ("Coordinates are optional. When set, this hub
-- appears on the map"). The original schema stored a missing value as 0,0,
-- which is a real point in the Gulf of Guinea — un-mapped hubs silently became
-- mappable and the edit form showed "0" as if it were a real reading.
--
-- Store "not mapped" as NULL instead. The storefront map already bounds hubs
-- to India (8–35°N, 68–97°E), so NULL simply means "no pin".
alter table public.locations alter column lat drop not null;
alter table public.locations alter column lng drop not null;
alter table public.locations alter column lat drop default;
alter table public.locations alter column lng drop default;

-- Normalise rows saved under the old sentinel. An Indian rental hub at exactly
-- 0,0 is not a real location, so this cannot discard meaningful data.
update public.locations
   set lat = null, lng = null
 where lat = 0 and lng = 0;

comment on column public.locations.lat is 'Latitude, or NULL when the hub is not on the map.';
comment on column public.locations.lng is 'Longitude, or NULL when the hub is not on the map.';
