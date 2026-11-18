-- Price explorer: per-day base rates for a vehicle over a date range.
--
-- Returns one row per day with the pre-tax base nightly rate (price_per_day
-- times the greater of the weekend and seasonal multipliers), exactly the same
-- arithmetic the quote RPC applies per night. Public read access: it is price
-- display only, mirrors the settings already exposed on the catalogue.
--
-- Reapply-safe: the function body is replaced with "create or replace".

create or replace function public.vehicle_day_rates(p_vehicle_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from date;
  v_to date;
  v_vehicle public.vehicles%rowtype;
  v_weekend_mult numeric;
  v_seasonal_mult numeric;
  v_seasonal_start date;
  v_seasonal_end date;
  v_bikes_enabled boolean;
  v_result jsonb := '[]'::jsonb;
  v_day date;
  v_weekend boolean;
  v_seasonal boolean;
  v_mult numeric;
begin
  if p_vehicle_id is null or p_from is null or p_to is null then
    raise exception 'Missing vehicle or dates.';
  end if;

  v_from := greatest(p_from, v_today);
  v_to := greatest(p_to, v_from);
  if v_to > v_from + 90 then
    v_to := v_from + 90;
  end if;

  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'Vehicle not found.';
  end if;

  v_bikes_enabled := coalesce((select value::text from public.settings where key = 'bikes_enabled'), 'true') <> 'false';
  if v_vehicle.kind = 'bike' and not v_bikes_enabled then
    raise exception 'Two-wheelers are temporarily unavailable.';
  end if;

  v_weekend_mult := coalesce((select value::numeric from public.settings where key = 'weekend_multiplier'), 1);
  v_seasonal_mult := coalesce((select value::numeric from public.settings where key = 'seasonal_multiplier'), 1);
  v_seasonal_start := (select value::date from public.settings where key = 'seasonal_start');
  v_seasonal_end := (select value::date from public.settings where key = 'seasonal_end');

  -- Mirrors the quote RPC: the greater of weekend and seasonal applies per
  -- night, and the weekend window is Friday–Sunday (dow 0 = Sunday).
  for i in 0..(v_to - v_from) loop
    v_day := v_from + i;
    v_weekend := extract(dow from v_day)::int in (0, 5, 6);
    v_seasonal := (v_seasonal_start is not null and v_day >= v_seasonal_start and v_day <= v_seasonal_end);
    v_mult := greatest(
      case when v_weekend then v_weekend_mult else 1 end,
      case when v_seasonal then v_seasonal_mult else 1 end
    );
    v_result := v_result || jsonb_build_object(
      'date', v_day::text,
      'rate', round(v_vehicle.price_per_day * v_mult)::integer,
      'weekend', v_weekend,
      'seasonal', v_seasonal
    );
  end loop;

  return v_result;
end;
$$;

revoke all on function public.vehicle_day_rates(uuid,date,date) from public, anon, authenticated;
grant execute on function public.vehicle_day_rates(uuid,date,date) to anon, authenticated;