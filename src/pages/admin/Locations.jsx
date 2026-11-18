import { useEffect, useState } from 'react';
import { Clock, MapPin, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { EmptyState, LoadError, Modal, Toggle } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { api } from '../../lib/api.js';
import { coordinatesProblem, normalizeCoordinates, phoneProblem } from '../../lib/validation.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getSiteContent } from '../../lib/site.js';

const EMPTY_HUB = {
  name: '', address: '', city: '', region: '', lat: '', lng: '', phone: '', hours: 'Mon–Sun, 8:00–20:00', active: true,
};

export default function Locations() {
  const { meta, refresh: refreshMeta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta?.settings);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const requestGuard = useRequestGuard();

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const next = await api.adminLocations();
      if (!requestGuard.isCurrent(guard)) return;
      setLocations(next);
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

  const openForm = (initial) => {
    setErrors({});
    setForm(initial);
  };

  const setField = (key, value, errorKey = key) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[errorKey] ? { ...current, [errorKey]: '' } : current));
  };

  const save = async () => {
    if (!form || saving) return;
    const nextErrors = {};
    const name = String(form.name ?? '').trim();
    if (name.length < 3) nextErrors.name = 'Enter a hub name of at least 3 characters.';
    else if (name.length > 80) nextErrors.name = 'Keep the name to 80 characters or fewer.';
    else if (locations.some((location) => location.id !== form.id && location.name.toLowerCase() === name.toLowerCase())) {
      nextErrors.name = 'A hub with this name already exists.';
    }
    const phoneError = phoneProblem(form.phone);
    if (phoneError) nextErrors.phone = phoneError;
    const coordError = coordinatesProblem(form.lat, form.lng);
    if (coordError) nextErrors.coords = coordError;
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      const { lat, lng } = normalizeCoordinates(form.lat, form.lng);
      const next = await api.adminSaveLocation({ ...form, name, lat, lng });
      setLocations(next);
      setForm(null);
      await refreshMeta();
      push(content.locations_saved, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.adminDeleteLocation(deleteTarget.id);
      setLocations(await api.adminLocations());
      setDeleteTarget(null);
      await refreshMeta();
      push(content.locations_removed, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Network</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Locations</h1>
          <p className="mt-1 text-xs text-muted">{locations.filter((location) => location.active).length} active hubs · shown in search and checkout.</p>
        </div>
        <button
          type="button"
          onClick={() => openForm({ ...EMPTY_HUB })}
          className="btn btn-dark btn-sm"
        >
          <Plus className="h-3.5 w-3.5" /> Add hub
        </button>
      </header>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError && !locations.length ? (
        <LoadError
          title="Hubs could not load"
          message={loadError}
          hint="Customer pick-up and drop-off points come from this list. Retry before guiding anyone to a hub."
          onRetry={() => load()}
        />
      ) : locations.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <article key={location.id} className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-lime"><MapPin className="h-4 w-4" /></span>
                <span className={`badge ${location.active ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{location.active ? 'Active' : 'Inactive'}</span>
              </div>
              <h2 className="mt-3 text-sm font-extrabold">{location.name}</h2>
              <p className="mt-0.5 text-[0.68rem] leading-5 text-muted">{location.address || location.city}</p>
              <div className="mt-3 space-y-1 text-[0.65rem] text-muted">
                <p className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> {location.hours}</p>
                <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {location.phone || '—'}</p>
              </div>
              <div className="mt-4 flex gap-1.5 border-t border-line pt-3">
                <button type="button" onClick={() => openForm({ ...location })} className="btn btn-white btn-sm flex-1"><Pencil className="h-3 w-3" /> Edit</button>
                <button type="button" onClick={() => setDeleteTarget(location)} className="btn btn-ghost btn-sm text-rose-700" aria-label={`Delete ${location.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={MapPin} title="No hubs yet" description="Add your first pick-up location to start taking bookings." action={<button type="button" onClick={() => openForm({ ...EMPTY_HUB })} className="btn btn-dark">Add hub</button>} />
      )}

      <Modal
        open={Boolean(form)}
        onClose={() => (saving ? null : setForm(null))}
        title={form?.id ? 'Edit hub' : 'Add a hub'}
        description="Hubs appear in search, filters and checkout."
        size="md"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save hub'}</button>
          </div>
        )}
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="location-name">Display name</label>
              <input
                id="location-name"
                value={form.name ?? ''}
                onChange={(event) => setField('name', event.target.value)}
                className="field"
                placeholder="Mumbai — Bandra West"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'location-name-error' : undefined}
              />
              {errors.name && <p id="location-name-error" role="alert" className="mt-1 text-[0.68rem] font-semibold text-rose-700">{errors.name}</p>}
            </div>
            <div><label className="label" htmlFor="location-city">City</label><input id="location-city" value={form.city ?? ''} onChange={(event) => setField('city', event.target.value)} className="field" placeholder="Mumbai" /></div>
            <div><label className="label" htmlFor="location-region">State</label><input id="location-region" value={form.region ?? ''} onChange={(event) => setField('region', event.target.value)} className="field" placeholder="Maharashtra" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="location-address">Address</label><input id="location-address" value={form.address ?? ''} onChange={(event) => setField('address', event.target.value)} className="field" placeholder="14 Turner Road, Bandra West" /></div>
            <div>
              <label className="label" htmlFor="location-lat">Latitude</label>
              <input
                id="location-lat"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="-90"
                max="90"
                value={form.lat ?? ''}
                onChange={(event) => setField('lat', event.target.value, 'coords')}
                className="field"
                aria-invalid={Boolean(errors.coords)}
                aria-describedby={errors.coords ? 'location-coords-error' : undefined}
              />
            </div>
            <div>
              <label className="label" htmlFor="location-lng">Longitude</label>
              <input
                id="location-lng"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="-180"
                max="180"
                value={form.lng ?? ''}
                onChange={(event) => setField('lng', event.target.value, 'coords')}
                className="field"
                aria-invalid={Boolean(errors.coords)}
                aria-describedby={errors.coords ? 'location-coords-error' : undefined}
              />
            </div>
            {errors.coords
              ? <p id="location-coords-error" role="alert" className="text-[0.68rem] font-semibold text-rose-700 sm:col-span-2">{errors.coords}</p>
              : <p className="text-[0.65rem] leading-5 text-muted sm:col-span-2">Coordinates are optional — leave both blank to keep this hub off the map. When set, it appears on the Home network map and the Browse hub map.</p>}
            <div>
              <label className="label" htmlFor="location-phone">Phone</label>
              <input
                id="location-phone"
                value={form.phone ?? ''}
                onChange={(event) => setField('phone', event.target.value)}
                className="field"
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'location-phone-error' : undefined}
              />
              {errors.phone && <p id="location-phone-error" role="alert" className="mt-1 text-[0.68rem] font-semibold text-rose-700">{errors.phone}</p>}
            </div>
            <div><label className="label" htmlFor="location-hours">Opening hours</label><input id="location-hours" value={form.hours ?? ''} onChange={(event) => setField('hours', event.target.value)} className="field" /></div>
            <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2"><Toggle checked={form.active !== false} onChange={(value) => setForm((current) => ({ ...current, active: value }))} label="Accepting bookings" /></div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => (saving ? null : setDeleteTarget(null))}
        title="Delete this hub?"
        description="Hubs referenced by bookings cannot be deleted. Mark them inactive instead."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={saving} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={remove} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Deleting…' : 'Delete hub'}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted"><span className="font-bold text-ink">{deleteTarget?.name}</span> will disappear from search and checkout.</p>
      </Modal>
    </div>
  );
}
