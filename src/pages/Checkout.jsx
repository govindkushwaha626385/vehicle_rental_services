import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, CreditCard, LockKeyhole,
  MapPin, ShieldCheck, Tag, Zap,
} from 'lucide-react';
import PaymentSheet from '../components/PaymentSheet.jsx';
import { PageLoader, Skeleton, Spinner, Stars } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, isDemo } from '../lib/api.js';
import { loadRazorpay, openRazorpay } from '../lib/razorpay.js';
import { RENTAL_TIMES as TIMES, addDaysISO, ageFromDob, isValidDate, todayISO } from '../lib/pricing.js';
import { cn, inr, longDate, timeLabel } from '../lib/format.js';
import { getSiteContent, lateFeeTermsText, maxAdvanceDate, tripProblem } from '../lib/site.js';
import { isEmail, licenceExpiryProblem, phoneProblem } from '../lib/validation.js';
import { kmAllowance, kmDisclosure } from '../lib/km.js';

export default function Checkout() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { meta, loading: metaLoading } = useMeta();
  const { user, loading: authLoading, isDemo: demoMode } = useAuth();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const steps = useMemo(() => [
    { number: 1, label: content.checkout_step_trip_label, copy: content.checkout_step_trip_copy },
    { number: 2, label: content.checkout_step_extras_label, copy: content.checkout_step_extras_copy },
    { number: 3, label: content.checkout_step_driver_label, copy: content.checkout_step_driver_copy },
    { number: 4, label: content.checkout_step_payment_label, copy: content.checkout_step_payment_copy },
  ], [content]);
  const taxLabel = String(meta.settings?.tax_label || 'GST').trim() || 'GST';
  const autoConfirm = meta.settings?.booking_auto_confirm !== 'false';
  const policy = content.policy;

  const vehicleId = params.get('vehicle') || '';
  const [vehicle, setVehicle] = useState(null);
  const [loadingVehicle, setLoadingVehicle] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [step, setStep] = useState(1);
  const [trip, setTrip] = useState(() => {
    const fallbackFrom = addDaysISO(todayISO(), 2);
    const dateProblem = tripProblem(params.get('from'), params.get('to'), meta.settings);
    return {
      from: dateProblem ? fallbackFrom : params.get('from'),
      to: dateProblem ? addDaysISO(fallbackFrom, Math.max(3, policy.minDays)) : params.get('to'),
      pickup: params.get('pickup') || '',
      dropoff: params.get('dropoff') || '',
      pickupTime: TIMES.includes(params.get('pickupTime')) ? params.get('pickupTime') : '10:00',
      dropoffTime: TIMES.includes(params.get('dropoffTime')) ? params.get('dropoffTime') : '10:00',
    };
  });

  const [extras, setExtras] = useState([]);
  const [insurance, setInsurance] = useState('standard');
  const [paymentPlan, setPaymentPlan] = useState('full');

  useEffect(() => {
    const keys = meta.insuranceTiers.map((tier) => tier.key);
    if (!keys.length) return;
    setInsurance((current) => (
      keys.includes(current) ? current : (keys.includes('standard') ? 'standard' : keys[0])
    ));
  }, [meta.insuranceTiers]);
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState('');
  const [promoError, setPromoError] = useState('');

  const [driver, setDriver] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    license: user?.licenseNumber || '',
    dob: '',
    licenseExpiry: '',
  });
  const [notes, setNotes] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedLicense, setAgreedLicense] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [quoteError, setQuoteError] = useState('');
  const [available, setAvailable] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState('');

  const [paying, setPaying] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const draftRef = useRef(null);
  const payLockRef = useRef(false);
  const returnPath = `/checkout?${params.toString()}`;

  useEffect(() => {
    if (user) {
      setDriver((current) => ({
        ...current,
        name: current.name || user.name || '',
        email: current.email || user.email || '',
        phone: current.phone || user.phone || '',
        license: current.license || user.licenseNumber || '',
      }));
    }
  }, [user]);

  useEffect(() => {
    if (!vehicleId) {
      setLoadingVehicle(false);
      setLoadError('No vehicle was selected. Start by choosing one from the fleet.');
      return;
    }
    let alive = true;
    setLoadingVehicle(true);
    api.getVehicle(vehicleId)
      .then((result) => {
        if (!alive) return;
        setVehicle(result.vehicle);
        setTrip((current) => ({
          ...current,
          pickup: current.pickup || result.vehicle.location,
          dropoff: current.dropoff || result.vehicle.location,
        }));
      })
      .catch((nextError) => { if (alive) setLoadError(nextError.message); })
      .finally(() => { if (alive) setLoadingVehicle(false); });
    return () => { alive = false; };
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicle) return undefined;
    let alive = true;
    setQuoteLoading(true);
    setQuoteError('');
    const dateProblem = tripProblem(trip.from, trip.to, meta.settings);
    if (dateProblem) {
      setQuote(null);
      setAvailable(false);
      setUnavailableReason(dateProblem);
      setQuoteLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.quote({
          vehicleId: vehicle.id,
          startDate: trip.from,
          endDate: trip.to,
          extras,
          insurance,
          promoCode: appliedPromo || null,
          pickupLocation: trip.pickup,
          dropoffLocation: trip.dropoff,
          paymentPlan,
        });
        if (!alive) return;
        setQuote(result.quote);
        setAvailable(result.available);
        setUnavailableReason(result.unavailableReason || '');
        // Do not clear promoError here: rejecting a code clears appliedPromo,
        // which immediately re-quotes without it — the successful re-quote used
        // to erase the explanation before anyone could read it.
      } catch (nextError) {
        if (!alive) return;
        const message = nextError.message || 'Something went wrong.';
        // Only a real promo-validation failure clears the code. A transient
        // network hiccup must not silently drop the customer's discount.
        if (appliedPromo && /promo/i.test(message)) {
          setPromoError(message);
          setAppliedPromo('');
        } else {
          setQuoteError(message);
        }
      } finally {
        if (alive) setQuoteLoading(false);
      }
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [vehicle, meta.settings, trip.from, trip.to, trip.pickup, trip.dropoff, extras, insurance, paymentPlan, appliedPromo]);

  useEffect(() => {
    const quotedTier = quote?.insurance?.key;
    if (!quotedTier) return;
    setInsurance((current) => (current === quotedTier ? current : quotedTier));
  }, [quote?.insurance?.key]);

  const clearTripErrors = () => setFieldErrors((current) => {
    if (!('trip' in current) && !('hubs' in current)) return current;
    const nextErrors = { ...current };
    delete nextErrors.trip;
    delete nextErrors.hubs;
    return nextErrors;
  });
  const setTripValue = (key, value) => {
    setTrip((current) => ({ ...current, [key]: value }));
    clearTripErrors();
  };
  const setDriverValue = (key, value) => {
    setDriver((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const nextErrors = { ...current };
      delete nextErrors[key];
      return nextErrors;
    });
  };
  const toggleExtra = (key) => setExtras((current) => (
    current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  ));

  const applyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) {
      push('Enter a promo code first.', 'error');
      return;
    }
    setPromoError('');
    setAppliedPromo(code);
  };

  const removePromo = () => {
    setAppliedPromo('');
    setPromoInput('');
    setPromoError('');
  };

  const validateStepOne = () => {
    const errors = {};
    if (!trip.pickup || !trip.dropoff) errors.hubs = 'Choose your pick-up and drop-off hubs.';
    else if (policy.oneWayEnabled === false && trip.pickup !== trip.dropoff) {
      errors.hubs = content.checkout_one_way_off;
    }
    const problem = tripProblem(trip.from, trip.to, meta.settings);
    if (problem) errors.trip = problem;
    return errors;
  };

  const validateDriver = () => {
    const errors = {};
    if (!driver.name || driver.name.trim().length < 2) errors.name = 'Enter the full name on the licence.';
    if (!isEmail(driver.email)) errors.email = 'Enter a valid email address.';
    const phoneError = phoneProblem(driver.phone, { required: true });
    if (phoneError) errors.phone = phoneError;
    if (!driver.license || driver.license.trim().length < 4) errors.license = 'Enter a valid licence number.';
    if (!isValidDate(driver.dob || '')) errors.dob = 'Enter the driver date of birth.';
    else {
      const age = ageFromDob(driver.dob);
      const bike = vehicle?.kind === 'bike';
      const minAge = Math.max(
        bike ? policy.minBikeAge : policy.minAge,
        Number(vehicle?.minAge) || 0,
      );
      if (age < minAge) errors.dob = `${bike ? 'Riders' : 'Drivers'} must be at least ${minAge}.`;
      else if (age > 85) errors.dob = 'Please contact us directly for drivers over 85.';
    }
    if (!agreedTerms) errors.terms = 'Please accept the rental terms.';
    if (!agreedLicense) errors.licenseAgree = 'Please confirm the licence verification notice.';
    const licenceProblem = licenceExpiryProblem(
      driver,
      { endDate: trip.to },
      { policy },
    );
    if (licenceProblem) errors.licenseExpiry = licenceProblem;
    return errors;
  };

  // The wizard validates on the way forward, so the cursor has to land on the
  // field that blocked it — a red border far below the fold is easy to miss.
  const fieldIds = {
    hubs: 'co-pickup',
    trip: 'co-from',
    name: 'driver-name',
    email: 'driver-email',
    phone: 'driver-phone',
    license: 'driver-license',
    dob: 'driver-dob',
    licenseExpiry: 'driver-license-expiry',
    terms: 'checkout-terms',
    licenseAgree: 'checkout-licence',
  };
  const focusFirstError = (errors) => {
    const key = Object.keys(errors)[0];
    const field = key ? document.getElementById(fieldIds[key]) : null;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const next = () => {
    if (step === 1) {
      const errors = validateStepOne();
      if (Object.keys(errors).length) {
        flushSync(() => setFieldErrors(errors));
        focusFirstError(errors);
        push(errors.hubs || errors.trip, 'error');
        return;
      }
    }
    if (step === 3) {
      const errors = validateDriver();
      if (Object.keys(errors).length) {
        flushSync(() => setFieldErrors(errors));
        focusFirstError(errors);
        return;
      }
    }
    setStep((current) => Math.min(4, current + 1));
  };

  const buildDraft = () => ({
    vehicleId: vehicle.id,
    startDate: trip.from,
    endDate: trip.to,
    pickupTime: trip.pickupTime,
    dropoffTime: trip.dropoffTime,
    pickupLocation: trip.pickup,
    dropoffLocation: trip.dropoff,
    extras,
    insurance,
    promoCode: quote?.promoApplied?.code || '',
    paymentPlan,
    notes,
    driver,
    agreedTerms,
    agreedLicense,
  });

  const finalize = async (payment) => {
    const result = await api.confirmPayment({ draft: draftRef.current, payment });
    // Private-mode browsers can refuse sessionStorage; the confirmation page
    // re-fetches the booking by code, so this is only a convenience cache.
    try {
      sessionStorage.setItem('rove:last-email', draftRef.current.driver.email);
      sessionStorage.setItem('rove:last-code', result.code);
    } catch {
      // ignore unavailable storage
    }
    navigate(`/confirmation/${result.code}`, { replace: true });
  };

  const releasePayLock = () => {
    payLockRef.current = false;
    setPaying(false);
  };

  const closePayment = () => {
    setPaymentOpen(false);
    releasePayLock();
  };

  const pay = async () => {
    if (payLockRef.current) return;
    if (!quote || !available) {
      push('Those dates are not available. Please change your trip.', 'error');
      return;
    }
    if (!content.guest_checkout_enabled && !user) {
      push('Please sign in to complete this booking.', 'error');
      navigate(`/login?redirect=${encodeURIComponent(returnPath)}`);
      return;
    }
    const driverErrors = validateDriver();
    if (Object.keys(driverErrors).length) {
      flushSync(() => {
        setFieldErrors(driverErrors);
        setStep(3);
      });
      focusFirstError(driverErrors);
      return;
    }
    payLockRef.current = true;
    setPaying(true);
    try {
      const draft = buildDraft();
      draftRef.current = draft;
      const order = await api.beginPayment(draft);

      if (demoMode) {
        if (order.quote) setQuote(order.quote);
        setPaying(false);
        setPaymentOpen(true);
        return;
      }

      await loadRazorpay();
      openRazorpay({
        keyId: order.keyId,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: draft.driver.name,
        email: draft.driver.email,
        phone: draft.driver.phone,
        description: `${vehicle.name} · ${quote.days} days`,
        onSuccess: async (response) => {
          setPaying(true);
          try {
            await finalize(response);
          } catch (firstError) {
            // A network drop or 5xx can hide a successful server response. Retrying
            // the same payment is safe because razorpay-verify is idempotent.
            if (firstError.status === undefined || firstError.status >= 500) {
              try {
                await new Promise((resolve) => setTimeout(resolve, 1200));
                await finalize(response);
                return;
              } catch (retryError) {
                push(retryError.message, 'error');
                releasePayLock();
                return;
              }
            }
            push(firstError.message, 'error');
            releasePayLock();
          }
        },
        onDismiss: (message) => {
          releasePayLock();
          if (message) push(message, 'error');
        },
      });
    } catch (nextError) {
      push(nextError.message, 'error');
      releasePayLock();
    }
  };

  const summary = useMemo(() => quote ?? null, [quote]);

  if (loadingVehicle || authLoading) return <PageLoader label="Preparing your checkout…" />;

  if (!metaLoading && !user && !content.guest_checkout_enabled) {
    return (
      <div className="container-x py-20">
        <div className="mx-auto max-w-lg rounded-3xl border border-line bg-white p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lime text-ink"><LockKeyhole className="h-5 w-5" /></span>
          <h1 className="display mt-4 text-3xl">{content.checkout_signin_title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{content.checkout_signin_copy}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to={`/login?redirect=${encodeURIComponent(returnPath)}`} className="btn btn-dark">{content.checkout_signin_cta} <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/browse" className="btn btn-outline">{content.checkout_browse_cta}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !vehicle) {
    return (
      <div className="container-x py-20">
        <div className="mx-auto max-w-lg rounded-3xl border border-line bg-white p-8 text-center">
          <h1 className="display text-3xl">{content.checkout_need_vehicle_title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{loadError || content.checkout_no_vehicle_copy}</p>
          <Link to="/browse" className="btn btn-dark mt-6">{content.checkout_browse_cta} <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
    );
  }

  const guardPrice = quote?.amountDue ?? vehicle.pricePerDay;
  const km = kmDisclosure(vehicle);
  const kmTotal = kmAllowance({ kmCap: km.kmCap, days: quote?.days });
  const canPay = Boolean(quote && available && !quoteLoading && !quoteError && !paying);
  const minDriverAge = Math.max(
    vehicle.kind === 'bike' ? policy.minBikeAge : policy.minAge,
    Number(vehicle.minAge) || 0,
  );
  const oneWayFee = quote?.oneWayFee ?? policy.oneWayFee;

  return (
    <div className="pb-28 lg:pb-20">
      <div className="relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-lime/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-64 w-64 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="container-x relative py-6 sm:py-8">
          <Link to={`/vehicles/${vehicle.id}`} className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold text-muted transition hover:text-ink">
            <ChevronLeft className="h-3.5 w-3.5" /> {content.checkout_back_to_vehicle} {vehicle.name}
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">{content.checkout_title}</h1>
              <p className="mt-1 text-sm text-muted">
                {autoConfirm
                  ? content.checkout_description_instant
                  : content.checkout_description_review}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {demoMode && <span className="rounded-full bg-lime px-2.5 py-1 text-[0.6rem] font-extrabold uppercase tracking-wider">{content.checkout_demo_badge}</span>}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[0.62rem] font-bold text-muted">
                <LockKeyhole className="h-3 w-3" /> {content.checkout_secure}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="container-x mt-7 grid gap-6 lg:grid-cols-[1fr_22.5rem]">
        <div className="min-w-0">
          {/* Stepper */}
          <div className="no-scrollbar mb-4 flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/80 bg-white/80 p-1.5 shadow-[0_12px_32px_-32px_rgba(10,15,11,0.5)] backdrop-blur-sm">
            {steps.map((item) => {
              const complete = step > item.number;
              const current = step === item.number;
              return (
                <button
                  key={item.number}
                  type="button"
                  onClick={() => { if (item.number < step) setStep(item.number); }}
                  disabled={item.number > step}
                  aria-label={`Step ${item.number}: ${item.label} — ${item.copy}`}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-left transition sm:justify-start sm:px-3',
                    current ? 'bg-gradient-to-r from-ink to-forest text-cream shadow-[0_10px_24px_-18px_rgba(10,15,11,0.65)]' : complete ? 'bg-lime/25 text-ink' : 'text-muted hover:bg-white hover:text-ink'
                  )}
                >
                  <span className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.62rem] font-extrabold',
                    current ? 'bg-lime text-ink' : complete ? 'bg-ink text-lime' : 'bg-stone-100 text-muted'
                  )}>
                    {complete ? <Check className="h-3 w-3" /> : item.number}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className="block truncate text-[0.7rem] font-extrabold">{item.label}</span>
                    <span className={cn('block truncate text-[0.58rem]', current ? 'text-cream/50' : 'text-muted')}>{item.copy}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-3xl border border-line bg-white/95 p-5 shadow-card backdrop-blur-sm sm:p-6">
            {step === 1 && (
              <div>
                <p className="eyebrow">{content.checkout_step_prefix} 1 {content.checkout_step_total}</p>
                <h2 className="mt-1.5 text-xl font-extrabold tracking-tight">{content.checkout_trip_title}</h2>
                <p className="mt-1 text-xs leading-5 text-muted">{content.checkout_trip_copy}</p>

                <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-paper p-3">
                  <img src={vehicle.imageUrl} alt={vehicle.name} className="h-16 w-24 rounded-xl object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{vehicle.name}</p>
                    <p className="truncate text-[0.68rem] text-muted">{vehicle.type} · {vehicle.transmission} · {vehicle.seats} seats</p>
                    <Stars value={vehicle.rating} count={vehicle.reviewCount} className="mt-1" />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="co-from">{content.checkout_label_pickup_date}</label>
                    <div className="flex gap-2">
                      <input
                        id="co-from"
                        type="date"
                        min={todayISO()}
                        max={maxAdvanceDate(meta.settings)}
                        value={trip.from}
                        onChange={(event) => {
                          const nextDate = event.target.value;
                          setTrip((current) => ({
                            ...current,
                            from: nextDate,
                            // Stretch to meet the minimum and clamp a span the
                            // new start makes too long — never let the picker
                            // slip into a quote that silently fails max-days.
                            to: current.to < addDaysISO(nextDate, policy.minDays)
                              ? addDaysISO(nextDate, policy.minDays)
                              : (current.to > addDaysISO(nextDate, policy.maxDays) ? addDaysISO(nextDate, policy.maxDays) : current.to),
                          }));
                          clearTripErrors();
                        }}
                        aria-invalid={fieldErrors.trip ? 'true' : 'false'}
                        aria-describedby={fieldErrors.trip ? 'co-trip-error' : undefined}
                        className="field"
                      />
                      <select aria-label={content.checkout_label_pickup_time} value={trip.pickupTime} onChange={(event) => setTripValue('pickupTime', event.target.value)} className="field w-28 shrink-0">
                        {TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="co-to">{content.checkout_label_dropoff_date}</label>
                    <div className="flex gap-2">
                      <input id="co-to" type="date" min={addDaysISO(trip.from, policy.minDays)} max={addDaysISO(trip.from, policy.maxDays)} value={trip.to} onChange={(event) => setTripValue('to', event.target.value)} aria-invalid={fieldErrors.trip ? 'true' : 'false'} aria-describedby={fieldErrors.trip ? 'co-trip-error' : undefined} className="field" />
                      <select aria-label={content.checkout_label_dropoff_time} value={trip.dropoffTime} onChange={(event) => setTripValue('dropoffTime', event.target.value)} className="field w-28 shrink-0">
                        {TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="co-pickup">{content.checkout_label_pickup_hub}</label>
                    <select id="co-pickup" value={trip.pickup} onChange={(event) => setTripValue('pickup', event.target.value)} aria-invalid={fieldErrors.hubs ? 'true' : 'false'} aria-describedby={fieldErrors.hubs ? 'co-trip-error' : undefined} className="field">
                      {meta.locations.map((location) => <option key={location.id} value={location.name}>{location.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="co-dropoff">{content.checkout_label_dropoff_hub}</label>
                    <select
                      id="co-dropoff"
                      value={policy.oneWayEnabled === false ? trip.pickup : trip.dropoff}
                      onChange={(event) => {
                        if (policy.oneWayEnabled !== false) setTripValue('dropoff', event.target.value);
                      }}
                      disabled={policy.oneWayEnabled === false}
                      aria-invalid={fieldErrors.hubs ? 'true' : 'false'}
                      aria-describedby={fieldErrors.hubs ? 'co-trip-error' : undefined}
                      className="field"
                    >
                      {(policy.oneWayEnabled === false ? [trip.pickup].filter(Boolean) : meta.locations.map((location) => location.name)).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {policy.oneWayEnabled === false && (
                      <p className="mt-1 text-[0.56rem] leading-4 text-muted">{content.checkout_one_way_off}</p>
                    )}
                  </div>
                </div>

                {(fieldErrors.trip || fieldErrors.hubs) && (
                  <p id="co-trip-error" role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[0.68rem] font-semibold text-rose-700">
                    {fieldErrors.trip || fieldErrors.hubs}
                  </p>
                )}

                {trip.pickup && trip.dropoff && trip.pickup !== trip.dropoff && oneWayFee > 0 && (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.68rem] font-semibold text-amber-900">
                    {content.checkout_one_way_note.replace('{fee}', inr(oneWayFee))}
                  </p>
                )}

                <div className="mt-5 rounded-2xl bg-lime/20 p-4">
                  <p className="flex items-center gap-2 text-[0.72rem] font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> {content.checkout_flexible_plans}</p>
                  <p className="mt-1 text-[0.68rem] leading-5 text-ink/65">{policy.fullRefundCopy} {policy.partialRefundCopy} {content.checkout_reschedule_note}</p>
                  <p className="mt-1 text-[0.62rem] leading-4 text-ink/55">{content.checkout_rental_window_note.replace('{min}', String(policy.minDays)).replace('{max}', String(policy.maxDays)).replace('{advance}', String(policy.maxAdvanceDays))}</p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <p className="eyebrow">{content.checkout_step_prefix} 2 {content.checkout_step_total}</p>
                <h2 className="mt-1.5 text-xl font-extrabold tracking-tight">{content.checkout_extras_title}</h2>
                <p className="mt-1 text-xs leading-5 text-muted">{content.checkout_extras_copy}</p>

                <div className="mt-5">
                  <h3 className="text-[0.7rem] font-extrabold uppercase tracking-[0.12em] text-muted">{content.checkout_protection_label}</h3>
                  <div className="mt-2.5 grid gap-2.5">
                    {meta.insuranceTiers.map((tier) => (
                      <label
                        key={tier.key}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-1',
                          insurance === tier.key ? 'border-ink bg-lime/10 ring-1 ring-ink' : 'border-line bg-paper hover:border-ink/40'
                        )}
                      >
                        <input type="radio" name="insurance" checked={insurance === tier.key} onChange={() => setInsurance(tier.key)} className="sr-only" />
                        <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', insurance === tier.key ? 'border-ink bg-ink' : 'border-stone-300 bg-white')}>
                          {insurance === tier.key && <span className="h-2 w-2 rounded-full bg-lime" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-extrabold">{tier.label}</span>
                            <span className="text-[0.72rem] font-extrabold">{tier.pricePerDay === 0 ? content.checkout_included : `+${inr(tier.pricePerDay)}/day`}</span>
                          </span>
                          <span className="mt-0.5 block text-[0.68rem] leading-5 text-muted">{tier.blurb}</span>
                          <span className="mt-1 block text-[0.6rem] font-bold uppercase tracking-wider text-forest">{content.checkout_deductible_note.replace('{amount}', inr(tier.deductible))}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="text-[0.7rem] font-extrabold uppercase tracking-[0.12em] text-muted">{content.checkout_addons_label}</h3>
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    {meta.extras.map((extra) => {
                      const selected = extras.includes(extra.key);
                      return (
                        <label
                          key={extra.id}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-1',
                            selected ? 'border-ink bg-lime/10 ring-1 ring-ink' : 'border-line bg-paper hover:border-ink/40'
                          )}
                        >
                          <input type="checkbox" checked={selected} onChange={() => toggleExtra(extra.key)} className="sr-only" />
                          <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', selected ? 'border-ink bg-ink text-lime' : 'border-stone-300 bg-white')}>
                            {selected && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-[0.78rem] font-extrabold">{extra.label}</span>
                              <span className="shrink-0 text-[0.7rem] font-extrabold">+{inr(extra.pricePerDay)}<span className="text-[0.55rem] font-medium text-muted">{content.checkout_per_day}</span></span>
                            </span>
                            <span className="mt-0.5 block text-[0.65rem] leading-4 text-muted">{extra.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <p className="eyebrow">{content.checkout_step_prefix} 3 {content.checkout_step_total}</p>
                <h2 className="mt-1.5 text-xl font-extrabold tracking-tight">
                  {vehicle.kind === 'bike' ? content.checkout_driver_title_bike : content.checkout_driver_title}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted">{content.checkout_driver_copy}</p>

                {!user && content.guest_checkout_enabled && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-paper px-3.5 py-3">
                    <p className="text-[0.7rem] font-semibold text-muted">{content.checkout_guest_note}</p>
                    <Link to={`/login?redirect=${encodeURIComponent(returnPath)}`} className="text-[0.68rem] font-extrabold underline decoration-lime decoration-2 underline-offset-4">{content.checkout_signin_instead}</Link>
                  </div>
                )}

                {user && (
                  <div className={cn(
                    'mt-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border px-3.5 py-3',
                    user.licenceVerified ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
                  )}>
                    <div className="flex min-w-0 items-start gap-2.5">
                      <ShieldCheck className={cn('mt-0.5 h-4 w-4 shrink-0', user.licenceVerified ? 'text-forest' : 'text-amber-700')} />
                      <div>
                        <p className={cn('text-[0.72rem] font-extrabold', user.licenceVerified ? 'text-emerald-900' : 'text-amber-900')}>
                          {user.licenceVerified
                            ? content.checkout_licence_verified_title
                            : user.licenceUrl ? content.checkout_licence_review_title : content.checkout_licence_missing_title}
                        </p>
                        <p className={cn('mt-0.5 text-[0.62rem] leading-4', user.licenceVerified ? 'text-emerald-800/80' : 'text-amber-900/80')}>
                          {user.licenceVerified
                            ? content.checkout_licence_verified_copy
                            : user.licenceUrl
                              ? content.checkout_licence_review_copy
                              : content.checkout_licence_missing_copy}
                        </p>
                      </div>
                    </div>
                    <Link to="/account?tab=profile#licence" className="text-[0.66rem] font-extrabold underline underline-offset-2">{user.licenceVerified ? content.checkout_licence_view : content.checkout_licence_open}</Link>
                  </div>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="driver-name">{content.checkout_driver_name} <span className="text-rose-600">*</span></label>
                    <input id="driver-name" value={driver.name} onChange={(event) => setDriverValue('name', event.target.value)} className={`field ${fieldErrors.name ? 'border-rose-400' : ''}`} placeholder={content.checkout_placeholder_name} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'driver-name-error' : undefined} />
                    {fieldErrors.name && <p id="driver-name-error" className="mt-1 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.name}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="driver-email">{content.checkout_driver_email} <span className="text-rose-600">*</span></label>
                    <input id="driver-email" type="email" value={driver.email} onChange={(event) => setDriverValue('email', event.target.value)} className={`field ${fieldErrors.email ? 'border-rose-400' : ''}`} placeholder={content.checkout_placeholder_email} autoComplete="email" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'driver-email-error' : undefined} />
                    {fieldErrors.email && <p id="driver-email-error" className="mt-1 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.email}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="driver-phone">{content.checkout_driver_phone} <span className="text-rose-600">*</span></label>
                    <input id="driver-phone" type="tel" value={driver.phone} onChange={(event) => setDriverValue('phone', event.target.value)} className={`field ${fieldErrors.phone ? 'border-rose-400' : ''}`} placeholder={content.checkout_placeholder_phone} autoComplete="tel" aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'driver-phone-error' : undefined} />
                    {fieldErrors.phone && <p id="driver-phone-error" className="mt-1 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.phone}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="driver-dob">{content.checkout_driver_dob} <span className="text-rose-600">*</span></label>
                    <input id="driver-dob" type="date" value={driver.dob} max={todayISO()} onChange={(event) => setDriverValue('dob', event.target.value)} className={`field ${fieldErrors.dob ? 'border-rose-400' : ''}`} aria-invalid={Boolean(fieldErrors.dob)} aria-describedby={fieldErrors.dob ? 'driver-dob-error' : undefined} />
                    {fieldErrors.dob && <p id="driver-dob-error" className="mt-1 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.dob}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="driver-license">{content.checkout_driver_license} <span className="text-rose-600">*</span></label>
                    <input id="driver-license" value={driver.license} onChange={(event) => setDriverValue('license', event.target.value)} className={`field ${fieldErrors.license ? 'border-rose-400' : ''}`} placeholder={content.checkout_placeholder_license} aria-invalid={Boolean(fieldErrors.license)} aria-describedby={fieldErrors.license ? 'driver-license-error' : undefined} />
                    {fieldErrors.license && <p id="driver-license-error" className="mt-1 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.license}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="driver-license-expiry">{content.checkout_driver_licence_expiry} <span className="font-medium normal-case tracking-normal text-muted">{content.checkout_optional}</span></label>
                    <input
                      id="driver-license-expiry"
                      type="date"
                      min={todayISO()}
                      value={driver.licenseExpiry}
                      onChange={(event) => setDriverValue('licenseExpiry', event.target.value)}
                      className={`field ${fieldErrors.licenseExpiry ? 'border-rose-400' : ''}`}
                      aria-invalid={Boolean(fieldErrors.licenseExpiry)}
                      aria-describedby={fieldErrors.licenseExpiry ? 'driver-license-expiry-error' : undefined}
                    />
                    {fieldErrors.licenseExpiry && <p id="driver-license-expiry-error" className="mt-1 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.licenseExpiry}</p>}
                    <p className="mt-1 text-[0.56rem] leading-4 text-muted">{content.checkout_driver_licence_expiry_note}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="driver-notes">{content.checkout_driver_notes} <span className="font-medium normal-case tracking-normal text-muted">{content.checkout_optional}</span></label>
                    <textarea id="driver-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="field resize-none" placeholder={content.checkout_placeholder_notes} maxLength={600} />
                  </div>
                </div>

                <div className="mt-5 space-y-3 rounded-2xl border border-line bg-paper p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      id="checkout-terms"
                      type="checkbox"
                      checked={agreedTerms}
                      onChange={(event) => {
                        setAgreedTerms(event.target.checked);
                        setFieldErrors((current) => {
                          if (!('terms' in current)) return current;
                          const nextErrors = { ...current };
                          delete nextErrors.terms;
                          return nextErrors;
                        });
                      }}
                      aria-invalid={Boolean(fieldErrors.terms)}
                      aria-describedby={fieldErrors.terms ? 'checkout-terms-error' : undefined}
                      className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-ink"
                    />
                    <span className="text-[0.7rem] leading-5 text-ink/75">
                      {content.checkout_terms_prefix} <Link to="/terms" target="_blank" className="font-bold underline underline-offset-2">{content.checkout_terms_link}</Link>{content.checkout_terms_suffix.replace('{age}', String(minDriverAge))}
                    </span>
                  </label>
                  {fieldErrors.terms && <p id="checkout-terms-error" role="alert" className="pl-7 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.terms}</p>}
                  {Number(policy.lateFee) > 0 && (
                    <p className="mt-1.5 pl-7 text-[0.62rem] leading-5 text-muted">
                      {content.checkout_late_fee_note.replace('{terms}', lateFeeTermsText(content.late_fee_terms, policy))}
                    </p>
                  )}
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      id="checkout-licence"
                      type="checkbox"
                      checked={agreedLicense}
                      onChange={(event) => {
                        setAgreedLicense(event.target.checked);
                        setFieldErrors((current) => {
                          if (!('licenseAgree' in current)) return current;
                          const nextErrors = { ...current };
                          delete nextErrors.licenseAgree;
                          return nextErrors;
                        });
                      }}
                      aria-invalid={Boolean(fieldErrors.licenseAgree)}
                      aria-describedby={fieldErrors.licenseAgree ? 'checkout-licence-error' : undefined}
                      className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-ink"
                    />
                    <span className="text-[0.7rem] leading-5 text-ink/75">{content.checkout_licence_agreement}</span>
                  </label>
                  {fieldErrors.licenseAgree && <p id="checkout-licence-error" role="alert" className="pl-7 text-[0.65rem] font-semibold text-rose-700">{fieldErrors.licenseAgree}</p>}
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <p className="eyebrow">{content.checkout_step_prefix} 4 {content.checkout_step_total}</p>
                <h2 className="mt-1.5 text-xl font-extrabold tracking-tight">{content.checkout_payment_title}</h2>
                <p className="mt-1 text-xs leading-5 text-muted">{content.checkout_payment_copy}</p>

                <div className="mt-5 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={content.checkout_payment_title}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentPlan === 'full'}
                    onClick={() => setPaymentPlan('full')}
                    className={cn('rounded-2xl border p-4 text-left transition', paymentPlan === 'full' ? 'border-ink bg-lime/10 ring-1 ring-ink' : 'border-line bg-paper hover:border-ink/40')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold">{content.checkout_pay_full}</span>
                      {paymentPlan === 'full' && <Check className="h-4 w-4" />}
                    </span>
                    <span className="mt-1 block text-[0.7rem] text-muted">{content.checkout_pay_full_copy}</span>
                    <span className="mt-2 block text-lg font-extrabold">{inr(quote?.total ?? guardPrice)}</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentPlan === 'deposit'}
                    onClick={() => setPaymentPlan('deposit')}
                    className={cn('rounded-2xl border p-4 text-left transition', paymentPlan === 'deposit' ? 'border-ink bg-lime/10 ring-1 ring-ink' : 'border-line bg-paper hover:border-ink/40')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold">{content.checkout_pay_deposit} {quote?.depositPercent ?? policy.depositPercent}%</span>
                      {paymentPlan === 'deposit' && <Check className="h-4 w-4" />}
                    </span>
                    <span className="mt-1 block text-[0.7rem] text-muted">{content.checkout_pay_deposit_copy}</span>
                    <span className="mt-2 block text-lg font-extrabold">{inr(quote?.depositDue ?? Math.round(guardPrice * (policy.depositPercent / 100)))}</span>
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-line p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-lime"><CreditCard className="h-4 w-4" /></span>
                      <div>
                        <p className="text-sm font-extrabold">{content.checkout_payment_secure_title}</p>
                        <p className="mt-0.5 text-[0.66rem] text-muted">{content.checkout_payment_methods}</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-lime px-2 py-0.5 text-[0.55rem] font-extrabold uppercase tracking-wider">{content.checkout_selected}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[0.6rem] font-semibold text-muted">
                    <ShieldCheck className="h-3.5 w-3.5 text-forest" /> {content.checkout_payment_pci_note}
                  </div>
                </div>

                <div className="relative mt-4 overflow-hidden rounded-2xl bg-gradient-to-br from-ink via-ink to-forest p-4 text-cream">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-lime/15 blur-2xl" />
                  <div className="relative">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-cream/55">{content.checkout_due_now}</p>
                      <p className="mt-1 text-3xl font-extrabold tracking-tight">{inr(quote?.amountDue ?? guardPrice)}</p>
                    </div>
                    <div className="text-right text-[0.65rem] leading-5 text-cream/55">
                      {paymentPlan === 'deposit' ? (
                        <>{content.checkout_balance_at_pickup}<br /><span className="font-bold text-cream">{inr(quote?.balanceDue ?? 0)}</span></>
                      ) : (
                        <>{content.checkout_deposit_at_pickup}<br /><span className="font-bold text-cream">{inr(quote?.holdAmount ?? policy.holdAmount)}</span></>
                      )}
                    </div>
                  </div>
                </div>
                </div>

                {!available && (
                  <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.7rem] font-semibold text-amber-900">
                    {unavailableReason || 'Those dates are no longer available. Please go back and change your trip.'}
                  </p>
                )}
                {quoteError && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-[0.7rem] font-semibold text-rose-700">{quoteError}</p>}

                <button type="button" onClick={pay} disabled={!canPay} className="btn btn-lime btn-lg mt-4 w-full">
                  {paying ? <><Spinner className="h-4 w-4" /> {content.checkout_opening_payment}</> : <><LockKeyhole className="h-4 w-4" /> {content.checkout_pay_cta} {inr(quote?.amountDue ?? guardPrice)}</>}
                </button>
                <p className="mt-2 text-center text-[0.6rem] leading-4 text-muted">
                  {content.checkout_pay_terms} {inr(quote?.holdAmount ?? policy.holdAmount)}.
                </p>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => (step === 1 ? navigate(`/vehicles/${vehicle.id}`) : setStep((current) => current - 1))}
                className="btn btn-ghost btn-sm"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {step === 1 ? `${content.checkout_back_to} ${vehicle.kind === 'bike' ? 'bike' : 'car'}` : content.checkout_back}
              </button>
              {step < 4 ? (
                <button type="button" onClick={next} className="btn btn-dark">
                  {content.checkout_continue} <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-semibold text-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-forest" /> {autoConfirm ? content.checkout_instant_label : content.checkout_review_label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Summary ----------------------------------------------------------- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="gradient-border rounded-3xl p-5 shadow-card">
            <div className="flex items-center gap-3">
              <img src={vehicle.imageUrl} alt={vehicle.name} className="h-14 w-20 rounded-xl object-cover" />
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{vehicle.name}</p>
                <p className="text-[0.65rem] text-muted">{vehicle.type} · {vehicle.transmission}</p>
                <Stars value={vehicle.rating} count={vehicle.reviewCount} className="mt-0.5" />
              </div>
            </div>

            <div className="mt-4 space-y-1.5 rounded-2xl bg-paper p-3 text-[0.7rem]">
              <div className="flex items-start justify-between gap-3"><span className="inline-flex items-center gap-1 text-muted"><CalendarDays className="h-3 w-3" /> {content.checkout_pickup_label}</span><span className="text-right font-bold">{longDate(trip.from)}<br /><span className="font-medium text-muted">{timeLabel(trip.pickupTime)} · {trip.pickup}</span></span></div>
              <div className="flex items-start justify-between gap-3 border-t border-line/70 pt-1.5"><span className="inline-flex items-center gap-1 text-muted"><CalendarDays className="h-3 w-3" /> {content.checkout_dropoff_label}</span><span className="text-right font-bold">{longDate(trip.to)}<br /><span className="font-medium text-muted">{timeLabel(trip.dropoffTime)} · {trip.dropoff}</span></span></div>
              <div className="flex items-center justify-between border-t border-line/70 pt-1.5"><span className="inline-flex items-center gap-1 text-muted"><MapPin className="h-3 w-3" /> {content.checkout_driver_label}</span><span className="font-bold">{driver.name || content.checkout_add_details}</span></div>
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="co-promo">{content.checkout_promo_code}</label>
              {quote?.discount > 0 && quote?.promoApplied ? (
                <div className="flex items-center justify-between rounded-xl border border-lime-deep bg-lime/20 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-extrabold"><Tag className="h-3.5 w-3.5" /> {quote.promoApplied.code}</span>
                  <button type="button" onClick={removePromo} className="text-[0.6rem] font-bold text-rose-700">{content.checkout_remove}</button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    id="co-promo"
                    value={promoInput}
                    onChange={(event) => { setPromoInput(event.target.value.toUpperCase()); setPromoError(''); }}
                    placeholder={content.checkout_promo_placeholder}
                    className="field h-9 flex-1 py-1 text-[0.7rem] uppercase"
                    aria-invalid={Boolean(promoError)}
                    aria-describedby={promoError ? 'co-promo-error' : undefined}
                  />
                  <button type="button" onClick={applyPromo} className="btn btn-outline btn-sm">{content.checkout_apply}</button>
                </div>
              )}
              {promoError && <p id="co-promo-error" role="alert" className="mt-1.5 text-[0.62rem] font-semibold text-rose-700">{promoError}</p>}
            </div>

            <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[0.7rem]">
              {quoteLoading ? (
                <div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-3/4" /></div>
              ) : quote ? (
                <>
                  <div className="flex justify-between"><span className="text-muted">{content.checkout_nightly.replace('{rate}', inr(quote.nightlyRate)).replace('{days}', String(quote.days))}</span><span className="font-bold">{inr(quote.baseTotal)}</span></div>
                  <div className="flex justify-between text-[0.65rem] text-muted">
                    <span>{content.checkout_km_label}</span>
                    <span className="font-bold text-ink">
                      {km.limited
                        ? content.checkout_km_included.replace('{km}', km.kmCap.toLocaleString('en-IN')).replace('{rate}', inr(km.kmExtraRate))
                        : content.checkout_km_unlimited}
                      {km.limited && kmTotal && (
                        <span className="mt-0.5 block text-[0.58rem] font-semibold text-muted">
                          {content.checkout_km_total
                            .replace('{total}', kmTotal.toLocaleString('en-IN'))
                            .replace('{days}', String(quote.days))}
                        </span>
                      )}
                    </span>
                  </div>
                  {quote.extras.map((extra) => (
                    <div key={extra.key} className="flex justify-between"><span className="text-muted">{extra.label}</span><span className="font-bold">{inr(extra.pricePerDay * quote.days)}</span></div>
                  ))}
                  <div className="flex justify-between"><span className="text-muted">{content.checkout_protection.replace('{label}', quote.insurance.label)}</span><span className="font-bold">{quote.insuranceTotal ? inr(quote.insuranceTotal) : content.checkout_included}</span></div>
                  {quote.oneWayFee > 0 && <div className="flex justify-between"><span className="text-muted">{content.checkout_one_way_fee}</span><span className="font-bold">{inr(quote.oneWayFee)}</span></div>}
                  {quote.discount > 0 && <div className="flex justify-between text-forest"><span>{content.checkout_promo_discount}</span><span className="font-bold">−{inr(quote.discount)}</span></div>}
                  {!quote.taxInclusive && (
                    <div className="flex justify-between"><span className="text-muted">{taxLabel} ({quote.taxRate}%)</span><span className="font-bold">{inr(quote.fees)}</span></div>
                  )}
                  <div className="mt-2 flex justify-between border-t border-line pt-2 text-[0.85rem]"><span className="font-extrabold">{content.checkout_total}</span><span className="font-extrabold">{inr(quote.total)}</span></div>
                  {quote.taxInclusive && (
                    <div className="flex justify-between text-[0.65rem] text-muted"><span>{taxLabel} ({quote.taxRate}%) {content.checkout_tax_included}</span><span>{inr(quote.fees)}</span></div>
                  )}
                  <div className="flex justify-between text-[0.65rem] text-muted"><span>{paymentPlan === 'deposit' ? content.checkout_deposit_due_now : content.checkout_due_now}</span><span className="font-bold text-ink">{inr(quote.amountDue)}</span></div>
                  {quote.balanceDue > 0 && <div className="flex justify-between text-[0.65rem] text-muted"><span>{content.checkout_balance_at_pickup}</span><span className="font-bold text-ink">{inr(quote.balanceDue)}</span></div>}
                  <div className="flex justify-between text-[0.65rem] text-muted"><span>{content.checkout_deposit_line}</span><span className="font-bold text-ink">{inr(quote?.holdAmount ?? policy.holdAmount)}</span></div>
                </>
              ) : (
                <p className="text-[0.7rem] text-muted">{quoteError || content.checkout_choose_dates_price}</p>
              )}
            </div>

            {/* Persistent live region: the amount can change while the totals
                block is swapped for skeletons, so it must not unmount. */}
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {quoteLoading
                ? content.checkout_updating_price
                : quote
                  ? `${paymentPlan === 'deposit' ? content.checkout_deposit_due_now : content.checkout_due_now} ${inr(quote.amountDue)}`
                  : ''}
            </p>

            <div className="mt-3 rounded-xl bg-paper px-3 py-2 text-[0.6rem] leading-4 text-muted">
              {content.checkout_deposit_due_note.replace('{amount}', inr(quote?.holdAmount ?? policy.holdAmount))}
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[0.6rem] font-semibold text-forest">
              <ShieldCheck className="h-3.5 w-3.5" /> {policy.fullRefundCopy}
            </div>
          </div>

          {isDemo && (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-lime-deep/50 bg-lime/15 px-3 py-2.5">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
              <p className="text-[0.62rem] leading-4 text-ink/70">{content.checkout_demo_note}</p>
            </div>
          )}
        </aside>
      </div>

      <PaymentSheet
        open={paymentOpen}
        onClose={closePayment}
        amount={quote?.amountDue ?? 0}
        summary={`${vehicle.name} · ${quote?.days ?? 0} days · ${paymentPlan === 'deposit' ? content.checkout_summary_deposit : content.checkout_summary_full}`}
        onSuccess={async (payment) => {
          await finalize(payment);
        }}
      />

      {/* Mobile sticky summary bar ------------------------------------------ */}
      <div
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-paper/95 shadow-[0_18px_40px_-24px_rgba(10,15,11,0.55)] backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[0.8rem] font-extrabold tracking-tight">
              {quote ? inr(quote.total) : inr(vehicle.pricePerDay)} <span className="text-[0.6rem] font-medium text-muted">{quote ? content.checkout_mobile_total : content.checkout_mobile_day}</span>
            </p>
            <p className="mt-0.5 text-[0.56rem] leading-4 text-muted">
              {step < 4
                ? `${content.checkout_step_progress.replace('{step}', String(step)).replace('{total}', '4')} · ${paymentPlan === 'deposit' && quote ? content.checkout_deposit_now.replace('{amount}', inr(quote.amountDue)) : content.checkout_due_at_payment}`
                : quote && canPay
                  ? `${content.checkout_mobile_due_now.replace('{amount}', inr(quote.amountDue))} · ${autoConfirm ? content.checkout_instant_confirm : content.checkout_after_review}`
                  : content.checkout_complete_details}
            </p>
          </div>
          {step < 4 ? (
            <button type="button" onClick={next} className="btn btn-dark btn-sm shrink-0">
              {content.checkout_continue} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button type="button" onClick={pay} disabled={!canPay} className="btn btn-lime btn-sm shrink-0">
              {canPay ? content.checkout_pay_now.replace('{amount}', inr(quote?.amountDue ?? 0)) : content.checkout_complete_to_pay}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
