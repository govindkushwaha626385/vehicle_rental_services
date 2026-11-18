import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, ArrowUpRight, Bike, Car, Cog, Fuel, Gauge, Heart, MapPin, Star, Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { cn, inr } from '../lib/format.js';
import { getSiteContent } from '../lib/site.js';
import { typicalDayRate, seasonalPricingActive } from '../lib/pricing.js';
import { COMPARE_EVENT, isComparing, toggleCompare } from '../lib/compare.js';
import { Stars } from './ui.jsx';

export default function VehicleCard({ vehicle, className, search = '', variant = 'grid' }) {
  const { user } = useAuth();
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const { push } = useToast();
  const taxInclusive = content.tax_inclusive;
  const taxLabel = content.tax_label;
  const navigate = useNavigate();
  const location = useLocation();
  const [favorite, setFavorite] = useState(Boolean(vehicle.favorite));
  const [saving, setSaving] = useState(false);
  const [comparing, setComparing] = useState(() => isComparing(vehicle.id));
  const detailHref = `/vehicles/${vehicle.id}${search ? `?${search}` : ''}`;
  const isList = variant === 'list';
  const isBike = vehicle.kind === 'bike';
  // Fully-loaded daily estimate (standard protection + tax) — mirrors the quote
  // engine for a one-day trip so the number a customer compares is honest.
  const allInRate = typicalDayRate(vehicle, meta.settings, meta.insuranceTiers);
  const showAllIn = content.card_show_all_in_rate !== false && allInRate !== null && allInRate > (Number(vehicle.pricePerDay) || 0);
  // Festive-pricing signal: quote engine already applies the seasonal
  // multiplier inside this window, so surface it as a chip rather than hiding it.
  const seasonal = seasonalPricingActive(meta.settings);
  const festiveLive = seasonal?.active === true;

  useEffect(() => {
    setFavorite(Boolean(vehicle.favorite));
  }, [vehicle.favorite]);

  useEffect(() => {
    const sync = () => setComparing(isComparing(vehicle.id));
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(COMPARE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [vehicle.id]);

  const toggleComparison = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = toggleCompare(vehicle);
    if (result.limit) {
      push(content.compare_limit, 'info');
      return;
    }
    setComparing(result.added);
  };

  const toggleFavorite = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!user) {
      push(`Sign in to save ${isBike ? 'bikes' : 'cars'} to your wishlist.`, 'info');
      navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (saving) return;
    setSaving(true);
    const next = !favorite;
    setFavorite(next);
    try {
      const result = await api.toggleFavorite(vehicle.id);
      setFavorite(result.favorite);
    } catch (error) {
      setFavorite(!next);
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const specs = isBike
    ? [
      { icon: Gauge, value: vehicle.engineCc ? `${vehicle.engineCc} cc` : '—', label: 'Engine' },
      { icon: Fuel, value: vehicle.mileage || vehicle.fuel || '—', label: 'Mileage' },
      { icon: Cog, value: vehicle.gears || 'Manual', label: 'Gearbox' },
    ]
    : [
      { icon: Users, value: `${vehicle.seats} seats`, label: 'Capacity' },
      { icon: Cog, value: vehicle.transmission === 'Automatic' ? 'Auto' : 'Manual', label: 'Gearbox' },
      { icon: Fuel, value: vehicle.fuel || '—', label: 'Fuel' },
    ];

  return (
    <article className={cn(
      'group relative flex flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/95 shadow-card ring-1 ring-ink/[0.05] card-hover',
      isList && 'sm:flex-row',
      className
    )}>
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-sand',
          isList
            ? 'aspect-[16/10] sm:aspect-auto sm:w-[41%] sm:self-stretch lg:w-[38%]'
            : 'aspect-[16/10]'
        )}
      >
        <Link
          to={detailHref}
          className="absolute inset-0"
          aria-label={`View ${vehicle.name} · ${vehicle.location}`}
        >
          <img
            src={vehicle.imageUrl}
          alt={vehicle.name}
          loading="lazy"
          className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.045]"
          onError={(event) => { event.currentTarget.style.opacity = '0'; }}
        />
        {!vehicle.imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-sand/80 to-white/80">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 text-ink">
              {vehicle.kind === 'bike' ? <Bike className="h-6 w-6" /> : <Car className="h-6 w-6" />}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/65 via-ink/5 to-ink/25" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 transition duration-700 group-hover:opacity-100" />

        <div className="absolute inset-x-0 top-0 flex items-start gap-2 p-3.5 pr-12">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-white/40 bg-ink/60 px-2.5 py-1 text-[0.58rem] font-extrabold uppercase tracking-[0.11em] text-white backdrop-blur-md">
              {isBike ? 'Bike' : 'Car'} · {vehicle.type}
            </span>
            {vehicle.badge && (
              <span className="rounded-full border border-lime/50 bg-lime/90 px-2.5 py-1 text-[0.58rem] font-extrabold uppercase tracking-[0.11em] text-ink backdrop-blur-md">
                {vehicle.badge}
              </span>
            )}
            {vehicle.awd && (
              <span className="rounded-full border border-white/50 bg-white/90 px-2.5 py-1 text-[0.58rem] font-extrabold uppercase tracking-[0.11em] text-ink backdrop-blur-md">
                AWD
              </span>
            )}
            {vehicle.status === 'rented' && (
              <span className="rounded-full bg-amber-100/95 px-2.5 py-1 text-[0.58rem] font-extrabold uppercase tracking-[0.11em] text-amber-900">
                On rent
              </span>
            )}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-white/25 bg-black/35 px-2.5 py-1 text-[0.62rem] font-bold text-white backdrop-blur-md">
            <MapPin className="h-3 w-3 shrink-0 text-lime" /> <span className="truncate">{vehicle.location}</span>
          </span>
          {Number(vehicle.reviewCount) > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/25 bg-black/35 px-2.5 py-1 text-[0.62rem] font-extrabold text-white backdrop-blur-md">
              <Star className="h-3 w-3 fill-lime text-lime" /> {Number(vehicle.rating || 0).toFixed(1)}
            </span>
          )}
        </div>
        </Link>

        <button
          type="button"
          onClick={toggleFavorite}
          disabled={saving}
          className={cn(
            'absolute right-3 top-3 z-[5] flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/50 backdrop-blur-md transition hover:scale-110 active:scale-95',
            favorite ? 'bg-lime text-ink' : 'bg-white/80 text-ink hover:bg-white'
          )}
          aria-label={favorite ? `Remove ${vehicle.name} from saved vehicles` : `Save ${vehicle.name}`}
          aria-pressed={favorite}
        >
          <Heart className={cn('h-4 w-4', favorite && 'fill-ink')} />
        </button>
      </div>

      <div className={cn('flex flex-1 flex-col p-4 sm:p-5', isList && 'sm:justify-between')}>
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-muted">{vehicle.brand} · {vehicle.year}</p>
              <h3 className={cn('mt-0.5 font-extrabold tracking-[-0.03em]', isList ? 'text-[1.15rem] sm:text-[1.3rem]' : 'truncate text-[1.05rem]')}>
                <Link to={detailHref} className="decoration-lime decoration-2 underline-offset-4 hover:underline">
                  {vehicle.name}
                </Link>
              </h3>
            </div>
            {!isList && (Number(vehicle.reviewCount) > 0
              ? <Stars value={vehicle.rating} count={vehicle.reviewCount} className="shrink-0 pt-0.5" />
              : <span className="shrink-0 pt-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-muted">{content.vehicle_new_badge}</span>)}
          </div>

          <div className={cn('mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-line/80 bg-paper/70', isList && 'max-w-md')}>
            {specs.map((spec, index) => (
              <div
                key={spec.label}
                className={cn(
                  'flex min-w-0 flex-col gap-1 px-2.5 py-2',
                  index !== specs.length - 1 && 'border-r border-line/70'
                )}
              >
                <span className="inline-flex items-center gap-1 text-[0.55rem] font-bold uppercase tracking-[0.1em] text-muted">
                  <spec.icon className="h-3 w-3" /> {spec.label}
                </span>
                <span className="truncate text-[0.72rem] font-extrabold text-ink">{spec.value}</span>
              </div>
            ))}
          </div>

          {isList && (
            <p className="mt-2.5 max-w-lg text-[0.7rem] leading-5 text-muted">
              {vehicle.description
                ? `${vehicle.description.slice(0, 132)}${vehicle.description.length > 132 ? '…' : ''}`
                : taxInclusive
                  ? `Available at ${vehicle.location} with ${taxLabel} and insurance included.`
                  : `Available at ${vehicle.location}. ${taxLabel} and insurance are added at checkout.`}
            </p>
          )}
        </div>

        <div className={cn('flex items-end justify-between gap-3 border-t border-line/80 pt-3.5', isList ? 'mt-4' : 'mt-4')}>
          <div>
            <p className="text-[0.55rem] font-bold uppercase tracking-[0.14em] text-muted">From</p>
            <p className="text-xl font-extrabold tracking-[-0.04em]">
              {inr(vehicle.pricePerDay)}
              <span className="ml-1 text-[0.66rem] font-semibold text-muted">/ day</span>
            </p>
            {showAllIn ? (
              <p
                className="mt-0.5 text-[0.6rem] font-bold text-forest"
                title={content.card_all_in_note}
              >
                ≈ {inr(allInRate)}<span className="font-medium text-forest/80">/day {content.card_all_in_label}</span>
              </p>
            ) : (
              <p className="text-[0.55rem] font-semibold text-forest">{taxInclusive ? `${taxLabel} included` : `+ ${taxLabel} at checkout`}</p>
            )}
            {festiveLive && content.card_seasonal_live && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-sun/40 bg-sun/15 px-1.5 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wide text-ink">
                {content.card_seasonal_live}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {content.compare_enabled && (
              <button
                type="button"
                onClick={toggleComparison}
                aria-pressed={comparing}
                aria-label={(comparing ? content.compare_remove_aria : content.compare_add_aria).replace('{name}', vehicle.name)}
                title={comparing ? content.compare_added : content.compare_add}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border transition duration-300 active:scale-95',
                  comparing
                    ? 'border-ink bg-ink text-lime'
                    : 'border-line bg-paper text-ink hover:border-ink hover:bg-white'
                )}
              >
                <ArrowLeftRight className="h-4 w-4" />
              </button>
            )}
            {isList ? (
              <Link to={detailHref} className="btn btn-dark btn-sm shrink-0">
                View {isBike ? 'bike' : 'car'} <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link
                to={detailHref}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink transition duration-300 group-hover:-rotate-6 group-hover:border-ink group-hover:bg-ink group-hover:text-lime"
                aria-label={`View ${vehicle.name}`}
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-lime via-lime-deep to-transparent transition-transform duration-500 group-hover:scale-x-100" />
    </article>
  );
}
