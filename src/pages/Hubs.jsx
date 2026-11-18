import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, Clock, Map as MapIcon, MapPin, Phone, RefreshCw, Sparkles, Users,
} from 'lucide-react';
import { Skeleton } from '../components/ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { api } from '../lib/api.js';
import { emphasize, getSiteContent } from '../lib/site.js';
import { cn, inr } from '../lib/format.js';
import { typicalDayRate } from '../lib/pricing.js';

export default function Hubs() {
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const [byHub, setByHub] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.listVehicles({ sort: 'recommended' })
      .then((result) => {
        if (!alive) return;
        const counts = {};
        (result.vehicles ?? []).forEach((vehicle) => {
          const entry = counts[vehicle.location] ?? (counts[vehicle.location] = { count: 0, min: Number.POSITIVE_INFINITY, minAllIn: Number.POSITIVE_INFINITY });
          entry.count += 1;
          const price = Number(vehicle.pricePerDay);
          if (Number.isFinite(price) && price > 0) entry.min = Math.min(entry.min, price);
          const allIn = typicalDayRate(vehicle, meta.settings, meta.insuranceTiers);
          if (allIn) entry.minAllIn = Math.min(entry.minAllIn, allIn);
        });
        Object.values(counts).forEach((entry) => {
          entry.min = Number.isFinite(entry.min) ? entry.min : null;
          entry.minAllIn = Number.isFinite(entry.minAllIn) ? entry.minAllIn : null;
        });
        setByHub(counts);
      })
      .catch((nextError) => { if (alive) setError(nextError.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.settings, meta.insuranceTiers, loadKey]);

  const hubs = meta.locations ?? [];
  const totalVisible = hubs.reduce((sum, hub) => sum + (byHub[hub.name]?.count ?? 0), 0);

  return (
    <div className="pb-20">
      <section className="relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-lime/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="container-x relative py-8 sm:py-12">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/15 px-3 py-1 text-[0.6rem] font-extrabold uppercase tracking-wider text-forest">
            <Sparkles className="h-3 w-3" /> {content.hubs_badge}
          </span>
          <p className="eyebrow mt-3">{content.hubs_eyebrow}</p>
          <h1 className="display text-4xl leading-none sm:text-5xl lg:text-[3.6rem]">
            {emphasize(content.hubs_title).map((part, index) => (
              part.italic
                ? <span key={index} className="italic text-forest">{part.text}</span>
                : <span key={index}>{part.text}</span>
            ))}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-[0.95rem]">{content.hubs_description}</p>
          <p className="mt-3 text-[0.68rem] font-semibold text-muted">
            {loading
              ? content.hubs_loading
              : content.hubs_count.replace('{count}', String(hubs.length)).replace('{vehicles}', String(totalVisible))}
          </p>
        </div>
      </section>

      <div className="container-x pt-7">
        {error && (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 shrink-0" /> {error}</span>
            <button type="button" onClick={() => setLoadKey((value) => value + 1)} className="btn btn-white btn-sm">{content.hubs_retry}</button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className="space-y-3 rounded-3xl border border-line bg-white p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        ) : (
          hubs.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-moss/25 bg-white/65 px-6 py-14 text-center">
              <p className="text-lg font-extrabold tracking-tight">{content.hubs_empty}</p>
              <Link to="/browse" className="btn btn-dark mt-4">{content.hubs_browse} <ArrowRight className="h-4 w-4" /></Link>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {hubs.map((hub) => {
                const stats = byHub[hub.name] ?? { count: 0, min: 0, minAllIn: null };
                const showAllIn = content.card_show_all_in_rate !== false && Boolean(stats.minAllIn);
                const rate = showAllIn ? stats.minAllIn : stats.min;
                const browseTo = `/browse?location=${encodeURIComponent(hub.name)}`;
                const mapTo = `/browse?location=${encodeURIComponent(hub.name)}&view=map`;
                return (
                  <article key={hub.id} className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/95 shadow-card ring-1 ring-ink/[0.05] card-hover">
                    <div className="relative overflow-hidden bg-gradient-to-br from-ink via-ink to-lime-deep px-4 pb-2.5 pt-4 text-cream">
                      <div className="pointer-events-none absolute inset-0 bg-grain opacity-30" />
                      <p className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-lime">
                        {hub.city || hub.name.split(' — ')[0]}{hub.region ? ` · ${hub.region}` : ''}
                      </p>
                      <h2 className="mt-1 text-xl font-extrabold tracking-tight text-cream">{hub.name}</h2>
                      {hub.address && <p className="mt-0.5 text-[0.66rem] text-cream/60">{hub.address}</p>}
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex flex-wrap gap-1.5">
                        {hub.phone && (
                          <a href={`tel:${String(hub.phone).replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-[0.62rem] font-bold">
                            <Phone className="h-3 w-3 text-moss" /> {hub.phone}
                          </a>
                        )}
                        {hub.hours && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-[0.62rem] font-bold">
                            <Clock className="h-3 w-3 text-moss" /> {hub.hours}
                          </span>
                        )}
                      </div>

                      <p className="mt-3 grid gap-1.5 text-[0.68rem] text-muted sm:grid-cols-2">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" /> {(stats.count === 1 ? content.hubs_vehicle : content.hubs_vehicles).replace('{count}', String(stats.count))}
                        </span>
                        <span className="inline-flex items-center gap-1.5" title={showAllIn ? content.card_all_in_note : undefined}>
                          <MapPin className="h-3.5 w-3.5" /> {rate ? `${content.hubs_from} ${inr(rate)}/day${showAllIn ? ` ${content.card_all_in_label}` : ''}` : content.hubs_price_on_request}
                        </span>
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link to={browseTo} className="btn btn-dark btn-sm flex-1">{content.hubs_browse} <ArrowRight className="h-3.5 w-3.5" /></Link>
                        <Link
                          to={mapTo}
                          aria-label={`${content.hubs_map} — ${hub.name}`}
                          title={content.hubs_map}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper text-ink transition hover:border-ink hover:bg-white"
                        >
                          <MapIcon className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        )}

        <div className="mt-10 rounded-3xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-lime/20 text-forest"><CalendarDays className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold">{content.hubs_help_title}</p>
              <p className="mt-0.5 text-[0.7rem] leading-5 text-muted">{content.hubs_help_copy}</p>
            </div>
            <a href={`tel:${String(content.support_phone).replace(/[^\d+]/g, '')}`} className="btn btn-lime btn-sm shrink-0">
              <Phone className="h-3.5 w-3.5" /> {content.support_phone}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}