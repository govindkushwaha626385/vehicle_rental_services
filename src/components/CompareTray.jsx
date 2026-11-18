import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, X } from 'lucide-react';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { cn } from '../lib/format.js';
import {
  COMPARE_EVENT,
  clearCompare,
  readCompare,
  removeFromCompare,
} from '../lib/compare.js';

/**
 * Sticky shortlist summary. It listens to the comparison event so cards,
 * the vehicle page and the tray all stay in sync without a global store.
 */
export default function CompareTray({ raised = false, className }) {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const [items, setItems] = useState(() => readCompare());

  useEffect(() => {
    const sync = () => setItems(readCompare());
    window.addEventListener(COMPARE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(COMPARE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!content.compare_enabled || !items.length) return null;

  return (
    <div className={cn('pointer-events-none fixed inset-x-0 z-40 px-3', raised ? 'bottom-24 lg:bottom-5' : 'bottom-5', className)}>
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-ink/95 p-2.5 text-cream shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <span className="inline-flex items-center gap-1.5 px-1 text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-lime">
          <ArrowLeftRight className="h-3.5 w-3.5" /> {content.compare_tray_title}
        </span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {items.map((item) => (
            <span key={item.id} className="inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-white/15 bg-white/10 py-1 pl-2.5 pr-1 text-[0.64rem] font-bold">
              <span className="truncate">{item.name}</span>
              <button
                type="button"
                onClick={() => setItems(removeFromCompare(item.id))}
                className="rounded-full p-0.5 text-cream/55 transition hover:bg-white/15 hover:text-lime"
                aria-label={content.compare_remove_aria.replace('{name}', item.name)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => { clearCompare(); setItems([]); }}
          className="px-1.5 text-[0.6rem] font-bold text-cream/50 transition hover:text-cream"
        >
          {content.compare_tray_clear}
        </button>
        <Link to="/compare" className="btn btn-lime btn-sm shrink-0">
          {content.compare_tray_cta.replace('{count}', String(items.length))}
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
