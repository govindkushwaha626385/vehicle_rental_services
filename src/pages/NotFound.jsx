import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Home } from 'lucide-react';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';

export default function NotFound() {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);

  return (
    <div className="container-x no-print relative py-16 sm:py-24">
      <div className="pointer-events-none absolute -left-32 top-0 h-72 w-72 rounded-full bg-lime/15 blur-[100px]" />
      <div className="pointer-events-none absolute -right-24 top-1/3 h-64 w-64 rounded-full bg-aqua/15 blur-[110px]" />
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="eyebrow">{content.notfound_eyebrow}</p>
          <h1 className="display mt-3 text-5xl leading-[0.95] sm:text-6xl lg:text-[4.4rem]">
            {content.notfound_title}
            <br />
            <span className="italic text-forest">{content.notfound_title_accent}</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted">{content.notfound_copy}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/" className="btn btn-lime"><Home className="h-4 w-4" /> {content.notfound_home}</Link>
            <Link to="/browse" className="btn btn-outline">{content.notfound_browse} <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <p className="mt-4 text-[0.68rem] text-muted">
            {content.notfound_manage_prefix} <Link to="/manage" className="font-bold underline decoration-lime decoration-2 underline-offset-4">{content.notfound_manage_link}</Link>.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-[2rem] bg-ink shadow-[0_40px_90px_-55px_rgba(10,15,11,0.8)]">
          <img
            src={content.notfound_image_url}
            alt={content.notfound_image_alt}
            className="aspect-[4/3] w-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-aqua/20 blur-[80px]" />
          <div className="absolute bottom-6 left-6 right-6 flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink"><Compass className="h-5 w-5" /></span>
            <div>
              <p className="text-xs font-extrabold text-cream">{content.notfound_card_title}</p>
              <p className="text-[0.62rem] text-cream/55">{content.notfound_card_copy}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
