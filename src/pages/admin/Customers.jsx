import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Download, Mail, Send, ShieldAlert, Sparkles, UserCheck, Users, Wallet, X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import BarChart from '../../components/charts/BarChart.jsx';
import Donut from '../../components/charts/Donut.jsx';
import { EmptyState, LoadError, Modal, Pagination, SearchField, TableScrollHint } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { usePagination } from '../../hooks/usePagination.js';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import {
  RISK_LABELS, SEGMENT_LABELS, SEGMENT_TONES, SEGMENTS, segmentMix, topCustomers, winbackAudience,
} from '../../lib/customers.js';
import { downloadCsv } from '../../lib/csv.js';
import { renderTemplate } from '../../lib/emailTemplates.js';
import { inr, inrShort, shortDate } from '../../lib/format.js';
import { todayISO } from '../../lib/pricing.js';

const SORTS = [
  { key: 'ltv', label: 'Lifetime value' },
  { key: 'recent', label: 'Recent activity' },
  { key: 'trips', label: 'Trips' },
  { key: 'name', label: 'Name' },
];

const BULK_TEMPLATES = [
  { key: 'winback_offer', label: 'Win-back offer' },
  { key: 'customer_message', label: 'Personal note' },
];

const emptyMail = { template: 'winback_offer', subject: '', body: '' };

export default function Customers() {
  const { push } = useToast();
  const [data, setData] = useState({ customers: [], summary: null });
  const [templates, setTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [segment, setSegment] = useState('all');
  const [risk, setRisk] = useState('all');
  const [sort, setSort] = useState('ltv');
  const [selected, setSelected] = useState(new Set());
  const [mailOpen, setMailOpen] = useState(false);
  const [mailIds, setMailIds] = useState([]);
  const [mail, setMail] = useState(emptyMail);
  const [sending, setSending] = useState(false);

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const [next, tpl] = await Promise.all([api.adminCustomers(), api.adminEmailTemplates()]);
      if (!requestGuard.isCurrent(guard)) return;
      setData(next);
      setTemplates(Object.fromEntries(tpl.map((row) => [row.kind, { subject: row.subject, body: row.body }])));
    } catch (error) {
      if (!requestGuard.isCurrent(guard)) return;
      setLoadError(error.message);
      push(error.message, 'error');
    } finally {
      if (requestGuard.isCurrent(guard)) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from the ⌘K palette (/admin/customers?q=…): the query prefilters
  // the table, including when the palette is used while already on this page.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setSearch(q);
  }, [searchParams]);

  // Once the operator edits the box the deep link has done its job — drop the
  // param so a reload does not silently re-apply a stale search.
  const updateSearch = (value) => {
    setSearch(value);
    if (searchParams.get('q')) {
      const next = new URLSearchParams(searchParams);
      next.delete('q');
      setSearchParams(next, { replace: true });
    }
  };

  const summary = data.summary ?? {
    total: 0, vip: 0, loyal: 0, active: 0, lapsed: 0, prospect: 0, dormant: 0,
    guests: 0, repeatRate: 0, totalLtv: 0, avgLtv: 0, atRisk: 0, atRiskValue: 0,
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = data.customers.filter((row) => {
      const matchesSearch = !needle || `${row.name} ${row.email} ${row.phone}`.toLowerCase().includes(needle);
      const matchesSegment = segment === 'all' || (segment === 'at-risk' ? row.risk === 'high' : row.segment === segment);
      const matchesRisk = risk === 'all' || row.risk === risk;
      return matchesSearch && matchesSegment && matchesRisk;
    });
    const sorters = {
      ltv: (a, b) => b.lifetimeValue - a.lifetimeValue,
      recent: (a, b) => String(b.lastTripDate ?? '').localeCompare(String(a.lastTripDate ?? '')),
      trips: (a, b) => b.completedTrips - a.completedTrips,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...rows].sort(sorters[sort] ?? sorters.ltv);
  }, [data.customers, search, segment, risk, sort]);

  const pagination = usePagination({
    items: filtered,
    resetKey: `${search}|${segment}|${risk}|${sort}`,
    pageSize: 25,
  });
  const pageRows = pagination.rows;

  // Keep mass-email recipients aligned with what the operator can currently
  // see. Changing a filter must never leave a hidden customer selected.
  useEffect(() => {
    setSelected((current) => {
      if (!current.size) return current;
      const visible = new Set(filtered.map((row) => row.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filtered]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const openMail = (ids) => {
    const eligible = data.customers.filter((row) => ids.includes(row.id) && row.email).map((row) => row.id);
    if (!eligible.length) {
      push('Those customers do not have an email address.', 'info');
      return;
    }
    const tpl = templates.winback_offer ?? { subject: '', body: '' };
    setMailIds(eligible);
    setMail({ template: 'winback_offer', subject: tpl.subject, body: tpl.body });
    setMailOpen(true);
  };

  const pickTemplate = (key) => {
    const tpl = templates[key] ?? { subject: '', body: '' };
    setMail((current) => ({ ...current, template: key, subject: tpl.subject, body: tpl.body }));
  };

  const sendMail = async () => {
    setSending(true);
    try {
      const result = await api.adminEmailCustomers({
        customerIds: mailIds,
        template: mail.template,
        subject: mail.subject,
        body: mail.body,
      });
      push(`Queued ${result.sent} email${result.sent === 1 ? '' : 's'}${result.skipped.length ? ` · ${result.skipped.length} skipped` : ''}.`, 'success');
      setMailOpen(false);
      setSelected(new Set());
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const exportCsv = () => {
    const rows = filtered.map((row) => [
      row.name, row.email, row.phone, SEGMENT_LABELS[row.segment], RISK_LABELS[row.risk],
      row.completedTrips, row.totalBookings, row.lifetimeValue, row.lastTripDate ?? '', row.nextTripDate ?? '',
      row.favouriteType, row.favouriteHub, row.account ? 'account' : 'guest',
    ]);
    downloadCsv(`rove-customers-${todayISO()}.csv`, [[
      'name', 'email', 'phone', 'segment', 'risk', 'completed', 'bookings', 'ltv', 'last_trip', 'next_trip', 'favourite_type', 'favourite_hub', 'type',
    ], ...rows]);
    push(`Exported ${rows.length} customers.`, 'success');
  };

  const mailSample = filtered.find((row) => mailIds.includes(row.id)) ?? { name: 'Maya Chen' };
  const preview = {
    subject: renderTemplate(mail.subject, { name: mailSample.name }),
    body: renderTemplate(mail.body, { name: mailSample.name }),
  };
  // Only the customers currently visible under the search/segment/risk filters
// are eligible — a bulk win-back must never email rows the operator cannot see.
const winbackCount = winbackAudience(filtered).filter((row) => row.email).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-stone-200/70" />
        <div className="h-80 animate-pulse rounded-2xl bg-stone-200/70" />
      </div>
    );
  }

  if (loadError && !data.customers.length) {
    return (
      <LoadError
        title="Customers could not load"
        message={loadError}
        hint="Segments, lifetime value and win-back audiences all read from this list. Retry before emailing anyone."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Relationships</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Customers</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            One row per customer with lifetime value, trips, churn risk and favourite rides — so you can spot the guests worth winning back before they book elsewhere.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportCsv} className="btn btn-white btn-sm">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            type="button"
            onClick={() => openMail([...selected])}
            disabled={!selected.size}
            title={selected.size ? '' : 'Select at least one customer below.'}
            className="btn btn-dark btn-sm"
          >
            <Mail className="h-3.5 w-3.5" /> {selected.size ? `Email selected (${selected.size})` : 'Email selected'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <div className="stat-card">
          <Users className="h-4 w-4 text-moss" />
          <p className="mt-2 text-xl font-extrabold">{summary.total}</p>
          <p className="text-[0.6rem] uppercase tracking-wider text-muted">Customers</p>
          <p className="mt-0.5 text-[0.6rem] text-muted">{summary.guests} guest checkout{summary.guests === 1 ? '' : 's'}</p>
        </div>
        <div className="stat-card">
          <UserCheck className="h-4 w-4 text-forest" />
          <p className="mt-2 text-xl font-extrabold">{summary.repeatRate}%</p>
          <p className="text-[0.6rem] uppercase tracking-wider text-muted">Repeat rate</p>
          <p className="mt-0.5 text-[0.6rem] text-muted">{summary.vip} VIP · {summary.loyal} repeat</p>
        </div>
        <div className="stat-card">
          <Wallet className="h-4 w-4 text-aqua" />
          <p className="mt-2 text-xl font-extrabold">{inrShort(summary.avgLtv)}</p>
          <p className="text-[0.6rem] uppercase tracking-wider text-muted">Avg lifetime value</p>
          <p className="mt-0.5 text-[0.6rem] text-muted">{inrShort(summary.totalLtv)} total</p>
        </div>
        <div className="stat-card">
          <ShieldAlert className="h-4 w-4 text-coral" />
          <p className="mt-2 text-xl font-extrabold">{summary.atRisk}</p>
          <p className="text-[0.6rem] uppercase tracking-wider text-muted">At risk</p>
          <p className="mt-0.5 text-[0.6rem] text-muted">{inrShort(summary.atRiskValue)} at stake</p>
        </div>
        <div className="stat-card col-span-2 sm:col-span-1">
          <Sparkles className="h-4 w-4 text-sun" />
          <p className="mt-2 text-xl font-extrabold">{summary.prospect + summary.dormant}</p>
          <p className="text-[0.6rem] uppercase tracking-wider text-muted">Not yet booked</p>
          <p className="mt-0.5 text-[0.6rem] text-muted">{summary.prospect} new · {summary.dormant} dormant</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-extrabold">Segments</h2>
          <p className="mt-0.5 text-[0.64rem] text-muted">Value-based tiers from completed trips and lifetime spend.</p>
          <div className="mt-3">
            <Donut segments={segmentMix(data.customers)} centerLabel="customers" ariaLabel="Customer segments" />
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-extrabold">Top customers by lifetime value</h2>
          <p className="mt-0.5 text-[0.64rem] text-muted">The relationships carrying the most revenue.</p>
          <div className="mt-3">
            <BarChart
              rows={topCustomers(data.customers).map((row) => ({ label: row.name, value: row.lifetimeValue, sub: `${row.completedTrips} trips` }))}
              ariaLabel="Top customers by lifetime value"
              format={inrShort}
            />
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <SearchField value={search} onChange={updateSearch} placeholder="Search name, email, phone" label="Search customers" className="min-w-[13rem] flex-1" />
        <select value={segment} onChange={(event) => setSegment(event.target.value)} className="field w-auto" aria-label="Filter by segment">
          <option value="all">All segments</option>
          {SEGMENTS.map((key) => <option key={key} value={key}>{SEGMENT_LABELS[key]}</option>)}
          <option value="at-risk">At risk</option>
        </select>
        <select value={risk} onChange={(event) => setRisk(event.target.value)} className="field w-auto" aria-label="Filter by churn risk">
          <option value="all">Any risk</option>
          <option value="high">At risk</option>
          <option value="medium">Watch</option>
          <option value="low">Low risk</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)} className="field w-auto" aria-label="Sort customers">
          {SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        {winbackCount > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set(winbackAudience(filtered).filter((row) => row.email).map((row) => row.id)))}
            className="inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/15 px-2.5 py-1.5 text-[0.62rem] font-extrabold text-ink"
          >
            <Sparkles className="h-3 w-3" /> Select {winbackCount} to win back
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-2.5 text-[0.72rem]">
          <span className="font-extrabold">{selected.size} selected</span>
          <button type="button" onClick={() => openMail([...selected])} className="btn btn-dark btn-sm">
            <Mail className="h-3.5 w-3.5" /> Email selected
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[0.66rem] font-bold text-muted underline underline-offset-4">Clear</button>
        </div>
      )}

      <TableScrollHint />
      <div className="table-wrap" role="region" aria-label="Customers table" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-9">
                <input
                  type="checkbox"
                  aria-label="Select all customers on this page"
                  checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))}
                  onChange={(event) => {
                    const next = new Set(selected);
                    pageRows.forEach((row) => { if (event.target.checked) next.add(row.id); else next.delete(row.id); });
                    setSelected(next);
                  }}
                />
              </th>
              <th>Customer</th>
              <th>Segment</th>
              <th>Trips</th>
              <th>Lifetime value</th>
              <th>Last trip</th>
              <th>Next trip</th>
              <th>Favourite</th>
              <th>Risk</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td className="w-9">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.name}`} />
                </td>
                <td>
                  <p className="font-extrabold">{row.name}{!row.account && <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[0.52rem] font-extrabold text-muted">Guest</span>}</p>
                  <p className="text-[0.62rem] text-muted">{row.email || 'No email'}</p>
                </td>
                <td><span className={`rounded-full px-2 py-0.5 text-[0.56rem] font-extrabold ${SEGMENT_TONES[row.segment]}`}>{SEGMENT_LABELS[row.segment]}</span></td>
                <td className="whitespace-nowrap">{row.completedTrips}<span className="text-muted">/{row.totalBookings}</span></td>
                <td className="whitespace-nowrap font-bold">{inr(row.lifetimeValue)}</td>
                <td className="whitespace-nowrap text-[0.68rem]">
                  {row.lastTripDate ? (
                    <span>
                      {shortDate(row.lastTripDate)}
                      {row.daysSinceLastTrip !== null && <span className="ml-1 text-[0.58rem] text-muted">{row.daysSinceLastTrip}d</span>}
                    </span>
                  ) : <span className="text-muted">—</span>}
                </td>
                <td className="whitespace-nowrap text-[0.68rem]">{row.nextTripDate ? shortDate(row.nextTripDate) : <span className="text-muted">—</span>}</td>
                <td className="text-[0.66rem]">
                  {row.favouriteVehicle || row.favouriteType || <span className="text-muted">—</span>}
                  {row.favouriteVehicle && row.favouriteType && <span className="block text-[0.58rem] text-muted">{row.favouriteType}</span>}
                  {row.favouriteHub && <span className="block text-[0.58rem] text-muted">{row.favouriteHub}</span>}
                </td>
                <td>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.56rem] font-extrabold ${row.risk === 'high' ? 'bg-coral/20 text-ink' : row.risk === 'medium' ? 'bg-sun/25 text-ink' : 'bg-stone-100 text-muted'}`}>
                    {row.risk === 'high' && <AlertTriangle className="h-2.5 w-2.5" />} {RISK_LABELS[row.risk]}
                  </span>
                </td>
                <td className="text-right">
                  <button type="button" onClick={() => openMail([row.id])} disabled={!row.email} aria-label={`Email ${row.name}`} className="rounded-lg p-1.5 text-muted transition hover:bg-paper hover:text-ink">
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <EmptyState
            icon={Users}
            title="No customers match"
            description="Clear the filters or widen the segment to see more people."
          />
        )}
        {filtered.length > 0 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPage={pagination.setPage}
            size={pagination.size}
            onSizeChange={pagination.setSize}
            label={`Showing ${pagination.start + 1}–${pagination.end} of ${pagination.total}`}
            className="mt-3"
          />
        )}
      </div>

      <Modal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        title={`Email ${mailIds.length} customer${mailIds.length === 1 ? '' : 's'}`}
        description="Messages queue through the notify dispatcher; in-app notifications appear for account holders."
        size="lg"
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="crm-template">Template</label>
            <select id="crm-template" value={mail.template} onChange={(event) => pickTemplate(event.target.value)} className="field">
              {BULK_TEMPLATES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
            <p className="mt-1 text-[0.6rem] text-muted">Edit the master copy in Admin → Comms; changes here only affect this send.</p>
          </div>
          <div>
            <label className="label" htmlFor="crm-subject">Subject</label>
            <input id="crm-subject" value={mail.subject} onChange={(event) => setMail((current) => ({ ...current, subject: event.target.value }))} className="field" maxLength={140} />
          </div>
          <div>
            <label className="label" htmlFor="crm-body">Body</label>
            <textarea id="crm-body" rows={6} value={mail.body} onChange={(event) => setMail((current) => ({ ...current, body: event.target.value }))} className="field resize-none" maxLength={2000} />
            <p className="mt-1 text-[0.6rem] text-muted">{'Use {name} and {site} — they are filled per customer.'}</p>
          </div>
          <div className="rounded-2xl border border-line bg-paper/70 px-3.5 py-2.5">
            <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Preview · {mailSample.name}</p>
            <p className="mt-1 text-sm font-extrabold">{preview.subject}</p>
            <p className="mt-1 whitespace-pre-line text-[0.72rem] leading-5 text-muted">{preview.body}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={sendMail} disabled={sending || !mailIds.length} className="btn btn-dark btn-sm">
              <Send className="h-3.5 w-3.5" /> {sending ? 'Queueing…' : `Send to ${mailIds.length}`}
            </button>
            <button type="button" onClick={() => setMailOpen(false)} className="btn btn-ghost btn-sm">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
