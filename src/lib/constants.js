export const VEHICLE_KINDS = ['car', 'bike'];

export const KIND_LABELS = {
  car: 'Cars',
  bike: 'Bikes',
};

export const CAR_TYPES = ['Economy', 'SUV', 'Sedan', 'Electric', 'Sports', 'Convertible', 'Van'];

export const BIKE_TYPES = ['Commuter', 'Scooter', 'Cruiser', 'Sport Bike', 'Adventure', 'Electric Bike'];

export const VEHICLE_TYPES = [...CAR_TYPES, ...BIKE_TYPES];

export const TYPES_BY_KIND = {
  car: CAR_TYPES,
  bike: BIKE_TYPES,
};

export const VEHICLE_STATUSES = ['available', 'rented', 'maintenance'];

export const BOOKING_STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled', 'rejected'];

export const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['active', 'completed', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
};

export const ROLES = ['customer', 'manager', 'admin'];

export const STAFF_ROLES = ['manager', 'admin'];

export const CAR_FUELS = ['Petrol', 'Diesel', 'Electric', 'Hybrid'];

export const BIKE_FUELS = ['Petrol', 'Electric'];

export const FUEL_TYPES = CAR_FUELS;

export const FUELS_BY_KIND = {
  car: CAR_FUELS,
  bike: BIKE_FUELS,
};

export const TRANSMISSIONS = ['Automatic', 'Manual'];

export const BIKE_GEARS = ['Manual', 'Automatic', 'Gearless'];

export const TRANSMISSIONS_BY_KIND = {
  car: TRANSMISSIONS,
  bike: BIKE_GEARS,
};

export const LICENSE_CLASSES = ['LMV', 'MCWG', 'MCWOG'];

export const LICENSE_BY_KIND = {
  car: 'LMV',
  bike: 'MCWG',
};

export const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'newest', label: 'Newest models' },
];

// Contact-message subject tags. Customers pick one on /contact; staff can
// re-tag from the inbox so the queue triages by intent, not by random text.
export const CONTACT_SUBJECTS = [
  'General',
  'Booking & payment',
  'Trip changes',
  'Deposits & refunds',
  'Group & corporate',
  'Feedback',
];

export const CONTACT_SUBJECT_LABELS = {
  General: 'General',
  'Booking & payment': 'Booking & payment',
  'Trip changes': 'Trip changes',
  'Deposits & refunds': 'Deposits & refunds',
  'Group & corporate': 'Group & corporate',
  Feedback: 'Feedback',
};

export const TYPE_DESCRIPTIONS = {
  Economy: 'Easy on the wallet, perfect for city runs.',
  SUV: 'Space, comfort and go-anywhere confidence.',
  Sedan: 'Smooth, quiet and built for long drives.',
  Electric: 'Silent miles with zero tailpipe emissions.',
  Sports: 'Weekend thrills with head-turning pace.',
  Convertible: 'Drop the roof and chase the coastline.',
  Van: 'Room for the whole crew and all the bags.',
  Commuter: 'Light and frugal — built for the daily ride to work.',
  Scooter: 'Twist-and-go convenience with a step-through frame.',
  Cruiser: 'Relaxed ergonomics and an unhurried, thumping pulse.',
  'Sport Bike': 'Sharp handling and a rev-happy motor for the weekend blast.',
  Adventure: 'Long-travel suspension and luggage mounts for the road less travelled.',
  'Electric Bike': 'Instant torque, near-silent running and zero tailpipe emissions.',
};

export const typesForKind = (kind) => TYPES_BY_KIND[kind] ?? VEHICLE_TYPES;
export const fuelsForKind = (kind) => FUELS_BY_KIND[kind] ?? CAR_FUELS;
export const gearsForKind = (kind) => TRANSMISSIONS_BY_KIND[kind] ?? TRANSMISSIONS;
export const kindForType = (type) => (BIKE_TYPES.includes(type) ? 'bike' : 'car');
