import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Database, FileText, Palette, RefreshCw, Save, ShieldCheck,
} from 'lucide-react';
import { LoadError, Modal, Toggle } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { isSupabaseConfigured } from '../../lib/config.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges.js';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { invoiceNumber } from '../../lib/finance.js';
import { rateRuleErrors } from '../../lib/rateRules.js';
import { cn } from '../../lib/format.js';
import {
  ACCENT_OPTIONS,
  MOTION_OPTIONS,
  RADIUS_OPTIONS,
  THEME_DEFAULTS,
  normalizeThemeSettings,
  resolveTheme,
  MODE_OPTIONS,
} from '../../lib/theme.js';

export default function Settings() {
  const { isDemo, refresh } = useAuth();
  const { refresh: refreshMeta } = useMeta();
  const { push } = useToast();
  const [settings, setSettings] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState('');
  const [resetting, setResetting] = useState(false);
  const requestGuard = useRequestGuard();

  const dirty = Boolean(settings) && JSON.stringify(settings) !== baseline;
  useUnsavedChanges(dirty);

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const next = await api.adminSettings();
      if (!requestGuard.isCurrent(guard)) return;
      const merged = { ...THEME_DEFAULTS, ...next };
      setSettings(merged);
      setBaseline(JSON.stringify(merged));
      setErrors({});
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

  const set = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    // Delete the key rather than blanking it: `errorCount` counts keys, so a
    // blank entry would keep reporting a fixed field as "needs attention".
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = () => {
    // One shared rule set: Settings and Pricing → Rate rules edit the same rows.
    const found = { ...rateRuleErrors(settings) };

    const taxLabel = String(settings.tax_label ?? '').trim();
    if (taxLabel.length < 2 || taxLabel.length > 16) {
      found.tax_label = 'Use 2–16 characters, for example GST or VAT.';
    }
    const prefix = String(settings.invoice_prefix ?? '').trim();
    if (!prefix) {
      found.invoice_prefix = 'Add a prefix for invoice numbers.';
    } else if (prefix.length > 24) {
      found.invoice_prefix = 'Keep the invoice prefix under 24 characters.';
    } else if (!/^[A-Za-z0-9/_-]+$/.test(prefix)) {
      found.invoice_prefix = 'Use letters, numbers, /, _ or - only.';
    }
    if (String(settings.tax_invoice_note ?? '').trim().length > 240) {
      found.tax_invoice_note = 'Keep the invoice note under 240 characters.';
    }
    return found;
  };

  const save = async (event) => {
    event.preventDefault();
    if (!settings || saving) return;
    const found = validate();
    if (Object.keys(found).length) {
      // Focus must land on the first bad field even when the browser throttles
      // animation frames (background tabs, reduced-motion shells).
      flushSync(() => setErrors(found));
      const first = document.querySelector('#settings-form [aria-invalid="true"]');
      first?.focus({ preventScroll: true });
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      push('Fix the highlighted settings before saving.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...settings, ...normalizeThemeSettings(settings) };
      const next = await api.adminSaveSettings(payload);
      const merged = { ...payload, ...next };
      setSettings(merged);
      setBaseline(JSON.stringify(merged));
      setErrors({});
      // The settings are already committed; a meta refresh failure must not
      // read as "save failed" and tempt the operator to save twice.
      await refreshMeta().catch(() => {});
      push('Settings saved. New quotes use these values immediately.', 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetDemo = async () => {
    if (!api.resetDemoData || resetting) return;
    setResetting(true);
    try {
      await api.resetDemoData();
      await refresh();
      setResetOpen(false);
      push('Demo data reset to its original state.', 'success');
      window.location.href = '/';
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setResetting(false);
    }
  };

  const errorCount = useMemo(() => Object.keys(errors).length, [errors]);
  const theme = resolveTheme(settings);

  if (loading) return <div className="h-96 animate-pulse rounded-2xl bg-stone-200/70" />;

  if (!settings) {
    return (
      <LoadError
        title="Settings could not load"
        message={loadError || 'Check your connection and try again.'}
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Settings</h1>
          <p className="mt-1 text-xs text-muted">Financial defaults, tax rules, invoice numbering, booking approval, appearance and seasonal pricing.</p>
        </div>
        <button type="submit" form="settings-form" disabled={saving || !dirty} className="btn btn-dark btn-sm">
          <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : dirty ? 'Save settings' : 'All changes saved'}
        </button>
      </header>

      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[0.7rem] ${
        dirty ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}>
        <span className="inline-flex items-center gap-2 font-semibold">
          {dirty ? <FileText className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {dirty ? 'You have unsaved financial settings.' : 'Financial settings are up to date.'}
        </span>
        {errorCount > 0 && <span className="font-bold text-rose-700">{errorCount} field{errorCount === 1 ? ' needs' : 's need'} attention</span>}
      </div>

      <form id="settings-form" onSubmit={save} noValidate className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-extrabold"><Palette className="h-4 w-4 text-forest" /> Appearance</h2>
                <p className="mt-0.5 text-[0.65rem] leading-5 text-muted">Accent, corner radius, motion and the Browse hub map. Saved settings apply everywhere.</p>
              </div>
              <span className="badge shrink-0 bg-lime/30 text-ink">Theme</span>
            </div>

            <div className="mt-4">
              <p className="label">Accent</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label="Accent colour">
                {ACCENT_OPTIONS.map((option) => {
                  const active = settings.theme_accent === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => set('theme_accent', option.id)}
                      aria-pressed={active}
                      className={cn(
                        'group rounded-xl border p-1.5 text-center transition',
                        active ? 'border-ink bg-ink/[0.04] shadow-[0_10px_20px_-18px_rgba(10,15,11,0.6)]' : 'border-line hover:border-ink/40'
                      )}
                    >
                      <span
                        className="block h-7 w-full rounded-lg ring-1 ring-inset ring-black/10"
                        style={{ background: `linear-gradient(135deg, ${option.accent}, ${option.deep})` }}
                      />
                      <span className={cn('mt-1 block text-[0.58rem] font-extrabold', active ? 'text-ink' : 'text-muted')}>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="label">Corner radius</p>
                <SegmentedControl label="Corner radius" value={settings.theme_radius} options={RADIUS_OPTIONS} onChange={(value) => set('theme_radius', value)} />
              </div>
              <div>
                <p className="label">Motion</p>
                <SegmentedControl label="Motion" value={settings.theme_motion} options={MOTION_OPTIONS} onChange={(value) => set('theme_motion', value)} />
              </div>
              <div>
                <p className="label">Appearance mode</p>
                <SegmentedControl label="Appearance mode" value={settings.theme_mode || 'light'} options={MODE_OPTIONS} onChange={(value) => set('theme_mode', value)} />
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-line bg-paper p-3.5">
              <Toggle
                checked={settings.map_view_enabled !== 'false'}
                onChange={(next) => set('map_view_enabled', next ? 'true' : 'false')}
                label="Hub map view"
                description="Show the live hub coverage map alongside grid and list in Browse. Pin positions come from Admin → Locations."
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper p-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center text-ink shadow-sm"
                  style={{ background: theme.accent.accent, borderRadius: theme.radius.inner }}
                >
                  <Palette className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[0.7rem] font-extrabold">Live preview</p>
                  <p className="text-[0.6rem] text-muted">{theme.accent.label} accent · {theme.radius.label} corners · {theme.motion.label} motion</p>
                </div>
              </div>
              <span className="btn btn-sm pointer-events-none" style={{ background: theme.accent.accent, borderRadius: 999, color: '#0a0f0b' }}>Primary action</span>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-sm font-extrabold">Financial defaults</h2>
            <p className="mt-0.5 text-[0.65rem] text-muted">Used by the client and server quote engines on every checkout.</p>
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="GST rate (%)" value={settings.tax_rate} onChange={(v) => set('tax_rate', v)} error={errors.tax_rate} type="number" min="0" max="30" step="0.1" />
              <Field label="Deposit (%)" value={settings.deposit_percent} onChange={(v) => set('deposit_percent', v)} error={errors.deposit_percent} type="number" min="1" max="100" />
              <Field label="Security deposit (₹)" value={settings.hold_amount} onChange={(v) => set('hold_amount', v)} error={errors.hold_amount} type="number" min="0" />
              <Field label="One-way fee (₹)" value={settings.one_way_fee} onChange={(v) => set('one_way_fee', v)} error={errors.one_way_fee} type="number" min="0" />
              <Field label="Weekend multiplier" value={settings.weekend_multiplier} onChange={(v) => set('weekend_multiplier', v)} error={errors.weekend_multiplier} type="number" min="1" max="5" step="0.01" />
              <Field label="Seasonal multiplier" value={settings.seasonal_multiplier} onChange={(v) => set('seasonal_multiplier', v)} error={errors.seasonal_multiplier} type="number" min="1" max="5" step="0.01" />
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-extrabold"><FileText className="h-4 w-4 text-forest" /> Invoices &amp; GST</h2>
                <p className="mt-0.5 text-[0.65rem] text-muted">The tax label and numbering used on every new voucher and finance export.</p>
              </div>
              <Link to="/admin/finance" className="btn btn-white btn-sm shrink-0"><FileText className="h-3.5 w-3.5" /> Finance &amp; GST</Link>
            </div>
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <Field label="Tax label" value={settings.tax_label} onChange={(v) => set('tax_label', v)} error={errors.tax_label} maxLength={16} placeholder="GST" />
              <Field label="Invoice prefix" value={settings.invoice_prefix} onChange={(v) => set('invoice_prefix', v)} error={errors.invoice_prefix} maxLength={24} placeholder="INV/26-27/" />
            </div>

            <div className="mt-4">
              <p className="label">Tax pricing</p>
              <SegmentedControl
                label="Tax pricing"
                value={settings.tax_inclusive === 'true' ? 'inclusive' : 'exclusive'}
                options={[
                  { id: 'exclusive', label: 'Added at checkout' },
                  { id: 'inclusive', label: 'Included in prices' },
                ]}
                onChange={(value) => set('tax_inclusive', value === 'inclusive' ? 'true' : 'false')}
              />
              <p className="mt-1.5 text-[0.62rem] leading-5 text-muted">
                {settings.tax_inclusive === 'true'
                  ? 'Listed rental, add-on and protection prices already contain tax. The invoice extracts the tax portion from the total.'
                  : 'Listed prices exclude tax. The quote and invoice add tax on the taxable items at checkout.'}
              </p>
            </div>

            <div className="mt-4">
              <p className="label">Tax applies to</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-paper p-3">
                  <Toggle
                    checked={settings.tax_on_extras !== 'false'}
                    onChange={(next) => set('tax_on_extras', next ? 'true' : 'false')}
                    label="Add-ons"
                    description="GPS, child seat and other extras"
                  />
                </div>
                <div className="rounded-xl border border-line bg-paper p-3">
                  <Toggle
                    checked={settings.tax_on_insurance !== 'false'}
                    onChange={(next) => set('tax_on_insurance', next ? 'true' : 'false')}
                    label="Protection"
                    description="Damage waiver and coverage tiers"
                  />
                </div>
                <div className="rounded-xl border border-line bg-paper p-3">
                  <Toggle
                    checked={settings.tax_on_one_way !== 'false'}
                    onChange={(next) => set('tax_on_one_way', next ? 'true' : 'false')}
                    label="One-way fee"
                    description="Relocation between different hubs"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="setting-tax-invoice-note">Invoice tax note</label>
              <textarea
                id="setting-tax-invoice-note"
                rows={2}
                maxLength={240}
                value={settings.tax_invoice_note ?? ''}
                onChange={(event) => set('tax_invoice_note', event.target.value)}
                className={`field resize-none ${errors.tax_invoice_note ? 'border-rose-400' : ''}`}
                placeholder="Printed beside the tax line on every customer invoice."
                aria-invalid={Boolean(errors.tax_invoice_note)}
              />
              {errors.tax_invoice_note && <p className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{errors.tax_invoice_note}</p>}
            </div>

            <div className="mt-4 rounded-xl border border-line bg-paper p-3">
              <p className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">Invoice number preview</p>
              <p className="mt-1 break-all font-mono text-[0.72rem] font-bold">{invoiceNumber(settings, 'RV-ABC123')}</p>
              <p className="mt-1 text-[0.62rem] leading-5 text-muted">
                New invoices use this number and show {String(settings.tax_label || 'GST').trim() || 'GST'} at {String(settings.tax_rate ?? '').trim() || 18}%
                {settings.tax_inclusive === 'true' ? ' included in the listed prices.' : ' added to the taxable subtotal.'}
              </p>
            </div>
            <p className="mt-3 text-[0.62rem] leading-5 text-muted">
              Legal name, GSTIN and registered address live with the rest of your business details in <Link to="/admin/content" className="font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">Content &amp; policies</Link>.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-sm font-extrabold">Seasonal pricing</h2>
            <p className="mt-0.5 text-[0.65rem] text-muted">The greater of the weekend and seasonal multiplier is applied per night. Leave dates blank to disable.</p>
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <Field label="Season starts" value={settings.seasonal_start} onChange={(v) => set('seasonal_start', v)} error={errors.seasonal_start} type="date" />
              <Field label="Season ends" value={settings.seasonal_end} onChange={(v) => set('seasonal_end', v)} error={errors.seasonal_end} type="date" />
            </div>
            <div className="mt-4 rounded-xl bg-paper p-3 text-[0.68rem] leading-5 text-muted">
              Currency is fixed to INR (₹) for Razorpay compliance. Security deposits are shown separately and are not included in the online rental charge.
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> Booking rules</h2>
                <p className="mt-0.5 text-[0.65rem] text-muted">Cancellation, rental length, eligibility and fuel fees live with the customer-facing policy copy.</p>
              </div>
              <Link to="/admin/content" className="btn btn-white btn-sm shrink-0"><FileText className="h-3.5 w-3.5" /> Edit policies</Link>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.booking_auto_confirm !== 'false'}
                  onChange={(next) => set('booking_auto_confirm', next ? 'true' : 'false')}
                  label="Auto-confirm paid bookings"
                  description="When off, paid bookings arrive as pending and staff approve them from Admin → Bookings before the voucher is confirmed."
                />
              </div>
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.block_expired_docs === 'true'}
                  onChange={(next) => set('block_expired_docs', next ? 'true' : 'false')}
                  label="Block handover on expired documents"
                  description="When on, the desk refuses to start a trip while the vehicle's insurance or PUC has lapsed — a lapsed document makes the rental void. Untracked dates stay a warning so incomplete fleet data cannot lock the desk."
                />
              </div>
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.operational_reminders !== 'false'}
                  onChange={(next) => set('operational_reminders', next ? 'true' : 'false')}
                  label="Operational reminders"
                  description="When on, staff can send pick-up and return reminders from the desk, and the emails + in-app notices reach customers. Switch off to stop all operational reminder sends at once."
                />
              </div>
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.review_replies_enabled !== 'false'}
                  onChange={(next) => set('review_replies_enabled', next ? 'true' : 'false')}
                  label="Public replies to reviews"
                  description="When on, staff can reply to a review from Admin → Reviews and the reply appears under it on the vehicle page. Switch off to hide existing replies and stop new ones."
                />
              </div>
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.one_way_enabled !== 'false'}
                  onChange={(next) => set('one_way_enabled', next ? 'true' : 'false')}
                  label="One-way rentals"
                  description="When off, every trip must pick up and drop off at the same hub: the relocation fee is no longer quoted, checkout locks the drop-off hub, and the adapters reject any mismatch."
                />
              </div>
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.require_deposit_at_desk === 'true'}
                  onChange={(next) => set('require_deposit_at_desk', next ? 'true' : 'false')}
                  label="Require the deposit before handover"
                  description="When on, a booking with a security deposit cannot be started until the desk ticks 'Deposit collected'. Stops a vehicle leaving without the deposit — the desk sees the missing tick as a blocked item."
                />
              </div>
              <div className="rounded-xl border border-line bg-paper p-3.5">
                <Toggle
                  checked={settings.licence_validity_required === 'true'}
                  onChange={(next) => set('licence_validity_required', next ? 'true' : 'false')}
                  label="Licence must cover the whole rental"
                  description="When on (default), a licence that expires before the drop-off date is refused at checkout and flagged at the handover desk — the second half of the trip would be illegal to drive. Entries are still validated when off."
                />
              </div>
            </div>
            <ul className="mt-4 grid gap-2 text-[0.7rem] leading-5 text-muted sm:grid-cols-2">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Minimum and maximum rental length.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Cancellation window and partial refund.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Late-return and refuelling fees.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Minimum car and bike rider ages.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Staff approval before acceptance.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Trip edits and cancellation reasons.</li>
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <Link to="/admin/content" className="block rounded-2xl border border-line bg-white p-5 transition hover:border-ink">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-extrabold"><FileText className="h-4 w-4 text-forest" /> Content & policies</h2>
                <p className="mt-0.5 text-[0.65rem] leading-5 text-muted">Homepage copy, contact details, feature toggles, booking policies, testimonials and FAQs.</p>
              </div>
              <span className="badge shrink-0 bg-lime/30 text-ink">Open</span>
            </div>
          </Link>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-sm font-extrabold">Integrations</h2>
            <div className="mt-3 space-y-2.5">
              <IntegrationRow
                label="Supabase database & auth"
                ok={isSupabaseConfigured}
                detail={isSupabaseConfigured ? 'Connected via VITE_SUPABASE_URL' : 'Demo mode — localStorage only'}
              />
              <IntegrationRow
                label="Razorpay payments"
                ok={!isDemo || isSupabaseConfigured}
                detail={isSupabaseConfigured ? 'Edge Functions: order, verify, refund' : 'Simulated checkout in demo mode'}
              />
              <IntegrationRow
                label="Vehicle image storage"
                ok={isSupabaseConfigured}
                detail={isSupabaseConfigured ? 'Bucket: vehicle-images' : 'Image URLs / data URLs only'}
              />
            </div>
            <p className="mt-3 text-[0.6rem] leading-4 text-muted">
              Secrets such as <span className="font-mono">RAZORPAY_KEY_SECRET</span> are stored in Supabase Edge Function secrets and never exposed to the browser.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> Security</h2>
            <ul className="mt-3 space-y-2 text-[0.65rem] leading-5 text-muted">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Row Level Security on every table.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Booking totals calculated server-side.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Razorpay signatures verified in Edge Functions.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Double-bookings blocked by a GiST exclusion constraint.</li>
            </ul>
          </section>

          {isDemo && (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-rose-900"><AlertTriangle className="h-4 w-4" /> Danger zone</h2>
              <p className="mt-1 text-[0.65rem] leading-5 text-rose-800/80">Reset all demo bookings, users, reviews and settings stored in this browser.</p>
              <button type="button" onClick={() => setResetOpen(true)} disabled={resetting} className="btn btn-outline btn-sm mt-3 border-rose-300 text-rose-800"><RefreshCw className="h-3.5 w-3.5" /> Reset demo data</button>
            </section>
          )}

          <div className="rounded-2xl border border-line bg-ink p-5 text-cream">
            <Database className="h-5 w-5 text-lime" />
            <p className="mt-2 text-xs font-extrabold">Supabase-only architecture</p>
            <p className="mt-1 text-[0.62rem] leading-4 text-cream/55">Postgres, Auth, Storage and Edge Functions. No separate application server to patch or scale.</p>
          </div>
        </div>

        <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 p-2.5 shadow-lg backdrop-blur lg:hidden">
          <span className="text-[0.66rem] font-semibold text-muted">
            {errorCount > 0
              ? `${errorCount} field${errorCount === 1 ? ' needs' : 's need'} attention`
              : dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <button type="submit" disabled={saving || !dirty} className="btn btn-dark btn-sm">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <Modal
        open={resetOpen}
        onClose={() => (resetting ? null : setResetOpen(false))}
        title="Reset demo data?"
        description="Every demo booking, custom account and settings change in this browser will be erased."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setResetOpen(false)} disabled={resetting} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={resetDemo} disabled={resetting} className="btn btn-dark flex-1">{resetting ? 'Resetting…' : 'Reset everything'}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">You will be signed out and the original demo accounts and fleet will be restored.</p>
      </Modal>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', step, min, max, maxLength, placeholder, error }) {
  const id = `setting-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        step={step}
        min={min}
        max={max}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={`field ${error ? 'border-rose-400' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

function SegmentedControl({ label, value, options, onChange }) {
  return (
    <div className="flex gap-1 rounded-xl border border-line bg-paper p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={cn(
            'flex-1 rounded-lg px-2 py-1.5 text-[0.64rem] font-extrabold transition',
            value === option.id ? 'bg-ink text-cream shadow-sm' : 'text-muted hover:bg-white hover:text-ink'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function IntegrationRow({ label, ok, detail }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
      <div>
        <p className="text-[0.7rem] font-extrabold">{label}</p>
        <p className="text-[0.6rem] text-muted">{detail}</p>
      </div>
      <span className={`badge shrink-0 ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{ok ? 'Ready' : 'Demo'}</span>
    </div>
  );
}
