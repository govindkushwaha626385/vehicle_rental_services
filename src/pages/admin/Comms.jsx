import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Inbox, Mail, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { getSiteContent } from '../../lib/site.js';
import {
  TEMPLATE_PLACEHOLDERS,
  renderTemplate,
  unknownPlaceholders,
} from '../../lib/emailTemplates.js';
import { todayISO } from '../../lib/pricing.js';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges.js';
import EmailOutbox from '../../components/admin/EmailOutbox.jsx';
import { cn, longDate } from '../../lib/format.js';

const SAMPLE = {
  site: 'Rove',
  code: 'RV-DEMO1',
  name: 'Maya Chen',
  dates: '5 Nov 2026 – 8 Nov 2026',
  amount: '₹5,000',
  hub: 'Bengaluru — Indiranagar',
  time: '10:00',
  reason: 'Here is the reason.',
  status: 'confirmed',
  delta: '₹1,200',
  refund: '₹4,000',
  charges: '₹1,000',
  vehicle: 'Toyota Fortuner',
  km: 'Kilometres: 250 km/day included · ₹6/extra km.',
  late: 'Late returns are billed at ₹500/hour, after a 60-minute grace, capped at ₹12,000/day.',
};

/** Rows carry their last-saved text so dirtiness needs no extra bookkeeping. */
const hydrate = (rows) => rows.map((row) => ({
  ...row,
  savedSubject: row.subject,
  savedBody: row.body,
}));

const isDirty = (row) => row.subject !== row.savedSubject || row.body !== row.savedBody;
const isCustom = (row) => row.subject !== row.fallbackSubject || row.body !== row.fallbackBody;

export default function Comms() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta?.settings), [meta?.settings]);
  const [tab, setTab] = useState('templates');
  const [pendingAnchor, setPendingAnchor] = useState('');
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingKind, setSavingKind] = useState('');
  const requestGuard = useRequestGuard();

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await api.adminEmailTemplates();
      if (!requestGuard.isCurrent(guard)) return;
      setTemplates(hydrate(rows));
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

  const dirtyRows = useMemo(() => templates.filter(isDirty), [templates]);
  const customCount = useMemo(() => templates.filter(isCustom).length, [templates]);
  useUnsavedChanges(dirtyRows.length > 0);

  // "Edit template" in the outbox switches tabs, then scrolls once the editor
  // for that kind is actually on screen (templates may still be loading).
  useEffect(() => {
    if (tab !== 'templates' || !pendingAnchor) return;
    const node = document.getElementById(`tpl-${pendingAnchor}`);
    if (!node) return;
    // Focus first: focusing an element can cancel an in-flight smooth scroll.
    // `instant` (rather than smooth) keeps the jump reliable even when the
    // browser pauses scroll animations for a background tab.
    node.focus({ preventScroll: true });
    node.scrollIntoView({ behavior: 'instant', block: 'start' });
    setPendingAnchor('');
  }, [tab, pendingAnchor, templates]);

  const openTemplate = (kind) => {
    setTab('templates');
    setPendingAnchor(kind);
  };

  const set = (kind, field, value) => {
    setTemplates((current) => current.map((row) => (row.kind === kind ? { ...row, [field]: value } : row)));
  };

  const save = async (row) => {
    if (!row.subject.trim() || !row.body.trim()) {
      push(content.comms_template_error, 'error');
      return;
    }
    setSavingKind(row.kind);
    try {
      const result = await api.adminSaveEmailTemplate({ kind: row.kind, subject: row.subject, body: row.body });
      // Update this row in place — never reload the page, or unsaved edits in
      // the other twelve templates would be silently thrown away.
      setTemplates((current) => current.map((item) => (
        item.kind === row.kind
          ? {
            ...item,
            subject: result.subject,
            body: result.body,
            savedSubject: result.subject,
            savedBody: result.body,
          }
          : item
      )));
      push(content.comms_template_saved, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSavingKind('');
    }
  };

  const discardAll = () => {
    setTemplates((current) => current.map((row) => ({
      ...row,
      subject: row.savedSubject,
      body: row.savedBody,
    })));
    push(content.comms_discarded, 'success');
  };

  const preview = (row) => ({
    subject: renderTemplate(row.subject, SAMPLE),
    body: renderTemplate(row.body, SAMPLE),
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Communications</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Email centre</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Every transactional email your customers receive. Edit the templates, then check the outbox to see exactly what was queued — and resend anything that got lost.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-white text-muted">{templates.length} templates</span>
          {customCount > 0 && <span className="badge bg-lime/30 text-ink">{customCount} customised</span>}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/20 bg-ok/10 px-2.5 py-1 text-[0.56rem] font-extrabold uppercase tracking-[0.12em] text-ok">
            <Sparkles className="h-3 w-3" /> Demo sends to the local queue
          </span>
        </div>
      </header>

      <div role="tablist" aria-label="Email centre sections" className="flex w-full gap-1 rounded-xl border border-line bg-white p-1 sm:w-auto sm:inline-flex">
        {[
          { key: 'templates', label: 'Templates', icon: FileText },
          { key: 'outbox', label: 'Outbox', icon: Inbox },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`comms-tab-${item.key}`}
              aria-selected={active}
              aria-controls={`comms-panel-${item.key}`}
              onClick={() => setTab(item.key)}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.7rem] font-extrabold transition sm:flex-none',
                active ? 'bg-ink text-white shadow-sm' : 'text-muted hover:bg-paper hover:text-ink'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="comms-panel-templates"
        aria-labelledby="comms-tab-templates"
        hidden={tab !== 'templates'}
        className="space-y-5"
      >
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold text-rose-900"><AlertTriangle className="h-4 w-4" /> Templates could not load</p>
          <p className="mt-1 text-[0.7rem] text-rose-800/80">{loadError}</p>
          <button type="button" onClick={load} className="btn btn-white btn-sm mt-3">Try again</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">Jump to</span>
              {templates.map((row) => (
                <a
                  key={row.kind}
                  href={`#tpl-${row.kind}`}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6rem] font-bold transition',
                    isDirty(row) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-line bg-paper text-muted hover:border-ink/40 hover:text-ink'
                  )}
                >
                  {isDirty(row) && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                  {row.label}
                </a>
              ))}
            </div>
          </div>

          {dirtyRows.length > 0 && (
            <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[0.7rem] text-amber-900">
              <span className="inline-flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                {dirtyRows.length} template{dirtyRows.length === 1 ? '' : 's'} with unsaved edits.
              </span>
              <button type="button" onClick={discardAll} className="btn btn-ghost btn-sm text-amber-900">Discard all edits</button>
            </div>
          )}

          <details className="group rounded-xl border border-line bg-white px-3.5 py-2.5 text-[0.7rem]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 font-extrabold text-ink">
              <Mail className="h-3.5 w-3.5 text-forest" /> Placeholders you can use
              <span className="ml-auto text-[0.58rem] font-bold text-muted group-open:hidden">Show</span>
              <span className="ml-auto hidden text-[0.58rem] font-bold text-muted group-open:inline">Hide</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TEMPLATE_PLACEHOLDERS.map((token) => (
                <code key={token} className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-mono text-[0.6rem] font-bold text-ink">{`{${token}}`}</code>
              ))}
            </div>
            <p className="mt-2 text-[0.62rem] leading-5 text-muted">
              Filled from the booking when the message is queued. <code className="font-mono font-bold">{'{km}'}</code> and <code className="font-mono font-bold">{'{late}'}</code> carry the kilometre allowance and late-return terms on booking confirmations; other templates render them blank.
            </p>
          </details>

          {templates.map((row) => {
            const instance = preview(row);
            const dirty = isDirty(row);
            const custom = isCustom(row);
            const unknown = unknownPlaceholders(`${row.subject}\n${row.body}`);
            const incomplete = !row.subject.trim() || !row.body.trim();
            return (
              <section key={row.kind} id={`tpl-${row.kind}`} tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-line bg-white p-5 outline-none focus-visible:ring-2 focus-visible:ring-forest/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold">{row.label}</h2>
                    <p className="mt-0.5 font-mono text-[0.62rem] text-muted">{row.kind}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {custom && <span className="rounded-full bg-lime/25 px-2.5 py-1 text-[0.58rem] font-extrabold text-ink">Custom</span>}
                    {dirty && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[0.58rem] font-extrabold text-amber-900">Unsaved</span>}
                  </div>
                </div>

                <div className="mt-3 grid gap-3.5 lg:grid-cols-2">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="label" htmlFor={`tpl-subject-${row.kind}`}>Subject</label>
                      <span className={cn('text-[0.56rem] font-semibold', row.subject.length > 120 ? 'text-amber-700' : 'text-muted')}>
                        {row.subject.length}/140
                      </span>
                    </div>
                    <input
                      id={`tpl-subject-${row.kind}`}
                      value={row.subject}
                      onChange={(event) => set(row.kind, 'subject', event.target.value)}
                      className="field"
                      maxLength={140}
                      aria-invalid={!row.subject.trim()}
                    />
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="label" htmlFor={`tpl-body-${row.kind}`}>Body</label>
                      <span className={cn('text-[0.56rem] font-semibold', row.body.length > 1800 ? 'text-amber-700' : 'text-muted')}>
                        {row.body.length}/2000
                      </span>
                    </div>
                    <textarea
                      id={`tpl-body-${row.kind}`}
                      rows={7}
                      value={row.body}
                      onChange={(event) => set(row.kind, 'body', event.target.value)}
                      className="field resize-none"
                      maxLength={2000}
                      aria-invalid={!row.body.trim()}
                      aria-describedby={unknown.length ? `tpl-warn-${row.kind}` : undefined}
                    />
                  </div>
                </div>

                {unknown.length > 0 && (
                  <p id={`tpl-warn-${row.kind}`} role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.66rem] leading-5 text-amber-900">
                    <span className="font-extrabold">Unknown placeholder{unknown.length === 1 ? '' : 's'}:</span>{' '}
                    {unknown.map((token) => `{${token}}`).join(', ')} — these will be emailed to the customer exactly as typed. Supported: {TEMPLATE_PLACEHOLDERS.map((token) => `{${token}}`).join(', ')}.
                  </p>
                )}

                {incomplete && (
                  <p className="mt-3 text-[0.66rem] font-semibold text-rose-700">A subject and a body are both required before this template can be saved.</p>
                )}

                <div className="mt-3 rounded-2xl border border-line bg-paper/70 px-3.5 py-2.5">
                  <p className="flex items-center gap-1.5 text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">
                    <Mail className="h-3 w-3" /> Preview · {longDate(todayISO())}
                  </p>
                  <p className="mt-1 text-sm font-extrabold">{instance.subject || '—'}</p>
                  <p className="mt-1 whitespace-pre-line text-[0.72rem] leading-5 text-muted">{instance.body || '—'}</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => save(row)}
                    disabled={savingKind === row.kind || !dirty || incomplete}
                    title={!dirty ? 'No changes to save' : undefined}
                    className="btn btn-dark btn-sm"
                  >
                    {savingKind === row.kind ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
                  </button>
                  <button
                    type="button"
                    onClick={() => set(row.kind, 'subject', row.fallbackSubject)}
                    disabled={savingKind === row.kind || row.subject === row.fallbackSubject}
                    className="btn btn-ghost btn-sm"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore default subject
                  </button>
                  <button
                    type="button"
                    onClick={() => set(row.kind, 'body', row.fallbackBody)}
                    disabled={savingKind === row.kind || row.body === row.fallbackBody}
                    className="btn btn-ghost btn-sm"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore default body
                  </button>
                </div>
              </section>
            );
          })}
        </>
      )}

      <div className="rounded-2xl border border-line bg-lime/10 p-4 text-[0.7rem] leading-5 text-ink">
        <p className="flex items-center gap-1.5 font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> How this works</p>
        <p className="mt-1 text-muted">Templates are stored as settings, so a customer-facing admin can edit them without code. On Supabase, the same keys are read by the notify dispatcher at send time — the demo adapter renders them as messages are queued. Placeholders in curly braces are filled from the booking; anything else is sent verbatim.</p>
      </div>
      </div>

      <div
        role="tabpanel"
        id="comms-panel-outbox"
        aria-labelledby="comms-tab-outbox"
        hidden={tab !== 'outbox'}
      >
        {tab === 'outbox' && <EmailOutbox onEditTemplate={openTemplate} />}
      </div>
    </div>
  );
}
