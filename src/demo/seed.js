import {
  buildDemoReviews,
  demoExtras,
  demoInsuranceTiers,
  demoLocations,
  demoPromos,
  demoSettings,
  demoUsers,
  demoVehicles,
} from './data.js';
import { addDaysISO, calculateQuote, todayISO } from '../lib/pricing.js';
import { REFUND_METHODS, settlementFor } from '../lib/returns.js';

export const DEMO_VERSION = 12;
export const DEMO_KEY = 'rove_demo_state_v3';

const uid = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`;
const dateAt = (offset) => addDaysISO(todayISO(), offset);
const createdAt = (offset, hour = 9) => `${dateAt(offset)}T${String(hour).padStart(2, '0')}:12:00.000Z`;

export function buildDemoState() {
  const users = demoUsers.map((user) => ({ ...user }));
  const vehicles = demoVehicles.map((vehicle) => ({ ...vehicle }));
  const locations = demoLocations.map((location) => ({ ...location }));
  const extras = demoExtras.map((extra) => ({ ...extra }));
  const insuranceTiers = demoInsuranceTiers.map((tier) => ({ ...tier }));
  const promos = demoPromos.map((promo) => ({ ...promo }));
  const settings = { ...demoSettings };
  const reviews = buildDemoReviews();

  const state = {
    version: DEMO_VERSION,
    sessionUserId: null,
    users,
    vehicles,
    locations,
    extras,
    insuranceTiers,
    promos,
    settings,
    bookings: [],
    payments: [],
    reviews,
    favorites: [],
    contactMessages: [],
    vehicleBlocks: [],
    serviceLogs: [],
    auditLogs: [],
    checkoutAttempts: [],
  };

  // A handful of realistic abandoned checkouts so the recovery widget has
  // something to show on a fresh install. Converted attempts are added by
  // `beginPayment`/`confirmPayment` as customers actually check out.
  const attemptVehicle = (vehicleId) => vehicles.find((vehicle) => vehicle.id === vehicleId) ?? vehicles[0];
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const seedAttempts = [
    { vehicleId: 'veh-velar', startDate: dateAt(12), endDate: dateAt(15), daysAgo: 2, amountDue: 4 * 15000 },
    { vehicleId: 'veh-apachertr160', startDate: dateAt(6), endDate: dateAt(9), daysAgo: 5, amountDue: 3 * 700 },
    { vehicleId: 'veh-mustang', startDate: dateAt(21), endDate: dateAt(25), daysAgo: 12, amountDue: 4 * 21000 },
    { vehicleId: 'veh-911', startDate: dateAt(3), endDate: dateAt(6), daysAgo: 20, amountDue: 3 * 24000 },
    { vehicleId: 'veh-ather450x', startDate: dateAt(9), endDate: dateAt(10), daysAgo: 1, amountDue: 2 * 500 },
    { vehicleId: 'veh-i4', startDate: dateAt(16), endDate: dateAt(20), daysAgo: 7, amountDue: 4 * 9000 },
    { vehicleId: 'veh-gle', startDate: dateAt(26), endDate: dateAt(30), daysAgo: 15, amountDue: 4 * 14000 },
    { vehicleId: 'veh-wrangler', startDate: dateAt(2), endDate: dateAt(5), daysAgo: 3, amountDue: 3 * 7500 },
  ];
  state.checkoutAttempts = seedAttempts.map((attempt) => {
    const vehicle = attemptVehicle(attempt.vehicleId);
    return {
      id: `chk-${attempt.vehicleId}`,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      startDate: attempt.startDate,
      endDate: attempt.endDate,
      amountDue: attempt.amountDue,
      total: attempt.amountDue,
      createdAt: daysAgo(attempt.daysAgo),
    };
  });

  let bookingNo = 0;
  let paymentNo = 0;

  // A living inbox for demos: one new, one read, one resolved message so the
  // console never opens to an empty queue on a fresh install.
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
  state.contactMessages = [
    {
      id: 'msg-demo-early-pickup',
      name: 'Priya Menon',
      email: 'priya.menon@example.com',
      phone: '+91 98200 11223',
      message: 'Hi! Our flight lands at 6am — can we collect the car a little earlier than the listed pick-up time?',
      bookingCode: '', subject: 'Booking & payment',
      status: 'new',
      staffNotes: '',
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(5),
    },
    {
      id: 'msg-demo-child-seat',
      name: 'Rohit Verma',
      email: 'rohit.verma@example.com',
      phone: '+91 99870 44556',
      message: 'Do you provide a child seat for a 3-year-old, and is there an extra charge?',
      bookingCode: '', subject: 'General',
      status: 'read',
      staffNotes: 'Yes — one seat available at Bandra. Quoted ₹300/day, added to the quote.',
      createdAt: hoursAgo(34),
      updatedAt: hoursAgo(26),
    },
    {
      id: 'msg-demo-thanks',
      name: 'Sara Khan',
      email: 'sara.khan@example.com',
      phone: '',
      message: 'Thanks for the smooth handover last weekend — the GLE was spotless. Will book again.',
      bookingCode: '', subject: 'Feedback',
      status: 'resolved',
      staffNotes: 'Passed to the team. Customer left a 5★ review.',
      createdAt: hoursAgo(77),
      updatedAt: hoursAgo(70),
    },
    {
      id: 'msg-demo-deposit',
      name: 'Ishan Rao',
      email: 'ishan.rao@example.com',
      phone: '+91 98771 20908',
      message: 'Hi — when does the deposit show up back on my card after return? Just handed the car back this morning and the desk said 5–7 working days.',
      bookingCode: 'RV-D1038',
      subject: 'Deposits & refunds',
      status: 'new',
      staffNotes: '',
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(3),
    },
    {
      id: 'msg-demo-extend',
      name: 'Diya Pillai',
      email: 'diya.pillai@example.com',
      phone: '+91 97654 10203',
      message: 'Would love to keep the car one extra day for tomorrow morning. The app shows the return is tomorrow 6pm — can we move it to the day after?',
      bookingCode: 'RV-D1046',
      subject: 'Trip changes',
      status: 'read',
      staffNotes: 'Quoted +1 day at the booked fare. Approved and the customer was notified.',
      createdAt: hoursAgo(28),
      updatedAt: hoursAgo(22),
    },
    // Additional messages to deepen the inbox for the demo preview.
    {
      id: 'msg-demo-cancellation',
      name: 'Arun Nair',
      email: 'arun.nair@example.com',
      phone: '+91 98765 43210',
      message: 'I need to cancel my booking for next week. Can you let me know the refund policy for cancellations inside 2 days?',
      bookingCode: 'RV-D1055',
      subject: 'Booking & payment',
      status: 'new',
      staffNotes: '',
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
    },
    {
      id: 'msg-demo-oneway',
      name: 'Meera Joshi',
      email: 'meera.joshi@example.com',
      phone: '+91 98123 45678',
      message: "Hello! We're planning a road trip from Mumbai to Goa and would love to drop the car in Goa. Do you offer one-way rentals between these cities, and is there an extra fee?",
      bookingCode: '',
      subject: 'Booking & payment',
      status: 'read',
      staffNotes: 'One-way is available on this route. Fee is waived on select packages — shared the proposal with the customer.',
      createdAt: hoursAgo(46),
      updatedAt: hoursAgo(40),
    },
    {
      id: 'msg-demo-payment',
      name: 'Kabir Singh',
      email: 'kabir.singh@example.com',
      phone: '',
      message: 'Tried paying the deposit via UPI on the confirmation page but the payment failed twice. Can you help me complete the payment?',
      bookingCode: 'RV-D1057',
      subject: 'Booking & payment',
      status: 'resolved',
      staffNotes: 'Manually confirmed the booking after verifying the partial payment. Customer to pay the balance at pick-up.',
      createdAt: hoursAgo(90),
      updatedAt: hoursAgo(82),
    },
    {
      id: 'msg-demo-feedback',
      name: 'Neha Gupta',
      email: 'neha.gupta@example.com',
      phone: '+91 99887 66554',
      message: 'The car was great but the pick-up process took longer than expected — the desk attendant was helpful but there was a queue. Maybe a digital queue system?',
      bookingCode: '',
      subject: 'Feedback',
      status: 'resolved',
      staffNotes: 'Reviewed with the Goa team. Added a self-serve check-in kiosk to the backlog. Customer was thanked for the feedback.',
      createdAt: hoursAgo(120),
      updatedAt: hoursAgo(110),
    },
    {
      id: 'msg-demo-billing',
      name: 'Arjun Mehra',
      email: 'arjun.mehra@example.com',
      phone: '+91 98712 33445',
      message: 'Hi, I was charged an extra ₹1,200 on my return that the desk attendant mentioned was for "excess cleaning" but the car was returned exactly as I got it. Can you review this charge?',
      bookingCode: 'RV-D1030',
      subject: 'Deposits & refunds',
      status: 'read',
      staffNotes: 'Escalated to the Goa team for review. The cleaning fee seems high for a 4-hour rental. Will update the customer.',
      createdAt: hoursAgo(14),
      updatedAt: hoursAgo(10),
    },
    {
      id: 'msg-demo-referral',
      name: 'Kavita Sharma',
      email: 'kavita.sharma@example.com',
      phone: '+91 99555 66778',
      message: 'I referred two friends after my last trip and they both booked using my referral code. Is there a referral credit or discount I can use on my next booking?',
      bookingCode: '',
      subject: 'General',
      status: 'new',
      staffNotes: '',
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    },
    {
      id: 'msg-demo-wedding',
      name: 'Rhea Kapoor',
      email: 'rhea.kapoor@example.com',
      phone: '+91 90040 44556',
      message: 'We are planning a small destination wedding in Goa in December — around 6 families, 30 guests in total. Could we book a fleet of 6–8 cars for a week, and is there a group discount? Also need one chauffeur.',
      bookingCode: '',
      subject: 'Group & corporate',
      status: 'read',
      staffNotes: 'Group enquiry — forwarded to B2B. 12% corporate-style discount can go up to 15% for 8+ cars and a week.',
      createdAt: hoursAgo(9),
      updatedAt: hoursAgo(6),
    },
    {
      id: 'msg-demo-corporate',
      name: 'Vikram Bansal',
      email: 'vikram.bansal@techcorp.example.com',
      phone: '+91 98000 22331',
      message: 'Hello — TechCorp India runs a monthly client-visit programme in Bengaluru. We would like a standing agreement for 2–3 cars available on weekdays, invoiced monthly with net-30 terms. Whom should I speak to?',
      bookingCode: '',
      subject: 'Group & corporate',
      status: 'read',
      staffNotes: 'B2B lead — monthly retainer possibility, net-30. Director to follow up.',
      createdAt: hoursAgo(26),
      updatedAt: hoursAgo(22),
    },
  ];

  const vehicleById = (id) => vehicles.find((vehicle) => vehicle.id === id);
  const userById = (id) => users.find((user) => user.id === id);
  const promoByCode = (code) => promos.find((promo) => promo.code === code);

  function addBooking({
    userId = null,
    guest = null,
    vehicleId,
    startOffset,
    nights,
    status,
    extraKeys = [],
    insurance = 'basic',
    promoCode = null,
    plan = 'full',
    paid = true,
    notes = '',
    pickupLocation = null,
    dropoffLocation = null,
    createdOffset = null,
    driver = null,
  }) {
    bookingNo += 1;
    const vehicle = vehicleById(vehicleId);
    const startDate = dateAt(startOffset);
    const endDate = addDaysISO(startDate, nights);
    const pickup = pickupLocation || vehicle.location;
    const dropoff = dropoffLocation || vehicle.location;
    const promo = promoCode ? promoByCode(promoCode) : null;
    const quote = calculateQuote({
      vehicle,
      startDate,
      endDate,
      extras: extraKeys,
      extrasCatalog: extras.filter((extra) => extra.active),
      insuranceTiers,
      insurance,
      promo,
      settings,
      pickupLocation: pickup,
      dropoffLocation: dropoff,
      paymentPlan: plan,
      skipValidation: true,
    });

    const user = userId ? userById(userId) : null;
    const cancelled = status === 'cancelled' || status === 'rejected';
    const amountPaid = paid && !cancelled ? quote.amountDue : 0;
    let paymentStatus = 'unpaid';
    if (cancelled && paid) paymentStatus = 'refunded';
    else if (paid) paymentStatus = plan === 'deposit' ? 'deposit_paid' : 'paid';

    const booking = {
      id: uid('bkg', bookingNo),
      code: `RV-D${String(1020 + bookingNo)}`,
      userId: user?.id ?? null,
      guestName: guest?.name ?? '',
      guestEmail: guest?.email ?? '',
      guestPhone: guest?.phone ?? '',
      vehicleId,
      pickupLocation: pickup,
      dropoffLocation: dropoff,
      startDate,
      endDate,
      pickupTime: '10:00',
      dropoffTime: '18:00',
      days: quote.days,
      extras: extraKeys,
      insurance,
      baseTotal: quote.baseTotal,
      extrasTotal: quote.extrasTotal,
      insuranceTotal: quote.insuranceTotal,
      oneWayFee: quote.oneWayFee,
      fees: quote.fees,
      taxRate: quote.taxRate,
      discount: quote.discount,
      total: quote.total,
      depositDue: quote.depositDue,
      holdAmount: Number(settings.hold_amount),
      amountPaid,
      promoCode: promo?.code ?? '',
      paymentPlan: plan,
      paymentStatus,
      status,
      driver: {
        name: driver?.name ?? user?.name ?? guest?.name ?? '',
        email: driver?.email ?? user?.email ?? guest?.email ?? '',
        phone: driver?.phone ?? user?.phone ?? guest?.phone ?? '',
        license: driver?.license ?? user?.licenseNumber ?? 'MH0220190001234',
        dob: driver?.dob ?? '1992-06-18',
      },
      notes,
      createdAt: createdAt(createdOffset ?? -3, 9 + (bookingNo % 8)),
      cancelledAt: cancelled ? createdAt(createdOffset ?? -2, 11) : null,
      razorpayOrderId: null,
    };
    state.bookings.push(booking);
    if (quote.promoApplied) promo.usedCount += 1;

    const PAYMENT_BRANDS = [
      { brand: 'Visa', last4: '4242' },
      { brand: 'Mastercard', last4: '8877' },
      { brand: 'UPI', last4: 'paytm' },
      { brand: 'RuPay', last4: '6612' },
      { brand: 'Amex', last4: '9008' },
      { brand: 'Netbanking', last4: 'icici' },
    ];

    if (paid) {
      paymentNo += 1;
      const brandInfo = PAYMENT_BRANDS[(paymentNo - 1) % PAYMENT_BRANDS.length];
      state.payments.push({
        id: uid('pay', paymentNo),
        bookingId: booking.id,
        kind: plan === 'deposit' ? 'deposit' : 'payment',
        amount: quote.amountDue,
        currency: 'INR',
        status: 'succeeded',
        brand: brandInfo.brand,
        last4: brandInfo.last4,
        reference: `pay_demo_${booking.id}`,
        orderId: `order_demo_${booking.id}`,
        createdAt: booking.createdAt,
      });
      if (cancelled) {
        paymentNo += 1;
        const refundBrand = PAYMENT_BRANDS[(paymentNo - 1) % PAYMENT_BRANDS.length];
        state.payments.push({
          id: uid('pay', paymentNo),
          bookingId: booking.id,
          kind: 'refund',
          amount: quote.amountDue,
          currency: 'INR',
          status: 'refunded',
          brand: refundBrand.brand,
          last4: refundBrand.last4,
          reference: `refund_demo_${booking.id}`,
          orderId: `order_demo_${booking.id}`,
          createdAt: booking.cancelledAt,
        });
      }
    }
    return booking;
  }

  // Current customer journey -------------------------------------------------
  addBooking({ userId: 'usr-maya', vehicleId: 'veh-modely', startOffset: -42, nights: 4, status: 'completed', extraKeys: ['childseat'], insurance: 'full' });
  addBooking({ userId: 'usr-maya', vehicleId: 'veh-mustang', startOffset: -95, nights: 3, status: 'completed', insurance: 'standard' });
  addBooking({
    userId: 'usr-maya', vehicleId: 'veh-velar', startOffset: 6, nights: 3, status: 'confirmed',
    extraKeys: ['gps', 'driver'], insurance: 'full', promoCode: 'WEEKEND15', plan: 'deposit',
  });
  addBooking({ userId: 'usr-maya', vehicleId: 'veh-911', startOffset: 21, nights: 2, status: 'pending', insurance: 'standard', paid: false });
  addBooking({ userId: 'usr-maya', vehicleId: 'veh-i4', startOffset: -20, nights: 3, status: 'cancelled', insurance: 'basic' });

  // Live fleet states --------------------------------------------------------
  addBooking({ userId: 'usr-jordan', vehicleId: 'veh-m4', startOffset: 10, nights: 2, status: 'pending', extraKeys: ['gps'], insurance: 'full', paid: false, notes: 'Please keep a child seat ready for pick-up.' });
  addBooking({ userId: 'usr-priya', vehicleId: 'veh-gle', startOffset: 2, nights: 3, status: 'confirmed', plan: 'deposit', promoCode: 'AUTUMN20' });
  addBooking({ userId: 'usr-anna', vehicleId: 'veh-wrangler', startOffset: -1, nights: 4, status: 'active', extraKeys: ['roadside'], insurance: 'standard', pickupLocation: 'Goa — Panaji', dropoffLocation: 'Goa — Panaji' });
  addBooking({ userId: 'usr-luis', vehicleId: 'veh-camry', startOffset: -6, nights: 4, status: 'completed' });
  addBooking({ userId: 'usr-jordan', vehicleId: 'veh-a5', startOffset: -13, nights: 3, status: 'completed', extraKeys: ['gps'], insurance: 'full' });
  addBooking({ userId: 'usr-noah', vehicleId: 'veh-miata', startOffset: -60, nights: 5, status: 'cancelled', insurance: 'basic' });
  addBooking({ userId: 'usr-priya', vehicleId: 'veh-c300', startOffset: 32, nights: 3, status: 'confirmed', insurance: 'full', notes: 'Late arrival — flight lands at 21:40.' });
  addBooking({ vehicleId: 'veh-california', guest: { name: 'Elena Rossi', email: 'elena.rossi@example.com', phone: '+91 98220 44556' }, startOffset: 14, nights: 3, status: 'confirmed', plan: 'deposit', promoCode: 'ROVE1500', pickupLocation: 'Goa — Panaji', dropoffLocation: 'Goa — Panaji' });
  addBooking({ vehicleId: 'veh-a5', guest: { name: 'Marcus Webb', email: 'marcus.webb@example.com', phone: '+91 90000 77881' }, startOffset: -30, nights: 3, status: 'completed', insurance: 'standard' });

  // Six months of completed trips for analytics.
  const historyUsers = ['usr-jordan', 'usr-priya', 'usr-luis', 'usr-anna', 'usr-maya', 'usr-noah'];
  const historyVehicles = vehicles.filter((vehicle) => vehicle.status !== 'maintenance').map((vehicle) => vehicle.id);
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo -= 1) {
    for (let k = 0; k < 3; k += 1) {
      const index = monthsAgo * 3 + k;
      addBooking({
        userId: historyUsers[index % historyUsers.length],
        vehicleId: historyVehicles[(index * 3 + k) % historyVehicles.length],
        startOffset: -(monthsAgo * 30 + 8 + k * 7),
        nights: 2 + ((index + k) % 3),
        status: 'completed',
        extraKeys: index % 4 === 0 ? ['gps'] : [],
        insurance: index % 3 === 0 ? 'standard' : 'basic',
        createdOffset: -(monthsAgo * 30 + 12 + k * 7),
      });
    }
  }

  // A guest review tied to a real completed booking.
  const marcusBooking = state.bookings.find((booking) => booking.guestEmail === 'marcus.webb@example.com');
  if (marcusBooking) {
    reviews.push({
      id: 'rev-guest-a5',
      vehicleId: 'veh-a5',
      userId: null,
      bookingId: null,
      author: 'Marcus Webb',
      rating: 5,
      comment: 'Picked up from Pune and drove to Mahabaleshwar. Spotless car and a genuinely easy handover.',
      createdAt: new Date(Date.now() - 26 * 86400000).toISOString(),
    });
  }

  // The A5 is the fleet's long-term favourite, so it carries a deeper review
  // history than the rest — enough to exercise the vehicle page's full list.
  [
    { author: 'Nikhil Rao', rating: 5, daysAgo: 58, comment: 'Booked for a client visit and the car did the job perfectly. Quiet cabin, clean interiors, no surprises at drop-off.' },
    { author: 'Sara D’Souza', rating: 4, daysAgo: 47, comment: 'Great drive and very comfortable. Pick-up took a little longer than expected on a Sunday morning, but the team kept me updated.' },
    { author: 'Aditya Kulkarni', rating: 5, daysAgo: 35, comment: 'Second time renting this one. Handover is quick, the fuel policy is fair, and the car feels new.' },
    { author: 'Meera Iyer', rating: 4, daysAgo: 19, comment: 'Lovely car for a weekend in Lonavala. Would have liked a second phone mount, otherwise spotless.' },
  ].forEach((entry, index) => {
    reviews.push({
      id: `rev-a5-history-${index + 1}`,
      vehicleId: 'veh-a5',
      userId: null,
      bookingId: null,
      author: entry.author,
      rating: entry.rating,
      comment: entry.comment,
      createdAt: new Date(Date.now() - entry.daysAgo * 86400000).toISOString(),
    });
  });

  // Richer review history across the popular fleet so rating bubbles, cards and
  // the moderation board all read as lived-in on first load.
  const EXTRA_REVIEWS = [
    { vehicleId: 'veh-velar', author: 'Ananya Rao', rating: 5, daysAgo: 41, comment: 'The Velar is a proper boss-mobile. Silent cabin, effortless torque, and the valet at Bandra knew exactly where to park it.' },
    { vehicleId: 'veh-velar', author: 'Kabir Singh', rating: 4, daysAgo: 22, comment: 'Loved the car. Pick-up queue was short and the handover sheet was honest about one tiny scuff we did not worry about.' },
    { vehicleId: 'veh-911', author: 'Dev Malhotra', rating: 5, daysAgo: 30, comment: 'Drove Pune to Lavasa and back. The 911 makes a boring Sunday feel like a launch event.' },
    { vehicleId: 'veh-911', author: 'Meera Iyer', rating: 4, daysAgo: 9, comment: 'Superb car, quick collection. Fuel check-in was fair and the drop-off to a different hub was handled smoothly.' },
    { vehicleId: 'veh-gle', author: 'Sara Fernandes', rating: 5, daysAgo: 44, comment: 'Family of five, bags for a week — the GLE swallowed everything and asked for more.' },
    { vehicleId: 'veh-gle', author: 'Nikhil Bansal', rating: 4, daysAgo: 12, comment: 'Comfortable, quiet, easy to park. Deposit was released within two working days as promised.' },
    { vehicleId: 'veh-camry', author: 'Vikram Sethi', rating: 5, daysAgo: 38, comment: 'The Camry is the sensible choice done beautifully. 23 kmpl and a boot big enough for Mumbai errands plus a beach weekend.' },
    { vehicleId: 'veh-camry', author: 'Ritika Jain', rating: 4, daysAgo: 16, comment: 'Reliable, roomy and spotless. Reminder to carry the RC — the app told us, but we still left it at home first time.' },
    { vehicleId: 'veh-creta', author: 'Arjun Nair', rating: 5, daysAgo: 27, comment: 'Booked the Creta for a hill trip. Sunroof on, AC on, trouble-free. Kids did not want to get out.' },
    { vehicleId: 'veh-creta', author: 'Pooja Reddy', rating: 3, daysAgo: 6, comment: 'Fine car overall. Pick-up took twenty minutes because the previous return ran late — road tea nearby saved the wait.' },
    { vehicleId: 'veh-mustang', author: 'Farah Khan', rating: 5, daysAgo: 33, comment: 'Top down along the coast with the V8 growling. Pure magic, and the drop-off desk had the deposit refund booked before we left.' },
    { vehicleId: 'veh-miata', author: 'Tanvi Desai', rating: 5, daysAgo: 48, comment: 'The Miata is everything. Light, quick, and the roof-down monsoon drive through the ghats will be my year highlight.' },
    { vehicleId: 'veh-apachertr160', author: 'Karan Ahuja', rating: 5, daysAgo: 21, comment: 'Rented the Apache for a weekend run to Lonavala. Sharp handling, spotless tank, and the helmet policy is a real plus.' },
    { vehicleId: 'veh-ktm390duke', author: 'Rahul Verma', rating: 4, daysAgo: 11, comment: 'The Duke is a hooligan in the best way. Took a while to find a 6pm return slot, but the bike was ready and the papers were in the pannier.' },
    { vehicleId: 'veh-ather450x', author: 'Pooja Reddy', rating: 4, daysAgo: 5, comment: 'City riding on electric is the future — 110 km of range was plenty for a day in Bengaluru. Meter display and phone mount were a welcome touch.' },
  ];
  EXTRA_REVIEWS.forEach((entry, index) => {
    reviews.push({
      id: `rev-fleet-${index + 1}`,
      vehicleId: entry.vehicleId,
      userId: null,
      bookingId: null,
      author: entry.author,
      rating: entry.rating,
      comment: entry.comment,
      createdAt: new Date(Date.now() - entry.daysAgo * 86400000).toISOString(),
    });
  });

  // More reviews for vehicles that are thin on feedback — bikes, budget cars and
  // recently added fleet members — so every vehicle page has a populated review
  // tab and the analytics star-mix reads as statistically meaningful.
  const MORE_REVIEWS = [
    { vehicleId: 'veh-modely', author: 'Ananya Rao', rating: 4, daysAgo: 15, comment: 'Good little car for city hops. Reverse cam made parking feel like cheating.' },
    { vehicleId: 'veh-modely', author: 'Siddharth Mehra', rating: 3, daysAgo: 36, comment: 'Decent for the price but the clutch felt a bit worn. Mentioned at drop-off and the desk said they would check it.' },
    { vehicleId: 'veh-wrangler', author: 'Anna Koshy', rating: 5, daysAgo: 7, comment: "Took the Wrangler off-road near Lonavala and it handled everything. Can't wait to drive it again." },
    { vehicleId: 'veh-m4', author: 'Jordan Blake', rating: 4, daysAgo: 33, comment: 'The M4 is a beast. Only wish is they had it ready a few minutes earlier but the spec sheet was on point.' },
    { vehicleId: 'veh-m4', author: 'Amrita Das', rating: 5, daysAgo: 8, comment: 'Took the M4 for a birthday surprise drive. Staff even hid a little card in the glovebox — nice touch.' },
    { vehicleId: 'veh-wrangler', author: 'Vikram Sharma', rating: 5, daysAgo: 14, comment: 'Nothing beats the Wrangler on a Goa beach run. Roof off, music on, and zero worries about the dirt — it belongs there.' },
    { vehicleId: 'veh-creta', author: 'Karan Mehta', rating: 3, daysAgo: 42, comment: 'Fun car but the AC struggles in peak heat. Also noticed a dent on the rear left that was not on the handover photos.' },
    { vehicleId: 'veh-i4', author: 'Rohit Choudhury', rating: 5, daysAgo: 10, comment: 'My first EV rental and it was surprisingly easy. Charged to 85% overnight and had enough for a full day Bangalore–Kolar loop.' },
    { vehicleId: 'veh-i4', author: 'Meera Sood', rating: 4, daysAgo: 35, comment: 'Smooth, quiet, handsome car. The charging cable was in the boot as promised.' },
    { vehicleId: 'veh-california', author: 'Elena Rossi', rating: 5, daysAgo: 4, comment: 'Drove the California from Panaji to Ganpatipule. Wind in the hair, no traffic, and the boot fit two suitcases with room for souvenirs.' },
    { vehicleId: 'veh-california', author: 'Zubair Ali', rating: 4, daysAgo: 29, comment: 'The California turns heads. Pick-up was quick, and the one-way drop to Pune was sorted on the spot.' },
    { vehicleId: 'veh-c300', author: 'Vivek Saxena', rating: 4, daysAgo: 20, comment: 'Solid, safe, comfortable. No frills but nothing to complain about — exactly what you want from a weekend hire.' },
    { vehicleId: 'veh-c300', author: 'Rini Sen', rating: 5, daysAgo: 45, comment: 'Picked up from Banjara Hills for a Hyderabad–Warangal round trip. Factory-fresh interiors and the mileage was a pleasant surprise.' },
    { vehicleId: 'veh-ktm390duke', author: 'Dhruv Jain', rating: 5, daysAgo: 25, comment: 'First time on the Duke and wow. The Power Parts exhaust makes a deep bass note that every biker needs to hear at least once.' },
    { vehicleId: 'veh-apachertr160', author: 'Sunil More', rating: 3, daysAgo: 17, comment: 'Good commuter bike, well maintained. The helmet provided was a bit tight but they swapped it without fuss.' },
    { vehicleId: 'veh-ather450x', author: 'Sneha Reddy', rating: 5, daysAgo: 2, comment: 'Rode around MG Road and Indiranagar on the Ather. Quiet, zippy, and the app integration showing charge status was handy.' },
    { vehicleId: 'veh-ather450x', author: 'Arun Nair', rating: 3, daysAgo: 38, comment: 'Good for the environment but range anxiety is real. Needed a top-up at a charging station before returning.' },
    { vehicleId: 'veh-miata', author: 'Rishabh Khanna', rating: 4, daysAgo: 52, comment: 'The Miata is a secret weapon for a ghat drive. Not the fastest, but the cornering is ridiculous fun.' },
    { vehicleId: 'veh-mustang', author: "Liam D'Cruze", rating: 5, daysAgo: 56, comment: 'The V8 rumble at 6am on an empty Eastern Expressway — worth every rupee. Desk even let me park it back facing outward for photos.' },
    { vehicleId: 'veh-velar', author: 'Suman Kapoor', rating: 4, daysAgo: 18, comment: 'Luxurious, quiet, and the Meridian sound system is addictive. Automated the deposit refund without asking.' },
    { vehicleId: 'veh-gle', author: 'Nina Roy', rating: 4, daysAgo: 34, comment: 'Spacious and easy to drive. The Panoramic roof was a hit with the kids. Drop-off was quick because we returned it fuelled.' },
  ];
  MORE_REVIEWS.forEach((entry, index) => {
    reviews.push({
      id: `rev-more-${index + 1}`,
      vehicleId: entry.vehicleId,
      userId: null, bookingId: null,
      author: entry.author, rating: entry.rating,
      comment: entry.comment,
      createdAt: new Date(Date.now() - entry.daysAgo * 86400000).toISOString(),
    });
  });

  // Ratings derived from public reviews.
  vehicles.forEach((vehicle) => {
    const vehicleReviews = reviews.filter((review) => review.vehicleId === vehicle.id);
    if (vehicleReviews.length) {
      const average = vehicleReviews.reduce((sum, review) => sum + review.rating, 0) / vehicleReviews.length;
      vehicle.rating = Math.round(average * 10) / 10;
    }
  });

  // A few public staff replies so the Reviews console and vehicle pages show a
  // conversation rather than one-way feedback. Most reviews stay unanswered on
  // purpose — the "needs a reply" queue should have real work on first load.
  const replyTo = (predicate, text) => {
    const review = reviews.find((item) => !item.reply && predicate(item));
    if (!review) return;
    review.reply = typeof text === 'function' ? text(review) : text;
    review.repliedBy = 'Avery Ross';
    review.repliedAt = new Date(new Date(review.createdAt).getTime() + 36 * 3600000).toISOString();
  };
  replyTo(
    (review) => review.vehicleId === 'veh-creta' && review.rating <= 3,
    (review) => `Thanks for the honest note, ${review.author.split(' ')[0]}. The handover delay was on us — we have added a second desk slot at peak pick-up times so the next one is quicker.`,
  );
  replyTo(
    (review) => review.vehicleId === 'veh-velar',
    'Appreciate the detailed review. The Velar is due its next service this month and we will double-check the cabin before every handover.',
  );
  replyTo(
    (review) => review.vehicleId === 'veh-apachertr160',
    'Glad the Apache delivered. Helmets are included with every bike booking — ride safe and we will see you on the next one.',
  );
  replyTo(
    (review) => review.vehicleId === 'veh-ather450x',
    'Thank you! We keep every Ather charged to at least 90% before pick-up, and the phone mount is now standard on the electric fleet.',
  );
  replyTo(
    (review) => review.vehicleId === 'veh-911',
    'Thanks for taking the time to write this. We have shared it with the Bandra team — it made their week.',
  );
  replyTo(
    (review) => review.vehicleId === 'veh-camry',
    'Really useful feedback on the pick-up paperwork. We have trimmed the checklist to the essentials so handover is quicker without cutting any safety step.',
  );

  // Deposit money movement at the desks — a rich, self-consistent ledger so the
  // Finance ledger, refunds-by-method analytics and the customer transaction
  // history all show real numbers on first load. Settlements use the same pure
  // maths the returns desk applies, so charges, refunds and statuses can never
  // disagree with the amount on hold.
  const settle = (code, fees = {}, refundMethod = null) => {
    const booking = state.bookings.find((item) => item.code === code);
    if (!booking) return;
    const computed = settlementFor({ holdAmount: Number(booking.holdAmount) || 0, ...fees });
    if (computed.refundDue > 0 && REFUND_METHODS.includes(refundMethod)) computed.refundMethod = refundMethod;
    booking.depositSettlement = { ...computed, checkedBy: 'staff', chargedAt: `${booking.endDate}T17:30:00.000Z` };
    booking.completedAt = `${booking.endDate}T17:45:00.000Z`;
    booking.depositCollected = {
      amount: Number(booking.holdAmount) || 0,
      method: 'upi',
      reference: `UPI ${booking.code.slice(-6)}`,
      at: `${booking.startDate}T09:20:00.000Z`,
      byName: 'Avery Ross',
    };
    booking.returnChecks = { keys: true, fuel: true, condition: true, cleaning: true, deposit: true };
  };

  // Settled returns — a realistic mix of released, partially-deducted,
  // fully-deducted and over-deposit outcomes with real refund routes.
  settle('RV-D1021', { damageFee: 1200, cleaningFee: 300 }, 'bank');
  settle('RV-D1022', { damageFee: 5000 });
  settle('RV-D1029', {}, 'upi');
  settle('RV-D1030', { damageFee: 1800 }, 'original');
  settle('RV-D1034', {}, 'bank');
  settle('RV-D1036', { damageFee: 7000 });
  settle('RV-D1038', {}, 'upi');
  settle('RV-D1040', { cleaningFee: 1200, fuelFee: 300 }, 'original');
  settle('RV-D1042', {}, 'bank');
  settle('RV-D1044', { damageFee: 4000, cleaningFee: 2000 });
  settle('RV-D1046', { damageFee: 1500, excessKmFee: 500 }, 'upi');
  settle('RV-D1058', { damageFee: 1000 }, 'bank');
  settle('RV-D1061', { damageFee: 800, cleaningFee: 200 }, 'upi');
  settle('RV-D1062', {}, 'original');
  settle('RV-D1063', { damageFee: 2000 }, 'bank');

  // Anna's active trip collected the deposit at the counter.
  const annaWrangler = state.bookings.find((item) => item.code === 'RV-D1028');
  if (annaWrangler) {
    annaWrangler.depositCollected = {
      amount: Number(annaWrangler.holdAmount) || 0,
      method: 'card',
      reference: 'Card POS 4412',
      at: `${annaWrangler.startDate}T09:15:00.000Z`,
      byName: 'Sam Okafor',
    };
  }

  state.favorites = [
    { userId: 'usr-maya', vehicleId: 'veh-911' },
    { userId: 'usr-maya', vehicleId: 'veh-gle' },
    { userId: 'usr-maya', vehicleId: 'veh-velar' },
  ];

  // Wrangler is out with Anna.
  const wrangler = vehicleById('veh-wrangler');
  if (wrangler) wrangler.status = 'rented';

  // Admin-controlled availability blocks. These deliberately sit after the
  // seeded customer bookings so staff can see both kinds of occupancy.
  state.vehicleBlocks = [
    {
      id: 'blk-i4-buffer',
      vehicleId: 'veh-i4',
      startDate: dateAt(3),
      endDate: dateAt(5),
      kind: 'buffer',
      reason: 'Deep clean and handover buffer',
      notes: 'Keep off the public calendar until the detailer signs off.',
      createdBy: 'usr-manager',
      createdAt: createdAt(-1, 9),
      updatedAt: createdAt(-1, 9),
    },
    {
      id: 'blk-m4-service',
      vehicleId: 'veh-m4',
      startDate: dateAt(18),
      endDate: dateAt(20),
      kind: 'maintenance',
      reason: 'Scheduled brake and tyre service',
      notes: 'Workshop slot confirmed with the Bandra service centre.',
      createdBy: 'usr-admin',
      createdAt: createdAt(-4, 14),
      updatedAt: createdAt(-4, 14),
    },
    {
      id: 'blk-911-shoot',
      vehicleId: 'veh-911',
      startDate: dateAt(30),
      endDate: dateAt(32),
      kind: 'private',
      reason: 'Brand photography',
      notes: 'Do not release to customers; crew collects at 08:00.',
      createdBy: 'usr-admin',
      createdAt: createdAt(-8, 10),
      updatedAt: createdAt(-8, 10),
    },
  ];

  // Real service baselines and work history. The wear fractions deliberately
  // produce overdue, due-soon and healthy vehicles so every board state is
  // visible on first load.
  const serviceWear = [0.72, 0.9, 1.08, 0.82, 0.98, 0.55, 0.76, 0.92, 0.64, 0.87, 1.14, 0.69];
  const workshops = [
    'Bandra Auto Works', 'Aerocity Motor Lab', 'Indiranagar Service Bay',
    'Banjara Hills Garage', 'Panaji Workshop', 'Koregaon Auto Care', 'Nungambakkam Motors',
  ];
  const serviceKinds = ['service', 'inspection', 'repair'];
  vehicles.forEach((vehicle, index) => {
    const intervalKm = Number(vehicle.serviceIntervalKm) || 10000;
    const intervalDays = Number(vehicle.serviceIntervalDays) || 180;
    const wear = serviceWear[index % serviceWear.length];
    const lastOdometer = Math.max(0, Number(vehicle.odometer || 0) - Math.round(intervalKm * wear));
    vehicle.lastServiceDate = dateAt(-Math.round(intervalDays * wear));
    vehicle.lastServiceOdometer = lastOdometer;

    const city = String(vehicle.location || '').split('—')[0].trim() || 'Rove';
    const workshop = workshops[index % workshops.length] || `${city} Service Centre`;
    const latestKind = index % 5 === 0 ? 'inspection' : 'service';
    const latestCost = 3200 + (index % 7) * 1250;

    const pushLog = (offsetDays, odometer, kind, cost, reference, notes) => {
      state.serviceLogs.push({
        id: `svc-${vehicle.id}-${offsetDays}`,
        vehicleId: vehicle.id,
        serviceDate: dateAt(offsetDays),
        odometer,
        kind,
        cost,
        vendor: workshop,
        reference,
        notes,
        resetsService: ['service', 'inspection', 'tyre'].includes(kind),
        createdBy: 'usr-manager',
        createdAt: createdAt(offsetDays, 15),
        updatedAt: createdAt(offsetDays, 15),
      });
    };

    pushLog(
      -Math.round(intervalDays * wear),
      lastOdometer,
      latestKind,
      latestCost,
      `WO-${String(4100 + index).padStart(4, '0')}`,
      latestKind === 'inspection' ? 'Multi-point inspection signed off.' : 'Routine service, fluids and filters replaced.',
    );
    pushLog(
      -Math.round(intervalDays * wear) - Math.round(intervalDays * 0.82),
      Math.max(0, lastOdometer - Math.round(intervalKm * 0.82)),
      serviceKinds[index % serviceKinds.length],
      2100 + (index % 5) * 950,
      `WO-${String(3900 + index).padStart(4, '0')}`,
      index % 3 === 0 ? 'Brake pads checked and front tyres rotated.' : 'Scheduled maintenance completed by the workshop.',
    );
  });
  state.serviceLogs.sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate)));

  // A handful of recent non-resetting visits keep the six-month spend trend
  // realistic without moving any vehicle's scheduled-service baseline.
  [
    { days: 6, kind: 'repair', cost: 1850, note: 'Coolant top-up and hose check.' },
    { days: 19, kind: 'bodywork', cost: 7200, note: 'Rear bumper scuff repaired and repainted.' },
    { days: 34, kind: 'tyre', cost: 4600, note: 'Front tyre replaced after a puncture.' },
    { days: 48, kind: 'repair', cost: 2300, note: 'Battery terminals cleaned and tested.' },
    { days: 8, kind: 'repair', cost: 3100, note: 'AC gas recharge and cabin filter replacement.' },
    { days: 14, kind: 'bodywork', cost: 5400, note: 'Scratch on the left rear door panel — resprayed and polished.' },
    { days: 22, kind: 'inspection', cost: 1800, note: 'Pre-monsoon inspection — brake pads, tyre tread and wipers all good.' },
    { days: 40, kind: 'repair', cost: 4200, note: 'Timing belt replacement as per the scheduled maintenance plan.' },
    { days: 55, kind: 'tyre', cost: 6800, note: 'Rear right tyre replaced — sidewall bulge detected during pre-rental walkaround.' },
  ].forEach((visit, index) => {
    const vehicle = vehicles[index];
    if (!vehicle) return;
    const odometer = Math.max(0, Number(vehicle.odometer || 0) - 20 - index * 15);
    state.serviceLogs.push({
      id: `svc-${vehicle.id}-recent-${index}`,
      vehicleId: vehicle.id,
      serviceDate: dateAt(-visit.days),
      odometer,
      kind: visit.kind,
      cost: visit.cost,
      vendor: workshops[(index + 2) % workshops.length],
      reference: `WO-${String(4400 + index).padStart(4, '0')}`,
      notes: visit.note,
      resetsService: false,
      createdBy: 'usr-manager',
      createdAt: createdAt(-visit.days, 11),
      updatedAt: createdAt(-visit.days, 11),
    });
  });
  state.serviceLogs.sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate)));

  // A few illustrative entries so the audit view has context on first load.
  // Real mutations append to this list through the demo API.
  state.auditLogs = [
    {
      id: 'aud-seed-1',
      actorId: 'usr-admin',
      actorName: 'Avery Ross',
      actorRole: 'admin',
      action: 'insert',
      entityType: 'vehicle_blocks',
      entityId: 'blk-m4-service',
      summary: 'Vehicle blocks insert · blk-m4-service',
      metadata: { changed: {} },
      createdAt: createdAt(-4, 14),
    },
    {
      id: 'aud-seed-2',
      actorId: 'usr-manager',
      actorName: 'Riya Kapoor',
      actorRole: 'manager',
      action: 'update',
      entityType: 'bookings',
      entityId: 'RV-D1024',
      summary: 'Bookings update · RV-D1024',
      metadata: {
        changed: {
          status: { from: 'pending', to: 'confirmed' },
        },
      },
      createdAt: createdAt(-2, 16),
    },
    {
      id: 'aud-seed-3',
      actorId: 'usr-admin',
      actorName: 'Avery Ross',
      actorRole: 'admin',
      action: 'update',
      entityType: 'settings',
      entityId: 'min_rental_days',
      summary: 'Settings update · min_rental_days',
      metadata: {
        changed: {
          value: { from: '2', to: '1' },
        },
      },
      createdAt: createdAt(-1, 11),
    },
  ];

  // A living customer notification inbox + badge on a fresh install. Mirrors
  // the shapes `notify()` writes so read/unread and badges behave identically.
  const hoursAgoNote = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
  state.notifications = [
    {
      id: 'ntf-seed-confirmed', audience: 'user', userId: 'usr-maya', kind: 'booking_confirmed',
      title: 'Booking confirmed',
      body: 'Your RV-D1023 rental in the Range Rover Velar is confirmed. The ₹5,000 security deposit is collected at pick-up and returned within 5–7 working days of drop-off.',
      bookingCode: 'RV-D1023', link: '/confirmation/RV-D1023',
      createdAt: hoursAgoNote(120), readAt: hoursAgoNote(90),
    },
    {
      id: 'ntf-seed-deposit', audience: 'user', userId: 'usr-maya', kind: 'deposit_due',
      title: 'Deposit due at pick-up',
      body: 'Bring ₹5,000 for RV-D1023 at pick-up, along with your driving licence and a government photo ID.',
      bookingCode: 'RV-D1023', link: '/confirmation/RV-D1023',
      createdAt: hoursAgoNote(46),
    },
    {
      id: 'ntf-seed-settled', audience: 'user', userId: 'usr-maya', kind: 'deposit_settled',
      title: 'Deposit settled with deductions',
      body: '₹1,500 was deducted from your RV-D1021 deposit; ₹3,500 is on its way back to the original payment method.',
      bookingCode: 'RV-D1021', link: '/confirmation/RV-D1021',
      createdAt: hoursAgoNote(20),
    },
    {
      id: 'ntf-seed-done', audience: 'user', userId: 'usr-maya', kind: 'booking_completed',
      title: 'Trip complete — rate your rental',
      body: 'RV-D1022 is complete. If you have a moment, a short review helps the next driver choose with confidence.',
      bookingCode: 'RV-D1022', link: '/confirmation/RV-D1022',
      createdAt: hoursAgoNote(6),
    },
    // Other customers get a lived-in inbox too, so switching demo accounts never
    // lands on an empty notifications tab.
    {
      id: 'ntf-seed-jordan', audience: 'user', userId: 'usr-jordan', kind: 'booking_pending',
      title: 'Booking received — awaiting approval',
      body: 'RV-D1026 (BMW M4 Competition) is with our team for a quick approval. We will confirm within 30 minutes during desk hours.',
      bookingCode: 'RV-D1026', link: '/confirmation/RV-D1026',
      createdAt: hoursAgoNote(31),
    },
    {
      id: 'ntf-seed-priya', audience: 'user', userId: 'usr-priya', kind: 'booking_confirmed',
      title: 'Your GLE 450 is confirmed',
      body: 'RV-D1027 is confirmed for 1 November. The ₹5,000 deposit is collected at pick-up along with your licence and photo ID.',
      bookingCode: 'RV-D1027', link: '/confirmation/RV-D1027',
      createdAt: hoursAgoNote(70), readAt: hoursAgoNote(64),
    },
    {
      id: 'ntf-seed-priya-deposit', audience: 'user', userId: 'usr-priya', kind: 'deposit_due',
      title: 'Deposit due at pick-up',
      body: 'Bring ₹5,000 for RV-D1027 at pick-up. Card, UPI and cash are all accepted at the desk.',
      bookingCode: 'RV-D1027', link: '/confirmation/RV-D1027',
      createdAt: hoursAgoNote(18),
    },
    {
      id: 'ntf-seed-anna', audience: 'user', userId: 'usr-anna', kind: 'trip_started',
      title: 'Your Wrangler trip has started',
      body: 'RV-D1028 is active. Unlimited kilometres, roadside assistance included — call the Goa desk if anything feels off.',
      bookingCode: 'RV-D1028', link: '/confirmation/RV-D1028',
      createdAt: hoursAgoNote(26), readAt: hoursAgoNote(24),
    },
    {
      id: 'ntf-seed-luis', audience: 'user', userId: 'usr-luis', kind: 'booking_pending',
      title: 'Booking received — awaiting approval',
      body: 'RV-D1055 (Audi A5) is waiting for approval. You will not be charged until it is confirmed.',
      bookingCode: 'RV-D1055', link: '/confirmation/RV-D1055',
      createdAt: hoursAgoNote(44),
    },
    {
      id: 'ntf-seed-noah', audience: 'user', userId: 'usr-noah', kind: 'booking_confirmed',
      title: 'Booking confirmed',
      body: 'RV-D1053 (Hyundai Creta SX) is confirmed for 17 November. Full refund if you cancel at least 2 days before pick-up.',
      bookingCode: 'RV-D1053', link: '/confirmation/RV-D1053',
      createdAt: hoursAgoNote(52), readAt: hoursAgoNote(50),
    },
    // Staff feed: the dashboard should read like a shift handover on first load.
    {
      id: 'ntf-staff-seed', audience: 'staff', kind: 'booking_pending',
      title: 'New booking awaiting approval',
      body: 'RV-D1026 (BMW M4 Competition) from Jordan Blake is waiting for approval.',
      bookingCode: 'RV-D1026', link: '/admin/bookings?status=pending',
      createdAt: hoursAgoNote(7),
    },
    {
      id: 'ntf-staff-change', audience: 'staff', kind: 'change_request',
      title: 'Change request to review',
      body: 'Maya Chen asked to move RV-D1023 to 7–10 November (+₹2,633). Approve or decline from the booking drawer.',
      bookingCode: 'RV-D1023', link: '/admin/bookings?change=pending',
      createdAt: hoursAgoNote(22),
    },
    {
      id: 'ntf-staff-service', audience: 'staff', kind: 'service_overdue',
      title: '4 vehicles are past their service interval',
      body: 'Mahindra Scorpio X, KTM 390 Duke and two more need workshop slots. Clear them before the weekend rush.',
      link: '/admin/maintenance',
      createdAt: hoursAgoNote(30),
    },
    {
      id: 'ntf-staff-message', audience: 'staff', kind: 'contact_message',
      title: 'New message in the inbox',
      body: 'A customer asked about one-way rentals from Mumbai to Goa. Reply from Admin → Inbox.',
      link: '/admin/inbox',
      createdAt: hoursAgoNote(9),
    },
    {
      id: 'ntf-staff-confirmed', audience: 'staff', kind: 'booking_confirmed',
      title: 'Booking confirmed',
      body: 'Elena Rossi confirmed RV-D1054 — California road trip from Goa, 3 Nov.',
      bookingCode: 'RV-D1054', link: '/admin/bookings?status=confirmed',
      createdAt: hoursAgoNote(15),
    },
    {
      id: 'ntf-staff-deposit', audience: 'staff', kind: 'deposit_collected',
      title: 'Deposit collected at desk',
      body: '₹5,000 deposit collected from Priya Nair for RV-D1027 — UPI payment confirmed.',
      bookingCode: 'RV-D1027', link: '/admin/bookings?code=RV-D1027',
      createdAt: hoursAgoNote(28),
    },
  ];

  // Maya's saved availability watches so the Account alerts list is alive.
  const mayaAlerts = userById('usr-maya');
  if (mayaAlerts) {
    mayaAlerts.alerts = [
      { id: 'al-seed-911', vehicleId: 'veh-911', startDate: dateAt(12), endDate: dateAt(14), createdAt: createdAt(-6, 10), active: true },
      { id: 'al-seed-gle', vehicleId: 'veh-gle', startDate: dateAt(20), endDate: dateAt(23), createdAt: createdAt(-3, 10), active: true },
      { id: 'al-seed-wrangler', vehicleId: 'veh-wrangler', startDate: dateAt(8), endDate: dateAt(11), createdAt: createdAt(-1, 10), active: true },
    ];
  }

  // A pending change request on Maya's confirmed Velar so the staff drawer and
  // the customer Manage page both demo the approval workflow on first load.
  const velarBooking = state.bookings.find((item) => item.code === 'RV-D1023');
  if (velarBooking) {
    const velarVehicle = vehicleById(velarBooking.vehicleId);
    const next = { startDate: dateAt(9), endDate: dateAt(12), pickupLocation: velarBooking.pickupLocation, dropoffLocation: velarBooking.dropoffLocation, pickupTime: '10:00', dropoffTime: '18:00' };
    if (velarVehicle) {
      const shiftQuote = calculateQuote({
        vehicle: velarVehicle, startDate: next.startDate, endDate: next.endDate,
        extras: velarBooking.extras ?? [], extrasCatalog: extras, insuranceTiers,
        insurance: velarBooking.insurance, promo: velarBooking.promoCode ? promoByCode(velarBooking.promoCode) : null,
        settings, pickupLocation: next.pickupLocation, dropoffLocation: next.dropoffLocation,
        paymentPlan: velarBooking.paymentPlan, skipValidation: true,
      });
      velarBooking.changeRequest = {
        status: 'pending',
        ...next,
        days: shiftQuote.days,
        total: shiftQuote.total,
        fees: shiftQuote.fees,
        taxRate: shiftQuote.taxRate,
        taxInclusive: shiftQuote.taxInclusive,
        requestedAt: `${dateAt(-1)}T13:20:00.000Z`,
      };
    }
  }

  // Trip-activity history on two highlights so the extension trail has context.
  const d1021 = state.bookings.find((item) => item.code === 'RV-D1021');
  if (d1021) {
    d1021.tripChanges = [{
      type: 'extension', at: `${dateAt(-42)}T11:00:00.000Z`, by: 'Maya Chen',
      summary: 'Return 2026-09-19 10:00 → 2026-09-21 18:00', from: '2026-09-19', to: '2026-09-21', delta: 8792,
    }];
  }
  const d1038 = state.bookings.find((item) => item.code === 'RV-D1038');
  if (d1038) {
    d1038.tripChanges = [{
      type: 'extension', at: `${dateAt(-140)}T14:00:00.000Z`, by: 'Avery Ross',
      summary: 'Return extended +1 day for the customer', from: d1038.endDate, to: addDaysISO(d1038.endDate, 1), delta: 4600,
    }];
  }

  // A few more committed and prospective bookings across the next weeks so the
  // calendar, desk and availability boards have depth beyond the current week.
  addBooking({ userId: 'usr-noah', vehicleId: 'veh-creta', startOffset: 18, nights: 2, status: 'confirmed', insurance: 'standard' });
  addBooking({ vehicleId: 'veh-camry', guest: { name: 'Anjali Mehta', email: 'anjali.mehta@example.com', phone: '+91 98450 22331' }, startOffset: 24, nights: 4, status: 'confirmed', plan: 'deposit' });
  addBooking({ userId: 'usr-luis', vehicleId: 'veh-a5', startOffset: 35, nights: 3, status: 'pending', insurance: 'full', paid: false });
  addBooking({ userId: 'usr-priya', vehicleId: 'veh-i4', startOffset: 9, nights: 2, status: 'confirmed', insurance: 'basic' });
  addBooking({ userId: 'usr-jordan', vehicleId: 'veh-c300', startOffset: 44, nights: 3, status: 'pending', paid: false });

  // Walk-in guest bookings — customers who booked without a user account from
  // the corporate desk or phone, so the desk flow, returns and analytics all
  // see a realistic share of guest vs registered traffic (~20%).
  addBooking({ vehicleId: 'veh-wrangler', guest: { name: 'Sunil Gavaskar', email: 'sg@example.com', phone: '+91 99880 11223' }, startOffset: 6, nights: 2, status: 'confirmed', plan: 'deposit' });
  addBooking({ vehicleId: 'veh-apachertr160', guest: { name: 'Dinesh Kumar', email: 'dinesh.k@example.com', phone: '+91 98765 00991' }, startOffset: 4, nights: 1, status: 'confirmed', plan: 'deposit' });
  addBooking({ vehicleId: 'veh-ather450x', guest: { name: 'Lakshmi Iyer', email: 'lakshmi.iyer@example.com', phone: '+91 98550 77661' }, startOffset: -26, nights: 2, status: 'completed', insurance: 'basic' });
  addBooking({ vehicleId: 'veh-modely', guest: { name: 'Rajesh Kapoor', email: 'rajesh.k@example.com', phone: '+91 99990 88771' }, startOffset: -8, nights: 3, status: 'completed' });
  addBooking({ vehicleId: 'veh-miata', guest: { name: 'Priyanka Chopra', email: 'priyanka.c@example.com', phone: '+91 97650 33441' }, startOffset: 15, nights: 2, status: 'confirmed', insurance: 'standard' });
  addBooking({ vehicleId: 'veh-velar', guest: { name: 'Adil Hussain', email: 'adil.h@example.com', phone: '+91 98220 55662' }, startOffset: -18, nights: 3, status: 'completed', insurance: 'full' });
  addBooking({ vehicleId: 'veh-i4', guest: { name: 'Nina Thomas', email: 'nina.thomas@example.com', phone: '+91 99000 11223' }, startOffset: -45, nights: 4, status: 'completed', insurance: 'standard' });
  addBooking({ vehicleId: 'veh-mustang', guest: { name: 'Chris Lobo', email: 'chris.l@example.com', phone: '+91 98110 99887' }, startOffset: 33, nights: 2, status: 'confirmed', plan: 'deposit' });
  addBooking({ vehicleId: 'veh-california', guest: { name: 'Anita Das', email: 'anita.d@example.com', phone: '+91 98333 44556' }, startOffset: -35, nights: 2, status: 'completed' });
  addBooking({ vehicleId: 'veh-wrangler', guest: { name: 'Varun Shetty', email: 'varun.s@example.com', phone: '+91 98444 55667' }, startOffset: 28, nights: 3, status: 'confirmed', insurance: 'standard', plan: 'deposit' });

  // December and January depth so the desk/calendar lookahead and demand trend
  // carry past the current month. Includes a mix of cars, a long trip and a
  // bike, plus one repeat customer booking again for the festive window.
  addBooking({ userId: 'usr-maya', vehicleId: 'veh-gle', startOffset: 46, nights: 3, status: 'confirmed', insurance: 'full', promoCode: 'AUTUMN20', plan: 'deposit' });
  addBooking({ userId: 'usr-priya', vehicleId: 'veh-camry', startOffset: 52, nights: 5, status: 'confirmed', insurance: 'standard', notes: 'Year-end family road trip.' });
  addBooking({ userId: 'usr-jordan', vehicleId: 'veh-m4', startOffset: 58, nights: 2, status: 'pending', paid: false, notes: 'New Year Eve booking — requested upgraded car.' });
  addBooking({ userId: 'usr-luis', vehicleId: 'veh-california', startOffset: 63, nights: 3, status: 'confirmed', plan: 'deposit' });
  addBooking({ vehicleId: 'veh-vclass', guest: { name: 'Tanvi Shah', email: 'tanvi.shah@example.com', phone: '+91 98910 22331' }, startOffset: 36, nights: 2, status: 'confirmed', insurance: 'full' });
  addBooking({ vehicleId: 'veh-ktm390duke', guest: { name: 'Aditya Rao', email: 'aditya.rao@example.com', phone: '+91 98220 77889' }, startOffset: 49, nights: 1, status: 'confirmed', plan: 'deposit' });
  addBooking({ userId: 'usr-anna', vehicleId: 'veh-miata', startOffset: 70, nights: 2, status: 'pending', paid: false, notes: 'Coastal drive after the New Year rush.' });
  addBooking({ vehicleId: 'veh-swift', guest: { name: 'Neil Fernandes', email: 'neil.f@example.com', phone: '+91 98456 11223' }, startOffset: 74, nights: 2, status: 'confirmed', insurance: 'basic' });

  // A couple of payments with non-standard statuses so the reconciliation panel
  // has failed/pending entries to display on first load.
  const failedBooking = state.bookings.find((item) => item.code === 'RV-D1055');
  if (failedBooking) {
    state.payments.push({
      id: 'pay-failed-1', bookingId: failedBooking.id, kind: 'payment', amount: 20000,
      currency: 'INR', status: 'failed', brand: 'Mastercard', last4: '7744',
      reference: 'pay_fail_attempt1', orderId: 'order_fail_1',
      createdAt: createdAt(-3, 11),
    });
    state.payments.push({
      id: 'pay-failed-2', bookingId: failedBooking.id, kind: 'payment', amount: 20000,
      currency: 'INR', status: 'failed', brand: 'UPI', last4: 'gpay',
      reference: 'pay_fail_attempt2', orderId: 'order_fail_2',
      createdAt: createdAt(-2, 11),
    });
  }
  const pendingBooking = state.bookings.find((item) => item.code === 'RV-D1057');
  if (pendingBooking) {
    state.payments.push({
      id: 'pay-pending-1', bookingId: pendingBooking.id, kind: 'payment', amount: 15000,
      currency: 'INR', status: 'created', brand: 'Netbanking', last4: 'hdfc',
      reference: 'pay_pending_hdfc', orderId: 'order_pending_1',
      createdAt: createdAt(-1, 9),
    });
  }

  // A few illustrative audit entries covering settlement, reminders and blocks
  // so the audit console reads as lived-in before anyone clicks Save.
  state.auditLogs.push(
    {
      id: 'aud-seed-4', actorId: 'usr-admin', actorName: 'Avery Ross', actorRole: 'admin', action: 'update',
      entityType: 'bookings', entityId: 'RV-D1042',
      summary: 'Return settled for RV-D1042 — deposit released ₹5,000 via bank transfer',
      metadata: { changed: { depositSettlement: { from: null, to: 'released' } } },
      createdAt: createdAt(-30, 17),
    },
    {
      id: 'aud-seed-5', actorId: 'usr-manager', actorName: 'Sam Okafor', actorRole: 'manager', action: 'update',
      entityType: 'bookings', entityId: 'RV-D1038',
      summary: 'Sent the pick-up reminder for RV-D1038',
      metadata: { change: 'pickupReminder' },
      createdAt: createdAt(-148, 9),
    },
    {
      id: 'aud-seed-6', actorId: 'usr-manager', actorName: 'Sam Okafor', actorRole: 'manager', action: 'update',
      entityType: 'bookings', entityId: 'RV-D1027',
      summary: 'Handover checklist updated for RV-D1027',
      metadata: { changed: { deskChecks: { from: null, to: { licence: true, age: true, insurance: true, payment: true, deposit: false } } } },
      createdAt: createdAt(-1, 12),
    },
    // Additional audit entries for richer admin audit-log history.
    {
      id: 'aud-seed-7', actorId: 'usr-manager', actorName: 'Riya Kapoor', actorRole: 'manager', action: 'update',
      entityType: 'pricing', entityId: 'veh-mustang',
      summary: 'Seasonal rate adjustment — Mustang weekend price revised to ₹9,500/day',
      metadata: { changed: { weekendRate: { from: 8900, to: 9500 } } },
      createdAt: createdAt(-14, 10),
    },
    {
      id: 'aud-seed-8', actorId: 'usr-admin', actorName: 'Avery Ross', actorRole: 'admin', action: 'delete',
      entityType: 'promos', entityId: 'SUMMER25',
      summary: 'Expired promo SUMMER25 removed from the active set',
      metadata: { detail: 'Campaign ended 30 September 2026' },
      createdAt: createdAt(-25, 16),
    },
    {
      id: 'aud-seed-9', actorId: 'usr-manager', actorName: 'Sam Okafor', actorRole: 'manager', action: 'update',
      entityType: 'bookings', entityId: 'RV-D1040',
      summary: 'Late return processed for RV-D1040 — 3 extra hours billed at ₹950',
      metadata: { changed: { lateHours: { from: null, to: 3 }, lateCharge: { from: null, to: 950 } } },
      createdAt: createdAt(-8, 18),
    },
    {
      id: 'aud-seed-10', actorId: 'usr-admin', actorName: 'Avery Ross', actorRole: 'admin', action: 'insert',
      entityType: 'fleet', entityId: 'veh-i4',
      summary: 'New vehicle added to fleet — Audi i4 EV (MH-01-AB-1234)',
      metadata: { detail: 'EV charging station installed at Bandra hub' },
      createdAt: createdAt(-60, 9),
    },
    {
      id: 'aud-seed-11', actorId: 'usr-manager', actorName: 'Riya Kapoor', actorRole: 'manager', action: 'update',
      entityType: 'settings', entityId: 'tax_rate',
      summary: 'Tax rate changed from 12% to 18% effective next billing cycle',
      metadata: { changed: { tax_rate: { from: '12', to: '18' } } },
      createdAt: createdAt(-90, 11),
    },
  );

  return state;
}
