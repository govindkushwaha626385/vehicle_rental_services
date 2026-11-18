import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LifeBuoy, Mail, MessageCircle, Phone, X } from 'lucide-react';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { cn } from '../lib/format.js';

/** Pull a booking code out of the current route when there is one in context. */
const bookingCodeFrom = (pathname = '', search = '') => {
  if (pathname.startsWith('/confirmation/')) {
    const code = decodeURIComponent(pathname.replace(/\/+$/, '').split('/').pop() || '');
    return /^RV-/.test(code) ? code : null;
  }
  if (pathname === '/manage') {
    const code = new URLSearchParams(search).get('code');
    return /^RV-/.test(code || '') ? code : null;
  }
  return null;
};

/**
 * Floating "Need a hand?" help button. One mount powers every storefront page;
 * it derives the booking code from the route so the panel can offer a
 * booking-scoped message link on confirmation, manage and account screens.
 */
export default function HelpPanel() {
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const location = useLocation();
  const code = bookingCodeFrom(location.pathname, location.search);
  const [open, setOpen] = useState(false);

  const whatsapp = String(content.whatsapp_number || content.support_phone || '').replace(/[^\d+]/g, '');
  const phoneHref = `tel:${String(content.support_phone).replace(/[^\d+]/g, '')}`;

  return (
    <div className="fixed bottom-24 right-4 z-[65] lg:bottom-6 lg:right-6">
      {open && (
        <div
          role="region"
          aria-label={content.help_title}
          className={cn(
            'mb-3 w-72 overflow-hidden rounded-3xl border border-white/20 bg-ink/95 text-cream shadow-[0_30px_90px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-rise',
            'supports-[backdrop-filter]:bg-ink/85'
          )}
        >
          <div className="h-0.5 bg-gradient-to-r from-lime via-aqua to-coral" />
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-lime">{content.support_hours}</p>
                <p className="mt-0.5 text-sm font-extrabold text-cream">{content.help_title}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={content.help_close}
                className="rounded-full p-1.5 text-cream/60 transition hover:bg-white/10 hover:text-cream"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[0.68rem] leading-5 text-cream/70">{content.help_description}</p>

            <div className="mt-3 grid gap-1.5">
              {code && (
                <Link
                  to={`/contact?booking=${encodeURIComponent(code)}`}
                  className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-[0.75rem] font-bold text-cream transition hover:bg-lime/20 hover:text-ink"
                >
                  <MessageCircle className="h-4 w-4 text-lime" /> {content.help_booking_label.replace('{code}', code)}
                </Link>
              )}
              <a href={phoneHref} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-[0.75rem] font-bold text-cream transition hover:bg-lime/20 hover:text-ink">
                <Phone className="h-4 w-4 text-lime" /> {content.help_call} · {content.support_phone}
              </a>
              <a href={`mailto:${content.support_email}`} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-[0.75rem] font-bold text-cream transition hover:bg-lime/20 hover:text-ink">
                <Mail className="h-4 w-4 text-lime" /> {content.help_email} · {content.support_email}
              </a>
              {whatsapp && (
                <a href={`https://wa.me/${String(whatsapp).replace(/^\+/, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-[0.75rem] font-bold text-cream transition hover:bg-lime/20 hover:text-ink">
                  <MessageCircle className="h-4 w-4 text-lime" /> {content.help_whatsapp}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={content.help_button_aria}
        title={content.help_button}
        className="flex h-13 w-13 items-center justify-center rounded-full border border-lime/40 bg-ink text-lime shadow-[0_18px_44px_-24px_rgba(0,0,0,0.7)] transition hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-5 w-5" /> : <LifeBuoy className="h-5 w-5" />}
      </button>
    </div>
  );
}