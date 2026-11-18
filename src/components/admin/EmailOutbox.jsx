import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  MailX,
  MinusCircle,
  PencilLine,
  RefreshCw,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import { api, isDemo } from '../../lib/api.js';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { usePagination } from '../../hooks/usePagination.js';
import { useToast } from '../../context/ToastContext.jsx';
import { CopyButton, EmptyState, Pagination } from '../ui.jsx';
import { EMAIL_TEMPLATE_KINDS, emailTemplateLabel } from '../../lib/emailTemplates.js';
import { cn } from '../../lib/format.js';

const DELIVERY = {
  queued: { label: 'Queued', icon: Clock, tone: 'border-sky-200 bg-sky-50 text-sky-900', dot: 'bg-sky-500' },
  sent: { label: 'Sent', icon: CheckCircle2, tone: 'border-emerald-200 bg-emerald-50 text-emerald-900', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', icon: XCircle, tone: 'border-rose-200 bg-rose-50 text-rose-900', dot: 'bg-rose-500' },
  skipped: { label: 'Skipped', icon: MinusCircle, tone: 'border-stone-200 bg-stone-100 text-stone-700', dot: 'bg-stone-400' },
};

const deliveryMeta = (status) => DELIVERY[status] || {
  label: status || 'Unknown',
  icon: Mail,
  tone: 'border-line bg-paper text-muted',
  dot: 'bg-stone-400',
};

const STATUS_KEYS = ['queued', 'sent', 'failed', 'skipped'];

const when = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const isEmailKind = (kind) => EMAIL_TEMPLATE_KINDS.includes(kind);

/**
 * Email outbox — what was actually queued/sent, not just what the template says.
 *
 * The notification log already existed in both adapters; this is the missing
 * read surface. Three jobs:
 *   1. prove a customer message went out (or explain why it did not);
 *   2. show the rendered subject/body, so an admin can verify a template edit;
 *   3. re-queue a lost message in one confirmed click.
 */
export default function EmailOutbox({ onEditTemplate }) {
  const { push } = useToast();
  const guard = useRequestGuard();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [confirmResend, setConfirmResend] = useState(false);
  const [resending, setResending] = useState(false);

  const load = async () => {
    const token = guard.make();
    setLoading(true);
    setLoadError('');
    try {
      const next = await api.adminNotificationLog(200);
      if (!guard.isCurrent(token)) return;
      setRows(next);
    } catch (error) {
      if (!guard.isCurrent(token)) return;
      setLoadError(error.message);
    } finally {
      if (guard.isCurrent(token)) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const base = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
    rows.forEach((row) => {
      if (row.status in base) base[row.status] += 1;
    });
    return base;
  }, [rows]);

  const kinds = useMemo(
    () => [...new Set(rows.map((row) => row.kind).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (kind !== 'all' && row.kind !== kind) return false;
      if (!needle) return true;
      return [row.recipient, row.subject, row.body, row.kind, row.meta?.code]
        .some((value) => String(value ?? '').toLowerCase().includes(needle));
    });
  }, [rows, status, kind, query]);

  // Page the filtered window — the log is capped at 200 but an operator should
  // never have to scroll 200 rows to find one message.
  const pagination = usePagination({
    items: filtered,
    resetKey: `${query}|${status}|${kind}`,
    pageSize: 50,
  });
  const pageRows = pagination.rows;

  const selected = useMemo(() => {
    if (selectedId) {
      const hit = filtered.find((row) => row.id === selectedId);
      if (hit) return hit;
    }
    return filtered[0] ?? null;
  }, [filtered, selectedId]);

  useEffect(() => {
    setConfirmResend(false);
  }, [selected?.id]);

  const canResend = Boolean(selected && selected.channel === 'email' && selected.recipient);

  const resend = async () => {
    if (!selected || !canResend || resending) return;
    setResending(true);
    try {
      const copy = await api.adminResendEmail({ id: selected.id });
      setRows((current) => [copy, ...current]);
      // Reveal the fresh row even if a status filter would have hidden it.
      setStatus('all');
      setKind('all');
      setSelectedId(copy.id);
      setConfirmResend(false);
      push('Queued again. The dispatcher will send it on its next run.', 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setResending(false);
    }
  };

  const resetFilters = () => {
    setQuery('');
    setStatus('all');
    setKind('all');
  };

  const filtersActive = Boolean(query.trim()) || status !== 'all' || kind !== 'all';
  const selectedDelivery = selected ? deliveryMeta(selected.status) : null;
  const selectedTemplate = selected && isEmailKind(selected.kind) ? selected.kind : '';
  const bookingCode = selected?.meta?.code ? String(selected.meta.code) : '';

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Delivery health across the latest 200 messages" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {STATUS_KEYS.map((key) => {
          const meta = deliveryMeta(key);
          const active = status === key;
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(active ? 'all' : key)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-3 rounded-2xl border bg-white px-3.5 py-3 text-left transition hover:border-ink/30',
                active ? 'border-ink/40 shadow-[0_10px_24px_-20px_rgba(11,15,12,0.6)]' : 'border-line'
              )}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-lg font-extrabold leading-none">{count}</span>
                <span className="mt-1 block text-[0.58rem] font-bold uppercase tracking-[0.12em] text-muted">{meta.label}</span>
              </span>
              {key === 'failed' && count > 0 && (
                <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wide text-rose-800">
                  Needs a look
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">Search the outbox</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search recipient, subject, body or booking"
              className="field h-9 w-full pl-8 text-[0.72rem]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[0.6rem] font-bold text-muted">
            <span className="sr-only">Filter by status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="field h-9 w-auto text-[0.68rem]">
              <option value="all">All statuses</option>
              {STATUS_KEYS.map((key) => <option key={key} value={key}>{deliveryMeta(key).label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[0.6rem] font-bold text-muted">
            <span className="sr-only">Filter by template</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)} className="field h-9 w-auto max-w-[13rem] text-[0.68rem]">
              <option value="all">All templates</option>
              {kinds.map((item) => <option key={item} value={item}>{emailTemplateLabel(item)}</option>)}
            </select>
          </label>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="btn btn-ghost btn-sm">Clear</button>
          )}
          <button type="button" onClick={load} disabled={loading} className="btn btn-white btn-sm ml-auto">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </button>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-2 p-3">
            {[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-stone-200/60" />)}
          </div>
        ) : loadError ? (
          <div className="p-5">
            <p className="flex items-center gap-2 text-sm font-extrabold text-rose-900"><AlertTriangle className="h-4 w-4" /> The outbox could not load</p>
            <p className="mt-1 text-[0.7rem] text-rose-800/80">{loadError}</p>
            <button type="button" onClick={load} className="btn btn-white btn-sm mt-3">Try again</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Mail}
              title="No messages yet"
              description={isDemo
                ? 'Bookings, reminders and refunds queue their customer emails here as you use the demo.'
                : 'Transactional emails appear here as soon as the notify dispatcher records them.'}
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={MailX}
              title="No messages match"
              description="Try a different search or clear the delivery-status filter."
              action={<button type="button" onClick={resetFilters} className="btn btn-dark btn-sm">Clear filters</button>}
            />
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_26rem]">
            <ul
              aria-label="Email delivery history"
              className="order-2 max-h-none divide-y divide-line overflow-y-auto lg:order-1 lg:max-h-[36rem]"
            >
              {pageRows.map((row) => {
                const meta = deliveryMeta(row.status);
                const Icon = meta.icon;
                const active = selected?.id === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-start gap-3 px-3.5 py-3 text-left transition',
                        active ? 'bg-lime/10' : 'hover:bg-paper'
                      )}
                    >
                      <span className={cn('mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border', meta.tone)}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[0.74rem] font-extrabold">{row.recipient || 'No recipient'}</span>
                          <span className="shrink-0 text-[0.56rem] font-semibold text-muted">{when(row.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[0.7rem] text-muted">{row.subject || '(no subject)'}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-paper px-1.5 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wide text-muted">
                            {emailTemplateLabel(row.kind)}
                          </span>
                          <span className={cn('rounded-full border px-1.5 py-0.5 text-[0.52rem] font-bold', meta.tone)}>{meta.label}</span>
                          {row.meta?.resentFrom && (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[0.52rem] font-bold text-amber-800">Resent</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtered.length > 0 && (
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPage={pagination.setPage}
                size={pagination.size}
                onSizeChange={pagination.setSize}
                label={`Showing ${pagination.start + 1}–${pagination.end} of ${pagination.total}`}
                className="order-3 border-t border-line px-3 py-2 lg:col-span-2"
              />
            )}

            <section
              aria-label="Selected message"
              aria-live="polite"
              className="order-1 border-b border-line bg-paper/40 p-4 lg:order-2 lg:max-h-[36rem] lg:overflow-y-auto lg:border-b-0 lg:border-l"
            >
              {selected ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[0.56rem] font-extrabold uppercase tracking-[0.12em] text-muted">Rendered message</p>
                      <h2 className="mt-1 text-[0.95rem] font-extrabold leading-snug">{selected.subject || '(no subject)'}</h2>
                    </div>
                    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.56rem] font-extrabold', selectedDelivery.tone)}>
                      <selectedDelivery.icon className="h-3 w-3" aria-hidden="true" /> {selectedDelivery.label}
                    </span>
                  </div>

                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[0.66rem]">
                    <dt className="font-bold text-muted">To</dt>
                    <dd className="truncate font-semibold">{selected.recipient || '—'}</dd>
                    <dt className="font-bold text-muted">Template</dt>
                    <dd className="truncate">{emailTemplateLabel(selected.kind)}</dd>
                    <dt className="font-bold text-muted">Queued</dt>
                    <dd>{when(selected.createdAt)}</dd>
                    <dt className="font-bold text-muted">Channel</dt>
                    <dd className="capitalize">{selected.channel}</dd>
                    {bookingCode && (
                      <>
                        <dt className="font-bold text-muted">Booking</dt>
                        <dd>
                          <Link to={`/admin/bookings?code=${encodeURIComponent(bookingCode)}`} className="inline-flex items-center gap-1 font-extrabold text-forest underline-offset-2 hover:underline">
                            {bookingCode} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </dd>
                      </>
                    )}
                  </dl>

                  {selected.meta?.resentFrom && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[0.62rem] leading-5 text-amber-900">
                      This is a resend of an earlier message. The original stays in the log for the audit trail.
                    </p>
                  )}

                  <div className="rounded-xl border border-line bg-white">
                    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
                      <span className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Body</span>
                      <CopyButton text={selected.body} label="Copy body" copiedLabel="Copied" />
                    </div>
                    <div className="max-h-64 overflow-y-auto px-3 py-2.5">
                      <p className="whitespace-pre-wrap break-words font-sans text-[0.72rem] leading-6 text-ink">{selected.body || '(empty body)'}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canResend && !confirmResend && (
                      <button type="button" onClick={() => setConfirmResend(true)} className="btn btn-dark btn-sm">
                        <Send className="h-3.5 w-3.5" /> Resend email
                      </button>
                    )}
                    {selectedTemplate && onEditTemplate && (
                      <button type="button" onClick={() => onEditTemplate(selectedTemplate)} className="btn btn-ghost btn-sm">
                        <PencilLine className="h-3.5 w-3.5" /> Edit template
                      </button>
                    )}
                  </div>

                  {canResend && confirmResend && (
                    <div role="alertdialog" aria-label="Confirm resend" className="rounded-xl border border-ink/15 bg-white p-3">
                      <p className="text-[0.68rem] font-semibold leading-5">
                        Send a fresh copy to <span className="font-extrabold">{selected.recipient}</span>?
                        {selected.kind === 'booking_confirmed' && ' They will receive the same voucher details again.'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={resend} disabled={resending} className="btn btn-dark btn-sm">
                          {resending ? 'Queuing…' : 'Yes, resend'}
                        </button>
                        <button type="button" onClick={() => setConfirmResend(false)} disabled={resending} className="btn btn-ghost btn-sm">Cancel</button>
                      </div>
                    </div>
                  )}

                  {!canResend && selected.channel !== 'email' && (
                    <p className="text-[0.62rem] text-muted">Only email messages can be resent from here.</p>
                  )}
                </div>
              ) : (
                <p className="text-[0.7rem] text-muted">Select a message to see what the customer received.</p>
              )}
            </section>
          </div>
        )}
      </div>

      <p className="text-[0.62rem] leading-5 text-muted">
        {isDemo
          ? 'Demo mode never sends real mail — every message stays in this local queue so you can inspect the rendered content.'
          : 'Statuses come from the notify dispatcher: queued rows are picked up next, sent means the provider accepted them, skipped means the customer opted out, failed needs a retry.'}
        {' '}Showing the latest {rows.length} message{rows.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
