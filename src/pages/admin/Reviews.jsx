import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageSquare, Search, Star, Trash2, X } from 'lucide-react';
import { EmptyState, LoadError, Modal, Pagination, SearchField, Stars, TableScrollHint } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { usePagination } from '../../hooks/usePagination.js';
import { api } from '../../lib/api.js';
import { getSiteContent } from '../../lib/site.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { cn, longDate } from '../../lib/format.js';

const RATING_FILTERS = [
  { key: 'all', label: 'All ratings' },
  { key: '5', label: '5 star' },
  { key: '4', label: '4 star' },
  { key: '3', label: '3 star' },
  { key: 'low', label: '2 star & below' },
];

const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'lowest', label: 'Lowest rating' },
  { key: 'highest', label: 'Highest rating' },
];

export default function Reviews() {
  const { push } = useToast();
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta?.settings), [meta?.settings]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [savingReply, setSavingReply] = useState(false);
  const [query, setQuery] = useState('');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [replyFilter, setReplyFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [params, setParams] = useSearchParams();
  const vehicleFilter = params.get('vehicle') || '';
  const repliesEnabled = meta?.settings?.review_replies_enabled !== 'false';

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const next = await api.adminReviews();
      if (!requestGuard.isCurrent(guard)) return;
      setReviews(next);
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

  const summary = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    // The band describes the current scope: when a vehicle filter is active it
    // must show that vehicle's rating, not the whole fleet's.
    reviews
      .filter((review) => !vehicleFilter || review.vehicleId === vehicleFilter)
      .forEach((review) => {
        const rating = Math.round(Number(review.rating) || 0);
        if (rating >= 1 && rating <= 5) {
          counts[rating] += 1;
          total += 1;
        }
      });
    const sum = Object.entries(counts).reduce((acc, [star, count]) => acc + Number(star) * count, 0);
    return {
      total,
      counts,
      average: total ? Math.round((sum / total) * 10) / 10 : 0,
      low: counts[1] + counts[2],
      fiveShare: total ? Math.round((counts[5] / total) * 100) : 0,
      unreplied: reviews
        .filter((review) => !vehicleFilter || review.vehicleId === vehicleFilter)
        .filter((review) => !review.reply).length,
    };
  }, [reviews, vehicleFilter]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = reviews.filter((review) => {
      if (vehicleFilter && review.vehicleId !== vehicleFilter) return false;
      const rating = Math.round(Number(review.rating) || 0);
      if (ratingFilter === 'low' && rating > 2) return false;
      if (ratingFilter !== 'all' && ratingFilter !== 'low' && rating !== Number(ratingFilter)) return false;
      if (replyFilter === 'needs' && review.reply) return false;
      if (replyFilter === 'replied' && !review.reply) return false;
      if (!needle) return true;
      return [review.author, review.email, review.vehicleName, review.comment, review.reply, review.bookingCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
    const time = (review) => String(review.createdAt ?? '');
    return rows.sort((a, b) => {
      if (sort === 'oldest') return time(a).localeCompare(time(b));
      if (sort === 'lowest') return (Number(a.rating) || 0) - (Number(b.rating) || 0) || time(b).localeCompare(time(a));
      if (sort === 'highest') return (Number(b.rating) || 0) - (Number(a.rating) || 0) || time(b).localeCompare(time(a));
      return time(b).localeCompare(time(a));
    });
  }, [reviews, query, ratingFilter, replyFilter, sort, vehicleFilter]);

  const pagination = usePagination({
    items: filtered,
    resetKey: `${query}|${ratingFilter}|${replyFilter}|${sort}|${vehicleFilter}`,
    pageSize: 25,
  });
  const pageRows = pagination.rows;

  const vehicleName = useMemo(
    () => reviews.find((review) => review.vehicleId === vehicleFilter)?.vehicleName || '',
    [reviews, vehicleFilter]
  );

  const clearVehicle = () => {
    const next = new URLSearchParams(params);
    next.delete('vehicle');
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setQuery('');
    setRatingFilter('all');
    setReplyFilter('all');
    clearVehicle();
  };

  const openReply = (review) => {
    setReplyTarget(review);
    setReplyText(review.reply || '');
  };

  const saveReply = async () => {
    if (!replyTarget) return;
    setSavingReply(true);
    try {
      const result = await api.adminReplyToReview({ id: replyTarget.id, reply: replyText });
      setReviews((current) => current.map((review) => (
        review.id === replyTarget.id
          ? { ...review, reply: result.reply, repliedAt: result.repliedAt }
          : review
      )));
      setReplyTarget(null);
      setReplyText('');
      push(result.reply ? 'Reply published.' : 'Reply removed.', 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSavingReply(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.adminDeleteReview(deleteTarget.id);
      setReviews((current) => current.filter((review) => review.id !== deleteTarget.id));
      setDeleteTarget(null);
      push(content.reviews_removed, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const filtering = Boolean(query.trim()) || ratingFilter !== 'all' || replyFilter !== 'all' || Boolean(vehicleFilter);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Reviews</h1>
          <p className="mt-1 text-xs text-muted">
            What customers wrote after their trips — reply publicly, or remove anything that breaks our trust standards.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {repliesEnabled && summary.unreplied > 0 && (
            <button
              type="button"
              onClick={() => setReplyFilter('needs')}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[0.62rem] font-extrabold text-amber-900 transition hover:bg-amber-100"
            >
              <MessageSquare className="h-3 w-3" /> {summary.unreplied} awaiting a reply
            </button>
          )}
          <span className="badge bg-white text-muted">
            {filtering ? `${filtered.length} of ${reviews.length}` : `${reviews.length}`} review{reviews.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      {!repliesEnabled && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.66rem] leading-5 text-amber-900" role="status">
          Public replies are switched off in Settings. Existing replies stay hidden on the vehicle pages and new ones cannot be published until you turn them back on.
        </p>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError && !reviews.length ? (
        <LoadError
          title="Reviews could not load"
          message={loadError}
          hint="An empty list here would hide unreplied reviews. Retry before assuming moderation is clear."
          onRetry={() => load()}
        />
      ) : reviews.length ? (
        <>
          {summary.total > 0 && (
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">Average rating</p>
              <p className="mt-2 flex items-baseline gap-1 text-2xl font-extrabold tracking-tight">
                {summary.average.toFixed(1)} <span className="text-xs font-bold text-muted">/ 5</span>
              </p>
              <div className="mt-1"><Stars value={summary.average} size="h-3 w-3" showValue={false} /></div>
              <p className="mt-1 text-[0.62rem] text-muted">{summary.total} rated review{summary.total === 1 ? '' : 's'}</p>
            </div>
            <div className="stat-card">
              <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">Rating spread</p>
              <div className="mt-2 space-y-1" role="group" aria-label={`Rating distribution across ${summary.total} reviews`}>
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = summary.counts[star] || 0;
                  const percent = summary.total ? Math.round((count / summary.total) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-[0.6rem]">
                      <span className="w-6 font-bold text-muted">{star}★</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="w-6 text-right font-bold text-muted">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="stat-card">
              <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">Needs attention</p>
              <p className={cn('mt-2 text-2xl font-extrabold tracking-tight', summary.low > 0 ? 'text-rose-700' : 'text-forest')}>{summary.low}</p>
              <p className="mt-1 text-[0.62rem] text-muted">
                {summary.low === 1 ? 'review at 2 stars or below' : 'reviews at 2 stars or below'}
              </p>
              <p className="mt-1 text-[0.62rem] text-muted">{summary.fiveShare}% gave five stars</p>
            </div>
          </section>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
            <SearchField value={query} onChange={setQuery} placeholder="Search customer, vehicle, booking or text" label="Search reviews" className="min-w-[14rem] flex-1" />
            <select value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)} className="field w-auto" aria-label="Filter by rating">
              {RATING_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            {repliesEnabled && (
              <select value={replyFilter} onChange={(event) => setReplyFilter(event.target.value)} className="field w-auto" aria-label="Filter by reply state">
                <option value="all">All replies</option>
                <option value="needs">Needs a reply</option>
                <option value="replied">Replied</option>
              </select>
            )}
            <select value={sort} onChange={(event) => setSort(event.target.value)} className="field w-auto" aria-label="Sort reviews">
              {SORTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            {vehicleFilter && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/20 bg-ink/[0.04] py-1 pl-2.5 pr-1.5 text-[0.62rem] font-bold text-ink">
                Vehicle: {vehicleName || 'selected'}
                <button
                  type="button"
                  onClick={clearVehicle}
                  className="rounded-full p-0.5 text-muted transition hover:bg-white hover:text-ink"
                  aria-label="Clear vehicle filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {filtering && (
              <button
                type="button"
                onClick={clearFilters}
                className="btn btn-ghost btn-sm"
              >
                Clear
              </button>
            )}
          </div>

          {filtered.length ? (
            <>
              <TableScrollHint className="mt-3" />
              <div className="table-wrap" role="region" aria-label="Customer reviews table" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr><th>Vehicle</th><th>Customer</th><th>Rating</th><th>Review</th><th>Booking</th><th>Date</th><th /></tr>
                  </thead>
                  <tbody>
                    {pageRows.map((review) => (
                      <tr key={review.id}>
                        <td className="max-w-[11rem] truncate font-semibold">{review.vehicleName}</td>
                        <td>
                          <p className="text-[0.72rem] font-bold">{review.author || 'Customer'}</p>
                          <p className="text-[0.6rem] text-muted">{review.email || '—'}</p>
                        </td>
                        <td><Stars value={review.rating} size="h-3.5 w-3.5" /></td>
                        <td className="max-w-[26rem]">
                          <p className="line-clamp-3 text-[0.7rem] leading-5 text-ink/80">{review.comment || '—'}</p>
                          {review.reply && (
                            <div className="mt-1.5 rounded-lg border border-forest/20 bg-forest/[0.04] px-2 py-1.5">
                              <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-forest">
                                Rove replied{review.repliedAt ? ` · ${longDate(review.repliedAt)}` : ''}
                              </p>
                              <p className="line-clamp-2 text-[0.64rem] leading-4 text-ink/75">{review.reply}</p>
                            </div>
                          )}
                        </td>
                        <td className="font-mono text-[0.62rem] font-bold">
                          {review.bookingCode ? (
                            <Link
                              to={`/admin/bookings?code=${encodeURIComponent(review.bookingCode)}`}
                              className="underline-offset-2 hover:text-forest hover:underline"
                            >
                              {review.bookingCode}
                            </Link>
                          ) : '—'}
                        </td>
                        <td className="whitespace-nowrap text-[0.64rem] text-muted">{longDate(review.createdAt)}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {repliesEnabled && (
                              <button
                                type="button"
                                onClick={() => openReply(review)}
                                className={cn(
                                  'rounded-lg p-2 transition',
                                  review.reply
                                    ? 'text-forest hover:bg-forest/10'
                                    : 'text-muted hover:bg-amber-50 hover:text-amber-800',
                                )}
                                aria-label={review.reply ? `Edit reply to ${review.author || 'customer'}` : `Reply to ${review.author || 'customer'}`}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(review)}
                              className="rounded-lg p-2 text-muted transition hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Remove review by ${review.author || 'customer'}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
              icon={Search}
              title={vehicleFilter ? 'No reviews for this vehicle' : 'No reviews match'}
              description={vehicleFilter
                ? `${vehicleName || 'This vehicle'} has no reviews matching the current filters.`
                : 'Try a different search term or rating filter.'}
              action={<button type="button" onClick={clearFilters} className="btn btn-dark">Clear filters</button>}
            />
          )}

          <p className="rounded-xl border border-line bg-white/70 px-3 py-2 text-[0.62rem] leading-5 text-muted">
            Removing a review is final. It also lowers the vehicle&apos;s public rating — only remove content that genuinely violates policy (abuse, personal data, off-topic).
          </p>
        </>
      ) : (
        <EmptyState icon={Star} title="No reviews yet" description="Customer reviews will land here as trips get completed." />
      )}

      <Modal
        open={Boolean(replyTarget)}
        onClose={() => (savingReply ? null : setReplyTarget(null))}
        title={replyTarget?.reply ? 'Edit your reply' : 'Reply to this review'}
        description="Your reply is public and appears under the review on the vehicle page."
        size="md"
        footer={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setReplyTarget(null)} disabled={savingReply} className="btn btn-white flex-1">Cancel</button>
            {replyTarget?.reply && (
              <button
                type="button"
                onClick={() => setReplyText('')}
                disabled={savingReply || !replyText}
                className="btn btn-ghost text-rose-700"
              >
                Clear text
              </button>
            )}
            <button
              type="button"
              onClick={saveReply}
              disabled={savingReply || (!replyText.trim() && !replyTarget?.reply)}
              className="btn btn-lime flex-1"
            >
              {savingReply ? 'Saving…' : replyText.trim() ? 'Publish reply' : replyTarget?.reply ? 'Remove reply' : 'Publish reply'}
            </button>
          </div>
        )}
      >
        {replyTarget && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl border border-line bg-paper p-3">
              <Stars value={replyTarget.rating} size="h-3.5 w-3.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.78rem] font-extrabold">{replyTarget.author || 'Customer'} · {replyTarget.vehicleName}</p>
                <p className="mt-1 text-[0.68rem] leading-5 text-muted">{replyTarget.comment || 'No comment left.'}</p>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="review-reply">Your reply</label>
              <textarea
                id="review-reply"
                rows={5}
                maxLength={1200}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                className="field resize-none"
                placeholder="Thank the customer, explain what changed, or invite them back. Keep it warm and specific."
              />
              <div className="mt-1 flex items-center justify-between text-[0.6rem] text-muted">
                <span>Signed off as Rove · shown publicly</span>
                <span>{replyText.trim().length} / 1,200</span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        title="Remove this review?"
        description="This permanently deletes the review and its rating."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={remove} disabled={deleting} className="btn btn-dark flex-1">{deleting ? 'Removing…' : 'Remove review'}</button>
          </div>
        )}
      >
        <div className="flex items-start gap-3 rounded-xl border border-line bg-paper p-3">
          <Stars value={deleteTarget?.rating} size="h-3.5 w-3.5" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.78rem] font-extrabold">{deleteTarget?.author || 'Customer'} · {deleteTarget?.vehicleName}</p>
            <p className="mt-1 line-clamp-2 text-[0.68rem] leading-5 text-muted">{deleteTarget?.comment}</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
