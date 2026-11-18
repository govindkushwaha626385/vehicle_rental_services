import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, BadgeCheck, Bike, Bus, Car, Check, Clock, FileText, Gauge, Headphones,
  MapPin, Mountain, PiggyBank, ShieldCheck, Sparkles, Star, Wind, X, Zap,
} from 'lucide-react';
import SearchWidget from '../components/SearchWidget.jsx';
import VehicleCard from '../components/VehicleCard.jsx';
import { Accordion, Reveal, SectionHeading, Skeleton, Stars, StatusPill } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { clearRecent, readRecent } from '../lib/recently.js';
import { inr, cn, longDate } from '../lib/format.js';
import { fillCopy, getSiteContent } from '../lib/site.js';
import { nextTrip } from '../lib/upcoming.js';
import { tripCountdown } from '../lib/tripCountdown.js';
import { depositOutcome } from '../lib/returns.js';
import { licenceExpiryProblem } from '../lib/validation.js';

// Visual treatment for each category tile. The label and copy come from the
// admin-managed content, so this only maps presentation to the vehicle type.
const CATEGORY_META = {
  Sports: { icon: Gauge, tone: 'border-lime-deep/30 bg-gradient-to-br from-lime/80 via-lime/30 to-white' },
  SUV: { icon: Mountain, tone: 'border-sun/50 bg-gradient-to-br from-sun/35 via-sun/10 to-white' },
  Electric: { icon: Zap, tone: 'border-aqua/50 bg-gradient-to-br from-aqua/30 via-aqua/10 to-white' },
  Convertible: { icon: Wind, tone: 'border-coral/35 bg-gradient-to-br from-coral/20 via-coral/5 to-white' },
  Van: { icon: Bus, tone: 'border-violet/30 bg-gradient-to-br from-violet/20 via-violet/5 to-white' },
  Economy: { icon: PiggyBank, tone: 'border-mint/70 bg-gradient-to-br from-mint/60 via-mint/20 to-white' },
};
const CATEGORY_FALLBACK = { icon: Car, tone: 'border-line bg-paper' };

const trustIcons = [ShieldCheck, Headphones, BadgeCheck, FileText];

// Rotating colour treatment for the hero social-proof avatars.
const AVATAR_TONES = [
  'bg-lime text-ink',
  'bg-forest text-cream',
  'bg-[#F6D9B0] text-ink',
  'bg-[#C9D8F2] text-ink',
];

export default function Home() {
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const policy = content.policy;
  const hubCount = meta.locations.length;
  const showRating = content.reviews_enabled && Number(content.hero_rating) > 0;
  // Fill admin placeholders ({deposit}, {refund}, {hubs}) with live policy values.
  const fill = (value) => fillCopy(value, content, hubCount);

  const trust = content.trust_badges.slice(0, 4).map((item, index) => ({
    ...item,
    icon: trustIcons[index % trustIcons.length],
  }));
  const categories = content.home_categories.map((item) => {
    const meta = CATEGORY_META[item.type] ?? CATEGORY_FALLBACK;
    return { ...item, icon: meta.icon, tone: meta.tone };
  });
  const steps = content.home_steps.map((step) => ({ ...step, copy: fill(step.copy) }));
  const whyPoints = content.home_why_points.map((point) => ({ ...point, copy: fill(point.copy) }));
  const testimonials = content.testimonials;
  const faqs = content.faqs.map((item) => ({ q: item.question, a: item.answer }));
  const avatarInitials = content.home_avatar_initials.slice(0, 4);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState(() => readRecent(4));
  const { user } = useAuth();
  const [upcoming, setUpcoming] = useState(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    let alive = true;
    api.listVehicles({ sort: 'recommended' })
      .then((result) => {
        if (alive) setVehicles(result.vehicles ?? []);
      })
      .catch((error) => console.error('Fleet could not load', error))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Signed-in customers land here most often. Surfacing the trip they are
  // about to take (or are currently on) saves a detour through Account and
  // makes the drop-off deadline impossible to miss. Guests simply see nothing.
  useEffect(() => {
    if (!userId) {
      setUpcoming(null);
      return undefined;
    }
    let alive = true;
    api.getMyBookings()
      .then((rows) => { if (alive) setUpcoming(nextTrip(rows)); })
      .catch(() => { if (alive) setUpcoming(null); });
    return () => { alive = false; };
  }, [userId]);

  const upcomingCountdown = upcoming ? tripCountdown(upcoming) : null;
  const upcomingCountdownLabel = upcomingCountdown
    ? String(content[`countdown_${upcomingCountdown.labelHint}`] ?? '')
      .replace('{days}', upcomingCountdown.days ? String(upcomingCountdown.days) : '')
      .replace('{time}', upcomingCountdown.time || '10:00')
    : '';
  const upcomingBalance = Number(upcoming?.balanceDue) > 0 ? Number(upcoming.balanceDue) : 0;

  const priceFor = (type) => {
    const matches = vehicles.filter((vehicle) => vehicle.type === type).map((vehicle) => vehicle.pricePerDay);
    return matches.length ? Math.min(...matches) : null;
  };

  const featured = useMemo(() => {
    const ordered = [...vehicles].sort((a, b) => {
      const aOrder = Number(a.displayOrder) || 0;
      const bOrder = Number(b.displayOrder) || 0;
      if (aOrder && bOrder && aOrder !== bOrder) return aOrder - bOrder;
      if (aOrder && !bOrder) return -1;
      if (!aOrder && bOrder) return 1;
      return (Number(b.trips) || 0) - (Number(a.trips) || 0);
    });
    const picked = ordered.filter((vehicle) => vehicle.featured).slice(0, 4);
    const remainder = ordered.filter((vehicle) => !picked.includes(vehicle));
    return [...picked, ...remainder].slice(0, 4);
  }, [vehicles]);
  const heroVehicle = featured[0];
  const locationPins = useMemo(() => meta.locations
    .filter((location) => {
      const lat = Number(location.lat);
      const lng = Number(location.lng);
      return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= 8 && lat <= 35 && lng >= 68 && lng <= 97;
    })
    .map((location) => ({
      ...location,
      left: `${((Number(location.lng) - 68) / (97 - 68)) * 100}%`,
      top: `${((35 - Number(location.lat)) / (35 - 8)) * 100}%`,
    })), [meta.locations]);

  return (
    <div>
      {content.home_show_hero && (<>
      {/* Hero ----------------------------------------------------------------- */}
      <section className="container-x pt-4 sm:pt-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink sm:rounded-[2.5rem]">
          <img
            src={content.hero_image_url}
            alt={content.hero_image_alt}
            className="absolute inset-0 h-full w-full object-cover object-[68%_center] opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/92 to-ink/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent" />
          <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-lime/15 blur-3xl" />
          <div className="absolute -right-24 top-24 h-80 w-80 rounded-full bg-aqua/20 blur-[110px]" />
          <div className="absolute bottom-[-8rem] left-[38%] h-72 w-72 rounded-full bg-coral/15 blur-[120px]" />
          <div className="bg-grain absolute inset-0 opacity-40" />

          <div className="relative flex min-h-[34rem] flex-col justify-between px-6 pb-24 pt-10 sm:min-h-[38rem] sm:px-10 sm:pt-14 lg:px-14">
            <div className="max-w-2xl animate-rise">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-cream/75 backdrop-blur">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
                  </span>
                  {content.hero_eyebrow}
                </span>
                {content.hero_badge && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-ink">
                    <Sparkles className="h-3 w-3" /> {content.hero_badge}
                  </span>
                )}
              </div>

              <h1 className="display mt-6 max-w-2xl text-[3.2rem] leading-[0.94] tracking-[-0.04em] text-cream sm:text-[4.4rem] lg:text-[5rem]">
                {content.hero_title}
              </h1>

              <p className="mt-6 max-w-lg text-sm leading-7 text-cream/65 sm:text-[0.98rem]">
                {content.hero_subtitle}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
                <div className="flex items-center gap-3">
                  {avatarInitials.length > 0 && (
                    <div className="flex -space-x-2">
                      {avatarInitials.map((initials, index) => (
                        <span
                          key={`${initials}-${index}`}
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink text-[0.6rem] font-extrabold',
                            AVATAR_TONES[index % AVATAR_TONES.length]
                          )}
                        >
                          {initials}
                        </span>
                      ))}
                    </div>
                  )}
                  <div>
                    {showRating && (
                      <div className="flex items-center gap-0.5">
                        { [1, 2, 3, 4, 5].map((star) => (
                          <Star key={star} className={star <= Math.round(Number(content.hero_rating)) ? 'h-3 w-3 fill-lime text-lime' : 'h-3 w-3 text-cream/30'} />
                        ))}
                        <span className="ml-1.5 text-xs font-extrabold text-cream">{content.hero_rating}</span>
                      </div>
                    )}
                    <p className="mt-0.5 text-[0.66rem] text-cream/50">
                      {showRating ? `From ${content.hero_trip_count} ${content.hero_trip_label}` : `${content.hero_trip_count} ${content.hero_trip_label}`}
                    </p>
                  </div>
                </div>
                {showRating && (
                  <>
                    <div className="h-8 w-px bg-white/15" />
                    <div>
                      <p className="text-xs font-extrabold text-cream">{content.hero_trip_count}</p>
                      <p className="mt-0.5 text-[0.66rem] text-cream/50">{content.hero_trip_label}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {heroVehicle && (
              <div className="pointer-events-none absolute bottom-8 right-8 hidden w-56 rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-xl lg:block">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-ink">
                    {heroVehicle.kind === 'bike' ? <Bike className="h-4 w-4" /> : <Car className="h-4 w-4" />}
                  </span>
                  <div>
                    <p className="text-[0.68rem] font-bold text-cream">{heroVehicle.name}</p>
                    <p className="text-[0.6rem] text-cream/50">{heroVehicle.location}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-2.5">
                  <p className="text-[0.6rem] text-cream/50">from</p>
                  <p className="text-base font-extrabold text-cream">{inr(heroVehicle.pricePerDay)} <span className="text-[0.6rem] font-medium text-cream/50">/day</span></p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Search --------------------------------------------------------------- */}
      <div className="container-x relative z-20 -mt-16 sm:-mt-[4.5rem]">
        <SearchWidget />
      </div>

      {/* Trust ----------------------------------------------------------------- */}
      <section className="container-x pt-8 sm:pt-10">
        <div className="grid grid-cols-2 gap-x-5 gap-y-6 border-b border-line pb-8 lg:grid-cols-4">
          {trust.map((item, trustIndex) => (
            <Reveal key={item.title} delay={trustIndex} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-forest shadow-sm ring-1 ring-line">
                <item.icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[0.78rem] font-extrabold">{item.title}</p>
                <p className="mt-0.5 text-[0.68rem] leading-5 text-muted">{item.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      </>)}

      {/* Next trip (signed-in) ------------------------------------------------ */}
      {content.home_show_upcoming_trip !== false && upcoming && (
        <section className="container-x pt-8 sm:pt-10" aria-labelledby="home-upcoming-title">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-forest via-ink to-ink text-cream shadow-card">
            <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5">
              {upcoming.vehicle?.imageUrl ? (
                <img
                  src={upcoming.vehicle.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-24 w-full rounded-2xl object-cover sm:h-20 sm:w-28"
                />
              ) : (
                <span className="flex h-24 w-full items-center justify-center rounded-2xl bg-white/10 sm:h-20 sm:w-28">
                  <Car className="h-7 w-7 text-lime" />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[0.58rem] font-extrabold uppercase tracking-[0.16em] text-lime">{content.home_upcoming_eyebrow}</p>
                <h2 id="home-upcoming-title" className="mt-1 truncate text-lg font-extrabold tracking-tight">
                  {upcoming.vehicle?.name || content.home_upcoming_vehicle_fallback}
                </h2>
                <p className="mt-1 text-[0.72rem] text-cream/70">
                  {longDate(upcoming.startDate)} → {longDate(upcoming.endDate)}
                  {upcoming.pickupLocation ? ` · ${upcoming.pickupLocation}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill status={upcoming.status} />
                  {upcomingCountdownLabel && (
                    <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[0.62rem] font-bold text-cream">
                      {upcomingCountdownLabel}
                    </span>
                  )}
                  {upcomingBalance > 0 && (
                    <span className="rounded-full border border-sun/40 bg-sun/15 px-2.5 py-1 text-[0.62rem] font-bold text-sun">
                      {content.home_upcoming_balance.replace('{amount}', inr(upcomingBalance))}
                    </span>
                  )}
                  {(() => {
                    const chip = depositOutcome(upcoming);
                    return chip && chip.key === 'due' ? (
                      <span className="rounded-full border border-sun/40 bg-sun/15 px-2.5 py-1 text-[0.62rem] font-bold text-sun" title={content.home_upcoming_deposit_tip}>
                        <ShieldCheck className="h-3 w-3" /> {content.home_upcoming_deposit.replace('{amount}', inr(chip.amount))}
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const warn = licenceExpiryProblem(upcoming.driver ?? {}, { endDate: upcoming.endDate }, { policy: content.policy });
                    return warn ? (
                      <span className="rounded-full border border-amber-400/60 bg-amber-500/15 px-2.5 py-1 text-[0.62rem] font-bold text-amber-200" title={warn}>
                        <ShieldCheck className="h-3 w-3" /> {content.trip_licence_warn}
                      </span>
                    ) : null;
                  })()}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-col">
                <Link to={`/manage?code=${encodeURIComponent(upcoming.code)}`} className="btn btn-lime btn-sm flex-1 justify-center">
                  {content.home_upcoming_manage} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                {upcoming.status === 'active' && content.extensions_enabled && (
                  <Link
                    to={`/manage?code=${encodeURIComponent(upcoming.code)}&extend=1`}
                    className="btn btn-ghost btn-sm flex-1 justify-center text-cream"
                  >
                    <Clock className="h-3.5 w-3.5" /> {content.home_upcoming_extend}
                  </Link>
                )}
                <Link to={`/confirmation/${encodeURIComponent(upcoming.code)}`} className="btn btn-ghost btn-sm flex-1 justify-center text-cream">
                  {content.home_upcoming_voucher}
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Recently viewed -------------------------------------------------------- */}
      {content.home_show_catalog && (<>
      {recent.length > 0 && (
        <section className="container-x py-10 sm:py-12" aria-label="Recently viewed">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">{content.home_recent_eyebrow}</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">{content.home_recent_title}</h2>
            </div>
            <button type="button" onClick={() => { clearRecent(); setRecent([]); }} className="btn btn-ghost btn-sm" aria-label={content.home_recent_clear_label}>
              <X className="h-3.5 w-3.5" /> {content.home_recent_clear_label}
            </button>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((item) => (
              <Link key={item.id} to={`/vehicles/${item.id}`} className="group card card-hover overflow-hidden" aria-label={`${item.name} in ${item.location}`}>
                <div className="relative aspect-[4/3] overflow-hidden bg-sand">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-sand"><Car className="h-6 w-6 text-muted" /></span>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[0.56rem] font-bold tracking-wide text-cream backdrop-blur-sm">
                    {item.pricePerDay ? `${inr(item.pricePerDay)}/day` : ''}
                  </span>
                </div>
                <div className="p-3.5">
                  <p className="truncate text-[0.9rem] font-extrabold tracking-tight">{item.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[0.66rem] text-muted"><MapPin className="h-3 w-3" /> {item.location}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Cars & Bikes ---------------------------------------------------------- */}
      <section className="container-x py-14 sm:py-18">
        <SectionHeading
          eyebrow={content.home_travel_eyebrow}
          title={content.home_travel_title}
          description={content.home_travel_description}
        />
        <div className={cn('mt-8 grid gap-4', content.bikes_enabled && 'sm:grid-cols-2')}>
          <Reveal delay={0}>
            <Link
              to="/browse?kind=car"
              className="group relative flex min-h-[13rem] flex-col justify-between overflow-hidden rounded-3xl border border-line bg-paper p-6 transition duration-300 hover:-translate-y-0.5 hover:shadow-soft"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sand text-ink">
                  <Car className="h-5 w-5" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-ink/60 transition group-hover:text-ink" />
              </div>
              <div>
                <p className="text-lg font-extrabold tracking-tight">{content.home_car_card_title}</p>
                <p className="mt-1 text-[0.7rem] leading-5 text-muted">{content.home_car_card_copy}</p>
                <p className="mt-3 text-[0.7rem] font-bold text-ink/70">{content.home_car_card_cta}</p>
              </div>
            </Link>
          </Reveal>
          {content.bikes_enabled && (
            <Reveal delay={1}>
              <Link
                to="/browse?kind=bike"
                className="group relative flex min-h-[13rem] flex-col justify-between overflow-hidden rounded-3xl border border-line bg-ink p-6 text-cream transition duration-300 hover:-translate-y-0.5 hover:shadow-soft"
              >
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lime/15 blur-2xl" />
                <div className="relative flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime text-ink">
                    <Bike className="h-5 w-5" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-cream/60 transition group-hover:text-cream" />
                </div>
                <div className="relative">
                  <p className="text-lg font-extrabold tracking-tight">{content.home_bike_card_title}</p>
                  <p className="mt-1 text-[0.7rem] leading-5 text-cream/60">{content.home_bike_card_copy}</p>
                  <p className="mt-3 text-[0.7rem] font-bold text-lime">{content.home_bike_card_cta}</p>
                </div>
              </Link>
            </Reveal>
          )}
        </div>
      </section>

      {/* Categories ------------------------------------------------------------ */}
      <section className="container-x py-14 sm:py-18">
        <SectionHeading
          eyebrow={content.home_categories_eyebrow}
          title={content.home_categories_title}
          description={content.home_categories_description}
          action={<Link to="/browse" className="btn btn-outline btn-sm">{content.home_categories_cta} <ArrowRight className="h-3.5 w-3.5" /></Link>}
        />

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category, categoryIndex) => (
            <Reveal key={category.type} delay={categoryIndex} className="group relative">
              <Link
                to={`/browse?type=${encodeURIComponent(category.type)}`}
                className={cn(
                  'group relative flex min-h-[9.5rem] flex-col justify-between overflow-hidden rounded-2xl border p-4 shadow-[0_14px_34px_-32px_rgba(10,15,11,0.5)] transition duration-300 hover:-translate-y-1 hover:shadow-soft',
                  category.tone
                )}
              >
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/50 blur-2xl transition duration-500 group-hover:scale-150" />
                <div className="relative flex items-start justify-between">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl border border-white/60 shadow-sm', category.type === 'Sports' ? 'bg-ink text-lime' : 'bg-white/75 text-ink')}>
                    <category.icon className="h-4 w-4" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-ink/60 transition group-hover:text-ink" />
                </div>
                <div>
                  <p className="text-[0.82rem] font-extrabold leading-tight">{category.label}</p>
                  <p className="mt-0.5 text-[0.62rem] text-ink/60">{category.copy}</p>
                  <p className="mt-2 text-[0.65rem] font-bold text-ink/70">
                    {priceFor(category.type) ? (
                      <>from {inr(priceFor(category.type))}<span className="font-medium text-ink/60">/day</span></>
                    ) : (
                      <span className="font-medium text-ink/60">{content.home_category_fallback}</span>
                    )}
                  </p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Featured -------------------------------------------------------------- */}
      {(loading || featured.length > 0) && (
      <section className="container-x pb-16 sm:pb-20">
        <SectionHeading
          eyebrow={content.home_featured_eyebrow}
          title={content.home_featured_title}
          description={content.home_featured_description}
          action={<Link to="/browse" className="btn btn-dark btn-sm">{content.home_featured_cta} <ArrowRight className="h-3.5 w-3.5" /></Link>}
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loading
            ? [1, 2, 3, 4].map((item) => (
              <div key={item} className="overflow-hidden rounded-3xl border border-line bg-white">
                <Skeleton className="aspect-[4/3] rounded-none" />
                <div className="space-y-3 p-5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-10 w-full" /></div>
              </div>
            ))
            : featured.map((vehicle, vehicleIndex) => (
              <Reveal key={vehicle.id} delay={vehicleIndex}>
                <VehicleCard vehicle={vehicle} />
              </Reveal>
            ))}
        </div>
      </section>
      )}
      </>)}

      {/* How it works ---------------------------------------------------------- */}
      {content.home_show_how && (<>
      <section id="how-it-works" className="border-y border-line bg-paper py-16 sm:py-20">
        <div className="container-x grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow mb-3">{content.home_how_eyebrow}</p>
            <h2 className="display text-4xl leading-[1.02] sm:text-5xl lg:text-[3.6rem]">
              {content.home_how_title}
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-muted">
              {content.home_how_description}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/browse" className="btn btn-dark">{content.home_how_primary_label} <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/manage" className="btn btn-outline">{content.home_how_secondary_label}</Link>
            </div>
            <div className="mt-8 flex items-center gap-3 rounded-2xl border border-line bg-white p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink"><ShieldCheck className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-extrabold">{policy.fullRefundCopy}</p>
                <p className="mt-0.5 text-[0.68rem] text-muted">{policy.partialRefundCopy} {content.home_how_refund_note}</p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-line border-y border-line">
                      {steps.map((step) => (
                        <Reveal key={step.number} className="grid grid-cols-[3.5rem_1fr] gap-5 py-7 sm:grid-cols-[5rem_1fr] sm:py-9">
                          <span className="display text-4xl text-ink/60 sm:text-5xl">{step.number}</span>
                          <div>
                            <h3 className="text-lg font-extrabold tracking-tight sm:text-xl">{step.title}</h3>
                            <p className="mt-2 max-w-lg text-sm leading-7 text-muted">{step.copy}</p>
                          </div>
                        </Reveal>
                      ))}
            <div className="flex items-center gap-2 py-5 text-[0.7rem] font-semibold text-muted">
              <Check className="h-4 w-4 text-forest" /> {content.home_how_note}
            </div>
          </div>
        </div>
      </section>

      {/* Why Rove -------------------------------------------------------------- */}
      <section id="why-rove" className="container-x py-16 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="relative">
            <div className="overflow-hidden rounded-[2rem] bg-sand">
              <img
                src={content.home_why_image_url || 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1400&q=85'}
                alt="Range Rover Velar parked on a coastal road"
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="absolute -bottom-5 left-5 right-5 rounded-2xl border border-line bg-white p-4 shadow-xl sm:left-8 sm:right-auto sm:w-72">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest text-lime"><MapPin className="h-4 w-4" /></span>
                <div>
                  <p className="text-xs font-extrabold">{content.home_delivery_title}</p>
                  <p className="mt-0.5 text-[0.65rem] text-muted">{hubCount ? fill(content.home_delivery_copy) : content.home_delivery_copy_anywhere}</p>
                </div>
              </div>
            </div>
            <div className="absolute -right-3 -top-3 hidden rounded-full bg-lime px-4 py-2 text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-ink shadow-lg sm:block">
              {content.home_why_badge}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-3">{content.home_why_eyebrow}</p>
            <h2 className="display text-4xl leading-[1.03] sm:text-5xl">{content.home_why_title}</h2>
            <p className="mt-5 max-w-lg text-sm leading-7 text-muted">
              {fill(content.home_why_description)}
            </p>

            <div className="mt-7 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {whyPoints.map((point) => (
                <div key={point.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime text-ink"><Check className="h-3 w-3" /></span>
                  <div>
                    <p className="text-[0.8rem] font-extrabold">{point.title}</p>
                    <p className="mt-0.5 text-[0.7rem] leading-5 text-muted">{point.copy}</p>
                  </div>
                </div>
              ))}
            </div>

            {showRating && (
              <div className="mt-8 flex items-center gap-4 rounded-2xl bg-ink p-4 text-cream">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-lime text-ink"><Star className="h-5 w-5 fill-ink" /></div>
                <div>
                  <p className="text-sm font-extrabold">{content.hero_rating} out of 5, across {content.hero_trip_count} {content.hero_trip_label}</p>
                  <p className="mt-0.5 text-[0.68rem] text-cream/55">{content.home_why_rating_note}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      </>)}

      {/* Locations ------------------------------------------------------------- */}
      {content.home_show_locations && (
      <section id="locations" className="bg-sand/60 py-16 sm:py-20">
        <div className="container-x">
          <SectionHeading
            eyebrow={content.home_locations_eyebrow}
            title={hubCount ? fill(content.home_locations_title) : content.home_locations_title_anywhere}
            description={content.home_locations_description}
            action={<Link to="/browse" className="btn btn-white btn-sm">{content.home_locations_cta} <ArrowRight className="h-3.5 w-3.5" /></Link>}
          />

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative min-h-[20rem] overflow-hidden rounded-3xl bg-ink p-6 text-cream sm:min-h-[24rem]">
              <div className="absolute inset-0 bg-grain opacity-40" />
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(215,247,95,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(215,247,95,.18) 1px, transparent 1px)', backgroundSize: '56px 56px' }} />
              <svg className="absolute inset-0 h-full w-full opacity-30" viewBox="0 0 600 400" fill="none" aria-hidden="true">
                <path d="M100 300C160 240 180 190 260 160S390 130 470 60" stroke="#D7F75F" strokeWidth="1.5" strokeDasharray="5 7" />
                <path d="M80 120C150 140 200 100 260 120S380 220 520 190" stroke="#D7F75F" strokeWidth="1" strokeDasharray="3 8" />
              </svg>

              {locationPins.map((location) => (
                <div key={location.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: location.left, top: location.top }}>
                  <div className="group relative">
                    <span className="absolute inset-0 -m-3 animate-ping rounded-full bg-lime/15" />
                    <span className="relative flex h-3 w-3 items-center justify-center rounded-full border-2 border-ink bg-lime shadow-[0_0_0_3px_rgba(215,247,95,0.18)]" />
                    <span className="absolute left-4 top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-full border border-white/15 bg-ink/90 px-2.5 py-1 text-[0.6rem] font-bold text-cream backdrop-blur sm:block">
                      {location.city}
                    </span>
                  </div>
                </div>
              ))}

              <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-cream/55">{content.home_locations_live_label}</p>
                  <p className="mt-1 text-2xl font-extrabold">{hubCount ? `${hubCount} hub${hubCount === 1 ? '' : 's'} ${content.footer_location_label.toLowerCase()}` : content.footer_location_label}</p>
                  <p className="mt-1 text-[0.68rem] text-cream/50">{content.support_hours}. {content.home_locations_network_note}</p>
                </div>
                <span className="hidden rounded-full border border-lime/30 bg-lime/10 px-3 py-1.5 text-[0.6rem] font-bold text-lime sm:block">{content.home_locations_one_way_label} {inr(policy.oneWayFee)}</span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 lg:gap-2">
              {meta.locations.slice(0, 4).map((location) => (
                <Link
                  key={location.id}
                  to={`/browse?location=${encodeURIComponent(location.name)}`}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-white px-4 py-3.5 transition hover:border-ink"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.82rem] font-extrabold">{location.name}</p>
                    <p className="mt-0.5 truncate text-[0.65rem] text-muted">{location.address} · {location.hours}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-ink/60 transition group-hover:text-ink" />
                </Link>
              ))}
              {hubCount > 4 && (
                <Link
                  to="/hubs"
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-dashed border-line bg-white/70 px-4 py-3.5 transition hover:border-ink"
                >
                  <div className="min-w-0">
                    <p className="text-[0.82rem] font-extrabold">+{hubCount - 4} more</p>
                    <p className="mt-0.5 text-[0.65rem] text-muted">{content.home_locations_more}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-ink/60 transition group-hover:text-ink" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {/* Reviews --------------------------------------------------------------- */}
      {content.home_show_social && (<>
      {content.reviews_enabled && testimonials.length > 0 && (
        <section id="reviews" className="container-x py-16 sm:py-20">
          <SectionHeading
            eyebrow={content.home_reviews_eyebrow}
            title={content.home_reviews_title}
            description={content.home_reviews_description}
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {testimonials.slice(0, 3).map((testimonial, testimonialIndex) => {
              const featured = testimonialIndex === 0;
              const detail = [testimonial.trip, testimonial.city].filter(Boolean).join(' · ') || content.home_reviews_verified_label;
              return (
                <Reveal key={`${testimonial.name}-${testimonialIndex}`} delay={testimonialIndex}>
                  <figure
                    className={cn(
                      'flex h-full flex-col justify-between rounded-3xl border p-6',
                      featured ? 'border-ink bg-ink text-cream lg:-translate-y-2' : 'border-line bg-white'
                    )}
                  >
                    <div>
                      <Stars value={testimonial.rating} className={featured ? '[&_span]:text-cream' : ''} />
                      <blockquote className={cn('mt-4 text-sm leading-7', featured ? 'text-cream/80' : 'text-ink/75')}>
                        “{testimonial.quote}”
                      </blockquote>
                    </div>
                    <figcaption className="mt-6 flex items-center gap-3 border-t border-current/10 pt-4">
                      <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-[0.6rem] font-extrabold', featured ? 'bg-lime text-ink' : 'bg-sand text-ink')}>
                        {testimonial.name.split(' ').map((part) => part[0]).join('')}
                      </span>
                      <div>
                        <p className="text-[0.75rem] font-extrabold">{testimonial.name}</p>
                        <p className={cn('text-[0.62rem]', featured ? 'text-cream/55' : 'text-muted')}>{detail}</p>
                      </div>
                    </figcaption>
                  </figure>
                </Reveal>
              );
            })}
          </div>
        </section>
      )}

      {/* FAQ ------------------------------------------------------------------- */}
      {faqs.length > 0 && (
      <section id="faq" className="border-y border-line bg-paper py-16 sm:py-20">
        <div className="container-x grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="eyebrow mb-3">{content.home_faq_eyebrow}</p>
            <h2 className="display text-4xl leading-[1.03] sm:text-5xl">{content.home_faq_title}</h2>
            <p className="mt-4 max-w-sm text-sm leading-7 text-muted">
              {content.home_faq_description}
            </p>
            <div className="mt-6 rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-extrabold">{content.home_faq_human_title}</p>
              <p className="mt-1 text-[0.7rem] text-muted">{content.support_hours}.</p>
              <a href={`mailto:${content.support_email}`} className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">
                {content.support_email} <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          <Accordion items={faqs} />
        </div>
      </section>
      )}

      {/* CTA ------------------------------------------------------------------- */}
      <section className="container-x py-16 sm:py-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-forest px-6 py-12 text-cream sm:px-12 sm:py-16">
          <div className="absolute -right-10 -top-20 h-72 w-72 rounded-full bg-lime/25 blur-3xl" />
          <div className="absolute -bottom-24 left-1/4 h-64 w-64 rounded-full bg-coral/20 blur-[100px]" />
          <div className="absolute -left-16 top-1/2 h-56 w-56 rounded-full bg-aqua/15 blur-[100px]" />
          <div className="absolute bottom-0 right-0 hidden h-full w-1/2 opacity-25 lg:block">
            <img src={content.hero_image_url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-forest via-forest/70 to-transparent" />
          </div>
          <div className="relative max-w-xl">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.18em] text-lime">{content.home_cta_eyebrow}</p>
            <h2 className="display mt-3 text-4xl leading-[1.02] sm:text-5xl lg:text-[3.4rem]">{content.home_cta_title}</h2>
            <p className="mt-4 text-sm leading-7 text-cream/65">{fill(content.home_cta_description)}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/browse" className="btn btn-lime">{content.home_cta_primary_label} <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/register" className="btn border border-white/20 bg-white/5 text-cream hover:bg-white/10">{content.home_cta_secondary_label}</Link>
            </div>
            <p className="mt-4 text-[0.65rem] text-cream/55">{content.home_cta_manage_prefix} <Link to="/manage" className="underline underline-offset-4 hover:text-lime">{content.home_cta_manage_label}</Link>.</p>
          </div>
        </div>
      </section>
      </>)}
    </div>
  );
}
