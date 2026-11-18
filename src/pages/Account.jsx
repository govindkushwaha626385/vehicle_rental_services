import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Bell, BellPlus, CalendarDays, CalendarPlus, CalendarRange, Car, Check, Clock, CreditCard, Download, FileText, Gauge, Heart,
  IdCard, LifeBuoy, LogOut, MapPin, Moon, RefreshCw, ShieldCheck, Star, Upload, User, X,
} from 'lucide-react';
import VehicleCard from '../components/VehicleCard.jsx';
import ChangeBookingModal from '../components/ChangeBookingModal.jsx';
import ExtendTripModal from '../components/ExtendTripModal.jsx';
import LateMeter from '../components/LateMeter.jsx';
import { Avatar, EmptyState, Modal, PageLoader, Skeleton, StatusPill, TableScrollHint, Toggle } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { downloadBookingICS } from '../lib/calendar.js';
import { bookingPaymentState, bookingPaymentSummary, cn, inr, longDate, paymentLabel, roleLabel, shortDate, timeLabel } from '../lib/format.js';
import { buildDataExport, downloadDataExport } from '../lib/dataExport.js';
import { cancellationRefund, getSiteContent } from '../lib/site.js';
import { tripCountdown } from '../lib/tripCountdown.js';
import { kmDisclosure } from '../lib/km.js';
import { depositOutcome, depositRefundRows } from '../lib/returns.js';
import { licenceExpiryProblem } from '../lib/validation.js';
import { readRememberedTrip } from '../lib/tripMemory.js';
import { NOTIFICATION_PREF_KEYS, DEFAULT_NOTIFICATION_PREFS } from '../lib/notifications.js';
import { readThemePreference, writeThemePreference } from '../lib/theme.js';

const TABS = [
  { key: 'trips', label: 'My trips', icon: Car },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'saved', label: 'Saved vehicles', icon: Heart },
  { key: 'payments', label: 'Payments & billing', icon: CreditCard },
  { key: 'profile', label: 'Profile', icon: User },
];

export default function Account() {
  const { user, signOut, updateProfile, isDemo, refresh } = useAuth();
  const { meta } = useMeta();
  const { push } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab')
    || (/^#licence/.test(window.location.hash) ? 'profile' : '');
  const tab = TABS.some((item) => item.key === requestedTab) ? requestedTab : 'trips';
  const content = getSiteContent(meta.settings);
  const tabs = TABS.map((item) => ({ ...item, label: content[`account_tab_${item.key}`] || item.label }));
  const policy = content.policy;
  const fill = (text, values = {}) => Object.entries(values)
    .reduce((next, [token, value]) => next.replaceAll(`{${token}}`, String(value)), text);

  const [bookings, setBookings] = useState([]);
  const [txFilter, setTxFilter] = useState('all');
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [changeTarget, setChangeTarget] = useState(null);
  const [extendTarget, setExtendTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancelRefund = cancelTarget
    ? cancellationRefund(cancelTarget, cancelTarget.amountPaid, meta.settings)
    : null;

  const [profile, setProfile] = useState({ name: user?.name || '', phone: user?.phone || '', licenseNumber: user?.licenseNumber || '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileErrorField, setProfileErrorField] = useState('');
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);

  // Customer-chosen dark mode. The default is the admin preference in
  // meta.settings.theme_mode; the per-device override lives in localStorage and
  // is honoured globally by ThemeController (so it survives page reloads).
  const [darkMode, setDarkMode] = useState(() => {
    const stored = readThemePreference();
    return stored ? stored === 'dark' : meta.settings?.theme_mode === 'dark';
  });
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    writeThemePreference(next ? 'dark' : 'light');
    const root = document.documentElement;
    if (next) root.classList.add('theme-dark'); else root.classList.remove('theme-dark');
  };

  // Licence verification (KYC)
  const [licenceFile, setLicenceFile] = useState(null);
  const [licencePreview, setLicencePreview] = useState('');
  const [licenceUploading, setLicenceUploading] = useState(false);
  const [licenceError, setLicenceError] = useState('');

  useEffect(() => {
    if (user) setProfile({ name: user.name || '', phone: user.phone || '', licenseNumber: user.licenseNumber || '' });
  }, [user]);

  useEffect(() => () => {
    if (licencePreview) URL.revokeObjectURL(licencePreview);
  }, [licencePreview]);

  const loadBookings = async () => {
    setBookingsLoading(true);
    setBookingsError('');
    try {
      setBookings(await api.getMyBookings());
    } catch (error) {
      setBookingsError(error.message || content.account_load_error_title);
    } finally {
      setBookingsLoading(false);
    }
  };

  const loadFavorites = async () => {
    setFavoritesLoading(true);
    setFavoritesError('');
    try {
      setFavorites(await api.getFavorites());
    } catch (error) {
      setFavoritesError(error.message || content.account_saved_load_error);
    } finally {
      setFavoritesLoading(false);
    }
  };

  const loadNotifications = async () => {
    if (!api.myNotifications) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }
    setNotificationsLoading(true);
    try {
      setNotifications(await api.myNotifications());
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setNotificationsLoading(false);
    }
  };

  useEffect(() => {
    loadBookings();
    loadFavorites();
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (content.alerts_enabled === false || typeof api.listAvailabilityAlerts !== 'function') return undefined;
    let alive = true;
    api.listAvailabilityAlerts()
      .then((rows) => { if (alive) setAlerts(rows ?? []); })
      .catch(() => { /* watchlist is a nice-to-have */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, content.alerts_enabled]);

  const setTab = (key) => setParams(key === 'trips' ? {} : { tab: key }, { replace: true });

  const openNotification = async (notification) => {
    if (!notification.readAt && api.markNotificationRead) {
      try { await api.markNotificationRead(notification.id); } catch { /* best-effort */ }
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
      )));
    }
    if (notification.link) navigate(notification.link);
  };

  const markAllRead = async () => {
    try {
      if (api.markAllNotificationsRead) await api.markAllNotificationsRead();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    } catch (error) {
      push(error.message || content.account_notifications_error, 'error');
    }
  };

  const downloadData = async () => {
    try {
      const trips = await api.getMyBookings();
      const saved = await api.getFavorites();
      const payload = buildDataExport({ user, bookings: trips, favorites: saved, settings: meta.settings });
      downloadDataExport(payload);
      push(content.account_export_started, 'success');
    } catch (error) {
      push(error.message || content.account_export_error, 'error');
    }
  };

  const stats = useMemo(() => {
    const completed = bookings.filter((booking) => booking.status === 'completed');
    return {
      trips: bookings.length,
      completed: completed.length,
      spend: completed.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0),
      saved: favorites.length,
    };
  }, [bookings, favorites]);

  const upcoming = bookings
    .filter((booking) => ['active', 'confirmed', 'pending'].includes(booking.status))
    // A trip in progress belongs above trips that have not started yet.
    .sort((a, b) => (a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0));
  const past = bookings.filter((booking) => !['active', 'confirmed', 'pending'].includes(booking.status));

  const payments = useMemo(() => {
    const rows = [];
    bookings.forEach((booking) => {
      (booking.payments || []).forEach((payment) => rows.push({ ...payment, bookingCode: booking.code, vehicle: booking.vehicle?.name }));
    });
    rows.push(...depositRefundRows(bookings));
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [bookings]);

  const cancelBooking = async () => {
    if (!cancelTarget) return;
    const target = cancelTarget;
    setBusy(true);
    try {
      const result = await api.cancelBooking({
        bookingId: target.id,
        code: target.code,
        reason: cancelReason.trim() || content.account_cancel_reason_default,
      });
      push(result?.message || content.manage_cancel_success, 'success');
      // Keep the card honest even if the follow-up reload fails.
      setBookings((current) => current.map((booking) => (
        booking.id === target.id ? { ...booking, status: 'cancelled', canCancel: false, canReview: false } : booking
      )));
      setCancelTarget(null);
      setCancelReason('');
      await loadBookings();
      loadNotifications();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async ({ rating, comment }) => {
    if (!reviewTarget) return;
    const target = reviewTarget;
    setBusy(true);
    try {
      await api.reviewBooking({
        bookingId: target.id,
        vehicleId: target.vehicle?.id,
        rating,
        comment,
      });
      push(content.account_review_success, 'success');
      setBookings((current) => current.map((booking) => (
        booking.id === target.id ? { ...booking, reviewed: true, canReview: false } : booking
      )));
      setReviewTarget(null);
      await loadBookings();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeAlert = async (id) => {
    try {
      await api.deleteAvailabilityAlert({ alertId: id });
      setAlerts((current) => current.filter((alert) => alert.id !== id));
      push(content.alert_removed, 'success');
    } catch (error) {
      push(error.message, 'error');
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError('');
    setProfileErrorField('');
    try {
      await updateProfile({
        name: profile.name.trim(),
        phone: profile.phone.trim(),
        licenseNumber: profile.licenseNumber.trim(),
      });
      push(content.account_profile_saved, 'success');
    } catch (error) {
      const message = error.message || content.account_profile_error;
      const field = /name/i.test(message) ? 'name' : /phone/i.test(message) ? 'phone' : /licen[cs]e/i.test(message) ? 'licenseNumber' : '';
      setProfileError(message);
      setProfileErrorField(field);
      if (field) document.getElementById(`acc-${field === 'licenseNumber' ? 'license' : field}`)?.focus();
    } finally {
      setSavingProfile(false);
    }
  };

  useEffect(() => {
    if (!user || notifPrefs || typeof api.getNotificationPreferences !== 'function') return undefined;
    let alive = true;
    api.getNotificationPreferences()
      .then((prefs) => { if (alive) setNotifPrefs(prefs); })
      .catch(() => { if (alive) setNotifPrefs({ ...DEFAULT_NOTIFICATION_PREFS }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, notifPrefs]);

  const saveNotificationPrefs = async () => {
    if (!notifPrefs) return;
    setSavingPrefs(true);
    try {
      const saved = await api.updateNotificationPreferences(notifPrefs);
      setNotifPrefs(saved);
      push(content.notif_saved, 'success');
    } catch (error) {
      push(error.message || content.notif_error, 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const pickLicence = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setLicenceError(content.account_licence_bad_type);
      setLicenceFile(null);
      setLicencePreview('');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLicenceError(content.account_licence_too_large);
      setLicenceFile(null);
      setLicencePreview('');
      event.target.value = '';
      return;
    }
    setLicenceError('');
    setLicenceFile(file);
    setLicencePreview(URL.createObjectURL(file));
  };

  const verifyLicence = async () => {
    if (!api.uploadLicence) {
      push(content.account_licence_unavailable, 'error');
      return;
    }
    if (!licenceFile) {
      setLicenceError(content.account_licence_pick_first);
      return;
    }
    setLicenceUploading(true);
    try {
      const result = await api.uploadLicence(licenceFile);
      await refresh();
      push(result?.verified ? content.account_licence_verified_toast : content.account_licence_received_toast, 'success');
      setLicenceFile(null);
      setLicencePreview('');
      setLicenceError('');
    } catch (error) {
      push(error.message || content.account_licence_upload_failed, 'error');
    } finally {
      setLicenceUploading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      push(content.account_signed_out, 'success');
    } catch (error) {
      push(error.message || content.account_sign_out_error, 'error');
    }
  };

  const resetDemo = async () => {
    if (!api.resetDemoData || resettingDemo) return;
    setResettingDemo(true);
    try {
      await api.resetDemoData();
      await refresh();
      await loadBookings();
      await loadFavorites();
      push(content.account_demo_reset, 'success');
    } catch (error) {
      push(error.message || content.account_demo_reset_error, 'error');
    } finally {
      setResettingDemo(false);
    }
  };

  if (!user) return <PageLoader />;

  return (
    <div className="pb-20">
      <section className="relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-lime/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-64 w-64 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="container-x relative py-8 sm:py-10">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <span className="inline-flex rounded-full bg-gradient-to-br from-lime via-aqua to-coral p-[2px] shadow-[0_16px_34px_-24px_rgba(10,15,11,0.55)]">
                <Avatar name={user.name} size="lg" className="ring-4 ring-paper" />
              </span>
              <div>
                <p className="eyebrow">{roleLabel[user.role] || 'Customer'} account</p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Hello, {user.name.split(' ')[0]}.</h1>
                <p className="mt-0.5 text-xs text-muted">{user.email} · Member since {longDate(user.createdAt)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[['Trips', stats.trips], ['Completed', stats.completed], ['Total spend', inr(stats.spend)]].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/80 bg-white/80 px-3 py-2.5 text-center shadow-[0_10px_24px_-24px_rgba(10,15,11,0.45)] backdrop-blur-sm">
                  <p className="text-[0.58rem] font-bold uppercase tracking-wider text-muted">{label}</p>
                  <p className="mt-1 text-sm font-extrabold">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="no-scrollbar mt-6 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-white/80 bg-white/80 p-1.5 shadow-[0_10px_30px_-30px_rgba(10,15,11,0.5)] backdrop-blur-sm">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[0.74rem] font-bold transition ${tab === item.key ? 'bg-ink text-cream shadow-[0_10px_20px_-16px_rgba(10,15,11,0.75)]' : 'text-muted hover:bg-white hover:text-ink'}`}
              >
                <item.icon className="h-3.5 w-3.5" /> {item.label}
                {item.key === 'saved' && stats.saved > 0 && <span className="rounded-full bg-lime px-1.5 text-[0.58rem] font-extrabold text-ink">{stats.saved}</span>}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container-x mt-7">
        {bookingsError && (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[0.72rem] font-semibold text-rose-800">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {content.account_load_error_title} <span className="font-medium text-rose-700/80">{content.account_load_error_copy}</span></span>
            <button type="button" onClick={loadBookings} disabled={bookingsLoading} className="btn btn-white btn-sm">{content.account_load_error_cta}</button>
          </div>
        )}
        {tab === 'trips' && !bookingsError && (
          <div className="space-y-8">
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-extrabold tracking-tight">{content.account_upcoming_title}</h2>
                <Link to="/browse" className="text-[0.7rem] font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">{content.account_book_another}</Link>
              </div>
              {bookingsLoading ? (
                <SkeletonList />
              ) : upcoming.length ? (
                <div className="space-y-3">
                  {upcoming.map((booking) => (
                    <TripCard key={booking.id} booking={booking} content={content} onCancel={() => setCancelTarget(booking)} onReview={() => setReviewTarget(booking)} onChange={() => setChangeTarget(booking)} onExtend={() => setExtendTarget(booking)} />
                  ))}
                </div>
              ) : bookings.length ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-8 text-center">
                  <p className="text-sm font-extrabold">{content.account_no_upcoming_title}</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">{content.account_no_upcoming_description}</p>
                </div>
              ) : (
                <EmptyState
                  icon={Car}
                  title={content.account_empty_title}
                  description={content.account_empty_description}
                  action={<Link to="/browse" className="btn btn-dark">{content.account_empty_cta} <ArrowRight className="h-4 w-4" /></Link>}
                />
              )}
            </section>

            {past.length > 0 && (
              <section>
                <h2 className="mb-4 text-lg font-extrabold tracking-tight">{content.account_past_title}</h2>
                <div className="space-y-3">
                  {past.map((booking) => (
                    <TripCard key={booking.id} booking={booking} content={content} onCancel={() => setCancelTarget(booking)} onReview={() => setReviewTarget(booking)} onChange={() => setChangeTarget(booking)} onExtend={() => setExtendTarget(booking)} past />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'invoices' && !bookingsError && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-extrabold tracking-tight">{content.account_invoices_title}</h2>
              <p className="mt-1 text-xs text-muted">{content.account_invoices_copy}</p>
            </div>
            {bookingsLoading ? (
              <SkeletonList />
            ) : bookings.length ? (
              <>
                <TableScrollHint className="mt-3" />
                <div className="table-wrap" role="region" aria-label={content.account_invoices_table_aria} tabIndex={0}>
                  <table className="data-table">
                  <thead>
                    <tr>
                      <th>{content.account_invoice_col}</th>
                      <th>{content.account_vehicle_col}</th>
                      <th>{content.account_dates_col}</th>
                      <th>{content.account_total_col}</th>
                      <th>{content.account_payment_col}</th>
                      <th><span className="sr-only">{content.account_actions_col}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td className="font-mono text-[0.72rem] font-bold">{booking.code}</td>
                        <td>{booking.vehicle?.name || content.account_rental_fallback}</td>
                        <td className="whitespace-nowrap text-[0.72rem] text-muted">{longDate(booking.startDate)} → {longDate(booking.endDate)}</td>
                        <td className="font-bold">{inr(booking.total)}</td>
                        <td><StatusPill status={bookingPaymentState(booking)} /></td>
                        <td className="text-right">
                          <Link to={`/confirmation/${booking.code}`} className="text-[0.7rem] font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">{content.account_open}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            ) : (
              <EmptyState icon={FileText} title={content.account_invoices_empty_title} description={content.account_invoices_empty_description} action={<Link to="/browse" className="btn btn-dark">{content.account_invoices_empty_cta}</Link>} />
            )}
          </section>
        )}

        {tab === 'saved' && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-extrabold tracking-tight">{content.account_saved_title}</h2>
              <p className="mt-1 text-xs text-muted">{content.account_saved_copy}</p>
            </div>
            {favoritesLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((item) => <Skeleton key={item} className="h-80" />)}
              </div>
            ) : favoritesError ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[0.72rem] font-semibold text-rose-800">
                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {content.account_saved_load_error}</span>
                <button type="button" onClick={loadFavorites} className="btn btn-white btn-sm">{content.account_load_error_cta}</button>
              </div>
            ) : favorites.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)}
              </div>
            ) : (
              <EmptyState icon={Heart} title={content.account_saved_empty_title} description={content.account_saved_empty_description} action={<Link to="/browse" className="btn btn-dark">{content.account_saved_empty_cta}</Link>} />
            )}
            {content.alerts_enabled !== false && (
              <div className="mt-6 border-t border-line pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold">{content.alert_scope}</h3>
                  {alerts.length > 0 && <span className="rounded-full bg-paper px-2.5 py-0.5 text-[0.6rem] font-extrabold text-muted">{alerts.length}</span>}
                </div>
                {alerts.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {alerts.map((alert) => (
                      <div key={alert.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
                        {alert.vehicle?.imageUrl ? (
                          <img src={alert.vehicle.imageUrl} alt="" className="h-12 w-16 rounded-lg object-cover" />
                        ) : (
                          <span className="flex h-12 w-16 items-center justify-center rounded-lg bg-sand"><BellPlus className="h-4 w-4 text-muted" /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.78rem] font-extrabold">{alert.vehicle?.name || content.account_rental_fallback}</p>
                          <p className="text-[0.62rem] text-muted">{shortDate(alert.startDate)} – {shortDate(alert.endDate)}</p>
                          {alert.freeNow ? (
                            <Link
                              to={`/vehicles/${alert.vehicleId}?from=${alert.startDate}&to=${alert.endDate}&alert=1`}
                              className="inline-flex min-h-6 items-center gap-1 text-[0.62rem] font-extrabold text-forest underline decoration-forest/30 underline-offset-2"
                            >
                              {content.alert_free_now} <ArrowRight className="h-3 w-3" />
                            </Link>
                          ) : alert.notified ? (
                            <p className="text-[0.6rem] font-bold text-forest">{content.alert_notified}</p>
                          ) : (
                            <p className="text-[0.6rem] text-muted">{content.alert_empty_copy}</p>
                          )}
                        </div>
                        <button type="button" onClick={() => removeAlert(alert.id)} aria-label={`${content.alert_remove} — ${alert.vehicle?.name}`} className="rounded-full p-1.5 text-muted transition hover:bg-rose-50 hover:text-rose-700">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[0.68rem] text-muted">{content.alert_empty_copy}</p>
                )}
              </div>
            )}
          </section>
        )}

        {tab === 'payments' && !bookingsError && (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section>
              <h2 className="text-lg font-extrabold tracking-tight">{content.account_payments_title}</h2>
              <p className="mt-1 text-xs text-muted">{content.account_payments_copy}</p>
              {user.cardLast4 ? (
                <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-ink p-5 text-cream">
                  <div className="flex items-center justify-between">
                    <CreditCard className="h-6 w-6 text-lime" />
                    <span className="text-[0.62rem] font-bold uppercase tracking-wider text-cream/50">{user.cardBrand || content.account_card_label}</span>
                  </div>
                  <p className="mt-8 font-mono text-xl tracking-[0.2em]">•••• •••• •••• {user.cardLast4}</p>
                  <div className="mt-5 flex items-center justify-between text-[0.62rem] text-cream/50">
                    <span>{user.name}</span>
                    <span>{content.account_expiry_note}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <EmptyState icon={CreditCard} title={content.account_payments_empty_title} description={content.account_payments_empty_description} action={<Link to="/browse" className="btn btn-dark btn-sm">{content.account_payments_empty_cta}</Link>} />
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-lime-deep bg-lime/20 p-4">
                <p className="flex items-center gap-1.5 text-[0.72rem] font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> {content.account_deposit_title}</p>
                <p className="mt-1 text-[0.65rem] leading-5 text-ink/65">{fill(content.account_deposit_copy, { deposit: inr(policy.holdAmount) })}</p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-extrabold tracking-tight">{content.account_transactions_title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'all', label: content.account_transactions_all },
                  { key: 'refunds', label: content.account_transactions_refunds },
                ].map((option) => {
                  const count = option.key === 'refunds'
                    ? payments.filter((payment) => payment.kind === 'refund').length
                    : payments.length;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setTxFilter(option.key)}
                      aria-pressed={txFilter === option.key}
                      className={cn(
                        'rounded-full px-3 py-1 text-[0.62rem] font-extrabold transition',
                        txFilter === option.key ? 'bg-ink text-cream' : 'border border-line bg-white text-muted hover:text-ink',
                      )}
                    >
                      {option.label} <span className={cn('ml-1', txFilter === option.key ? 'opacity-60' : 'text-muted')}>{count}</span>
                    </button>
                  );
                })}
              </div>
              {(() => {
                const shown = payments.filter((payment) => txFilter === 'all' || payment.kind === 'refund');
                return shown.length ? (
                <>
                  <TableScrollHint className="mt-3" />
                  <div className="table-wrap" role="region" aria-label={content.account_transactions_table_aria} tabIndex={0}>
                    <table className="data-table">
                    <thead>
                      <tr><th>{content.account_date_col}</th><th>{content.account_booking_col}</th><th>{content.account_type_col}</th><th className="text-right">{content.account_amount_col}</th></tr>
                    </thead>
                    <tbody>
                      {shown.map((payment) => {
                        const isRefund = payment.kind === 'refund';
                        return (
                          <tr key={payment.id}>
                            <td className="whitespace-nowrap text-[0.7rem] text-muted">{longDate(payment.createdAt)}</td>
                            <td className="font-mono text-[0.68rem]">{payment.bookingCode}</td>
                            <td>{payment.depositRefund
                              ? content.account_tx_deposit_refund
                              : `${paymentLabel[payment.kind] || payment.kind}${payment.kind !== 'hold' && payment.last4 ? ` · •••• ${payment.last4}` : ''}`}</td>
                            <td className={cn('whitespace-nowrap text-right font-bold', isRefund ? 'text-forest' : '')}>
                              {isRefund ? `−${inr(payment.amount)}` : inr(payment.amount)}
                              {isRefund && <span className="ml-1 text-[0.56rem] font-semibold text-muted">{content.account_refunded_tag}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </>
                ) : payments.length ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-10 text-center text-sm text-muted">{content.account_transactions_no_refunds}</p>
                ) : (
                  <p className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-10 text-center text-sm text-muted">{content.account_no_transactions}</p>
                );
              })()}
            </section>
          </div>
        )}

        {tab === 'notifications' && (
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">{content.account_notifications_title}</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">{content.account_notifications_copy}</p>
            </div>
            {notifications.some((item) => !item.readAt) && (
              <button type="button" onClick={markAllRead} className="btn btn-white btn-sm"><Check className="h-3.5 w-3.5" /> {content.account_mark_all_read}</button>
            )}
          </div>

          {notificationsLoading ? (
            <div className="mt-5 space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-stone-200/70" />)}</div>
          ) : notifications.length ? (
            <ul className="mt-5 divide-y divide-line">
              {notifications.map((item) => (
                <li key={item.id}>
                  {item.link ? (
                    <button
                      type="button"
                      onClick={() => openNotification(item)}
                      className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-paper',
                        !item.readAt && 'border-l-4 border-lime-deep bg-lime/8')}
                    >
                      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', item.readAt ? 'bg-stone-300' : 'bg-lime-deep')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.82rem] font-extrabold text-ink">{item.title}</span>
                        {item.body && <span className="mt-0.5 block text-[0.68rem] leading-5 text-muted">{item.body}</span>}
                        <span className="mt-1 block text-[0.58rem] font-bold text-muted/80">
                          {item.bookingCode ? `${item.bookingCode} · ` : ''}{longDate(item.createdAt)}
                        </span>
                      </span>
                      <ArrowRight className={cn('mt-1 h-3.5 w-3.5 shrink-0 text-muted', !item.readAt && 'text-forest')} />
                    </button>
                  ) : (
                    <div className={cn('flex items-start gap-3 px-3 py-3', !item.readAt && 'border-l-4 border-lime-deep bg-lime/8')}>
                      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', item.readAt ? 'bg-stone-300' : 'bg-lime-deep')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.82rem] font-extrabold text-ink">{item.title}</span>
                        {item.body && <span className="mt-0.5 block text-[0.68rem] leading-5 text-muted">{item.body}</span>}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-10 flex flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime/20 text-forest"><Bell className="h-6 w-6" /></span>
              <h3 className="mt-3 text-base font-extrabold">{content.account_notifications_empty_title}</h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-muted">{content.account_notifications_empty_description}</p>
            </div>
          )}
        </section>
      )}

      {tab === 'profile' && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <section className="rounded-3xl border border-line bg-white p-5 sm:p-6">
              <h2 className="text-lg font-extrabold tracking-tight">{content.account_profile_title}</h2>
              <p className="mt-1 text-xs text-muted">{content.account_profile_copy}</p>
              <form onSubmit={saveProfile} className="mt-5 space-y-3.5">
                <div>
                  <label className="label" htmlFor="acc-name">{content.account_full_name}</label>
                  <input
                    id="acc-name"
                    value={profile.name}
                    onChange={(event) => {
                      setProfile((current) => ({ ...current, name: event.target.value }));
                      if (profileError) { setProfileError(''); setProfileErrorField(''); }
                    }}
                    className="field"
                    aria-invalid={profileErrorField === 'name'}
                    aria-describedby={profileErrorField === 'name' ? 'acc-profile-error' : undefined}
                  />
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="acc-email">{content.account_email}</label>
                    <input id="acc-email" value={user.email} disabled className="field" />
                  </div>
                  <div>
                    <label className="label" htmlFor="acc-phone">{content.account_phone}</label>
                    <input
                      id="acc-phone"
                      value={profile.phone}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, phone: event.target.value }));
                        if (profileError) { setProfileError(''); setProfileErrorField(''); }
                      }}
                      className="field"
                      aria-invalid={profileErrorField === 'phone'}
                      aria-describedby={profileErrorField === 'phone' ? 'acc-profile-error' : undefined}
                    />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="acc-license">{content.account_license}</label>
                  <input
                    id="acc-license"
                    value={profile.licenseNumber}
                    onChange={(event) => {
                      setProfile((current) => ({ ...current, licenseNumber: event.target.value }));
                      if (profileError) { setProfileError(''); setProfileErrorField(''); }
                    }}
                    className="field"
                    placeholder={content.account_license_placeholder}
                    aria-invalid={profileErrorField === 'licenseNumber'}
                    aria-describedby={profileErrorField === 'licenseNumber' ? 'acc-profile-error' : undefined}
                  />
                </div>
                {profileError && (
                  <p id="acc-profile-error" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.7rem] font-semibold text-rose-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {profileError}
                  </p>
                )}
                <button type="submit" disabled={savingProfile} className="btn btn-dark">
                  {savingProfile ? content.account_saving : content.account_save}
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-line bg-white p-5">
              <h2 className="text-lg font-extrabold tracking-tight">{content.notif_title}</h2>
              <p className="mt-1 text-xs text-muted">{content.notif_description}</p>
              {notifPrefs ? (
                <div className="mt-4 space-y-2.5">
                  {NOTIFICATION_PREF_KEYS.map((key) => (
                    <div key={key} className="rounded-xl border border-line bg-paper p-3">
                      <Toggle
                        checked={Boolean(notifPrefs[key])}
                        onChange={(value) => setNotifPrefs((current) => ({ ...current, [key]: value }))}
                        label={content[`notif_${key}_label`]}
                        description={content[`notif_${key}_copy`]}
                      />
                    </div>
                  ))}
                  <button type="button" onClick={saveNotificationPrefs} disabled={savingPrefs} className="btn btn-dark mt-1.5">
                    {savingPrefs ? content.account_saving : content.account_save}
                  </button>
                </div>
              ) : (
                <div className="mt-4 h-20 animate-pulse rounded-2xl bg-stone-200/70" />
              )}
            </section>

            {/* Appearance ------------------------------------------------- */}
            <section className="rounded-3xl border border-line bg-white p-5">
              <h3 className="flex items-center gap-2 text-sm font-extrabold"><Moon className="h-4 w-4 text-forest" /> {content.account_appearance_title}</h3>
              <p className="mt-1 text-[0.68rem] leading-5 text-muted">{content.account_appearance_copy}</p>
              <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-paper px-3.5 py-2.5">
                <p className="text-[0.72rem] font-semibold">{content.account_dark_mode_label}</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={darkMode}
                  onClick={toggleDarkMode}
                  className={cn(
                    'relative h-6 w-11 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest',
                    darkMode ? 'bg-ink' : 'bg-stone-300'
                  )}
                >
                  <span className={cn('block h-5 w-5 rounded-full bg-white transition-transform', darkMode && 'translate-x-5')} />
                </button>
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-3xl border border-line bg-white p-5">
                <h3 className="text-sm font-extrabold">{content.account_account_title}</h3>
                <p className="mt-1 text-[0.68rem] leading-5 text-muted">{fill(content.account_signed_in_copy, { email: user.email, role: roleLabel[user.role] || content.account_customer_role })}</p>
                <div className="mt-4 grid gap-2">
                  <button type="button" onClick={handleSignOut} className="btn btn-outline w-full"><LogOut className="h-4 w-4" /> {content.account_sign_out}</button>
                  {isDemo && api.resetDemoData && (
                    <button type="button" onClick={resetDemo} disabled={resettingDemo} className="btn btn-ghost w-full text-rose-700"><RefreshCw className="h-4 w-4" /> {resettingDemo ? content.account_saving : content.account_reset_demo}</button>
                  )}
                </div>
              </section>
              <section className="rounded-3xl border border-line bg-white p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand text-forest"><FileText className="h-4 w-4" /></span>
                  <div>
                    <h3 className="text-sm font-extrabold">{content.account_data_title}</h3>
                    <p className="mt-1 text-[0.68rem] leading-5 text-muted">{content.account_data_copy}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={downloadData} className="btn btn-dark flex-1"><Download className="h-4 w-4" /> {content.account_download_data}</button>
                  <Link to={`/contact?message=${encodeURIComponent(content.account_deletion_message)}`} className="btn btn-ghost flex-1 text-rose-700">{content.account_request_deletion}</Link>
                </div>
                <p className="mt-2 text-[0.6rem] leading-4 text-muted">{content.account_data_note}</p>
              </section>
              <section id="licence" className="scroll-mt-24 rounded-3xl border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand text-forest"><IdCard className="h-4 w-4" /></span>
                    <div>
                      <h3 className="text-sm font-extrabold">{content.account_licence_title}</h3>
                      <p className="mt-1 text-[0.68rem] leading-5 text-muted">{content.account_licence_copy}</p>
                    </div>
                  </div>
                  {user.licenceVerified
                    ? <StatusPill status="confirmed" label="Verified" className="shrink-0" />
                    : user.licenceUrl && <StatusPill status="pending" label="In review" className="shrink-0" />}
                </div>

                {user.licenceVerified ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-[0.7rem] leading-5 text-emerald-900">
                    <p className="flex items-center gap-1.5 font-extrabold"><ShieldCheck className="h-4 w-4" /> {content.account_licence_verified_title}</p>
                    <p className="mt-1">{content.account_licence_verified_copy}</p>
                  </div>
                ) : (
                  <>
                    {user.licenceUrl && (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-[0.7rem] leading-5 text-amber-900">
                        <p className="font-extrabold">{content.account_licence_have_title}</p>
                        <p className="mt-1">{content.account_licence_have_copy}</p>
                      </div>
                    )}
                    <input
                      id="acc-licence-file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={pickLicence}
                    />
                    <div className="mt-4 overflow-hidden rounded-2xl border border-dashed border-stone-300 bg-paper">
                      {licencePreview ? (
                        <img src={licencePreview} alt={content.account_licence_preview_alt} className="h-32 w-full object-cover" />
                      ) : (
                        <div className="flex h-24 flex-col items-center justify-center gap-1 text-muted">
                          <IdCard className="h-6 w-6 text-forest" />
                          <p className="text-[0.68rem] font-semibold">{content.account_licence_none}</p>
                        </div>
                      )}
                    </div>
                    {licenceFile && (
                      <p className="mt-2 truncate text-[0.66rem] font-semibold text-muted">{licenceFile.name}</p>
                    )}
                    {licenceError && <p className="mt-2 text-[0.7rem] font-semibold text-rose-700">{licenceError}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label htmlFor="acc-licence-file" className="btn btn-outline btn-sm cursor-pointer">
                        <Upload className="h-3.5 w-3.5" /> {licenceFile ? content.account_licence_choose_another : content.account_licence_choose}
                      </label>
                      {licenceFile && (
                        <button type="button" onClick={verifyLicence} disabled={licenceUploading} className="btn btn-dark btn-sm">
                          {licenceUploading ? content.account_licence_uploading : content.account_licence_upload}
                        </button>
                      )}
                    </div>
                    <p className="mt-3 text-[0.65rem] leading-5 text-muted">{content.account_licence_note}</p>
                  </>
                )}
              </section>

              <section className="rounded-3xl border border-line bg-paper p-5">
                <p className="flex items-center gap-2 text-[0.72rem] font-extrabold"><FileText className="h-4 w-4 text-forest" /> {content.account_documents_title}</p>
                <ul className="mt-3 space-y-2 text-[0.68rem] text-muted">
                  <li className="flex items-center justify-between"><span>{content.account_doc_photo}</span><span className="font-bold text-ink">{user.licenceVerified ? content.account_verified : content.account_at_pickup}</span></li>
                  <li className="flex items-center justify-between"><span>{content.account_doc_licence}</span><span className="font-bold text-ink">{user.licenceVerified ? content.account_verified : user.licenceUrl ? content.account_in_review : profile.licenseNumber ? content.account_number_on_file : content.account_not_added}</span></li>
                  <li className="flex items-center justify-between"><span>{content.account_doc_card}</span><span className="font-bold text-ink">{user.cardLast4 ? `•••• ${user.cardLast4}` : content.account_at_checkout}</span></li>
                </ul>
              </section>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => {
          if (busy) return;
          setCancelTarget(null);
          setCancelReason('');
        }}
        title={content.manage_cancel_modal_title}
        description={fill(content.manage_cancel_modal_description, { policy: policy.cancellationSummary })}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => { setCancelTarget(null); setCancelReason(''); }} disabled={busy} className="btn btn-white flex-1">{content.manage_keep_booking}</button>
            <button type="button" onClick={cancelBooking} disabled={busy} className="btn btn-dark flex-1">{busy ? content.manage_cancelling : content.manage_cancel_confirm}</button>
          </div>
        )}
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[0.72rem] leading-6 text-amber-900">
          <p className="font-extrabold">{content.manage_refund_estimate}</p>
          <p className="mt-1">
            {!cancelTarget?.amountPaid
              ? content.manage_refund_none
              : cancelRefund && !cancelRefund.insideWindow
                ? fill(content.manage_refund_full, { window: policy.windowLabel, amount: inr(cancelRefund.refundAmount) })
                : fill(content.manage_refund_partial, {
                  window: policy.windowLabel,
                  percent: cancelRefund?.percent ?? policy.refundPercent,
                  amount: inr(cancelRefund?.refundAmount ?? 0),
                })}
          </p>
          <p className="mt-1 text-[0.62rem] text-amber-900/70">{content.manage_refund_note}</p>
        </div>
        <p className="mt-3 text-[0.68rem] text-muted">{content.manage_booking_prefix} <span className="font-mono font-bold text-ink">{cancelTarget?.code}</span> · {cancelTarget?.vehicle?.name}</p>
        <div className="mt-4">
          <label className="label" htmlFor="account-cancel-reason">{content.manage_reason_label} <span className="font-medium normal-case tracking-normal text-muted">{content.manage_optional}</span></label>
          <textarea id="account-cancel-reason" rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="field resize-none" placeholder={content.manage_reason_placeholder} maxLength={300} />
        </div>
      </Modal>

      <ReviewModal target={reviewTarget} busy={busy} content={content} onClose={() => setReviewTarget(null)} onSubmit={submitReview} />

      <ChangeBookingModal
        booking={changeTarget}
        open={Boolean(changeTarget)}
        onClose={() => setChangeTarget(null)}
        onChanged={() => { setChangeTarget(null); loadBookings(); }}
      />
      <ExtendTripModal
        booking={extendTarget}
        open={Boolean(extendTarget)}
        onClose={() => setExtendTarget(null)}
        onExtended={() => { setExtendTarget(null); loadBookings(); }}
      />
    </div>
  );
}

const DEPOSIT_TONES = {
  refunded: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  released: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  deducted: 'border border-amber-200 bg-amber-50 text-amber-900',
  extra: 'border border-rose-200 bg-rose-50 text-rose-700',
  held: 'border border-line bg-paper text-muted',
  awaiting: 'border border-amber-200 bg-amber-50 text-amber-900',
  due: 'border border-sun/40 bg-sun/15 text-ink',
};

function TripCard({ booking, content, onCancel, onReview, onChange, onExtend, past }) {
  const total = booking.total || 0;
  const km = kmDisclosure({
    kmCap: booking.kmCap ?? booking.vehicle?.kmCap,
    kmExtraRate: booking.kmExtraRate ?? booking.vehicle?.kmExtraRate,
  });
  const canChange = !past
    && content.change_request_enabled
    && ['pending', 'confirmed'].includes(booking.status)
    && Boolean(booking.vehicle?.id);
  const canExtend = booking.status === 'active'
    && content.extensions_enabled
    && Boolean(booking.vehicle?.id);
  const countdown = tripCountdown(booking);
  const countdownLabel = countdown
    ? content[`countdown_${countdown.labelHint}`]
      .replace('{days}', countdown.days ? String(countdown.days) : '')
      .replace('{time}', countdown.time || '10:00')
    : '';
  const deposit = depositOutcome(booking);
  const depositChip = deposit
    ? {
      ...deposit,
      label: content[`account_deposit_${deposit.key}`].replace('{amount}', inr(deposit.amount)),
      tone: DEPOSIT_TONES[deposit.key],
    }
    : null;
  // Same rule the desk enforces: a licence that expires inside the rental is a
  // handover blocker, so the customer should not read about it first at pick-up.
  const licenceWarn = !past && ['confirmed', 'pending', 'active'].includes(booking.status)
    ? licenceExpiryProblem(booking.driver ?? {}, { endDate: booking.endDate }, { policy: content.policy })
    : null;
  const changePending = booking.changeRequest?.status === 'pending';
  // "Book again" re-opens the same vehicle. Keep the customer's remembered
  // trip when they have one (explicit intent), else fall back to the hubs and
  // times this booking actually used — a rebook means "the same, please".
  const bookAgainHref = (() => {
    if (!past || !booking.vehicle?.id) return null;
    const base = `/vehicles/${booking.vehicle.id}`;
    const remembered = content.remember_trip_enabled ? readRememberedTrip() : null;
    const params = new URLSearchParams();
    const location = remembered?.location || booking.pickupLocation || '';
    const dropoff = remembered?.dropoff || booking.dropoffLocation || location;
    if (location) params.set('pickup', location);
    if (dropoff) params.set('dropoff', dropoff);
    const pickupTime = remembered?.pickupTime || booking.pickupTime;
    const dropoffTime = remembered?.dropoffTime || booking.dropoffTime;
    if (pickupTime) params.set('pickupTime', pickupTime);
    if (dropoffTime) params.set('dropoffTime', dropoffTime);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  })();
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-white shadow-card transition hover:shadow-lift">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {booking.vehicle?.imageUrl ? (
            <img src={booking.vehicle.imageUrl} alt={booking.vehicle.name} className="h-20 w-28 shrink-0 rounded-2xl object-cover" />
          ) : (
            <span className="flex h-20 w-28 shrink-0 items-center justify-center rounded-2xl bg-sand"><Car className="h-6 w-6 text-muted" /></span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={booking.status} />
              {changePending && (
                <span className="inline-flex items-center gap-1 rounded-full border border-sun/30 bg-sun/15 px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-ink">
                  <CalendarRange className="h-3 w-3" /> {content.amend_pending}
                </span>
              )}
              {km.limited && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">
                  <Gauge className="h-3 w-3" /> {content.account_km_chip.replace('{km}', km.kmCap.toLocaleString('en-IN'))}
                </span>
              )}
              {countdown && (
                <span className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-wider',
                  countdown.key === 'overdue' ? 'border border-coral/30 bg-coral/15 text-ink' : 'border border-line bg-paper text-muted',
                )}>
                  <Clock className={cn('h-3 w-3', countdown.key === 'overdue' ? 'text-coral' : 'text-moss')} /> {countdownLabel}
                </span>
              )}
              {licenceWarn && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[0.58rem] font-extrabold text-amber-900"
                  title={licenceWarn}
                >
                  <ShieldCheck className="h-3 w-3" /> {content.trip_licence_warn}
                </span>
              )}
              {depositChip && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-wider', depositChip.tone)}>
                  <ShieldCheck className="h-3 w-3" /> {depositChip.label}
                </span>
              )}
              <span className="font-mono text-[0.62rem] text-muted">{booking.code}</span>
            </div>
            <h3 className="mt-1.5 truncate text-[0.95rem] font-extrabold tracking-tight">{booking.vehicle?.name || content.account_rental_fallback}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.68rem] text-muted">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {longDate(booking.startDate)} – {longDate(booking.endDate)}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {booking.pickupLocation}</span>
            </p>
            <p className="mt-1 text-[0.68rem] text-muted">{timeLabel(booking.pickupTime)} {content.account_pickup_suffix} · {booking.days} {booking.days === 1 ? content.account_days_singular : content.account_days_plural} · {booking.insurance?.label}</p>
            {changePending && booking.changeRequest && (
              <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-sun/10 px-2 py-1 text-[0.64rem] font-semibold text-ink">
                <CalendarRange className="h-3 w-3 shrink-0" />
                {content.amend_pending_card.replace('{range}', `${shortDate(booking.changeRequest.startDate)} – ${shortDate(booking.changeRequest.endDate)}`)}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className="text-left sm:text-right">
            <p className="text-[0.58rem] font-bold uppercase tracking-wider text-muted">{content.account_total_col}</p>
            <p className="text-base font-extrabold">{inr(total)}</p>
            <p className="text-[0.62rem] text-muted">{bookingPaymentSummary(booking)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {canChange && (
              <button type="button" onClick={() => onChange(booking)} className={cn('btn btn-ghost btn-sm', changePending && 'border-sun/40 text-forest')}>
                <CalendarRange className="h-3.5 w-3.5" /> {changePending ? content.amend_pending : content.amend_change_button}
              </button>
            )}
            {canExtend && (
              <button type="button" onClick={() => onExtend(booking)} className="btn btn-ghost btn-sm text-moss" aria-label={content.extend_extension_aria}>
                <Clock className="h-3.5 w-3.5" /> {content.extend_extension_chip}
              </button>
            )}
            <Link to={`/confirmation/${booking.code}`} className="btn btn-white btn-sm">{content.account_voucher}</Link>
            <Link to={`/contact?booking=${booking.code}`} className="btn btn-ghost btn-sm"><LifeBuoy className="h-3.5 w-3.5" /> {content.account_trip_support}</Link>
            {past && booking.vehicle?.id && (
              <Link to={bookAgainHref} className="btn btn-ghost btn-sm"><RefreshCw className="h-3.5 w-3.5" /> {content.account_book_again}</Link>
            )}
            {['pending', 'confirmed', 'active'].includes(booking.status) && (
              <button type="button" onClick={() => downloadBookingICS(booking, {
                fallbackName: content.confirmation_vehicle_fallback,
                pickupTitle: content.confirmation_calendar_pickup_title,
                dropoffTitle: content.confirmation_calendar_dropoff_title,
                pickupNote: content.confirmation_calendar_pickup_note,
                dropoffNote: content.confirmation_calendar_dropoff_note,
              })} className="btn btn-ghost btn-sm">
                <CalendarPlus className="h-3.5 w-3.5" /> {content.account_add_calendar}
              </button>
            )}
            {booking.canCancel && <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm text-rose-700">{content.account_cancel}</button>}
            {booking.canReview && <button type="button" onClick={onReview} className="btn btn-lime btn-sm"><Star className="h-3.5 w-3.5" /> {content.account_review}</button>}
            {past && booking.reviewed && <span className="inline-flex items-center gap-1 text-[0.62rem] font-bold text-forest"><Check className="h-3 w-3" /> {content.account_reviewed}</span>}
          </div>
        </div>
      </div>
      {booking.status === 'active' && (
        <LateMeter booking={booking} content={content} policy={content.policy} canExtend={canExtend} variant="strip" />
      )}
    </article>
  );
}

function ReviewModal({ target, busy, content, onClose, onSubmit }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const commentRef = useRef(null);

  useEffect(() => {
    if (target) { setRating(5); setComment(''); setError(''); }
  }, [target]);

  const submit = (event) => {
    event.preventDefault();
    if (comment.trim().length < 3) {
      setError(content.account_review_error);
      commentRef.current?.focus();
      return;
    }
    onSubmit({ rating, comment: comment.trim() });
  };

  return (
    <Modal open={Boolean(target)} onClose={busy ? () => {} : onClose} title={content.account_review_modal_title} description={target?.vehicle?.name} size="sm">
      <form onSubmit={submit} noValidate>
        <div className="flex items-center gap-2" role="group" aria-label={content.account_review_rating_label}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-pressed={rating === star}
              aria-label={(star === 1 ? content.account_review_star_aria : content.account_review_star_aria_plural).replaceAll('{count}', star)}
            >
              <Star className={`h-7 w-7 transition ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'}`} />
            </button>
          ))}
          <span className="ml-2 text-sm font-extrabold" aria-live="polite">{[content.account_rating_terrible, content.account_rating_poor, content.account_rating_okay, content.account_rating_good, content.account_rating_excellent][rating - 1]}</span>
        </div>
        <div className="mt-4">
          <label className="label" htmlFor="review-comment">{content.account_review_label}</label>
          <textarea
            ref={commentRef}
            id="review-comment"
            rows={4}
            value={comment}
            onChange={(event) => { setComment(event.target.value); setError(''); }}
            className="field resize-none"
            placeholder={content.account_review_placeholder}
            maxLength={600}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'review-comment-error' : undefined}
          />
        </div>
        {error && (
          <p id="review-comment-error" role="alert" className="mt-2 flex items-center gap-1.5 text-[0.68rem] font-semibold text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> {error}</p>
        )}
        <button type="submit" disabled={busy} className="btn btn-lime mt-4 w-full">{busy ? content.account_review_posting : content.account_review_post}</button>
      </form>
    </Modal>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[1, 2].map((item) => (
        <div key={item} className="rounded-3xl border border-line bg-white p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-28" />
            <div className="flex-1 space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/5" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}
