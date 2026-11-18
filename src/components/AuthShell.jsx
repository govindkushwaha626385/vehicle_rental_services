import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Star } from 'lucide-react';
import { Logo } from './ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';

const initials = (name) => String(name || 'Rove')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join('');

export default function AuthShell({ title, subtitle, children, footer, eyebrow = '' }) {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const resolvedEyebrow = eyebrow || content.auth_default_eyebrow;
  const hubCount = meta.locations.length;
  const showRating = content.reviews_enabled && Number(content.hero_rating) > 0;
  const testimonial = content.reviews_enabled ? content.testimonials[0] : null;

  return (
    <div className="relative grid min-h-screen overflow-hidden bg-cream lg:grid-cols-[1.06fr_0.94fr]">
      <div className="pointer-events-none absolute -left-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-lime/20 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-[-10rem] left-[28%] h-80 w-80 rounded-full bg-aqua/15 blur-[120px]" />
      <div className="relative flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/" className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold text-muted transition hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> {content.auth_back_to_site}
          </Link>
        </div>

        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <p className="eyebrow">{resolvedEyebrow}</p>
          <h1 className="display mt-2 text-[2.7rem] leading-[0.98] tracking-[-0.035em] sm:text-[3rem]">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-center text-xs text-muted">{footer}</div>}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[0.6rem] text-muted">
          <span>© {new Date().getFullYear()} {content.company_legal_name}</span>
          <div className="flex items-center gap-3">
            <Link to="/terms" className="hover:text-ink">{content.auth_terms_link}</Link>
            <Link to="/privacy" className="hover:text-ink">{content.auth_privacy_link}</Link>
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {content.auth_secure_label}</span>
          </div>
        </footer>
      </div>

      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <img
          src={content.hero_image_url}
          alt={content.hero_image_alt}
          className="absolute inset-0 h-full w-full scale-[1.03] object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/55 via-transparent to-forest/20" />
        <div className="absolute -right-24 -top-20 h-80 w-80 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="absolute bottom-1/3 -left-24 h-72 w-72 rounded-full bg-coral/15 blur-[110px]" />
        <div className="bg-grain absolute inset-0 opacity-40" />
        <div className="absolute inset-x-10 top-10 h-px bg-gradient-to-r from-lime/50 via-aqua/30 to-transparent" />

        <div className="absolute inset-x-10 top-10 flex items-center justify-between text-cream/70">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" /> {content.auth_self_drive_badge}
          </span>
          <span className="text-[0.62rem] font-semibold">{content.auth_brand_mark}</span>
        </div>

        <div className="absolute inset-x-10 bottom-12 text-cream">
          <div className="relative max-w-md overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime/60 to-transparent" />
            {testimonial ? (
              <>
                {showRating && (
                  <div className="flex items-center gap-1">
                    { [1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={star <= Math.round(Number(content.hero_rating)) ? 'h-3.5 w-3.5 fill-lime text-lime' : 'h-3.5 w-3.5 text-cream/30'} />
                    ))}
                    <span className="ml-2 text-xs font-extrabold">{content.hero_rating} / 5</span>
                  </div>
                )}
                <blockquote className="mt-4 text-lg leading-7">“{testimonial.quote}”</blockquote>
                <div className="mt-5 flex items-center gap-3 border-t border-white/15 pt-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lime text-[0.62rem] font-extrabold text-ink">{initials(testimonial.name)}</span>
                  <div>
                    <p className="text-xs font-extrabold">{testimonial.name}</p>
                    <p className="text-[0.62rem] text-cream/50">{[testimonial.trip, testimonial.city].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-lime">{content.hero_eyebrow}</p>
                <p className="mt-3 text-lg leading-7">{content.footer_tagline}</p>
              </>
            )}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              [content.hero_trip_count, content.auth_trips_label],
              [hubCount ? String(hubCount) : '—', content.auth_hubs_label],
              [content.auth_handover_value, content.auth_handover_label],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2.5 shadow-[0_12px_30px_-30px_rgba(0,0,0,0.9)]">
                <p className="text-lg font-extrabold">{value}</p>
                <p className="mt-0.5 text-[0.58rem] uppercase tracking-wider text-cream/55">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
