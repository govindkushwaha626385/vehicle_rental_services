import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, CheckCheck, Clock3, Copy, Inbox as InboxIcon, Mail, MailOpen, Phone, Reply, Send,
  Trash2,
} from 'lucide-react';
import { EmptyState, LoadError, Modal, SearchField } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { getSiteContent } from '../../lib/site.js';
import { CONTACT_SUBJECTS } from '../../lib/constants.js';
import { cn } from '../../lib/format.js';

const STATUSES = [
  { key: 'new', label: 'New', icon: Mail, tone: 'bg-lime text-ink' },
  { key: 'read', label: 'Read', icon: MailOpen, tone: 'bg-sand text-ink' },
  { key: 'resolved', label: 'Resolved', icon: CheckCheck, tone: 'bg-emerald-100 text-emerald-800' },
];

const statusMeta = (status) => STATUSES.find((item) => item.key === status) || STATUSES[0];

// Canned replies for the questions that fill a rental inbox. The bodies live in
// site copy so an admin can rewrite them without a deploy; the labels stay short
// so the picker reads like a menu.
const REPLY_TEMPLATES = [
  { key: 'one_way', label: 'One-way rental', contentKey: 'inbox_template_one_way' },
  { key: 'deposit', label: 'Security deposit', contentKey: 'inbox_template_deposit' },
  { key: 'extension', label: 'Trip extension', contentKey: 'inbox_template_extension' },
  { key: 'cancel', label: 'Cancellation & refunds', contentKey: 'inbox_template_cancel' },
];

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function Inbox() {
  const { push } = useToast();
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [notesDraft, setNotesDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('new');
  const [subjectDraft, setSubjectDraft] = useState('General');
  const [saving, setSaving] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyTemplate, setReplyTemplate] = useState('');
  const [resolveOnSend, setResolveOnSend] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const searchRef = useRef(null);

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await api.adminContactMessages();
      if (!requestGuard.isCurrent(guard)) return;
      setMessages(rows);
      setSelectedId((current) => (
        current && rows.some((row) => row.id === current) ? current : null
      ));
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

  // Deep link from the dashboard "Group & corporate" banner and any staff
  // notification: /admin/inbox?subject=Group+%26+corporate pre-filters the
  // queue, then clears the param so closing the page does not re-apply it.
  useEffect(() => {
    const subject = searchParams.get('subject');
    if (!subject) return;
    if (CONTACT_SUBJECTS.includes(subject)) setSubjectFilter(subject);
    const next = new URLSearchParams(searchParams);
    next.delete('subject');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  const selected = messages.find((message) => message.id === selectedId) || null;

  useEffect(() => {
    setNotesDraft(selected?.staffNotes ?? '');
    setStatusDraft(selected?.status ?? 'new');
    setSubjectDraft(selected?.subject || 'General');
  }, [selected?.id, selected?.staffNotes, selected?.status, selected?.subject]);

  const counts = useMemo(() => ({
    all: messages.length,
    new: messages.filter((message) => message.status === 'new').length,
    read: messages.filter((message) => message.status === 'read').length,
    resolved: messages.filter((message) => message.status === 'resolved').length,
    subjects: Object.fromEntries(CONTACT_SUBJECTS.map((subject) => [
      subject,
      messages.filter((message) => (message.subject || 'General') === subject).length,
    ])),
  }), [messages]);

  // Notes and status are edited in place. Track dirtiness so switching threads
  // never throws away a half-written note: `select` saves the draft first.
  const dirty = Boolean(selected) && (
    notesDraft !== (selected.staffNotes ?? '') || statusDraft !== selected.status || subjectDraft !== (selected.subject || 'General')
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages.filter((message) => {
      if (filter !== 'all' && message.status !== filter) return false;
      if (subjectFilter !== 'all' && (message.subject || 'General') !== subjectFilter) return false;
      if (!needle) return true;
      return [message.name, message.email, message.phone, message.message, message.bookingCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [messages, filter, query, subjectFilter]);

  const updateLocal = (next) => {
    setMessages((current) => current.map((message) => (
      message.id === next.id ? next : message
    )));
    // Keep the console sidebar's unread badge honest.
    window.dispatchEvent(new Event('rove:inbox-changed'));
  };

  const select = async (message) => {
    // Auto-save the open draft before moving on. If the save fails we stay put
    // rather than silently discarding the operator's notes.
    if (dirty && selected && selected.id !== message.id) {
      try {
        const saved = await api.adminUpdateContactMessage({
          id: selected.id,
          status: statusDraft,
          staffNotes: notesDraft,
          subject: subjectDraft,
        });
        updateLocal({ ...selected, ...saved });
      } catch (error) {
        push(error.message, 'error');
        return;
      }
    }
    setSelectedId(message.id);
    if (message.status === 'new') {
      try {
        const next = await api.adminUpdateContactMessage({ id: message.id, status: 'read' });
        updateLocal({ ...message, ...next });
      } catch (error) {
        push(error.message, 'error');
      }
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const next = await api.adminUpdateContactMessage({
        id: selected.id,
        status: statusDraft,
        staffNotes: notesDraft,
        subject: subjectDraft,
      });
      updateLocal({ ...selected, ...next });
      push(content.inbox_saved, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.adminDeleteContactMessage(deleteTarget.id);
      setMessages((current) => current.filter((message) => message.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      window.dispatchEvent(new Event('rove:inbox-changed'));
      push(content.inbox_deleted, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const greeting = `Hi ${selected?.name.split(' ')[0] || 'there'},\n\n`;

  const openReply = () => {
    if (!selected) return;
    setReplyDraft(greeting);
    setReplyTemplate('');
    setResolveOnSend(false);
    setReplyOpen(true);
  };

  const applyTemplate = (key) => {
    setReplyTemplate(key);
    const template = REPLY_TEMPLATES.find((item) => item.key === key);
    setReplyDraft(template ? `${greeting}${content[template.contentKey]}\n\n— Team Rove` : greeting);
  };

  const replyMailto = selected
    ? `mailto:${selected.email}?subject=${encodeURIComponent('Re: your message to Rove')}&body=${encodeURIComponent(replyDraft)}`
    : '#';

  const sendReply = async () => {
    if (!selected || !selected.email) return;
    if (resolveOnSend && selected.status !== 'resolved') {
      try {
        const next = await api.adminUpdateContactMessage({ id: selected.id, status: 'resolved' });
        updateLocal({ ...selected, ...next });
        setStatusDraft('resolved');
        push(content.inbox_reply_sent, 'success');
      } catch (error) {
        push(error.message, 'error');
        return;
      }
    }
    setReplyOpen(false);
    window.location.href = replyMailto;
  };

  const copyReply = async () => {
    try {
      await navigator.clipboard.writeText(replyDraft);
      push(content.inbox_reply_copied, 'success');
    } catch {
      push(content.inbox_copy_failed, 'error');
    }
  };

  // Keyboard triage: J/K walk the visible queue, R replies, / searches, Esc
  // clears the reader. Suppressed while typing, while a modal is open, and
  // whenever a modifier key is held so browser/OS shortcuts stay untouched.
  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const tag = (target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      if (event.key === 'j' || event.key === 'k') {
        if (!filtered.length) return;
        event.preventDefault();
        const index = filtered.findIndex((message) => message.id === selectedId);
        const nextIndex = event.key === 'j'
          ? (index < 0 ? 0 : Math.min(filtered.length - 1, index + 1))
          : Math.max(0, index - 1);
        const next = filtered[nextIndex];
        if (next && next.id !== selectedId) select(next);
        return;
      }
      if (event.key === 'Escape' && selectedId) {
        setSelectedId(null);
        return;
      }
      if (event.key === 'r' && selected) {
        event.preventDefault();
        openReply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selectedId, selected, dirty]);

  // Keep the keyboard-selected row visible in the scrolling queue.
  useEffect(() => {
    if (!selectedId) return;
    const node = Array.from(document.querySelectorAll('[data-message-id]'))
      .find((element) => element.getAttribute('data-message-id') === selectedId);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Inbox</h1>
          <p className="mt-1 text-xs text-muted">{content.inbox_subtitle}</p>
          <p className="mt-2 hidden text-[0.6rem] font-semibold text-muted lg:block">{content.inbox_shortcuts}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn btn-outline btn-sm">
          {loading ? content.inbox_refreshing : 'Refresh'}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn('rounded-full px-3 py-1.5 text-[0.68rem] font-extrabold transition', filter === 'all' ? 'bg-ink text-cream' : 'border border-line bg-white text-muted hover:text-ink')}
        >
          All <span className="ml-1 opacity-60">{counts.all}</span>
        </button>
        {STATUSES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn('rounded-full px-3 py-1.5 text-[0.68rem] font-extrabold transition', filter === item.key ? 'bg-ink text-cream' : 'border border-line bg-white text-muted hover:text-ink')}
          >
            {item.label} <span className="ml-1 opacity-60">{counts[item.key]}</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <SearchField
            value={query}
            onChange={setQuery}
            inputRef={searchRef}
            placeholder="Search name, email or message"
            label="Search messages"
            className="w-full"
          />
        </div>
        {query && (
          <span className="text-[0.62rem] font-bold text-muted" aria-live="polite">
            {filtered.length} of {counts.all} message{filtered.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by subject">
        <button
          type="button"
          onClick={() => setSubjectFilter('all')}
          aria-pressed={subjectFilter === 'all'}
          className={cn('rounded-full border px-2.5 py-1 text-[0.62rem] font-bold transition', subjectFilter === 'all' ? 'border-ink bg-ink text-cream' : 'border-line bg-white text-muted hover:border-ink hover:text-ink')}
        >
          Any subject <span className="ml-0.5 opacity-60">{counts.all}</span>
        </button>
        {CONTACT_SUBJECTS.map((subject) => (
          <button
            key={subject}
            type="button"
            onClick={() => setSubjectFilter(subject)}
            aria-pressed={subjectFilter === subject}
            className={cn('rounded-full border px-2.5 py-1 text-[0.62rem] font-bold transition', subjectFilter === subject ? 'border-sun bg-sun text-ink' : 'border-line bg-white text-muted hover:border-ink hover:text-ink')}
          >
            {subject} <span className="ml-0.5 opacity-60">{counts.subjects[subject] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <section className={cn('overflow-hidden rounded-2xl border border-line bg-white', selected && 'hidden lg:block')}>
          {loading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-stone-100" />)}
            </div>
          ) : loadError && !messages.length ? (
            <LoadError
              title="The inbox could not load"
              message={loadError}
              hint="New contact messages may be waiting. Retry before telling a customer nothing came through."
              onRetry={() => load()}
              className="m-3"
            />
          ) : filtered.length ? (
            <ul className="max-h-[calc(100vh-15rem)] divide-y divide-line overflow-y-auto">
              {filtered.map((message) => {
                const meta = statusMeta(message.status);
                return (
                  <li key={message.id}>
                    <button
                      type="button"
                      onClick={() => select(message)}
                      data-message-id={message.id}
                      className={cn(
                        'w-full px-4 py-3.5 text-left transition hover:bg-paper',
                        selectedId === message.id && 'bg-lime/10',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn('truncate text-[0.74rem]', message.status === 'new' ? 'font-extrabold text-ink' : 'font-bold text-ink/80')}>{message.name}</p>
                          <p className="truncate text-[0.62rem] text-muted">{message.email}</p>
                        </div>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[0.54rem] font-extrabold uppercase tracking-wider', meta.tone)}>{meta.label}</span>
                      </div>
                      <span className="mt-1 inline-flex rounded-full bg-sand/70 px-2 py-0.5 text-[0.54rem] font-bold text-ink/70">{message.subject || 'General'}</span>
                      {message.bookingCode && <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-white/90 px-2 py-0.5 font-mono text-[0.56rem] font-bold text-ink"><CalendarDays className="h-3 w-3 text-muted" /> {message.bookingCode}</p>}
                      <p className="mt-1.5 line-clamp-2 text-[0.65rem] leading-5 text-muted">{message.message}</p>
                      <p className="mt-1 flex items-center gap-1 text-[0.56rem] text-muted/80"><Clock3 className="h-2.5 w-2.5" /> {formatWhen(message.createdAt)}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={InboxIcon}
              title={messages.length ? content.inbox_empty_title : content.inbox_empty_desc_all}
              description={messages.length ? content.inbox_empty_desc : content.inbox_empty_desc_all}
              action={query ? <button type="button" onClick={() => setQuery('')} className="btn btn-white">{content.return_clear_filters}</button> : undefined}
              className="py-16"
            />
          )}
        </section>

        <section className={cn('rounded-2xl border border-line bg-white', !selected && 'hidden lg:flex')}>
          {!selected ? (
            <div className="flex min-h-[24rem] w-full flex-col items-center justify-center px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sand text-ink"><InboxIcon className="h-6 w-6" /></span>
              <h2 className="mt-4 text-lg font-extrabold tracking-tight">Choose a message</h2>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted">Read the full note, add internal context and reply by email.</p>
            </div>
          ) : (
            <div className="flex min-h-[24rem] flex-col">
              <div className="border-b border-line p-4 sm:p-5">
                <button type="button" onClick={() => setSelectedId(null)} className="mb-3 inline-flex items-center gap-1 text-[0.66rem] font-bold text-muted hover:text-ink lg:hidden">
                  <ArrowLeft className="h-3.5 w-3.5" /> All messages
                </button>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-extrabold tracking-tight">{selected.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.66rem] text-muted">
                      <a href={`mailto:${selected.email}`} className="inline-flex items-center gap-1 font-semibold hover:text-ink"><Mail className="h-3 w-3" /> {selected.email}</a>
                      {selected.phone && <a href={`tel:${selected.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-ink"><Phone className="h-3 w-3" /> {selected.phone}</a>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selected.bookingCode && (
                      <Link to={`/admin/bookings?code=${encodeURIComponent(selected.bookingCode)}`} className="btn btn-ghost btn-sm" title={content.staff_view_booking_tip}>
                        <CalendarDays className="h-3.5 w-3.5" /> {content.staff_view_booking}
                      </Link>
                    )}
                    <button type="button" onClick={openReply} className="btn btn-dark btn-sm"><Reply className="h-3.5 w-3.5" /> {content.inbox_reply}</button>
                    <button type="button" onClick={() => setDeleteTarget(selected)} className="rounded-lg p-2 text-muted transition hover:bg-rose-50 hover:text-rose-700" aria-label="Delete message"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-4 p-4 sm:p-5">
                <div className="rounded-2xl bg-paper p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.56rem] font-bold uppercase tracking-[0.12em] text-muted">Message · {formatWhen(selected.createdAt)}</p>
                    {selected.bookingCode && (
                      <Link to={`/admin/bookings?code=${encodeURIComponent(selected.bookingCode)}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-white/90 px-2 py-0.5 font-mono text-[0.58rem] font-bold text-ink hover:border-forest/40 hover:text-forest" title={content.staff_view_booking_tip}>
                        <CalendarDays className="h-3 w-3 text-muted" /> {selected.bookingCode}
                      </Link>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[0.78rem] leading-6 text-ink/80">{selected.message}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-[10rem_14rem_1fr]">
                  <div>
                    <label className="label" htmlFor="inbox-subject">{content.inbox_subject_label}</label>
                    <select id="inbox-subject" value={subjectDraft} onChange={(event) => setSubjectDraft(event.target.value)} className="field">
                      {CONTACT_SUBJECTS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="inbox-status">{content.inbox_status_label}</label>
                    <select id="inbox-status" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} className="field">
                      {STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="inbox-notes">{content.inbox_notes_label}</label>
                    <textarea id="inbox-notes" rows={1} value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} className="field resize-none" placeholder={content.inbox_notes_hint} maxLength={1200} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cn('text-[0.6rem]', dirty ? 'font-bold text-amber-800' : 'text-muted')}>
                    {dirty ? content.inbox_unsaved : content.inbox_reply_desc}
                  </p>
                  <button type="button" onClick={save} disabled={saving || !dirty} className="btn btn-dark btn-sm">
                    {saving ? content.inbox_saving : content.inbox_save}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <Modal
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
        title={content.inbox_reply_title.replace('{name}', selected?.name || '')}
        description={content.inbox_reply_desc}
        size="md"
        footer={selected?.email ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyReply} className="btn btn-white">
              <Copy className="h-3.5 w-3.5" /> {content.inbox_reply_copy}
            </button>
            <button type="button" onClick={sendReply} className="btn btn-lime flex-1">
              <Send className="h-3.5 w-3.5" /> {content.inbox_reply_open}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setReplyOpen(false)} className="btn btn-white w-full">Close</button>
        )}
      >
        {selected && (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-paper p-3">
              <p className="truncate text-[0.7rem] font-extrabold">{selected.name}</p>
              <p className="truncate text-[0.62rem] text-muted">{selected.email || selected.phone || '—'}</p>
              <p className="mt-1.5 line-clamp-3 text-[0.66rem] leading-5 text-muted">{selected.message}</p>
            </div>
            {selected.email ? (
              <>
                <div>
                  <label className="label" htmlFor="inbox-reply-template">{content.inbox_reply_template}</label>
                  <select
                    id="inbox-reply-template"
                    value={replyTemplate}
                    onChange={(event) => applyTemplate(event.target.value)}
                    className="field"
                  >
                    <option value="">{content.inbox_reply_template_none}</option>
                    {REPLY_TEMPLATES.map((template) => (
                      <option key={template.key} value={template.key}>{template.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="inbox-reply-body">{content.inbox_reply_body}</label>
                  <textarea
                    id="inbox-reply-body"
                    rows={7}
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    className="field resize-none"
                    maxLength={4000}
                  />
                  <div className="mt-1 flex items-center justify-between text-[0.58rem] text-muted">
                    <span>{content.inbox_reply_desc}</span>
                    <span>{replyDraft.length} / 4,000</span>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[0.68rem] font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={resolveOnSend}
                    onChange={(event) => setResolveOnSend(event.target.checked)}
                    className="h-4 w-4 rounded border-line"
                  />
                  {content.inbox_reply_resolve}
                </label>
              </>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.68rem] leading-5 text-amber-900">
                {content.inbox_reply_no_email}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        title={content.inbox_delete}
        description={content.inbox_delete_confirm}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="btn btn-white flex-1">{content.inbox_delete_keep}</button>
            <button type="button" onClick={remove} disabled={deleting} className="btn btn-dark flex-1">{deleting ? content.inbox_deleting : content.inbox_delete}</button>
          </div>
        )}
      >
        <p className="text-sm leading-6 text-muted">{content.inbox_delete_irreversible}</p>
      </Modal>
    </div>
  );
}
