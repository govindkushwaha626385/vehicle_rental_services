const photo = (id, params = 'auto=format&fit=crop&w=1600&q=80') =>
  `https://images.unsplash.com/photo-${id}?${params}`;

const gallery = (id) => [
  photo(id),
  photo(id, 'auto=format&fit=crop&w=1200&h=800&q=80'),
  photo(id, 'auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'),
];

const VEHICLE_SEED = [
  {
    id: 'veh-911', name: 'Porsche 911 Carrera', brand: 'Porsche', type: 'Sports', year: 2023,
    seats: 4, luggage: 2, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '9 kmpl',
    pricePerDay: 24000, location: 'Mumbai — Bandra West', photo: '1503376780353-7e6692767b70', trips: 128,
    description: 'A weekend icon with everyday manners. The 911 Carrera pairs a flat-six soundtrack with razor-sharp steering — point it at a coast road and it simply clicks.',
    features: ['Apple CarPlay', 'Sport Chrono package', 'Heated seats', 'BOSE surround sound', 'Park assist', 'Launch control'],
  },
  {
    id: 'veh-m4', name: 'BMW M4 Competition', brand: 'BMW', type: 'Sports', year: 2024,
    seats: 4, luggage: 2, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '8 kmpl',
    pricePerDay: 18500, location: 'New Delhi — Aerocity', photo: '1555215695-3004980ad54e', trips: 86,
    description: '503 horsepower of precise, twin-turbo aggression. The M4 Competition is as happy carving canyon roads as it is cruising the highway.',
    features: ['M Sport seats', 'Head-up display', 'Carbon fibre trim', 'Harman Kardon audio', 'Adaptive M suspension', 'Wireless charging'],
  },
  {
    id: 'veh-mustang', name: 'Ford Mustang GT Convertible', brand: 'Ford', type: 'Convertible', year: 2023,
    seats: 4, luggage: 2, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '7 kmpl',
    pricePerDay: 13500, location: 'Goa — Panaji', photo: '1494976388531-d1058494cdd8', trips: 204,
    description: 'Top down, V8 up. The Mustang GT Convertible is the easiest way to turn an ordinary coastal drive into the highlight of the trip.',
    features: ['Power soft top', 'V8 soundtrack', 'Heated/cooled seats', 'SYNC 4 infotainment', 'Rear camera', 'B&O audio'],
  },
  {
    id: 'veh-modely', name: 'Tesla Model Y Long Range', brand: 'Tesla', type: 'Electric', year: 2024,
    seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Electric', awd: true, efficiency: '530 km range',
    pricePerDay: 9500, location: 'Bengaluru — Indiranagar', photo: '1560958089-b8a1929cea89', trips: 312,
    description: 'Quiet, quick, and endlessly practical. With 530 km of range and access to the Supercharger network, the Model Y makes electric road trips painless.',
    features: ['530 km range', 'Autopilot', 'Panoramic glass roof', 'Supercharger access', 'Premium audio', 'Heated rear seats'],
  },
  {
    id: 'veh-gle', name: 'Mercedes-Benz GLE 450', brand: 'Mercedes-Benz', type: 'SUV', year: 2023,
    seats: 5, luggage: 4, transmission: 'Automatic', fuel: 'Petrol', awd: true, efficiency: '11 kmpl',
    pricePerDay: 14500, location: 'New Delhi — Aerocity', photo: '1541899481282-d53bffe3c35d', trips: 96,
    description: 'A calm, quiet sanctuary that happens to seat five in total comfort. Ideal for city weekends and long highway hauls alike.',
    features: ['MBUX infotainment', 'Panoramic roof', 'Burmester audio', 'Surround-view camera', 'Heated rear seats', 'Air suspension'],
  },
  {
    id: 'veh-wrangler', name: 'Jeep Wrangler Rubicon', brand: 'Jeep', type: 'SUV', year: 2023,
    seats: 4, luggage: 2, transmission: 'Manual', fuel: 'Petrol', awd: true, efficiency: '10 kmpl',
    pricePerDay: 9000, location: 'Goa — Panaji', photo: '1549317661-bd32c8ce0db2', trips: 143,
    description: 'Removable roof, locking differentials and genuine off-road ability. The Rubicon is built for the detours you were going to take anyway.',
    features: ['4x4 low range', 'Removable hard top', 'Locking diffs', 'All-terrain tyres', 'Tow package', 'Rock rails'],
  },
  {
    id: 'veh-velar', name: 'Range Rover Velar', brand: 'Land Rover', type: 'SUV', year: 2024,
    seats: 5, luggage: 4, transmission: 'Automatic', fuel: 'Diesel', awd: true, efficiency: '13 kmpl',
    pricePerDay: 17500, location: 'Mumbai — Bandra West', photo: '1605559424843-9e4c228bf1c2', trips: 74,
    description: 'The most design-led Range Rover, with a hushed cabin, effortless torque and a silhouette that still turns heads in a valet line.',
    features: ['Air suspension', 'Meridian audio', 'Heated seats', 'Terrain Response', 'Power tailgate', 'Panoramic roof'],
  },
  {
    id: 'veh-a5', name: 'Audi A5 Sportback', brand: 'Audi', type: 'Sedan', year: 2023,
    seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Petrol', awd: true, efficiency: '14 kmpl',
    pricePerDay: 11000, location: 'Pune — Koregaon Park', photo: '1618843479313-40f8afb4b4d8', trips: 118,
    description: 'A sleek five-door with quattro confidence — perfect for wet monsoon weekends and the mountain passes beyond.',
    features: ['Quattro AWD', 'Virtual cockpit', 'Bang & Olufsen audio', 'Heated seats', 'Adaptive cruise', 'Matrix LED'],
  },
  {
    id: 'veh-c300', name: 'Mercedes-Benz C 300', brand: 'Mercedes-Benz', type: 'Sedan', year: 2024,
    seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '13 kmpl',
    pricePerDay: 12000, location: 'Mumbai — Bandra West', photo: '1563720223185-11003d516935', trips: 152,
    description: 'Understated luxury with a tech-forward cabin. The C 300 is our most-requested city car for good reason.',
    features: ['MBUX with voice', 'Wireless charging', 'Heated seats', 'Blind-spot assist', 'LED headlights', 'Ambient lighting'],
  },
  {
    id: 'veh-i4', name: 'BMW i4 eDrive40', brand: 'BMW', type: 'Electric', year: 2023,
    seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Electric', awd: false, efficiency: '480 km range',
    pricePerDay: 11500, location: 'Hyderabad — Banjara Hills', photo: '1552519507-da3b142c6e3d', trips: 98,
    description: 'A proper driver EV. Rear-wheel drive, 480 km of range and a cabin quiet enough to make city traffic feel almost serene.',
    features: ['480 km range', 'Curved display', 'Adaptive cruise', 'Harman Kardon audio', 'Fast charging', 'Heated seats'],
  },
  {
    id: 'veh-camry', name: 'Toyota Camry Hybrid', brand: 'Toyota', type: 'Sedan', year: 2023,
    seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Hybrid', awd: false, efficiency: '23 kmpl',
    pricePerDay: 5500, location: 'Bengaluru — Indiranagar', photo: '1502877338535-766e1452684a', trips: 421,
    description: 'The sensible choice that never feels like a compromise. 23 kmpl, a roomy back seat and Toyota reliability for the long haul.',
    features: ['23 kmpl combined', 'Apple CarPlay', 'Adaptive cruise', 'Lane assist', 'Blind-spot monitor', 'USB-C ports'],
  },
  {
    id: 'veh-california', name: 'Volkswagen California Camper', brand: 'Volkswagen', type: 'Van', year: 2022,
    seats: 4, luggage: 3, transmission: 'Automatic', fuel: 'Diesel', awd: false, efficiency: '12 kmpl',
    pricePerDay: 12500, location: 'Goa — Panaji', photo: '1493238792000-8113da705763', trips: 67,
    description: 'A hotel room on wheels. Pop-top roof, two-burner stove and enough storage for a week off-grid along the coast.',
    features: ['Pop-top roof', 'Kitchenette', 'Sleeps 4', 'Fridge', 'Solar panel', 'Awning'],
  },
  {
    id: 'veh-vclass', name: 'Mercedes-Benz V-Class', brand: 'Mercedes-Benz', type: 'Van', year: 2023,
    seats: 7, luggage: 5, transmission: 'Automatic', fuel: 'Diesel', awd: false, efficiency: '14 kmpl',
    pricePerDay: 13500, location: 'Chennai — Nungambakkam', photo: '1542362567-b07e54358753', trips: 54,
    description: 'Seven seats, airline-style space and a boot that swallows everyone luggage. The airport-run hero for groups.',
    features: ['7 seats', 'Captain chairs', 'Rear climate', 'Power doors', 'Panoramic roof', 'Wi-Fi hotspot'],
    status: 'maintenance',
  },
  {
    id: 'veh-miata', name: 'Mazda MX-5 Miata', brand: 'Mazda', type: 'Convertible', year: 2023,
    seats: 2, luggage: 1, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '13 kmpl',
    pricePerDay: 6500, location: 'Pune — Koregaon Park', photo: '1533473359331-0135ef1b58bf', trips: 233,
    description: 'Light, honest and endlessly entertaining. The Miata proves you do not need big power to have the best drive of the week.',
    features: ['Manual gearbox', 'Soft top', 'Bose audio', 'Heated seats', 'Apple CarPlay', 'Limited-slip diff'],
  },
  {
    id: 'veh-creta', name: 'Hyundai Creta SX', brand: 'Hyundai', type: 'SUV', year: 2024,
    seats: 5, luggage: 3, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '17 kmpl',
    pricePerDay: 3500, location: 'Bengaluru — Indiranagar', photo: '1568605117036-5fe5e7bab0b7', trips: 268,
    description: 'The do-everything family SUV. Compact enough for city lanes, roomy enough for a week away, and remarkably easy to live with.',
    features: ['Panoramic sunroof', 'Ventilated seats', 'Wireless charging', '360 camera', 'ADAS suite', 'Bose audio'],
  },
  {
    id: 'veh-swift', name: 'Maruti Suzuki Swift', brand: 'Maruti Suzuki', type: 'Economy', year: 2023,
    seats: 5, luggage: 2, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '22 kmpl',
    pricePerDay: 1800, location: 'Pune — Koregaon Park', photo: '1542282088-72c9c27ed0cd', trips: 512,
    description: 'Light on the wallet, light on its feet. The Swift is the smart pick for city errands and short weekend escapes.',
    features: ['22 kmpl', 'Apple CarPlay', 'Rear camera', 'Cruise control', 'Keyless entry', 'USB charging'],
  },
  {
    id: 'veh-re-classic350', name: 'Royal Enfield Classic 350', brand: 'Royal Enfield', type: 'Cruiser', year: 2024,
    seats: 2, luggage: 1, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '35 kmpl',
    kind: 'bike', engineCc: 349, mileage: '35 kmpl', gears: 'Manual', helmetCount: 2, licenseClass: 'MCWG', minAge: 18,
    kmCap: 250, kmExtraRate: 6,
    pricePerDay: 1100, location: 'Goa — Panaji', photo: '1558981403-c5f9899a28ae', trips: 88,
    description: 'The thump that defined a generation. Relaxed riding position, timeless styling and an engine that never feels stressed at highway speed.',
    features: ['Dual-channel ABS', 'Tripper navigation', 'Halogen headlamp', 'Touring seat', 'USB charging', 'Crash guards'],
  },
  {
    id: 'veh-activa6g', name: 'Honda Activa 6G', brand: 'Honda', type: 'Scooter', year: 2024,
    seats: 2, luggage: 1, transmission: 'Automatic', fuel: 'Petrol', awd: false, efficiency: '45 kmpl',
    kind: 'bike', engineCc: 110, mileage: '45 kmpl', gears: 'Gearless', helmetCount: 2, licenseClass: 'MCWOG', minAge: 18,
    kmCap: 150, kmExtraRate: 5,
    pricePerDay: 700, location: 'Bengaluru — Indiranagar', photo: '1558618666-fcd25c85cd64', trips: 320,
    description: 'India most trusted scooter. Twist-and-go convenience, a huge underseat boot and effortless city manners.',
    features: ['Silent start', 'External fuel filler', 'Idle stop system', 'Underseat storage', 'Mobile charging', 'Combi brake'],
  },
  {
    id: 'veh-apachertr160', name: 'TVS Apache RTR 160', brand: 'TVS', type: 'Sport Bike', year: 2024,
    seats: 2, luggage: 1, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '45 kmpl',
    kind: 'bike', engineCc: 159, mileage: '45 kmpl', gears: 'Manual', helmetCount: 2, licenseClass: 'MCWG', minAge: 18,
    kmCap: 200, kmExtraRate: 6,
    pricePerDay: 900, location: 'Chennai — Nungambakkam', photo: '1591632756862-6c3f01c4a5d7', trips: 156,
    description: 'Race-derived tech in a street-friendly package. Three ride modes, Bluetooth connectivity and a punchy 160cc motor.',
    features: ['Ride modes', 'SmartXonnect', 'Dual-channel ABS', 'Glide Through Technology', 'LED headlamp', 'Slipper clutch'],
  },
  {
    id: 'veh-pulsarns200', name: 'Bajaj Pulsar NS200', brand: 'Bajaj', type: 'Sport Bike', year: 2023,
    seats: 2, luggage: 1, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '40 kmpl',
    kind: 'bike', engineCc: 199, mileage: '40 kmpl', gears: 'Manual', helmetCount: 2, licenseClass: 'MCWG', minAge: 18,
    kmCap: 200, kmExtraRate: 6,
    pricePerDay: 1000, location: 'Mumbai — Bandra West', photo: '1568772585407-9361f9bf3a87', trips: 142,
    description: 'The original affordable streetfighter. Liquid-cooled 200cc triple-spark engine with perimeter frame handling.',
    features: ['Liquid cooling', 'Perimeter frame', 'Dual-channel ABS', 'Split seats', 'LED DRL', 'Nitrox suspension'],
  },
  {
    id: 'veh-olas1pro', name: 'Ola S1 Pro', brand: 'Ola Electric', type: 'Electric Bike', year: 2024,
    seats: 2, luggage: 1, transmission: 'Automatic', fuel: 'Electric', awd: false, efficiency: '195 km range',
    kind: 'bike', engineCc: 0, mileage: '195 km range', gears: 'Gearless', helmetCount: 2, licenseClass: 'MCWOG', minAge: 18,
    kmCap: 120, kmExtraRate: 5,
    pricePerDay: 850, location: 'Hyderabad — Banjara Hills', photo: '1619760519486-9c2d1c8e0c8c', trips: 210,
    description: 'The scooter that started India EV wave. 195 km of real-world range, four ride modes and over-the-air updates.',
    features: ['195 km range', 'Four ride modes', 'Touchscreen dash', 'Cruise control', 'OTA updates', 'Hill hold'],
  },
  {
    id: 'veh-ather450x', name: 'Ather 450X', brand: 'Ather', type: 'Electric Bike', year: 2024,
    seats: 2, luggage: 1, transmission: 'Automatic', fuel: 'Electric', awd: false, efficiency: '150 km range',
    kind: 'bike', engineCc: 0, mileage: '150 km range', gears: 'Gearless', helmetCount: 2, licenseClass: 'MCWOG', minAge: 18,
    kmCap: 100, kmExtraRate: 5,
    pricePerDay: 900, location: 'Bengaluru — Indiranagar', photo: '1611246063687-7f6f6b6f6b6f', trips: 178,
    description: 'The enthusiast electric scooter. Quick, agile and packed with a 7-inch dashboard and Ather Grid fast charging.',
    features: ['150 km range', 'Ather Grid access', '7-inch dashboard', 'Auto hold', 'Reverse assist', 'Warp mode'],
  },
  {
    id: 'veh-ktm390duke', name: 'KTM 390 Duke', brand: 'KTM', type: 'Sport Bike', year: 2024,
    seats: 2, luggage: 1, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '35 kmpl',
    kind: 'bike', engineCc: 399, mileage: '35 kmpl', gears: 'Manual', helmetCount: 2, licenseClass: 'MCWG', minAge: 21,
    kmCap: 250, kmExtraRate: 8,
    pricePerDay: 2500, location: 'New Delhi — Aerocity', photo: '1609630875171-b1321377ee65', trips: 64,
    description: 'The corner-carving scalpel of the small-capacity class. 399cc, 45 hp and a chassis that loves to be leaned over.',
    features: ['TFT display', 'Quickshifter+', 'Supermoto ABS', 'LED headlamp', 'Adjustable suspension', 'Track mode'],
  },
  {
    id: 'veh-jawa42', name: 'Jawa 42', brand: 'Jawa', type: 'Cruiser', year: 2023,
    seats: 2, luggage: 1, transmission: 'Manual', fuel: 'Petrol', awd: false, efficiency: '38 kmpl',
    kind: 'bike', engineCc: 293, mileage: '38 kmpl', gears: 'Manual', helmetCount: 2, licenseClass: 'MCWG', minAge: 18,
    kmCap: 200, kmExtraRate: 6,
    pricePerDay: 950, location: 'Pune — Koregaon Park', photo: '1571068316344-75bc76f77890', trips: 91,
    description: 'Retro looks, modern manners. The 42 pairs a 293cc single with classic Jawa lines and a peppy, usable powerband.',
    features: ['Dual-channel ABS', 'Digital-analogue console', 'LED tail lamp', 'Touring seat', 'Bar-end mirrors', 'Hazard lights'],
  },
];

const addDocDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export const demoVehicles = VEHICLE_SEED.map((vehicle, index) => {
  const { photo: photoId, ...rest } = vehicle;
  const kind = rest.kind ?? 'car';
  const isBike = kind === 'bike';
  return {
    ...rest,
    kind,
    engineCc: rest.engineCc ?? null,
    mileage: rest.mileage ?? rest.efficiency ?? '',
    gears: rest.gears ?? rest.transmission ?? 'Automatic',
    helmetCount: rest.helmetCount ?? 0,
    licenseClass: rest.licenseClass ?? 'LMV',
    minAge: rest.minAge ?? 21,
    // Cars ship with unlimited kilometres in the demo; every bike shows a
    // realistic daily allowance so the storefront, checkout and returns desk
    // have something to demonstrate. Admins can change either from Fleet.
    kmCap: rest.kmCap ?? 0,
    kmExtraRate: rest.kmExtraRate ?? 0,
    imageUrl: photo(photoId),
    images: gallery(photoId),
    rating: 4.8,
    status: rest.status ?? 'available',
    bookingCount: 0,
    featured: rest.featured ?? index < 4,
    displayOrder: rest.displayOrder ?? index + 1,
    badge: rest.badge ?? ['Staff pick', 'New arrival', 'Most booked', 'Electric'][index] ?? '',
    odometer: rest.odometer ?? (isBike ? 6800 + index * 640 : 18600 + index * 4300),
    serviceIntervalKm: rest.serviceIntervalKm ?? (isBike ? 4000 : 10000),
    serviceIntervalDays: rest.serviceIntervalDays ?? (isBike ? 120 : 180),
    lastServiceDate: rest.lastServiceDate ?? null,
    lastServiceOdometer: rest.lastServiceOdometer ?? null,
    registrationNumber: rest.registrationNumber ?? `KA-01-MF-${String(1000 + index).padStart(4, '0')}`,
    // A few demo vehicles show off the compliance dashboard: one already
    // expired insurance, one expiry inside the 30-day warning window.
    insuranceExpiry: rest.insuranceExpiry ?? (index === 6 ? '2026-10-15' : index === 9 ? '2026-11-08' : addDocDays(360 + index * 90)),
    pucExpiry: rest.pucExpiry ?? (index === 9 ? '2026-11-05' : addDocDays(270 + index * 60)),
  };
});

export const demoLocations = [
  { id: 'loc-mumbai', name: 'Mumbai — Bandra West', address: 'Linking Road, Bandra West', city: 'Mumbai', region: 'MH', lat: 19.0596, lng: 72.8295, phone: '+91 22 5555 0100', hours: 'Mon–Sun, 8:00–21:00', active: true },
  { id: 'loc-delhi', name: 'New Delhi — Aerocity', address: 'Worldmark 1, Aerocity', city: 'New Delhi', region: 'DL', lat: 28.557, lng: 77.12, phone: '+91 11 5555 0101', hours: 'Mon–Sun, 7:00–22:00', active: true },
  { id: 'loc-bengaluru', name: 'Bengaluru — Indiranagar', address: '100 Feet Road, Indiranagar', city: 'Bengaluru', region: 'KA', lat: 12.9719, lng: 77.6412, phone: '+91 80 5555 0102', hours: 'Mon–Sun, 8:00–21:00', active: true },
  { id: 'loc-hyderabad', name: 'Hyderabad — Banjara Hills', address: 'Road No. 12, Banjara Hills', city: 'Hyderabad', region: 'TS', lat: 17.4126, lng: 78.4392, phone: '+91 40 5555 0103', hours: 'Mon–Sun, 8:00–20:00', active: true },
  { id: 'loc-goa', name: 'Goa — Panaji', address: '18th June Road, Panaji', city: 'Goa', region: 'GA', lat: 15.4909, lng: 73.8278, phone: '+91 832 555 0104', hours: 'Mon–Sun, 8:00–21:00', active: true },
  { id: 'loc-pune', name: 'Pune — Koregaon Park', address: 'Lane 7, Koregaon Park', city: 'Pune', region: 'MH', lat: 18.5362, lng: 73.8939, phone: '+91 20 5555 0105', hours: 'Mon–Sun, 8:00–20:00', active: true },
  { id: 'loc-chennai', name: 'Chennai — Nungambakkam', address: 'Khader Nawaz Khan Road', city: 'Chennai', region: 'TN', lat: 13.0569, lng: 80.2425, phone: '+91 44 5555 0106', hours: 'Mon–Sun, 8:00–20:00', active: true },
];

export const demoExtras = [
  { id: 'ext-gps', key: 'gps', label: 'GPS navigation device', description: 'Offline maps for the whole trip.', pricePerDay: 300, active: true },
  { id: 'ext-childseat', key: 'childseat', label: 'Child safety seat', description: 'Fitted and checked before pick-up.', pricePerDay: 400, active: true },
  { id: 'ext-driver', key: 'driver', label: 'Additional driver', description: 'Share the wheel with one more licensed driver.', pricePerDay: 600, active: true },
  { id: 'ext-wifi', key: 'wifi', label: 'Portable Wi-Fi', description: 'Unlimited 5G hotspot, up to 5 devices.', pricePerDay: 450, active: true },
  { id: 'ext-roadside', key: 'roadside', label: 'Roadside assistance plus', description: 'Priority dispatch, towing and lockout cover.', pricePerDay: 350, active: true },
  { id: 'ext-chauffeur', key: 'chauffeur', label: 'Chauffeur service', description: 'A professional driver for the full rental.', pricePerDay: 2500, active: true },
];

export const demoInsuranceTiers = [
  { key: 'basic', label: 'Basic', pricePerDay: 0, deductible: 75000, blurb: 'State-minimum liability. You are responsible for damage up to the deductible.', active: true },
  { key: 'standard', label: 'Standard', pricePerDay: 600, deductible: 20000, blurb: 'Collision damage waiver with a ₹20,000 deductible and 24/7 roadside support.', active: true },
  { key: 'full', label: 'Full coverage', pricePerDay: 1200, deductible: 0, blurb: 'Zero deductible, glass and tyre cover, and priority roadside assistance.', active: true },
];

export const demoPromos = [
  { id: 'promo-first10', code: 'FIRST10', description: '10% off your first Rove trip', type: 'percent', value: 10, minDays: 1, active: true, expiresAt: '2027-12-31', usageLimit: 500, usedCount: 86, createdAt: '2026-03-01T10:00:00.000Z' },
  { id: 'promo-weekend15', code: 'WEEKEND15', description: '15% off weekend getaways', type: 'percent', value: 15, minDays: 2, active: true, expiresAt: '2027-12-31', usageLimit: 500, usedCount: 142, createdAt: '2026-04-12T10:00:00.000Z' },
  { id: 'promo-autumn20', code: 'AUTUMN20', description: '20% off 3+ day rentals', type: 'percent', value: 20, minDays: 3, active: true, expiresAt: '2027-12-31', usageLimit: 500, usedCount: 64, createdAt: '2026-06-20T10:00:00.000Z' },
  { id: 'promo-rove1500', code: 'ROVE1500', description: '₹1,500 off rentals of 3 days or more', type: 'fixed', value: 1500, minDays: 3, active: true, expiresAt: '2027-12-31', usageLimit: 500, usedCount: 31, createdAt: '2026-07-08T10:00:00.000Z' },
  { id: 'promo-monsoon15', code: 'MONSOON15', description: '15% off during the monsoon window', type: 'percent', value: 15, minDays: 2, active: true, expiresAt: '2027-09-30', usageLimit: 600, usedCount: 57, createdAt: '2026-06-05T10:00:00.000Z' },
  { id: 'promo-first20', code: 'WELCOME20', description: '20% off your first booking', type: 'percent', value: 20, minDays: 1, active: true, expiresAt: '2027-12-31', usageLimit: 400, usedCount: 12, createdAt: '2026-08-01T10:00:00.000Z', firstBookingOnly: true },
];

export const demoSettings = {
  tax_rate: '18',
  tax_label: 'GST',
  tax_inclusive: 'false',
  tax_on_extras: 'true',
  tax_on_insurance: 'true',
  tax_on_one_way: 'true',
  tax_invoice_note: 'Tax is calculated on the taxable items shown above. The refundable security deposit is not part of the rental charge.',
  invoice_prefix: 'INV/26-27/',
  booking_auto_confirm: 'true',
  deposit_percent: '25',
  weekend_multiplier: '1.15',
  seasonal_multiplier: '1.25',
  seasonal_start: '2026-12-15',
  seasonal_end: '2027-01-05',
  one_way_fee: '1500',
  hold_amount: '5000',
  min_age: '21',
  min_rental_days: '1',
  max_rental_days: '45',
  max_advance_days: '365',
  min_bike_rider_age: '18',
  support_email: 'hello@rove.rent',
  support_phone: '+91 80 5555 0100',
  whatsapp_number: '+91 80 5555 0100',
  support_hours: 'Every day, 7am–11pm IST',
  hero_eyebrow: 'Self-drive rentals across India',
  hero_title: 'Cars and bikes, ready when you are.',
  hero_subtitle: 'Premium self-drive cars and two-wheelers across India — delivered to your door.',
  hero_cta_label: 'Explore the fleet',
  hero_badge: 'New: 2026 fleet',
  hero_image_url: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=2000&q=85',
  hero_image_alt: 'A sports car on an open mountain road',
  hero_rating: '4.9',
  hero_trip_count: '2,400+',
  hero_trip_label: 'verified trips this year',
  footer_tagline: 'Premium self-drive rentals across India. Transparent pricing, beautifully kept cars and bikes, and people who actually pick up the phone.',
  company_legal_name: 'Rove Mobility Pvt. Ltd.',
  gstin: '29AABCR1234F1Z5',
  registered_address: 'Indiranagar, Bengaluru 560038, Karnataka, India',
  social_instagram: '',
  social_twitter: '',
  social_linkedin: '',
  legal_updated: '20 October 2026',
  bikes_enabled: 'true',
  guest_checkout_enabled: 'true',
  reviews_enabled: 'true',
  compare_enabled: 'true',
  remember_trip_enabled: 'true',
  change_request_enabled: 'true',
  analytics_enabled: 'true',
  alerts_enabled: 'true',
  theme_accent: 'lime',
  theme_radius: 'soft',
  theme_motion: 'full',
  map_view_enabled: 'true',
  cancellation_window_hours: '48',
  cancellation_refund_percent: '50',
  late_fee_per_hour: '500',
  fuel_refill_fee: '300',
  bike_fuel_refill_fee: '200',
  testimonials: JSON.stringify([
    { name: 'Aarav Mehta', city: 'Mumbai', trip: 'Range Rover Velar', quote: 'Booked a Velar for a Goa trip — spotless car, seamless handover and no hidden charges.', rating: 5 },
    { name: 'Ishita Shah', city: 'Bengaluru', trip: 'Ather 450X', quote: 'The Ather was fully charged and checkout took under a minute. My go-to for weekend rides.', rating: 5 },
    { name: 'Rohan Kapoor', city: 'New Delhi', trip: 'Toyota Fortuner', quote: 'Rented an SUV for the family and a scooter for me. One booking, both delivered to the door.', rating: 4 },
  ]),
  faqs: JSON.stringify([
    { question: 'Do I need a helmet to rent a bike?', answer: 'Every bike rental includes helmets for the rider and pillion at no extra cost. You are welcome to bring your own.' },
    { question: 'Which licence do I need for a bike?', answer: 'A valid MCWG or MCWOG licence for two-wheelers, and an LMV licence for cars. We verify it at handover.' },
    { question: 'What is the minimum age to rent?', answer: 'Riders must be at least 18 for bikes (21 for the KTM 390 Duke) and 21 for cars.' },
    { question: 'Can I cancel my booking?', answer: 'Yes — cancel up to 48 hours before pick-up for a full refund, or within the window for a partial refund.' },
    { question: 'Running late? Can I extend my return?', answer: 'Yes — extend the return in Manage Booking or your account. Add an hour, an evening or a few extra days; extra days are charged at the current fare and collected at drop-off.' },
  ]),
  trust_badges: JSON.stringify([
    { title: 'Free cancellation', copy: 'Full refund 48 hours before pick-up, 50% inside the window' },
    { title: 'Helmets included', copy: 'Rider and pillion helmets with every bike rental' },
    { title: 'No hidden fees', copy: 'GST, insurance and extras shown before you pay' },
    { title: 'Roadside assistance', copy: 'Human help on the phone, every day of the year' },
  ]),
  currency: 'INR',
};

export const demoUsers = [
  { id: 'usr-admin', name: 'Avery Ross', email: 'admin@rove.rent', password: 'admin123', role: 'admin', status: 'active', phone: '+91 80 5555 0100', licenseNumber: 'KA0120230001001', cardBrand: 'Visa', cardLast4: '4242', createdAt: '2025-11-02T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-manager', name: 'Sam Okafor', email: 'manager@rove.rent', password: 'manager123', role: 'manager', status: 'active', phone: '+91 80 5555 0101', licenseNumber: 'KA0120220002002', cardBrand: 'Mastercard', cardLast4: '4444', createdAt: '2025-12-08T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-maya', name: 'Maya Chen', email: 'demo@rove.rent', password: 'demo123', role: 'customer', status: 'active', phone: '+91 98765 43210', licenseNumber: 'MH0220210003003', cardBrand: 'Visa', cardLast4: '4242', createdAt: '2026-01-14T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-jordan', name: 'Jordan Blake', email: 'jordan@example.com', password: 'demo123', role: 'customer', status: 'active', phone: '+91 98200 11223', licenseNumber: 'MH0220190004004', cardBrand: 'HDFC', cardLast4: '1881', createdAt: '2026-02-03T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-priya', name: 'Priya Nair', email: 'priya@example.com', password: 'demo123', role: 'customer', status: 'active', phone: '+91 98111 33445', licenseNumber: 'DL0320200005005', cardBrand: 'ICICI', cardLast4: '3311', createdAt: '2026-02-26T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-luis', name: 'Luis Ortega', email: 'luis@example.com', password: 'demo123', role: 'customer', status: 'active', phone: '+91 99000 55667', licenseNumber: 'KA0120180006006', cardBrand: 'Visa', cardLast4: '7788', createdAt: '2026-03-18T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-anna', name: 'Anna Kowalski', email: 'anna@example.com', password: 'demo123', role: 'customer', status: 'active', phone: '+91 98333 77889', licenseNumber: 'GA0220220007007', cardBrand: 'Amex', cardLast4: '1005', createdAt: '2026-04-05T09:00:00.000Z', bookings: 0, spend: 0 },
  { id: 'usr-noah', name: 'Noah Williams', email: 'noah@example.com', password: 'demo123', role: 'customer', status: 'active', phone: '+91 90040 99001', licenseNumber: 'TN0120210008008', cardBrand: 'Mastercard', cardLast4: '2222', createdAt: '2026-05-22T09:00:00.000Z', bookings: 0, spend: 0 },
];

export const demoAccounts = [
  { role: 'Customer', name: 'Maya Chen', email: 'demo@rove.rent', password: 'demo123' },
  { role: 'Fleet manager', name: 'Sam Okafor', email: 'manager@rove.rent', password: 'manager123' },
  { role: 'Super admin', name: 'Avery Ross', email: 'admin@rove.rent', password: 'admin123' },
];

const REVIEW_AUTHORS = ['Aarav Mehta', 'Ishita Shah', 'Rohan Kapoor', 'Meera Iyer', 'Kabir Singh', 'Ananya Rao', 'Dev Malhotra', 'Nikhil Bansal', 'Sara Fernandes', 'Vikram Sethi', 'Naina Kapoor', 'Arjun Nair', 'Ritika Jain', 'Aditya Rao', 'Farah Khan', 'Siddharth Menon', 'Tanvi Desai', 'Karan Ahuja', 'Pooja Reddy', 'Rahul Verma'];

const REVIEW_COMMENTS = [
  'Pickup took under five minutes and the car was spotless. Exactly as pictured.',
  'Great communication from the team and a really well-kept car. Would book again.',
  'Perfect for our weekend trip. The whole process felt effortless.',
  'The car drove beautifully. Only wish the pickup window had been a little wider.',
  'Superb condition and a fair price. Rove has become my go-to.',
  'Smooth handover, no hidden fees, and the car was fully charged when I got it.',
  'Really comfortable on a long drive. Staff were friendly and quick.',
  'Loved it. A small scratch noted at pickup was handled without any fuss.',
  'Booked last minute and everything still went perfectly. Impressive service.',
  'Great ride and a very clean interior. The pickup location was easy to find.',
];

export function buildDemoReviews() {
  const reviews = [];
  let index = 0;
  demoVehicles.forEach((vehicle, vehicleIndex) => {
    const count = 2 + (vehicleIndex % 2);
    for (let j = 0; j < count; j += 1) {
      reviews.push({
        id: `rev-${vehicle.id}-${j}`,
        vehicleId: vehicle.id,
        userId: null,
        bookingId: null,
        author: REVIEW_AUTHORS[index % REVIEW_AUTHORS.length],
        rating: [5, 5, 4, 5, 4][(vehicleIndex + j) % 5],
        comment: REVIEW_COMMENTS[index % REVIEW_COMMENTS.length],
        createdAt: new Date(Date.now() - (12 + vehicleIndex * 9 + j * 12) * 86400000).toISOString(),
      });
      index += 1;
    }
  });
  return reviews;
}

export const vehicleTypeIcons = {
  Sports: 'Gauge',
  SUV: 'Mountain',
  Sedan: 'Car',
  Electric: 'Zap',
  Convertible: 'Wind',
  Van: 'Bus',
  Economy: 'PiggyBank',
};
