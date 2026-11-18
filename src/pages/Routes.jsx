import { useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bike, CalendarDays, Car, Compass, MapPin, Sparkles,
} from 'lucide-react';
import SearchWidget from '../components/SearchWidget.jsx';
import { EmptyState, SectionHeading } from '../components/ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { emphasize, getSiteContent } from '../lib/site.js';
import { cn } from '../lib/format.js';

export default function Routes() {
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const navigate = useNavigate();
  const widgetRef = useRef(null);

  // The "Build your own trip" card carries the inline search widget — the CTA
  // scrolls to it and moves the caret into the first field instead of trying
  // to open a modal that has never existed.
  const focusTripFinder = () => {
    const node = widgetRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const firstField = node.querySelector('input:not([type="hidden"])');
    firstField?.focus?.({ preventScroll: true });
  };

  const routes = useMemo(() => {
    const names = new Set((meta.locations ?? []).map((location) => location.name));
    return (content.routes ?? []).map((route) => ({
      ...route,
      knownFrom: names.has(route.from),
      knownTo: names.has(route.to),
    }));
  }, [content.routes, meta.locations]);

  const onSearch = (values) => {
    const next = new URLSearchParams({
      location: values.location,
      dropoff: values.dropoff,
      from: values.from,
      to: values.to,
      pickupTime: values.pickupTime,
      dropoffTime: values.dropoffTime,
    });
    if (values.kind) next.set('kind', values.kind);
    if (values.type) next.set('type', values.type);
    navigate(`/browse?${next.toString()}`);
  };

  return (
    <div className="pb-20">
      <section className="relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-aqua/15 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-lime/20 blur-[100px]" />
        <div className="container-x relative py-8 sm:py-12">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/15 px-3 py-1 text-[0.6rem] font-extrabold uppercase tracking-wider text-forest">
            <Sparkles className="h-3 w-3" /> {content.routes_badge}
          </span>
          <p className="eyebrow mt-3">{content.routes_eyebrow}</p>
          <h1 className="display text-4xl leading-none sm:text-5xl lg:text-[3.6rem]">
            {emphasize(content.routes_title).map((part, index) => (
              part.italic
                ? <span key={index} className="italic text-forest">{part.text}</span>
                : <span key={index}>{part.text}</span>
            ))}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-[0.95rem]">{content.routes_description}</p>
        </div>
      </section>

      <div className="container-x pt-7">
        {routes.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {routes.map((route) => {
              const to = `/browse?location=${encodeURIComponent(route.from)}&dropoff=${encodeURIComponent(route.to)}${route.kind ? `&kind=${route.kind}` : ''}`;
              const round = route.from === route.to;
              return (
                <article key={route.label} className="group card card-hover overflow-hidden">
                  <div className={cn(
                    'relative flex items-center justify-between bg-gradient-to-br px-4 py-3.5',
                    route.kind === 'bike' ? 'from-sun/40 via-white to-white' : 'from-ink via-ink to-lime-deep',
                  )}>
                    <span className={cn('flex h-10 w-10 items-center justify-center rounded-2xl', route.kind === 'bike' ? 'bg-sun/30 text-ink' : 'bg-white/15 text-lime')}>
                      {route.kind === 'bike' ? <Bike className="h-5 w-5" /> : <Car className="h-5 w-5" />}
                    </span>
                    {route.badge && (
                      <span className="rounded-full border border-lime/30 bg-lime/20 px-2.5 py-1 text-[0.56rem] font-extrabold uppercase tracking-wider text-ink">
                        {route.badge}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="text-lg font-extrabold tracking-tight">{route.label}</h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.68rem] text-muted">
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-moss" /> {content.routes_from_label} {route.from}</span>
                      <ArrowRight className="h-3 w-3 text-muted" />
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-moss" /> {content.routes_to_label} {route.to}</span>
                    </p>
                    {route.copy && <p className="mt-2 text-[0.7rem] leading-5 text-muted">{route.copy}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.58rem] font-bold">
                        <Compass className="h-3 w-3 text-muted" /> {round ? content.routes_round_trip : content.routes_one_way}
                      </span>
                      {route.kind && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.58rem] font-bold">
                          {route.kind === 'bike' ? content.routes_kind_bike : content.routes_kind_car}
                        </span>
                      )}
                    </div>
                    <Link to={to} className="btn btn-dark btn-sm mt-3 w-full">{content.routes_view_fleet} <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Compass}
            title={content.routes_empty_title}
            description={content.routes_empty_description}
            action={<Link to="/browse" className="btn btn-dark">{content.routes_empty_cta} <ArrowRight className="h-4 w-4" /></Link>}
          />
        )}

        <div className="mt-12 rounded-3xl border border-line bg-white p-5 shadow-card">
          <SectionHeading
            eyebrow={content.routes_eyebrow}
            title={content.routes_own_title}
            description={content.routes_own_description}
            action={<button type="button" onClick={focusTripFinder} className="btn btn-lime btn-sm"><CalendarDays className="h-3.5 w-3.5" /> {content.routes_own_cta}</button>}
          />
          <div ref={widgetRef} className="mt-5 rounded-2xl border border-line bg-paper/70 p-4">
            <SearchWidget variant="compact" onSearch={onSearch} className="border-0 p-0 shadow-none" />
          </div>
        </div>
      </div>
    </div>
  );
}