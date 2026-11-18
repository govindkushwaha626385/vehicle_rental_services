import { addDaysISO } from './pricing.js';

const stamp = (date, time = '10:00') => {
  const [rawHours, rawMinutes] = String(time || '10:00').split(':');
  const hours = String(Number(rawHours) || 0).padStart(2, '0');
  const minutes = String(Number(rawMinutes) || 0).padStart(2, '0');
  return `${String(date).replace(/-/g, '')}T${hours}${minutes}00`;
};

const escapeICS = (value = '') =>
  String(value)
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');

const plusHour = (date, time = '10:00') => {
  const [hours, minutes] = String(time || '10:00').split(':').map(Number);
  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0) + 60;
  const dayOffset = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const iso = dayOffset ? addDaysISO(date, dayOffset) : date;
  return `${String(iso).replace(/-/g, '')}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
};

function event({ uid, start, end, summary, location, description }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@rove.rent`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART;TZID=Asia/Kolkata:${start}`,
    `DTEND;TZID=Asia/Kolkata:${end}`,
    `SUMMARY:${escapeICS(summary)}`,
    `LOCATION:${escapeICS(location)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    'END:VEVENT',
  ].join('\r\n');
}

export function buildBookingICS(booking, copy = {}) {
  if (!booking) return '';
  const text = {
    fallbackName: 'Your Rove rental',
    pickupTitle: 'Rove pick-up',
    dropoffTitle: 'Rove drop-off',
    pickupNote: 'Bring your driving licence, photo ID and the payment card.',
    dropoffNote: 'Return with the agreed fuel or charge level.',
    ...copy,
  };
  const vehicleName = booking.vehicle?.name || text.fallbackName;
  const code = booking.code || booking.id;
  const start = stamp(booking.startDate, booking.pickupTime);
  const end = stamp(booking.endDate, booking.dropoffTime);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rove Rentals//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    event({
      uid: `pickup-${code}`,
      start,
      // A one-hour reminder, not a multi-day block: the drop-off event below
      // already marks the end of the rental.
      end: plusHour(booking.startDate, booking.pickupTime),
      summary: `${text.pickupTitle} · ${vehicleName}`,
      location: booking.pickupLocation,
      description: `Booking ${code}. ${text.pickupNote}`,
    }),
    event({
      uid: `dropoff-${code}`,
      start: end,
      end: plusHour(booking.endDate, booking.dropoffTime),
      summary: `${text.dropoffTitle} · ${vehicleName}`,
      location: booking.dropoffLocation,
      description: `${text.dropoffNote} Booking ${code}.`,
    }),
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadBookingICS(booking, copy = {}) {
  if (!booking) return;
  const calendar = buildBookingICS(booking, copy);
  const code = booking.code || booking.id;

  const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rove-${code}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Safari can abort a download if the object URL is revoked in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
