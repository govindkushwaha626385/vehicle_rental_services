import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, CornerDownLeft, Search, X } from 'lucide-react';
import { cn } from '../lib/format.js';

const defaultFilter = (items, query) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items.slice(0, 14);
  return items
    .filter((item) => `${item.label} ${item.detail} ${item.keywords || ''}`.toLowerCase().includes(normalized))
    .slice(0, 14);
};

/**
 * CommandPalette — ⌘K navigation for the console and the storefront.
 *
 * Keyboard model: ⌘K / Ctrl+K toggles (registered by the caller), type to
 * filter, ↑/↓ to move, ↵ to open, Esc to close. The list is announced with
 * aria-activedescendant so screen readers follow the highlighted row, and the
 * whole dialog traps focus while it is open.
 */
export default function CommandPalette({
  open,
  onClose,
  items,
  filter = defaultFilter,
  title = 'Search the console',
  placeholder = 'Search pages and actions…',
  emptyText = 'No pages or actions match “{query}”.',
  closeLabel = 'Close command palette',
  hintOpen = 'open',
  hintMove = 'move',
  hintClose = 'close',
  resultsOne = '{count} result',
  resultsMany = '{count} results',
  groupLabels = null,
  onQueryChange = null,
  loading = false,
  searchingLabel = 'Searching…',
}) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => filter(items, query), [filter, items, query]);
  const resultLabel = (matches.length === 1 ? resultsOne : resultsMany).replace('{count}', String(matches.length));

  const go = (item) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      onQueryChange?.('');
      // Focus synchronously: animation frames are throttled in background tabs,
      // and the palette is useless if the caret never lands in the input.
      inputRef.current?.focus({ preventScroll: true });
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previous;
      };
    }
    return undefined;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !matches.length) return undefined;
    if (highlight > matches.length - 1) setHighlight(0);
    return undefined;
  }, [matches.length, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (matches.length) setHighlight((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (matches.length) setHighlight((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter' && matches[highlight]) {
        event.preventDefault();
        go(matches[highlight]);
      }
      // Keep Tab inside the dialog while it is open. Arrow keys and Escape
      // are handled above; without this the caret can escape behind the
      // translucent backdrop.
      if (event.key === 'Tab') {
        const node = panelRef.current;
        if (!node || !node.contains(document.activeElement)) return;
        const items = Array.from(node.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.getClientRects().length > 0);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          node.focus({ preventScroll: true });
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, matches, highlight, onClose, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  let previousGroup = null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/55 p-4 backdrop-blur-md sm:p-6">
      <button type="button" tabIndex={-1} className="absolute inset-0 cursor-default" aria-label={closeLabel} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/40 bg-paper/98 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.7)] animate-rise backdrop-blur-xl"
      >
        <div className="h-1 shrink-0 bg-gradient-to-r from-lime via-aqua to-coral" />
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              setHighlight(0);
              onQueryChange?.(value);
            }}
            placeholder={placeholder}
            aria-label={title}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={matches[highlight] ? `palette-item-${highlight}` : undefined}
            autoComplete="off"
            spellCheck="false"
            className="field border-0 bg-transparent py-1.5 shadow-none focus:outline-none focus-visible:outline-2"
          />
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted transition hover:bg-paper hover:text-ink" aria-label={closeLabel}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div id="palette-list" role="listbox" className="max-h-[22rem] overflow-y-auto px-2 sm:px-4">
          {matches.length ? (
            matches.map((item, index) => {
              const group = groupLabels && item.group ? groupLabels[item.group] : null;
              const heading = group && group !== previousGroup;
              if (group) previousGroup = group;
              return (
                <Fragment key={`${item.label}-${item.to}`}>
                  {heading && (
                    <div role="presentation" className="px-3 py-1.5 text-[0.58rem] font-extrabold uppercase tracking-[0.12em] text-muted/80">
                      {group}
                    </div>
                  )}
                  <button
                    id={`palette-item-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => go(item)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.8rem] font-bold',
                      index === highlight ? 'bg-lime/25 text-ink' : 'text-ink/80 hover:bg-paper'
                    )}
                  >
                    {item.icon ? <item.icon className="h-4 w-4 text-forest" /> : <ArrowDown className="h-4 w-4 rotate-90 text-forest" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="truncate text-[0.62rem] text-muted">{item.detail}</span>
                    {index === highlight && <CornerDownLeft className="h-3.5 w-3.5 text-forest" />}
                  </button>
                </Fragment>
              );
            })
          ) : (
            <p className="px-4 py-8 text-center text-[0.72rem] text-muted">{emptyText.replace('{query}', query)}</p>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line/70 bg-white/60 px-4 py-2.5 text-[0.6rem] text-muted sm:px-5">
          <span className="inline-flex items-center gap-1.5"><kbd className="rounded-md border border-line bg-white px-1.5 py-0.5 font-mono text-[0.58rem] font-bold">↵</kbd> {hintOpen}</span>
          <span className="inline-flex items-center gap-1.5"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> {hintMove}</span>
          <span className="inline-flex items-center gap-1.5"><kbd className="rounded-md border border-line bg-white px-1.5 py-0.5 font-mono text-[0.58rem] font-bold">esc</kbd> {hintClose}</span>
          <span className="ml-auto text-[0.58rem] text-muted/80">
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-muted/40 border-t-forest" aria-hidden="true" />
                {searchingLabel}
              </span>
            ) : resultLabel}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}