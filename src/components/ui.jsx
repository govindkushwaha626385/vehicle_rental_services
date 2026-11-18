import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, Minus, MoveHorizontal, Plus, RefreshCw, Search, Star, X } from 'lucide-react';
import { cn, initials, statusMeta } from '../lib/format.js';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * useReveal — observe an element and add `is-visible` once it scrolls into view.
 * Returns a ref to attach to any element carrying the `reveal` class.
 * Falls back to visible immediately when IntersectionObserver is unavailable
 * or the user has asked for reduced motion.
 */
export function useReveal({ threshold = 0.15, rootMargin = '0px 0px -60px 0px', once = true } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return [ref, visible];
}

// One shared stack for every modal and drawer. Only the top layer handles
// Escape and Tab, so opening a confirmation inside a drawer cannot close both.
const dialogLayers = [];
// The page's own overflow before ANY dialog opened. When the last layer closes
// we restore this baseline — never the value a nested layer captured while the
// page was already locked, or closing a confirm-inside-drawer would leave the
// page stuck unscrollable.
let pageOverflowBaseline = '';

/**
 * Keep keyboard focus inside the topmost open dialog, restore it when that
 * dialog closes, and lock page scroll only while at least one dialog is open.
 */
function useDialogLayer(open, panelRef, onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = panelRef.current;
    if (!open || !node) return undefined;
    const previousFocus = document.activeElement;
    if (!dialogLayers.length) pageOverflowBaseline = document.body.style.overflow;
    const layer = { node, close: () => closeRef.current?.() };
    dialogLayers.push(layer);
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(node.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    // Focus synchronously: animation frames are throttled in background tabs,
    // and a dialog that opens without focus is a keyboard trap. Prefer the first
    // field over the close button so keyboard users can start typing at once.
    const firstField = Array.from(node.querySelectorAll(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    )).find((element) => element.getClientRects().length > 0);
    const initial = node.querySelector('[data-autofocus]') || firstField || focusable()[0] || node;
    initial.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (dialogLayers[dialogLayers.length - 1] !== layer) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        layer.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !node.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = dialogLayers.indexOf(layer);
      if (index >= 0) dialogLayers.splice(index, 1);
      if (!dialogLayers.length) document.body.style.overflow = pageOverflowBaseline;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef]);
}

/**
 * Reveal — wrapper that fades/slides its children in on scroll.
 * Usage: <Reveal as="section" delay={2}>…</Reveal>
 */
export function Reveal({
  as: Tag = 'div',
  children,
  className,
  delay,
  variant = '',
  threshold,
  rootMargin,
  once = true,
  ...rest
}) {
  const [ref, visible] = useReveal({ threshold, rootMargin, once });
  const variantClass = variant ? `reveal-${variant}` : '';
  const delayClass = delay ? `delay-${delay}` : '';
  return (
    <Tag
      ref={ref}
      className={cn('reveal', variantClass, delayClass, visible && 'is-visible', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Logo({ dark = false, compact = false, to = '/' }) {
  return (
    <Link to={to} className={cn('group inline-flex items-baseline gap-0.5', dark ? 'text-cream' : 'text-ink')}>
      <span className={cn('display leading-none transition-transform duration-300 group-hover:-translate-y-0.5', compact ? 'text-2xl' : 'text-[1.85rem]')}>rove</span>
      <span className={cn('mb-0.5 inline-block rounded-full bg-lime shadow-[0_0_0_4px_rgba(217,247,95,0.14)] transition-transform duration-300 group-hover:scale-125', compact ? 'h-1.5 w-1.5' : 'h-2 w-2')} />
    </Link>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label = 'Starting the engine…' }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-ink">
      <Logo compact />
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="h-4 w-4" />
        {label}
      </div>
    </div>
  );
}

export function Stars({ value = 5, count, size = 'h-3.5 w-3.5', className, showValue = true }) {
  const rounded = Math.round(Number(value) || 0);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(size, star <= rounded ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-stone-300')}
          />
        ))}
      </span>
      {showValue && <span className="text-xs font-bold text-ink">{Number(value || 0).toFixed(1)}</span>}
      {count !== undefined && count !== null && (
        <span className="text-xs text-muted">({count})</span>
      )}
    </span>
  );
}

export function StatusPill({ status, label, className }) {
  const meta = statusMeta[status] ?? { label: status, tone: 'bg-stone-100 text-stone-700 border-stone-200', dot: 'bg-stone-400' };
  return (
    <span className={cn('badge border', meta.tone, className)}>
      <span className={cn('status-dot', meta.dot)} />
      {label ?? meta.label}
    </span>
  );
}

/**
 * Tag — shadcn/ui-inspired keyword chip for filter selections, keywords and
 * compact metadata. Supports optional remove button for filter-type usage.
 */
const TAG_VARIANTS = {
  default: 'bg-paper text-ink border-line',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  accent: 'bg-lime/20 text-ink border-lime',
};
export function Tag({
  label = '',
  variant = 'default',
  removable = false,
  onRemove,
  size = 'md',
  className,
}) {
  if (!label) return null;
  const sizes = { sm: 'text-[0.6rem] py-0.5', md: 'text-[0.72rem] py-1', lg: 'text-xs py-1.5' };
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 font-semibold transition hover:shadow-[0_4px_12px_-8px_rgba(10,15,11,0.12)]',
      TAG_VARIANTS[variant] ?? TAG_VARIANTS.default,
      sizes[size] ?? sizes.md,
      className,
    )}>
      {label}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="flex h-4 w-4 items-center justify-center rounded-full text-current/60 hover:bg-current/10 hover:text-current"
          aria-label={`Remove ${label}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function Avatar({ name = '', src, size = 'md', className }) {
  const sizes = {
    sm: 'h-8 w-8 text-[0.65rem]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-14 w-14 text-base',
    xl: 'h-20 w-20 text-xl',
  };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-forest font-bold tracking-wide text-cream ring-2 ring-white/60',
        sizes[size],
        className
      )}
      aria-hidden={!name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function Field({ label, htmlFor, hint, error, required, children, className }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label} {required && <span className="text-rose-600">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1.5 text-[0.7rem] leading-4 text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-[0.72rem] font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

/**
 * SearchField — the one search input used across the console.
 *
 * Keeps the magnifier, the clear button and the accessible label in sync so a
 * long list can always be narrowed without the input fighting a native
 * `type="search"` cancel button.
 */
export function SearchField({ value, onChange, placeholder = 'Search', label, className, id, inputRef }) {
  return (
    <div className={cn('input-group relative', className)}>
      <Search className="input-icon h-4 w-4" aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        className="field pr-9"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted transition hover:bg-paper hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition',
          checked ? 'border-ink bg-ink' : 'border-stone-300 bg-stone-200'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[1.4rem]' : 'left-0.5'
          )}
          style={{ height: '1.125rem', width: '1.125rem' }}
        />
      </button>
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', hideClose = false }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogLayer(open, panelRef, onClose);

  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/60 p-0 backdrop-blur-md sm:items-center sm:p-6">
      <button type="button" tabIndex={-1} className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/40 bg-paper/98 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.7)] animate-rise backdrop-blur-xl sm:rounded-3xl',
          sizes[size]
        )}
      >
        <div className="h-1 shrink-0 bg-gradient-to-r from-lime via-aqua to-coral" />
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              {title && <h2 id={titleId} className="text-lg font-bold tracking-tight text-ink">{title}</h2>}
              {description && <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted">{description}</p>}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-line bg-white p-2 text-muted transition hover:border-ink hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-line bg-white/70 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, title, description, children, footer, width = 'max-w-xl' }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogLayer(open, panelRef, onClose);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end bg-ink/55 backdrop-blur-md">
      <button type="button" tabIndex={-1} className="absolute inset-0 cursor-default" aria-label="Close panel" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title ? undefined : 'Panel'}
        tabIndex={-1}
        className={cn('relative flex h-full w-full flex-col border-l border-white/30 bg-paper/98 shadow-[-30px_0_90px_-40px_rgba(0,0,0,0.6)] animate-rise backdrop-blur-xl', width)}
      >
        <div className="h-1 shrink-0 bg-gradient-to-r from-lime via-aqua to-coral" />
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line bg-white p-2 text-muted transition hover:border-ink hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-line bg-white px-5 py-4 sm:px-6">{footer}</div>}
      </aside>
    </div>,
    document.body
  );
}

export function TableScrollHint({ className }) {
  return (
    <p className={cn('mb-2 flex items-center gap-1.5 text-[0.62rem] font-semibold text-muted md:hidden', className)}>
      <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-forest" aria-hidden="true" />
      Swipe or use arrow keys to see all columns
    </p>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-moss/25 bg-white/65 px-6 py-14 text-center backdrop-blur-sm', className)}>
      <div className="pointer-events-none absolute inset-x-16 top-0 h-32 bg-gradient-to-b from-lime/16 to-transparent blur-2xl" />
      {Icon && (
        <span className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/80 bg-gradient-to-br from-lime/55 via-white to-aqua/30 text-ink shadow-[0_16px_34px_-24px_rgba(11,15,12,0.5)]">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <h3 className="relative text-lg font-extrabold tracking-tight">{title}</h3>
      {description && <p className="relative mt-1.5 max-w-sm text-sm leading-6 text-muted">{description}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}

/**
 * Pagination — paging controls for admin tables. Renders nothing when there is
 * only one page, so tables that have always been single-page keep their layout
 * exactly as before. `label` is the optional context line (e.g. "Showing 1–25
 * of 340"), `size`/`onSizeChange` add an opt-in rows-per-page picker.
 */
export function Pagination({
  page,
  totalPages,
  onPage,
  label = '',
  size,
  onSizeChange,
  sizeOptions = [25, 50, 100],
  className,
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <p className="text-[0.62rem] font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {onSizeChange && (
          <label className="flex items-center gap-1.5 text-[0.62rem] font-semibold text-muted">
            Rows
            <select
              value={size}
              onChange={(event) => onSizeChange(Number(event.target.value))}
              className="field h-8 w-auto py-1 text-[0.62rem]"
              aria-label="Rows per page"
            >
              {sizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn btn-white btn-sm">
          ← Prev
        </button>
        <span className="px-1 text-[0.62rem] font-bold text-muted" aria-live="polite">
          Page {page} of {totalPages}
        </span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="btn btn-white btn-sm">
          Next →
        </button>
      </div>
    </nav>
  );
}

/**
 * LoadError — the inline counterpart to a toast.
 *
 * An admin page that only shows a toast and then renders its empty state is
 * indistinguishable from a genuinely empty workspace. This panel keeps the
 * failure visible and gives the operator a retry without reloading the app.
 */
export function LoadError({
  title = 'This page could not load',
  message = '',
  hint = '',
  onRetry,
  retryLabel = 'Try again',
  className,
}) {
  return (
    <div role="alert" className={cn('rounded-2xl border border-rose-200 bg-rose-50 p-5', className)}>
      <p className="flex items-center gap-2 text-sm font-extrabold text-rose-900">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {title}
      </p>
      {message && <p className="mt-1 break-words text-[0.7rem] leading-5 text-rose-800/80">{message}</p>}
      {hint && <p className="mt-1 text-[0.66rem] leading-5 text-rose-800/70">{hint}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-white btn-sm mt-3">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {retryLabel}
        </button>
      )}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action, align = 'left', className }) {
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h2 className="display text-4xl leading-[1.05] sm:text-5xl">{title}</h2>
        {description && <p className="mt-4 text-sm leading-7 text-muted sm:text-[0.95rem]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Accordion({ items, className }) {
  const [openIndex, setOpenIndex] = useState(0);
  const baseId = useId();
  return (
    <div className={cn('divide-y divide-line rounded-3xl border border-line bg-white', className)}>
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const question = item.q ?? item.question ?? '';
        const answer = item.a ?? item.answer ?? '';
        return (
          <div key={`${question}-${index}`}>
            <button
              type="button"
              id={`${baseId}-${index}-button`}
              aria-controls={`${baseId}-${index}-panel`}
              className={cn(
                'group flex w-full items-center justify-between gap-6 px-5 py-5 text-left transition hover:bg-lime/[0.07] sm:px-6',
                isOpen && 'bg-lime/[0.08]'
              )}
              onClick={() => setOpenIndex(isOpen ? -1 : index)}
              aria-expanded={isOpen}
            >
              <span className="text-sm font-bold text-ink sm:text-[0.95rem]">{question}</span>
              <span className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition duration-300',
                isOpen ? 'rotate-180 border-ink bg-ink text-lime shadow-md' : 'border-line bg-paper text-ink group-hover:border-moss/40 group-hover:bg-white'
              )}>
                {isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              </span>
            </button>
            <div
              id={`${baseId}-${index}-panel`}
              role="region"
              aria-labelledby={`${baseId}-${index}-button`}
              aria-hidden={!isOpen}
              className={cn('grid transition-all duration-300', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-sm leading-7 text-muted sm:px-6">{answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-xl bg-stone-200/80', className)} />;
}

export function SelectChevron() {
  return <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />;
}

export function DemoBadge({ className }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-ink', className)}>
      Demo
    </span>
  );
}

/**
 * Scroll-to-top floating action button. Appears once the user scrolls past the
 * given threshold (in pixels), and smoothly scrolls the page to the top on click.
 */
export function ScrollToTop({ threshold = 400, position = 'right-6 bottom-6' }) {
  const [visible, setVisible] = useState(false);

  const getScroll = () => document.documentElement.scrollTop || document.body.scrollTop || 0;

  useEffect(() => {
    const onScroll = () => setVisible(getScroll() > threshold);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        'fixed z-50 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/90 text-ink shadow-[0_12px_40px_-20px_rgba(10,15,11,0.6)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-soft active:scale-95',
        position
      )}
      aria-label="Scroll to top"
    >
      <ChevronUp className="h-5 w-5" />
    </button>
  );
}

/**
 * CopyButton — click to copy text to the clipboard. Shows a brief "Copied!"
 * confirmation (shadcn/ui-inspired inline feedback). Falls back to a toast
 * when the clipboard API is unavailable.
 */
export function CopyButton({
  text = '',
  label = 'Copy code',
  copiedLabel = 'Copied!',
  fallbackLabel = 'Link copied',
  className = '',
}) {
  const [done, setDone] = useState(false);
  let fallbackUsed = false;

  const copy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackUsed = true;
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      } catch {
        // Clipboard unavailable; caller can use the toast fallback themselves.
      }
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1 text-[0.6rem] font-bold text-muted transition hover:border-ink hover:text-ink active:scale-95',
        done && 'border-forest! bg-lime/20 text-forest!',
        className
      )}
      aria-label={label}
    >
      {done ? <Check className="h-3.5 w-3.5 text-forest" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? copiedLabel : label}
    </button>
  );
}

/**
 * Kbd — shadcn/ui-inspired keyboard-key chip. Keeps the ⌘K hints and any
 * future shortcut labels visually consistent instead of hand-styled <kbd>s.
 */
export function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md border border-line bg-paper px-1.5 font-mono text-[0.58rem] font-bold text-muted shadow-[0_1px_0_rgba(10,15,11,0.06)]',
        className
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Tooltip — shadcn/ui composition (Tooltip → Trigger → Content).
 *
 * Wraps any single child and shows `content` on hover *and* keyboard focus,
 * wired via `aria-describedby` so screen readers announce it too. The trigger
 * keeps its own accessible name; the tooltip only adds context.
 *
 * <Tooltip content="Pick-up time"><span>{time}</span></Tooltip>
 */
export function Tooltip({ content, side = 'top', children, className }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef(null);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 160);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {cloneElement(children, open ? { 'aria-describedby': id } : {})}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-[130] w-max max-w-[17rem] rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-[0.66rem] font-semibold leading-4 text-cream shadow-[0_16px_44px_-18px_rgba(0,0,0,0.7)] animate-pop',
            side === 'bottom'
              ? 'top-full left-1/2 mt-1.5 -translate-x-1/2'
              : 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * SortableHeader — shadcn Data Table style sortable column header.
 * Renders a button that cycles asc/desc and shows the active direction with a
 * stacked chevron. `sort` is the { key, dir } object from `useSort`.
 */
export function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align = 'left',
  className,
}) {
  const active = sort?.key === column;
  const ascending = active && sort?.dir === 'asc';
  return (
    <th
      className={cn(align === 'right' && 'text-right', className)}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'group inline-flex items-center gap-1 transition hover:text-ink',
          active && 'text-ink'
        )}
        aria-label={`Sort by ${label}${active ? `, currently ${ascending ? 'ascending' : 'descending'}` : ''}`}
      >
        {label}
        <span aria-hidden="true" className="flex flex-col leading-none">
          <ChevronUp className={cn('h-2.5 w-2.5', ascending ? 'text-ink' : 'text-muted/40')} />
          <ChevronDown className={cn('-mt-0.5 h-2.5 w-2.5', active && !ascending ? 'text-ink' : 'text-muted/40')} />
        </span>
      </button>
    </th>
  );
}
