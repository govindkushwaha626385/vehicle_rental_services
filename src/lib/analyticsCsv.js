/**
 * Shared CSV builder for the admin analytics exports.
 *
 * One helper keeps the Dashboard and Analytics pages byte-for-byte
 * consistent (a past pain point: the two pages drifted into different
 * column shapes). Every row sticks to the same 12 columns — `type` first —
 * and the daily block follows the selected range so the file always matches
 * what is on screen.
 */

export const ANALYTICS_CSV_HEADERS = ['type', 'date', 'created', 'started', 'completed', 'cancelled', 'recognized', 'received', 'gst', 'label', 'count', 'revenue'];

const MIX_TYPES = [
  ['weekday', 'weekdayMix'],
  ['hub', 'hubMix'],
  ['category', 'typeMix'],
];

export function analyticsCsvRows(analytics = {}, range = 30) {
  const daily = Array.isArray(analytics.daily) ? analytics.daily.slice(-range) : [];
  const rows = daily.map((row) => [
    'daily', row.date, row.created, row.started, row.completed, row.cancelled,
    row.recognized, row.received, row.gst, '', '', '',
  ]);
  MIX_TYPES.forEach(([type, key]) => {
    (analytics[key] ?? []).forEach((row) => rows.push([
      type, '', '', '', '', '', '', '', '', row.label, row.count, row.revenue ?? '',
    ]));
  });
  // Distance is a count, not money: it goes in the `count` column so the
  // existing 12-column shape stays stable for downstream spreadsheets.
  (analytics.km?.byVehicle ?? []).forEach((row) => rows.push([
    'km', '', '', '', '', '', '', '', '', row.label, row.value, '',
  ]));
  if (analytics.km?.excessKmFees > 0) {
    rows.push(['km_fee', '', '', '', '', '', '', '', '', 'Excess-km fees', '', analytics.km.excessKmFees]);
  }
  // Trip extensions: how often returns moved later and what that earned.
  if (analytics.extensions) {
    rows.push(['extension', '', '', '', '', '', '', '', '', 'Extensions', analytics.extensions.count, analytics.extensions.revenueDelta]);
    (analytics.extensions.byMonth ?? []).forEach((row) => rows.push([
      'extension_month', '', '', '', '', '', '', '', '', row.label, '', row.value,
    ]));
  }
  // Return punctuality among settled returns.
  if (analytics.returnTimes?.settled > 0) {
    rows.push(['punctuality', '', '', '', '', '', '', '', '', 'On-time returns', analytics.returnTimes.onTime, '']);
    rows.push(['punctuality', '', '', '', '', '', '', '', '', 'Late returns', analytics.returnTimes.late, '']);
    rows.push(['punctuality', '', '', '', '', '', '', '', '', 'Average lateness (days)', '', analytics.returnTimes.avgLateDays]);
  }
  // Per-vehicle late returns: count in `count`, fee revenue in `revenue`, and
  // billed hours as a separate row so both questions are answerable in a sheet.
  (analytics.lateReturns ?? []).forEach((row) => rows.push([
    'late_return', '', '', '', '', '', '', '', '', row.vehicle, row.late, row.lateFees,
  ]));
  (analytics.lateReturns ?? []).forEach((row) => rows.push([
    'late_hours', '', '', '', '', '', '', '', '', row.vehicle, row.lateHours, '',
  ]));
  // Historic fleet utilisation by day — % of the bookable fleet occupied.
  (analytics.utilizationTrend ?? []).slice(-range).forEach((row) => rows.push([
    'utilization', row.date, '', '', '', '', '', '', '', '', row.value, '',
  ]));
  // Fleet health radar: each vehicle's service-due score out of 100.
  (analytics.fleetRadar ?? []).forEach((row) => rows.push([
    'fleet_health', '', '', '', '', '', '', '', '', row.name, row.score, '',
  ]));
  // Security-deposit book: the money that moves in person at the desks. Same
  // buckets as the Finance ledger, so the exported sheet reconciles with what
  // is on screen. Rows stay within the fixed 12 columns — counts in `count`,
  // rupees in `revenue`.
  const deposits = analytics.deposits ?? {};
  const depositRow = (type, label, count, revenue) => {
    const safeCount = Number(count) || 0;
    const safeRevenue = Number(revenue) || 0;
    if (!safeCount && !safeRevenue) return;
    rows.push([type, '', '', '', '', '', '', '', '', label, safeCount || '', safeRevenue || '']);
  };
  if (Object.keys(deposits).length) {
    depositRow('deposit_float', 'Deposits held (on rent + awaiting settlement)', '', deposits.depositsHeld);
    depositRow('deposit_awaiting', `${deposits.awaiting ?? 0} awaiting settlement`, deposits.awaiting, deposits.awaitingAmount);
    depositRow('deposit_released', 'Released at settlement', '', deposits.depositsReleased);
    depositRow('deposit_deducted', 'Deducted (damage · late · cleaning · km)', '', deposits.depositsDeducted);
    depositRow('deposit_extra_due', 'Charges beyond the deposit', '', deposits.extraDue);
    (deposits.refundsByMethod ?? []).forEach((row) => {
      depositRow('deposit_refund', `Refunds via ${row.method}`, row.count, '');
    });
  }
  // Customer acquisition: monthly registration counts so the exported sheet
  // has the same trend visible on screen.
  const acquisition = analytics.customerAcquisitionTrend;
  if (acquisition) {
    if (acquisition.total > 0) {
      rows.push(['acquisition', '', '', '', '', '', '', '', '', 'Registered customers', acquisition.total, '']);
    }
    (acquisition.monthly ?? []).forEach((row) => {
      if (row.count > 0) rows.push(['signups', '', '', '', '', '', '', '', '', row.label, row.count, '']);
    });
  }
  // Abandoned checkouts: how many customers opened payment but did not complete.
  const checkout = analytics.checkout;
  if (checkout) {
    if (checkout.count30d > 0) {
      rows.push(['checkout_abandoned', '', '', '', '', '', '', '', '', 'Abandoned checkouts (30d)', checkout.count30d, checkout.value30d]);
    }
    if (checkout.count24h > 0) {
      rows.push(['checkout_24h', '', '', '', '', '', '', '', '', 'Abandoned in last 24h', checkout.count24h, '']);
    }
    (checkout.recent ?? []).forEach((attempt) => {
      const label = attempt.vehicleName || 'Unknown vehicle';
      rows.push(['checkout_attempt', '', '', '', '', '', '', '', '', label, '', attempt.amount]);
    });
  }
  return rows;
}

export function analyticsCsv(analytics = {}, range = 30) {
  return [
    ANALYTICS_CSV_HEADERS,
    ...analyticsCsvRows(analytics, range).map((row) => row.map(String)),
  ];
}