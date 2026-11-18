import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight, ArrowUpRight, CalendarDays, Check, MapPin, Sparkles, Star, X,
} from 'lucide-react';
import { EmptyState, Skeleton, Stars } from '../components/ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { api } from '../lib/api.js';
import { cn, inr } from '../lib/format.js';
import { getSiteContent } from '../lib/site.js';
import { typicalDayRate } from '../lib/pricing.js';
import {
  COMPARE_EVENT,
  cheapestVehicleId,
  clearCompare,
  pruneCompare,
  readCompare,
  removeFromCompare,
  rowWinnerIndex,
} from '../lib/compare.js';

export default function Compare() {
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const taxInclusive = content.tax_inclusive;
  const taxLabel = content.tax_label;
  const [items, setItems] = useState(() => readCompare());
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(Boolean(items.length));
  const [error, setError] = useState('');
  const [showPruneNote, setShowPruneNote] = useState(false);
  const idsKey = items.map((item) => item.id).join(',');

  useEffect(() => {
    const sync = () => setItems(readCompare());
    window.addEventListener(COMPARE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(COMPARE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (!content.compare_enabled || !idsKey) {
      setVehicles([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError('');
    api.listVehicles({ sort: 'recommended' })
      .then((result) => {
        if (!alive) return;
        const ids = idsKey.split(',');
        const catalogue = new Map((result.vehicles ?? []).map((vehicle) => [vehicle.id, vehicle]));
        const found = ids.map((id) => catalogue.get(id)).filter(Boolean);
        // A shortlist can outlive a vehicle (deleted or moved to maintenance).
        // Prune stale ids from storage so the tray and this page stay truthful.
        const stale = ids.filter((id) => !catalogue.has(id));
        if (stale.length) {
          setItems(pruneCompare(ids.filter((id) => catalogue.has(id))));
          setShowPruneNote(true);
        }
        setVehicles(found);
      })
      .catch((nextError) => { if (alive) setError(nextError.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [content.compare_enabled, idsKey]);

  const remove = (id) => {
    setItems(removeFromCompare(id));
    setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
  };

  const clear = () => {
    clearCompare();
    setItems([]);
    setVehicles([]);
  };

  const rows = [
    {
      key: 'price',
      label: content.compare_price,
      render: (vehicle) => {
        const allIn = typicalDayRate(vehicle, meta.settings, meta.insuranceTiers);
        return (
          <div>
            <p className="text-lg font-extrabold tracking-[-0.03em]">
              {inr(vehicle.pricePerDay)}<span className="ml-1 text-[0.62rem] font-medium text-muted">{content.compare_day_unit}</span>
            </p>
            <p className="mt-0.5 text-[0.58rem] font-semibold text-forest">
              {taxInclusive
                ? content.compare_tax_included.replace('{tax}', taxLabel)
                : content.compare_tax_added.replace('{tax}', taxLabel)}
            </p>
            {content.card_show_all_in_rate !== false && allIn !== null && allIn > (Number(vehicle.pricePerDay) || 0) && (
              <p className="mt-1 text-[0.62rem] font-bold text-ink" title={content.card_all_in_note}>
                ≈ {inr(allIn)}<span className="font-medium text-muted">/day {content.card_all_in_label}</span>
              </p>
            )}
          </div>
        );
      },
      value: (vehicle) => `${vehicle.pricePerDay} per day`,
      number: (vehicle) => {
        const price = Number(vehicle.pricePerDay);
        return Number.isFinite(price) && price > 0 ? price : null;
      },
      lowIsBest: true,
    },
    {
      key: 'location',
      label: content.compare_hub,
      render: (vehicle) => (
        <span className="inline-flex items-center gap-1.5 text-[0.76rem] font-bold">
          <MapPin className="h-3.5 w-3.5 text-moss" /> {vehicle.location}
        </span>
      ),
      value: (vehicle) => vehicle.location,
    },
    {
      key: 'capacity',
      label: content.compare_capacity,
      render: (vehicle) => (
        <span className="text-[0.76rem] font-semibold">
          {vehicle.kind === 'bike'
            ? `${vehicle.engineCc || '—'} cc · ${vehicle.mileage || vehicle.fuel || '—'}`
            : `${vehicle.seats} seats · ${vehicle.luggage} bags`}
        </span>
      ),
      value: (vehicle) => (vehicle.kind === 'bike' ? `${vehicle.engineCc} cc` : `${vehicle.seats} seats`),
    },
    {
      key: 'gearbox',
      label: content.compare_gearbox,
      render: (vehicle) => <span className="text-[0.76rem] font-semibold">{vehicle.kind === 'bike' ? vehicle.gears : vehicle.transmission}</span>,
      value: (vehicle) => (vehicle.kind === 'bike' ? vehicle.gears : vehicle.transmission),
    },
    {
      key: 'fuel',
      label: content.compare_fuel,
      render: (vehicle) => (
        <span className="text-[0.76rem] font-semibold">
          {vehicle.fuel}{!vehicle.kind || vehicle.kind === 'car' ? ` · ${vehicle.efficiency}` : ''}
        </span>
      ),
      value: (vehicle) => vehicle.fuel,
    },
    {
      key: 'rating',
      label: content.compare_rating,
      render: (vehicle) => (
        Number(vehicle.reviewCount) > 0 ? (
          <div className="flex items-center gap-2">
            <Stars value={vehicle.rating} count={vehicle.reviewCount} />
            <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold">
              <Star className="h-3 w-3 fill-lime text-lime" /> {Number(vehicle.rating || 0).toFixed(1)}
            </span>
          </div>
        ) : (
          <span className="text-[0.7rem] font-semibold text-muted">{content.compare_no_reviews}</span>
        )
      ),
      value: (vehicle) => (Number(vehicle.reviewCount) > 0 ? `${vehicle.rating} rating` : content.compare_no_reviews),
      number: (vehicle) => (Number(vehicle.reviewCount) > 0 ? Number(vehicle.rating) : null),
      lowIsBest: false,
    },
    {
      key: 'trips',
      label: content.compare_trips,
      render: (vehicle) => (
        <span className="text-[0.76rem] font-semibold">
          {Number.isFinite(Number(vehicle.trips)) ? `${vehicle.trips}${content.compare_trips_suffix}` : '—'}
        </span>
      ),
      value: (vehicle) => (Number.isFinite(Number(vehicle.trips)) ? `${vehicle.trips} trips` : '—'),
      number: (vehicle) => (Number.isFinite(Number(vehicle.trips)) ? Number(vehicle.trips) : null),
      lowIsBest: false,
    },
    {
      key: 'features',
      label: content.compare_features,
      render: (vehicle) => (
        <div className="flex flex-wrap gap-1.5">
          {(vehicle.features ?? []).slice(0, 5).map((feature) => (
            <span key={feature} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.58rem] font-bold">
              <Check className="h-2.5 w-2.5 text-forest" /> {feature}
            </span>
          ))}
        </div>
      ),
      value: (vehicle) => (vehicle.features ?? []).join(', '),
    },
  ];

  const showTable = content.compare_enabled && vehicles.length > 0;
  const valuePickId = cheapestVehicleId(vehicles);

  return (
    <div className="container-x pb-24 pt-8 sm:pt-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow mb-2">{content.compare_eyebrow}</p>
          <h1 className="display text-4xl leading-none sm:text-5xl">{content.compare_title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{content.compare_description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vehicles.length > 0 && (
            <button type="button" onClick={clear} className="btn btn-white btn-sm">
              <X className="h-3.5 w-3.5" /> {content.compare_clear}
            </button>
          )}
          <Link to="/browse" className="btn btn-dark btn-sm">
            <CalendarDays className="h-3.5 w-3.5" /> {content.compare_empty_cta}
          </Link>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}

      {loading && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="space-y-3 rounded-3xl border border-line bg-white p-4">
              <Skeleton className="aspect-[16/10] w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      )}

      {!loading && !showTable && (
        <EmptyState
          className="mt-8"
          icon={ArrowLeftRight}
          title={content.compare_empty_title}
          description={content.compare_empty_description}
          action={<Link to="/browse" className="btn btn-dark">{content.compare_empty_cta} <ArrowUpRight className="h-4 w-4" /></Link>}
        />
      )}

      {showTable && (
        <>
          <div className="mt-8 overflow-x-auto rounded-3xl border border-line bg-white shadow-card">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <caption className="sr-only">{content.compare_title}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-36 border-b border-line bg-paper px-4 py-5 text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">
                    {content.compare_vehicle}
                  </th>
                  {vehicles.map((vehicle) => (
                    <th key={vehicle.id} scope="col" className="min-w-[15rem] border-b border-l border-line px-4 py-5 align-top">
                      <div className="relative">
                        <img src={vehicle.imageUrl} alt={vehicle.name} className="aspect-[16/10] w-full rounded-2xl object-cover" />
                        <button
                          type="button"
                          onClick={() => remove(vehicle.id)}
                          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-ink/70 text-white backdrop-blur transition hover:bg-ink"
                          aria-label={content.compare_remove_aria.replace('{name}', vehicle.name)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="mt-3 text-[0.58rem] font-bold uppercase tracking-[0.14em] text-muted">{vehicle.brand} · {vehicle.year}</p>
                      <p className="mt-0.5 text-[0.95rem] font-extrabold tracking-tight">{vehicle.name}</p>
                      <p className="mt-1 text-[0.62rem] font-semibold text-muted">{vehicle.type}</p>
                      {valuePickId === vehicle.id && (
                        <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[0.56rem] font-extrabold text-forest">
                          <Sparkles className="h-3 w-3" /> {content.compare_best_value}
                        </p>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-line/70 last:border-b-0">
                    <th scope="row" className="sticky left-0 z-10 bg-paper px-4 py-4 text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                      {row.label}
                    </th>
                    {vehicles.map((vehicle, index) => {
                      const mode = row.number && row.lowIsBest !== undefined ? { lowIsBest: row.lowIsBest } : null;
                      const winner = Boolean(mode) && rowWinnerIndex(vehicles.map((candidate) => row.number(candidate)), mode) === index;
                      return (
                        <td key={vehicle.id} className={cn('border-l border-line/70 px-4 py-4 align-top', winner && 'bg-lime/[0.07]')}>
                          {row.render(vehicle)}
                          {winner && (
                            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-forest/30 bg-forest/10 px-2 py-0.5 text-[0.56rem] font-extrabold text-forest">
                              <Sparkles className="h-3 w-3" /> {content.compare_best}
                            </p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-paper px-4 py-4" />
                  {vehicles.map((vehicle) => (
                    <td key={vehicle.id} className="border-l border-line/70 px-4 py-4">
                      <Link to={`/vehicles/${vehicle.id}`} className="btn btn-dark btn-sm w-full">
                        {content.compare_view} <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-[0.66rem] text-muted">{content.compare_limit_note}</p>
          <p className="mt-1 text-center text-[0.6rem] text-muted">{content.compare_verdict_hint}</p>
          {showPruneNote && (
            <p role="alert" className="mt-2 text-center text-[0.66rem] text-rose-700">{content.compare_stale_note}</p>
          )}
        </>
      )}
    </div>
  );
}
