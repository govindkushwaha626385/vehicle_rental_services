-- ============================================================================
--  Rove Rentals · demo catalogue
--  Safe to skip in production. Idempotent: skips if vehicles already exist.
-- ============================================================================

do $seed$
begin
  if exists (select 1 from public.vehicles) then
    return;
  end if;

  insert into public.settings (key, value) values
    ('tax_rate', '18'),
    ('deposit_percent', '25'),
    ('weekend_multiplier', '1.15'),
    ('seasonal_multiplier', '1.25'),
    ('seasonal_start', '2026-12-15'),
    ('seasonal_end', '2027-01-05'),
    ('one_way_fee', '1500'),
    ('hold_amount', '5000'),
    ('min_age', '21'),
    ('max_rental_days', '45'),
    ('support_email', 'hello@rove.rent'),
    ('support_phone', '+91 80 5555 0100'),
    ('currency', 'INR');

  insert into public.insurance_tiers (key, label, price_per_day, deductible, blurb) values
    ('basic', 'Basic', 0, 75000, 'State-minimum liability. You are responsible for damage up to the deductible.'),
    ('standard', 'Standard', 600, 20000, 'Collision damage waiver with a ₹20,000 deductible and 24/7 roadside support.'),
    ('full', 'Full coverage', 1200, 0, 'Zero deductible, glass and tyre cover, and priority roadside assistance.');

  insert into public.extras (key, label, description, price_per_day) values
    ('gps', 'GPS navigation device', 'Offline maps for the whole trip.', 300),
    ('childseat', 'Child safety seat', 'Fitted and checked before pick-up.', 400),
    ('driver', 'Additional driver', 'Share the wheel with one more licensed driver.', 600),
    ('wifi', 'Portable Wi-Fi', 'Unlimited 5G hotspot, up to 5 devices.', 450),
    ('roadside', 'Roadside assistance plus', 'Priority dispatch, towing and lockout cover.', 350),
    ('chauffeur', 'Chauffeur service', 'A professional driver for the full rental.', 2500);

  insert into public.promos (code, description, type, value, min_days, active, expires_at, usage_limit) values
    ('FIRST10', '10% off your first Rove trip', 'percent', 10, 1, true, '2027-12-31', 500),
    ('WEEKEND15', '15% off weekend getaways', 'percent', 15, 2, true, '2027-12-31', 500),
    ('AUTUMN20', '20% off 3+ day rentals', 'percent', 20, 3, true, '2027-12-31', 500),
    ('ROVE1500', '₹1,500 off rentals of 3 days or more', 'fixed', 1500, 3, true, '2027-12-31', 500);

  insert into public.locations (name, address, city, region, lat, lng, phone, hours) values
    ('Mumbai — Bandra West', 'Linking Road, Bandra West', 'Mumbai', 'MH', 19.0596, 72.8295, '+91 22 5555 0100', 'Mon–Sun, 8:00–21:00'),
    ('New Delhi — Aerocity', 'Worldmark 1, Aerocity', 'New Delhi', 'DL', 28.5570, 77.1200, '+91 11 5555 0101', 'Mon–Sun, 7:00–22:00'),
    ('Bengaluru — Indiranagar', '100 Feet Road, Indiranagar', 'Bengaluru', 'KA', 12.9719, 77.6412, '+91 80 5555 0102', 'Mon–Sun, 8:00–21:00'),
    ('Hyderabad — Banjara Hills', 'Road No. 12, Banjara Hills', 'Hyderabad', 'TS', 17.4126, 78.4392, '+91 40 5555 0103', 'Mon–Sun, 8:00–20:00'),
    ('Goa — Panaji', '18th June Road, Panaji', 'Goa', 'GA', 15.4909, 73.8278, '+91 832 555 0104', 'Mon–Sun, 8:00–21:00'),
    ('Pune — Koregaon Park', 'Lane 7, Koregaon Park', 'Pune', 'MH', 18.5362, 73.8939, '+91 20 5555 0105', 'Mon–Sun, 8:00–20:00'),
    ('Chennai — Nungambakkam', 'Khader Nawaz Khan Road', 'Chennai', 'TN', 13.0569, 80.2425, '+91 44 5555 0106', 'Mon–Sun, 8:00–20:00');

  insert into public.vehicles
    (name, brand, type, year, seats, luggage, transmission, fuel, awd, efficiency,
     price_per_day, location, image_url, images, description, features, status, trips)
  values
  (
    'Porsche 911 Carrera', 'Porsche', 'Sports', 2023, 4, 2, 'Automatic', 'Petrol', false, '9 kmpl',
    24000, 'Mumbai — Bandra West',
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'A weekend icon with everyday manners. The 911 Carrera pairs a flat-six soundtrack with razor-sharp steering — point it at a coast road and it simply clicks.',
    array['Apple CarPlay','Sport Chrono package','Heated seats','BOSE surround sound','Park assist','Launch control'],
    'available', 128
  ),
  (
    'BMW M4 Competition', 'BMW', 'Sports', 2024, 4, 2, 'Automatic', 'Petrol', false, '8 kmpl',
    18500, 'New Delhi — Aerocity',
    'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    '503 horsepower of precise, twin-turbo aggression. The M4 Competition is as happy carving canyon roads as it is cruising the highway.',
    array['M Sport seats','Head-up display','Carbon fibre trim','Harman Kardon audio','Adaptive M suspension','Wireless charging'],
    'available', 86
  ),
  (
    'Ford Mustang GT Convertible', 'Ford', 'Convertible', 2023, 4, 2, 'Automatic', 'Petrol', false, '7 kmpl',
    13500, 'Goa — Panaji',
    'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Top down, V8 up. The Mustang GT Convertible is the easiest way to turn an ordinary coastal drive into the highlight of the trip.',
    array['Power soft top','V8 soundtrack','Heated/cooled seats','SYNC 4 infotainment','Rear camera','B&O audio'],
    'available', 204
  ),
  (
    'Tesla Model Y Long Range', 'Tesla', 'Electric', 2024, 5, 3, 'Automatic', 'Electric', true, '530 km range',
    9500, 'Bengaluru — Indiranagar',
    'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Quiet, quick, and endlessly practical. With 530 km of range and access to the Supercharger network, the Model Y makes electric road trips painless.',
    array['530 km range','Autopilot','Panoramic glass roof','Supercharger access','Premium audio','Heated rear seats'],
    'available', 312
  ),
  (
    'Mercedes-Benz GLE 450', 'Mercedes-Benz', 'SUV', 2023, 5, 4, 'Automatic', 'Petrol', true, '11 kmpl',
    14500, 'New Delhi — Aerocity',
    'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'A calm, quiet sanctuary that happens to seat five in total comfort. Ideal for city weekends and long highway hauls alike.',
    array['MBUX infotainment','Panoramic roof','Burmester audio','Surround-view camera','Heated rear seats','Air suspension'],
    'available', 96
  ),
  (
    'Jeep Wrangler Rubicon', 'Jeep', 'SUV', 2023, 4, 2, 'Manual', 'Petrol', true, '10 kmpl',
    9000, 'Goa — Panaji',
    'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Removable roof, locking differentials and genuine off-road ability. The Rubicon is built for the detours you were going to take anyway.',
    array['4x4 low range','Removable hard top','Locking diffs','All-terrain tyres','Tow package','Rock rails'],
    'rented', 143
  ),
  (
    'Range Rover Velar', 'Land Rover', 'SUV', 2024, 5, 4, 'Automatic', 'Diesel', true, '13 kmpl',
    17500, 'Mumbai — Bandra West',
    'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'The most design-led Range Rover, with a hushed cabin, effortless torque and a silhouette that still turns heads in a valet line.',
    array['Air suspension','Meridian audio','Heated seats','Terrain Response','Power tailgate','Panoramic roof'],
    'available', 74
  ),
  (
    'Audi A5 Sportback', 'Audi', 'Sedan', 2023, 5, 3, 'Automatic', 'Petrol', true, '14 kmpl',
    11000, 'Pune — Koregaon Park',
    'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'A sleek five-door with quattro confidence — perfect for wet monsoon weekends and the mountain passes beyond.',
    array['Quattro AWD','Virtual cockpit','Bang & Olufsen audio','Heated seats','Adaptive cruise','Matrix LED'],
    'available', 118
  ),
  (
    'Mercedes-Benz C 300', 'Mercedes-Benz', 'Sedan', 2024, 5, 3, 'Automatic', 'Petrol', false, '13 kmpl',
    12000, 'Mumbai — Bandra West',
    'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Understated luxury with a tech-forward cabin. The C 300 is our most-requested city car for good reason.',
    array['MBUX with voice','Wireless charging','Heated seats','Blind-spot assist','LED headlights','Ambient lighting'],
    'available', 152
  ),
  (
    'BMW i4 eDrive40', 'BMW', 'Electric', 2023, 5, 3, 'Automatic', 'Electric', false, '480 km range',
    11500, 'Hyderabad — Banjara Hills',
    'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'A proper driver EV. Rear-wheel drive, 480 km of range and a cabin quiet enough to make city traffic feel almost serene.',
    array['480 km range','Curved display','Adaptive cruise','Harman Kardon audio','Fast charging','Heated seats'],
    'available', 98
  ),
  (
    'Toyota Camry Hybrid', 'Toyota', 'Sedan', 2023, 5, 3, 'Automatic', 'Hybrid', false, '23 kmpl',
    5500, 'Bengaluru — Indiranagar',
    'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'The sensible choice that never feels like a compromise. 23 kmpl, a roomy back seat and Toyota reliability for the long haul.',
    array['23 kmpl combined','Apple CarPlay','Adaptive cruise','Lane assist','Blind-spot monitor','USB-C ports'],
    'available', 421
  ),
  (
    'Volkswagen California Camper', 'Volkswagen', 'Van', 2022, 4, 3, 'Automatic', 'Diesel', false, '12 kmpl',
    12500, 'Goa — Panaji',
    'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'A hotel room on wheels. Pop-top roof, two-burner stove and enough storage for a week off-grid along the coast.',
    array['Pop-top roof','Kitchenette','Sleeps 4','Fridge','Solar panel','Awning'],
    'available', 67
  ),
  (
    'Mercedes-Benz V-Class', 'Mercedes-Benz', 'Van', 2023, 7, 5, 'Automatic', 'Diesel', false, '14 kmpl',
    13500, 'Chennai — Nungambakkam',
    'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Seven seats, airline-style space and a boot that swallows everyone luggage. The airport-run hero for groups.',
    array['7 seats','Captain chairs','Rear climate','Power doors','Panoramic roof','Wi-Fi hotspot'],
    'maintenance', 54
  ),
  (
    'Mazda MX-5 Miata', 'Mazda', 'Convertible', 2023, 2, 1, 'Manual', 'Petrol', false, '13 kmpl',
    6500, 'Pune — Koregaon Park',
    'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Light, honest and endlessly entertaining. The Miata proves you do not need big power to have the best drive of the week.',
    array['Manual gearbox','Soft top','Bose audio','Heated seats','Apple CarPlay','Limited-slip diff'],
    'available', 233
  ),
  (
    'Hyundai Creta SX', 'Hyundai', 'SUV', 2024, 5, 3, 'Automatic', 'Petrol', false, '17 kmpl',
    3500, 'Bengaluru — Indiranagar',
    'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'The do-everything family SUV. Compact enough for city lanes, roomy enough for a week away, and remarkably easy to live with.',
    array['Panoramic sunroof','Ventilated seats','Wireless charging','360 camera','ADAS suite','Bose audio'],
    'available', 268
  ),
  (
    'Maruti Suzuki Swift', 'Maruti Suzuki', 'Economy', 2023, 5, 2, 'Manual', 'Petrol', false, '22 kmpl',
    1800, 'Pune — Koregaon Park',
    'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=1600&q=80',
    array[
      'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=1200&h=800&q=80',
      'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=900&h=900&crop=entropy&q=80'
    ],
    'Light on the wallet, light on its feet. The Swift is the smart pick for city errands and short weekend escapes.',
    array['22 kmpl','Apple CarPlay','Rear camera','Cruise control','Keyless entry','USB charging'],
    'available', 512
  );

  insert into public.reviews (vehicle_id, author, rating, comment, created_at)
  select v.id, r.author, r.rating, r.comment, now() - (r.days || ' days')::interval
  from (values
    ('Porsche 911 Carrera', 'Aarav Mehta', 5, 'Pickup took under five minutes and the car was spotless. Exactly as pictured.', 12),
    ('Porsche 911 Carrera', 'Ishita Shah', 5, 'Drove it to Lonavala and back. The whole process felt effortless.', 28),
    ('BMW M4 Competition', 'Rohan Kapoor', 5, 'Great communication from the team and a really well-kept car. Would book again.', 9),
    ('BMW M4 Competition', 'Meera Iyer', 4, 'Superb condition. Only wish the pickup window had been a little wider.', 35),
    ('BMW M4 Competition', 'Kabir Singh', 5, 'The M4 is an occasion every single time. Flawless handover.', 52),
    ('Ford Mustang GT Convertible', 'Ananya Rao', 5, 'Perfect for our Goa trip. Top down the whole way. 10/10.', 6),
    ('Ford Mustang GT Convertible', 'Dev Malhotra', 4, 'Really comfortable on a long drive. Staff were friendly and quick.', 24),
    ('Tesla Model Y Long Range', 'Maya Chen', 5, 'Smooth handover, no hidden fees, and the car was fully charged when I got it.', 8),
    ('Tesla Model Y Long Range', 'Nikhil Bansal', 5, 'Supercharger network made the Bangalore-Mysore run painless.', 21),
    ('Tesla Model Y Long Range', 'Sara Fernandes', 4, 'Spotless car and easy pickup. Would rent again.', 47),
    ('Mercedes-Benz GLE 450', 'Vikram Sethi', 5, 'The family loved it. Huge boot and a really quiet cabin.', 14),
    ('Mercedes-Benz GLE 450', 'Naina Kapoor', 5, 'Booked last minute and everything still went perfectly.', 39),
    ('Jeep Wrangler Rubicon', 'Arjun Nair', 5, 'Took it off the beaten track near Anjuna. Unstoppable.', 11),
    ('Jeep Wrangler Rubicon', 'Ritika Jain', 4, 'Great ride and very clean interior. Pickup was easy to find.', 30),
    ('Range Rover Velar', 'Aditya Rao', 5, 'Superb condition and a fair price. Rove has become my go-to.', 5),
    ('Range Rover Velar', 'Farah Khan', 5, 'The most comfortable car I have rented in India. Worth every rupee.', 33),
    ('Audi A5 Sportback', 'Siddharth Menon', 4, 'Very clean and well maintained. The quattro helped in the rain.', 17),
    ('Audi A5 Sportback', 'Tanvi Desai', 5, 'Smooth handover, no surprises on the invoice.', 44),
    ('Mercedes-Benz C 300', 'Karan Ahuja', 5, 'Great city car with a lovely cabin. Would book again.', 7),
    ('Mercedes-Benz C 300', 'Pooja Reddy', 5, 'Loved it. A small scratch noted at pickup was handled without fuss.', 29),
    ('BMW i4 eDrive40', 'Rahul Verma', 5, 'Quiet, fast and fully charged. Perfect for a week in Hyderabad.', 10),
    ('BMW i4 eDrive40', 'Sneha Pillai', 4, 'Excellent car. Charging cable was included as promised.', 41),
    ('Toyota Camry Hybrid', 'Anil Kumar', 5, 'Easy, economical and spotless. Exactly what I needed.', 4),
    ('Toyota Camry Hybrid', 'Divya Shetty', 4, 'Great value and very comfortable for five people.', 26),
    ('Volkswagen California Camper', 'Neha Kulkarni', 5, 'Our Goa road trip was unforgettable thanks to the camper.', 15),
    ('Volkswagen California Camper', 'Sameer Joshi', 4, 'Sleeps four comfortably. Kitchen setup is genuinely useful.', 38),
    ('Mazda MX-5 Miata', 'Aisha Patel', 5, 'The most fun I have had on four wheels. Book it.', 13),
    ('Mazda MX-5 Miata', 'Raghav Shah', 4, 'Brilliant little car. Pickup staff knew their stuff.', 32),
    ('Hyundai Creta SX', 'Shreya Ghosh', 5, 'Perfect family SUV. Very clean and easy to drive.', 3),
    ('Hyundai Creta SX', 'Amit Bhatia', 4, 'Good value, well maintained, and the sunroof was a hit.', 23),
    ('Maruti Suzuki Swift', 'Riya Sen', 5, 'Fantastic little car for the city. Great price too.', 2),
    ('Maruti Suzuki Swift', 'Mohit Arora', 4, 'Clean, efficient and exactly as described.', 19)
  ) as r(name, author, rating, comment, days)
  join public.vehicles v on v.name = r.name;
end
$seed$;
