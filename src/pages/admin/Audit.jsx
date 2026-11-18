import { useEffect, useMemo, useState } from 'react';
import { Clock3, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { EmptyState, LoadError, Pagination, SearchField, TableScrollHint } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { usePagination } from '../../hooks/usePagination.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { cn, localDay } from '../../lib/format.js';
import { todayISO } from '../../lib/pricing.js';

const ACTIONS = ['insert', 'update', 'delete', 'refund'];

const ACTION_TONE = {
  insert: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  update: 'bg-amber-50 text-amber-900 border-amber-200',
  delete: 'bg-rose-50 text-rose-800 border-rose-200',
  refund: 'bg-violet-50 text-violet-900 border-violet-200',
};

function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function changedFields(entry) {
  const changed = entry?.metadata?.changed;
  if (!changed || typeof changed !== 'object' || Array.isArray(changed)) return [];
  return Object.entries(changed).map(([key, value]) => ({
    key,
    from: value && typeof value === 'object' ? value.from : undefined,
    to: value && typeof value === 'object' ? value.to : value,
  }));
}

export default function Audit() {
  const { push } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const logs = await api.adminAuditLogs({ limit: 300 });
      if (!requestGuard.isCurrent(guard)) return;
      setLogs(logs);
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

  const entities = useMemo(
    () => [...new Set(logs.map((entry) => entry.entityType).filter(Boolean))].sort(),
    [logs]
  );
  // Actions evolve with the product (bulk, create, resend, …). Derive the filter
  // from the loaded page so a new audit action can never become unfilterable.
  const actions = useMemo(
    () => [...new Set([...ACTIONS, ...logs.map((entry) => entry.action).filter(Boolean)])].sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (action && entry.action !== action) return false;
      if (entity && entry.entityType !== entity) return false;
      if (!needle) return true;
      return `${entry.actorName} ${entry.actorRole} ${entry.action} ${entry.entityType} ${entry.entityId} ${entry.summary}`
        .toLowerCase()
        .includes(needle);
    });
  }, [logs, search, action, entity]);

  const pagination = usePagination({
    items: filtered,
    resetKey: `${search}|${action}|${entity}`,
    pageSize: 50,
  });
  const pageRows = pagination.rows;

  const today = todayISO();
  const todayCount = logs.filter((entry) => localDay(entry.createdAt) === today).length;
  const actorCount = new Set(logs.map((entry) => entry.actorName).filter(Boolean)).size;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Governance</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Audit log</h1>
          <p className="mt-1 text-xs text-muted">Append-only record of staff changes across the console.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn btn-white btn-sm">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="stat-card">
          <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><FileText className="h-3 w-3" /> Entries loaded</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{logs.length}</p>
          <p className="mt-0.5 text-[0.62rem] text-muted">Most recent 300 changes</p>
        </div>
        <div className="stat-card">
          <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><Clock3 className="h-3 w-3" /> Today</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{todayCount}</p>
          <p className="mt-0.5 text-[0.62rem] text-muted">Changes recorded today</p>
        </div>
        <div className="stat-card">
          <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><ShieldCheck className="h-3 w-3" /> Actors</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{actorCount}</p>
          <p className="mt-0.5 text-[0.62rem] text-muted">People and system processes</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <SearchField value={search} onChange={setSearch} placeholder="Search actor, action, entity or reference" label="Search audit log" className="min-w-[15rem] flex-1" />
        <select value={action} onChange={(event) => setAction(event.target.value)} className="field w-auto" aria-label="Filter by action">
          <option value="">All actions</option>
          {actions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={entity} onChange={(event) => setEntity(event.target.value)} className="field w-auto" aria-label="Filter by entity">
          <option value="">All entities</option>
          {entities.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
        </select>
        {(search || action || entity) && (
          <button type="button" onClick={() => { setSearch(''); setAction(''); setEntity(''); }} className="btn btn-ghost btn-sm">Clear</button>
        )}
      </div>

      <p className="rounded-xl border border-line bg-white/70 px-3 py-2 text-[0.65rem] leading-5 text-muted">
        Audit entries are written by the database and cannot be edited or deleted from the console. Only super admins can view them.
      </p>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError && !logs.length ? (
        <LoadError
          title="The audit log could not load"
          message={loadError}
          hint="The last 300 entries are missing from view. Retry before relying on this trail for a dispute."
          onRetry={() => load()}
        />
      ) : filtered.length ? (
        <>
          <TableScrollHint className="mt-3" />
          <div className="table-wrap" role="region" aria-label="Audit log table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Summary</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((entry) => {
                  const changes = changedFields(entry);
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-[0.7rem] text-muted">{formatWhen(entry.createdAt)}</td>
                      <td>
                        <p className="text-[0.72rem] font-bold">{entry.actorName || 'System'}</p>
                        <p className="text-[0.58rem] uppercase tracking-wider text-muted">{entry.actorRole || 'system'}</p>
                      </td>
                      <td>
                        <span className={cn('badge border font-extrabold uppercase', ACTION_TONE[entry.action] ?? 'bg-stone-100 text-stone-700 border-stone-200')}>
                          {entry.action}
                        </span>
                      </td>
                      <td>
                        <p className="text-[0.7rem] font-bold">{String(entry.entityType || '').replaceAll('_', ' ')}</p>
                        <p className="max-w-[12rem] truncate text-[0.6rem] text-muted">{entry.entityId || '—'}</p>
                      </td>
                      <td className="max-w-[18rem] text-[0.7rem] leading-5">{entry.summary || '—'}</td>
                      <td>
                        {changes.length ? (
                          <details className="group min-w-[7rem]">
                            <summary className="cursor-pointer list-none text-[0.65rem] font-extrabold text-forest underline decoration-line underline-offset-4 group-open:no-underline">
                              {changes.length} field{changes.length === 1 ? '' : 's'}
                            </summary>
                            <dl className="mt-2 space-y-1.5 rounded-lg border border-line bg-paper p-2">
                              {changes.map((change) => (
                                <div key={change.key}>
                                  <dt className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{change.key}</dt>
                                  <dd className="break-words text-[0.6rem] leading-4">
                                    <span className="text-rose-700 line-through">{formatValue(change.from)}</span>
                                    <span className="mx-1 text-muted">→</span>
                                    <span className="font-bold">{formatValue(change.to)}</span>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ) : (
                          <span className="text-[0.62rem] text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPage={pagination.setPage}
            size={pagination.size}
            onSizeChange={pagination.setSize}
            label={`Showing ${pagination.start + 1}–${pagination.end} of ${pagination.total}`}
            className="mt-3"
          />
        </>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="No audit entries match"
          description="Try a broader search or clear the filters. New staff changes appear here automatically."
          action={<button type="button" onClick={() => { setSearch(''); setAction(''); setEntity(''); }} className="btn btn-dark">Clear filters</button>}
        />
      )}
    </div>
  );
}
