import { inr } from './format.js';
import {
  dayNumber,
  daysBetween,
  isValidDate,
  todayISO,
} from './pricing.js';
import { isEmail, phoneProblem, urlProblem } from './validation.js';
import { lateCharge } from './returns.js';

/**
 * Single source of truth for the customer-facing content and booking rules.
 *
 * The database stores every value as text (settings.value is text). Normalising
 * here means pages never have to guard against "false" strings, empty JSON or
 * numbers that were saved with a stray space.
 */

export const SITE_DEFAULTS = Object.freeze({
  // Hero
  hero_eyebrow: 'Self-drive rentals across India',
  hero_title: 'Cars and bikes, ready when you are.',
  hero_subtitle: 'Beautifully kept cars and two-wheelers, honest all-in pricing and a handover that takes minutes — not an afternoon. Pick a set of wheels, pick a road, and go.',
  hero_cta_label: 'Explore the fleet',
  hero_badge: 'New: 2026 fleet',
  hero_image_url: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=2000&q=85',
  hero_image_alt: 'A sports car on an open mountain road',
  hero_rating: '4.9',
  hero_trip_count: '2,400+',
  hero_trip_label: 'verified trips this year',

  // Brand and contact
  footer_tagline: 'Premium self-drive rentals across India. Transparent pricing, beautifully kept cars and bikes, and people who actually pick up the phone.',
  company_legal_name: 'Rove Mobility Pvt. Ltd.',
  gstin: '29AABCR1234F1Z5',
  registered_address: 'Indiranagar, Bengaluru 560038, Karnataka, India',
  support_email: 'hello@rove.rent',
  support_phone: '+91 80 5555 0100',
  whatsapp_number: '+91 80 5555 0100',
  support_hours: 'Every day, 7am–11pm IST',
  social_instagram: '',
  social_twitter: '',
  social_linkedin: '',
  legal_updated: '20 October 2026',

  // Feature toggles
  bikes_enabled: true,
  guest_checkout_enabled: true,
  reviews_enabled: true,
  compare_enabled: true,
  remember_trip_enabled: true,
  change_request_enabled: true,
  extensions_enabled: true,
  analytics_enabled: true,
  alerts_enabled: true,

  // Admin dashboard widgets — each section can be hidden per-operator taste.
  dashboard_show_desk: true,
  dashboard_show_finance: true,
  dashboard_show_pipeline: true,
  dashboard_show_recent: true,
  dashboard_show_fleet: true,
  dashboard_show_sales: true,
  dashboard_desk_ready: 'ready',
  dashboard_desk_ready_tip: 'A pick-up is ready when the licence, age and vehicle documents all pass the desk checklist.',

  // Vehicle cards — fully-loaded day-rate transparency
  card_show_all_in_rate: true,
  card_all_in_note: 'Typical one-day rate with standard protection and tax. Your exact total is quoted at checkout.',
  card_all_in_label: 'all-in',
  card_seasonal_live: 'Festive rates apply',

  // Storefront homepage sections — hide a group without touching copy.
  home_show_hero: true,
  home_show_catalog: true,
  home_show_upcoming_trip: true,
  home_show_how: true,
  home_show_locations: true,
  home_show_social: true,

  // Booking and cancellation policy
  cancellation_window_hours: '48',
  cancellation_refund_percent: '50',
  late_fee_per_hour: '500',
  late_grace_minutes: '60',
  // How many settled late returns in the last 90 days flag a vehicle as a
  // repeat offender on the returns desk, so staff know before the next handover.
  late_repeat_threshold: '3',
  min_rental_days: '1',
  max_rental_days: '45',
  max_advance_days: '365',
  min_age: '21',
  min_bike_rider_age: '18',
  fuel_refill_fee: '300',
  bike_fuel_refill_fee: '200',
  // Desk compliance gate — off by default so incomplete fleet data never
  // silently locks the handover desk.
  block_expired_docs: 'false',
  require_deposit_at_desk: 'false',
  licence_validity_required: 'true',
  operational_reminders: 'true',
  one_way_enabled: 'true',
  review_replies_enabled: 'true',
});

/**
 * Page-level storefront copy. Every value here is editable in Admin → Content
 * and falls back to the shipped default when the stored setting is blank.
 *
 * A few values support simple placeholders that are filled from the live
 * policy: {refund} and {deposit}.
 */
export const PAGE_TEXT_DEFAULTS = Object.freeze({
  // Announcement bar and navigation chrome
  announcement_primary: 'All-in pricing, no surprises',
  announcement_tertiary: 'Handpicked, inspected fleet',
  nav_cta_label: 'Book a ride',

  // ⌘K search palette
  palette_title: 'Search Rove',
  palette_placeholder: 'Search pages, hubs, vehicle types or actions…',
  palette_empty: 'Nothing matches “{query}”. Try a hub, vehicle type or page.',
  palette_button: 'Search',
  palette_close: 'Close search',
  palette_hint_open: 'open',
  palette_hint_move: 'move',
  palette_hint_close: 'close',
  palette_results_one: '{count} result',
  palette_results_many: '{count} results',
  palette_page_detail: 'Page',
  palette_action_detail: 'Quick action',
  palette_hub_detail: 'Pick-up hub',
  palette_type_detail: 'Vehicle type',
  palette_recent_detail: 'Recently viewed',
  palette_compare_detail: 'Side by side',
  palette_group_pages: 'Pages',
  palette_group_types: 'Vehicle types',
  palette_group_actions: 'Quick actions',
  palette_group_recent: 'Recently viewed',
  palette_group_hubs: 'Pick-up hubs',

  // Footer
  footer_cta_eyebrow: 'Ready when you are',
  footer_cta_badge: 'Instant confirmation',
  footer_cta_title: 'The road is closer than you think.',
  footer_cta_description: 'Compare the fleet, pick your dates and get an instant all-in price.',
  footer_cta_label: 'Browse the fleet',
  footer_fleet_title: 'Fleet',
  footer_company_title: 'Company',
  footer_support_title: 'Support',
  footer_legal_title: 'Legal',
  footer_location_label: 'Across India',
  footer_rights_text: 'All rights reserved.',
  footer_payment_methods: 'Razorpay, VISA, Mastercard, UPI',

  // Home — social proof avatars
  home_avatar_initials: 'MC, AR, VS, JK',

  // Home — recently viewed
  home_recent_eyebrow: 'Welcome back',
  home_recent_title: 'You were just looking at.',
  home_recent_clear_label: 'Clear',

  // Home — the signed-in customer's next trip
  home_upcoming_eyebrow: 'Your next trip',
  home_upcoming_manage: 'Manage booking',
  home_upcoming_extend: 'Extend trip',
  home_upcoming_voucher: 'View voucher',
  home_upcoming_balance: 'Rental balance {amount}',
  home_upcoming_deposit: 'Deposit due at pick-up {amount}',
  home_upcoming_deposit_tip: 'The refundable security deposit to bring when you collect the vehicle.',
  home_upcoming_vehicle_fallback: 'Your rental',

  // Home — cars and bikes
  home_travel_eyebrow: 'Two ways to travel',
  home_travel_title: 'Cars & Bikes.',
  home_travel_description: 'Self-drive cars for the long haul and motorbikes for the short, sharp, fun bits — both on the same all-in pricing.',
  home_car_card_title: 'Cars',
  home_car_card_copy: 'SUVs, sedans, hatchbacks and convertibles for every kind of trip.',
  home_car_card_cta: 'Browse all cars',
  home_bike_card_title: 'Bikes',
  home_bike_card_copy: 'Scooters, cruisers and sport bikes — helmets included, licence checked at pick-up.',
  home_bike_card_cta: 'Browse all bikes',

  // Home — categories
  home_categories_eyebrow: 'Find your fit',
  home_categories_title: 'A ride for every kind of trip.',
  home_categories_description: 'From a city runabout to a weekend sports car. Every vehicle is fully insured and photographed exactly as you will find it.',
  home_categories_cta: 'Browse the fleet',
  home_category_fallback: 'Check availability',

  // Home — featured fleet
  home_featured_eyebrow: 'The short list',
  home_featured_title: 'The fleet people keep coming back for.',
  home_featured_description: 'Our most-booked vehicles this month. Live availability, instant confirmation.',
  home_featured_cta: 'See the full fleet',

  // Home — how it works
  home_how_eyebrow: 'How it works',
  home_how_title: 'Three steps. One great drive.',
  home_how_description: 'We stripped out the queues, the fax machines and the surprise charges. What is left is the good part: choosing a car and driving it.',
  home_how_primary_label: 'Find a ride',
  home_how_secondary_label: 'Manage a booking',
  home_how_refund_note: 'Plans change; we keep it fair.',
  home_how_note: 'Instant confirmation · voucher and invoice ready to download',

  // Home — why choose us
  home_why_eyebrow: 'Why Rove',
  home_why_title: 'Rental, minus the friction.',
  home_why_description: 'We started Rove because renting a nice car in India should not feel like a negotiation. Every price you see includes GST, insurance and the extras you picked. The number at checkout is the number on your invoice.',
  home_why_badge: 'Handpicked fleet',
  home_delivery_title: 'Doorstep delivery',
  home_delivery_copy: 'Available across all {hubs} hubs',
  home_delivery_copy_anywhere: 'Available across India',
  home_why_rating_note: 'Verified reviews from real Rove customers.',
  home_why_image_url: '',

  // Home — locations
  home_locations_eyebrow: 'Where we are',
  home_locations_title: '{hubs}. One very good road trip.',
  home_locations_title_anywhere: 'Find us across India.',
  home_locations_description: 'Pick up in one city and drop off in another, or stay local and have the vehicle delivered to your door. One-way rentals between hubs are simple and clearly priced.',
  home_locations_cta: 'Check availability',
  home_locations_live_label: 'Live network',
  home_locations_network_note: 'Delivery available on request.',
  home_locations_one_way_label: 'One-way from',
  home_locations_more: 'See every hub with live availability on the network map.',

  // Home — reviews
  home_reviews_eyebrow: 'Reviews',
  home_reviews_title: 'Loved by people who notice the details.',
  home_reviews_description: 'We ask every customer for an honest review after the keys go back. These are unedited.',
  home_reviews_verified_label: 'Verified customer',

  // Home — FAQ
  home_faq_eyebrow: 'Good to know',
  home_faq_title: 'Questions, answered.',
  home_faq_description: 'Everything you need to know before you book. Still stuck? A real person is one message away.',
  home_faq_human_title: 'Talk to a human',

  // Home — closing call to action
  home_cta_eyebrow: 'The road is calling',
  home_cta_title: 'Your next great drive is one click away.',
  home_cta_description: 'Book in minutes. {refund} No membership, no paperwork mountain.',
  home_cta_primary_label: 'Browse the fleet',
  home_cta_secondary_label: 'Create an account',
  home_cta_manage_prefix: 'Already have a booking?',
  home_cta_manage_label: 'Manage it here',

  // About
  about_eyebrow: 'Our story',
  about_title: 'Renting a vehicle should feel *like a holiday,* not a negotiation.',
  about_lead: 'Rove started with a simple frustration: renting a nice car in India worked — until the queues, the fine print and the surprise charges turned up. We rebuilt the whole thing around one promise — the price you see is the price you pay — and never looked back.',
  about_hero_primary_label: 'Browse the fleet',
  about_hero_secondary_label: 'Talk to the team',
  about_mission_eyebrow: 'The mission',
  about_mission_title: 'Effortless, honest self-drive for everyone.',
  about_mission_body: 'Most rental experiences are built on distrust — deposits you cannot see, charges that appear later, and a counter that treats every customer like a potential dispute. We built Rove the other way round.',
  about_mission_body_2: 'Every car is priced all-in, photographed as you will find it, and handed over with a five-minute walkthrough. Bookings are confirmed instantly, invoices land the moment you pay, and if plans change, cancelling is a decision — not a fight.',
  about_mission_note: 'Our north star: a trip with Rove should be the easiest part of your weekend.',
  about_why_eyebrow: 'Why Rove',
  about_why_title: 'Four promises we actually keep.',
  about_why_description: 'Anyone can say it — we are happy to be judged on it. These are the same four promises we lead the homepage with, because they are the ones that matter at 2 PM on a Tuesday when you are holding the keys.',
  about_story_eyebrow: 'How we got here',
  about_story_title: 'From one rented Mustang to {hubs}.',
  about_story_title_anywhere: 'From one rented Mustang to a nationwide fleet.',
  about_story_body_1: 'The founding story is boring in the best way. A long weekend, a beautiful car, and a handover that involved three forms, two deposits and a lecture about mud. We came home and decided the market needed a better idea — not just a cheaper price.',
  about_story_body_2: 'Today the fleet covers {hubs} — from city runabouts to the cars and bikes people book for the photo album. The handover is five minutes, the paperwork is digital, and there is a human on the phone at every hour of the day.',
  about_story_body_2_anywhere: 'Today the fleet covers India — from city runabouts to the cars and bikes people book for the photo album. The handover is five minutes, the paperwork is digital, and there is a human on the phone at every hour of the day.',
  about_values_eyebrow: 'What we stand for',
  about_values_title: 'The promises behind every rental.',
  about_talk_eyebrow: 'Say hello',
  about_talk_title: 'A real person answers.',
  about_talk_description: 'Questions about the fleet, a booking in progress, or plans for next month’s road trip — reach out on any channel and a human replies. Seven days a week.',
  about_talk_cta_label: 'Contact the team',
  about_stat_trips_label: 'trips this year',
  about_stat_trips_note: 'and counting',
  about_stat_hubs_label: 'across India',
  about_stat_hubs_note: 'open every day',
  about_stat_hubs_note_empty: 'more hubs coming',
  about_stat_rating_label: 'from verified reviews',
  about_stat_rating_note: 'unedited, honest',
  about_stat_support_value: 'Daily',
  about_stat_support_label: 'human support',
  about_cta_eyebrow: 'Start here',
  about_cta_title: 'Enough about us. Pick your road.',
  about_cta_description: 'The fleet is live, the prices are all-in, and the keys are a five-minute handover away.',
  about_cta_primary_label: 'Browse the fleet',
  about_cta_secondary_label: 'Create an account',

  // Contact
  contact_eyebrow: 'Contact',
  contact_title: 'Talk to a *human.*',
  contact_description: 'Whether it is a booking question, a date change, or "does the Mustang fit three suitcases and a dog" — write to us and a real person replies, usually within the hour.',
  contact_reply_badge: 'Usually replies within the hour',
  contact_form_title: 'Send us a message',
  contact_form_hint: 'All fields except phone are required.',
  contact_form_submit: 'Send message',
  contact_form_sending: 'Sending…',
  contact_privacy_note: 'We reply from {email} and never share your details.',
  contact_human_eyebrow: 'Talk to a human',
  contact_human_body: 'Prefer the phone, or need an answer right now? The support desk is staffed {hours}.',
  contact_fast_title: 'We reply fast',
  contact_fast_body: 'A real person replies during support hours, every day.',
  contact_error_name: 'Please tell us your name.',
  contact_error_email: 'That email address does not look right.',
  contact_error_message: 'Add a little detail (at least 10 characters) so we can help.',
  contact_success: 'Message sent — a human will reply shortly.',
  contact_error_send: 'Something went wrong. Please try again.',
  contact_name_label: 'Your name',
  contact_name_placeholder: 'Maya Chen',
  contact_subject_label: 'What is this about?',
  contact_subject_placeholder: 'Choose a topic',
  contact_email_label: 'Email',
  contact_email_placeholder: 'you@example.com',
  contact_phone_label: 'Phone',
  contact_phone_placeholder: '+91 98xxx xxxxx',
  contact_message_label: 'Message',
  contact_message_placeholder: 'Tell us about your trip, your question, or the vehicle you have your eye on…',
  contact_booking_prefix: 'About booking',
  contact_booking_suffix: '— the team will pull up the trip before replying.',
  contact_booking_remove: 'Remove linked booking',
  contact_channel_email: 'Email',
  contact_channel_phone: 'Phone',
  contact_channel_whatsapp: 'WhatsApp',
  contact_manage_prefix: 'Already have a booking? Use',
  contact_manage_suffix: '— it shows your voucher, invoice and cancellation options without needing our help.',
  contact_hub_count: '{count} hubs',
  contact_hub_singular: '1 hub',
  contact_manage_prefix: 'Already have a booking? Use',
  contact_manage_suffix: '— it shows your voucher, invoice and cancellation options without needing our help.',

  // Legal
  legal_badge: 'Legal',
  legal_toc_label: 'On this page',
  legal_contact_title: 'Still have a question?',
  terms_title: 'Rental terms, plainly written.',
  terms_description: 'Eligibility, payments, deposits, cancellation and the damage rules — everything you agree to when you book, explained without the legalese.',
  privacy_title: 'Your data, handled properly.',
  privacy_description: 'What we collect, why we need it, who we share it with and how you stay in control. Written to be read, not skimmed.',

  // Browse
  browse_eyebrow: 'The fleet',
  browse_title: 'Find your next drive.',
  browse_loading: 'Checking live availability…',
  browse_available_suffix: 'for your dates. Taxes and insurance are shown clearly at checkout.',
  browse_edit_trip: 'Edit trip',
  browse_filters: 'Filters',
  browse_filters_description: 'Narrow the fleet to exactly what you need.',
  browse_reset: 'Reset',
  browse_show_results: 'Show',
  browse_clear_all: 'Clear all',
  browse_sort_label: 'Sort',
  browse_empty_title: 'No vehicles match those filters',
  browse_retry: 'Try again',
  browse_empty_description: 'Try widening your dates, moving to another hub, or clearing a filter or two. Our team can also source a specific vehicle on request.',
  browse_empty_map_title: 'No vehicles at this hub',
  browse_empty_map_description: 'This hub has no matches for these dates or filters. Pick another pin on the map, widen your dates, or clear a filter.',
  browse_empty_cta: 'Clear filters',
  browse_empty_map_cta: 'Show all hubs',
  browse_map_title: 'Live hub coverage',
  browse_map_selected: 'Selected hub',
  browse_map_coverage: 'Hub coverage',
  browse_map_all_hubs: 'All hubs',
  browse_map_missing: 'Add hub coordinates in Admin → Locations to plot the network. Hub filtering still works from the list.',

  // Vehicle comparison
  compare_eyebrow: 'Side by side',
  compare_title: 'Compare your shortlist.',
  compare_description: 'Up to three vehicles, compared on price, space, specs and the fine print. Your shortlist stays on this device.',
  compare_empty_title: 'Your shortlist is empty',
  compare_empty_description: 'Add up to three cars or bikes from the fleet and see them side by side before you book.',
  compare_empty_cta: 'Browse the fleet',
  compare_vehicle: 'Vehicle',
  compare_price: 'Price / day',
  compare_hub: 'Pick-up hub',
  compare_capacity: 'Space',
  compare_gearbox: 'Gearbox',
  compare_fuel: 'Fuel',
  compare_rating: 'Rating',
  compare_no_reviews: 'No reviews',
  compare_trips: 'Trips',
  compare_features: 'Highlights',
  compare_view: 'View vehicle',
  compare_clear: 'Clear comparison',
  compare_tray_title: 'Compare',
  compare_tray_cta: 'Compare {count}',
  compare_tray_clear: 'Clear',
  compare_add: 'Compare',
  compare_added: 'Comparing',
  compare_add_aria: 'Add {name} to comparison',
  compare_remove_aria: 'Remove {name} from comparison',
  compare_limit: 'You can compare up to 3 vehicles at a time.',
  compare_limit_note: 'Your shortlist is saved on this device. Compare up to 3 vehicles at a time.',
  compare_best: 'Best',
  compare_best_value: 'Best value pick',
  compare_verdict_hint: 'Cheapest earns “Best value” · top score earns “Best” · ties never claim a winner.',
  compare_tax_included: '{tax} included',
  compare_tax_added: '+ {tax} at checkout',
  compare_stale_note: 'Some shortlisted vehicles are no longer available and were removed.',
  compare_day_unit: '/ day',
  compare_trips_suffix: ' trips',

  // Trip ideas page
  routes_eyebrow: 'Trip ideas',
  routes_title: 'Pick a road, we will *handle the rest.*',
  routes_description: 'Popular loops and one-way drives between our hubs. Pick one to see live availability — or build your own below.',
  routes_badge: 'Curated for you',
  routes_own_title: 'Build your own trip',
  routes_own_description: 'Choose your own hubs, dates and vehicle type. One-way and round trips are both welcome.',
  routes_own_cta: 'Find cars',
  routes_from_label: 'From',
  routes_to_label: 'To',
  routes_round_trip: 'Round trip',
  routes_one_way: 'One-way',
  routes_view_fleet: 'See cars',
  routes_kind_car: 'Cars',
  routes_kind_bike: 'Bikes',
  routes_empty_title: 'No trip ideas yet',
  routes_empty_description: 'Add curated routes in Admin → Content so customers can jump straight into a familiar drive.',
  routes_empty_cta: 'Browse the fleet',

  // Hub directory
  hubs_badge: 'Live network',
  hubs_eyebrow: 'Where to find us',
  hubs_title: 'Seven hubs, one very good *road trip.*',
  hubs_description: 'Pick up in one city and drop off in another, or have the vehicle delivered to your door. Every hub shares the same fleet, honest pricing and a handover that takes minutes.',
  hubs_loading: 'Checking live availability across the network…',
  hubs_retry: 'Try again',
  hubs_count: '{count} hubs · {vehicles} vehicles ready today',
  hubs_empty: 'No hubs yet — check back soon.',
  hubs_vehicles: '{count} vehicles',
  hubs_vehicle: '{count} vehicle',
  hubs_from: 'From',
  hubs_price_on_request: 'Price on request',
  hubs_browse: 'See cars',
  hubs_map: 'View on map',
  hubs_help_title: 'Questions about a hub?',
  hubs_help_copy: 'A real person can tell you exactly which vehicles are at each pick-up point today.',

  // Saved searches (Browse)
  saved_title: 'Saved searches',
  saved_save: 'Save search',
  saved_save_aria: 'Save the current search',
  saved_name_label: 'Name this search',
  saved_name_placeholder: 'e.g. Goa long weekend',
  saved_submit: 'Save',
  saved_empty: 'No saved searches yet',
  saved_empty_copy: 'Save a hub-and-date combination here to jump straight back to it.',
  saved_apply: 'Apply',
  saved_delete: 'Remove saved search',
  saved_limit: 'You can save up to 8 searches.',
  saved_saved: 'Search saved',
  saved_duplicate: 'That search is already saved.',
  saved_remove: 'Search removed',

  // Help panel
  help_button: 'Help',
  help_button_aria: 'Open support help',
  help_title: 'Need a hand?',
  help_description: 'A real person answers fast — pick any channel. Call, email or WhatsApp, seven days a week.',
  help_call: 'Call us',
  help_email: 'Email us',
  help_whatsapp: 'WhatsApp us',
  help_booking_label: 'Message us about {code}',
  help_close: 'Close help',

  // Availability watchlist
  alert_vehicle_button: 'Alert me when it’s free',
  alert_vehicle_button_aria: 'Get notified when this vehicle is free',
  alert_modal_title: 'Watch this vehicle',
  alert_modal_desc: 'We will message you the moment {vehicle} is free for your chosen window.',
  alert_from_label: 'Want it from',
  alert_to_label: 'to',
  alert_submit: 'Save alert',
  alert_created: 'Alert saved — we will message you when it’s free.',
  alert_exists: 'You already have this watchlist alert.',
  alert_limit: 'You can keep up to 10 watchlist alerts.',
  alert_scope: 'Watchlist alerts',
  alert_watching: 'Watching',
  alert_free_now: 'Free for your dates — book it',
  alert_notified: 'You were notified — checking again',
  alert_empty: 'No watchlist alerts',
  alert_empty_copy: 'Save a vehicle you are watching and get notified the moment it is free for your dates.',
  alert_remove: 'Remove alert',
  alert_removed: 'Alert removed.',

  // Self-serve trip changes
  amend_title: 'Change this booking',
  amend_submitting: 'Sending change request…',
  amend_description: 'Move the dates or hubs and we will check live availability and show the new price before anything changes. You can withdraw any time until staff confirm.',
  amend_change_button: 'Change trip',
  amend_change_aria: 'Request a change to this booking',
  amend_submit: 'Send change request',
  amend_see_price: 'See new price',
  amend_sent: 'Change request sent — our team will confirm by email.',
  amend_pending: 'Change requested',
  amend_pending_note: 'Waiting for our team to confirm your change. Withdraw any time before then.',
  amend_pending_dates: 'Requested dates',
  amend_pending_hubs: 'Requested hubs',
  amend_pending_times: 'Pick-up / drop-off',
  amend_pending_total: 'Proposed total',
  amend_pending_requested: 'Requested {date}',
  amend_pending_delta_more: '{amount} more than the current total',
  amend_pending_delta_less: '{amount} less than the current total',
  amend_pending_card: 'Requested {range} · awaiting approval',
  amend_withdraw: 'Withdraw request',
  amend_withdrawn: 'Change request withdrawn',
  amend_unavailable: 'Those dates are not available for this vehicle. Try another window.',
  amend_no_changes: 'Pick new dates or hubs first.',
  amend_dates_invalid: 'Choose a drop-off date at least {days} day{s} after pick-up.',
  amend_pickup_label: 'New pick-up hub',
  amend_dropoff_label: 'New drop-off hub',
  amend_from_label: 'New pick-up date',
  amend_to_label: 'New drop-off date',
  amend_pickup_time_label: 'New pick-up time',
  amend_dropoff_time_label: 'New drop-off time',
  amend_new_total: 'New total',
  amend_current_total: 'Current total',
  amend_price_note_more: 'This trip costs {amount} more — the difference is payable at pick-up.',
  amend_price_note_less: 'This trip costs {amount} less — the difference becomes a credit and is refunded to your original payment method after the change is confirmed.',
  amend_price_note_same: 'Price stays the same.',
  amend_staff_approve: 'Approve change',
  amend_staff_decline: 'Decline change',
  amend_staff_chip: 'Change requests',
  extend_title: 'Extend this return',
  extend_description: 'Keep the vehicle and return later. Pick a new drop-off date and time — extra days are charged at the quoted fare and collected at drop-off.',
  extend_pickup_locked: 'Pick-up stays as {hub} · {date}',
  extend_return_label: 'New return date',
  extend_return_time_label: 'New return time',
  extend_extension_chip: 'Extend return',
  extend_extension_aria: 'Extend the return on this booking',
  extend_submit: 'Confirm extension',
  extend_submitting: 'Extending…',
  extend_sent: 'Return extended — the booking now ends on {date} at {time}.',
  extend_apply: 'Apply extension',
  extend_applying: 'Applying…',
  extend_applied: 'Return extended to {date} at {time}.',
  extend_unavailable: 'That return window is not available for this vehicle — another booking may be scheduled. Try a different time.',
  extend_pick_later: 'Pick a later return date or time to extend.',
  extend_overdue_title: 'You are overdue by {days} day{s}',
  extend_overdue_copy: 'You were due back on {date}. {terms} Extend now to stop the fee growing.',
  extend_overdue_staff: 'Return was due {date} · {days} day{s} late',
  extend_active_lock: 'Only the return date and time can change once the trip has started.',
  extend_paid_early_note: 'Extra days are collected at drop-off — nothing is charged now.',
  extend_price_more: 'This trip costs {amount} more — collected at drop-off.',
  extend_price_same: 'Price stays the same.',
  extend_whats_included_deposit: 'Your security deposit stays {amount} and is settled as usual at return.',
  extend_quick_1h: '+1 hour',
  extend_quick_3h: '+3 hours',
  extend_quick_1d: '+1 day',
  extend_quick_2d: '+2 days',
  extend_quick_3d: '+3 days',
  bookings_overdue_chip: 'Overdue pick-up',
  amend_staff_proposed_total: 'Proposed total',
  amend_staff_request_dates: 'Requoted for',
  amend_staff_request_hubs: 'Proposed hubs',
  amend_staff_history: 'Trip change history',
  amend_staff_history_empty: 'Nothing changed yet on this booking.',
  amend_staff_action: 'Staff decision',
  amend_staff_reason_label: 'Reason for the customer',
  amend_staff_reason_placeholder: 'e.g. the vehicle is already booked for those dates',
  amend_approved: 'Change approved — the booking was updated and repriced.',
  amend_declined: 'Change request declined. Your original booking is unchanged.',
  amend_staff_none: 'No pending change requests',
  amend_group_title: 'Trip changes',
  amend_history_label: 'Trip activity',
  amend_history_empty: 'Nothing has changed on this booking since it was created.',
  amend_history_extension: 'Return extended · {summary}',
  amend_history_extension_noop: 'Return extended',
  amend_history_change: 'Dates / hubs changed · {summary}',
  amend_history_by: 'Actioned by {by}',
  amend_history_delta_more: '{amount} more due',
  amend_history_delta_less: '{amount} credited',

  // Dashboard analytics
  analytics_eyebrow: 'Insights',
  analytics_title: 'Business at a glance.',
  analytics_description: 'Trends, mixes and conversion for the last 30 days, updated live from real bookings and payments.',
  analytics_days: 'Last 30 days',
  analytics_prior_hint: 'vs prior 30 days',
  analytics_prior_hint_tpl: 'vs prior {days} days',
  analytics_prior_none: 'no earlier data in this window',
  analytics_gst_label: 'GST collected',
  analytics_cancel_label: 'Cancellation rate',
  analytics_cancel_hint: '{count} booking{s} cancelled in this window',
  analytics_cash_received_label: 'Cash received',
  analytics_cash_hint: 'in the selected window, deposits excluded',
  analytics_float_label: 'Deposit float',
  analytics_float_hint: 'held against open returns',
  analytics_checkout_title: 'Abandoned checkouts',
  analytics_checkout_desc: 'Customers who opened payment but never completed — a sales recovery pipeline.',
  analytics_checkout_count: '{count} abandoned attempts · {value} in lost revenue',
  analytics_checkout_recent: 'Biggest abandoned baskets',
  analytics_outstanding_label: 'Outstanding',
  analytics_active_label: 'Active rentals',
  analytics_hours_label: 'Pick-up times',
  analytics_hours_desc: 'Bookings by planned pick-up hour — staff the desk when demand peaks.',
  analytics_dropoff_label: 'Drop-off times',
  analytics_dropoff_desc: 'When vehicles are due back — staff the desk for the return wave.',
  analytics_lead_mix_label: 'Book-ahead (lead time)',
  analytics_lead_mix_desc: 'Days between booking and pick-up — how far ahead demand builds.',
  analytics_km_label: 'Distance & allowances',
  analytics_km_desc: 'Kilometres recorded between hand-over and drop-off — and the excess-km fees they generated.',
  analytics_km_empty: 'No odometer records yet. Distance analytics appear after the first settled hand-over.',
  analytics_customer_acquisition_title: 'Customer acquisition',
  analytics_customer_acquisition_desc: 'New customer registrations by month — a rising trend means your reach is growing.',
  analytics_customer_acquisition_total: '{count} registered · {recent} this month',
  analytics_customer_acquisition_monthly: 'Sign-ups',
  analytics_extensions_label: 'Trip extensions',
  analytics_extensions_desc: 'Return dates moved later on active trips — and the extra revenue those added days earned.',
  analytics_extensions_revenue: '{count} extension{s} · {amount} extra revenue',
  analytics_extensions_empty: 'No extensions yet. They appear here whenever a customer or the desk moves a return later.',
  analytics_extensions_recent: 'Recent extensions',
  analytics_returns_label: 'Return punctuality',
  analytics_returns_desc: 'How often trips came back on time — settled returns only, with customers who extended before returning counted as on time.',
  analytics_late_vehicle_title: 'Late returns by vehicle',
  analytics_late_vehicle_desc: 'Which vehicles come back late and how much the late fees earned — the worst offenders first, from settled returns only.',
  analytics_late_vehicle_empty: 'No late returns settled yet. They appear here after the first late drop-off.',
  dashboard_late_offenders: 'Worst late offenders',
  analytics_returns_on_time: 'On time',
  analytics_returns_late: 'Late',
  analytics_returns_avg_late: 'Avg lateness {days} day{s}',
  analytics_returns_empty: 'Settled returns appear here after the first drop-off.',
  analytics_returns_week: 'Returns this week',
  analytics_util_trend_title: 'Historic fleet utilisation',
  analytics_util_trend_desc: 'Booked or on-rent vehicles per day as a percentage of the bookable fleet.',
  analytics_returns_due_today: 'Due today · {count}',
  analytics_weekday_revenue_label: 'Weekday revenue',
  analytics_weekday_revenue_desc: 'Recognised revenue by the day trips start.',
  analytics_cancel_reasons_title: 'Cancellation reasons',
  analytics_cancel_reasons_desc: 'Why trips ended before they started.',
  analytics_cancel_reasons_none: 'No cancellations yet — the queue is clean.',
  analytics_no_show_title: 'No-shows',
  analytics_no_show_desc: 'Confirmed bookings whose pick-up day has passed and never started.',
  analytics_no_show_none: 'No confirmed booking has been left at the desk so far.',
  analytics_no_show_days: 'Follow up on the desk before the deposit window closes.',
  analytics_revenue_vehicle_label: 'Revenue by vehicle',
  analytics_revenue_vehicle_desc: 'Revenue earned per vehicle from completed trips.',
  analytics_error_title: 'We could not load this view.',
  analytics_error_copy: 'The data service did not answer. Nothing has been changed — retry when the connection is back.',
  analytics_retry: 'Try again',
  analytics_revenue_label: 'Revenue',
  analytics_bookings_label: 'Bookings',
  analytics_avg_value_label: 'Avg booking value',
  analytics_completion_label: 'Completion',
  analytics_cash_label: 'Captured 30 days',
  analytics_repeat_label: 'Repeat customers',
  analytics_customer_mix_title: 'Customers & trip length',
  analytics_customer_mix_desc: 'Where revenue comes from — first trips versus returning riders — and how long people keep the keys.',
  analytics_new_revenue_label: 'First trip',
  analytics_returning_revenue_label: 'Returning',
  analytics_trip_length_label: 'Completed trips by length',
  analytics_trip_length_desc: 'How many completed bookings fell into each rental length.',
  analytics_lead_label: 'Avg lead time',
  analytics_trip_label: 'Avg trip length',
  analytics_chart_revenue: 'Revenue trend',
  analytics_chart_revenue_desc: 'Recognised revenue — completed trips by start date, GST included.',
  analytics_chart_cash: 'Cash received',
  analytics_chart_cash_desc: 'Payments actually captured, deposits and holds excluded.',
  analytics_chart_bookings: 'Bookings trend',
  analytics_chart_bookings_desc: 'New bookings created each day by trip start date.',
  analytics_chart_mix: 'Fleet category mix',
  analytics_chart_hubs: 'Bookings by pick-up hub',
  analytics_chart_funnel: 'Booking funnel',
  analytics_funnel_desc: 'Cumulative view: every request, the ones confirmed, the ones that started and the ones completed. Cancelled and rejected requests only count at the requested stage.',
  analytics_complete_rate: '{percent}% of resolved bookings completed',
  analytics_funnel_requested: 'Requested',
  analytics_funnel_confirmed: 'Confirmed',
  analytics_funnel_active: 'Started',
  analytics_funnel_completed: 'Completed',
  analytics_units_trip: 'trip',
  analytics_units_trips: 'trips',
  analytics_trend_peak: 'Peak day {label} at {value}',
  analytics_range_label: 'Range',
  analytics_range_7: '7 days',
  analytics_range_30: '30 days',
  analytics_range_90: '90 days',
  analytics_chart_heat: 'Pick-up demand',
  analytics_chart_heat_desc: 'When pick-ups actually happen — a slot × weekday heatmap.',
  analytics_chart_heat_dropoff: 'Return demand',
  analytics_chart_heat_dropoff_desc: 'When vehicles come back — a slot × weekday heatmap on the return day.',
  analytics_heat_early: 'Early',
  analytics_heat_morning: 'Morning',
  analytics_heat_afternoon: 'Afternoon',
  analytics_heat_evening: 'Evening',
  analytics_heat_night: 'Night',
  analytics_chart_weekday: 'Demand by weekday',
  analytics_chart_weekday_desc: 'Trips starting by day of the week.',
  analytics_chart_forecast: 'Pipeline — next 14 days',
  analytics_chart_forecast_desc: 'Revenue already on the books from confirmed and active trips.',
  analytics_chart_fleet: 'Fleet health',
  analytics_chart_fleet_desc: 'Available, on rent and in service right now.',
  fleet_health_fresh: 'Fresh',
  fleet_health_due: 'Due soon',
  fleet_health_overdue: 'Overdue',
  fleet_health_most_due: 'Service due first',
  analytics_fleet_available: 'Available',
  analytics_fleet_rented: 'On rent',
  analytics_fleet_service: 'In service',
  drawer_discard_title: 'Discard unsaved changes?',
  drawer_discard_copy: 'You have unsaved changes here. Leaving now will lose them.',
  drawer_discard_confirm: 'Discard & close',
  drawer_discard_keep: 'Keep editing',
  bookings_notes_label: 'Internal notes',
  bookings_notes_placeholder: 'Damage noted, late return, special request…',
  bookings_notes_save: 'Save note',
  bookings_dates_error: 'Choose a valid date range.',
  bookings_dates_saved: 'Dates updated and totals recalculated.',
  bookings_hubs_error: 'Choose both a pick-up and drop-off hub.',
  bookings_times_error: 'Choose valid pick-up and drop-off times.',
  bookings_trip_saved: 'Trip details updated and totals recalculated.',
  bookings_refund_issued: 'Refund issued.',
  bookings_amount_error: 'Enter a whole-rupee amount greater than zero.',
  bookings_amount_over: 'The amount cannot exceed the current balance.',
  bookings_payment_recorded: 'Payment of {amount} recorded.',
  bookings_credit_refunded: 'Customer credit refunded.',
  bookings_notes_saved: 'Notes saved.',
  bookings_not_found: 'No booking found for {code}.',
  bookings_already_status: 'This booking is already {status}.',
  bookings_approved: 'Approved {count} booking{s}.',
  bookings_rejected: 'Rejected {count} booking{s}.',
  bookings_skipped: '{count} skipped — not pending.',
  bookings_exported: 'Exported {count} booking{s}.',
  inbox_shortcuts: 'J / K navigate · R reply · / search · Esc close',
  staff_view_booking: 'View booking',
  staff_view_booking_tip: 'Open this booking in Bookings to see the full record while you work.',
  inbox_reply: 'Reply',
  inbox_reply_title: 'Reply to {name}',
  inbox_reply_desc: 'Write once, then send from your email app. Nothing is sent from the console.',
  inbox_reply_template: 'Start from a template',
  inbox_reply_template_none: 'Write my own',
  inbox_reply_body: 'Message',
  inbox_reply_open: 'Open in email',
  inbox_reply_copy: 'Copy text',
  inbox_reply_copied: 'Reply copied to the clipboard.',
  inbox_reply_resolve: 'Mark as resolved after sending',
  inbox_reply_sent: 'Email app opened — message marked resolved.',
  inbox_reply_no_email: 'This message has no email address. Call the customer instead.',
  inbox_unsaved: 'Unsaved changes',
  inbox_saved: 'Message updated.',
  inbox_status_label: 'Status',
  inbox_subject_label: 'Subject',
  inbox_notes_label: 'Internal notes',
  inbox_notes_hint: 'Only staff can see this. Add context, a follow-up date or a resolution.',
  inbox_save: 'Save notes & status',
  inbox_delete: 'Delete message',
  inbox_delete_confirm: 'Are you sure you want to delete this message? This cannot be undone.',
  inbox_delete_keep: 'Keep it',
  inbox_deleting: 'Deleting…',
  inbox_refreshing: 'Refreshing…',
  inbox_saving: 'Saving…',
  inbox_deleted: 'Message deleted.',
  inbox_copy_failed: 'Copy failed — select the text and copy it manually.',
  inbox_empty_title: 'No messages match',
  inbox_empty_desc: 'Try another filter or search term.',
  inbox_empty_desc_all: 'New contact form messages will appear here.',
  inbox_subtitle: 'Contact form messages from the customer site. Reply by email, add internal notes and close the loop.',
  inbox_delete_irreversible: 'This action cannot be undone.',
  inbox_template_one_way: 'Thanks for reaching out. One-way rentals are available between most of our hubs — tell us the pick-up and drop-off city and dates, and we will send a quote with any relocation fee included (waived on select routes).',
  inbox_template_deposit: 'The security deposit is ₹5,000 per booking, collected at pick-up and refunded within 5–7 working days of drop-off after a quick condition check. Card, UPI and cash are accepted at the desk.',
  inbox_template_extension: 'You can extend a trip from Account → My trips → Extend trip, subject to availability. We will show the extra days at the same daily rate before you confirm.',
  inbox_template_cancel: 'You can cancel from Manage a booking with the code on your voucher. Cancellations at least 2 days before pick-up are refunded in full; inside 2 days, 50% of the amount paid is refunded.',
  dashboard_top_vehicles: 'Top vehicles',
  dashboard_top_vehicles_desc: 'Ranked by recognised revenue — tap any row for its full page.',
  dashboard_top_bookings: '{count} booking{s}',
  dashboard_util_title: 'Utilisation, next 30 days',
  dashboard_top_util: '{percent}% utilised',
  dashboard_b2b_title: 'Group & corporate enquiries',
  dashboard_b2b_open: '{count} open · {names}',
  dashboard_b2b_reply: 'Reply in inbox',
  dashboard_peak_title: 'Peak-season readiness',
  dashboard_peak_available: '{count} of {capacity} vehicles available',
  dashboard_peak_pct: '{percent}% available',
  dashboard_peak_window: 'Festive window {start} – {end}',
  dashboard_peak_risk: '{count} at risk',
  dashboard_peak_view: 'View calendar',
  fleet_marked: 'Marked {count} vehicle{s} {status}.',
  fleet_skipped: '{count} skipped — unchanged or missing.',
  fleet_images_max: 'Use no more than 8 images per vehicle.',
  fleet_images_dupe: 'That image is already in the gallery.',
  fleet_images_min: 'Keep at least one image. Add a replacement before removing this one.',
  fleet_image_uploaded: 'Image uploaded.',
  fleet_removed: 'Vehicle removed.',
  maintenance_odometer: 'Odometer updated.',
  maintenance_workshop_range: 'The workshop block must end after it starts.',
  maintenance_workshop_added: 'Workshop downtime added to the availability calendar.',
  maintenance_entry_removed: 'Service entry removed and the baseline recalculated.',
  maintenance_exported: 'Exported {count} vehicle{s}.',
  pricing_fix_errors: 'Fix the highlighted fields before saving.',
  pricing_addon_saved: 'Add-on saved.',
  pricing_promo_saved: 'Promo saved.',
  pricing_tier_updated: 'Protection tier updated. New quotes use it immediately.',
  pricing_fix_rate_rules: 'Fix the highlighted rate rules before saving.',
  pricing_rate_rules_saved: 'Rate rules updated. New quotes use these values immediately.',
  pricing_deleted: 'Deleted.',
  locations_saved: 'Location saved.',
  locations_removed: 'Location removed.',
  comms_template_error: 'Add a subject line and a body before saving.',
  comms_template_saved: 'Template saved. New messages use it immediately.',
  comms_discarded: 'Unsaved template edits discarded.',
  users_updated: '{name} updated.',
  users_licence: "{name}'s licence {verified}.",
  users_exported: 'Exported {count} user{s}.',
  reviews_removed: 'Review removed.',
  analytics_promo_title: 'Offer performance',
  analytics_promo_desc: 'Promo codes in use and the revenue they brought in.',
  analytics_page_eyebrow: 'Insights',
  analytics_page_title: 'Analytics command center',
  analytics_page_intro: 'Every chart stays live on the real booking and payment data. Trends, revenue and mix follow the selected window; outstanding balances and lifetime customer metrics stay current.',
  analytics_section_money: 'Money',
  analytics_section_deposits: 'Deposits & returns',
  analytics_section_demand: 'Demand',
  analytics_section_fleet_mix: 'Fleet & mix',
  analytics_section_maintenance: 'Fleet maintenance',
  analytics_reviews_title: 'Guest reviews',
  analytics_reviews_desc: 'What customers say after a trip — average score, star mix, momentum and the vehicles that need attention.',
  analytics_reviews_avg: 'Average rating',
  analytics_reviews_total: 'Reviews',
  analytics_reviews_recent: 'Last 30 days',
  analytics_reviews_five: '5-star share',
  analytics_reviews_low: '2-star or below',
  analytics_reviews_replied: 'Replied',
  analytics_reviews_replied_tpl: '{replied} of {total} answered',
  analytics_reviews_dist: 'Star mix',
  analytics_reviews_trend: 'Average rating by month',
  analytics_reviews_trend_desc: 'A dip here is the earliest warning that handovers or vehicle condition are slipping.',
  analytics_reviews_vehicle: 'Highest and lowest rated vehicles',
  analytics_reviews_low_title: 'Low ratings to follow up',
  analytics_reviews_low_none: 'No 3-star-or-lower reviews. Nothing to chase.',
  analytics_reviews_empty: 'No reviews yet',
  analytics_reviews_empty_desc: 'Reviews appear here as soon as customers rate a completed trip.',
  analytics_reviews_open: 'Open reviews',
  analytics_reviews_count_tpl: '{count} reviews',
  analytics_reviews_low_tpl: '{count} of {total} reviews',
  analytics_reviews_avg_tpl: '{rating} average',
  analytics_contribution_title: 'Vehicle contribution',
  analytics_contribution_desc: 'Revenue minus workshop spend for the selected range. Insurance, fuel and depreciation are not tracked, so this is a contribution figure rather than profit.',
  analytics_contribution_revenue: 'Revenue',
  analytics_contribution_service: 'Service spend',
  analytics_contribution_net: 'Contribution',
  analytics_contribution_trips_one: '1 trip',
  analytics_contribution_trips_many: '{count} trips',
  analytics_contribution_margin: '{percent}% margin',
  analytics_contribution_no_revenue: 'no revenue yet',
  analytics_contribution_none: 'No completed trips or workshop spend in this range yet.',
  analytics_contribution_negative: '{count} vehicles spent more on service than they earned.',
  analytics_contribution_negative_one: '1 vehicle spent more on service than it earned.',
  analytics_contribution_positive: 'Every active vehicle covered its workshop spend.',
  analytics_contribution_idle: '{count} vehicles sat idle in this range.',
  analytics_contribution_idle_one: '1 vehicle sat idle in this range.',
  analytics_contribution_total: 'Fleet contribution',
  analytics_contribution_note: 'Contribution = revenue − service spend',
  analytics_promo_uses: 'uses',
  analytics_promo_revenue: 'Revenue',
  analytics_export: 'Export CSV',
  analytics_exported: 'Analytics exported to CSV.',
  calendar_block_updated: 'Availability block updated.',
  calendar_block_created: 'Vehicle dates blocked.',
  calendar_block_removed: 'Availability block removed.',
  calendar_remove_title: 'Remove this block?',
  calendar_remove_desc: 'The vehicle will become bookable again for these dates.',
  calendar_remove_keep: 'Keep it',
  calendar_remove_confirm: 'Remove block',
  calendar_remove_progress: 'Removing…',
  calendar_remove_available_from: '{name} will be available from {dates}.',
  calendar_remove_this_vehicle: 'This vehicle',
  calendar_remove_desc_placeholder: 'the selected dates',

  // Handover desk
  desk_title: 'Handover desk',
  desk_subtitle: 'Today and the next seven days — licence checks, deposits and notes before the key turns.',
  desk_today: 'Today',
  desk_upcoming: 'Next {days} days',
  desk_empty: 'No pick-ups ahead',
  desk_empty_copy: 'The desk is clear. New bookings appear here as they come in.',
  desk_empty_action: 'Open availability',
  desk_checks: 'Handover checklist',
  desk_ready: 'Ready to hand over',
  desk_awaiting: 'Awaiting confirmation',
  desk_blocked: '{count} item{s} to review',
  desk_save_checks: 'Save checklist',
  desk_saved_checks: 'Checklist saved.',
  desk_checks_autosave: 'Your checklist is saved when the trip starts.',
  desk_start_blocked: 'To start: {reasons}',
  desk_start_blocked_generic: 'Complete the handover checklist to start this trip.',
  desk_start_trip: 'Start trip',
  desk_starting: 'Starting…',
  desk_started: 'Trip started — vehicle marked on rent.',
  desk_start_confirm: 'Start this trip?',
  desk_start_confirm_copy: 'The booking moves to On rent. {blocked} still needs attention before handover.',
  desk_voucher: 'Voucher',
  desk_call: 'Call',
  desk_email: 'Email',
  desk_deposit_due: '{amount} deposit due at pick-up',
  desk_deposit_collect: 'Collect deposit',
  desk_deposit_collect_aria: 'Record the security deposit taken at pick-up',
  desk_deposit_collect_title: 'Record deposit collected',
  desk_deposit_collect_copy: 'Record how the {amount} deposit was taken at pick-up so finance can trace the float.',
  desk_deposit_collect_confirm: 'Confirm collection',
  desk_deposit_collecting: 'Recording…',
  desk_deposit_collected_success: 'Deposit collected and recorded.',
  desk_deposit_collected_badge: 'Deposit collected · {method}',
  desk_deposit_collected_tip: 'Recorded at pick-up. Settle it at drop-off in the Returns tab.',
  desk_deposit_amount_label: 'Amount (₹)',
  desk_deposit_method_label: 'Method',
  desk_deposit_reference_label: 'Reference (optional)',
  desk_deposit_reference_placeholder: 'UPI / txn ID or note',
  desk_deposit_amount_error: 'Enter a valid deposit amount.',
  desk_deposit_amount_over: 'The deposit cannot exceed the amount due for this booking.',
  desk_deposit_cancel: 'Cancel',
  desk_remind_pickup: 'Remind',
  desk_remind_pickup_tip: 'Send the customer a pick-up reminder (once per day).',
  desk_remind_pickups: 'Remind pick-ups',
  desk_remind_pickups_tip: 'Send a pick-up reminder to every confirmed customer collecting today or tomorrow.',
  desk_pickup_reminded: 'Pick-up reminder sent.',
  desk_reminded_pickups: 'Pick-up reminder sent to {count} customer{s}.',
  bookings_customer_money: 'Customer money position',
  bookings_money_note: 'Across all trips for this customer — what they owe, what they are owed, and what deposit is still on the books.',
  bookings_money_outstanding: 'Outstanding',
  bookings_money_credit: 'Credit due',
  bookings_money_deposits: 'Deposits held',
  bookings_money_awaiting: '{count} awaiting settlement · {amount}',
  bookings_money_settle: 'Settle deposits',
  desk_docs_label: 'Vehicle documents',
  desk_docs_blocked: 'Insurance or PUC has expired — renew before handover.',
  desk_overdue: 'Overdue pick-up',
  desk_overdue_days: '{days}d overdue',
  desk_no_show: 'Mark no-show',
  desk_no_show_title: 'Mark this pick-up as a no-show?',
  desk_no_show_copy: 'The booking is cancelled, the vehicle is released and the customer is notified. Any refund you choose goes back to the original payment method.',
  desk_no_show_done: 'Marked as a no-show — the vehicle is free again.',
  desk_no_show_refund: 'Refund {amount} to the customer',
  desk_pending_note: 'Confirm this booking before handover.',
  desk_tab_pickups: 'Pick-ups',
  desk_tab_returns: 'Returns',
  desk_search_placeholder: 'Search name, code, phone or car',
  desk_search_aria: 'Search the pick-up board',
  desk_scope_aria: 'Filter pick-ups',
  desk_scope_all: 'All',
  desk_scope_today: 'Today',
  desk_scope_attention: 'Needs attention',
  desk_clear_filters: 'Clear filters',
  desk_no_match: 'No pick-ups match',
  desk_no_match_copy: 'Try another name, code or phone number — or clear the filters to see the whole board.',
  desk_ready_today: '{ready} of {total} ready today',
  desk_ready_today_tip: 'Ready means the licence, age and vehicle documents pass the handover checklist.',
  desk_returns_subtitle: 'Drop-offs due, overdue trips and deposits waiting to settle.',
  desk_returns_empty: 'No returns to settle',
  desk_returns_empty_copy: 'Active trips appear here as their drop-off date arrives.',
  return_overdue: 'Overdue {days}d',
  return_overdue_group: 'Overdue & awaiting inspection',
  return_completed_group: 'Completed · deposit not settled',
  return_completed_badge: 'Completed · settle deposit',
  return_due_today: 'Due today',
  return_next7: 'Due in the next 7 days',
  return_later: 'Due later',
  return_search_placeholder: 'Search name, code, phone or plate',
  return_search_aria: 'Search returns',
  return_showing: '{shown} of {total} returns',
  return_no_match: 'No returns match',
  return_no_match_copy: 'Try another name, code or plate — or clear the search to see every open return.',
  return_clear_filters: 'Clear search',
  return_upcoming: 'Due {date}',
  return_severity: 'Severity',
  return_fee_default_note: '{terms}',
  return_late_fee_auto: '{duration} late at {hourly}/hour, capped at {daily}/day',
  return_late_fee_none: 'On time — no late fee',
  return_late_fee_high: 'This is more than the booking total ({amount}) — check the drop-off date before settling.',
  return_late_fee_reset: 'Reset to auto',
  late_fee_terms: 'Late returns are billed at {hourly}/hour, {grace}, capped at {daily}/day.',
  late_meter_title: 'Late fee so far {amount} · {duration} late',
  late_meter_copy: 'Charged when the vehicle is returned. {terms} Extending the return stops the meter.',
  late_meter_copy_no_extend: 'Charged when the vehicle is returned. {terms}',
  return_km_allowance: 'Allowance {allowance} km · driven {driven} km',
  return_km_within: 'Within allowance',
  return_km_excess: 'Excess {excess} km × {rate}',
  return_km_waive: 'Waive excess-km fee',
  return_km_waived: 'Excess-km fee waived',
  return_late_fee_zero: 'Late fee is {amount} — this return is {duration} late. Confirm the amount before settling.',
  return_checklist: 'Return checklist',
  return_deposit_held: 'Deposit held',
  return_remind: 'Remind',
  return_remind_aria: 'Send the customer a return-due reminder',
  return_remind_all: 'Remind all',
  return_awaiting_tip: 'Returns completed but not yet settled. Clear the backlog to release deposits and close the books.',
  return_waiting_days: 'Unsettled {days}d',
  return_waiting_tip: 'Days since this trip came back without a settlement. Settle the oldest first to release the deposit sooner.',
  return_reminded: 'Return reminder sent.',
  return_reminded_all: 'Reminder sent to {count} customer{s}.',
  return_fuel: 'Fuel at return',
  return_damage: 'Damage charge',
  return_cleaning: 'Cleaning fee',
  return_fuel_fee: 'Refuelling fee',
  return_fuel_fee_preset: 'Use admin fee {amount}',
  return_late_fee: 'Late fee',
  return_note: 'Damage note',
  return_charges: 'Charges',
  return_refund_method_label: 'Refund method',
  return_refund_due: 'Refund due',
  return_extra_due: 'Extra payment due',
  return_settle: 'Settle deposit',
  return_settling: 'Settling…',
  return_fee_pending: 'Fee edits are kept locally and applied when you settle.',
  return_settle_confirm: 'Close this return?',
  return_settle_copy: 'The deposit is settled, the trip completed and the customer notified. This cannot be undone.',
  return_settled: 'Return settled.',
  return_settled_badge: 'Deposit {status}',
  return_repeat_offender: 'Repeat late offender',
  return_repeat_offender_tip: 'This vehicle was returned late several times in the last 90 days. Keep a closer eye on the agreed return time.',
  return_remaining: '{count} item{s} still to tick',
  desk_licence: 'Licence',
  desk_age: 'Age',
  desk_insurance: 'Insurance',
  desk_payment: 'Payment',
  desk_deposit: 'Deposit',

  // Trip memory
  remember_strip_hint: 'Your last search',
  remember_apply: 'Apply',
  remember_clear: 'Forget it',
  remember_book_again_label: 'Book again',

  search_pickup_label: 'Pick-up',
  search_dropoff_label: 'Drop-off',
  search_pickup_date_label: 'Pick-up date',
  search_dropoff_date_label: 'Drop-off date',
  search_car_type_label: 'Car type',
  search_bike_type_label: 'Bike type',
  search_any_type: 'Any type',
  search_find_cars: 'Find cars',
  search_find_bikes: 'Find bikes',
  search_quick_dates: 'Quick dates',
  search_this_weekend: 'This weekend',
  search_next_weekend: 'Next weekend',
  search_next_week: 'Next week',
  search_this_month: 'This month',
  search_pickup_time_aria: 'Pick-up time',
  search_dropoff_time_aria: 'Drop-off time',
  search_day_singular: 'day',
  search_day_plural: 'days',
  search_error_hubs: 'Please choose pick-up and drop-off hubs.',
  search_error_dates: 'Please choose your travel dates.',
  search_error_times: 'Please choose a valid pick-up and drop-off time.',

  browse_search_title: 'Edit your trip',
  browse_search_description: 'Change dates, hubs or vehicle type.',
  browse_search_note: 'Changing dates re-checks live availability across the fleet.',
  browse_crumb_home: 'Home',
  browse_crumb_fleet: 'Fleet',
  browse_change: 'Change',
  browse_any_hub: 'Any hub',
  browse_dropoff_prefix: 'Drop-off',
  browse_all_cars: 'All cars',
  browse_all_bikes: 'All bikes',
  browse_all_hubs: 'All hubs',
  browse_sort_recommended: 'Recommended',
  browse_sort_price_asc: 'Price: low to high',
  browse_sort_price_desc: 'Price: high to low',
  browse_sort_rating: 'Top rated',
  browse_sort_newest: 'Newest models',
  browse_layout_label: 'Fleet layout',
  browse_view_grid: 'Grid view',
  browse_view_list: 'List view',
  browse_view_map: 'Map view',
  browse_filter_search: 'Search',
  browse_filter_search_placeholder: 'Make or model',
  browse_filter_search_aria: 'Search make or model',
  browse_filter_hub: 'Pick-up hub',
  browse_filter_kind: 'Vehicle kind',
  browse_filter_body_type: 'Body type',
  browse_filter_bike_type: 'Bike type',
  browse_filter_max_price: 'Max price / day',
  browse_filter_max_price_aria: 'Maximum daily price',
  browse_filter_gears: 'Gears',
  browse_filter_engine: 'Engine size',
  browse_filter_transmission: 'Transmission',
  browse_filter_seats: 'Seats',
  browse_filter_fuel: 'Fuel',
  browse_filter_any: 'Any',
  browse_filter_awd_label: 'All-wheel drive only',
  browse_filter_awd_description: 'Better for hill routes and monsoon roads.',
  browse_filter_tip_car: 'Tip: shifting your dates by a day often unlocks a better car or rate.',
  browse_filter_tip_bike: 'Tip: shifting your dates by a day often unlocks a better bike or rate.',

  // Vehicle detail
  vehicle_about_title: 'About this vehicle',
  vehicle_protection_title: 'Protection options',
  vehicle_protection_description: 'Choose a tier at checkout. All options include 24/7 roadside assistance.',
  vehicle_fine_print_title: 'The fine print',
  vehicle_retry: 'Try again',
  vehicle_rates_title: 'Nightly prices, next 30 days',
  vehicle_rates_description: 'Tap any day to start your trip there — the total updates instantly. Peak nights are highlighted.',
  vehicle_reviews_title: 'What people say',
  vehicle_reviews_empty: 'No reviews yet. Be the first to book and review this vehicle.',
  vehicle_new_badge: 'New arrival',
  vehicle_avail_title: 'Availability — next 30 days',
  vehicle_avail_days: '{open} of {total} days free',
  vehicle_avail_free: 'Free',
  vehicle_avail_booked: 'Booked',
  vehicle_avail_pick_starts: 'Start a trip on {date}',
  vehicle_avail_none: 'Fully booked in the next 30 days',
  vehicle_share: 'Share',
  vehicle_share_aria: 'Copy a link to this vehicle',
  vehicle_shared: 'Link copied to your clipboard.',
  vehicle_share_fallback: 'Copy this link: {url}',
  vehicle_save: 'Save',
  vehicle_saved: 'Saved',
  vehicle_save_bike: 'Save bike',
  vehicle_saved_bike: 'Saved bike',
  vehicle_similar_eyebrow: 'Keep exploring',
  vehicle_similar_title: 'You may also like.',
  vehicle_similar_description: 'More vehicles waiting at the same hub — same dates, same all-in pricing. Compare before you commit.',
  vehicle_continue_label: 'Continue to checkout',
  vehicle_mobile_continue: 'Continue',
  vehicle_choose_dates_label: 'Choose available dates',
  vehicle_mobile_choose: 'Choose dates',
  vehicle_checking_label: 'Checking availability…',
  vehicle_price_hint: 'Choose your dates to see the full price.',
  vehicle_tax_included_note: 'All-in price · GST included',

  // Checkout
  checkout_title: 'Checkout',
  checkout_secure: 'Secure checkout',
  checkout_description_instant: 'Four short steps. Instant confirmation and a voucher you can download.',
  checkout_description_review: 'Four short steps. We review the trip, then send your confirmation and voucher.',
  checkout_step_prefix: 'Step',
  checkout_step_total: 'of 4',
  checkout_step_trip_label: 'Trip',
  checkout_step_trip_copy: 'Dates & hubs',
  checkout_step_extras_label: 'Extras',
  checkout_step_extras_copy: 'Protection & add-ons',
  checkout_step_driver_label: 'Driver',
  checkout_step_driver_copy: 'Licence & details',
  checkout_step_payment_label: 'Payment',
  checkout_step_payment_copy: 'Pay & confirm',
  checkout_trip_title: 'Your trip',
  checkout_trip_copy: 'Check the dates and hubs. Prices update live as you change them.',
  checkout_extras_title: 'Extras & protection',
  checkout_extras_copy: 'Add the things that make the trip easier. All extras are per day.',
  checkout_protection_label: 'Protection',
  checkout_addons_label: 'Add-ons',
  checkout_per_day: '/day',
  checkout_driver_title: 'Driver details',
  checkout_driver_title_bike: 'Rider details',
  checkout_driver_copy: 'The person picking up the vehicle must be present with this licence and a photo ID.',
  checkout_payment_title: 'Payment',
  checkout_payment_copy: 'Pay securely with Razorpay. Cards, UPI and net banking supported.',
  checkout_pay_full: 'Pay in full',
  checkout_pay_full_copy: 'Settle the whole rental now.',
  checkout_pay_deposit: 'Reserve with',
  checkout_pay_deposit_copy: 'Balance due at pick-up.',
  checkout_pay_cta: 'Pay',
  checkout_step_progress: 'Step {step} of {total}',
  checkout_deposit_now: '{amount} deposit now',
  checkout_due_at_payment: 'Due at payment',
  checkout_mobile_due_now: '{amount} due now',
  checkout_instant_confirm: 'instant confirmation',
  checkout_after_review: 'confirmation after review',
  checkout_complete_details: 'Complete your details to pay',
  checkout_continue: 'Continue',
  checkout_mobile_total: 'total',
  checkout_mobile_day: '/day',
  checkout_nightly: '{days} days · avg {rate}/day',
  checkout_km_label: 'Kilometres',
  checkout_km_included: '{km} km/day included · {rate}/extra km',
  checkout_km_total: '{total} km included for {days} days',
  checkout_km_unlimited: 'Unlimited',
  checkout_late_fee_note: '{terms}',
  checkout_protection: '{label} protection',
  checkout_included: 'Included',
  checkout_deductible_note: 'Deductible {amount}',
  checkout_deposit_due_note: '{amount} refundable security deposit is due at pick-up. It is not part of today’s payment and is returned within 5–7 working days of drop-off, less any deductions.',
  checkout_pay_now: 'Pay {amount}',
  checkout_complete_to_pay: 'Complete to pay',
  checkout_pay_terms: 'By paying you agree to the rental terms and the refundable security deposit due at pick-up:',
  checkout_back: 'Back',
  checkout_back_to: 'Back to',
  checkout_continue: 'Continue',
  checkout_instant_label: 'Instant confirmation',
  checkout_review_label: 'Confirmation after review',
  checkout_signin_title: 'Please sign in to book.',
  checkout_signin_copy: 'Guest checkout is currently unavailable. Sign in or create an account and we will bring you straight back to this trip.',
  checkout_signin_cta: 'Sign in',
  checkout_browse_cta: 'Browse the fleet',
  checkout_need_vehicle_title: 'We need a vehicle first.',
  checkout_no_vehicle_copy: 'No vehicle was selected.',
  checkout_demo_badge: 'Demo mode',
  checkout_back_to_vehicle: 'Back to',
  checkout_flexible_plans: 'Flexible plans',
  checkout_reschedule_note: 'To change dates, cancel and rebook in minutes, subject to availability.',
  checkout_rental_window_note: 'Rentals run {min}–{max} days. Bookings open {advance} days ahead.',
  checkout_label_pickup_date: 'Pick-up date',
  checkout_label_dropoff_date: 'Drop-off date',
  checkout_label_pickup_hub: 'Pick-up hub',
  checkout_label_dropoff_hub: 'Drop-off hub',
  checkout_label_pickup_time: 'Pick-up time',
  checkout_label_dropoff_time: 'Drop-off time',
  checkout_guest_note: 'Checking out as a guest. You can still track this booking by email.',
  checkout_signin_instead: 'Sign in instead',
  checkout_licence_verified_title: 'Licence verified',
  checkout_licence_verified_copy: 'Bring the original licence and a photo ID to pick-up.',
  checkout_licence_review_title: 'Licence review in progress',
  checkout_licence_review_copy: 'Our team is reviewing your scan. You can still finish this booking.',
  checkout_licence_missing_title: 'Add your licence before pick-up',
  checkout_licence_missing_copy: 'Upload a clear photo now to skip the queue at the hub.',
  checkout_licence_view: 'View',
  checkout_licence_open: 'Open account',
  checkout_driver_name: 'Full name',
  checkout_driver_email: 'Email',
  checkout_driver_phone: 'Phone',
  checkout_driver_dob: 'Date of birth',
  checkout_driver_license: 'Driving licence number',
  checkout_driver_licence_expiry: 'Licence expiry date',
  checkout_driver_licence_expiry_note: 'Optional, but recommended — it must stay valid until your drop-off date. We check it again at handover.',
  checkout_driver_notes: 'Anything we should know?',
  checkout_optional: '(optional)',
  checkout_placeholder_name: 'As printed on the licence',
  checkout_placeholder_email: 'you@example.com',
  checkout_placeholder_phone: '+91 98765 43210',
  checkout_placeholder_license: 'e.g. MH0220190001234',
  checkout_placeholder_notes: 'Flight number, delivery address, child seat notes…',
  checkout_licence_agreement: 'I confirm this licence is valid, belongs to me, and has been held for at least 12 months. I will present the original at pick-up.',
  checkout_terms_prefix: 'I agree to the',
  checkout_terms_link: 'rental terms',
  checkout_terms_suffix: ', the fuel policy and the damage liability rules. I confirm I am at least {age} years old.',
  checkout_payment_secure_title: 'Razorpay secure checkout',
  checkout_payment_methods: 'Cards · UPI · Net banking · Wallets',
  checkout_payment_pci_note: 'PCI-DSS compliant · card details never touch Rove servers',
  checkout_selected: 'Selected',
  checkout_due_now: 'Due now',
  checkout_updating_price: 'Updating price…',
  checkout_balance_at_pickup: 'Balance at pick-up',
  checkout_deposit_at_pickup: 'Security deposit at pick-up',
  checkout_opening_payment: 'Opening secure payment…',
  checkout_pickup_label: 'Pick-up',
  checkout_dropoff_label: 'Drop-off',
  checkout_driver_label: 'Driver',
  checkout_add_details: 'Add details',
  checkout_promo_code: 'Promo code',
  checkout_promo_placeholder: 'FIRST10',
  checkout_promo_aria: 'Promo code',
  checkout_apply: 'Apply',
  checkout_remove: 'Remove',
  checkout_one_way_fee: 'One-way fee',
  checkout_one_way_off: 'One-way rentals are switched off — pick up and drop off at the same hub.',
  checkout_one_way_note: 'One-way rental · a {fee} relocation fee applies.',
  checkout_promo_discount: 'Promo discount',
  checkout_total: 'Total',
  checkout_tax_included: 'included',
  checkout_summary_deposit: 'deposit',
  checkout_summary_full: 'full payment',
  checkout_deposit_due_now: 'Deposit due now',
  checkout_deposit_line: 'Refundable security deposit · due at pick-up',
  checkout_choose_dates_price: 'Choose dates to see the full price.',
  checkout_demo_note: 'Demo checkout simulates Razorpay. Use the test card 4242 4242 4242 4242. No money moves.',
  checkout_payment_sheet_title: 'Secure payment',
  checkout_payment_sheet_description: 'Rove demo checkout — no real money moves.',
  checkout_payment_amount_due: 'Amount due',
  checkout_payment_demo_badge: 'Demo',
  checkout_payment_test_card: 'Use test card 4242 4242 4242 4242',
  checkout_payment_fill: 'Fill',
  checkout_payment_card_number: 'Card number',
  checkout_payment_card_placeholder: '4242 4242 4242 4242',
  checkout_payment_cardholder_placeholder: 'CARDHOLDER NAME',
  checkout_payment_name_on_card: 'Name on card',
  checkout_payment_name_placeholder: 'Maya Chen',
  checkout_payment_expiry: 'Expiry',
  checkout_payment_expiry_placeholder: 'MM/YY',
  checkout_payment_cvc: 'CVC',
  checkout_payment_cvc_placeholder: '123',
  checkout_payment_pay: 'Pay',
  checkout_payment_processing: 'Processing securely…',
  checkout_payment_simulated_note: 'This preview simulates a Razorpay checkout. In production the card form is hosted by Razorpay and verified in a Supabase Edge Function.',
  checkout_payment_error_card: 'Enter a valid 16-digit card number.',
  checkout_payment_error_declined: 'This test card is declined. Please use 4242 4242 4242 4242.',
  checkout_payment_error_name: 'Enter the name printed on the card.',
  checkout_payment_error_expiry: 'Enter a valid future expiry date (MM/YY).',
  checkout_payment_error_cvc: 'Enter the 3-digit security code.',
  checkout_payment_error_generic: 'Payment could not be completed.',

  // Authentication
  auth_default_eyebrow: 'Welcome to Rove',
  auth_back_to_site: 'Back to site',
  auth_terms_link: 'Terms',
  auth_privacy_link: 'Privacy',
  auth_secure_label: 'Secure',
  auth_self_drive_badge: 'Self-drive · India',
  auth_brand_mark: 'rove.rent',
  auth_trips_label: 'Trips this year',
  auth_hubs_label: 'City hubs',
  auth_handover_label: 'Average handover',
  auth_handover_value: '<5 min',
  auth_email_label: 'Email address',
  auth_email_placeholder: 'you@example.com',
  auth_password_label: 'Password',
  auth_password_placeholder: 'Your password',
  auth_forgot_password: 'Forgot password?',
  auth_show_password: 'Show password',
  auth_hide_password: 'Hide password',
  auth_signin_cta: 'Sign in',
  auth_signing_in: 'Signing in…',
  auth_protected: 'Protected by Supabase Auth · encrypted in transit',
  auth_new_prefix: 'New to Rove?',
  auth_have_account: 'Already have an account?',
  auth_create_account: 'Create an account',
  auth_welcome_back: 'Welcome back',
  auth_signed_in_as: 'Signed in as',
  auth_demo_accounts: 'Demo accounts',
  auth_demo_one_click: 'One click',
  auth_demo_copy: 'Explore each role without typing credentials.',
  auth_join_prefix: 'Join',
  auth_full_name: 'Full name',
  auth_name_placeholder: 'Maya Chen',
  auth_email_short: 'Email',
  auth_phone: 'Phone',
  auth_optional: '(optional)',
  auth_phone_placeholder: '+91 98765 43210',
  auth_new_password_placeholder: 'At least 8 characters',
  auth_confirm_password: 'Confirm password',
  auth_confirm_placeholder: 'Repeat password',
  auth_password_weak: 'Weak',
  auth_password_fair: 'Fair',
  auth_password_good: 'Good',
  auth_password_strong: 'Strong',
  auth_terms_agreement_prefix: 'I agree to',
  auth_terms_of_service: 'terms of service',
  auth_terms_agreement_middle: 'and',
  auth_privacy_policy: 'privacy policy',
  auth_terms_agreement_suffix: 'I am at least {age} years old.',
  auth_confirm_sent_to: 'Sent to {email}.',
  auth_create_cta: 'Create account',
  auth_creating: 'Creating account…',
  auth_account_created: 'Account created. Welcome to Rove.',
  auth_demo_register_note: 'Demo mode: your account is stored in this browser only. No email is sent.',
  auth_confirm_email_sent: 'Confirmation email sent',
  auth_confirm_expiry_copy: 'The link expires in 24 hours. If it does not arrive within a few minutes, check spam or try registering again.',
  auth_go_sign_in: 'Go to sign in',
  auth_wrong_email: 'Wrong email?',
  auth_go_back: 'Go back',
  auth_check_inbox: 'Check your inbox',
  auth_try_another: 'Try another email',
  auth_send_reset: 'Send reset link',
  auth_sending: 'Sending…',
  auth_reset_sent: 'Reset instructions sent.',
  auth_reset_demo_note: 'Demo mode does not send email. Sign in with one of the demo accounts instead.',
  auth_back_to_signin: 'Back to sign in',
  auth_new_password: 'New password',
  auth_confirm_new_password: 'Confirm new password',
  auth_update_password: 'Update password',
  auth_updating: 'Updating…',
  auth_reset_error_length: 'Use at least 8 characters for your new password.',
  auth_reset_error_mismatch: 'Those passwords do not match.',
  auth_reset_success: 'Password updated. Sign in with your new password.',
  auth_reset_demo_password_note: 'Demo mode: password changes are simulated. Demo account passwords never change.',
  auth_error_name: 'Please enter your full name.',
  auth_error_email: 'That email address does not look right.',
  auth_error_password_length: 'Use at least 8 characters for your password.',
  auth_error_password_mismatch: 'Those passwords do not match.',
  auth_error_terms: 'Please accept the rental terms and privacy policy.',

  auth_login_eyebrow: 'Welcome back',
  auth_login_title: 'Sign in to Rove.',
  auth_login_subtitle: 'Pick up where you left off — trips, invoices and saved vehicles are all here.',
  auth_register_title: 'Create your account.',
  auth_register_subtitle: 'Faster checkouts, saved vehicles and every invoice in one place. It takes less than a minute.',
  auth_confirm_eyebrow: 'One last step',
  auth_confirm_title: 'Check your inbox.',
  auth_confirm_subtitle: 'Click the confirmation link we sent you to activate your account, then sign in.',
  auth_forgot_eyebrow: 'Account recovery',
  auth_forgot_title: 'Reset your password.',
  auth_forgot_subtitle: 'Enter the email you use for Rove and we will send a secure reset link.',
  auth_reset_eyebrow: 'Account recovery',
  auth_reset_title: 'Choose a new password.',
  auth_reset_subtitle: 'Make it memorable, but not guessable. At least 8 characters.',

  // Account
  account_tab_trips: 'My trips',
  account_tab_notifications: 'Notifications',
  account_tab_invoices: 'Invoices',
  account_tab_saved: 'Saved vehicles',
  account_tab_payments: 'Payment methods',
  account_tab_profile: 'Profile',
  account_upcoming_title: 'Upcoming & active',
  account_book_another: 'Book another vehicle',
  account_empty_title: 'No upcoming trips',
  account_empty_description: 'When you book a vehicle it will appear here with the voucher, invoice and pick-up details.',
  account_empty_cta: 'Browse the fleet',
  account_past_title: 'Past trips',
  account_no_upcoming_title: 'No upcoming trips',
  account_no_upcoming_description: 'Your past trips are below. Book a vehicle to see it here next.',
  account_load_error_title: 'We could not load your trips.',
  account_load_error_copy: 'Check your connection and try again. Your booking data is safe.',
  account_load_error_cta: 'Try again',
  account_saved_load_error: 'We could not load your saved vehicles.',
  account_review_success: 'Thanks for the review — it is live on the vehicle page.',
  account_review_rating_label: 'Your rating',
  account_profile_saved: 'Profile updated.',
  account_profile_error: 'Please check your details and try again.',
  account_signed_out: 'Signed out. See you soon.',
  account_sign_out_error: 'We could not sign you out. Please try again.',
  account_demo_reset: 'Demo data reset.',
  account_demo_reset_error: 'We could not reset the demo data. Please try again.',
  account_export_started: 'Your data export is downloading.',
  account_export_error: 'Could not prepare your data export.',
  account_cancel_reason_default: 'Cancelled from account',
  account_licence_bad_type: 'Please choose a JPG, PNG or WebP image of your licence.',
  account_licence_too_large: 'That image is over 5 MB. Please choose a smaller photo.',
  account_licence_pick_first: 'Pick a photo of your driving licence first.',
  account_licence_verified_toast: 'Licence verified — you are all set.',
  account_licence_received_toast: 'Thanks — we received your licence and will review it shortly.',
  account_licence_upload_failed: 'Upload failed. Please try again.',
  account_licence_unavailable: 'Licence verification is not available in this build yet.',
  account_appearance_title: 'Appearance',
  account_appearance_copy: 'Choose between light and dark mode to match your preference.',
  account_dark_mode_label: 'Dark mode',
  account_invoices_title: 'Invoices & contracts',
  account_invoices_copy: 'Every booking generates a GST invoice and rental contract. Open one to print or save as PDF.',
  account_invoices_empty_title: 'No invoices yet',
  account_invoices_empty_description: 'Your invoices will appear here after your first booking.',
  account_invoices_empty_cta: 'Find a ride',
  account_saved_title: 'Saved vehicles',
  account_saved_copy: 'Vehicles you have hearted while browsing.',
  account_saved_empty_title: 'No saved vehicles yet',
  account_saved_empty_description: 'Tap the heart on any vehicle to keep it here for later.',
  account_saved_empty_cta: 'Start browsing',
  account_payments_title: 'Saved payment method',
  account_payments_copy: 'Card details are stored by Razorpay. Rove only keeps the brand and last four digits.',
  account_payments_empty_title: 'No saved card',
  account_payments_empty_description: 'The card you pay with at checkout is saved by Razorpay for faster future bookings.',
  account_payments_empty_cta: 'Book a ride',
  account_transactions_title: 'Transaction history',
  account_notifications_title: 'Notifications',
  account_notifications_copy: 'Trip updates and payment events, in one place.',
  account_notifications_empty_title: 'Nothing new yet',
  account_notifications_empty_description: 'Booking confirmations, cancellations, refunds and trip updates will appear here.',
  account_notifications_error: 'We could not update your notifications. Please try again.',
  account_profile_title: 'Personal details',
  account_profile_copy: 'Keep your licence and contact details current for faster pick-ups.',
  account_save: 'Save changes',
  account_saving: 'Saving…',
  account_invoices_table_aria: 'Invoices and contracts table',
  account_actions_col: 'Actions',
  account_transactions_table_aria: 'Transaction history table',
  account_deletion_message: 'I would like to request deletion of my account and all associated data.',
  account_review_star_aria: '{count} star',
  account_review_star_aria_plural: '{count} stars',
  account_book_again: 'Book again',

  // Notification preferences
  notif_title: 'Notification preferences',
  notif_description: 'Choose which updates you want by email and in the app.',
  notif_booking_confirmed_label: 'Booking confirmed',
  notif_booking_confirmed_copy: 'Voucher and payment receipt when a booking is confirmed.',
  notif_trip_updates_label: 'Trip updates',
  notif_trip_updates_copy: 'Status changes, reminders and pick-up day nudges.',
  notif_cancellations_refunds_label: 'Cancellations & refunds',
  notif_cancellations_refunds_copy: 'When plans change and money moves back to you.',
  notif_promotions_label: 'Offers & promos',
  notif_promotions_copy: 'Occasional discounts and seasonal deals. Off by default.',
  notif_saved: 'Preferences saved',
  notif_error: 'Could not save preferences.',
  account_invoice_col: 'Invoice',
  account_vehicle_col: 'Vehicle',
  account_dates_col: 'Dates',
  account_total_col: 'Total',
  account_refunded_tag: 'refunded',
  account_tx_deposit_refund: 'Deposit refund',
  account_transactions_all: 'All',
  account_transactions_refunds: 'Refunds',
  account_transactions_no_refunds: 'No refunds yet — money back from cancellations or repricing appears here.',
  account_km_chip: '{km} km/day',
  countdown_overdue: 'Overdue · {days}d',
  countdown_due_today: 'Due today · {time}',
  countdown_due_tomorrow: 'Due tomorrow',
  countdown_returns_in: 'Returns in {days}d',
  countdown_starts_today: 'Pick-up today · {time}',
  countdown_starts_tomorrow: 'Pick-up tomorrow',
  countdown_starts_in: 'Starts in {days}d',
  countdown_pickup_passed: 'Pick-up {days}d ago',
  account_payment_col: 'Payment',
  account_open: 'Open',
  account_rental_fallback: 'Rove rental',
  account_card_label: 'Card',
  account_expiry_note: 'Expiry on file with Razorpay',
  account_deposit_title: 'Security deposit',
  account_deposit_copy: 'A refundable {deposit} deposit is due at pick-up for tolls and fines. It is returned 5–7 working days after drop-off, less any deductions.',
  account_deposit_refunded: 'Deposit refunded {amount}',
  account_deposit_deducted: '{amount} deducted from deposit',
  account_deposit_extra: '{amount} extra charged',
  account_deposit_released: 'Deposit released',
  account_deposit_held: 'Deposit held {amount}',
  account_deposit_awaiting: 'Deposit awaiting settlement',
  account_deposit_due: 'Deposit due at pick-up {amount}',
  trip_licence_warn: 'Licence expires during this trip',
  account_date_col: 'Date',
  account_booking_col: 'Booking',
  account_type_col: 'Type',
  account_amount_col: 'Amount',
  account_no_transactions: 'No transactions yet.',
  account_mark_all_read: 'Mark all read',
  account_full_name: 'Full name',
  account_email: 'Email',
  account_phone: 'Phone',
  account_license: 'Driving licence number',
  account_license_placeholder: 'MH0220190001234',
  account_account_title: 'Account',
  account_signed_in_copy: 'Signed in as {email} with {role} access.',
  account_customer_role: 'customer',
  account_sign_out: 'Sign out',
  account_reset_demo: 'Reset demo data',
  account_data_title: 'Your data',
  account_data_copy: 'Download everything Rove stores about you — trips, payments and saved vehicles — as a single JSON file.',
  account_download_data: 'Download my data',
  account_request_deletion: 'Request account deletion',
  account_data_note: 'Your export is generated on this device and never leaves your browser. Passwords and payment tokens are excluded.',
  account_licence_title: 'Licence verification',
  account_licence_copy: 'Upload a clear photo of your driving licence before pick-up.',
  account_licence_verified_title: 'Your licence is verified',
  account_licence_verified_copy: 'Bring the original licence and a photo ID to pick-up. Contact support if your licence details change.',
  account_licence_have_title: 'We have your licence',
  account_licence_have_copy: 'Our team is reviewing it before pick-up. Re-upload below if the photo is blurry or out of date.',
  account_licence_preview_alt: 'Selected driving licence preview',
  account_licence_none: 'No licence photo selected',
  account_licence_choose: 'Choose image',
  account_licence_choose_another: 'Choose another',
  account_licence_uploading: 'Uploading…',
  account_licence_upload: 'Upload licence',
  account_licence_note: 'JPG, PNG or WebP, up to 5 MB. The scan is stored privately and reviewed before pick-up.',
  account_documents_title: 'Documents on file',
  account_doc_photo: 'Photo ID',
  account_doc_licence: 'Driving licence',
  account_doc_card: 'Payment card',
  account_verified: 'Verified',
  account_at_pickup: 'At pick-up',
  account_in_review: 'In review',
  account_number_on_file: 'Number on file',
  account_not_added: 'Not added',
  account_at_checkout: 'At checkout',
  account_voucher: 'Voucher',
  account_trip_support: 'Trip support',
  account_add_calendar: 'Add to calendar',
  account_cancel: 'Cancel',
  account_review: 'Review',
  account_reviewed: 'Reviewed',
  account_days_singular: 'day',
  account_days_plural: 'days',
  account_pickup_suffix: 'pick-up',
  account_review_modal_title: 'Review your trip',
  account_review_label: 'Your review',
  account_review_placeholder: 'How was the vehicle, the handover and the team?',
  account_review_error: 'Add a few words about your trip.',
  account_review_posting: 'Posting…',
  account_review_post: 'Post review',
  account_rating_terrible: 'Terrible',
  account_rating_poor: 'Poor',
  account_rating_okay: 'Okay',
  account_rating_good: 'Good',
  account_rating_excellent: 'Excellent',

  // Manage booking
  manage_eyebrow: 'Manage booking',
  manage_title: 'Your trip, your control.',
  manage_subtitle: 'View your voucher and invoice, cancel a booking, or check the pick-up details. Enter your booking code to begin.',
  manage_find_title: 'Find your booking',
  manage_find_copy: 'Use the booking code shown on your voucher or in your account.',
  manage_code_label: 'Booking code',
  manage_code_placeholder: 'RV-AB12CD',
  manage_email_label: 'Email used at checkout',
  manage_email_placeholder: 'you@example.com',
  manage_error_code: 'Enter your booking code (it looks like RV-XXXXXX).',
  manage_error_email: 'Enter the email used at checkout, or sign in to your account.',
  manage_searching: 'Searching…',
  manage_find_cta: 'Find booking',
  manage_all_trips: 'See all my trips instead',
  manage_have_account: 'Have an account?',
  manage_signin: 'Sign in',
  manage_policy_title: 'Cancellation policy',
  manage_policy_dates: 'Need different dates? Contact us and we’ll check availability.',
  manage_empty_title: 'No booking loaded',
  manage_empty_copy: 'Enter your booking code and email on the left and we will pull up the voucher, invoice and options.',
  manage_empty_cta: 'Browse the fleet',
  manage_booking_prefix: 'Booking',
  manage_licence_help: 'Bring a valid renewal or the desk must refuse handover — you can change the trip dates in the trip-change section.',
  manage_rental_fallback: 'Rove rental',
  manage_days_singular: 'day',
  manage_days_plural: 'days',
  manage_protection_suffix: 'protection',
  manage_pickup: 'Pick-up',
  manage_dropoff: 'Drop-off',
  manage_driver: 'Driver',
  manage_total: 'Total',
  manage_km_label: 'Kilometres',
  manage_km_included: '{km} km/day included · {rate}/extra km',
  manage_km_total: 'That is {total} km included for this {days}-day trip.',
  manage_km_unlimited: 'Unlimited kilometres',
  manage_km_note: 'Extra distance beyond the allowance is billed at drop-off.',
  manage_note_label: 'Your note:',
  manage_cancellation_reason_label: 'Cancellation reason:',
  manage_open_voucher: 'Open voucher',
  manage_print: 'Print / save PDF',
  manage_cancel_cta: 'Cancel booking',
  manage_signin_to_cancel: 'Sign in to cancel',
  manage_signin_cancel_note: 'This booking was made with an account. Sign in to cancel it, or contact support.',
  manage_refund_none: 'No payment has been captured yet, so no refund is due.',
  manage_cancelled_note: 'This booking has been cancelled.',
  manage_started_note: 'This rental has already started. Contact support for changes.',
  manage_no_online_cancel: 'This booking can no longer be cancelled online.',
  manage_help_eyebrow: 'Need help?',
  manage_help_title: 'We are right here.',
  manage_help_copy: 'Call or email us and quote booking {code}. We answer {hours}.',
  manage_email_support: 'Email support',
  manage_call_support: 'Call {phone}',
  manage_cancel_modal_title: 'Cancel this booking?',
  manage_cancel_modal_description: 'This cannot be undone. {policy}.',
  manage_keep_booking: 'Keep booking',
  manage_cancel_confirm: 'Yes, cancel',
  manage_cancelling: 'Cancelling…',
  manage_cancel_success: 'Booking cancelled and refund queued.',
  manage_refund_estimate: 'Refund estimate',
  manage_refund_full: 'You are more than {window} out — the full {amount} paid will be refunded.',
  manage_refund_partial: 'You are inside {window} — {percent}% ({amount}) will be refunded.',
  manage_refund_note: 'Refunds return to the original payment method, usually within 5–7 working days.',
  manage_reason_label: 'Reason',
  manage_optional: '(optional)',
  manage_reason_default: 'Changed plans',
  manage_reason_placeholder: 'Plans changed, found another ride…',

  // Not found
  notfound_eyebrow: 'Error 404',
  notfound_title: 'Wrong turn.',
  notfound_title_accent: 'Happens to the best drivers.',
  notfound_copy: 'The page you were looking for has moved, been renamed, or never existed. Let us get you back to something with four wheels.',
  notfound_home: 'Back home',
  notfound_browse: 'Browse the fleet',
  notfound_manage_prefix: 'Looking for a booking?',
  notfound_manage_link: 'Manage it here',
  notfound_image_url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1400&q=80',
  notfound_image_alt: 'A winding road through misty hills',
  notfound_card_title: 'Every road leads somewhere',
  notfound_card_copy: 'Seven hubs. One very good detour.',

  // Confirmation
  confirmation_confirmed_heading: 'You’re booked.',
  confirmation_pending_heading: 'Payment received.',
  confirmation_cancelled_heading: 'This trip was cancelled.',
  confirmation_rejected_heading: 'This booking was rejected.',
  confirmation_completed_heading: 'Trip completed.',
  confirmation_active_heading: 'Your trip is underway.',
  confirmation_confirmed_badge: 'Booking confirmed',
  confirmation_pending_badge: 'Awaiting confirmation',
  confirmation_cancelled_badge: 'Booking cancelled',
  confirmation_rejected_badge: 'Booking rejected',
  confirmation_completed_badge: 'Trip completed',
  confirmation_active_badge: 'Trip in progress',
  confirmation_confirmed_note: 'Voucher, contract and invoice are ready to download or print below.',
  confirmation_pending_note: 'Your payment is in. Our team is reviewing the trip and will confirm your voucher shortly.',
  confirmation_completed_note: 'This trip is complete. Your voucher and invoice are kept here for your records.',
  confirmation_active_note: 'Your rental is active. Keep this page for the voucher and invoice, and manage the return from your account.',
  confirmation_closed_note: 'This voucher is kept for your records. Any refund due under the cancellation policy is shown in the payment summary below.',
  confirmation_code_label: 'Booking code',
  confirmation_progress_label: 'Trip status',
  confirmation_stage_requested: 'Requested',
  confirmation_stage_confirmed: 'Confirmed',
  confirmation_stage_pickup: 'Pick-up',
  confirmation_stage_returned: 'Completed',
  confirmation_stage_closed_cancelled: 'Cancelled',
  confirmation_stage_closed_rejected: 'Rejected',
  confirmation_rental_eyebrow: 'Your rental',
  confirmation_invoice_eyebrow: 'Invoice',
  confirmation_invoice_title: 'Payment summary',
  confirmation_next_eyebrow: 'What happens next',
  confirmation_add_calendar: 'Add to calendar',
  confirmation_print: 'Print voucher & invoice',
  confirmation_book_another: 'Book another vehicle',
  confirmation_manage: 'Manage this booking',
  confirmation_guest_title: 'Booking as a guest',
  confirmation_checklist_title: 'At pick-up, bring',
  confirmation_checklist_note: 'We will walk around the vehicle together and note any marks before you drive off.',
  confirmation_checklist_items: 'Your driving licence, A photo ID, The payment card, This booking code',
  confirmation_guest_cta: 'Create account',
  confirmation_lookup_eyebrow: 'Booking lookup',
  confirmation_lookup_title: 'Open your booking.',
  confirmation_lookup_copy: 'Enter the email used at checkout to open this voucher. We never show booking details to someone who cannot verify the email.',
  confirmation_lookup_notfound_title: 'We could not find that booking.',
  confirmation_lookup_notfound_copy: 'Check the booking code and the email used at checkout, then try again. Signed-in customers can open their account to see every trip.',
  confirmation_lookup_error_title: 'We could not open this booking.',
  confirmation_lookup_error_copy: 'Check the code and use the email from your booking confirmation. If you are signed in, your account is the quickest way in.',
  confirmation_lookup_email_label: 'Email used for the booking',
  confirmation_lookup_submit: 'Open my voucher',
  confirmation_lookup_account_hint: 'Signed in? {link} to see all trips.',
  confirmation_lookup_account_link: 'Open your account',
  confirmation_lookup_email_required: 'Enter the email used for the booking.',
  confirmation_loading: 'Fetching your booking…',
  confirmation_copy_code: 'Copy booking code',
  confirmation_code_copied: 'Booking code copied.',
  confirmation_code_fallback: 'Booking code: {code}',
  confirmation_try_another: 'Try another code',
  confirmation_open_account: 'Open my account',
  confirmation_vehicle_fallback: 'Rove rental',
  confirmation_deposit_label: 'Security deposit',
  confirmation_licence_label: 'Licence',
  confirmation_licence_on_file: 'on file',
  confirmation_licence_expires: 'expires',
  confirmation_licence_warn_help: 'Bring a valid renewal or the desk must refuse handover.',
  confirmation_km_label: 'Kilometres',
  confirmation_km_included: '{km} km/day included · {rate}/extra km',
  confirmation_km_total: 'That is {total} km included for this {days}-day trip.',
  confirmation_km_unlimited: 'Unlimited kilometres',
  confirmation_km_note: 'Extra distance beyond the allowance is billed at drop-off.',
  confirmation_deductions_label: 'Deposit deductions',
  confirmation_deduction_late: 'Late fee',
  confirmation_deduction_damage: 'Damage',
  confirmation_deduction_cleaning: 'Cleaning',
  confirmation_deduction_km: 'Excess kilometres',
  confirmation_deduction_fuel: 'Refuelling',
  confirmation_deduction_total: 'Total deductions',
  confirmation_condition_label: 'Condition report',
  confirmation_condition_pickup: 'Pick-up:',
  confirmation_condition_return: 'Drop-off:',
  confirmation_cancellation_reason: 'Cancellation reason:',
  confirmation_rental_cancelled: 'Rental cancelled',
  confirmation_paid_in_full: 'Paid in full',
  confirmation_deposit_paid: 'Deposit {amount} paid',
  confirmation_deposit_paid_generic: 'Deposit paid',
  confirmation_line_rental_base: 'Rental base',
  confirmation_line_insurance: '{name} protection',
  confirmation_insurance_fallback: 'Standard',
  confirmation_line_paid: 'Paid',
  confirmation_line_payment: 'Payment',
  confirmation_line_none_captured: 'None captured',
  confirmation_line_refunded: 'Refunded',
  confirmation_line_net_paid: 'Net paid',
  confirmation_line_promo: 'Promo {code}',
  confirmation_line_balance_due: 'Balance due at pick-up',
  confirmation_line_credit_due: 'Credit to be refunded',
  confirmation_line_transactions: 'Transactions',
  confirmation_invoice_generated: 'This invoice is computer generated.',
  confirmation_payment_due_at_pickup: 'Due at pick-up',
  confirmation_payment_awaiting: 'Awaiting reference',
  confirmation_payment_not_charged: 'not charged',
  confirmation_payment_settled_after: 'settled after drop-off',
  confirmation_deposit_state_settled: 'Settled',
  confirmation_deposit_state_refunded: '{amount} refunded',
  confirmation_deposit_state_via: 'via {method}',
  confirmation_deposit_state_deducted: '{amount} deducted',
  confirmation_deposit_state_no_deductions: 'no deductions',
  confirmation_deposit_state_none: 'No deposit due',
  confirmation_deposit_state_after: 'Refundable · settled after drop-off',
  confirmation_deposit_state_due: 'Refundable · due at pick-up',
  confirmation_deposit_note_settled: 'Deposit settled.',
  confirmation_deposit_note_settled_deducted: 'Deposit settled with {amount} in deductions.',
  confirmation_deposit_note_refund: '{amount} is returned to the original payment method within 5–7 working days.',
  confirmation_deposit_note_no_refund: 'No refund is due.',
  confirmation_deposit_note_closed: 'No refundable security deposit is due on this booking.',
  confirmation_deposit_note_completed: 'The refundable security deposit is settled within 5–7 working days of drop-off, less any deductions.',
  confirmation_deposit_note_due: 'The refundable security deposit is due at pick-up and is returned within 5–7 working days of drop-off.',
  confirmation_next_voucher_title: 'Voucher ready',
  confirmation_next_voucher_copy: 'Download or print your voucher, contract and invoice below.',
  confirmation_next_pending_title: 'Awaiting confirmation',
  confirmation_next_pending_copy: 'Our team is checking the trip. We will email you as soon as it is confirmed.',
  confirmation_next_calendar_title: 'Add to your calendar',
  confirmation_next_calendar_copy: 'Save the pick-up time and keep your booking code handy.',
  confirmation_next_pickup_copy: 'Bring your licence, photo ID and payment card to {hub}.',
  confirmation_cancel_note: 'Plans changed? Cancel from your account or the manage page.',
  confirmation_guest_copy: 'Create an account with {email} to keep this trip, invoice and future bookings together.',
  confirmation_calendar_pickup_title: 'Rove pick-up',
  confirmation_calendar_dropoff_title: 'Rove drop-off',
  confirmation_calendar_pickup_note: 'Bring your driving licence, photo ID and the payment card.',
  confirmation_calendar_dropoff_note: 'Return with the agreed fuel or charge level.',

  // SEO defaults
  site_name: 'Rove',
  default_meta_title: '{site} — Premium self-drive rentals in India',
  default_meta_description: 'Rent beautifully kept cars and bikes across India. Transparent all-in pricing, instant confirmation and flexible cancellation.',
  default_meta_image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
});

export const PAGE_TEXT_KEYS = Object.freeze(Object.keys(PAGE_TEXT_DEFAULTS));

export const DEFAULT_NAV_LINKS = Object.freeze([
  { label: 'Fleet', to: '/browse' },
  { label: 'How it works', to: '/#how-it-works' },
  { label: 'Locations', to: '/#locations' },
  { label: 'Support', to: '/#faq' },
]);

export const DEFAULT_FOOTER_FLEET_LINKS = Object.freeze([
  { label: 'Luxury & sports', to: '/browse?type=Sports' },
  { label: 'SUVs', to: '/browse?type=SUV' },
  { label: 'Electric', to: '/browse?type=Electric' },
  { label: 'Convertibles', to: '/browse?type=Convertible' },
  { label: 'Vans & campers', to: '/browse?type=Van' },
  { label: 'Economy', to: '/browse?type=Economy' },
]);

export const DEFAULT_FOOTER_COMPANY_LINKS = Object.freeze([
  { label: 'Our story', to: '/about' },
  { label: 'How it works', to: '/#how-it-works' },
  { label: 'Locations', to: '/#locations' },
]);

export const DEFAULT_FOOTER_SUPPORT_LINKS = Object.freeze([
  { label: 'Manage a booking', to: '/manage' },
  { label: 'Contact us', to: '/contact' },
  { label: 'Fleet manager login', to: '/login' },
]);

export const DEFAULT_FOOTER_PAYMENT_METHODS = Object.freeze(['Razorpay', 'VISA', 'Mastercard', 'UPI']);

export const DEFAULT_FOOTER_LEGAL_LINKS = Object.freeze([
  { label: 'Terms of service', to: '/terms' },
  { label: 'Privacy policy', to: '/privacy' },
  { label: 'Licence & age rules', to: '/terms#licence' },
  { label: 'Damage & liability', to: '/terms#damage' },
]);

export const DEFAULT_HOME_STEPS = Object.freeze([
  { number: '01', title: 'Choose your ride', copy: 'Pick a hub and dates, then browse real availability with all-in pricing. No surprises at the counter.' },
  { number: '02', title: 'Add your details', copy: 'Licence, insurance and any extras. Pay online with Razorpay or reserve with a {deposit}% deposit.' },
  { number: '03', title: 'Pick up & drive', copy: 'Meet the team, do a five-minute handover, and take the long way home. Roadside support is included.' },
]);

/** Curated trip ideas shown on /routes. Hubs are matched by name against the
 * location list, so renaming a hub only softens one card, never breaks it. */
export const DEFAULT_ROUTES = Object.freeze([
  { from: 'Bengaluru — Indiranagar', to: 'Goa — Panaji', label: 'Bengaluru → Goa', copy: 'The classic long weekend — twisty ghats, coastal highways and a beach at the end.', badge: 'Most booked', kind: 'car' },
  { from: 'Mumbai — Bandra West', to: 'Pune — Koregaon Park', label: 'Mumbai → Pune', copy: 'A quick expressway hop with a hill-station detour if you have a spare afternoon.', badge: 'Quick getaway', kind: 'car' },
  { from: 'Goa — Panaji', to: 'Mumbai — Bandra West', label: 'Goa → Mumbai', copy: 'Follow the coast north and trade the beach for the city lights in one beautiful day.', badge: 'Coastal run', kind: 'car' },
  { from: 'Bengaluru — Indiranagar', to: 'Chennai — Nungambakkam', label: 'Bengaluru → Chennai', copy: 'A smooth highway hop with enough range for a stop at the hills.', badge: 'Short hop', kind: 'car' },
  { from: 'Hyderabad — Banjara Hills', to: 'Mumbai — Bandra West', label: 'Hyderabad → Mumbai', copy: 'Open highways, long horizons and plenty of rest stops for the crew.', badge: 'Highway cruiser', kind: 'car' },
  { from: 'Pune — Koregaon Park', to: 'Goa — Panaji', label: 'Pune → Goa', copy: 'The weekend escape that never gets old — leave Friday, arrive by sunset.', badge: 'Weekend escape', kind: 'car' },
  { from: 'New Delhi — Aerocity', to: 'New Delhi — Aerocity', label: 'Delhi golden loop', copy: 'City runabouts for busy weeks — everything you need, nothing you do not.', badge: 'City smart', kind: 'bike' },
  { from: 'Hyderabad — Banjara Hills', to: 'Goa — Panaji', label: 'Hyderabad → Goa', copy: 'Six hours of smooth highway, then the beach. Ranged, reliable and rewarding.', badge: 'Easy rider', kind: 'car' },
  { from: 'Chennai — Nungambakkam', to: 'Bengaluru — Indiranagar', label: 'Chennai → Bengaluru', copy: 'The reverse of the classic hop — breakfast by the coast, lunch in the garden city.', badge: 'Reverse run', kind: 'car' },
  { from: 'Bengaluru — Indiranagar', to: 'Hyderabad — Banjara Hills', label: 'Bengaluru → Hyderabad', copy: 'A straight, fast corridor through the Deccan — start before coffee gets cold.', badge: 'Corridor', kind: 'car' },
  { from: 'Pune — Koregaon Park', to: 'Mumbai — Bandra West', label: 'Pune → Mumbai', copy: 'Up early, city by ten — the expressway makes the return trip painless.', badge: 'Morning dash', kind: 'car' },
  { from: 'Mumbai — Bandra West', to: 'Mumbai — Bandra West', label: 'Mumbai city explorer', copy: 'Small bikes for lanes the SUVs can only dream of. Park anywhere, weave the traffic.', badge: 'Lane master', kind: 'bike' },
  { from: 'Bengaluru — Indiranagar', to: 'Bengaluru — Indiranagar', label: 'Bengaluru city hop', copy: 'An electric Ather or a zippy Apache for the coffee run, the errand blitz or the long lunch.', badge: 'Zero parking drama', kind: 'bike' },
  { from: 'Goa — Panaji', to: 'Goa — Panaji', label: 'Goa two-wheeler trail', copy: 'Undiscovered beaches, shack lunches and jungles — the way bikes were meant to see Goa.', badge: 'Biker favourite', kind: 'bike' },
  { from: 'New Delhi — Aerocity', to: 'Goa — Panaji', label: 'Delhi → Goa grand tour', copy: 'A multi-day cross-country drive — two drivers, one playlist and a coast waiting at the end.', badge: 'Bucket list', kind: 'car' },
  { from: 'Chennai — Nungambakkam', to: 'Goa — Panaji', label: 'Chennai → Goa coast run', copy: 'Down the eastern shore, across the peninsula, and into the sunset on the western coast.', badge: 'Full loop', kind: 'car' },
]);

export const DEFAULT_HOME_WHY_POINTS = Object.freeze([
  { title: 'All-in pricing', copy: 'GST, insurance and extras included before you pay.' },
  { title: 'Under 3 years old', copy: 'Serviced every 5,000 km and inspected before each handover.' },
  { title: 'Real humans', copy: 'WhatsApp, phone or email — someone who can actually help.' },
  { title: 'Flexible payments', copy: 'Pay in full or reserve with {deposit}%. UPI and cards welcome.' },
]);

export const DEFAULT_HOME_CATEGORIES = Object.freeze([
  { type: 'Sports', label: 'Luxury & sports', copy: 'Occasion cars' },
  { type: 'SUV', label: 'SUVs', copy: 'Room for everything' },
  { type: 'Electric', label: 'Electric', copy: 'Silent miles' },
  { type: 'Convertible', label: 'Convertibles', copy: 'Top-down escapes' },
  { type: 'Van', label: 'Vans & campers', copy: 'Crew trips' },
  { type: 'Economy', label: 'Economy', copy: 'Smart city runs' },
]);

export const DEFAULT_ABOUT_VALUES = Object.freeze([
  { title: 'Radical clarity', copy: 'The price you see is the price you pay. Every quote includes GST, insurance and the extras you picked — nothing waits to ambush you at the counter.' },
  { title: 'Cars people respect', copy: 'The fleet skews young — every vehicle under three years old, serviced every 5,000 km and inspected before each handover. We rent vehicles we would drive ourselves.' },
  { title: 'A human answer', copy: 'No IVR mazes. When something matters, a real person who can actually help is one call, message or email away — day or night.' },
  { title: 'Built for the road trip', copy: 'One-way rentals between hubs, doorstep delivery, and roadside assistance on every trip. We exist so the plan, not the paperwork, gets the attention.' },
]);

export const DEFAULT_TESTIMONIALS = Object.freeze([
  {
    name: 'Aarav Mehta',
    city: 'Mumbai',
    trip: 'Range Rover Velar',
    quote: 'Booked a Velar for a Goa trip — spotless car, seamless handover and no hidden charges.',
    rating: 5,
  },
  {
    name: 'Ishita Shah',
    city: 'Bengaluru',
    trip: 'Ather 450X',
    quote: 'The Ather was fully charged and checkout took under a minute. My go-to for weekend rides.',
    rating: 5,
  },
  {
    name: 'Rohan Kapoor',
    city: 'New Delhi',
    trip: 'Toyota Fortuner',
    quote: 'Rented an SUV for the family and a scooter for me. One booking, both delivered to the door.',
    rating: 4,
  },
]);

export const CONTENT_TEXT_KEYS = Object.freeze([
  'hero_eyebrow', 'hero_title', 'hero_subtitle', 'hero_cta_label', 'hero_badge',
  'hero_image_url', 'hero_image_alt', 'hero_trip_count', 'hero_trip_label',
  'footer_tagline', 'company_legal_name', 'gstin', 'registered_address',
  'support_email', 'support_phone', 'whatsapp_number', 'support_hours',
  'social_instagram', 'social_twitter', 'social_linkedin', 'legal_updated',
  'card_all_in_note', 'card_all_in_label',
  ...PAGE_TEXT_KEYS,
]);

export const CONTENT_NUMBER_KEYS = Object.freeze([
  'hero_rating', 'cancellation_window_hours', 'cancellation_refund_percent',
  'late_fee_per_hour', 'late_grace_minutes', 'min_rental_days', 'max_rental_days', 'max_advance_days',
  'late_repeat_threshold',
  'min_age', 'min_bike_rider_age', 'fuel_refill_fee', 'bike_fuel_refill_fee',
]);

export const CONTENT_TOGGLE_KEYS = Object.freeze([
  'bikes_enabled', 'guest_checkout_enabled', 'reviews_enabled', 'compare_enabled', 'remember_trip_enabled',
  'change_request_enabled', 'extensions_enabled', 'analytics_enabled', 'alerts_enabled',
  'dashboard_show_desk', 'dashboard_show_finance', 'dashboard_show_pipeline', 'dashboard_show_recent', 'dashboard_show_fleet',
  'dashboard_show_sales',
  'home_show_hero', 'home_show_catalog', 'home_show_upcoming_trip', 'home_show_how', 'home_show_locations', 'home_show_social',
  'card_show_all_in_rate',
]);

/**
 * Page-copy keys stored as a comma-separated string but consumed as a list,
 * e.g. the footer payment badges or the hero avatar initials.
 */
export const CONTENT_SPLIT_LIST_KEYS = Object.freeze(['footer_payment_methods', 'home_avatar_initials', 'confirmation_checklist_items']);

export const CONTENT_LIST_KEYS = Object.freeze([
  'trust_badges', 'testimonials', 'faqs',
  'nav_links',
  'footer_fleet_links', 'footer_company_links', 'footer_support_links', 'footer_legal_links',
  'home_steps', 'home_why_points', 'home_categories',
  'about_values',
  'routes',
]);

/** Field schema for each editable list, used by the admin list editor. */
export const CONTENT_LIST_SCHEMAS = Object.freeze({
  nav_links: { label: 'navigation link', fields: [{ key: 'label', label: 'Label' }, { key: 'to', label: 'Link' }] },
  footer_fleet_links: { label: 'fleet link', fields: [{ key: 'label', label: 'Label' }, { key: 'to', label: 'Link' }] },
  footer_company_links: { label: 'company link', fields: [{ key: 'label', label: 'Label' }, { key: 'to', label: 'Link' }] },
  footer_support_links: { label: 'support link', fields: [{ key: 'label', label: 'Label' }, { key: 'to', label: 'Link' }] },
  footer_legal_links: { label: 'legal link', fields: [{ key: 'label', label: 'Label' }, { key: 'to', label: 'Link' }] },
  home_steps: { label: 'step', fields: [{ key: 'number', label: 'Number' }, { key: 'title', label: 'Title' }, { key: 'copy', label: 'Copy', multiline: true }] },
  home_why_points: { label: 'reason', fields: [{ key: 'title', label: 'Title' }, { key: 'copy', label: 'Copy', multiline: true, optional: true }] },
  home_categories: { label: 'category', fields: [{ key: 'type', label: 'Vehicle type' }, { key: 'label', label: 'Label' }, { key: 'copy', label: 'Copy', optional: true }] },
  about_values: { label: 'value', fields: [{ key: 'title', label: 'Title' }, { key: 'copy', label: 'Copy', multiline: true, optional: true }] },
  routes: { label: 'route', fields: [
    { key: 'label', label: 'Label' },
    { key: 'from', label: 'Pick-up hub' },
    { key: 'to', label: 'Drop-off hub' },
    { key: 'kind', label: 'Kind (car / bike)', optional: true },
    { key: 'badge', label: 'Badge', optional: true },
    { key: 'copy', label: 'Copy', multiline: true, optional: true },
  ] },
});

export const CONTENT_KEYS = Object.freeze([
  ...CONTENT_TEXT_KEYS,
  ...CONTENT_NUMBER_KEYS,
  ...CONTENT_TOGGLE_KEYS,
  ...CONTENT_LIST_KEYS,
]);

const number = (value, fallback) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const bool = (value, fallback = false) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};
const text = (value, fallback) => (
  value === null || value === undefined || String(value).trim() === ''
    ? fallback
    : String(value).trim()
);

export const parseList = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export function formatDuration(hours) {
  const value = Math.max(0, Math.round(number(hours, 0)));
  if (value === 0) return 'before pick-up';
  if (value >= 24 && value % 24 === 0) {
    const days = value / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${value} hour${value === 1 ? '' : 's'}`;
}

export function sitePolicy(rawSettings = {}) {
  const source = rawSettings ?? {};
  const minDays = Math.max(1, Math.round(number(source.min_rental_days, 1)));
  const maxDays = Math.max(minDays, Math.round(number(source.max_rental_days, 45)));
  const maxAdvanceDays = Math.max(1, Math.round(number(source.max_advance_days, 365)));
  const windowHours = clamp(Math.round(number(source.cancellation_window_hours, 48)), 0, 720);
  const refundPercent = clamp(Math.round(number(source.cancellation_refund_percent, 50)), 0, 100);
  const minAge = clamp(Math.round(number(source.min_age, 21)), 16, 90);
  const minBikeAge = clamp(Math.round(number(source.min_bike_rider_age, 18)), 16, 90);
  const lateFee = Math.max(0, Math.round(number(source.late_fee_per_hour, 500)));
  // Free window after the scheduled drop-off before the hourly meter starts.
  // Real rental desks allow a short grace; making it explicit keeps the fee
  // defensible and stops a two-minute overrun from costing an hour.
  const lateGraceMinutes = clamp(Math.round(number(source.late_grace_minutes, 60)), 0, 1440);
  // A vehicle is a "repeat late offender" once its settled returns in the last
  // 90 days hit this many late drop-offs — the desk flags it before the next
  // handover, which is the moment a pattern is cheapest to interrupt.
  const lateRepeatThreshold = clamp(Math.round(number(source.late_repeat_threshold, 3)), 2, 20);
  // The daily equivalent of the hourly policy is the number every customer
  // surface discloses AND the returns desk defaults to — one admin setting,
  // one figure, so the desk can never settle a different rate than the one
  // the customer was told about.
  const lateFeePerDay = Math.max(0, Math.round(lateFee * 24));
  const fuelFee = Math.max(0, Math.round(number(source.fuel_refill_fee, 300)));
  const bikeFuelFee = Math.max(0, Math.round(number(source.bike_fuel_refill_fee, 200)));
  const oneWayFee = Math.max(0, Math.round(number(source.one_way_fee, 1500)));
  const holdAmount = Math.max(0, Math.round(number(source.hold_amount, 5000)));
  const depositPercent = clamp(Math.round(number(source.deposit_percent, 25)), 1, 100);
  const blockExpiredDocs = bool(source.block_expired_docs, false);
  // Optional handover gate: when on, a booking with a security deposit cannot
  // start until the desk has ticked "deposit collected". Off by default so a
  // demo fleet with pre-paid deposits is never blocked.
  const requireDepositAtDesk = bool(source.require_deposit_at_desk, false);
  // Licensing rule: a licence that expires mid-trip makes the second half of
  // the rental illegal to drive. When on (default), any licence-dated driver
  // whose expiry does not cover the drop-off is refused at checkout and flagged
  // at the handover desk. Off still *validates* entries, it just stops the
  // "must cover the whole rental" block.
  const licenceValidityRequired = bool(source.licence_validity_required, true);
  // Master switch for staff-sent operational reminders (pick-up and return
  // nudges). When off, the remninders fail closed server-side and the desk
  // hides the buttons, so no customer can be emailed or notified.
  const operationalReminders = bool(source.operational_reminders, true);
  // One-way rentals: when off, every trip must pick up and drop off at the
  // same hub — the quote engine stops charging the relocation fee, checkout
  // locks the drop-off hub, and the adapters reject any mismatch.
  const oneWayEnabled = bool(source.one_way_enabled, true);
  const windowLabel = formatDuration(windowHours);

  return {
    windowHours,
    refundPercent,
    lateFee,
    lateFeePerDay,
    lateGraceMinutes,
    lateRepeatThreshold,
    minDays,
    maxDays,
    maxAdvanceDays,
    minAge,
    minBikeAge,
    fuelFee,
    bikeFuelFee,
    oneWayFee,
    holdAmount,
    depositPercent,
    blockExpiredDocs,
    requireDepositAtDesk,
    licenceValidityRequired,
    operationalReminders,
    oneWayEnabled,
    windowLabel,
    fullRefundCopy: windowHours > 0
      ? `Full refund when you cancel at least ${windowLabel} before pick-up.`
      : 'Full refund when you cancel before pick-up.',
    partialRefundCopy: windowHours > 0
      ? `Inside ${windowLabel}, ${refundPercent}% of the amount paid is refunded.`
      : 'Cancellations after pick-up are not refundable online.',
    cancellationSummary: windowHours > 0
      ? `Full refund ${windowLabel} before pick-up · ${refundPercent}% inside ${windowLabel}`
      : 'Full refund before pick-up · no online refund after pick-up',
  };
}

/**
 * One sentence printed on every surface that talks about late returns.
 *
 * The wording is admin-editable (`late_fee_terms`), but the numbers come from
 * `sitePolicy` so the hourly rate, grace window and daily cap can never drift
 * between checkout, the voucher and the returns desk.
 */
export function lateFeeTermsText(template = '', policy = {}) {
  const hourly = Math.max(0, Math.round(number(policy.lateFee, 0)));
  const daily = Math.max(0, Math.round(number(policy.lateFeePerDay, hourly * 24)));
  if (!hourly && !daily) return 'No late fee applies to this booking.';
  const grace = Math.max(0, Math.round(number(policy.lateGraceMinutes, 0)));
  const graceCopy = grace > 0 ? `after a ${grace}-minute grace` : 'with no grace period';
  return String(template || '')
    .replace(/\{hourly\}/g, inr(hourly))
    .replace(/\{daily\}/g, inr(daily))
    .replace(/\{grace\}/g, graceCopy);
}

/**
 * Live late fee for an in-progress trip, using exactly the rates the returns
 * desk settles with. One mapping from the admin policy to the billing engine
 * keeps the customer's meter and the staff's default in lockstep.
 */
export function lateChargeFor(booking = {}, policy = {}, at = new Date()) {
  return lateCharge(booking, {
    lateFeePerHour: policy?.lateFee,
    lateFeePerDay: policy?.lateFeePerDay,
    graceMinutes: policy?.lateGraceMinutes,
  }, at);
}

function fallbackBadgeCopy(title, policy, content) {
  const key = String(title || '').toLowerCase();
  if (key.includes('cancel') || key.includes('refund')) return policy.cancellationSummary;
  if (key.includes('human') || key.includes('support') || key.includes('call')) return content.support_hours;
  if (key.includes('hidden') || key.includes('price') || key.includes('fee')) return 'GST, insurance and extras shown before you pay';
  if (key.includes('paper') || key.includes('instant')) return 'Voucher, contract and invoice to download';
  if (key.includes('helmet')) return 'Helmets included with every bike rental';
  if (key.includes('assist')) return 'Roadside help on every trip';
  return 'Included with every Rove booking';
}

export function normalizeBadges(value, policy, content) {
  const items = parseList(value, []);
  return items
    .map((item) => {
      if (typeof item === 'string') {
        const title = item.trim();
        return title ? { title, copy: fallbackBadgeCopy(title, policy, content) } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title ?? item.label ?? '').trim();
      if (!title) return null;
      return {
        title,
        copy: String(item.copy ?? item.description ?? '').trim()
          || fallbackBadgeCopy(title, policy, content),
      };
    })
    .filter(Boolean);
}

export function normalizeTestimonials(value) {
  return parseList(value, DEFAULT_TESTIMONIALS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name ?? '').trim();
      const quote = String(item.quote ?? '').trim();
      if (!name || !quote) return null;
      return {
        name,
        city: String(item.city ?? '').trim(),
        trip: String(item.trip ?? item.detail ?? '').trim(),
        quote,
        rating: clamp(Math.round(number(item.rating, 5)), 1, 5),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

export function normalizeFaqs(value, policy, content) {
  const items = parseList(value, null);
  if (items === null) {
    return [
      {
        question: 'What do I need to pick up a vehicle?',
        answer: `A valid driving licence, a government photo ID and the payment card used for the booking. Drivers must be at least ${policy.minAge} years old${content.bikes_enabled ? `; bike riders at least ${policy.minBikeAge}` : ''}.`,
      },
      {
        question: 'My licence expires during the rental — can I still book?',
        answer: 'No — the driving licence must stay valid for the whole trip, because the second half of the rental would be illegal to drive. Enter your licence expiry date at checkout and we will check it against your drop-off date before you pay.',
      },
      {
        question: 'Is fuel included?',
        answer: `Vehicles are handed over with a full tank or a 90% charge and should be returned in the same condition. Missing fuel is charged at the pump rate plus a ${inr(policy.fuelFee)} refuelling fee${content.bikes_enabled ? ` (${inr(policy.bikeFuelFee)} for bikes)` : ''}.`,
      },
      {
        question: 'How does the security deposit work?',
        answer: `A refundable ${inr(policy.holdAmount)} security deposit is due at pick-up. It is returned within 5–7 working days of drop-off, less any deductions for tolls, fines, fuel or damage.`,
      },
      {
        question: 'Can I cancel or change my booking?',
        answer: `${policy.fullRefundCopy} ${policy.partialRefundCopy} Date changes are subject to availability.`,
      },
      {
        question: 'Running late? Can I extend my return?',
        answer: 'Yes — extend the return in Manage Booking or your account. Add an hour, an evening or a few extra days; extra days are charged at the current fare and collected at drop-off.',
      },
      {
        question: 'What if I return the vehicle late?',
        answer: `${lateFeeTermsText(content.late_fee_terms, policy)} Extending the return before the drop-off time is always cheaper than arriving late.`,
      },
      {
        question: 'Do you offer one-way rentals?',
        answer: policy.oneWayEnabled
          ? `Yes, between our hubs. One-way rentals carry a ${inr(policy.oneWayFee)} relocation fee, shown clearly in checkout before you pay.`
          : 'No — vehicles are picked up and returned at the same hub.',
      },
      {
        question: 'What happens if something goes wrong on the road?',
        answer: `Every rental includes roadside assistance. Call ${content.support_phone} or email ${content.support_email} and we will arrange recovery, a replacement vehicle, or both.`,
      },
    ];
  }
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const question = String(item.question ?? item.q ?? '').trim();
      const answer = String(item.answer ?? item.a ?? '').trim();
      return question && answer ? { question, answer } : null;
    })
    .filter(Boolean)
    .slice(0, 20);
}

/** Links ({ label, to }) used by the navigation and footer columns. */
export function normalizeLinks(value, fallback = []) {
  return parseList(value, fallback)
    .map((item) => {
      if (typeof item === 'string') {
        const label = item.trim();
        return label ? { label, to: '' } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const label = String(item.label ?? '').trim();
      const to = String(item.to ?? item.href ?? '').trim();
      return label && to ? { label, to } : null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

/** Numbered "how it works" steps. */
export function normalizeSteps(value, fallback = []) {
  return parseList(value, fallback)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title ?? '').trim();
      const copy = String(item.copy ?? item.description ?? '').trim();
      if (!title && !copy) return null;
      const number = String(item.number ?? '').trim() || String(index + 1).padStart(2, '0');
      return { number, title, copy };
    })
    .filter(Boolean)
    .slice(0, 8);
}

/** Homepage category tiles ({ type, label, copy }). */
export function normalizeCategories(value, fallback = []) {
  return parseList(value, fallback)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const type = String(item.type ?? '').trim();
      const label = String(item.label ?? '').trim();
      if (!type || !label) return null;
      return { type, label, copy: String(item.copy ?? '').trim() };
    })
    .filter(Boolean)
    .slice(0, 12);
}

/** Curated trip ideas ({ label, from, to, copy, badge, kind }). */
export function normalizeRoutes(value, fallback = []) {
  return parseList(value, fallback)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const label = String(item.label ?? item.title ?? '').trim();
      const from = String(item.from ?? item.origin ?? '').trim();
      const to = String(item.to ?? item.destination ?? '').trim();
      if (!label || !from || !to) return null;
      const kind = String(item.kind ?? '').trim().toLowerCase();
      return {
        label,
        from,
        to,
        copy: String(item.copy ?? '').trim(),
        badge: String(item.badge ?? '').trim(),
        kind: kind === 'bike' ? 'bike' : kind === 'car' ? 'car' : '',
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

/** A short list of plain strings, e.g. the payment methods shown in the footer. */
export function normalizeStringList(value, fallback = []) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return [...fallback];
  }
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim().startsWith('[')
      ? parseList(value, fallback)
      : String(value).split(',');
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : String(item?.label ?? item?.name ?? '').trim()))
    .filter(Boolean)
    .slice(0, 12);
}

/** Simple { title, copy } pairs used by "why Rove" and About values. */
export function normalizePairs(value, fallback = []) {
  return parseList(value, fallback)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title ?? item.label ?? '').trim();
      const copy = String(item.copy ?? item.description ?? '').trim();
      if (!title) return null;
      return { title, copy };
    })
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Normalise every customer-facing setting used by the storefront.
 */
export function getSiteContent(rawSettings = {}) {
  const source = rawSettings ?? {};
  const policy = sitePolicy(source);
  const content = {
    ...SITE_DEFAULTS,
    ...PAGE_TEXT_DEFAULTS,
    hero_rating: String(clamp(number(source.hero_rating, 4.9), 0, 5)),
    bikes_enabled: bool(source.bikes_enabled, SITE_DEFAULTS.bikes_enabled),
    guest_checkout_enabled: bool(source.guest_checkout_enabled, SITE_DEFAULTS.guest_checkout_enabled),
    reviews_enabled: bool(source.reviews_enabled, SITE_DEFAULTS.reviews_enabled),
    compare_enabled: bool(source.compare_enabled, SITE_DEFAULTS.compare_enabled),
    remember_trip_enabled: bool(source.remember_trip_enabled, SITE_DEFAULTS.remember_trip_enabled),
    change_request_enabled: bool(source.change_request_enabled, SITE_DEFAULTS.change_request_enabled),
    extensions_enabled: bool(source.extensions_enabled, SITE_DEFAULTS.extensions_enabled),
    analytics_enabled: bool(source.analytics_enabled, SITE_DEFAULTS.analytics_enabled),
    alerts_enabled: bool(source.alerts_enabled, SITE_DEFAULTS.alerts_enabled),
    dashboard_show_desk: bool(source.dashboard_show_desk, SITE_DEFAULTS.dashboard_show_desk),
    dashboard_show_finance: bool(source.dashboard_show_finance, SITE_DEFAULTS.dashboard_show_finance),
    dashboard_show_pipeline: bool(source.dashboard_show_pipeline, SITE_DEFAULTS.dashboard_show_pipeline),
    dashboard_show_recent: bool(source.dashboard_show_recent, SITE_DEFAULTS.dashboard_show_recent),
    dashboard_show_fleet: bool(source.dashboard_show_fleet, SITE_DEFAULTS.dashboard_show_fleet),
    dashboard_show_sales: bool(source.dashboard_show_sales, SITE_DEFAULTS.dashboard_show_sales),
    home_show_hero: bool(source.home_show_hero, SITE_DEFAULTS.home_show_hero),
    home_show_catalog: bool(source.home_show_catalog, SITE_DEFAULTS.home_show_catalog),
    home_show_upcoming_trip: bool(source.home_show_upcoming_trip, SITE_DEFAULTS.home_show_upcoming_trip),
    home_show_how: bool(source.home_show_how, SITE_DEFAULTS.home_show_how),
    home_show_locations: bool(source.home_show_locations, SITE_DEFAULTS.home_show_locations),
    home_show_social: bool(source.home_show_social, SITE_DEFAULTS.home_show_social),
    card_show_all_in_rate: bool(source.card_show_all_in_rate, SITE_DEFAULTS.card_show_all_in_rate),
  };

  CONTENT_TEXT_KEYS.forEach((key) => {
    content[key] = text(source[key], content[key]);
  });

  CONTENT_NUMBER_KEYS.forEach((key) => {
    content[key] = String(number(source[key], Number(SITE_DEFAULTS[key])));
  });

  content.tax_label = text(source.tax_label, 'GST');
  content.tax_inclusive = bool(source.tax_inclusive, false);
  content.policy = policy;
  content.trust_badges = normalizeBadges(
    source.trust_badges === undefined ? [] : source.trust_badges,
    policy,
    content,
  );
  if (!content.trust_badges.length) {
    content.trust_badges = [
      { title: 'Free cancellation', copy: policy.cancellationSummary },
      { title: 'Humans on call', copy: content.support_hours },
      { title: 'No hidden fees', copy: 'GST, insurance and extras shown before you pay' },
      { title: 'Instant paperwork', copy: 'Voucher, contract and invoice to download' },
    ];
  }
  content.testimonials = normalizeTestimonials(source.testimonials);
  content.faqs = normalizeFaqs(source.faqs, policy, content);

  content.nav_links = normalizeLinks(source.nav_links, DEFAULT_NAV_LINKS);
  content.footer_fleet_links = normalizeLinks(source.footer_fleet_links, DEFAULT_FOOTER_FLEET_LINKS);
  content.footer_company_links = normalizeLinks(source.footer_company_links, DEFAULT_FOOTER_COMPANY_LINKS);
  content.footer_support_links = normalizeLinks(source.footer_support_links, DEFAULT_FOOTER_SUPPORT_LINKS);
  content.footer_legal_links = normalizeLinks(source.footer_legal_links, DEFAULT_FOOTER_LEGAL_LINKS);
  content.home_steps = normalizeSteps(source.home_steps, DEFAULT_HOME_STEPS);
  content.home_why_points = normalizePairs(source.home_why_points, DEFAULT_HOME_WHY_POINTS);
  content.home_categories = normalizeCategories(source.home_categories, DEFAULT_HOME_CATEGORIES);
  content.about_values = normalizePairs(source.about_values, DEFAULT_ABOUT_VALUES);
  content.routes = normalizeRoutes(source.routes, DEFAULT_ROUTES);
  CONTENT_SPLIT_LIST_KEYS.forEach((key) => {
    content[key] = normalizeStringList(source[key], normalizeStringList(content[key]));
  });

  return content;
}

/**
 * Fill the placeholders allowed in admin page copy with live values, so a
 * heading such as "{hubs}. One very good road trip." always reflects the real
 * policy and network rather than a stale number typed into a setting.
 */
export function fillCopy(value, content = {}, hubCount = 0) {
  const policy = content.policy ?? {};
  const hubs = hubCount > 0 ? `${hubCount} hub${hubCount === 1 ? '' : 's'}` : '';
  return String(value ?? '')
    .replace(/\{deposit\}/g, String(policy.depositPercent ?? ''))
    .replace(/\{refund\}/g, policy.fullRefundCopy ?? '')
    .replace(/\{hubs\}/g, hubs)
    .replace(/\{hours\}/g, content.support_hours ?? '')
    .replace(/\{email\}/g, content.support_email ?? '');
}

/**
 * Split a page-copy string into plain and italic parts. Words wrapped in
 * *asterisks* render with the storefront's italic accent.
 */
export function emphasize(value) {
  return String(value ?? '')
    .split(/\*(.+?)\*/g)
    .map((text, index) => ({ text, italic: index % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** Form-shaped copy: numbers stay editable strings, toggles become booleans. */
export function contentForm(rawSettings = {}) {
  const content = getSiteContent(rawSettings);
  const form = {};
  CONTENT_TEXT_KEYS.forEach((key) => { form[key] = content[key]; });
  CONTENT_NUMBER_KEYS.forEach((key) => { form[key] = content[key]; });
  CONTENT_TOGGLE_KEYS.forEach((key) => { form[key] = content[key]; });
  CONTENT_SPLIT_LIST_KEYS.forEach((key) => { form[key] = (content[key] ?? []).join(', '); });
  form.trust_badges = content.trust_badges.map((item) => ({ ...item }));
  form.testimonials = content.testimonials.map((item) => ({ ...item }));
  form.faqs = content.faqs.map((item) => ({ ...item }));
  form.nav_links = content.nav_links.map((item) => ({ ...item }));
  form.footer_fleet_links = content.footer_fleet_links.map((item) => ({ ...item }));
  form.footer_company_links = content.footer_company_links.map((item) => ({ ...item }));
  form.footer_support_links = content.footer_support_links.map((item) => ({ ...item }));
  form.footer_legal_links = content.footer_legal_links.map((item) => ({ ...item }));
  form.home_steps = content.home_steps.map((item) => ({ ...item }));
  form.home_why_points = content.home_why_points.map((item) => ({ ...item }));
  form.home_categories = content.home_categories.map((item) => ({ ...item }));
  form.about_values = content.about_values.map((item) => ({ ...item }));
  form.routes = content.routes.map((item) => ({ ...item }));
  return form;
}

const listPayload = (items, fields) => JSON.stringify((items ?? []).map((item) => {
  const out = {};
  fields.forEach((field) => { out[field] = String(item?.[field] ?? '').trim(); });
  return out;
}));

/** Convert the form back to the flat string map expected by adminSaveSettings. */
export function contentPayload(form = {}) {
  const patch = {};
  CONTENT_TEXT_KEYS.forEach((key) => {
    patch[key] = String(form[key] ?? '').trim();
  });
  CONTENT_NUMBER_KEYS.forEach((key) => {
    patch[key] = String(form[key] ?? '').trim();
  });
  CONTENT_TOGGLE_KEYS.forEach((key) => {
    patch[key] = form[key] ? 'true' : 'false';
  });
  patch.trust_badges = JSON.stringify((form.trust_badges ?? []).map((item) => ({
    title: String(item.title ?? '').trim(),
    copy: String(item.copy ?? '').trim(),
  })));
  patch.testimonials = JSON.stringify((form.testimonials ?? []).map((item) => ({
    name: String(item.name ?? '').trim(),
    city: String(item.city ?? '').trim(),
    trip: String(item.trip ?? '').trim(),
    quote: String(item.quote ?? '').trim(),
    rating: clamp(Math.round(number(item.rating, 5)), 1, 5),
  })));
  patch.faqs = JSON.stringify((form.faqs ?? []).map((item) => ({
    question: String(item.question ?? '').trim(),
    answer: String(item.answer ?? '').trim(),
  })));
  patch.nav_links = listPayload(form.nav_links, ['label', 'to']);
  patch.footer_fleet_links = listPayload(form.footer_fleet_links, ['label', 'to']);
  patch.footer_company_links = listPayload(form.footer_company_links, ['label', 'to']);
  patch.footer_support_links = listPayload(form.footer_support_links, ['label', 'to']);
  patch.footer_legal_links = listPayload(form.footer_legal_links, ['label', 'to']);
  patch.home_steps = listPayload(form.home_steps, ['number', 'title', 'copy']);
  patch.home_why_points = listPayload(form.home_why_points, ['title', 'copy']);
  patch.home_categories = listPayload(form.home_categories, ['type', 'label', 'copy']);
  patch.about_values = listPayload(form.about_values, ['title', 'copy']);
  patch.routes = JSON.stringify((form.routes ?? []).map((item) => ({
    label: String(item.label ?? '').trim(),
    from: String(item.from ?? '').trim(),
    to: String(item.to ?? '').trim(),
    copy: String(item.copy ?? '').trim(),
    badge: String(item.badge ?? '').trim(),
    kind: String(item.kind ?? '').trim().toLowerCase(),
  })));
  return patch;
}

const numericRules = {
  hero_rating: [0, 5, 'Rating must be between 0 and 5.'],
  cancellation_window_hours: [0, 720, 'Window must be between 0 and 720 hours.'],
  cancellation_refund_percent: [0, 100, 'Refund must be between 0 and 100%.'],
  late_fee_per_hour: [0, 100000, 'Late fee must be between ₹0 and ₹1,00,000.'],
  late_grace_minutes: [0, 1440, 'Grace period must be between 0 and 1440 minutes.'],
  late_repeat_threshold: [2, 20, 'Repeat-late threshold must be between 2 and 20 returns.'],
  min_rental_days: [1, 30, 'Minimum rental must be between 1 and 30 days.'],
  max_rental_days: [1, 365, 'Maximum rental must be between 1 and 365 days.'],
  max_advance_days: [1, 730, 'Advance window must be between 1 and 730 days.'],
  min_age: [16, 90, 'Minimum age must be between 16 and 90.'],
  min_bike_rider_age: [16, 90, 'Bike age must be between 16 and 90.'],
  fuel_refill_fee: [0, 10000, 'Fuel fee must be between ₹0 and ₹10,000.'],
  bike_fuel_refill_fee: [0, 10000, 'Bike fuel fee must be between ₹0 and ₹10,000.'],
};

export function validateContentForm(form = {}) {
  const errors = {};

  if (String(form.hero_title ?? '').trim().length < 4) errors.hero_title = 'Add a headline of at least 4 characters.';
  if (String(form.hero_eyebrow ?? '').trim().length < 2) errors.hero_eyebrow = 'Add a short eyebrow line.';
  if (String(form.hero_subtitle ?? '').trim().length < 20) errors.hero_subtitle = 'Add a subtitle of at least 20 characters.';
  if (String(form.hero_cta_label ?? '').trim().length < 2) errors.hero_cta_label = 'Add a button label.';
  if (String(form.hero_trip_count ?? '').trim().length < 1) errors.hero_trip_count = 'Add a trip count, or a dash if you prefer.';
  if (String(form.footer_tagline ?? '').trim().length < 20) errors.footer_tagline = 'Add a footer tagline of at least 20 characters.';
  if (String(form.company_legal_name ?? '').trim().length < 2) errors.company_legal_name = 'Add the registered company name.';
  if (String(form.legal_updated ?? '').trim().length < 3) errors.legal_updated = 'Add the date these policies were updated.';

  const lengthRules = {
    hero_eyebrow: [60, 'Keep the eyebrow under 60 characters.'],
    hero_title: [90, 'Keep the headline under 90 characters.'],
    hero_subtitle: [400, 'Keep the subtitle under 400 characters.'],
    hero_cta_label: [30, 'Keep the button label under 30 characters.'],
    hero_badge: [40, 'Keep the badge under 40 characters.'],
    hero_image_alt: [160, 'Keep the image description under 160 characters.'],
    hero_trip_count: [20, 'Keep the trip count under 20 characters.'],
    hero_trip_label: [60, 'Keep the trip label under 60 characters.'],
    footer_tagline: [240, 'Keep the footer tagline under 240 characters.'],
    company_legal_name: [120, 'Keep the company name under 120 characters.'],
    gstin: [30, 'Keep the GSTIN under 30 characters.'],
    registered_address: [240, 'Keep the address under 240 characters.'],
    support_hours: [80, 'Keep support hours under 80 characters.'],
    legal_updated: [40, 'Keep the policy date under 40 characters.'],
    social_instagram: [300, 'Keep the link under 300 characters.'],
    social_twitter: [300, 'Keep the link under 300 characters.'],
    social_linkedin: [300, 'Keep the link under 300 characters.'],
  };
  Object.entries(lengthRules).forEach(([key, [max, message]]) => {
    if (String(form[key] ?? '').trim().length > max) errors[key] = message;
  });

  if (!isEmail(form.support_email)) errors.support_email = 'Enter a valid support email address.';
  const phoneError = phoneProblem(form.support_phone, { required: true });
  if (phoneError) errors.support_phone = phoneError;
  if (form.whatsapp_number && phoneProblem(form.whatsapp_number)) {
    errors.whatsapp_number = phoneProblem(form.whatsapp_number);
  }

  const imageError = urlProblem(form.hero_image_url, { required: true });
  if (imageError) errors.hero_image_url = imageError;
  ['social_instagram', 'social_twitter', 'social_linkedin'].forEach((key) => {
    const error = urlProblem(form[key]);
    if (error) errors[key] = error;
  });

  Object.entries(numericRules).forEach(([key, [min, max, message]]) => {
    const raw = String(form[key] ?? '').trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < min || value > max) {
      errors[key] = message;
    }
  });

  const minDays = Number(form.min_rental_days);
  const maxDays = Number(form.max_rental_days);
  if (Number.isFinite(minDays) && Number.isFinite(maxDays) && maxDays < minDays) {
    errors.max_rental_days = 'Maximum must be at least the minimum rental period.';
  }
  const minAge = Number(form.min_age);
  const bikeAge = Number(form.min_bike_rider_age);
  if (Number.isFinite(minAge) && Number.isFinite(bikeAge) && bikeAge > minAge) {
    errors.min_bike_rider_age = 'Bike age cannot exceed the car minimum age.';
  }

  if (!Array.isArray(form.trust_badges) || form.trust_badges.length === 0) {
    errors.trust_badges = 'Add at least one trust badge.';
  } else if (form.trust_badges.length > 4) {
    errors.trust_badges = 'Use no more than four trust badges.';
  } else {
    const bad = form.trust_badges.findIndex((item) => !String(item?.title ?? '').trim());
    if (bad >= 0) errors.trust_badges = `Badge ${bad + 1} needs a title.`;
  }

  const testimonialIndex = (form.testimonials ?? []).findIndex((item) => (
    !String(item?.name ?? '').trim() || !String(item?.quote ?? '').trim()
  ));
  if (testimonialIndex >= 0) {
    errors.testimonials = `Testimonial ${testimonialIndex + 1} needs a name and quote.`;
  } else if ((form.testimonials ?? []).length > 12) {
    errors.testimonials = 'Use no more than 12 testimonials.';
  }

  const faqIndex = (form.faqs ?? []).findIndex((item) => (
    !String(item?.question ?? '').trim() || !String(item?.answer ?? '').trim()
  ));
  if (faqIndex >= 0) {
    errors.faqs = `FAQ ${faqIndex + 1} needs both a question and an answer.`;
  } else if ((form.faqs ?? []).length > 20) {
    errors.faqs = 'Use no more than 20 FAQs.';
  }

  // Page copy: keep every string within a sensible length.
  PAGE_TEXT_KEYS.forEach((key) => {
    const value = String(form[key] ?? '').trim();
    if (value.length > 600) errors[key] = 'Keep this under 600 characters.';
  });
  const pageRequired = {
    nav_cta_label: 'Add a button label.',
    footer_cta_title: 'Add a title for the footer banner.',
    footer_cta_label: 'Add a button label.',
    home_cta_title: 'Add a closing headline.',
    home_cta_primary_label: 'Add a button label.',
    about_title: 'Add a headline.',
    contact_title: 'Add a headline.',
  };
  Object.entries(pageRequired).forEach(([key, message]) => {
    if (String(form[key] ?? '').trim().length < 2) errors[key] = message;
  });

  const linkLists = {
    nav_links: 'navigation links',
    footer_fleet_links: 'fleet links',
    footer_company_links: 'company links',
    footer_support_links: 'support links',
    footer_legal_links: 'legal links',
  };
  Object.entries(linkLists).forEach(([key, label]) => {
    const items = form[key] ?? [];
    const bad = Array.isArray(items)
      ? items.findIndex((item) => !String(item?.label ?? '').trim() || !String(item?.to ?? '').trim())
      : 0;
    if (bad >= 0) {
      errors[key] = `Link ${bad + 1} needs a label and a destination.`;
    } else if (key === 'nav_links' && items.length === 0) {
      errors[key] = 'Add at least one navigation link.';
    } else if (items.length > 12) {
      errors[key] = `Use no more than 12 ${label}.`;
    }
  });

  const stepIndex = (form.home_steps ?? []).findIndex((item) => (
    !String(item?.title ?? '').trim() || !String(item?.copy ?? '').trim()
  ));
  if (stepIndex >= 0) {
    errors.home_steps = `Step ${stepIndex + 1} needs a title and copy.`;
  } else if ((form.home_steps ?? []).length === 0) {
    errors.home_steps = 'Add at least one step.';
  } else if ((form.home_steps ?? []).length > 8) {
    errors.home_steps = 'Use no more than 8 steps.';
  }

  const categoryIndex = (form.home_categories ?? []).findIndex((item) => (
    !String(item?.type ?? '').trim() || !String(item?.label ?? '').trim()
  ));
  if (categoryIndex >= 0) errors.home_categories = `Category ${categoryIndex + 1} needs a type and label.`;

  const whyIndex = (form.home_why_points ?? []).findIndex((item) => !String(item?.title ?? '').trim());
  if (whyIndex >= 0) errors.home_why_points = `Reason ${whyIndex + 1} needs a title.`;

  const valueIndex = (form.about_values ?? []).findIndex((item) => !String(item?.title ?? '').trim());
  if (valueIndex >= 0) errors.about_values = `Value ${valueIndex + 1} needs a title.`;

  const routeIndex = (form.routes ?? []).findIndex((item) => (
    !String(item?.label ?? '').trim() || !String(item?.from ?? '').trim() || !String(item?.to ?? '').trim()
  ));
  if (routeIndex >= 0) {
    errors.routes = `Route ${routeIndex + 1} needs a label plus pick-up and drop-off hubs.`;
  } else {
    const badKind = (form.routes ?? []).findIndex((item) => {
      const kind = String(item?.kind ?? '').trim().toLowerCase();
      return kind !== '' && kind !== 'car' && kind !== 'bike';
    });
    if (badKind >= 0) errors.routes = `Route ${badKind + 1} kind must be “car” or “bike”.`;
    if ((form.routes ?? []).length > 12) errors.routes = 'Use no more than 12 routes.';
  }

  return errors;
}

export const hasErrors = (errors) => Object.keys(errors ?? {}).length > 0;

/**
 * Shared trip-date validation used by search, vehicle and checkout.
 */
export function tripProblem(startDate, endDate, rawSettings = {}) {
  const policy = sitePolicy(rawSettings);
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return 'Choose a valid pick-up and drop-off date.';
  }
  if (startDate < todayISO()) return 'Pick-up cannot be in the past.';
  if (endDate < startDate) return 'Drop-off must be on or after pick-up.';
  const days = daysBetween(startDate, endDate);
  if (days < policy.minDays) {
    return `The minimum rental is ${policy.minDays} day${policy.minDays === 1 ? '' : 's'}.`;
  }
  if (days > policy.maxDays) {
    return `Rentals are limited to ${policy.maxDays} days.`;
  }
  const advance = dayNumber(startDate) - dayNumber(todayISO());
  if (advance > policy.maxAdvanceDays) {
    return `Bookings can be made up to ${policy.maxAdvanceDays} days in advance.`;
  }
  return null;
}

/**
 * Refund due under the current cancellation policy.
 * Pick-up times are Indian wall-clock times, so parse them with +05:30.
 */
export function cancellationRefund(booking, amountPaid, rawSettings = {}, now = Date.now()) {
  const policy = sitePolicy(rawSettings);
  const pickup = new Date(`${booking.startDate}T${booking.pickupTime || '10:00'}:00+05:30`);
  const hours = (pickup.getTime() - now) / 3600000;
  const insideWindow = hours < policy.windowHours;
  if (!Number.isFinite(hours)) {
    return {
      refundAmount: 0, percent: 0, hours: 0, insideWindow: true, policy, credit: 0,
    };
  }
  const percent = insideWindow ? policy.refundPercent : 100;
  const paid = Math.max(0, Number(amountPaid) || 0);
  const total = Math.max(0, Number(booking?.total) || 0);
  // Anything paid above the trip total is a customer credit, not part of the
  // rental charge. Return the credit in full and apply the cancellation policy
  // only to the amount that actually belongs to this trip — otherwise a
  // downward reprice followed by a cancellation would silently swallow part of
  // the overpayment.
  const credit = Math.max(0, paid - total);
  const refundableBase = Math.min(paid, total);
  return {
    refundAmount: Math.max(0, Math.round(credit + refundableBase * (percent / 100))),
    percent,
    hours,
    insideWindow,
    policy,
    credit,
  };
}

export const maxAdvanceDate = (rawSettings = {}) => {
  const policy = sitePolicy(rawSettings);
  const date = new Date();
  date.setDate(date.getDate() + policy.maxAdvanceDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
