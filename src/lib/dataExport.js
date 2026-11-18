/**
 * Customer data portability — assemble everything Rove stores about a person
 * into a single JSON file they can keep or share. Client-side only; nothing is
 * uploaded. Tracks, passwords and auth tokens are deliberately excluded.
 */
import { todayISO } from './pricing.js';

const trim = (value) => (value === undefined ? null : value);

export function buildDataExport({ user, bookings = [], favorites = [], reviews = [], settings = {} }) {
  return {
    exporter: 'Rove',
    generatedAt: `${new Date().toISOString().slice(0, 19)}Z`,
    account: {
      name: user?.name ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      role: user?.role ?? null,
      joined: trim(user?.createdAt),
      licenceNumber: user?.licenseNumber ?? null,
      licenceVerified: user?.licenceVerified ?? null,
    },
    settings: {
      currency: 'INR',
      language: 'en',
      supportEmail: settings.support_email ?? null,
    },
    trips: bookings.map((booking) => ({
      code: booking.code,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      vehicle: booking.vehicle?.name ?? null,
      pickup: booking.pickupLocation,
      dropoff: booking.dropoffLocation,
      startDate: booking.startDate,
      endDate: booking.endDate,
      pickupTime: booking.pickupTime,
      dropoffTime: booking.dropoffTime,
      days: booking.days,
      extras: booking.extras?.map((extra) => extra.label ?? extra.key) ?? [],
      insurance: booking.insurance?.label ?? booking.insurance,
      total: booking.total,
      amountPaid: booking.amountPaid,
      discount: booking.discount ?? 0,
      tax: booking.fees ?? 0,
      taxRate: booking.taxRate ?? null,
      promoCode: booking.promoCode ?? null,
      createdAt: booking.createdAt,
      cancelledAt: booking.cancelledAt ?? null,
      payments: (booking.payments ?? []).map((payment) => ({
        kind: payment.kind,
        amount: payment.amount,
        status: payment.status,
        brand: payment.brand ?? null,
        last4: payment.last4 ?? null,
        createdAt: payment.createdAt,
      })),
    })),
    savedVehicles: favorites.map((favorite) => ({
      name: favorite.name,
      location: favorite.location,
      pricePerDay: favorite.pricePerDay,
    })),
    reviews: reviews.map((review) => ({
      writtenAt: review.createdAt,
      rating: review.rating,
      comment: review.comment,
    })),
    totals: {
      trips: bookings.length,
      completedTrips: bookings.filter((booking) => booking.status === 'completed').length,
      totalSpend: bookings
        .filter((booking) => booking.status === 'completed')
        .reduce((sum, booking) => sum + (Number(booking.total) || 0), 0),
      savedVehicles: favorites.length,
      reviews: reviews.length,
    },
  };
}

export function downloadDataExport(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rove-data-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari can abort the download if the blob URL disappears in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}