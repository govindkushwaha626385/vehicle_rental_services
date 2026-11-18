import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, RefreshCw, ShieldCheck, UserCog, Users as UsersIcon } from 'lucide-react';
import { Avatar, EmptyState, LoadError, Modal, SearchField, SortableHeader, StatusPill, TableScrollHint } from '../../components/ui.jsx';
import { useSort } from '../../hooks/useSort.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getSiteContent } from '../../lib/site.js';
import { downloadCsv } from '../../lib/csv.js';
import { cn, inr, localDay, longDate, roleLabel } from '../../lib/format.js';
import { ROLES } from '../../lib/constants.js';

export default function Users() {
  const { user: me } = useAuth();
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta?.settings), [meta?.settings]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [savingId, setSavingId] = useState('');
  const [confirmChange, setConfirmChange] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      setUsers(await api.adminUsers());
    } catch (error) {
      setLoadError(error.message);
      push(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = async (target, patch) => {
    setSavingId(target.id);
    try {
      await api.adminUpdateUser(target.id, patch);
      setUsers((current) => current.map((item) => (item.id === target.id ? { ...item, ...patch } : item)));
      push(content.users_updated.replace('{name}', target.name), 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSavingId('');
    }
  };

  const requestUpdate = (target, patch) => {
    if (patch.role && patch.role !== target.role) {
      setConfirmChange({ target, patch, kind: 'role' });
      return;
    }
    if (patch.status && patch.status !== target.status) {
      setConfirmChange({ target, patch, kind: 'status' });
      return;
    }
    update(target, patch);
  };

  const applyConfirmed = async () => {
    if (!confirmChange) return;
    const change = confirmChange;
    setConfirmChange(null);
    await update(change.target, change.patch);
  };

  const updateLicence = async (target, verified) => {
    setSavingId(target.id);
    try {
      await api.adminVerifyLicence(target.id, verified);
      setUsers((current) => current.map((item) => (item.id === target.id ? { ...item, licenceVerified: verified } : item)));
      push(content.users_licence.replace('{name}', target.name).replace('{verified}', verified ? 'verified' : 'marked for review'), 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSavingId('');
    }
  };

  const viewLicence = async (target) => {
    try {
      if (!api.adminLicenceUrl) throw new Error('Licence previews are not available in this build.');
      const url = await api.adminLicenceUrl(target.licenceUrl);
      if (url.startsWith('data:')) {
        const blob = await (await fetch(url)).blob();
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      push(error.message, 'error');
    }
  };

  const filtered = useMemo(() => users.filter((item) => {
    if (roleFilter && item.role !== roleFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    const haystack = [
      item.name, item.email, item.phone, item.role, roleLabel[item.role],
      item.status, item.licenseNumber,
    ].join(' ').toLowerCase();
    return !search || haystack.includes(search.toLowerCase());
  }), [users, search, roleFilter, statusFilter]);

  const filtersActive = Boolean(search.trim() || roleFilter || statusFilter);
  const clearFilters = () => {
    setSearch('');
    setRoleFilter('');
    setStatusFilter('');
  };

  // Column sorting (shadcn Data Table style). Nulls/empties sort last; with no
  // active column the natural API order is preserved.
  const { sort: columnSort, toggle: toggleSort, apply: applySort } = useSort();
  const sorted = useMemo(() => applySort(filtered, (key, item) => {
    if (key === 'user') return item.name || '';
    if (key === 'phone') return item.phone || '';
    if (key === 'bookings') return Number(item.bookings) || 0;
    if (key === 'spend') return Number(item.spend) || 0;
    if (key === 'joined') return item.createdAt || '';
    return item[key] ?? '';
  }), [filtered, applySort]);

  const counts = useMemo(() => ({
    total: users.length,
    customers: users.filter((item) => item.role === 'customer').length,
    staff: users.filter((item) => item.role !== 'customer').length,
    suspended: users.filter((item) => item.status === 'suspended').length,
  }), [users]);

  const exportCsv = () => {
    if (!sorted.length) return;
    downloadCsv(`rove-users-${localDay(new Date())}.csv`, [
      ['Name', 'Email', 'Phone', 'Role', 'Status', 'Licence', 'Licence verified', 'Bookings', 'Spend', 'Joined'],
      ...sorted.map((item) => [
        item.name,
        item.email,
        item.phone,
        roleLabel[item.role] || item.role,
        item.status,
        item.licenseNumber || '',
        item.licenceVerified ? 'Yes' : item.licenceUrl ? 'Review' : '',
        item.bookings,
        item.spend,
        localDay(item.createdAt),
      ]),
    ]);
    push(content.users_exported.replace('{count}', String(sorted.length)).replace('{s}', sorted.length === 1 ? '' : 's'), 'success');
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Administration</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Users & roles</h1>
        <p className="mt-1 text-xs text-muted">Promote fleet managers, suspend accounts and audit customer activity. Super admin only.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Total users', counts.total, UsersIcon], ['Customers', counts.customers, UsersIcon], ['Staff', counts.staff, ShieldCheck], ['Suspended', counts.suspended, UserCog]].map(([label, value, Icon]) => (
          <div key={label} className="stat-card">
            <Icon className="h-4 w-4 text-forest" />
            <p className="mt-2 text-xl font-extrabold">{value}</p>
            <p className="text-[0.6rem] uppercase tracking-wider text-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={search} onChange={setSearch} placeholder="Search name, email, role, licence" label="Search users" className="max-w-md flex-1" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="field w-auto" aria-label="Filter by role">
          <option value="">All roles</option>
          {ROLES.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="field w-auto" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {filtersActive && (
          <button type="button" onClick={clearFilters} className="text-[0.64rem] font-extrabold text-muted underline underline-offset-4">Clear</button>
        )}
        <button type="button" onClick={load} disabled={loading} className="btn btn-white btn-sm shrink-0" aria-label="Refresh users">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
        </button>
        <button type="button" onClick={exportCsv} disabled={!filtered.length} className="btn btn-white btn-sm shrink-0">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError && !users.length ? (
        <LoadError title="Users could not load" message={loadError} onRetry={load} />
      ) : filtered.length ? (
        <>
          <TableScrollHint className="mt-3" />
          <div className="table-wrap" role="region" aria-label="Users and roles table" tabIndex={0}>
            <table className="data-table">
            <thead>
              <tr>
                <SortableHeader label="User" column="user" sort={columnSort} onSort={toggleSort} />
                <SortableHeader label="Phone" column="phone" sort={columnSort} onSort={toggleSort} />
                <th>Role</th><th>Status</th><th>Licence</th>
                <SortableHeader label="Bookings" column="bookings" sort={columnSort} onSort={toggleSort} align="right" />
                <SortableHeader label="Spend" column="spend" sort={columnSort} onSort={toggleSort} align="right" />
                <SortableHeader label="Joined" column="joined" sort={columnSort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const self = item.id === me?.id;
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={item.name} size="sm" />
                        <div>
                          <p className="font-bold">{item.name} {self && <span className="ml-1 rounded-full bg-lime px-1.5 py-0.5 text-[0.52rem] font-extrabold uppercase">You</span>}</p>
                          <p className="text-[0.64rem] text-muted">{item.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-[0.7rem] text-muted">{item.phone || '—'}</td>
                    <td>
                      <select
                        value={item.role}
                        disabled={self || savingId === item.id}
                        onChange={(event) => requestUpdate(item, { role: event.target.value })}
                        className="field h-8 w-auto py-1 text-[0.7rem]"
                        aria-label={`Role for ${item.name}`}
                      >
                        {ROLES.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={item.status}
                        disabled={self || savingId === item.id}
                        onChange={(event) => requestUpdate(item, { status: event.target.value })}
                        className={`field h-8 w-auto py-1 text-[0.7rem] ${item.status === 'suspended' ? 'text-rose-700' : ''}`}
                        aria-label={`Status for ${item.name}`}
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td>
                      {item.licenceVerified ? (
                        <div className="flex items-center gap-2">
                          <StatusPill status="confirmed" label="Verified" />
                          <button
                            type="button"
                            onClick={() => updateLicence(item, false)}
                            disabled={savingId === item.id}
                            className="text-[0.62rem] font-bold text-muted underline-offset-2 hover:text-rose-700 hover:underline disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </div>
                      ) : item.licenceUrl ? (
                        <div className="flex items-center gap-2">
                          <StatusPill status="pending" label="Pending" />
                          <button
                            type="button"
                            onClick={() => viewLicence(item)}
                            className="inline-flex items-center gap-1 text-[0.62rem] font-bold text-forest hover:underline"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                          <button
                            type="button"
                            onClick={() => updateLicence(item, true)}
                            disabled={savingId === item.id}
                            className="text-[0.62rem] font-bold text-forest underline-offset-2 hover:underline disabled:opacity-50"
                          >
                            Verify
                          </button>
                        </div>
                      ) : (
                        <span className="text-[0.65rem] text-muted">—</span>
                      )}
                    </td>
                    <td className="text-right">{item.bookings}</td>
                    <td className="text-right font-bold">{inr(item.spend)}</td>
                    <td className="whitespace-nowrap text-[0.68rem] text-muted">{longDate(item.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <EmptyState
          icon={UsersIcon}
          title={filtersActive ? 'No users match' : 'No users yet'}
          description={filtersActive ? 'Try a different search, role or status.' : 'Customer accounts appear here after their first sign-up.'}
          action={filtersActive ? <button type="button" onClick={clearFilters} className="btn btn-dark">Clear filters</button> : undefined}
        />
      )}

      <p className="rounded-xl border border-line bg-white px-4 py-3 text-[0.65rem] leading-5 text-muted">
        Role changes take effect on the user’s next request. The system prevents removing the last active super admin or changing your own role. Suspended users are signed out and cannot book.
      </p>

      <Modal
        open={Boolean(confirmChange)}
        onClose={() => (savingId ? null : setConfirmChange(null))}
        title={confirmChange?.kind === 'role' ? 'Change this user’s role?' : 'Change this account’s access?'}
        description={confirmChange ? `${confirmChange.target.name} · ${confirmChange.target.email}` : ''}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmChange(null)} disabled={Boolean(savingId)} className="btn btn-white flex-1">Keep current access</button>
            <button type="button" onClick={applyConfirmed} disabled={Boolean(savingId)} className="btn btn-dark flex-1">{savingId ? 'Saving…' : 'Apply change'}</button>
          </div>
        )}
      >
        {confirmChange && (
          <div className="space-y-3 text-[0.76rem]">
            <div className="rounded-2xl border border-line bg-paper/70 p-3">
              {confirmChange.kind === 'role' ? (
                <p className="flex justify-between gap-3">
                  <span className="text-muted">Role</span>
                  <span className="font-bold">{roleLabel[confirmChange.target.role] || confirmChange.target.role} → {roleLabel[confirmChange.patch.role] || confirmChange.patch.role}</span>
                </p>
              ) : (
                <p className="flex justify-between gap-3">
                  <span className="text-muted">Status</span>
                  <span className="font-bold capitalize">{confirmChange.target.status} → {confirmChange.patch.status}</span>
                </p>
              )}
            </div>
            <p className="leading-5 text-muted">
              {confirmChange.patch.role === 'admin'
                ? 'Super admins can change pricing, refunds, users and every setting. Only give this to someone who needs full control.'
                : confirmChange.patch.status === 'suspended'
                  ? 'Suspending signs the user out and blocks new bookings. Their history and invoices are kept.'
                  : 'The change is audited and takes effect on the user’s next request.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
