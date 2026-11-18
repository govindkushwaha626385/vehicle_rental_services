import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Check, Compass, FileText, Headphones, Heart,
  Mail, MapPin, Phone, ShieldCheck, Sparkles, Star,
} from 'lucide-react';
import { Reveal } from '../components/ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { cn } from '../lib/format.js';
import { emphasize, fillCopy, getSiteContent } from '../lib/site.js';

const trustIcons = [ShieldCheck, Headphones, BadgeCheck, FileText];
const valueIcons = [Compass, Heart, Headphones, MapPin];

export default function About() {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const fill = (value) => fillCopy(value, content, meta.locations.length);
  const trust = content.trust_badges.slice(0, 4).map((item, index) => ({
    ...item,
    icon: trustIcons[index % trustIcons.length],
  }));
  const values = content.about_values.map((item, index) => ({
    ...item,
    icon: valueIcons[index % valueIcons.length],
  }));
  const email = content.support_email;
  const phone = content.support_phone;
  const whatsapp = content.whatsapp_number;
  const hubCount = meta.locations.length;
  const cities = hubCount > 0 ? String(hubCount) : '—';
  const showRating = content.reviews_enabled && Number(content.hero_rating) > 0;
  const stats = [
    { value: content.hero_trip_count, label: content.about_stat_trips_label, note: content.about_stat_trips_note },
    {
      value: cities,
      label: `hub${hubCount === 1 ? '' : 's'} ${content.about_stat_hubs_label}`,
      note: hubCount ? content.about_stat_hubs_note : content.about_stat_hubs_note_empty,
    },
    ...(showRating
      ? [{ value: `${content.hero_rating}/5`, label: content.about_stat_rating_label, note: content.about_stat_rating_note }]
      : []),
    { value: content.about_stat_support_value, label: content.about_stat_support_label, note: content.support_hours },
  ];

  return (
    <div>
      {/* Hero ------------------------------------------------------------------ */}
      <section className="no-print relative overflow-hidden border-b border-line bg-cream">
        <div className="absolute -right-24 top-10 h-80 w-80 rounded-full bg-lime/15 blur-3xl" />
        <div className="absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="absolute left-1/2 top-1/3 h-52 w-52 rounded-full bg-coral/10 blur-[90px]" />
        <div className="container-x relative py-16 sm:py-24">
          <Reveal>
            <p className="eyebrow">{content.about_eyebrow}</p>
            <h1 className="display mt-4 text-5xl leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.2rem]">
              {emphasize(content.about_title).map((part, index) => (
                part.italic
                  ? <span key={index} className="italic text-forest">{part.text}</span>
                  : <span key={index}>{part.text}</span>
              ))}
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-muted sm:text-[0.98rem]">
              {content.about_lead}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/browse" className="btn btn-lime">{content.about_hero_primary_label} <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/contact" className="btn btn-outline">{content.about_hero_secondary_label}</Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Mission ---------------------------------------------------------------- */}
      <section className="container-x py-14 sm:py-18">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <Reveal>
            <p className="eyebrow">{content.about_mission_eyebrow}</p>
            <h2 className="display mt-3 text-4xl leading-[1.03] sm:text-5xl">
              {content.about_mission_title}
            </h2>
          </Reveal>
          <Reveal delay={1}>
            <div className="space-y-4 text-sm leading-7 text-muted">
              <p>{content.about_mission_body}</p>
              <p>{content.about_mission_body_2}</p>
              <p className="flex items-center gap-2.5 rounded-2xl border border-lime-deep/20 bg-gradient-to-r from-lime/20 to-white p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime text-ink"><Sparkles className="h-5 w-5" /></span>
                <span className="font-bold text-ink">{content.about_mission_note}</span>
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Stats band -------------------------------------------------------------- */}
      <section className="relative overflow-hidden bg-gradient-to-br from-ink via-ink to-forest py-12 text-cream sm:py-14">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-aqua/15 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-lime/10 blur-[100px]" />
        <div className="container-x relative grid grid-cols-2 gap-x-8 gap-y-8 border-b border-white/10 pb-10 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="display text-4xl text-lime sm:text-5xl">{stat.value}</p>
              <p className="mt-1 text-xs font-bold text-cream">{stat.label}</p>
              <p className="mt-0.5 text-[0.65rem] text-cream/55">{stat.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Rove ---------------------------------------------------------------- */}
      <section className="container-x py-14 sm:py-18">
        <div className="mb-10 grid items-end gap-8 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="eyebrow">{content.about_why_eyebrow}</p>
            <h2 className="display mt-3 text-4xl leading-[1.03] sm:text-5xl">
              {content.about_why_title}
            </h2>
          </Reveal>
          <p className="text-sm leading-7 text-muted">
            {content.about_why_description}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map((item, index) => (
            <Reveal key={item.title} delay={index}>
              <div className="card-hover flex h-full flex-col rounded-3xl border border-line bg-white/95 p-6">
                <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', ['bg-lime/35 text-forest', 'bg-aqua/30 text-forest', 'bg-sun/40 text-ink', 'bg-coral/20 text-ink'][index % 4])}>
                  <item.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-sm font-extrabold tracking-tight">{item.title}</h3>
                <p className="mt-1.5 text-[0.72rem] leading-5 text-muted">{item.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Our story + values ------------------------------------------------------ */}
      <section className="border-y border-line bg-paper py-16 sm:py-20">
        <div className="container-x grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Reveal>
              <p className="eyebrow">{content.about_story_eyebrow}</p>
              <h2 className="display mt-3 text-4xl leading-[1.03] sm:text-5xl">
                {hubCount ? fill(content.about_story_title) : content.about_story_title_anywhere}
              </h2>
              <p className="mt-5 text-sm leading-7 text-muted">
                {content.about_story_body_1}
              </p>
              <p className="mt-4 text-sm leading-7 text-muted">
                {hubCount ? fill(content.about_story_body_2) : content.about_story_body_2_anywhere}
              </p>
              {showRating && (
                <div className="relative mt-8 flex items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-ink to-forest p-4 text-cream">
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-lime/15 blur-2xl" />
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-lime text-ink"><Star className="h-5 w-5 fill-ink" /></div>
                  <div>
                    <p className="text-sm font-extrabold">{content.hero_rating} out of 5, across {content.hero_trip_count} {content.hero_trip_label}</p>
                    <p className="mt-0.5 text-[0.68rem] text-cream/55">{content.home_why_rating_note}</p>
                  </div>
                </div>
              )}
            </Reveal>
          </div>

          <div>
            <Reveal>
              <p className="eyebrow">{content.about_values_eyebrow}</p>
              <h2 className="display mt-3 text-3xl leading-[1.05] sm:text-4xl">
                {content.about_values_title}
              </h2>
            </Reveal>
            <div className="mt-6 divide-y divide-line border-y border-line">
              {values.map((value, index) => (
                <Reveal key={value.title} delay={index}>
                  <div className="grid grid-cols-[4rem_1fr] gap-5 py-7 sm:grid-cols-[5rem_1fr] sm:py-8">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-forest ring-1 ring-line sm:h-14 sm:w-14">
                      <value.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                    </span>
                    <div>
                      <h3 className="text-base font-extrabold tracking-tight sm:text-lg">{value.title}</h3>
                      <p className="mt-2 max-w-md text-sm leading-7 text-muted">{value.copy}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
              <div className="flex items-center gap-2 py-5 text-[0.7rem] font-semibold text-muted">
                <Check className="h-4 w-4 text-forest" /> Still curious? Every promise above is written down in our <Link to="/terms" className="text-forest underline decoration-lime decoration-2 underline-offset-4">terms</Link>.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Talk to us --------------------------------------------------------------- */}
      <section className="container-x py-14 sm:py-18">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
          <Reveal>
            <p className="eyebrow">{content.about_talk_eyebrow}</p>
            <h2 className="display mt-3 text-4xl leading-[1.03] sm:text-5xl">
              {content.about_talk_title}
            </h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-muted">
              {content.about_talk_description}
            </p>
            <Link to="/contact" className="btn btn-dark mt-6">{content.about_talk_cta_label} <ArrowRight className="h-4 w-4" /></Link>
          </Reveal>

          <div className="space-y-3.5">
            {[
              { icon: Mail, label: 'Email', value: email, href: `mailto:${email}` },
              { icon: Phone, label: 'Phone', value: phone, href: `tel:${String(phone).replace(/[^\d+]/g, '')}` },
              { icon: ShieldCheck, label: 'WhatsApp', value: whatsapp, href: `https://wa.me/${String(whatsapp).replace(/\D/g, '')}` },
            ].filter((channel) => channel.value).map((channel) => (
              <a
                key={channel.label}
                href={channel.href}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-white px-4 py-3.5 transition duration-300 hover:-translate-y-0.5 hover:border-ink hover:shadow-soft"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-lime/40 to-aqua/25 text-forest"><channel.icon className="h-5 w-5" /></span>
                  <div>
                    <p className="text-[0.8rem] font-extrabold">{channel.label}</p>
                    <p className="mt-0.5 text-[0.68rem] text-muted">{channel.value}</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink/60 transition group-hover:text-ink" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* CTA --------------------------------------------------------------------- */}
      <section className="container-x pb-14 sm:pb-18">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-forest via-ink to-forest px-6 py-12 text-cream shadow-[0_40px_90px_-55px_rgba(10,15,11,0.8)] sm:px-12 sm:py-16">
          <div className="absolute -right-10 -top-20 h-72 w-72 rounded-full bg-lime/25 blur-3xl" />
          <div className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-coral/20 blur-[90px]" />
          <div className="absolute right-1/4 bottom-0 h-40 w-40 rounded-full bg-aqua/20 blur-[80px]" />
          <div className="relative max-w-xl">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.18em] text-lime">{content.about_cta_eyebrow}</p>
            <h2 className="display mt-3 text-4xl leading-[1.02] sm:text-5xl lg:text-[3.4rem]">
              {content.about_cta_title}
            </h2>
            <p className="mt-4 text-sm leading-7 text-cream/65">
              {content.about_cta_description}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/browse" className="btn btn-lime">{content.about_cta_primary_label} <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/register" className="btn border border-white/20 bg-white/5 text-cream hover:bg-white/10">{content.about_cta_secondary_label}</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
