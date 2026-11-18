import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { CalendarRange, Pencil, Plus, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import { CopyButton, EmptyState, LoadError, Modal, TableScrollHint, Toggle } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getSiteContent } from '../../lib/site.js';
import { isValidDate, todayISO } from '../../lib/pricing.js';
import { RATE_RULE_KEYS, rateRuleErrors, rateRuleValues } from '../../lib/rateRules.js';
import { inr, longDate, shortDate } from '../../lib/format.js';

const TABS = [
  { key: 'extras', label: 'Add-ons' },
  { key: 'promos', label: 'Promo codes' },
  { key: 'insurance', label: 'Protection' },
  { key: 'rules', label: 'Rate rules' },
];

const blankExtra = { label: '', description: '', pricePerDay: 500, active: true };
const blankPromo = { code: '', description: '', type: 'percent', value: 10, minDays: 1, active: true, expiresAt: '', usageLimit: 500, firstBookingOnly: false };

/** Honest card status: an "Active" promo that expired yesterday is not active. */
function promoState(promo) {
  if (!promo.active) return { label: 'Off', tone: 'bg-stone-100 text-stone-600' };
  if (promo.expiresAt && promo.expiresAt < todayISO()) return { label: 'Expired', tone: 'bg-rose-50 text-rose-700' };
  if (Number(promo.usageLimit) > 0 && Number(promo.usedCount) >= Number(promo.usageLimit)) {
    return { label: 'Used up', tone: 'bg-amber-50 text-amber-800' };
  }
  return { label: 'Active', tone: 'bg-emerald-50 text-emerald-800' };
}

/** Expiry copy that never hides the year, and says "expired" once it has passed. */
function expiryLabel(iso) {
  if (!iso) return 'no expiry';
  const sameYear = iso.slice(0, 4) === todayISO().slice(0, 4);
  const stamp = sameYear ? shortDate(iso) : longDate(iso);
  return `${iso < todayISO() ? 'expired' : 'expires'} ${stamp}`;
}

function extraErrorsFor(form = {}) {
  const errors = {};
  if (!String(form.label ?? '').trim()) errors.label = 'Add a label so customers know what this is.';
  const price = Number(form.pricePerDay);
  if (!Number.isFinite(price) || price < 0) errors.pricePerDay = 'Enter a daily price of ₹0 or more.';
  return errors;
}

function promoErrorsFor(form = {}) {
  const errors = {};
  if (!/^[A-Z0-9]{3,20}$/.test(String(form.code ?? '').trim())) errors.code = 'Use 3–20 letters or numbers.';
  const value = Number(form.value);
  if (!Number.isInteger(value) || value <= 0) {
    errors.value = 'Enter a whole discount greater than zero.';
  } else if (form.type === 'percent' && value > 90) {
    errors.value = 'Percentage discounts cannot exceed 90%.';
  }
  const minDays = Number(form.minDays);
  if (!Number.isInteger(minDays) || minDays < 1) errors.minDays = 'Use a whole number of at least 1.';
  const usageLimit = Number(form.usageLimit);
  if (!Number.isInteger(usageLimit) || usageLimit < 0) errors.usageLimit = 'Use 0 for unlimited, or a positive number.';
  if (form.expiresAt && !isValidDate(form.expiresAt)) errors.expiresAt = 'Choose a valid expiry date.';
  return errors;
}

export default function Pricing() {
  const { isAdmin } = useAuth();
  const { meta } = useMeta();
  const readOnly = !isAdmin;
  const { refresh: refreshMeta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta?.settings), [meta?.settings]);
  const [tab, setTab] = useState('extras');
  const [extras, setExtras] = useState([]);
  const [promos, setPromos] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [extraForm, setExtraForm] = useState(null);
  const [promoForm, setPromoForm] = useState(null);
  const [tierForm, setTierForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ruleErrors, setRuleErrors] = useState({});
  const [extraErrors, setExtraErrors] = useState({});
  const [promoErrors, setPromoErrors] = useState({});
  const [rulesBaseline, setRulesBaseline] = useState('');
  const requestGuard = useRequestGuard();

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const [nextExtras, nextPromos, nextTiers, nextSettings] = await Promise.all([
        api.adminExtras(),
        api.adminPromos(),
        api.adminInsuranceTiers(),
        api.adminSettings(),
      ]);
      if (!requestGuard.isCurrent(guard)) return;
      setExtras(nextExtras);
      setPromos(nextPromos);
      setTiers(nextTiers);
      setSettings(nextSettings);
      setRulesBaseline(JSON.stringify(rateRuleValues(nextSettings)));
      setRuleErrors({});
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

  const dirtyRules = useMemo(
    () => JSON.stringify(rateRuleValues(settings)) !== rulesBaseline,
    [settings, rulesBaseline]
  );
  const ruleErrorCount = Object.keys(ruleErrors).length;

  const setRule = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setRuleErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const openExtra = (extra = null) => {
    setExtraErrors({});
    setExtraForm(extra ? { ...extra } : { ...blankExtra });
  };

  const openPromo = (promo = null) => {
    setPromoErrors({});
    setPromoForm(promo ? { ...promo, expiresAt: promo.expiresAt || '' } : { ...blankPromo });
  };

  const saveExtra = async () => {
    if (!extraForm) return;
    const found = extraErrorsFor(extraForm);
    if (Object.keys(found).length) {
      flushSync(() => setExtraErrors(found));
      document.querySelector('[role="dialog"] [aria-invalid="true"]')?.focus({ preventScroll: true });
      push(content.pricing_fix_errors, 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await api.adminSaveExtra(extraForm);
      setExtras(next);
      setExtraForm(null);
      await refreshMeta().catch(() => {});
      push(content.pricing_addon_saved, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePromo = async () => {
    if (!promoForm) return;
    const found = promoErrorsFor(promoForm);
    if (Object.keys(found).length) {
      flushSync(() => setPromoErrors(found));
      document.querySelector('[role="dialog"] [aria-invalid="true"]')?.focus({ preventScroll: true });
      push(content.pricing_fix_errors, 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await api.adminSavePromo(promoForm);
      setPromos(next);
      setPromoForm(null);
      push(content.pricing_promo_saved, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveTier = async () => {
    if (!tierForm) return;
    setSaving(true);
    try {
      const saved = await api.adminSaveInsuranceTier(tierForm);
      setTiers((current) => current.map((tier) => (tier.key === saved.key ? saved : tier)));
      setTierForm(null);
      await refreshMeta().catch(() => {});
      push(content.pricing_tier_updated, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveRules = async (event) => {
    event.preventDefault();
    if (readOnly || saving) return;
    const found = rateRuleErrors(settings);
    if (Object.keys(found).length) {
      // Focus must land on the first bad field even when the browser throttles
      // animation frames (background tabs, reduced-motion shells).
      flushSync(() => setRuleErrors(found));
      const firstKey = Object.keys(found)[0];
      const field = document.getElementById(`rate-${firstKey.replace(/_/g, '-')}`);
      field?.focus({ preventScroll: true });
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      push(content.pricing_fix_rate_rules, 'error');
      return;
    }
    setSaving(true);
    try {
      const patch = Object.fromEntries(RATE_RULE_KEYS.map((key) => [key, settings[key] ?? '']));
      const next = await api.adminSaveSettings(patch);
      const merged = { ...settings, ...next };
      setSettings(merged);
      setRulesBaseline(JSON.stringify(rateRuleValues(merged)));
      setRuleErrors({});
      push(content.pricing_rate_rules_saved, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.kind === 'extra') {
        await api.adminDeleteExtra(deleteTarget.item.id);
        setExtras(await api.adminExtras());
        await refreshMeta().catch(() => {});
      } else {
        await api.adminDeletePromo(deleteTarget.item.id);
        setPromos(await api.adminPromos());
      }
      push(content.pricing_deleted, 'success');
      setDeleteTarget(null);
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
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Pricing &amp; promos</h1>
          <p className="mt-1 text-xs text-muted">Add-ons, protection tiers, discounts and the rules behind every quote.</p>
        </div>
        {tab === 'extras' && <button type="button" onClick={() => openExtra()} className="btn btn-dark btn-sm"><Plus className="h-3.5 w-3.5" /> Add extra</button>}
        {tab === 'promos' && <button type="button" onClick={() => openPromo()} className="btn btn-dark btn-sm"><Plus className="h-3.5 w-3.5" /> New promo</button>}
      </header>

      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-white p-1.5 sm:flex">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`flex-1 rounded-xl px-3 py-2 text-[0.74rem] font-bold transition ${tab === item.key ? 'bg-ink text-cream' : 'text-muted hover:bg-paper hover:text-ink'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-stone-200/70" />
      ) : loadError ? (
        <LoadError title="Pricing could not load" message={loadError} onRetry={load} />
      ) : tab === 'extras' ? (
        extras.length ? (
          <>
            <TableScrollHint />
            <div className="table-wrap" role="region" aria-label="Add-ons table" tabIndex={0}>
              <table className="data-table">
              <thead><tr><th>Extra</th><th>Key</th><th>Price / day</th><th>Status</th><th /></tr></thead>
              <tbody>
                {extras.map((extra) => (
                  <tr key={extra.id}>
                    <td><p className="font-bold">{extra.label}</p><p className="max-w-md text-[0.64rem] text-muted">{extra.description}</p></td>
                    <td className="font-mono text-[0.66rem] text-muted">{extra.key}</td>
                    <td className="font-bold">{inr(extra.pricePerDay)}</td>
                    <td><span className={`badge ${extra.active ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{extra.active ? 'Active' : 'Hidden'}</span></td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openExtra(extra)} className="rounded-lg p-2 text-muted hover:bg-paper hover:text-ink" aria-label={`Edit ${extra.label}`}><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setDeleteTarget({ kind: 'extra', item: extra })} className="rounded-lg p-2 text-muted hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete ${extra.label}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        ) : <EmptyState icon={Tag} title="No add-ons yet" description="Create your first extra — child seats, additional drivers, Wi-Fi." action={<button type="button" onClick={() => openExtra()} className="btn btn-dark">Add extra</button>} />
      ) : tab === 'promos' ? (
        promos.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {promos.map((promo) => {
              const state = promoState(promo);
              return (
                <div key={promo.id} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 font-mono text-base font-extrabold tracking-wider">
                        {promo.code}
                        <CopyButton text={promo.code} />
                      </p>
                      <p className="mt-0.5 text-[0.66rem] text-muted">{promo.description}</p>
                    </div>
                    <span className={`badge shrink-0 ${state.tone}`}>{state.label}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="rounded-lg bg-lime/30 px-2 py-1 text-[0.68rem] font-extrabold">{promo.type === 'percent' ? `${promo.value}% off` : `${inr(promo.value)} off`}</span>
                    <span className="text-[0.62rem] text-muted">min {promo.minDays} day{promo.minDays === 1 ? '' : 's'}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[0.6rem] text-muted">
                    <span>{promo.usedCount} / {Number(promo.usageLimit) > 0 ? promo.usageLimit : '∞'} used</span>
                    <span>{expiryLabel(promo.expiresAt)}</span>
                  </div>
                  <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
                    <button type="button" onClick={() => openPromo(promo)} className="btn btn-white btn-sm flex-1"><Pencil className="h-3 w-3" /> Edit</button>
                    <button type="button" onClick={() => setDeleteTarget({ kind: 'promo', item: promo })} className="btn btn-ghost btn-sm text-rose-700" aria-label={`Delete promo ${promo.code}`}><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Tag}
            title="No promo codes yet"
            description="Create a code, choose a percentage or fixed discount, and set when it expires."
            action={<button type="button" onClick={() => openPromo()} className="btn btn-dark">New promo</button>}
          />
        )
      ) : tab === 'insurance' ? (
        <div className="grid gap-3 md:grid-cols-3">
          {tiers.map((tier) => (
            <div key={tier.key} className="flex flex-col rounded-2xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime/30 text-forest"><ShieldCheck className="h-4 w-4" /></span>
                <span className={`badge ${tier.active ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{tier.active ? 'Active' : 'Hidden'}</span>
              </div>
              <p className="mt-3 text-sm font-extrabold">{tier.label}</p>
              <p className="mt-1 text-[0.68rem] text-muted">{tier.pricePerDay === 0 ? 'Included' : `${inr(tier.pricePerDay)} / day`} · {tier.deductible === 0 ? 'zero deductible' : `${inr(tier.deductible)} deductible`}</p>
              <p className="mt-2 flex-1 text-[0.66rem] leading-5 text-muted">{tier.blurb}</p>
              <button type="button" onClick={() => setTierForm({ ...tier })} className="btn btn-white btn-sm mt-4"><Pencil className="h-3 w-3" /> Edit tier</button>
            </div>
          ))}
        </div>
      ) : (
        <form id="rate-rules-form" onSubmit={saveRules} noValidate className="rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold">Rate rules</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Applied server-side to every quote by the <span className="font-mono">quote_rental</span> function.</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-lime/30 px-2.5 py-1 text-[0.58rem] font-extrabold uppercase tracking-wider"><CalendarRange className="h-3 w-3" /> Live</span>
          </div>

          {ruleErrorCount > 0 && (
            <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.68rem] font-semibold text-amber-900">
              {ruleErrorCount} rate rule{ruleErrorCount === 1 ? ' needs' : 's need'} attention before this can be saved.
            </p>
          )}

          <div className="mt-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <RuleField name="tax_rate" label={`${String(settings.tax_label ?? '').trim() || 'GST'} rate (%)`} value={settings.tax_rate} onChange={(value) => setRule('tax_rate', value)} type="number" min="0" max="30" step="0.1" disabled={readOnly} error={ruleErrors.tax_rate} />
            <RuleField name="deposit_percent" label="Deposit (%)" value={settings.deposit_percent} onChange={(value) => setRule('deposit_percent', value)} type="number" min="1" max="100" disabled={readOnly} error={ruleErrors.deposit_percent} />
            <RuleField name="one_way_fee" label="One-way fee (₹)" value={settings.one_way_fee} onChange={(value) => setRule('one_way_fee', value)} type="number" min="0" disabled={readOnly} error={ruleErrors.one_way_fee} />
            <RuleField name="weekend_multiplier" label="Weekend multiplier" value={settings.weekend_multiplier} onChange={(value) => setRule('weekend_multiplier', value)} type="number" min="1" max="5" step="0.01" disabled={readOnly} error={ruleErrors.weekend_multiplier} />
            <RuleField name="seasonal_multiplier" label="Seasonal multiplier" value={settings.seasonal_multiplier} onChange={(value) => setRule('seasonal_multiplier', value)} type="number" min="1" max="5" step="0.01" disabled={readOnly} error={ruleErrors.seasonal_multiplier} />
            <RuleField name="hold_amount" label="Security deposit (₹)" value={settings.hold_amount} onChange={(value) => setRule('hold_amount', value)} type="number" min="0" disabled={readOnly} error={ruleErrors.hold_amount} />
            <RuleField name="seasonal_start" label="Season starts" value={settings.seasonal_start} onChange={(value) => setRule('seasonal_start', value)} type="date" disabled={readOnly} error={ruleErrors.seasonal_start} />
            <RuleField name="seasonal_end" label="Season ends" value={settings.seasonal_end} onChange={(value) => setRule('seasonal_end', value)} type="date" disabled={readOnly} error={ruleErrors.seasonal_end} />
            <RuleField name="min_age" label="Minimum driver age" value={settings.min_age} onChange={(value) => setRule('min_age', value)} type="number" min="16" max="90" disabled={readOnly} error={ruleErrors.min_age} />
            <RuleField name="max_rental_days" label="Maximum rental days" value={settings.max_rental_days} onChange={(value) => setRule('max_rental_days', value)} type="number" min="1" max="365" disabled={readOnly} error={ruleErrors.max_rental_days} />
          </div>

          <div className="mt-4 rounded-xl bg-paper p-3 text-[0.66rem] leading-5 text-muted">
            Weekend rates use the greater of the weekend and seasonal multipliers. Seasonal pricing applies only between the dates above. Changes affect new quotes instantly.
          </div>

          {readOnly && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/10 bg-ink px-3 py-3 text-[0.66rem] leading-5 text-cream" id="rate-rules-locked">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
              <span>
                Rate rules are controlled by super admins and applied server-side to every quote. You can review the current values here — save changes from <Link to="/admin/settings" className="font-bold text-lime underline decoration-lime decoration-2 underline-offset-4">Settings</Link>.
              </span>
            </div>
          )}

          {isAdmin && (
            <button type="submit" disabled={saving || !dirtyRules} title={!dirtyRules ? 'No changes to save' : undefined} className="btn btn-dark mt-4">
              {saving ? 'Saving…' : dirtyRules ? 'Save rate rules' : 'Saved'}
            </button>
          )}
        </form>
      )}

      <Modal
        open={Boolean(extraForm)}
        onClose={() => (saving ? null : setExtraForm(null))}
        title={extraForm?.id ? 'Edit add-on' : 'Add an add-on'}
        description="Extras appear in checkout and are charged per rental day."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setExtraForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={saveExtra} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save add-on'}</button>
          </div>
        )}
      >
        {extraForm && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="extra-label">Label</label>
              <input id="extra-label" value={extraForm.label} onChange={(event) => { setExtraForm((current) => ({ ...current, label: event.target.value })); setExtraErrors((current) => ({ ...current, label: '' })); }} className={`field ${extraErrors.label ? 'border-rose-400' : ''}`} placeholder="Child safety seat" aria-invalid={Boolean(extraErrors.label)} aria-describedby={extraErrors.label ? 'extra-label-error' : undefined} />
              {extraErrors.label && <p id="extra-label-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{extraErrors.label}</p>}
            </div>
            <div><label className="label" htmlFor="extra-description">Description</label><textarea id="extra-description" rows={2} value={extraForm.description} onChange={(event) => setExtraForm((current) => ({ ...current, description: event.target.value }))} className="field resize-none" /></div>
            <div>
              <label className="label" htmlFor="extra-price">Price per day (₹)</label>
              <input id="extra-price" type="number" min="0" value={extraForm.pricePerDay} onChange={(event) => { setExtraForm((current) => ({ ...current, pricePerDay: event.target.value })); setExtraErrors((current) => ({ ...current, pricePerDay: '' })); }} className={`field ${extraErrors.pricePerDay ? 'border-rose-400' : ''}`} aria-invalid={Boolean(extraErrors.pricePerDay)} aria-describedby={extraErrors.pricePerDay ? 'extra-price-error' : undefined} />
              {extraErrors.pricePerDay && <p id="extra-price-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{extraErrors.pricePerDay}</p>}
            </div>
            <div className="rounded-xl border border-line bg-paper p-3"><Toggle checked={extraForm.active !== false} onChange={(value) => setExtraForm((current) => ({ ...current, active: value }))} label="Visible at checkout" /></div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(promoForm)}
        onClose={() => (saving ? null : setPromoForm(null))}
        title={promoForm?.id ? 'Edit promo code' : 'Create promo code'}
        description="Codes are case-insensitive and validated server-side."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setPromoForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={savePromo} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save promo'}</button>
          </div>
        )}
      >
        {promoForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="promo-code">Code</label>
              <input id="promo-code" value={promoForm.code} onChange={(event) => { setPromoForm((current) => ({ ...current, code: event.target.value.toUpperCase() })); setPromoErrors((current) => ({ ...current, code: '' })); }} className={`field font-mono uppercase ${promoErrors.code ? 'border-rose-400' : ''}`} placeholder="FIRST10" aria-invalid={Boolean(promoErrors.code)} aria-describedby={promoErrors.code ? 'promo-code-error' : undefined} />
              {promoErrors.code && <p id="promo-code-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{promoErrors.code}</p>}
            </div>
            <div className="sm:col-span-2"><label className="label" htmlFor="promo-description">Description</label><input id="promo-description" value={promoForm.description} onChange={(event) => setPromoForm((current) => ({ ...current, description: event.target.value }))} className="field" placeholder="10% off your first trip" /></div>
            <div>
              <label className="label" htmlFor="promo-type">Type</label>
              <select id="promo-type" value={promoForm.type} onChange={(event) => setPromoForm((current) => ({ ...current, type: event.target.value }))} className="field">
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="promo-value">Value</label>
              <input id="promo-value" type="number" min="1" value={promoForm.value} onChange={(event) => { setPromoForm((current) => ({ ...current, value: event.target.value })); setPromoErrors((current) => ({ ...current, value: '' })); }} className={`field ${promoErrors.value ? 'border-rose-400' : ''}`} aria-invalid={Boolean(promoErrors.value)} aria-describedby={promoErrors.value ? 'promo-value-error' : undefined} />
              {promoErrors.value && <p id="promo-value-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{promoErrors.value}</p>}
            </div>
            <div>
              <label className="label" htmlFor="promo-min-days">Minimum days</label>
              <input id="promo-min-days" type="number" min="1" value={promoForm.minDays} onChange={(event) => { setPromoForm((current) => ({ ...current, minDays: event.target.value })); setPromoErrors((current) => ({ ...current, minDays: '' })); }} className={`field ${promoErrors.minDays ? 'border-rose-400' : ''}`} aria-invalid={Boolean(promoErrors.minDays)} aria-describedby={promoErrors.minDays ? 'promo-min-days-error' : undefined} />
              {promoErrors.minDays && <p id="promo-min-days-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{promoErrors.minDays}</p>}
            </div>
            <div>
              <label className="label" htmlFor="promo-usage-limit">Usage limit</label>
              <input id="promo-usage-limit" type="number" min="0" value={promoForm.usageLimit} onChange={(event) => { setPromoForm((current) => ({ ...current, usageLimit: event.target.value })); setPromoErrors((current) => ({ ...current, usageLimit: '' })); }} className={`field ${promoErrors.usageLimit ? 'border-rose-400' : ''}`} aria-invalid={Boolean(promoErrors.usageLimit)} aria-describedby={promoErrors.usageLimit ? 'promo-usage-limit-error' : undefined} />
              {promoErrors.usageLimit && <p id="promo-usage-limit-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{promoErrors.usageLimit}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="promo-expires">Expires on</label>
              <input id="promo-expires" type="date" value={promoForm.expiresAt || ''} onChange={(event) => { setPromoForm((current) => ({ ...current, expiresAt: event.target.value })); setPromoErrors((current) => ({ ...current, expiresAt: '' })); }} className={`field ${promoErrors.expiresAt ? 'border-rose-400' : ''}`} aria-invalid={Boolean(promoErrors.expiresAt)} aria-describedby={promoErrors.expiresAt ? 'promo-expires-error' : undefined} />
              {promoErrors.expiresAt && <p id="promo-expires-error" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{promoErrors.expiresAt}</p>}
            </div>
            <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2"><Toggle checked={promoForm.active !== false} onChange={(value) => setPromoForm((current) => ({ ...current, active: value }))} label="Active" /></div>
            <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
              <Toggle
                checked={Boolean(promoForm.firstBookingOnly)}
                onChange={(value) => setPromoForm((current) => ({ ...current, firstBookingOnly: value }))}
                label="First booking only"
                description="Applies only to customers who have not completed a trip yet. Existing customers are told the code is for first bookings."
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(tierForm)}
        onClose={() => (saving ? null : setTierForm(null))}
        title="Edit protection tier"
        description="Prices and deductibles apply to new quotes immediately."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setTierForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={saveTier} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save tier'}</button>
          </div>
        )}
      >
        {tierForm && (
          <div className="space-y-3">
            <div><label className="label" htmlFor="tier-label">Label</label><input id="tier-label" value={tierForm.label} maxLength={40} onChange={(event) => setTierForm((current) => ({ ...current, label: event.target.value }))} className="field" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="tier-price">Price per day (₹)</label><input id="tier-price" type="number" min="0" value={tierForm.pricePerDay} onChange={(event) => setTierForm((current) => ({ ...current, pricePerDay: event.target.value }))} className="field" /></div>
              <div><label className="label" htmlFor="tier-deductible">Deductible (₹)</label><input id="tier-deductible" type="number" min="0" value={tierForm.deductible} onChange={(event) => setTierForm((current) => ({ ...current, deductible: event.target.value }))} className="field" /></div>
            </div>
            <div><label className="label" htmlFor="tier-blurb">Customer-facing description</label><textarea id="tier-blurb" rows={3} maxLength={200} value={tierForm.blurb} onChange={(event) => setTierForm((current) => ({ ...current, blurb: event.target.value }))} className="field resize-none" /></div>
            <div className="rounded-xl border border-line bg-paper p-3"><Toggle checked={tierForm.active !== false} onChange={(value) => setTierForm((current) => ({ ...current, active: value }))} label="Offer this tier at checkout" /></div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => (saving ? null : setDeleteTarget(null))}
        title="Delete this item?"
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={saving} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={remove} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Deleting…' : 'Delete'}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">You are deleting <span className="font-bold text-ink">{deleteTarget?.item?.label || deleteTarget?.item?.code}</span>. Existing bookings keep their historical pricing{deleteTarget?.kind === 'promo' ? ', and the code stops working immediately' : ''}.</p>
      </Modal>
    </div>
  );
}

function RuleField({ name, label, value, onChange, type = 'text', step, min, max, disabled, error }) {
  const id = `rate-${name.replace(/_/g, '-')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={`field ${error ? 'border-rose-400' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : disabled ? 'rate-rules-locked' : undefined}
      />
      {error && <p id={`${id}-error`} className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
