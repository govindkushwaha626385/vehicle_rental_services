import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bike, Car, ImagePlus, Pencil, Plus, Star, Trash2, Upload, Wrench, X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Drawer, EmptyState, LoadError, Modal, SearchField, StatusPill, TableScrollHint, Toggle } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { api } from '../../lib/api.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { serviceBoard, serviceBoardStats } from '../../lib/maintenance.js';
import { getSiteContent } from '../../lib/site.js';
import { todayISO } from '../../lib/pricing.js';
import { docSummaryLine, vehicleDocs } from '../../lib/fleetDocs.js';
import {
  BIKE_GEARS,
  FUELS_BY_KIND,
  KIND_LABELS,
  TRANSMISSIONS,
  VEHICLE_KINDS,
  VEHICLE_STATUSES,
  typesForKind,
} from '../../lib/constants.js';
import { cn, inr } from '../../lib/format.js';

const blank = {
  id: '', name: '', brand: '', kind: 'car', type: 'SUV', year: new Date().getFullYear(),
  seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '',
  gears: 'Manual', engineCc: '', mileage: '', helmetCount: 2, licenseClass: 'MCWG', minAge: 21,
  pricePerDay: 5000, kmCap: 0, kmExtraRate: 0, location: '', status: 'available', description: '', features: '', images: [],
  featured: false, displayOrder: 0, badge: '',
  odometer: '', serviceIntervalKm: 10000, serviceIntervalDays: 180, lastServiceDate: '', lastServiceOdometer: '',
  registrationNumber: '', insuranceExpiry: '', pucExpiry: '',
};

export default function Fleet() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imageInput, setImageInput] = useState('');
  const [bulkIds, setBulkIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(null);

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const vehicles = await api.adminVehicles();
      if (!requestGuard.isCurrent(guard)) return;
      setVehicles(vehicles);
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

  useEffect(() => {
    if (meta.locations.length && !form.location && !editing) {
      setForm((current) => ({ ...current, location: meta.locations[0].name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.locations]);

  const filtered = useMemo(() => vehicles.filter((vehicle) => {
    const matchesSearch = !search || `${vehicle.name} ${vehicle.brand} ${vehicle.location} ${vehicle.type}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || vehicle.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [vehicles, search, statusFilter]);

  // A filtered-out vehicle must never be changed by a bulk action.
  useEffect(() => {
    setBulkIds((current) => {
      if (!current.size) return current;
      const visible = new Set(filtered.map((vehicle) => vehicle.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filtered]);

  const serviceRows = useMemo(() => serviceBoard(vehicles), [vehicles]);
  const serviceStats = useMemo(() => serviceBoardStats(serviceRows), [serviceRows]);
  const serviceAttention = serviceRows.filter((row) => ['overdue', 'due'].includes(row.band)).slice(0, 4);

  // Review-weighted fleet rating: a 5★ vehicle with 40 reviews should count
  // more than a 5★ vehicle with one. Vehicles with no reviews carry no weight.
  const reviewSummary = useMemo(() => {
    let total = 0;
    let weighted = 0;
    vehicles.forEach((vehicle) => {
      const count = Number(vehicle.reviewCount) || 0;
      total += count;
      weighted += (Number(vehicle.rating) || 0) * count;
    });
    return { total, average: total ? weighted / total : 0 };
  }, [vehicles]);

  const toggleBulk = (id) => {
    const next = new Set(bulkIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setBulkIds(next);
  };
  const requestBulkStatus = (status) => {
    if (!bulkIds.size || bulkBusy) return;
    setBulkConfirm({ status });
  };

  const applyBulkStatus = async () => {
    if (!bulkConfirm || !bulkIds.size || bulkBusy) return;
    const { status } = bulkConfirm;
    setBulkBusy(true);
    try {
      const result = await api.adminBulkUpdateVehicles({ ids: [...bulkIds], status });
      push(content.fleet_marked.replace('{count}', String(result.updated)).replace('{s}', result.updated === 1 ? '' : 's').replace('{status}', status), 'success');
      if (result.skipped > 0) push(content.fleet_skipped.replace('{count}', String(result.skipped)), 'info');
      setBulkConfirm(null);
      setBulkIds(new Set());
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const openNew = () => {
    setForm({ ...blank, location: meta.locations[0]?.name || '' });
    setImageInput('');
    setDirty(false);
    setEditing({});
  };

  const openEdit = (vehicle) => {
    setForm({
      ...vehicle,
      kmCap: Number(vehicle.kmCap ?? 0),
      kmExtraRate: Number(vehicle.kmExtraRate ?? 0),
      features: (vehicle.features || []).join(', '),
      images: vehicle.images || [vehicle.imageUrl].filter(Boolean),
    });
    setImageInput('');
    setDirty(false);
    setEditing(vehicle);
  };

  // Deep link from the ⌘K palette: /admin/fleet?vehicle=<id> opens that car's
  // drawer as soon as the catalogue lands, then clears the param so closing the
  // drawer leaves a clean Fleet URL (Back never reopens it).
  useEffect(() => {
    const id = searchParams.get('vehicle');
    if (!id || !vehicles.length) return;
    const vehicle = vehicles.find((item) => item.id === id);
    if (!vehicle) return;
    openEdit(vehicle);
    const next = new URLSearchParams(searchParams);
    next.delete('vehicle');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, searchParams]);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (editing) setDirty(true);
  };

  // One switch replaces the "0 / cap + rate" puzzle: turning the allowance off
  // clears both fields so the vehicle is genuinely unlimited, and turning it on
  // seeds realistic defaults the operator can refine.
  const toggleKm = (enabled) => {
    setForm((current) => ({
      ...current,
      kmCap: enabled
        ? (Number(current.kmCap) > 0 ? Number(current.kmCap) : (current.kind === 'bike' ? 150 : 300))
        : 0,
      kmExtraRate: enabled
        ? (Number(current.kmExtraRate) > 0 ? Number(current.kmExtraRate) : (current.kind === 'bike' ? 6 : 15))
        : 0,
    }));
    if (editing) setDirty(true);
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) { setConfirmDiscard(true); return; }
    setEditing(null);
  };

  const addImageUrl = () => {
    const url = imageInput.trim();
    if (!url) return;
    if (form.images.length >= 8) {
      push(content.fleet_images_max, 'error');
      return;
    }
    if (editing) setDirty(true);
    if (form.images.includes(url)) {
      push(content.fleet_images_dupe, 'info');
      return;
    }
    setForm((current) => ({ ...current, images: [...current.images, url] }));
    setImageInput('');
  };

  const removeImage = (url) => {
    if (form.images.length <= 1) {
      push(content.fleet_images_min, 'error');
      return;
    }
    setForm((current) => ({ ...current, images: current.images.filter((image) => image !== url) }));
    if (editing) setDirty(true);
  };

  const uploadFile = async (file) => {
    if (!file) return;
    if (form.images.length >= 8) {
      push(content.fleet_images_max, 'error');
      return;
    }
    try {
      const url = await api.uploadVehicleImage(file);
      setForm((current) => ({ ...current, images: [...current.images, url] }));
      if (editing) setDirty(true);
      push(content.fleet_image_uploaded, 'success');
    } catch (error) {
      push(error.message, 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.adminSaveVehicle({
        ...form,
        features: form.features,
        images: form.images,
        pricePerDay: Number(form.pricePerDay),
        featured: Boolean(form.featured),
        displayOrder: Math.max(0, Number(form.displayOrder) || 0),
        badge: String(form.badge ?? '').trim(),
      });
      push(editing?.id ? 'Vehicle updated.' : 'Vehicle added to the fleet.', 'success');
      setDirty(false);
      setEditing(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.adminDeleteVehicle(deleteTarget.id);
      push(content.fleet_removed, 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Fleet</h1>
          <p className="mt-1 text-xs text-muted">
            {vehicles.length} vehicles · {vehicles.filter((v) => v.status === 'available').length} available
            {reviewSummary.total > 0 && (
              <> · <span className="font-semibold text-ink">{reviewSummary.average.toFixed(1)}★</span> across {reviewSummary.total} review{reviewSummary.total === 1 ? '' : 's'}</>
            )}
          </p>
        </div>
        <button type="button" onClick={openNew} className="btn btn-dark btn-sm"><Plus className="h-3.5 w-3.5" /> Add vehicle</button>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <SearchField value={search} onChange={setSearch} placeholder="Search name, brand, hub" label="Search fleet" className="min-w-[13rem] flex-1" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="field w-auto">
          <option value="">All statuses</option>
          {VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      <section className="rounded-2xl border border-line bg-white/90 p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">Maintenance</p>
            <h2 className="mt-0.5 text-sm font-extrabold">Real service status from odometer and intervals</h2>
            <p className="mt-0.5 text-[0.64rem] leading-4 text-muted">Log work, update readings and schedule workshop downtime on the maintenance desk.</p>
          </div>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-[0.6rem] font-extrabold ${serviceStats.overdue ? 'bg-rose-50 text-rose-700' : 'bg-stone-100 text-muted'}`}>{serviceStats.overdue} overdue</span>
            <span className={`rounded-full px-2.5 py-1 text-[0.6rem] font-extrabold ${serviceStats.due ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-muted'}`}>{serviceStats.due} due soon</span>
            <span className="rounded-full bg-paper px-2.5 py-1 text-[0.6rem] font-extrabold text-muted">{serviceStats.untracked} need baseline</span>
            <Link to="/admin/maintenance" className="btn btn-dark btn-sm">Maintenance desk <Wrench className="h-3.5 w-3.5" /></Link>
          </span>
        </div>
        {serviceAttention.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Vehicles needing service">
            {serviceAttention.map((row) => (
              <Link key={row.id} to="/admin/maintenance" className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[0.62rem] font-bold text-ink transition hover:border-amber-300" title={`${row.name} · ${row.progress}% of the service window used`}>
                <AlertTriangle className="h-3 w-3 text-amber-600" /> {row.name} <span className="text-muted">{row.progress}%</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[0.66rem] text-muted">Nothing overdue — every tracked vehicle sits inside its service window.</p>
        )}
      </section>

      {bulkIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-2.5 text-[0.72rem]">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-extrabold">
            {bulkIds.size} selected
            <span className="max-w-[22rem] truncate text-[0.64rem] font-semibold text-muted" title={vehicles.filter((vehicle) => bulkIds.has(vehicle.id)).map((vehicle) => vehicle.name).join(', ')}>
              {vehicles.filter((vehicle) => bulkIds.has(vehicle.id)).slice(0, 4).map((vehicle) => vehicle.name).join(', ')}{bulkIds.size > 4 ? ` +${bulkIds.size - 4}` : ''}
            </span>
          </span>
          {[
            { status: 'available', label: 'Mark available', tone: 'btn btn-white btn-sm' },
            { status: 'rented', label: 'Mark on rent', tone: 'btn btn-ghost btn-sm' },
            { status: 'maintenance', label: 'Mark in service', tone: 'btn btn-ghost btn-sm text-rose-700' },
          ].map((action) => (
            <button key={action.status} type="button" onClick={() => requestBulkStatus(action.status)} disabled={bulkBusy} className={action.tone}>{action.label}</button>
          ))}
          <button type="button" onClick={() => setBulkIds(new Set())} disabled={bulkBusy} className="ml-auto text-[0.66rem] font-bold text-muted underline underline-offset-4">Clear</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError && !vehicles.length ? (
        <LoadError
          title="The fleet could not load"
          message={loadError}
          hint="Do not add or edit vehicles until this reloads — the list you see would be incomplete."
          onRetry={() => load()}
        />
      ) : filtered.length ? (
        <>
          <TableScrollHint className="mt-3" />
          <div className="table-wrap" role="region" aria-label="Fleet table" tabIndex={0}>
            <table className="data-table">
            <thead>
              <tr><th className="w-9"><input type="checkbox" aria-label="Select all vehicles in view" checked={filtered.length > 0 && filtered.every((vehicle) => bulkIds.has(vehicle.id))} onChange={(event) => { const next = new Set(bulkIds); filtered.forEach((vehicle) => { if (event.target.checked) next.add(vehicle.id); else next.delete(vehicle.id); }); setBulkIds(next); }} /></th><th>Vehicle</th><th>Kind</th><th>Type</th><th>Price / day</th><th>Hub</th><th>Rating</th><th>Trips</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td className="w-9">
                    <input type="checkbox" className="cursor-pointer" checked={bulkIds.has(vehicle.id)} onChange={(event) => { event.stopPropagation(); toggleBulk(vehicle.id); }} aria-label={`Select ${vehicle.name}`} />
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      {vehicle.imageUrl ? (
                        <img src={vehicle.imageUrl} alt="" className="h-11 w-16 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-11 w-16 items-center justify-center rounded-lg bg-sand"><Car className="h-4 w-4 text-muted" /></span>
                      )}
                      <div>
                        <p className="font-bold">{vehicle.name}</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-[0.65rem] text-muted">
                          {vehicle.brand} · {vehicle.year}
                          {vehicle.featured && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-lime/30 px-1.5 py-0.5 text-[0.55rem] font-extrabold text-ink">
                              <Star className="h-2.5 w-2.5 fill-ink" /> Home{vehicle.displayOrder ? ` #${vehicle.displayOrder}` : ''}
                            </span>
                          )}
                          {vehicle.badge && (
                            <span className="rounded-full border border-line bg-paper px-1.5 py-0.5 text-[0.55rem] font-bold text-muted">{vehicle.badge}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-wider', vehicle.kind === 'bike' ? 'bg-lime/40 text-ink' : 'bg-sand text-ink')}>
                      {vehicle.kind === 'bike' ? <Bike className="h-3 w-3" /> : <Car className="h-3 w-3" />}
                      {vehicle.kind === 'bike' ? 'Bike' : 'Car'}
                    </span>
                    <DocsCompliance vehicle={vehicle} />
                  </td>
                  <td>{vehicle.type}</td>
                  <td>
                    <span className="font-bold">{inr(vehicle.pricePerDay)}</span>
                    <span className="mt-0.5 block text-[0.58rem] font-semibold text-muted">
                      {Number(vehicle.kmCap) > 0
                        ? `${Number(vehicle.kmCap).toLocaleString('en-IN')} km/day${Number(vehicle.kmExtraRate) > 0 ? ` · ${inr(vehicle.kmExtraRate)}/km` : ''}`
                        : 'Unlimited km'}
                    </span>
                  </td>
                  <td className="max-w-[10rem] truncate text-[0.72rem] text-muted">{vehicle.location}</td>
                  <td>
                    {Number(vehicle.reviewCount) > 0 ? (
                      <Link
                        to={`/admin/reviews?vehicle=${encodeURIComponent(vehicle.id)}`}
                        className="inline-flex items-center gap-1 font-bold underline-offset-2 transition hover:text-forest hover:underline"
                        title={`Read ${vehicle.reviewCount} review${vehicle.reviewCount === 1 ? '' : 's'} for ${vehicle.name}`}
                      >
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {Number(vehicle.rating).toFixed(1)}
                        <span className="text-[0.6rem] font-semibold text-muted">({vehicle.reviewCount})</span>
                      </Link>
                    ) : (
                      <span className="text-[0.66rem] text-muted">No reviews</span>
                    )}
                  </td>
                  <td>{vehicle.trips}</td>
                  <td><StatusPill status={vehicle.status} /></td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(vehicle)} className="rounded-lg p-2 text-muted transition hover:bg-paper hover:text-ink" aria-label={`Edit ${vehicle.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setDeleteTarget(vehicle)} className="rounded-lg p-2 text-muted transition hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete ${vehicle.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <EmptyState icon={Car} title="No vehicles match" description="Adjust your search or add a new vehicle to the fleet." action={<button type="button" onClick={openNew} className="btn btn-dark">Add vehicle</button>} />
      )}

      <Drawer
        open={Boolean(editing)}
        onClose={requestClose}
        title={editing?.id ? `Edit ${form.name}` : 'Add a vehicle'}
        description="Details appear on the customer site immediately after saving."
        width="max-w-2xl"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save vehicle'}</button>
          </div>
        )}
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <FormField label="Name"><input value={form.name} onChange={(event) => set('name', event.target.value)} className="field" placeholder="Porsche 911 Carrera" /></FormField>
          <FormField label="Brand"><input value={form.brand} onChange={(event) => set('brand', event.target.value)} className="field" placeholder="Porsche" /></FormField>
          <FormField label="Vehicle kind">
            <select
              value={form.kind}
              onChange={(event) => {
                const nextKind = event.target.value;
                const allowed = typesForKind(nextKind);
                const allowedFuels = FUELS_BY_KIND[nextKind] ?? [];
                setForm((current) => ({
                  ...current,
                  kind: nextKind,
                  type: allowed.includes(current.type) ? current.type : allowed[0],
                  fuel: allowedFuels.includes(current.fuel) ? current.fuel : allowedFuels[0],
                  awd: nextKind === 'bike' ? false : current.awd,
                  minAge: nextKind === 'bike' ? 18 : 21,
                  serviceIntervalKm: nextKind === 'bike' ? 4000 : 10000,
                  serviceIntervalDays: nextKind === 'bike' ? 120 : 180,
                }));
              }}
              className="field"
            >
              {VEHICLE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
            </select>
          </FormField>
          <FormField label={form.kind === 'bike' ? 'Bike type' : 'Body type'}>
            <select value={form.type} onChange={(event) => set('type', event.target.value)} className="field">
              {typesForKind(form.kind).map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </FormField>
          <FormField label="Year"><input type="number" value={form.year} onChange={(event) => set('year', event.target.value)} className="field" /></FormField>
          {form.kind === 'bike' ? (
            <>
              <FormField label="Engine (cc)"><input type="number" value={form.engineCc} onChange={(event) => set('engineCc', event.target.value)} className="field" placeholder="350" /></FormField>
              <FormField label="Mileage / range"><input value={form.mileage} onChange={(event) => set('mileage', event.target.value)} className="field" placeholder="35 kmpl or 120 km range" /></FormField>
              <FormField label="Gearbox">
                <select value={form.gears} onChange={(event) => set('gears', event.target.value)} className="field">
                  {BIKE_GEARS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </FormField>
              <FormField label="Helmets included"><input type="number" value={form.helmetCount} onChange={(event) => set('helmetCount', event.target.value)} className="field" /></FormField>
              <FormField label="Licence class">
                <select value={form.licenseClass} onChange={(event) => set('licenseClass', event.target.value)} className="field">
                  {['MCWG', 'MCWOG'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </FormField>
              <FormField label="Minimum rider age"><input type="number" value={form.minAge} onChange={(event) => set('minAge', event.target.value)} className="field" /></FormField>
            </>
          ) : (
            <>
              <FormField label="Seats"><input type="number" value={form.seats} onChange={(event) => set('seats', event.target.value)} className="field" /></FormField>
              <FormField label="Luggage (bags)"><input type="number" value={form.luggage} onChange={(event) => set('luggage', event.target.value)} className="field" /></FormField>
              <FormField label="Transmission">
                <select value={form.transmission} onChange={(event) => set('transmission', event.target.value)} className="field">
                  {TRANSMISSIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </FormField>
              <FormField label="Efficiency"><input value={form.efficiency} onChange={(event) => set('efficiency', event.target.value)} className="field" placeholder="13 kmpl or 480 km range" /></FormField>
              <FormField label="Minimum driver age"><input type="number" min="16" max="90" value={form.minAge} onChange={(event) => set('minAge', event.target.value)} className="field" /></FormField>
            </>
          )}
          <FormField label="Fuel">
            <select value={form.fuel} onChange={(event) => set('fuel', event.target.value)} className="field">
              {(FUELS_BY_KIND[form.kind] ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </FormField>
          <FormField label="Price per day (₹)"><input type="number" min="500" max="200000" step="1" value={form.pricePerDay} onChange={(event) => set('pricePerDay', event.target.value)} className="field" /></FormField>
          <FormField label="Hub">
            <select value={form.location} onChange={(event) => set('location', event.target.value)} className="field">
              <option value="">Choose a hub</option>
              {meta.locations.map((location) => <option key={location.id} value={location.name}>{location.name}</option>)}
            </select>
          </FormField>
          <FormField label="Status">
            <select value={form.status} onChange={(event) => set('status', event.target.value)} className="field">
              {VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </FormField>
          <div className="rounded-xl border border-line bg-paper/70 p-3 sm:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">Kilometre allowance</p>
                <p className="mt-0.5 text-[0.6rem] leading-4 text-muted">
                  Distance included per rental day. Extra kilometres are measured from the hand-over odometer and billed at drop-off.
                </p>
              </div>
              <Toggle
                checked={Number(form.kmCap) > 0}
                onChange={toggleKm}
                label="Cap distance"
                description="Off = unlimited kilometres"
              />
            </div>
            {Number(form.kmCap) > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <FormField label="Included km per day">
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    step="1"
                    value={form.kmCap ?? 0}
                    onChange={(event) => set('kmCap', event.target.value)}
                    className="field"
                  />
                </FormField>
                <FormField label="Extra km rate (₹/km)">
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="1"
                    value={form.kmExtraRate ?? 0}
                    onChange={(event) => set('kmExtraRate', event.target.value)}
                    className="field"
                  />
                </FormField>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-line bg-paper/70 p-3 sm:col-span-2">
            <p className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">Compliance documents</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <FormField label="RC number"><input value={form.registrationNumber} onChange={(event) => set('registrationNumber', event.target.value)} maxLength={24} className="field" placeholder="KA-01-MF-1234" /></FormField>
              <FormField label="Insurance expiry"><input type="date" value={form.insuranceExpiry} onChange={(event) => set('insuranceExpiry', event.target.value)} className="field" /></FormField>
              <FormField label="PUC expiry"><input type="date" value={form.pucExpiry} onChange={(event) => set('pucExpiry', event.target.value)} className="field" /></FormField>
            </div>
            <p className="mt-1.5 text-[0.6rem] leading-4 text-muted">Rentals are legally void once insurance or PUC lapses. The dashboard warns before each expires so it can be renewed first.</p>
          </div>
          <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
            <Toggle
              checked={Boolean(form.featured)}
              onChange={(value) => set('featured', value)}
              label="Feature on the homepage"
              description="Featured vehicles fill the homepage shortlist first, in display order."
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField label="Homepage order">
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={form.displayOrder ?? 0}
                  onChange={(event) => set('displayOrder', event.target.value)}
                  className="field"
                  placeholder="1"
                />
              </FormField>
              <FormField label="Card badge">
                <input
                  value={form.badge ?? ''}
                  onChange={(event) => set('badge', event.target.value)}
                  className="field"
                  maxLength={24}
                  placeholder="Staff pick"
                />
              </FormField>
            </div>
            <p className="mt-2 text-[0.6rem] leading-4 text-muted">Lower homepage order appears first. Leave the badge blank to show only the vehicle type.</p>
          </div>
          {form.kind === 'car' && (
            <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
              <Toggle checked={form.awd} onChange={(value) => set('awd', value)} label="All-wheel drive" description="Shown as an AWD badge and filter." />
            </div>
          )}
          <FormField label="Description" className="sm:col-span-2">
            <textarea rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} className="field resize-none" placeholder="A weekend icon with everyday manners…" />
          </FormField>
          <FormField label="Features (comma separated)" className="sm:col-span-2">
            <input value={form.features} onChange={(event) => set('features', event.target.value)} className="field" placeholder="Apple CarPlay, Heated seats, Park assist" />
          </FormField>

          <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-muted">Maintenance baseline</p>
            <p className="mt-0.5 text-[0.64rem] leading-4 text-muted">Odometer and service intervals power due alerts. Log each workshop visit on the Maintenance desk.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField label="Current odometer (km)">
                <input type="number" min="0" value={form.odometer ?? ''} onChange={(event) => set('odometer', event.target.value)} className="field" placeholder="24000" />
              </FormField>
              <FormField label="Last service date">
                <input type="date" max={todayISO()} value={form.lastServiceDate ?? ''} onChange={(event) => set('lastServiceDate', event.target.value)} className="field" />
              </FormField>
              <FormField label="Last service odometer (km)">
                <input type="number" min="0" value={form.lastServiceOdometer ?? ''} onChange={(event) => set('lastServiceOdometer', event.target.value)} className="field" placeholder="15000" />
              </FormField>
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Interval (km)">
                  <input type="number" min="1" value={form.serviceIntervalKm ?? 10000} onChange={(event) => set('serviceIntervalKm', event.target.value)} className="field" />
                </FormField>
                <FormField label="Interval (days)">
                  <input type="number" min="1" value={form.serviceIntervalDays ?? 180} onChange={(event) => set('serviceIntervalDays', event.target.value)} className="field" />
                </FormField>
              </div>
            </div>
            <p className="mt-2 text-[0.6rem] leading-4 text-muted">Leave the odometer blank if the reading is unknown; the Maintenance desk will mark the vehicle as needing a baseline.</p>
          </div>

          <div className="sm:col-span-2">
            <p className="label">Images</p>
            <div className="flex flex-wrap gap-2">
              {form.images.map((image) => (
                <div key={image} className="group relative h-20 w-28 overflow-hidden rounded-xl border border-line">
                  <img src={image} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removeImage(image)} className="absolute right-1 top-1 rounded-full bg-ink/80 p-1 text-cream opacity-0 transition group-hover:opacity-100" aria-label="Remove image">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {form.images.length < 8 && (
              <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-stone-300 bg-paper text-muted transition hover:border-ink hover:text-ink">
                <ImagePlus className="h-4 w-4" />
                <span className="text-[0.6rem] font-bold">Upload</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => uploadFile(event.target.files?.[0])} />
              </label>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={imageInput} onChange={(event) => setImageInput(event.target.value)} className="field h-9 py-1 text-[0.75rem]" placeholder="…or paste an image URL" />
              <button type="button" onClick={addImageUrl} className="btn btn-white btn-sm"><Upload className="h-3.5 w-3.5" /> Add</button>
            </div>
          </div>
        </div>
      </Drawer>

      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title={content.drawer_discard_title} description={content.drawer_discard_copy} size="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { setDirty(false); setConfirmDiscard(false); setEditing(null); }}
            className="btn btn-dark flex-1"
          >
            <Trash2 className="h-4 w-4" /> {content.drawer_discard_confirm}
          </button>
          <button type="button" onClick={() => setConfirmDiscard(false)} className="btn btn-white flex-1">
            {content.drawer_discard_keep}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(bulkConfirm)}
        onClose={() => (bulkBusy ? null : setBulkConfirm(null))}
        title={`Mark ${bulkIds.size} vehicle${bulkIds.size === 1 ? '' : 's'} ${bulkConfirm?.status || ''}?`}
        description="Bulk fleet status change"
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setBulkConfirm(null)} disabled={bulkBusy} className="btn btn-white flex-1">Keep current status</button>
            <button type="button" onClick={applyBulkStatus} disabled={bulkBusy} className="btn btn-dark flex-1">{bulkBusy ? 'Updating…' : 'Apply to selected'}</button>
          </div>
        )}
      >
        <p className="text-sm leading-6 text-muted">
          {bulkConfirm?.status === 'available'
            ? 'These vehicles return to the bookable fleet. Customers watching their dates are notified automatically.'
            : bulkConfirm?.status === 'maintenance'
              ? 'These vehicles leave the bookable fleet immediately. Schedule workshop downtime from the Maintenance desk so the calendar stays accurate.'
              : 'The vehicle status changes immediately. Confirm the keys are actually with the customer before marking a vehicle on rent.'}
        </p>
        <p className="mt-3 rounded-xl border border-line bg-paper/70 px-3 py-2 text-[0.7rem] font-semibold">
          {vehicles.filter((vehicle) => bulkIds.has(vehicle.id)).map((vehicle) => vehicle.name).join(', ')}
        </p>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => (busy ? null : setDeleteTarget(null))}
        title="Delete this vehicle?"
        description="Vehicles with booking history cannot be deleted — set them to maintenance instead."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={busy} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={remove} disabled={busy} className="btn btn-dark flex-1">{busy ? 'Deleting…' : 'Delete vehicle'}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">You are about to remove <span className="font-bold text-ink">{deleteTarget?.name}</span> from the fleet. This cannot be undone.</p>
      </Modal>
    </div>
  );
}

function FormField({ label, children, className }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/** Compact compliance badges shown in the fleet table under the kind chip. */
function DocsCompliance({ vehicle }) {
  const info = vehicleDocs(vehicle);
  const lines = Object.values(info.docs).filter((doc) => doc.status !== 'untracked');
  if (!lines.length) return null;
  return (
    <span className="mt-1 block space-y-0.5">
      {lines.map((doc) => (
        <span key={doc.key} className={cn('mr-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.52rem] font-bold', doc.status === 'expired' ? 'bg-rose-50 text-rose-700' : doc.status === 'expiring' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800')} title={docSummaryLine(doc)}>
          {doc.key === 'insuranceExpiry' ? 'INS' : 'PUC'} {doc.daysLeft !== null ? (doc.status === 'expired' ? `${-doc.daysLeft}d ago` : `${doc.daysLeft}d`) : ''}
        </span>
      ))}
    </span>
  );
}
