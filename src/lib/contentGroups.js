// The admin Content console edits ~1,400 storefront strings. Grouping them by
// key prefix keeps every string under a recognisable heading instead of one
// endless list. The mapping is pure and exported so it can be contract-tested:
// every shipped key must land in a real group, never the catch-all by accident.

export const CONTENT_GROUP_META = {
  nav: { title: 'Navigation & announcements', description: 'The top strip, the header button and the mobile menu.' },
  palette: { title: 'Search palette', description: '⌘K trigger, placeholder, keyboard hints and result copy.' },
  footer: { title: 'Footer', description: 'Footer columns, contact line and the closing banner.' },
  home: { title: 'Homepage sections', description: 'Headings, cards and the closing call to action.' },
  about: { title: 'About page', description: 'Story, mission and the closing call to action.' },
  contact: { title: 'Contact page', description: 'Heading and message-form copy.' },
  legal: { title: 'Legal pages', description: 'Terms and privacy page headings.' },
  browse: { title: 'Browse the fleet', description: 'Inventory headings, filters chrome, map panel and empty states.' },
  compare: { title: 'Vehicle comparison', description: 'Compare tray, table labels, pricing notes and empty state.' },
  routes: { title: 'Trip ideas', description: 'The /routes page headings, badges and button labels.' },
  hubs: { title: 'Hub directory', description: 'The /hubs page headings, hub stats and contact strip.' },
  saved: { title: 'Saved searches', description: 'Browse save/apply drawer headings and action labels.' },
  help: { title: 'Help panel', description: 'The floating support button, panel headings and channel labels.' },
  amend: { title: 'Trip changes', description: 'Self-serve change-request copy and the staff approve/decline labels.' },
  analytics: { title: 'Dashboard analytics', description: 'KPI labels, chart titles and funnel step names for the admin dashboard.' },
  dashboard: { title: 'Admin dashboard', description: 'Top lists, recent events and dashboard section toggles.' },
  desk: { title: 'Handover desk', description: 'Headings and action labels for the daily pick-up checklist.' },
  remember: { title: 'Trip memory', description: 'Resume-last-trip prefill and the “your last search” strip.' },
  search: { title: 'Search widget', description: 'Date, hub, vehicle-type and quick-date labels used across the site.' },
  vehicle: { title: 'Vehicle detail', description: 'Protection, fine print, price history, reviews and similar vehicles.' },
  fleet: { title: 'Fleet console', description: 'Fleet table headings, health panel and empty states.' },
  checkout: { title: 'Checkout', description: 'Step labels, section headings and payment calls to action.' },
  auth: { title: 'Sign in & recovery', description: 'Account, registration and password-recovery headings.' },
  account: { title: 'Customer account', description: 'Tabs, section headings, empty states and profile copy.' },
  inbox: { title: 'Inbox & staff actions', description: 'Message triage, reply composer and shared staff action labels.' },
  bookings: { title: 'Bookings console', description: 'Table, drawer, filters and bulk-action copy.' },
  maintenance: { title: 'Fleet maintenance', description: 'Service log, odometer and workshop-downtime messages.' },
  pricing: { title: 'Pricing & promos console', description: 'Add-on, promo, protection-tier and rate-rule messages.' },
  locations: { title: 'Locations console', description: 'Hub save and removal messages.' },
  users: { title: 'Users & roles console', description: 'Staff updates, licence verification and export messages.' },
  reviews: { title: 'Reviews console', description: 'Moderation, removal and reply feedback.' },
  audit: { title: 'Audit log', description: 'Trail filtering and export copy.' },
  comms: { title: 'Email centre', description: 'Template editor, outbox and resend messages.' },
  manage: { title: 'Manage booking', description: 'Lookup form, voucher actions, cancellation modal and help panel.' },
  notfound: { title: '404 page', description: 'Wrong-turn heading, recovery links and card copy.' },
  confirmation: { title: 'Booking confirmation', description: 'Status headings, voucher, invoice and next-step copy.' },
  seo: { title: 'SEO & sharing', description: 'Titles and descriptions used in search results and link previews.' },
};

// Order in which groups render in the console. Checked before the prefix map so
// the catch-all stays last.
export const CONTENT_GROUP_ORDER = [
  'nav', 'palette', 'footer', 'home', 'about', 'contact', 'legal', 'browse', 'compare',
  'routes', 'hubs', 'saved', 'help', 'amend', 'analytics', 'dashboard', 'desk', 'remember',
  'search', 'vehicle', 'fleet', 'checkout', 'auth', 'account', 'inbox', 'bookings',
  'maintenance', 'pricing', 'locations', 'users', 'reviews', 'audit', 'comms', 'manage',
  'notfound', 'confirmation', 'seo',
];

// First matching rule wins, so narrower prefixes must come before broader ones
// (late_meter* is account copy, late_fee* belongs to the handover desk).
const RULES = [
  [['announcement_', 'nav_'], 'nav'],
  [['palette_'], 'palette'],
  [['footer_'], 'footer'],
  [['home_'], 'home'],
  [['about_'], 'about'],
  [['contact_'], 'contact'],
  [['terms_', 'privacy_'], 'legal'],
  [['browse_'], 'browse'],
  [['compare_'], 'compare'],
  [['routes_'], 'routes'],
  [['hubs_'], 'hubs'],
  [['saved_'], 'saved'],
  [['help_'], 'help'],
  [['alert_'], 'vehicle'],
  [['amend_', 'extend_'], 'amend'],
  [['analytics_'], 'analytics'],
  [['dashboard_'], 'dashboard'],
  [['late_meter'], 'account'],
  [['desk_', 'return_', 'late_fee'], 'desk'],
  [['remember_', 'trip_'], 'remember'],
  [['search_'], 'search'],
  [['vehicle_'], 'vehicle'],
  [['fleet_'], 'fleet'],
  [['checkout_'], 'checkout'],
  [['auth_'], 'auth'],
  [['account_', 'countdown_'], 'account'],
  [['notif_'], 'account'],
  [['inbox_', 'staff_'], 'inbox'],
  [['comms_'], 'comms'],
  [['bookings_', 'drawer_'], 'bookings'],
  [['maintenance_'], 'maintenance'],
  [['pricing_'], 'pricing'],
  [['locations_'], 'locations'],
  [['users_'], 'users'],
  [['reviews_'], 'reviews'],
  [['audit_'], 'audit'],
  [['manage_'], 'manage'],
  [['notfound_'], 'notfound'],
  [['confirmation_'], 'confirmation'],
];

/** Group id for a page-copy key. Unrecognised keys fall back to SEO. */
export function contentGroupFor(key) {
  const value = String(key || '');
  const rule = RULES.find(([prefixes]) => prefixes.some((prefix) => value.startsWith(prefix)));
  return rule ? rule[1] : 'seo';
}

/**
 * Bucket keys into ordered groups. Empty groups are dropped so the console never
 * renders a heading with nothing under it.
 * @param {string[]} keys
 */
export function groupContentKeys(keys = []) {
  const groups = new Map(
    CONTENT_GROUP_ORDER.map((id) => [id, { id, ...CONTENT_GROUP_META[id], keys: [] }]),
  );
  keys.forEach((key) => {
    const id = contentGroupFor(key);
    groups.get(id).keys.push(key);
  });
  return CONTENT_GROUP_ORDER
    .map((id) => groups.get(id))
    .filter((group) => group.keys.length);
}
