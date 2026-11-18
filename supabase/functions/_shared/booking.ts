import { admin } from './razorpay.ts';

export type Draft = {
  vehicleId: string;
  startDate: string;
  endDate: string;
  pickupTime: string;
  dropoffTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  extras: string[];
  insurance: string;
  promoCode: string;
  paymentPlan: 'full' | 'deposit';
  notes: string;
  driver: { name: string; email: string; phone: string; license: string; dob: string };
  agreedTerms: boolean;
  agreedLicense: boolean;
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const isRealDate = (iso: string) => {
  if (!dateRe.test(iso)) return false;
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
};

export function sanitizeDraft(body: Record<string, unknown>): Draft {
  const driver = (body.driver ?? {}) as Record<string, unknown>;
  return {
    vehicleId: String(body.vehicleId ?? ''),
    startDate: String(body.startDate ?? ''),
    endDate: String(body.endDate ?? ''),
    pickupTime: String(body.pickupTime ?? '10:00'),
    dropoffTime: String(body.dropoffTime ?? '10:00'),
    pickupLocation: String(body.pickupLocation ?? ''),
    dropoffLocation: String(body.dropoffLocation ?? ''),
    extras: Array.isArray(body.extras) ? body.extras.map(String).slice(0, 8) : [],
    insurance: ['basic', 'standard', 'full'].includes(String(body.insurance))
      ? String(body.insurance)
      : 'basic',
    promoCode: String(body.promoCode ?? '').trim().toUpperCase(),
    paymentPlan: body.paymentPlan === 'deposit' ? 'deposit' : 'full',
    notes: String(body.notes ?? '').slice(0, 600),
    driver: {
      name: String(driver.name ?? '').trim(),
      email: String(driver.email ?? '').trim(),
      phone: String(driver.phone ?? '').trim(),
      license: String(driver.license ?? '').trim(),
      dob: String(driver.dob ?? '').trim(),
    },
    agreedTerms: body.agreedTerms === true,
    agreedLicense: body.agreedLicense === true,
  };
}

export async function validateDraft(draft: Draft): Promise<string | null> {
  if (!draft.vehicleId) return 'Vehicle is required.';
  if (!draft.startDate || !draft.endDate) return 'Pick-up and drop-off dates are required.';
  if (!isRealDate(draft.startDate) || !isRealDate(draft.endDate)) return 'Choose valid pick-up and drop-off dates.';
  if (draft.startDate >= draft.endDate) return 'Drop-off must be after pick-up.';
  if (draft.startDate < todayIST()) return 'Pick-up cannot be in the past.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.pickupTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dropoffTime)) {
    return 'Pick-up and drop-off times are required.';
  }
  if (!draft.pickupLocation || !draft.dropoffLocation) return 'Pick-up and drop-off locations are required.';
  if (!draft.agreedTerms || !draft.agreedLicense) {
    return 'Please accept the rental terms and licence verification notice.';
  }
  if (draft.driver.name.length < 2) return 'Driver full name is required.';
  if (!emailRe.test(draft.driver.email)) return 'A valid driver email is required.';
  if (draft.driver.phone.replace(/\D/g, '').length < 7) return 'A valid driver phone number is required.';
  if (draft.driver.license.length < 4) return 'A valid driver licence number is required.';
  if (!isRealDate(draft.driver.dob)) return 'Driver date of birth is required.';

  const dob = new Date(`${draft.driver.dob}T12:00:00Z`);
  if (Number.isNaN(dob.getTime())) return 'Driver date of birth is invalid.';
  const nowIST = new Date(Date.now() + 5.5 * 3600000);
  const [birthYear, birthMonth, birthDay] = draft.driver.dob.split('-').map(Number);
  let age = nowIST.getUTCFullYear() - birthYear;
  const monthNow = nowIST.getUTCMonth() + 1;
  if (monthNow < birthMonth || (monthNow === birthMonth && nowIST.getUTCDate() < birthDay)) {
    age -= 1;
  }
  if (age < 0) return 'Driver date of birth is invalid.';

  const [{ data: vehicle, error: vehicleError }, { data: ageSettings }] = await Promise.all([
    admin.from('vehicles').select('kind, status, min_age').eq('id', draft.vehicleId).maybeSingle(),
    admin.from('settings').select('key, value').in('key', ['min_age', 'min_bike_rider_age']),
  ]);
  if (vehicleError) throw new Error(vehicleError.message);
  if (!vehicle) return 'Vehicle not found.';
  if (vehicle.status === 'maintenance') return 'This vehicle is currently in service.';

  const isBike = vehicle.kind === 'bike';
  const clampAge = (value: number, fallback: number) => (
    Number.isFinite(value) ? Math.min(90, Math.max(16, value)) : fallback
  );
  const policyAge = clampAge(
    Number((ageSettings ?? []).find((row: { key: string }) => row.key === (isBike ? 'min_bike_rider_age' : 'min_age'))?.value),
    isBike ? 18 : 21,
  );
  // A vehicle can be stricter than the site policy (e.g. a superbike or a
  // luxury car), but never more permissive.
  const minAge = Math.max(policyAge, clampAge(Number(vehicle.min_age), policyAge));
  if (age < minAge) return `${isBike ? 'Riders' : 'Drivers'} must be at least ${minAge} years old.`;
  if (age > 85) return 'Please contact us directly for drivers over 85.';
  return null;
}

export async function quoteDraft(draft: Draft) {
  const { data, error } = await admin.rpc('quote_rental', {
    p_vehicle_id: draft.vehicleId,
    p_start_date: draft.startDate,
    p_end_date: draft.endDate,
    p_extras: draft.extras,
    p_insurance: draft.insurance,
    p_promo_code: draft.promoCode || null,
    p_pickup_location: draft.pickupLocation,
    p_dropoff_location: draft.dropoffLocation,
    p_payment_plan: draft.paymentPlan,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, any>;
}
