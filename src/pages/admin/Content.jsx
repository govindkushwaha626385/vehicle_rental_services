import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  BadgeCheck, CheckCircle2, ExternalLink, FileText, Globe2, HelpCircle, ImagePlus, MapPin, Pencil, Plus,
  Quote, RotateCcw, Search, Sparkles, Star, Trash2, Upload, X,
} from 'lucide-react';
import { EmptyState, Modal, Toggle } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges.js';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import {
  CONTENT_LIST_SCHEMAS,
  PAGE_TEXT_DEFAULTS,
  PAGE_TEXT_KEYS,
  SITE_DEFAULTS,
  contentForm,
  contentPayload,
  hasErrors,
  sitePolicy,
  validateContentForm,
} from '../../lib/site.js';
import { groupContentKeys } from '../../lib/contentGroups.js';
import { inr } from '../../lib/format.js';

// Page-copy keys are grouped by prefix in a pure module so the console stays
// focused on rendering and the mapping is contract-tested.
const PAGE_TEXT_GROUPS = groupContentKeys(PAGE_TEXT_KEYS);

const PRETTY_WORDS = {
  cta: 'CTA', seo: 'SEO', faq: 'FAQ', gst: 'GST', gstin: 'GSTIN', url: 'URL', id: 'ID', whatsapp: 'WhatsApp',
};

const LABEL_OVERRIDES = {
  site_name: 'Site name',
  default_meta_title: 'Default meta title',
  default_meta_description: 'Default meta description',
  default_meta_image: 'Default share image',
};

const prettyLabel = (key) => LABEL_OVERRIDES[key] ?? key
  .replace(/^(announcement|nav|footer|home|about|contact|terms|privacy|site|default)_/, '')
  .split('_')
  .map((word, index) => {
    const lower = word.toLowerCase();
    if (PRETTY_WORDS[lower]) return PRETTY_WORDS[lower];
    const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
    return index === 0 ? cap : lower;
  })
  .join(' ');

const MULTILINE_KEY = /(_description|_body|_lead|_tagline|_copy)$/;

const LINK_LIST = /(_links)$/;

const listItemView = (kind, item = {}) => {
  if (LINK_LIST.test(kind)) return { title: item.label, subtitle: item.to };
  if (kind === 'home_steps') return { title: item.title, subtitle: [item.number, item.copy].filter(Boolean).join(' · ') };
  if (kind === 'home_categories') return { title: item.label, subtitle: [item.type, item.copy].filter(Boolean).join(' · ') };
  if (kind === 'routes') return { title: item.label, subtitle: [item.from, item.to].filter(Boolean).join(' → ') };
  return { title: item.title, subtitle: item.copy };
};

/** Focus the first invalid field after a render, without relying on rAF. */
function focusFirstInvalid(scope = '#content-form') {
  const first = document.querySelector(`${scope} [aria-invalid="true"]`);
  if (!first) return;
  first.focus({ preventScroll: true });
  first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export default function Content() {
  const { isAdmin, isDemo } = useAuth();
  const { refresh: refreshMeta } = useMeta();
  const { push } = useToast();
  const [form, setForm] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [savedSettings, setSavedSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [heroUploading, setHeroUploading] = useState(false);
  const [heroUploadError, setHeroUploadError] = useState('');
  const [errors, setErrors] = useState({});
  const [copyQuery, setCopyQuery] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [badgeForm, setBadgeForm] = useState(null);
  const [testimonialForm, setTestimonialForm] = useState(null);
  const [faqForm, setFaqForm] = useState(null);
  const [listForm, setListForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const requestGuard = useRequestGuard();

  const payload = useMemo(() => (form ? contentPayload(form) : {}), [form]);
  const baselinePayload = useMemo(() => {
    try {
      return JSON.parse(baseline || '{}');
    } catch {
      return {};
    }
  }, [baseline]);
  const dirtyCount = Object.keys(payload)
    .filter((key) => payload[key] !== baselinePayload[key]).length;
  const dirty = Boolean(form) && dirtyCount > 0;

  const copyMatches = useMemo(() => {
    const query = copyQuery.trim().toLowerCase();
    if (!form || !query) return PAGE_TEXT_GROUPS;
    return PAGE_TEXT_GROUPS
      .map((group) => ({
        ...group,
        keys: group.keys.filter((key) => (
          key.toLowerCase().includes(query)
          || prettyLabel(key).toLowerCase().includes(query)
          || String(form[key] ?? '').toLowerCase().includes(query)
        )),
      }))
      .filter((group) => group.keys.length);
  }, [copyQuery, form]);
  const copyMatchCount = copyMatches.reduce((total, group) => total + group.keys.length, 0);

  useUnsavedChanges(dirty);

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const settings = await api.adminSettings();
      if (!requestGuard.isCurrent(guard)) return;
      const next = contentForm(settings);
      setForm(next);
      setSavedSettings(settings);
      setBaseline(JSON.stringify(contentPayload(next)));
      setErrors({});
    } catch (error) {
      if (!requestGuard.isCurrent(guard)) return;
      setLoadError(error.message);
    } finally {
      if (requestGuard.isCurrent(guard)) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  // Only surface “Reset to default” once a field actually differs, so the
  // console stays calm for the hundreds of strings nobody has touched.
  const resetField = (key) => (
    form && form[key] !== SITE_DEFAULTS[key] ? () => set(key, SITE_DEFAULTS[key]) : undefined
  );
  const resetCopy = (key) => (
    form && form[key] !== PAGE_TEXT_DEFAULTS[key] ? () => set(key, PAGE_TEXT_DEFAULTS[key]) : undefined
  );

  const uploadHero = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setHeroUploading(true);
    setHeroUploadError('');
    try {
      const url = await api.uploadVehicleImage(file);
      set('hero_image_url', url);
      push('Hero image uploaded. Publish to make it live.', 'success');
    } catch (error) {
      setHeroUploadError(error.message);
    } finally {
      setHeroUploading(false);
    }
  };

  const applySaved = (nextForm, settings) => {
    setForm(nextForm);
    setBaseline(JSON.stringify(contentPayload(nextForm)));
    if (settings) setSavedSettings(settings);
    setErrors({});
    setHeroUploadError('');
  };

  const save = async (event) => {
    if (event) event.preventDefault();
    if (!form || saving) return;
    if (!isAdmin) {
      push('Only super admins can publish content.', 'error');
      return;
    }
    const found = validateContentForm(form);
    if (hasErrors(found)) {
      flushSync(() => setErrors(found));
      focusFirstInvalid();
      push(`Fix ${Object.keys(found).length} highlighted field${Object.keys(found).length === 1 ? '' : 's'} before saving.`, 'error');
      return;
    }
    setSaving(true);
    try {
      const patch = contentPayload(form);
      const saved = await api.adminSaveSettings(patch);
      const merged = { ...saved, ...patch };
      applySaved(contentForm(merged), merged);
      push('Content saved. The customer site is already using it.', 'success');
      try {
        await refreshMeta();
      } catch {
        push('Content saved, but the live preview could not refresh. Reload to see it.', 'error');
      }
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!savedSettings) return;
    const next = contentForm(savedSettings);
    applySaved(next);
    setCopyQuery('');
    setDiscardOpen(false);
    push('Unsaved changes discarded.', 'success');
  };

  const resetToDefaults = async () => {
    setSaving(true);
    try {
      const defaults = contentForm({});
      const patch = contentPayload(defaults);
      await api.adminSaveSettings(patch);
      applySaved(defaults, patch);
      setResetOpen(false);
      setCopyQuery('');
      push('Content restored to the shipped defaults.', 'success');
      try {
        await refreshMeta();
      } catch {
        push('Content reset, but the live preview could not refresh. Reload to see it.', 'error');
      }
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const patchDraft = (setter, key, value) => setter((current) => {
    const nextErrors = { ...(current?.errors ?? {}) };
    delete nextErrors[key];
    return { ...current, [key]: value, errors: nextErrors };
  });

  const saveBadge = () => {
    const draft = badgeForm ?? {};
    if (!String(draft.title ?? '').trim()) {
      flushSync(() => setBadgeForm((current) => ({ ...current, errors: { title: 'Give the badge a short title.' } })));
      focusFirstInvalid('[role="dialog"]');
      return;
    }
    const item = { title: draft.title.trim(), copy: String(draft.copy ?? '').trim() };
    const items = [...(form.trust_badges ?? [])];
    if (draft.index >= 0) items[draft.index] = item;
    else items.push(item);
    set('trust_badges', items);
    setBadgeForm(null);
  };

  const saveTestimonial = () => {
    const draft = testimonialForm ?? {};
    const found = {};
    if (!String(draft.name ?? '').trim()) found.name = 'Add the customer name.';
    if (!String(draft.quote ?? '').trim()) found.quote = 'Add the quote shown on the homepage.';
    if (Object.keys(found).length) {
      flushSync(() => setTestimonialForm((current) => ({ ...current, errors: found })));
      focusFirstInvalid('[role="dialog"]');
      return;
    }
    const item = {
      name: draft.name.trim(),
      city: String(draft.city ?? '').trim(),
      trip: String(draft.trip ?? '').trim(),
      quote: draft.quote.trim(),
      rating: Math.min(5, Math.max(1, Number(draft.rating) || 5)),
    };
    const items = [...(form.testimonials ?? [])];
    if (draft.index >= 0) items[draft.index] = item;
    else items.push(item);
    set('testimonials', items);
    setTestimonialForm(null);
  };

  const saveFaq = () => {
    const draft = faqForm ?? {};
    const found = {};
    if (!String(draft.question ?? '').trim()) found.question = 'Add the question.';
    if (!String(draft.answer ?? '').trim()) found.answer = 'Add the answer.';
    if (Object.keys(found).length) {
      flushSync(() => setFaqForm((current) => ({ ...current, errors: found })));
      focusFirstInvalid('[role="dialog"]');
      return;
    }
    const item = { question: draft.question.trim(), answer: draft.answer.trim() };
    const items = [...(form.faqs ?? [])];
    if (draft.index >= 0) items[draft.index] = item;
    else items.push(item);
    set('faqs', items);
    setFaqForm(null);
  };

  const removeItem = () => {
    if (!deleteTarget) return;
    const { kind, index } = deleteTarget;
    set(kind, (form[kind] ?? []).filter((_, position) => position !== index));
    setDeleteTarget(null);
  };

  const openList = (kind, index = -1, values = {}) => {
    const schema = CONTENT_LIST_SCHEMAS[kind];
    if (!schema) return;
    const base = {};
    schema.fields.forEach((field) => { base[field.key] = ''; });
    setListForm({ kind, index, values: { ...base, ...values } });
  };

  const saveList = () => {
    if (!listForm) return;
    const schema = CONTENT_LIST_SCHEMAS[listForm.kind];
    const found = {};
    const item = {};
    for (const field of schema.fields) {
      const value = String(listForm.values?.[field.key] ?? '').trim();
      if (!value && !field.optional) found[field.key] = `${field.label} is required.`;
      item[field.key] = value;
    }
    if (Object.keys(found).length) {
      flushSync(() => setListForm((current) => ({ ...current, errors: found })));
      focusFirstInvalid('[role="dialog"]');
      return;
    }
    const items = [...(form[listForm.kind] ?? [])];
    if (listForm.index >= 0) items[listForm.index] = item;
    else items.push(item);
    set(listForm.kind, items);
    setListForm(null);
  };

  if (loading) return <div className="h-96 animate-pulse rounded-2xl bg-stone-200/70" />;
  if (loadError || !form) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
        <p className="text-sm font-extrabold text-rose-900">Content could not load</p>
        <p className="mt-1 text-[0.7rem] leading-5 text-rose-800/80">{loadError || 'The content settings could not be read.'}</p>
        <button type="button" onClick={load} className="btn btn-white btn-sm mt-3">Try again</button>
      </div>
    );
  }

  const policy = sitePolicy(form);
  const errorCount = Object.keys(errors).length;
  const listLabels = {
    trust_badges: 'trust badge',
    testimonials: 'testimonial',
    faqs: 'FAQ',
    ...Object.fromEntries(Object.entries(CONTENT_LIST_SCHEMAS).map(([key, schema]) => [key, schema.label])),
  };
  const deleteItem = deleteTarget ? (form[deleteTarget.kind] ?? [])[deleteTarget.index] : null;
  const deleteName = deleteItem ? listItemView(deleteTarget.kind, deleteItem).title || '' : '';
  const copyTotal = PAGE_TEXT_KEYS.length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Content</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Content & policies</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Customer copy, contact details, policies and social proof. Every change is published to the storefront after saving.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkToSite />
          <button type="button" onClick={() => setResetOpen(true)} disabled={saving} className="btn btn-outline btn-sm">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || !isAdmin}
            className="btn btn-dark btn-sm"
          >
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'All changes saved'}
          </button>
        </div>
      </header>

      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[0.7rem] ${
        dirty ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}>
        <span className="inline-flex items-center gap-2 font-semibold">
          {dirty ? <Pencil className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {dirty
            ? `${dirtyCount || 'Some'} unsaved ${dirtyCount === 1 ? 'change' : 'changes'} — publish when you are ready.`
            : 'Everything here is live on the customer site.'}
        </span>
        {errorCount > 0 && <span className="font-bold text-rose-700">{errorCount} field{errorCount === 1 ? ' needs' : 's need'} attention</span>}
      </div>

      <nav aria-label="Content sections" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[
          ['content-hero', 'Hero'],
          ['content-toggles', 'Toggles'],
          ['content-policies', 'Policies'],
          ['content-contact', 'Contact'],
          ['content-page-copy', 'Page copy'],
          ['content-links', 'Links'],
          ['content-lists', 'Lists'],
          ['content-badges', 'Social proof'],
          ['content-faqs', 'FAQs'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-[0.66rem] font-bold text-muted transition hover:border-ink hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <form id="content-form" onSubmit={save} noValidate className="space-y-4 pb-24 lg:pb-0">
        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-4">
            <section id="content-hero" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><Sparkles className="h-4 w-4 text-forest" /> Hero</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">The first screen on the homepage, including imagery and social proof.</p>
              <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
                <Field label="Eyebrow" value={form.hero_eyebrow} onChange={(v) => set('hero_eyebrow', v)} error={errors.hero_eyebrow} hint="Small line above the headline." onReset={resetField('hero_eyebrow')} />
                <Field label="Badge" value={form.hero_badge} onChange={(v) => set('hero_badge', v)} error={errors.hero_badge} hint="Optional pill beside the eyebrow." onReset={resetField('hero_badge')} />
                <div className="sm:col-span-2">
                  <Field label="Headline" value={form.hero_title} onChange={(v) => set('hero_title', v)} error={errors.hero_title} onReset={resetField('hero_title')} />
                </div>
                <div className="sm:col-span-2">
                  <Field label="Subtitle" value={form.hero_subtitle} onChange={(v) => set('hero_subtitle', v)} error={errors.hero_subtitle} multiline rows={3} onReset={resetField('hero_subtitle')} />
                </div>
                <Field label="Primary button" value={form.hero_cta_label} onChange={(v) => set('hero_cta_label', v)} error={errors.hero_cta_label} onReset={resetField('hero_cta_label')} />
                <div className="sm:col-span-2">
                  <div className="grid gap-3 sm:grid-cols-[14rem_1fr] sm:items-start">
                    <div className="overflow-hidden rounded-2xl border border-line bg-paper">
                      {form.hero_image_url ? (
                        <img src={form.hero_image_url} alt="" className="aspect-[16/10] w-full object-cover" />
                      ) : (
                        <div className="flex aspect-[16/10] flex-col items-center justify-center gap-1 text-muted">
                          <ImagePlus className="h-6 w-6 text-forest" />
                          <p className="text-[0.65rem] font-semibold">No image selected</p>
                        </div>
                      )}
                    </div>
                    <div>
                      <Field
                        label="Image URL"
                        value={form.hero_image_url}
                        onChange={(v) => { setHeroUploadError(''); set('hero_image_url', v); }}
                        error={errors.hero_image_url}
                        hint={`Upload a JPG, PNG or WebP (max ${isDemo ? '1 MB' : '5 MB'}), or paste a wide image URL.`}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label htmlFor="content-hero-upload" className={`btn btn-white btn-sm cursor-pointer ${heroUploading ? 'pointer-events-none opacity-60' : ''}`}>
                          <Upload className="h-3.5 w-3.5" /> {heroUploading ? 'Uploading…' : 'Upload image'}
                          <input
                            id="content-hero-upload"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            disabled={heroUploading}
                            onChange={uploadHero}
                          />
                        </label>
                        {form.hero_image_url !== SITE_DEFAULTS.hero_image_url && (
                          <button type="button" onClick={() => { setHeroUploadError(''); set('hero_image_url', SITE_DEFAULTS.hero_image_url); }} className="btn btn-ghost btn-sm">
                            <RotateCcw className="h-3.5 w-3.5" /> Use default
                          </button>
                        )}
                      </div>
                      {heroUploadError && <p role="alert" className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{heroUploadError}</p>}
                    </div>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Image alt text" value={form.hero_image_alt} onChange={(v) => set('hero_image_alt', v)} error={errors.hero_image_alt} hint="Describe the image for screen readers." onReset={resetField('hero_image_alt')} />
                </div>
                <Field label="Rating" value={form.hero_rating} onChange={(v) => set('hero_rating', v)} error={errors.hero_rating} type="number" step="0.1" min="0" max="5" hint="Set to 0 to hide the rating while keeping reviews on." onReset={resetField('hero_rating')} />
                <Field label="Trip count" value={form.hero_trip_count} onChange={(v) => set('hero_trip_count', v)} error={errors.hero_trip_count} placeholder="2,400+" onReset={resetField('hero_trip_count')} />
                <div className="sm:col-span-2">
                  <Field label="Trip count label" value={form.hero_trip_label} onChange={(v) => set('hero_trip_label', v)} error={errors.hero_trip_label} placeholder="verified trips this year" onReset={resetField('hero_trip_label')} />
                </div>
              </div>
            </section>

            <section id="content-toggles" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-extrabold">Feature toggles</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Turn customer surfaces on or off without touching code.</p>
              <div className="mt-4 space-y-2.5">
                <ToggleRow>
                  <Toggle checked={form.bikes_enabled} onChange={(v) => set('bikes_enabled', v)} label="Bikes & scooters" description="Show two-wheelers in search, browse, favourites and checkout." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.guest_checkout_enabled} onChange={(v) => set('guest_checkout_enabled', v)} label="Guest checkout" description="Allow bookings without an account. Signed-in customers are unaffected." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.reviews_enabled} onChange={(v) => set('reviews_enabled', v)} label="Customer reviews" description="Display reviews and let completed trips leave a new one." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.compare_enabled} onChange={(v) => set('compare_enabled', v)} label="Vehicle comparison" description="Show the compare buttons, shortlist tray and side-by-side page." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.remember_trip_enabled} onChange={(v) => set('remember_trip_enabled', v)} label="Remember my trip" description="Prefill search with the last trip and offer a resume strip in Browse." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.change_request_enabled} onChange={(v) => set('change_request_enabled', v)} label="Self-serve trip changes" description="Let customers request date/hub changes on upcoming trips; staff approve or decline." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.extensions_enabled} onChange={(v) => set('extensions_enabled', v)} label="Self-serve trip extensions" description="Let customers extend an active trip’s return (hours or days) from their account, instantly when the vehicle is free." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.analytics_enabled} onChange={(v) => set('analytics_enabled', v)} label="Dashboard analytics" description="Show the charts, trends and KPI band on the admin dashboard." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.alerts_enabled} onChange={(v) => set('alerts_enabled', v)} label="Availability alerts" description="Let signed-in customers save “notify me when it’s free” watchlists on vehicles." />
                </ToggleRow>
              </div>
            </section>

            <section id="content-dashboard" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-extrabold">Dashboard layout</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Hide or show each admin dashboard section — for this installation, not per-user.</p>
              <div className="mt-4 space-y-2.5">
                <ToggleRow>
                  <Toggle checked={form.dashboard_show_desk} onChange={(v) => set('dashboard_show_desk', v)} label="Today's pick-ups &amp; returns" description="The hourly desk summary on the dashboard." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.dashboard_show_finance} onChange={(v) => set('dashboard_show_finance', v)} label="Revenue, last 6 months" description="The monthly recognised-revenue chart." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.dashboard_show_pipeline} onChange={(v) => set('dashboard_show_pipeline', v)} label="Booking pipeline" description="All bookings by status with proportional bars." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.dashboard_show_recent} onChange={(v) => set('dashboard_show_recent', v)} label="Recent bookings &amp; events" description="The newest bookings and the live activity feed." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.dashboard_show_fleet} onChange={(v) => set('dashboard_show_fleet', v)} label="Top vehicles &amp; utilisation" description="Ranked vehicles, fleet utilisation and the compact ops strip." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.dashboard_show_sales} onChange={(v) => set('dashboard_show_sales', v)} label="Checkout recovery" description="Customers who opened payment but didn't complete — follow up to recover the sale." />
                </ToggleRow>
              </div>
            </section>

            <section id="content-home-sections" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-extrabold">Homepage sections</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Show or hide each part of the customer homepage — the copy underneath is untouched.</p>
              <div className="mt-4 space-y-2.5">
                <ToggleRow>
                  <Toggle checked={form.home_show_hero} onChange={(v) => set('home_show_hero', v)} label="Hero, search &amp; trust band" description="The opening headline, booking search and the reassurance strip." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.home_show_catalog} onChange={(v) => set('home_show_catalog', v)} label="Cars, bikes &amp; featured" description="The fleet browsing grid, category cards and featured vehicles." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.home_show_upcoming_trip} onChange={(v) => set('home_show_upcoming_trip', v)} label="Next-trip card" description="For signed-in customers: their active rental or soonest pick-up, with a live countdown and quick links to manage it." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.card_show_all_in_rate} onChange={(v) => set('card_show_all_in_rate', v)} label="All-in day rate on cards" description="Show a typical fully-loaded daily price (standard protection + tax) on every vehicle card." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.home_show_how} onChange={(v) => set('home_show_how', v)} label="How it works &amp; why Rove" description="The four steps and the reason-to-choose-us list." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.home_show_locations} onChange={(v) => set('home_show_locations', v)} label="Locations map" description="The hub network map." />
                </ToggleRow>
                <ToggleRow>
                  <Toggle checked={form.home_show_social} onChange={(v) => set('home_show_social', v)} label="Reviews, FAQ &amp; CTA" description="Testimonials, the question accordion and the closing call-to-action." />
                </ToggleRow>
              </div>
            </section>

            <section id="content-policies" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-extrabold">Booking policies</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Used by the quote engine, cancellation logic, vehicle pages and checkout.</p>
              <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Cancellation window (hours)" value={form.cancellation_window_hours} onChange={(v) => set('cancellation_window_hours', v)} error={errors.cancellation_window_hours} type="number" min="0" max="720" />
                <Field label="Inside-window refund (%)" value={form.cancellation_refund_percent} onChange={(v) => set('cancellation_refund_percent', v)} error={errors.cancellation_refund_percent} type="number" min="0" max="100" />
                <Field label="Late fee per hour (₹)" value={form.late_fee_per_hour} onChange={(v) => set('late_fee_per_hour', v)} error={errors.late_fee_per_hour} type="number" min="0" />
                <Field label="Late-return grace (minutes)" value={form.late_grace_minutes} onChange={(v) => set('late_grace_minutes', v)} error={errors.late_grace_minutes} type="number" min="0" max="1440" hint="Free window after the scheduled drop-off before the hourly late fee starts." />
                <Field label="Repeat-late threshold (returns)" value={form.late_repeat_threshold} onChange={(v) => set('late_repeat_threshold', v)} error={errors.late_repeat_threshold} type="number" min="2" max="20" hint="Late drop-offs in the last 90 days that flag a vehicle as a repeat offender on the returns desk." />
                <Field label="Minimum rental days" value={form.min_rental_days} onChange={(v) => set('min_rental_days', v)} error={errors.min_rental_days} type="number" min="1" max="30" />
                <Field label="Maximum rental days" value={form.max_rental_days} onChange={(v) => set('max_rental_days', v)} error={errors.max_rental_days} type="number" min="1" max="365" />
                <Field label="Book ahead (days)" value={form.max_advance_days} onChange={(v) => set('max_advance_days', v)} error={errors.max_advance_days} type="number" min="1" max="730" />
                <Field label="Minimum car age" value={form.min_age} onChange={(v) => set('min_age', v)} error={errors.min_age} type="number" min="16" max="90" />
                <Field label="Minimum bike age" value={form.min_bike_rider_age} onChange={(v) => set('min_bike_rider_age', v)} error={errors.min_bike_rider_age} type="number" min="16" max="90" />
                <Field label="Car refuelling fee (₹)" value={form.fuel_refill_fee} onChange={(v) => set('fuel_refill_fee', v)} error={errors.fuel_refill_fee} type="number" min="0" />
                <Field label="Bike refuelling fee (₹)" value={form.bike_fuel_refill_fee} onChange={(v) => set('bike_fuel_refill_fee', v)} error={errors.bike_fuel_refill_fee} type="number" min="0" />
              </div>
              <div className="mt-4 rounded-xl bg-paper p-3 text-[0.68rem] leading-5 text-muted">
                <p><span className="font-bold text-ink">Live summary:</span> {policy.cancellationSummary}.</p>
                <p className="mt-1">Rentals run {policy.minDays}–{policy.maxDays} days; bookings open {policy.maxAdvanceDays} days ahead. Late returns are billed per started hour at {inr(policy.lateFee)}/hour after a {policy.lateGraceMinutes}-minute grace, and the desk pre-fills that computed total at settlement (capped at {inr(policy.lateFeePerDay)}/day). One-way and security-deposit amounts live in Settings.</p>
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section id="content-contact" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-extrabold">Contact & hours</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Used in the footer, contact page, vehicle help, emails and invoices.</p>
              <div className="mt-4 grid gap-3.5">
                <Field label="Support email" value={form.support_email} onChange={(v) => set('support_email', v)} error={errors.support_email} type="email" onReset={resetField('support_email')} />
                <Field label="Support phone" value={form.support_phone} onChange={(v) => set('support_phone', v)} error={errors.support_phone} type="tel" onReset={resetField('support_phone')} />
                <Field label="WhatsApp" value={form.whatsapp_number} onChange={(v) => set('whatsapp_number', v)} error={errors.whatsapp_number} type="tel" hint="Leave blank to hide WhatsApp links." onReset={resetField('whatsapp_number')} />
                <Field label="Support hours" value={form.support_hours} onChange={(v) => set('support_hours', v)} error={errors.support_hours} onReset={resetField('support_hours')} />
              </div>
            </section>

            <section id="content-brand" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><Globe2 className="h-4 w-4 text-forest" /> Brand & footer</h2>
              <div className="mt-4 grid gap-3.5">
                <Field label="Footer tagline" value={form.footer_tagline} onChange={(v) => set('footer_tagline', v)} error={errors.footer_tagline} multiline rows={3} onReset={resetField('footer_tagline')} />
                <Field label="Legal company name" value={form.company_legal_name} onChange={(v) => set('company_legal_name', v)} error={errors.company_legal_name} onReset={resetField('company_legal_name')} />
                <Field label="GSTIN" value={form.gstin} onChange={(v) => set('gstin', v)} error={errors.gstin} onReset={resetField('gstin')} />
                <Field label="Registered address" value={form.registered_address} onChange={(v) => set('registered_address', v)} error={errors.registered_address} multiline rows={2} onReset={resetField('registered_address')} />
                <Field label="Policies updated" value={form.legal_updated} onChange={(v) => set('legal_updated', v)} error={errors.legal_updated} hint="Shown on the terms and privacy pages." onReset={resetField('legal_updated')} />
              </div>
            </section>

            <section id="content-social" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-extrabold">Social links</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Leave any field blank to hide that icon in the footer.</p>
              <div className="mt-4 grid gap-3.5">
                <Field label="Instagram" value={form.social_instagram} onChange={(v) => set('social_instagram', v)} error={errors.social_instagram} placeholder="https://instagram.com/…" onReset={resetField('social_instagram')} />
                <Field label="X / Twitter" value={form.social_twitter} onChange={(v) => set('social_twitter', v)} error={errors.social_twitter} placeholder="https://x.com/…" onReset={resetField('social_twitter')} />
                <Field label="LinkedIn" value={form.social_linkedin} onChange={(v) => set('social_linkedin', v)} error={errors.social_linkedin} placeholder="https://linkedin.com/company/…" onReset={resetField('social_linkedin')} />
              </div>
            </section>

            <div className="rounded-2xl border border-line bg-ink p-5 text-cream">
              <FileText className="h-5 w-5 text-lime" />
              <p className="mt-2 text-xs font-extrabold">One source of truth</p>
              <p className="mt-1 text-[0.62rem] leading-4 text-cream/55">Customer copy and booking rules live here. Financial defaults such as GST, deposits and one-way fees live in Settings.</p>
            </div>
          </div>
        </div>

        <section id="content-page-copy" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold"><FileText className="h-4 w-4 text-forest" /> Page copy</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted">Headings, buttons and labels across navigation, the footer and every marketing page. Leave a field as shipped to keep the default. Wrap words in *asterisks* for the italic accent, and drop in {`{deposit}`}, {`{refund}`}, {`{hubs}`}, {`{hours}`} or {`{email}`} to insert live policy values.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <label className="sr-only" htmlFor="content-copy-search">Search page copy</label>
              <input
                id="content-copy-search"
                type="search"
                value={copyQuery}
                onChange={(event) => setCopyQuery(event.target.value)}
                placeholder="Search by label, key or current copy…"
                className="field pl-9 pr-9"
              />
              {copyQuery && (
                <button type="button" onClick={() => setCopyQuery('')} aria-label="Clear page copy search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-paper hover:text-ink">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="text-[0.62rem] font-semibold text-muted">
              {copyQuery ? `${copyMatchCount} of ${copyTotal}` : copyTotal} strings
            </span>
          </div>
          <div className="mt-4 space-y-6">
            {copyMatches.length === 0 && (
              <p className="rounded-xl border border-dashed border-line bg-paper px-4 py-6 text-center text-[0.7rem] text-muted">
                No strings match “{copyQuery}”. Try a shorter word or clear the search.
              </p>
            )}
            {copyMatches.map((group) => (
              <div key={group.id}>
                <h3 className="text-[0.78rem] font-extrabold tracking-tight text-ink">{group.title}</h3>
                <p className="mt-0.5 text-[0.62rem] text-muted">{group.description}</p>
                <div className="mt-3 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.keys.map((key) => (
                    <Field
                      key={key}
                      id={key}
                      label={prettyLabel(key)}
                      value={form[key]}
                      onChange={(value) => set(key, value)}
                      error={errors[key]}
                      multiline={MULTILINE_KEY.test(key)}
                      rows={3}
                      onReset={resetCopy(key)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="content-links" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold"><ExternalLink className="h-4 w-4 text-forest" /> Navigation & footer links</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted">Links shown in the header, mobile menu and footer columns, in the order listed here.</p>
          <div className="mt-4 space-y-5">
            {[
              { kind: 'nav_links', title: 'Navigation links' },
              { kind: 'footer_fleet_links', title: 'Footer — fleet column' },
              { kind: 'footer_company_links', title: 'Footer — company column' },
              { kind: 'footer_support_links', title: 'Footer — support column' },
              { kind: 'footer_legal_links', title: 'Footer — legal column' },
            ].map((section) => (
              <ListBlock
                key={section.kind}
                kind={section.kind}
                title={section.title}
                items={form[section.kind] ?? []}
                error={errors[section.kind]}
                onAdd={() => openList(section.kind)}
                onEdit={(index) => openList(section.kind, index, (form[section.kind] ?? [])[index])}
                onDelete={(index) => setDeleteTarget({ kind: section.kind, index })}
              />
            ))}
          </div>
        </section>

        <section id="content-lists" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold"><Sparkles className="h-4 w-4 text-forest" /> Homepage lists</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted">Steps, reasons and category tiles used across the homepage.</p>
          <div className="mt-4 space-y-5">
            {[
              { kind: 'home_steps', title: 'How it works steps' },
              { kind: 'home_why_points', title: 'Why Rove reasons' },
              { kind: 'home_categories', title: 'Category tiles' },
            ].map((section) => (
              <ListBlock
                key={section.kind}
                kind={section.kind}
                title={section.title}
                items={form[section.kind] ?? []}
                error={errors[section.kind]}
                onAdd={() => openList(section.kind)}
                onEdit={(index) => openList(section.kind, index, (form[section.kind] ?? [])[index])}
                onDelete={(index) => setDeleteTarget({ kind: section.kind, index })}
              />
            ))}
          </div>
        </section>

        <section id="content-values" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold"><Quote className="h-4 w-4 text-forest" /> About values</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted">The promises listed on the About page.</p>
          <div className="mt-4">
            <ListBlock
              kind="about_values"
              title="Our values"
              items={form.about_values ?? []}
              error={errors.about_values}
              onAdd={() => openList('about_values')}
              onEdit={(index) => openList('about_values', index, (form.about_values ?? [])[index])}
              onDelete={(index) => setDeleteTarget({ kind: 'about_values', index })}
            />
          </div>
        </section>

        <section id="content-routes" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold"><MapPin className="h-4 w-4 text-forest" /> Trip ideas</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted">Curated routes shown on the /routes page. The “from / to” hubs should match the pick-up hub names in Locations.</p>
          <div className="mt-4">
            <ListBlock
              kind="routes"
              title="Route cards"
              items={form.routes ?? []}
              error={errors.routes}
              onAdd={() => openList('routes')}
              onEdit={(index) => openList('routes', index, (form.routes ?? [])[index])}
              onDelete={(index) => setDeleteTarget({ kind: 'routes', index })}
            />
          </div>
        </section>

        <section id="content-badges" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><BadgeCheck className="h-4 w-4 text-forest" /> Trust badges</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Four short reassurances shown below the homepage hero.</p>
            </div>
            <button type="button" onClick={() => setBadgeForm({ title: '', copy: '', index: -1 })} disabled={(form.trust_badges ?? []).length >= 4} className="btn btn-white btn-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add badge</button>
          </div>
          {errors.trust_badges && <p className="mt-2 text-[0.72rem] font-semibold text-rose-700">{errors.trust_badges}</p>}
          {form.trust_badges.length ? (
            <div className="mt-4 grid gap-2.5 md:grid-cols-2">
              {form.trust_badges.map((badge, index) => (
                <div key={`${badge.title}-${index}`} className="flex items-start gap-3 rounded-xl border border-line bg-paper/50 px-3.5 py-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.74rem] font-extrabold text-ink">{badge.title}</p>
                    <p className="mt-0.5 text-[0.65rem] leading-5 text-muted">{badge.copy || 'No supporting copy yet.'}</p>
                  </div>
                  <ListActions
                    onEdit={() => setBadgeForm({ ...badge, index })}
                    onDelete={() => setDeleteTarget({ kind: 'trust_badges', index })}
                    label="badge"
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={BadgeCheck} title="No badges yet" description="Add a few short reassurances for the homepage." className="mt-4 py-8" action={<button type="button" onClick={() => setBadgeForm({ title: '', copy: '', index: -1 })} className="btn btn-dark btn-sm">Add badge</button>} />
          )}
        </section>

        <section id="content-testimonials" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><Quote className="h-4 w-4 text-forest" /> Testimonials</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Customer quotes featured on the homepage. Hidden when reviews are off.</p>
            </div>
            <button type="button" onClick={() => setTestimonialForm({ name: '', city: '', trip: '', quote: '', rating: 5, index: -1 })} disabled={(form.testimonials ?? []).length >= 12} className="btn btn-white btn-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add testimonial</button>
          </div>
          {errors.testimonials && <p className="mt-2 text-[0.72rem] font-semibold text-rose-700">{errors.testimonials}</p>}
          {form.testimonials.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {form.testimonials.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex flex-col rounded-2xl border border-line bg-paper/60 p-4">
                  <div className="flex items-center gap-0.5" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`h-3 w-3 ${star <= Number(item.rating) ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-stone-300'}`} />
                    ))}
                  </div>
                  <p className="mt-2 flex-1 text-[0.72rem] leading-5 text-muted">“{item.quote}”</p>
                  <div className="mt-3 flex items-end justify-between gap-2 border-t border-line pt-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.72rem] font-extrabold">{item.name}</p>
                      <p className="truncate text-[0.6rem] text-muted">{[item.trip, item.city].filter(Boolean).join(' · ') || 'Verified customer'}</p>
                    </div>
                    <ListActions
                      onEdit={() => setTestimonialForm({ ...item, index })}
                      onDelete={() => setDeleteTarget({ kind: 'testimonials', index })}
                      label="testimonial"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Quote} title="No testimonials yet" description="Add a quote from a happy customer to build trust." className="mt-4 py-8" action={<button type="button" onClick={() => setTestimonialForm({ name: '', city: '', trip: '', quote: '', rating: 5, index: -1 })} className="btn btn-dark btn-sm">Add testimonial</button>} />
          )}
        </section>

        <section id="content-faqs" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><HelpCircle className="h-4 w-4 text-forest" /> FAQs</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Answers shown on the homepage help section. Policies above are not automatically rewritten into existing answers.</p>
            </div>
            <button type="button" onClick={() => setFaqForm({ question: '', answer: '', index: -1 })} disabled={(form.faqs ?? []).length >= 20} className="btn btn-white btn-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add FAQ</button>
          </div>
          {errors.faqs && <p className="mt-2 text-[0.72rem] font-semibold text-rose-700">{errors.faqs}</p>}
          {form.faqs.length ? (
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
              {form.faqs.map((item, index) => (
                <li key={`${item.question}-${index}`} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.74rem] font-bold text-ink">{item.question}</p>
                    <p className="mt-1 line-clamp-2 text-[0.66rem] leading-5 text-muted">{item.answer}</p>
                  </div>
                  <ListActions
                    onEdit={() => setFaqForm({ ...item, index })}
                    onDelete={() => setDeleteTarget({ kind: 'faqs', index })}
                    label="FAQ"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={HelpCircle} title="No FAQs yet" description="Answer the questions customers ask most." className="mt-4 py-8" action={<button type="button" onClick={() => setFaqForm({ question: '', answer: '', index: -1 })} className="btn btn-dark btn-sm">Add FAQ</button>} />
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
          <p className="text-[0.68rem] text-muted">
            {dirty ? 'You have unpublished changes.' : 'No unpublished changes.'} Financial defaults live in Settings.
          </p>
          <div className="flex flex-wrap gap-2">
            {dirty && (
              <button type="button" onClick={() => setDiscardOpen(true)} disabled={saving} className="btn btn-ghost btn-sm">Discard</button>
            )}
            <button type="button" onClick={() => setResetOpen(true)} disabled={saving} className="btn btn-white btn-sm"><RotateCcw className="h-3.5 w-3.5" /> Reset defaults</button>
            <button type="submit" disabled={saving || !dirty || !isAdmin} className="btn btn-dark btn-sm">{saving ? 'Saving…' : isAdmin ? 'Save & publish' : 'Super admin required'}</button>
          </div>
        </div>

        {dirty && isAdmin && (
          <div
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto flex max-w-5xl items-center gap-3">
              <p className="min-w-0 flex-1 text-[0.66rem] font-semibold text-amber-900">
                {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
              </p>
              <button type="submit" disabled={saving} className="btn btn-dark btn-sm">{saving ? 'Saving…' : 'Publish'}</button>
            </div>
          </div>
        )}
      </form>

      <Modal
        open={Boolean(badgeForm)}
        onClose={() => setBadgeForm(null)}
        title={badgeForm?.index >= 0 ? 'Edit trust badge' : 'Add trust badge'}
        description="A short title and one supporting line."
        size="sm"
        footer={<ModalActions onCancel={() => setBadgeForm(null)} onSave={saveBadge} saveLabel={badgeForm?.index >= 0 ? 'Save badge' : 'Add badge'} />}
      >
        {badgeForm && (
          <div className="space-y-3">
            <Field id="badge-title" label="Title" value={badgeForm.title} onChange={(v) => patchDraft(setBadgeForm, 'title', v)} error={badgeForm.errors?.title} placeholder="Free cancellation" />
            <Field id="badge-copy" label="Supporting copy" value={badgeForm.copy} onChange={(v) => patchDraft(setBadgeForm, 'copy', v)} error={badgeForm.errors?.copy} placeholder="Full refund before the cancellation window" />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(testimonialForm)}
        onClose={() => setTestimonialForm(null)}
        title={testimonialForm?.index >= 0 ? 'Edit testimonial' : 'Add testimonial'}
        description="Name, vehicle, city and the quote shown on the homepage."
        size="sm"
        footer={<ModalActions onCancel={() => setTestimonialForm(null)} onSave={saveTestimonial} saveLabel={testimonialForm?.index >= 0 ? 'Save testimonial' : 'Add testimonial'} />}
      >
        {testimonialForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="testimonial-name" label="Customer name" value={testimonialForm.name} onChange={(v) => patchDraft(setTestimonialForm, 'name', v)} error={testimonialForm.errors?.name} placeholder="Maya Chen" />
            <Field id="testimonial-city" label="City" value={testimonialForm.city} onChange={(v) => patchDraft(setTestimonialForm, 'city', v)} placeholder="Mumbai" />
            <div className="sm:col-span-2"><Field id="testimonial-trip" label="Vehicle (optional)" value={testimonialForm.trip} onChange={(v) => patchDraft(setTestimonialForm, 'trip', v)} placeholder="Range Rover Velar" /></div>
            <div className="sm:col-span-2"><Field id="testimonial-quote" label="Quote" value={testimonialForm.quote} onChange={(v) => patchDraft(setTestimonialForm, 'quote', v)} error={testimonialForm.errors?.quote} multiline rows={3} /></div>
            <div>
              <label className="label" htmlFor="testimonial-rating">Rating</label>
              <select id="testimonial-rating" value={testimonialForm.rating} onChange={(event) => setTestimonialForm((c) => ({ ...c, rating: Number(event.target.value) }))} className="field">
                {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} star{value === 1 ? '' : 's'}</option>)}
              </select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(faqForm)}
        onClose={() => setFaqForm(null)}
        title={faqForm?.index >= 0 ? 'Edit FAQ' : 'Add FAQ'}
        description="The question and answer shown in the homepage help section."
        size="sm"
        footer={<ModalActions onCancel={() => setFaqForm(null)} onSave={saveFaq} saveLabel={faqForm?.index >= 0 ? 'Save FAQ' : 'Add FAQ'} />}
      >
        {faqForm && (
          <div className="space-y-3">
            <Field id="faq-question" label="Question" value={faqForm.question} onChange={(v) => patchDraft(setFaqForm, 'question', v)} error={faqForm.errors?.question} placeholder="Is fuel included?" />
            <Field id="faq-answer" label="Answer" value={faqForm.answer} onChange={(v) => patchDraft(setFaqForm, 'answer', v)} error={faqForm.errors?.answer} multiline rows={4} />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(listForm)}
        onClose={() => setListForm(null)}
        title={listForm
          ? `${listForm.index >= 0 ? 'Edit' : 'Add'} ${CONTENT_LIST_SCHEMAS[listForm.kind].label}`
          : 'Edit item'}
        size="sm"
        footer={<ModalActions onCancel={() => setListForm(null)} onSave={saveList} saveLabel={listForm?.index >= 0 ? 'Save' : 'Add'} />}
      >
        {listForm && (
          <div className="space-y-3">
            {CONTENT_LIST_SCHEMAS[listForm.kind].fields.map((field) => (
              <Field
                key={field.key}
                id={`${listForm.kind}-${field.key}`}
                label={field.label}
                value={listForm.values?.[field.key]}
                onChange={(value) => setListForm((current) => {
                  const nextErrors = { ...(current.errors ?? {}) };
                  delete nextErrors[field.key];
                  return { ...current, values: { ...current.values, [field.key]: value }, errors: nextErrors };
                })}
                multiline={field.multiline}
                rows={3}
                hint={field.optional ? 'Optional' : undefined}
                error={listForm.errors?.[field.key]}
              />
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={deleteName ? `Remove “${deleteName}”?` : `Remove this ${deleteTarget ? listLabels[deleteTarget.kind] : 'item'}?`}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={removeItem} className="btn btn-dark flex-1">Remove</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">
          {deleteName ? `“${deleteName}”` : 'This item'} disappears from the customer site when you save and publish.
        </p>
      </Modal>

      <Modal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard unsaved changes?"
        description="Your edits since the last publish will be lost. Nothing on the customer site changes."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDiscardOpen(false)} className="btn btn-white flex-1">Keep editing</button>
            <button type="button" onClick={discardChanges} className="btn btn-dark flex-1">Discard</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">This only affects your browser session — the live site keeps the last published copy.</p>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset content to defaults?"
        description="Hero, footer, contact details, toggles, policies, badges, testimonials and FAQs return to the shipped values."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setResetOpen(false)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={resetToDefaults} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Resetting…' : 'Reset & publish'}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">This overwrites current content immediately. Financial settings, add-ons and rate rules are not changed.</p>
      </Modal>
    </div>
  );
}

function LinkToSite() {
  return (
    <a href="/" target="_blank" rel="noreferrer" className="btn btn-white btn-sm">
      <ExternalLink className="h-3.5 w-3.5" /> View site
    </a>
  );
}

function ToggleRow({ children }) {
  return <div className="rounded-xl border border-line bg-paper p-3">{children}</div>;
}

function ListBlock({ kind, title, items = [], error, onAdd, onEdit, onDelete }) {
  const schema = CONTENT_LIST_SCHEMAS[kind];
  if (!schema) return null;
  return (
    <div className="rounded-xl border border-line bg-paper/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[0.74rem] font-extrabold text-ink">{title}</p>
          <p className="mt-0.5 text-[0.6rem] text-muted">
            {items.length} {schema.label}{items.length === 1 ? '' : 's'} · shown in this order
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={items.length >= 12}
          className="btn btn-white btn-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add {schema.label}
        </button>
      </div>
      {error && <p className="mt-2 text-[0.7rem] font-semibold text-rose-700">{error}</p>}
      {items.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item, index) => {
            const view = listItemView(kind, item);
            return (
              <li key={`${view.title}-${index}`} className="flex items-start gap-3 rounded-lg border border-line bg-white px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.72rem] font-bold text-ink">{view.title || '—'}</p>
                  {view.subtitle ? <p className="mt-0.5 truncate text-[0.62rem] text-muted">{view.subtitle}</p> : null}
                </div>
                <ListActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} label={schema.label} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[0.68rem] text-muted">Nothing here yet.</p>
      )}
    </div>
  );
}

function ListActions({ onEdit, onDelete, label }) {
  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" onClick={onEdit} className="rounded-lg p-1.5 text-muted hover:bg-white hover:text-ink" aria-label={`Edit ${label}`}><Pencil className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={onDelete} className="rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${label}`}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function ModalActions({ onCancel, onSave, saveLabel }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onCancel} className="btn btn-white flex-1">Cancel</button>
      <button type="button" onClick={onSave} className="btn btn-dark flex-1">{saveLabel}</button>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', step, min, max, hint, error, id: idProp,
  multiline = false, rows = 3, placeholder = '', onReset,
}) {
  const id = `content-${idProp || label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`field resize-none ${error ? 'border-rose-400' : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
      ) : (
        <input
          id={id}
          type={type}
          step={step}
          min={min}
          max={max}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`field ${error ? 'border-rose-400' : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[0.68rem] font-semibold text-rose-700">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[0.62rem] text-muted">{hint}</p>
      ) : null}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          aria-label={`Reset ${label} to default`}
          className="mt-1 inline-flex items-center gap-1 text-[0.6rem] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          <RotateCcw className="h-3 w-3" /> Reset to default
        </button>
      )}
    </div>
  );
}
