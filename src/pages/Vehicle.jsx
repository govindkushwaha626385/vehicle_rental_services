import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, BellPlus, Bike, CalendarDays, Car, Check, ChevronLeft, ChevronRight, Cog, Fuel, Gauge, Heart,
  Luggage, MapPin, Mountain, RotateCcw, Share2, ShieldCheck, Sparkles, Users, X,
} from 'lucide-react';
import { Accordion, EmptyState, Modal, PageLoader, Stars, Skeleton } from '../components/ui.jsx';
import AvailabilityStrip from '../components/AvailabilityStrip.jsx';
import { availabilityStrip } from '../lib/availabilityStrip.js';
import CompareTray from '../components/CompareTray.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { RENTAL_TIMES as TIMES, addDaysISO, daysBetween, todayISO, typicalDayRate } from '../lib/pricing.js';
import { cn, inr, longDate, shortDate, timeLabel } from '../lib/format.js';
import { setPageMeta, setStructuredData } from '../lib/meta.js';
import { recordRecentVehicle } from '../lib/recently.js';
import { COMPARE_EVENT, isComparing, toggleCompare } from '../lib/compare.js';
import { getSiteContent, maxAdvanceDate, tripProblem } from '../lib/site.js';
import { kmDisclosure } from '../lib/km.js';

export default function Vehicle() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { meta } = useMeta();
  const { user } = useAuth();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const taxLabel = String(meta.settings?.tax_label || 'GST').trim() || 'GST';
  const autoConfirm = meta.settings?.booking_auto_confirm !== 'false';
  const policy = content.policy;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [gallery, setGallery] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [lightbox, setLightbox] = useState(-1);
  const [favorite, setFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [comparing, setComparing] = useState(() => isComparing(id));
  const [alertOpen, setAlertOpen] = useState(() => params.get('alert') === '1' && Boolean(params.get('from')));
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertDates, setAlertDates] = useState(() => {
    // Deep-link dates are clamped to the booking window so a malformed or
    // beyond-advance `from`/`to` in the URL can never seed an invalid watch request.
    const today = todayISO();
    const advanceEnd = maxAdvanceDate(meta.settings);
    const maxFallback = addDaysISO(today, Math.min(7, Math.max(1, daysBetween(today, advanceEnd))));
    const requestedFrom = params.get('from');
    const from = requestedFrom && requestedFrom >= today && requestedFrom <= advanceEnd
      ? requestedFrom
      : maxFallback;
    const requestedTo = params.get('to');
    const to = requestedTo && requestedTo > from && requestedTo <= advanceEnd
      ? requestedTo
      : addDaysISO(from, Math.max(policy.minDays, 4));
    return { from, to };
  });

  const defaultDays = Math.min(policy.maxDays, Math.max(policy.minDays, 3));
  const fallbackFrom = addDaysISO(todayISO(), 2);
  const queryProblem = tripProblem(params.get('from'), params.get('to'), meta.settings);
  const initialFrom = queryProblem ? fallbackFrom : params.get('from');
  const initialTo = queryProblem ? addDaysISO(fallbackFrom, defaultDays) : params.get('to');
  const knownLocation = (value) => meta.locations.some((location) => location.name === value) ? value : '';
  const knownTime = (value) => TIMES.includes(value) ? value : '10:00';

  const [trip, setTrip] = useState({
    from: initialFrom,
    to: initialTo,
    pickupTime: knownTime(params.get('pickupTime')),
    dropoffTime: knownTime(params.get('dropoffTime')),
    pickup: knownLocation(params.get('pickup') || params.get('location')),
    dropoff: knownLocation(params.get('dropoff')) || knownLocation(params.get('location')),
  });
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [available, setAvailable] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState('');
  const [similar, setSimilar] = useState([]);
  const [rates, setRates] = useState([]);
  const [showAllReviews, setShowAllReviews] = useState(false);

  useEffect(() => {
    const sync = () => setComparing(isComparing(id));
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(COMPARE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [id]);

  // Images are derived from the loaded vehicle, but the lightbox effect below
  // reads `images.length` in its dependency array *during render* — long before
  // the old declaration point. Hoist it here so the effect cannot hit a TDZ
  // ReferenceError and crash the whole page (real incident).
  const images = (data?.vehicle?.images?.length ? data.vehicle.images : [data?.vehicle?.imageUrl])
    .filter(Boolean);

  // Lightbox keyboard navigation (Escape, left, right arrows)
  useEffect(() => {
    if (lightbox < 0) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setLightbox(-1); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setLightbox((current) => (current - 1 + images.length) % images.length); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); setLightbox((current) => (current + 1) % images.length); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, images?.length]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setData(null);
    setGallery(0);
    api.getVehicle(id)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setFavorite(Boolean(result.vehicle.favorite));
        recordRecentVehicle(result.vehicle);
        setTrip((current) => ({
          ...current,
          pickup: current.pickup || result.vehicle.location,
          dropoff: current.dropoff || result.vehicle.location,
        }));
      })
      .catch((nextError) => { if (alive) setError(nextError.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, retryKey]);

  // Suggest alternatives in the same location so shoppers can compare before
  // committing. Refetches when the shopper changes dates, so the suggested
  // cards always reflect availability for the window they are actually looking at.
  useEffect(() => {
    const vehicle = data?.vehicle;
    if (!vehicle?.id) return undefined;
    let alive = true;
    api.listVehicles({
      kind: vehicle.kind,
      location: vehicle.location,
      from: trip.from,
      to: trip.to,
    })
      .then((list) => {
        if (!alive) return;
        setSimilar((list.vehicles ?? []).filter((item) => item.id !== id).slice(0, 3));
      })
      .catch(() => { /* suggestions are a nice-to-have */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.vehicle?.id, trip.from, trip.to]);

  useEffect(() => {
    if (!data?.vehicle?.id) return undefined;
    let alive = true;
    const from = todayISO();
    const advanceEnd = maxAdvanceDate(meta.settings);
    const rateDays = Math.min(30, Math.max(1, daysBetween(from, advanceEnd) + 1));
    const to = addDaysISO(from, rateDays - 1);
    Promise.resolve(typeof api.vehicleDayRates === 'function'
      ? api.vehicleDayRates(data.vehicle.id, from, to)
      : [])
      .then((rows) => { if (alive) setRates(rows); })
      .catch(() => { if (alive) setRates([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.vehicle?.id, meta.settings]);

  useEffect(() => {
    const vehicle = data?.vehicle;
    if (!vehicle) return undefined;
    const path = `/vehicles/${vehicle.id}`;
    const isBikeVehicle = vehicle.kind === 'bike';
    const specLine = isBikeVehicle
      ? `${vehicle.engineCc ? `${vehicle.engineCc}cc ` : ''}${vehicle.gears ? `${String(vehicle.gears).toLowerCase()} ` : ''}${String(vehicle.fuel).toLowerCase()} bike`
      : `${vehicle.seats} seats, ${String(vehicle.transmission).toLowerCase()}, ${String(vehicle.fuel).toLowerCase()}`;
    const description = `Rent the ${vehicle.name} in ${vehicle.location} from ${inr(vehicle.pricePerDay)} per day. ${specLine} — live availability and ${autoConfirm ? 'instant confirmation' : 'staff confirmation after review'}.`;
    setPageMeta({
      title: `${vehicle.name} rental in ${vehicle.location} — Rove`,
      description,
      path,
      image: vehicle.imageUrl,
    });
    setStructuredData('vehicle-schema', {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: vehicle.name,
      image: vehicle.images?.length ? vehicle.images : [vehicle.imageUrl].filter(Boolean),
      description: vehicle.description || description,
      brand: { '@type': 'Brand', name: vehicle.brand },
      category: vehicle.type,
      sku: vehicle.id,
      offers: {
        '@type': 'Offer',
        url: `${window.location.origin}${path}`,
        priceCurrency: 'INR',
        price: vehicle.pricePerDay,
        availability: vehicle.status === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
      ...(content.reviews_enabled && vehicle.reviewCount > 0 && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: vehicle.rating,
          reviewCount: vehicle.reviewCount,
        },
      }),
    });
    return () => setStructuredData('vehicle-schema', null);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setQuoteLoading(false);
      return undefined;
    }
    let alive = true;
    setQuoteError('');
    const dateProblem = tripProblem(trip.from, trip.to, meta.settings);
    if (dateProblem) {
      setQuote(null);
      setQuoteLoading(false);
      setAvailable(false);
      setUnavailableReason(dateProblem);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const result = await api.quote({
          vehicleId: id,
          startDate: trip.from,
          endDate: trip.to,
          extras: [],
          insurance: 'basic',
          pickupLocation: trip.pickup,
          dropoffLocation: trip.dropoff,
          paymentPlan: 'full',
        });
        if (!alive) return;
        setQuote(result.quote);
        setAvailable(result.available);
        setUnavailableReason(result.unavailableReason || '');
      } catch (nextError) {
        if (!alive) return;
        setQuote(null);
        setAvailable(false);
        setQuoteError(nextError.message);
      } finally {
        if (alive) setQuoteLoading(false);
      }
    }, 280);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [data, id, meta.settings, trip.from, trip.to, trip.pickup, trip.dropoff]);

  const set = (key, value) => setTrip((current) => ({ ...current, [key]: value }));

  const toggleFavorite = async () => {
    if (!user) {
      push('Sign in to save vehicles to your wishlist.', 'info');
      navigate(`/login?redirect=${encodeURIComponent(`/vehicles/${id}`)}`);
      return;
    }
    // Lock while a request is in flight so a double-tap cannot flip the
    // heart twice and desync it from the server.
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    const next = !favorite;
    setFavorite(next);
    try {
      const result = await api.toggleFavorite(id);
      setFavorite(result.favorite);
      push(result.favorite ? 'Saved to your wishlist.' : 'Removed from saved vehicles.', 'success');
    } catch (nextError) {
      setFavorite(!next);
      push(nextError.message, 'error');
    } finally {
      setFavoriteBusy(false);
    }
  };

  const shareVehicle = async () => {
    const url = `${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      push(content.vehicle_shared, 'success');
    } catch {
      push(content.vehicle_share_fallback.replace('{url}', url), 'info');
    }
  };

  const toggleComparison = () => {
    if (!data?.vehicle) return;
    const result = toggleCompare(data.vehicle);
    if (result.limit) {
      push(content.compare_limit, 'info');
      return;
    }
    setComparing(result.added);
  };

  const openAlert = () => {
    if (!user) {
      push('Sign in to save an availability alert.', 'info');
      navigate(`/login?redirect=${encodeURIComponent(`/vehicles/${id}`)}`);
      return;
    }
    setAlertOpen(true);
  };

  const saveAlert = async () => {
    if (!alertDates.from || !alertDates.to) {
      push(content.alert_scope, 'error');
      return;
    }
    const dateProblem = tripProblem(alertDates.from, alertDates.to, meta.settings);
    if (dateProblem) {
      push(dateProblem, 'error');
      return;
    }
    setAlertBusy(true);
    try {
      await api.createAvailabilityAlert({ vehicleId: vehicle.id, startDate: alertDates.from, endDate: alertDates.to });
      setAlertOpen(false);
      push(content.alert_created, 'success');
    } catch (error) {
      const message = String(error.message || '');
      push(/already/i.test(message)
        ? content.alert_exists
        : /up to 10/i.test(message) ? content.alert_limit : message, 'error');
    } finally {
      setAlertBusy(false);
    }
  };

  const distribution = useMemo(() => {
    const reviews = data?.reviews ?? [];
    return [5, 4, 3, 2, 1].map((stars) => {
      const count = reviews.filter((review) => review.rating === stars).length;
      return { stars, count, percent: reviews.length ? Math.round((count / reviews.length) * 100) : 0 };
    });
  }, [data]);

  if (loading) return <PageLoader label="Opening the vehicle…" />;
  if (error || !data) {
    return (
      <div className="container-x py-20">
        <EmptyState
          icon={ArrowLeft}
          title="We could not open that vehicle"
          description={error || 'This vehicle may have been removed from the fleet.'}
          action={(
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="btn btn-white"><RotateCcw className="h-4 w-4" /> {content.vehicle_retry}</button>
              <Link to="/browse" className="btn btn-dark">Back to the fleet</Link>
            </div>
          )}
        />
      </div>
    );
  }

  const { vehicle, reviews = [] } = data;
  const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 5);
  const isBike = vehicle.kind === 'bike';
  const km = kmDisclosure(vehicle);
  const similarHref = (sugId) => {
    const p = new URLSearchParams({
      from: trip.from,
      to: trip.to,
      pickup: trip.pickup,
      dropoff: trip.dropoff,
      pickupTime: trip.pickupTime,
      dropoffTime: trip.dropoffTime,
    });
    return `/vehicles/${sugId}?${p.toString()}`;
  };
  const pickDay = (date) => {
    setTrip((current) => ({
      ...current,
      from: date,
      to: current.to <= date ? addDaysISO(date, Math.max(policy.minDays, 3)) : current.to,
    }));
  };
  const checkoutParams = new URLSearchParams({
    vehicle: vehicle.id,
    from: trip.from,
    to: trip.to,
    pickup: trip.pickup,
    dropoff: trip.dropoff,
    pickupTime: trip.pickupTime,
    dropoffTime: trip.dropoffTime,
  });
  const canContinue = available && quote && !quoteError && !quoteLoading;

  // Free/booked day strip. The range honours the configured booking window —
  // a free cell past `maxAdvanceDays` would be a dead end the moment it is
  // tapped, because the quote engine rejects advance bookings beyond it.
  const advanceDays = Math.max(1, daysBetween(todayISO(), maxAdvanceDate(meta.settings)) + 1);
  const stripCells = data?.upcoming
    ? availabilityStrip({ upcoming: data.upcoming, today: todayISO(), days: Math.min(30, advanceDays) })
    : [];
  const pickFromStrip = (cell) => {
    if (!cell || cell.busy) return;
    const to = addDaysISO(cell.date, Math.max(policy.minDays, 1));
    setTrip((current) => ({
      ...current,
      from: cell.date,
      to: current.to < to ? to : current.to,
    }));
    setQuote(null);
    setUnavailableReason('');
    setQuoteError('');
  };
  const specSet = isBike
    ? {
      hero: {
        icon: Gauge,
        label: 'Engine',
        value: vehicle.engineCc ? String(vehicle.engineCc) : '—',
        unit: vehicle.engineCc ? 'cc' : '',
        detail: `${vehicle.fuel || 'Petrol'} · ${vehicle.mileage || '—'} · ${vehicle.gears || 'Manual'} · ${km.label}`,
      },
      tiles: [
        { icon: Cog, label: 'Gearbox', value: vehicle.gears || 'Manual', tone: 'bg-lime/30 text-forest' },
        { icon: Fuel, label: 'Mileage', value: vehicle.mileage || '—', tone: 'bg-aqua/25 text-forest' },
        { icon: ShieldCheck, label: 'Helmets', value: `${vehicle.helmetCount ?? 1} included`, tone: 'bg-sun/30 text-ink' },
        { icon: Bike, label: 'Licence', value: vehicle.licenseClass || 'MCWG', tone: 'bg-coral/15 text-ink' },
      ],
    }
    : {
      hero: {
        icon: vehicle.awd ? Mountain : Cog,
        label: 'Drivetrain',
        value: vehicle.awd ? 'AWD' : 'RWD',
        unit: '',
        detail: `${vehicle.transmission} · ${vehicle.fuel} · ${vehicle.efficiency} · ${km.label}`,
      },
      tiles: [
        { icon: Users, label: 'Seats', value: `${vehicle.seats} adults`, tone: 'bg-lime/30 text-forest' },
        { icon: Luggage, label: 'Luggage', value: `${vehicle.luggage} bags`, tone: 'bg-aqua/25 text-forest' },
        { icon: Cog, label: 'Gearbox', value: vehicle.transmission, tone: 'bg-sun/30 text-ink' },
        { icon: Fuel, label: 'Fuel', value: vehicle.fuel, tone: 'bg-coral/15 text-ink' },
      ],
    };

  return (
    <div className="pb-24 lg:pb-20">
      <div className="container-x pt-5">
        <nav className="flex flex-wrap items-center gap-1.5 text-[0.68rem] font-semibold text-muted" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-ink">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/browse" className="hover:text-ink">Fleet</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-ink" aria-current="page">{vehicle.name}</span>
        </nav>

        <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[0.6rem] font-extrabold uppercase tracking-[0.1em] text-lime">
                {isBike ? <Bike className="h-3 w-3" /> : null}
                {vehicle.type}
              </span>
              <span className="rounded-full border border-line bg-white px-2.5 py-1 text-[0.6rem] font-extrabold uppercase tracking-[0.1em]">{isBike ? 'Bike' : 'Car'}</span>
              {!isBike && vehicle.awd && <span className="rounded-full border border-line bg-white px-2.5 py-1 text-[0.6rem] font-extrabold uppercase tracking-[0.1em]">AWD</span>}
              <span className="rounded-full border border-ok/20 bg-ok/10 px-2.5 py-1 text-[0.6rem] font-extrabold uppercase tracking-[0.1em] text-ok">
                {autoConfirm ? 'Instant book' : 'Request to book'}
              </span>
              <span className="text-[0.68rem] font-semibold text-muted">{vehicle.year} · {vehicle.brand}</span>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl lg:text-[2.85rem]">{vehicle.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
              {Number(vehicle.reviewCount) > 0
                ? <Stars value={vehicle.rating} count={reviews.length || vehicle.reviewCount} />
                : <span className="text-[0.68rem] font-semibold text-muted">{content.vehicle_new_badge}</span>}
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-moss" /> {vehicle.location}</span>
              <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-lime-deep" /> {vehicle.trips} trips</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start">
            {content.alerts_enabled && (
              <button type="button" onClick={openAlert} className="btn btn-sm btn-outline" aria-label={content.alert_vehicle_button_aria}>
                <BellPlus className="h-4 w-4" /> {content.alert_vehicle_button}
              </button>
            )}
            {content.compare_enabled && (
              <button
                type="button"
                onClick={toggleComparison}
                aria-pressed={comparing}
                className={cn('btn btn-sm', comparing ? 'btn-dark' : 'btn-outline')}
              >
                <ArrowLeftRight className={cn('h-4 w-4', comparing && 'text-lime')} />
                {comparing ? content.compare_added : content.compare_add}
              </button>
            )}
            <button type="button" onClick={toggleFavorite} aria-pressed={favorite} className={cn('btn btn-sm', favorite ? 'btn-dark' : 'btn-outline')}>
              <Heart className={cn('h-4 w-4', favorite && 'fill-lime text-lime')} /> {favorite ? content.vehicle_saved : isBike ? content.vehicle_save_bike : content.vehicle_save}
            </button>
            <button type="button" onClick={shareVehicle} className="btn btn-sm btn-white" aria-label={content.vehicle_share_aria}>
              <Share2 className="h-4 w-4" /> {content.vehicle_share}
            </button>
          </div>
        </div>
      </div>

      <div className="container-x mt-6 grid gap-8 lg:grid-cols-[1fr_23rem]">
        <div className="min-w-0">
          <div
              onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
              onTouchEnd={(e) => {
                if (touchStartX === null) return;
                const diff = touchStartX - e.changedTouches[0].clientX;
                setTouchStartX(null);
                if (Math.abs(diff) > 60) setGallery((current) => (current + (diff > 0 ? 1 : -1) + images.length) % images.length);
              }}
              className="group relative overflow-hidden rounded-[1.75rem] bg-sand shadow-[0_30px_70px_-50px_rgba(10,15,11,0.65)] ring-1 ring-line cursor-zoom-in"
            onClick={() => setLightbox(gallery)}>
            <img src={images[gallery] || vehicle.imageUrl} alt={`${vehicle.name} — photo ${gallery + 1}`} className="aspect-[16/10] w-full object-cover transition duration-700 ease-out group-hover:scale-[1.02]" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/45 via-transparent to-ink/5" />
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-ink/55 px-2.5 py-1 text-[0.6rem] font-extrabold uppercase tracking-wider text-cream backdrop-blur-md">
              <MapPin className="h-3 w-3 text-lime" /> {vehicle.location}
            </span>
            <span className="absolute bottom-3 left-3 rounded-full border border-white/20 bg-black/35 px-2.5 py-1 text-[0.6rem] font-bold text-white backdrop-blur-md">
              {gallery + 1} / {images.length}
            </span>
            {images.length > 1 && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setGallery((current) => (current - 1 + images.length) % images.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/20 text-white backdrop-blur-md transition hover:bg-white hover:text-ink active:scale-95"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setGallery((current) => (current + 1) % images.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/20 text-white backdrop-blur-md transition hover:bg-white hover:text-ink active:scale-95"
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
            {images.slice(0, 3).map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setGallery(index)}
                aria-pressed={gallery === index}
                className={cn('overflow-hidden rounded-2xl border-2 bg-sand transition duration-300', gallery === index ? 'border-ink shadow-[0_10px_24px_-18px_rgba(10,15,11,0.6)]' : 'border-transparent opacity-70 hover:-translate-y-0.5 hover:opacity-100')}
                aria-label={`View photo ${index + 1}`}
              >
                <img src={image} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>

          <section className="mt-8">
            <div className="grid grid-cols-2 gap-3 sm:auto-rows-fr sm:grid-cols-4">
              <div className="relative col-span-2 overflow-hidden rounded-2xl border border-white/10 bg-ink p-4 text-cream shadow-card sm:row-span-2 sm:p-5">
                <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-lime/20 blur-2xl" />
                <div className="pointer-events-none absolute inset-0 bg-grain opacity-40" />
                <div className="relative flex h-full flex-col">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-lime ring-1 ring-inset ring-white/15">
                    <specSet.hero.icon className="h-4 w-4" />
                  </span>
                  <p className="mt-4 text-[0.58rem] font-bold uppercase tracking-[0.18em] text-cream/55">{specSet.hero.label}</p>
                  <p className="mt-1 text-4xl font-extrabold leading-none tracking-[-0.05em] sm:text-5xl">
                    {specSet.hero.value}
                    {specSet.hero.unit && <span className="ml-1.5 text-base font-semibold text-cream/55">{specSet.hero.unit}</span>}
                  </p>
                  <p className="mt-auto pt-4 text-[0.65rem] leading-5 text-cream/60">{specSet.hero.detail}</p>
                </div>
              </div>
              {specSet.tiles.map((item) => (
                <div key={item.label} className="card-hover rounded-2xl border border-line bg-white/95 p-3.5">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', item.tone)}>
                    <item.icon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-muted">{item.label}</p>
                  <p className="mt-0.5 text-[0.78rem] font-extrabold leading-5">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8 border-t border-line pt-7">
            <h2 className="text-xl font-extrabold tracking-tight">{content.vehicle_about_title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">{vehicle.description}</p>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              {vehicle.features.map((feature) => (
                <span key={feature} className="inline-flex items-center gap-2 text-[0.78rem] font-semibold text-ink/80">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-lime/50 text-ink"><Check className="h-2.5 w-2.5" /></span>
                  {feature}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-8 border-t border-line pt-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight">{content.vehicle_protection_title}</h2>
                <p className="mt-1 text-xs text-muted">{content.vehicle_protection_description}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2.5">
              {meta.insuranceTiers.map((tier) => (
                <div key={tier.key} className={cn('flex items-start justify-between gap-4 rounded-2xl border p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-soft', tier.key === 'standard' ? 'border-ink bg-gradient-to-br from-lime/25 via-white to-white shadow-[0_14px_30px_-28px_rgba(10,15,11,0.5)]' : 'border-line bg-white/70')}>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-extrabold">{tier.label}</p>
                      {tier.key === 'standard' && <span className="rounded-full bg-lime px-2 py-0.5 text-[0.55rem] font-extrabold uppercase tracking-wider text-ink">Popular</span>}
                    </div>
                    <p className="mt-1 max-w-xl text-[0.7rem] leading-5 text-muted">{tier.blurb}</p>
                    <p className="mt-1.5 text-[0.62rem] font-bold uppercase tracking-wider text-forest">Deductible {inr(tier.deductible)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {tier.pricePerDay === 0 ? (
                      <p className="text-sm font-extrabold">Included</p>
                    ) : (
                      <p className="text-sm font-extrabold">{inr(tier.pricePerDay)}<span className="text-[0.62rem] font-medium text-muted">/day</span></p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8 border-t border-line pt-7">
            <h2 className="text-xl font-extrabold tracking-tight">{content.vehicle_fine_print_title}</h2>
            <div className="mt-4">
              <Accordion
                items={isBike
                  ? [
                    { q: 'Fuel & charge policy', a: `Petrol bikes are handed over with a full tank and should be returned full — missing fuel is charged at the pump rate plus a ${inr(policy.bikeFuelFee)} refuelling fee. Electric bikes are handed over at 90% charge or above and should be returned with at least 20%; charging is on us otherwise.` },
                    { q: 'Rider requirements', a: `Riders must be at least ${Math.max(policy.minBikeAge, Number(vehicle.minAge) || 0)} years old and hold a valid two-wheeler licence (${vehicle.licenseClass || 'MCWG'}). Helmets are provided for the rider and one pillion — riding without one is not permitted.` },
                    { q: 'Cancellation & changes', a: `${policy.fullRefundCopy} ${policy.partialRefundCopy} Date and bike changes are free subject to availability; any fare difference is charged or refunded.` },
                    { q: 'Damage, tolls and fines', a: `Insurance covers the vehicle subject to the deductible of your chosen tier. Tolls, parking and traffic fines are your responsibility and are charged to the card on file. A refundable ${inr(policy.holdAmount)} security deposit is due at pick-up and is returned after the vehicle comes back.` },
                    {
                      q: 'Mileage & geography',
                      a: km.limited
                        ? `This bike includes ${km.kmCap.toLocaleString('en-IN')} km per rental day. Distance beyond the allowance is charged at ${inr(km.kmExtraRate)}/km and settled at drop-off. Cross-border travel is not permitted without written approval. Bikes are for on-road use only unless the model is explicitly an adventure or off-road variant.`
                        : 'All rentals include unlimited kilometres within India. Cross-border travel is not permitted without written approval. Bikes are for on-road use only unless the model is explicitly an adventure or off-road variant.',
                    },
                  ]
                  : [
                    { q: 'Fuel policy', a: `Petrol and diesel cars are handed over with a full tank and should be returned full. If you return it lower, we charge the missing fuel at the pump rate plus a ${inr(policy.fuelFee)} refuelling fee. Electric cars are handed over at 90% charge or above and should be returned with at least 20%; charging is on us otherwise.` },
                    { q: 'Driver requirements', a: `Drivers must be at least ${Math.max(policy.minAge, Number(vehicle.minAge) || 0)} years old, hold a valid Indian licence or an international permit, and have at least one year of driving experience. All additional drivers must be registered before pick-up.` },
                    { q: 'Cancellation & changes', a: `${policy.fullRefundCopy} ${policy.partialRefundCopy} Date and car changes are free subject to availability; any fare difference is charged or refunded.` },
                    { q: 'Damage, tolls and fines', a: `Insurance covers the vehicle subject to the deductible of your chosen tier. Tolls, parking and traffic fines are your responsibility and are charged to the card on file. A refundable ${inr(policy.holdAmount)} security deposit is due at pick-up and is returned after the vehicle comes back.` },
                    {
                      q: 'Mileage & geography',
                      a: km.limited
                        ? `This car includes ${km.kmCap.toLocaleString('en-IN')} km per rental day. Distance beyond the allowance is charged at ${inr(km.kmExtraRate)}/km and settled at drop-off. Cross-border travel is not permitted without written approval. Off-road driving is only allowed in vehicles designed for it.`
                        : 'All rentals include unlimited kilometres within India. Cross-border travel is not permitted without written approval. Off-road driving is only allowed in vehicles designed for it.',
                    },
                  ]}
              />
            </div>
          </section>

          {rates.length > 0 && (
          <section className="mt-8 border-t border-line pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight">{content.vehicle_rates_title}</h2>
                <p className="mt-0.5 text-[0.68rem] leading-5 text-muted">{content.vehicle_rates_description}</p>
              </div>
              <div className="flex items-center gap-1.5 text-[0.58rem] font-bold text-muted">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-lime/25" /> Standard</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-coral/20" /> Weekend · seasonal</span>
              </div>
            </div>
            <div className="mt-3 no-scrollbar overflow-x-auto pb-1" aria-label={`Nightly price calendar for ${vehicle.name}`}>
              <div className="flex min-h-[5.5rem] gap-1">
                {rates.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => pickDay(day.date)}
                    aria-pressed={trip.from === day.date}
                    aria-label={`${day.date} · ${inr(day.rate)} per night${day.weekend || day.seasonal ? ' · peak rate' : ''}`}
                    className={cn(
                      'flex w-[4.7rem] shrink-0 flex-col items-center justify-center rounded-xl border px-2 py-2.5 text-center transition hover:border-ink',
                      trip.from === day.date ? 'border-ink bg-ink text-cream' : (day.weekend || day.seasonal ? 'border-line bg-coral/10' : 'border-line bg-white')
                    )}
                  >
                    <span className={cn('text-[0.56rem] font-bold uppercase tracking-wide', trip.from === day.date ? 'text-lime/90' : 'text-muted')}>{weekdayLetter(day.date)}</span>
                    <span className={cn('mt-0.5 text-base font-extrabold leading-none', trip.from === day.date && 'text-lime')}>{day.date.slice(8, 10)}</span>
                    <span className={cn('mt-1 text-[0.6rem] font-bold', trip.from === day.date ? 'text-cream/85' : 'text-ink')}>{inr(day.rate)}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-[0.6rem] leading-4 text-muted">Base nightly rate before insurance, extras and tax — the same server-side price a quote uses. {policy.fullRefundCopy}</p>
          </section>
          )}

          {content.reviews_enabled && (
          <section className="mt-8 border-t border-line pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-xl font-extrabold tracking-tight">{content.vehicle_reviews_title}</h2>
              {Number(vehicle.reviewCount) > 0 && <Stars value={vehicle.rating} count={reviews.length || vehicle.reviewCount} />}
            </div>

            {reviews.length ? (
              <div className="mt-5 grid gap-6 sm:grid-cols-[12rem_1fr]">
                <div className="relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-lime/25 via-white to-aqua/15 p-4 shadow-[0_18px_40px_-36px_rgba(10,15,11,0.5)]">
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-lime/30 blur-2xl" />
                  <p className="display relative text-5xl leading-none">{Number(vehicle.rating).toFixed(1)}</p>
                  <Stars value={vehicle.rating} className="relative mt-2" />
                  <p className="relative mt-1 text-[0.66rem] text-muted">{reviews.length} verified reviews</p>
                  <div className="relative mt-3 space-y-1" role="group" aria-label={`Rating distribution across ${reviews.length} review${reviews.length === 1 ? '' : 's'}`}>
                    {distribution.map((row) => (
                      <div key={row.stars} className="flex items-center gap-2 text-[0.6rem] text-muted">
                        <span className="w-3" aria-hidden="true">{row.stars}</span>
                        <div
                          className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/80"
                          role="img"
                          aria-label={`${row.stars} star${row.stars === 1 ? '' : 's'}: ${row.count} review${row.count === 1 ? '' : 's'} (${row.percent}%)`}
                        >
                          <div className="h-full rounded-full bg-gradient-to-r from-lime-deep to-moss" style={{ width: `${row.percent}%` }} />
                        </div>
                        <span className="w-4 text-right" aria-hidden="true">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-line">
                  {visibleReviews.map((review) => (
                    <div key={review.id} className="py-4 first:pt-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sand text-[0.6rem] font-extrabold">
                            {review.author.split(' ').map((part) => part[0]).join('')}
                          </span>
                          <div>
                            <p className="text-[0.75rem] font-extrabold">{review.author}</p>
                            <p className="text-[0.6rem] text-muted">{longDate(review.createdAt)}</p>
                          </div>
                        </div>
                        <Stars value={review.rating} size="h-3 w-3" />
                      </div>
                      <p className="mt-2 text-[0.78rem] leading-6 text-ink/75">{review.comment}</p>
                      {review.reply && (
                        <div className="mt-2.5 rounded-xl border border-forest/20 bg-forest/[0.045] px-3 py-2">
                          <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-forest">
                            Response from Rove{review.repliedAt ? ` · ${longDate(review.repliedAt)}` : ''}
                          </p>
                          <p className="mt-1 text-[0.72rem] leading-5 text-ink/75">{review.reply}</p>
                        </div>
                      )}
                    </div>
                  ))}
                  {reviews.length > 5 && (
                    <div className="pt-4">
                      <button
                        type="button"
                        onClick={() => setShowAllReviews((current) => !current)}
                        aria-expanded={showAllReviews}
                        className="btn btn-white btn-sm"
                      >
                        {showAllReviews ? 'Show fewer reviews' : `Show all ${reviews.length} reviews`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">{content.vehicle_reviews_empty}</p>
            )}
          </section>
          )}
        </div>

        {/* Booking card ------------------------------------------------------- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div id="trip-card" className="gradient-border rounded-3xl p-5 shadow-lift">
            {stripCells.length > 0 && (
              <div className="px-0.5 py-1">
                <AvailabilityStrip cells={stripCells} content={content} onPick={pickFromStrip} />
              </div>
            )}
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[0.6rem] font-bold uppercase tracking-wider text-muted">From</p>
                <p className="text-[1.75rem] font-extrabold tracking-[-0.035em]">{inr(vehicle.pricePerDay)}<span className="ml-1 text-[0.68rem] font-medium text-muted">/ day</span></p>
                {(() => {
                  const allIn = typicalDayRate(vehicle, meta.settings, meta.insuranceTiers);
                  if (content.card_show_all_in_rate !== false && allIn !== null && allIn > (Number(vehicle.pricePerDay) || 0)) {
                    return (
                      <p className="mt-0.5 text-[0.68rem] font-bold text-forest" title={content.card_all_in_note}>
                        ≈ {inr(allIn)}<span className="font-medium text-forest/80">/day {content.card_all_in_label}</span>
                      </p>
                    );
                  }
                  return (
                    <p className="mt-0.5 text-[0.58rem] font-semibold text-forest">
                      {meta.settings?.tax_inclusive === 'true'
                        ? content.vehicle_tax_included_note
                        : `${taxLabel} added at checkout`}
                    </p>
                  );
                })()}
              </div>
              {Number(vehicle.reviewCount) > 0
                ? <Stars value={vehicle.rating} count={reviews.length || vehicle.reviewCount} />
                : <span className="text-[0.66rem] font-semibold text-muted">{content.vehicle_new_badge}</span>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-line bg-paper/80 px-3 py-2 transition focus-within:border-moss/50 focus-within:bg-white">
                <label htmlFor="trip-from" className="mb-0.5 flex items-center gap-1 text-[0.56rem] font-extrabold uppercase tracking-wider text-muted"><CalendarDays className="h-2.5 w-2.5" /> Pick-up</label>
                <input id="trip-from" type="date" min={todayISO()} max={maxAdvanceDate(meta.settings)} value={trip.from} onChange={(event) => {
                  const next = event.target.value;
                  setTrip((current) => ({
                    ...current,
                    from: next,
                    // Stretch to meet the minimum, and clamp a span that the
                    // new start makes too long — otherwise the quote fails the
                    // max-days rule with no field-level hint.
                    to: current.to < addDaysISO(next, policy.minDays)
                      ? addDaysISO(next, policy.minDays)
                      : (current.to > addDaysISO(next, policy.maxDays) ? addDaysISO(next, policy.maxDays) : current.to),
                  }));
                }} className="w-full bg-transparent text-[0.7rem] font-bold focus:outline-none" />
                <select aria-label="Pick-up time" value={trip.pickupTime} onChange={(event) => set('pickupTime', event.target.value)} className="mt-0.5 w-full appearance-none bg-transparent text-[0.62rem] font-semibold text-muted focus:outline-none">
                  {TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                </select>
              </div>
              <div className="rounded-xl border border-line bg-paper/80 px-3 py-2 transition focus-within:border-moss/50 focus-within:bg-white">
                <label htmlFor="trip-to" className="mb-0.5 flex items-center gap-1 text-[0.56rem] font-extrabold uppercase tracking-wider text-muted"><CalendarDays className="h-2.5 w-2.5" /> Drop-off</label>
                <input id="trip-to" type="date" min={addDaysISO(trip.from, policy.minDays)} max={addDaysISO(trip.from, policy.maxDays)} value={trip.to} onChange={(event) => set('to', event.target.value)} className="w-full bg-transparent text-[0.7rem] font-bold focus:outline-none" />
                <select aria-label="Drop-off time" value={trip.dropoffTime} onChange={(event) => set('dropoffTime', event.target.value)} className="mt-0.5 w-full appearance-none bg-transparent text-[0.62rem] font-semibold text-muted focus:outline-none">
                  {TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-2 grid gap-2">
              <select aria-label="Pick-up hub" value={trip.pickup} onChange={(event) => set('pickup', event.target.value)} className="field text-[0.72rem]">
                {meta.locations.map((location) => <option key={location.id} value={location.name}>Pick up · {location.name}</option>)}
              </select>
              <select aria-label="Drop-off hub" value={trip.dropoff} onChange={(event) => set('dropoff', event.target.value)} className="field text-[0.72rem]">
                {meta.locations.map((location) => <option key={location.id} value={location.name}>Drop off · {location.name}</option>)}
              </select>
            </div>

            <div className="mt-4 min-h-[7rem] rounded-2xl border border-line/70 bg-gradient-to-br from-paper to-white p-3.5" aria-live="polite">
              {quoteLoading ? (
                <div className="space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-3/4" /></div>
              ) : quoteError ? (
                <p className="text-[0.72rem] font-semibold text-rose-700">{quoteError}</p>
              ) : quote ? (
                <div className="space-y-1.5 text-[0.7rem]">
                  <div className="flex justify-between"><span className="text-muted">{content.checkout_nightly.replace('{rate}', inr(quote.nightlyRate)).replace('{days}', String(quote.days))}</span><span className="font-bold">{inr(quote.baseTotal)}</span></div>
                  {quote.oneWayFee > 0 && <div className="flex justify-between"><span className="text-muted">{content.checkout_one_way_fee}</span><span className="font-bold">{inr(quote.oneWayFee)}</span></div>}
                  {!quote.taxInclusive && <div className="flex justify-between"><span className="text-muted">{taxLabel} ({quote.taxRate}%)</span><span className="font-bold">{inr(quote.fees)}</span></div>}
                  <div className="mt-2 flex justify-between border-t border-line pt-2 text-[0.82rem]">
                    <span className="font-extrabold">{content.checkout_total}</span>
                    <span key={quote.total} className="tick-in font-extrabold">{inr(quote.total)}</span>
                  </div>
                  {quote.taxInclusive && (
                    <div className="flex justify-between text-[0.6rem] text-muted"><span>{taxLabel} ({quote.taxRate}%) {content.checkout_tax_included}</span><span>{inr(quote.fees)}</span></div>
                  )}
                  <p className="pt-0.5 text-[0.6rem] leading-4 text-muted">Insurance and extras are added at checkout. A refundable {inr(quote.holdAmount ?? policy.holdAmount)} security deposit is due at pick-up.</p>
                </div>
              ) : (
                <p className="text-[0.72rem] text-muted">{content.vehicle_price_hint}</p>
              )}
            </div>

            {!available && unavailableReason && !quoteLoading && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.68rem] font-semibold text-amber-900">{unavailableReason}</p>
            )}

            {canContinue ? (
              <Link to={`/checkout?${checkoutParams.toString()}`} className="btn btn-lime btn-lg mt-3 w-full">
                {content.vehicle_continue_label} <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button type="button" disabled className="btn btn-dark btn-lg mt-3 w-full">
                {quoteLoading ? content.vehicle_checking_label : content.vehicle_choose_dates_label}
              </button>
            )}

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-lime/20 px-3 py-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
              <p className="text-[0.62rem] leading-4 text-ink/70">{policy.fullRefundCopy} {autoConfirm ? 'Instant confirmation.' : 'Staff confirmation after review.'}</p>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2 text-[0.55rem] font-bold uppercase tracking-wider text-muted">
              <span className="rounded border border-line px-1.5 py-0.5">Razorpay</span>
              <span className="rounded border border-line px-1.5 py-0.5">Visa</span>
              <span className="rounded border border-line px-1.5 py-0.5">UPI</span>
              <span className="rounded border border-line px-1.5 py-0.5">Mastercard</span>
            </div>
          </div>

          <p className="mt-3 px-1 text-center text-[0.62rem] leading-5 text-muted">
            Questions about this {isBike ? 'bike' : 'car'}? <a href={`mailto:${content.support_email}`} className="font-bold underline underline-offset-2">Talk to the team</a>.
          </p>
        </aside>
      </div>

      {/* Full-width suggestions — kept outside the detail grid so a single
          suggested card never renders in a ~1fr column. */}
      {similar.length > 0 && (
        <div className="container-x mt-6">
          <section className="border-t border-line pt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">{content.vehicle_similar_eyebrow}</p>
                <h2 className="mt-1 display text-3xl leading-[1.05] sm:text-4xl">{content.vehicle_similar_title}</h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-muted">
                  {content.vehicle_similar_description}
                </p>
              </div>
              <Link to={`/browse?kind=${vehicle.kind ?? 'car'}&location=${encodeURIComponent(vehicle.location)}`} className="inline-flex items-center gap-1.5 text-[0.72rem] font-extrabold text-forest transition hover:text-ink">
                View all in {vehicle.location} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {similar.map((suggested) => (
                <Link
                  key={suggested.id}
                  to={similarHref(suggested.id)}
                  className="group card card-hover overflow-hidden"
                  aria-label={`${suggested.name} in ${suggested.location}`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-sand">
                    {suggested.imageUrl ? (
                      <img src={suggested.imageUrl} alt={suggested.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-sand">{isBike ? <Bike className="h-6 w-6 text-muted" /> : <Car className="h-6 w-6 text-muted" />}</span>
                    )}
                    <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/80 px-2 py-0.5 text-[0.56rem] font-bold tracking-wide text-cream backdrop-blur-sm">
                      {suggested.pricePerDay ? `${inr(suggested.pricePerDay)}/day` : 'Sold out'}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="truncate text-[0.95rem] font-extrabold tracking-tight">{suggested.name}</p>
                    <div className="mt-1 flex items-center gap-3 text-[0.68rem] text-muted">
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {suggested.location}</span>
                      {Number(suggested.reviewCount) > 0 && <Stars value={suggested.rating} count={suggested.reviewCount} size="h-3 w-3" />}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}

      <CompareTray raised />

      <Modal open={alertOpen} onClose={() => setAlertOpen(false)} title={content.alert_modal_title} description={content.alert_modal_desc.replace('{vehicle}', vehicle.name)} size="sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="alert-from">{content.alert_from_label}</label>
            <input id="alert-from" type="date" min={todayISO()} max={maxAdvanceDate(meta.settings)} value={alertDates.from} onChange={(event) => setAlertDates((current) => ({ from: event.target.value, to: current.to <= event.target.value ? addDaysISO(event.target.value, Math.max(policy.minDays, 1)) : current.to }))} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="alert-to">{content.alert_to_label}</label>
            <input id="alert-to" type="date" min={addDaysISO(alertDates.from, policy.minDays)} max={maxAdvanceDate(meta.settings)} value={alertDates.to} onChange={(event) => setAlertDates((current) => ({ ...current, to: event.target.value }))} className="field" />
          </div>
        </div>
        <button type="button" onClick={saveAlert} disabled={alertBusy} className="btn btn-lime mt-4 w-full">
          {alertBusy ? 'Saving…' : content.alert_submit}
        </button>
      </Modal>

      {/* Full-screen lightbox ------------------------------------------------ */}
      {lightbox >= 0 && images.length > 0 && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/95 backdrop-blur-2xl animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={`${vehicle.name} — photo ${lightbox + 1} of ${images.length}`}
        >
          <button
            type="button"
            onClick={() => setLightbox(-1)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur transition hover:bg-white hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Counter */}
          <span className="absolute left-4 top-4 rounded-full border border-white/20 bg-ink/80 px-3 py-1 text-[0.7rem] font-bold text-white/80 backdrop-blur">
            {lightbox + 1} / {images.length}
          </span>

          {/* Previous */}
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setLightbox((current) => (current - 1 + images.length) % images.length)}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur transition hover:bg-white hover:text-ink active:scale-95"
              aria-label="Previous photo"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Main image */}
          <img
            src={images[lightbox]}
            alt={`${vehicle.name} — photo ${lightbox + 1}`}
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain shadow-[0_60px_120px_-80px_rgba(0,0,0,0.8)]"
            onClick={() => images.length > 1 && setLightbox((current) => (current + 1) % images.length)}
          />

          {/* Next */}
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setLightbox((current) => (current + 1) % images.length)}
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur transition hover:bg-white hover:text-ink active:scale-95"
              aria-label="Next photo"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Thumbnail strip */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex max-w-[90vw] gap-2 overflow-x-auto pb-1">
            {images.map((img, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setLightbox(index)}
                className={cn(
                  'shrink-0 overflow-hidden rounded-lg border-2 transition',
                  index === lightbox ? 'border-lime opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
                )}
              >
                <img src={img} alt="" className="h-14 w-20 object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile sticky book bar -------------------------------------------- */}
      <div
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-paper/95 shadow-[0_18px_40px_-24px_rgba(10,15,11,0.55)] backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[0.8rem] font-extrabold tracking-tight">{inr(vehicle.pricePerDay)} <span className="text-[0.62rem] font-medium text-muted">/ day</span></p>
            <p className="mt-0.5 text-[0.56rem] leading-4 text-muted">All-in price · {policy.fullRefundCopy}</p>
          </div>
          {canContinue ? (
            <Link to={`/checkout?${checkoutParams.toString()}`} className="btn btn-lime btn-sm shrink-0">
              {content.vehicle_mobile_continue} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <a href="#trip-card" className="btn btn-dark btn-sm shrink-0">
              {content.vehicle_mobile_choose} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function weekdayLetter(iso) {
  const [_y, _m, day] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(_y, _m - 1, day));
  return WEEKDAY_LETTERS[date.getUTCDay()] ?? '';
}
