import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUp, Instagram, Linkedin, Mail, MapPin, Phone, Sparkles, Twitter } from 'lucide-react';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { Logo } from './ui.jsx';

export default function Footer() {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const hubCount = meta.locations.length;
  const fleetLinks = content.bikes_enabled
    && !content.footer_fleet_links.some((link) => link.to === '/browse?kind=bike')
    ? [{ label: 'Bikes & scooters', to: '/browse?kind=bike' }, ...content.footer_fleet_links]
    : content.footer_fleet_links;
  const companyLinks = content.reviews_enabled
    && !content.footer_company_links.some((link) => link.to === '/#reviews')
    ? [...content.footer_company_links, { label: 'Reviews', to: '/#reviews' }]
    : content.footer_company_links;
  const supportLinks = content.faqs.length
    && !content.footer_support_links.some((link) => link.to === '/#faq')
    ? [...content.footer_support_links, { label: 'FAQs', to: '/#faq' }]
    : content.footer_support_links;
  const brand = content.site_name;
  const socials = [
    { href: content.social_instagram, label: `${brand} on Instagram`, icon: Instagram },
    { href: content.social_twitter, label: `${brand} on X`, icon: Twitter },
    { href: content.social_linkedin, label: `${brand} on LinkedIn`, icon: Linkedin },
  ].filter((item) => item.href);

  return (
    <footer className="relative overflow-hidden bg-ink text-cream">
      <div className="h-1 bg-gradient-to-r from-lime via-aqua to-coral" />
      <div className="pointer-events-none absolute -left-24 -top-20 h-80 w-80 rounded-full bg-lime/12 blur-[110px]" />
      <div className="pointer-events-none absolute -right-28 top-1/3 h-80 w-80 rounded-full bg-aqua/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-coral/8 blur-[120px]" />
      <div className="bg-grain pointer-events-none absolute inset-0 opacity-25" />
      <div className="container-x relative py-14 sm:py-18">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Logo dark />
            <p className="mt-5 max-w-xs text-sm leading-6 text-cream/60">
              {content.footer_tagline}
            </p>

            <div className="mt-6 space-y-2.5 text-sm text-cream/70">
              <a href={`mailto:${content.support_email}`} className="flex items-center gap-2.5 transition hover:text-lime">
                <Mail className="h-4 w-4 text-lime" /> {content.support_email}
              </a>
              <a href={`tel:${String(content.support_phone).replace(/[^\d+]/g, '')}`} className="flex items-center gap-2.5 transition hover:text-lime">
                <Phone className="h-4 w-4 text-lime" /> {content.support_phone}
              </a>
              <p className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-lime" /> {hubCount ? `${hubCount} hub${hubCount === 1 ? '' : 's'} ${content.footer_location_label.toLowerCase()}` : content.footer_location_label} · {content.support_hours}
              </p>
            </div>

            {socials.length > 0 && (
              <div className="mt-6 flex items-center gap-2">
                {socials.map(({ href, label, icon: Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-cream/70 transition hover:border-lime hover:bg-lime hover:text-ink"
                    aria-label={label}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <FooterColumn title={content.footer_fleet_title} links={fleetLinks} />
            <FooterColumn title={content.footer_company_title} links={companyLinks} />
            <FooterColumn title={content.footer_support_title} links={supportLinks} />
            <FooterColumn title={content.footer_legal_title} links={content.footer_legal_links} />
          </div>
        </div>

        <div className="relative mt-12 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-lime/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[0.58rem] font-bold uppercase tracking-wider text-cream/65">
                  <Sparkles className="h-3 w-3 text-lime" /> {content.footer_cta_eyebrow}
                </span>
                <span className="hidden rounded-full border border-white/10 px-2.5 py-1 text-[0.58rem] font-semibold text-cream/45 sm:inline-flex">
                  {content.footer_cta_badge}
                </span>
              </div>
              <p className="mt-3 text-base font-extrabold tracking-tight">{content.footer_cta_title}</p>
              <p className="mt-1 text-xs text-cream/55">{content.footer_cta_description}</p>
            </div>
            <Link to="/browse" className="btn btn-lime btn-sm shrink-0">
              {content.footer_cta_label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 text-[0.7rem] text-cream/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {content.company_legal_name.replace(/\.$/, '')}. {content.footer_rights_text}{content.gstin ? ` GSTIN ${content.gstin}.` : ''}</p>
          <div className="flex flex-wrap items-center gap-2">
            {content.footer_payment_methods.map((pay) => (
              <span key={pay} className="rounded-md border border-white/12 bg-white/[0.03] px-2 py-1 font-semibold text-cream/55">{pay}</span>
            ))}
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 font-bold text-cream/70 transition hover:border-lime hover:text-lime"
            >
              Top <ArrowUp className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-cream/55">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            {link.to.startsWith('mailto:') ? (
              <a href={link.to} className="text-xs text-cream/70 transition hover:text-lime">{link.label}</a>
            ) : (
              <Link to={link.to} className="text-xs text-cream/70 transition hover:text-lime">{link.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
