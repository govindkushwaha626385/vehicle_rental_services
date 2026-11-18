import { VEHICLE_TYPES, kindForType } from './constants.js';

/**
 * Pure builder for the storefront ⌘K palette. Keeping this free of React and
 * icons makes it cheap to contract-test in the demo suite and lets the
 * component stay a thin mapping layer.
 *
 * Icons are returned as string keys and mapped to lucide components by the
 * caller, so this module never relies on a window or a renderer.
 */

export const PALETTE_GROUPS = Object.freeze(['pages', 'types', 'actions', 'recent', 'hubs']);

const findLink = (links, to, fallback) => {
  const match = (Array.isArray(links) ? links : []).find((link) => link.to === to);
  return (match && match.label) ? match.label : fallback;
};

export function buildPaletteItems({ content = {}, meta = {}, user = null, isStaff = false, recent = [] }) {
  const locations = Array.isArray(meta.locations) ? meta.locations : [];
  const items = [];
  const push = (group, item) => { items.push({ group, ...item }); };

  // Pages ---------------------------------------------------------------
  push('pages', {
    label: content.browse_crumb_fleet || 'Fleet',
    detail: content.palette_page_detail,
    to: '/browse',
    icon: 'car',
    keywords: 'fleet cars bikes browse search',
  });
  push('pages', {
    label: content.browse_all_cars || 'All cars',
    detail: content.palette_type_detail,
    to: '/browse?kind=car',
    icon: 'car',
    keywords: 'suv sedan electric sports convertible van',
  });
  if (content.bikes_enabled) {
    push('pages', {
      label: content.browse_all_bikes || 'All bikes',
      detail: content.palette_type_detail,
      to: '/browse?kind=bike',
      icon: 'bike',
      keywords: 'scooter cruiser sport adventure',
    });
  }
  if (content.compare_enabled) {
    push('pages', {
      label: content.compare_tray_title || 'Compare',
      detail: content.palette_compare_detail,
      to: '/compare',
      icon: 'compare',
      keywords: 'shortlist side by side compare',
    });
  }
  push('pages', {
    label: findLink(content.footer_support_links, '/manage', content.home_how_secondary_label || 'Manage a booking'),
    detail: content.palette_action_detail,
    to: '/manage',
    icon: 'calendar',
    keywords: 'booking voucher invoice cancel trip',
  });

  // Vehicle types -------------------------------------------------------
  VEHICLE_TYPES.forEach((type) => {
    if (!content.bikes_enabled && kindForType(type) === 'bike') return;
    push('types', {
      label: type,
      detail: content.palette_type_detail,
      to: `/browse?type=${encodeURIComponent(type)}`,
      icon: kindForType(type) === 'bike' ? 'compass' : 'car',
      keywords: 'vehicle type category',
    });
  });

  // Quick actions -------------------------------------------------------
  if (user) {
    push('actions', {
      label: content.account_tab_trips || 'My trips',
      detail: content.palette_action_detail,
      to: '/account',
      icon: 'calendar',
      keywords: 'bookings trips upcoming past',
    });
    push('actions', {
      label: content.account_tab_saved || 'Saved vehicles',
      detail: content.palette_action_detail,
      to: '/account?tab=saved',
      icon: 'heart',
      keywords: 'favourites wishlist',
    });
    push('actions', {
      label: content.account_tab_profile || 'Profile',
      detail: content.palette_action_detail,
      to: '/account?tab=profile',
      icon: 'user',
      keywords: 'details licence contact',
    });
    if (isStaff) {
      push('actions', {
        label: 'Admin console',
        detail: content.palette_action_detail,
        to: '/admin',
        icon: 'admin',
        keywords: 'staff manager dashboard',
      });
    }
  } else {
    push('actions', {
      label: content.auth_signin_cta || 'Sign in',
      detail: content.palette_action_detail,
      to: '/login',
      icon: 'user',
      keywords: 'account login',
    });
    push('actions', {
      label: content.auth_create_account || 'Create an account',
      detail: content.palette_action_detail,
      to: '/register',
      icon: 'userPlus',
      keywords: 'sign up register account',
    });
  }

  push('pages', {
    label: findLink(content.footer_company_links, '/about', content.about_eyebrow || 'About'),
    detail: content.palette_page_detail,
    to: '/about',
    icon: 'sparkles',
    keywords: 'story mission team',
  });
  push('pages', {
    label: findLink(content.footer_support_links, '/contact', content.contact_eyebrow || 'Contact'),
    detail: content.palette_page_detail,
    to: '/contact',
    icon: 'lifeBuoy',
    keywords: 'support help contact email phone',
  });
  push('pages', {
    label: content.home_faq_eyebrow || 'Good to know',
    detail: content.palette_page_detail,
    to: '/#faq',
    icon: 'help',
    keywords: 'questions answers faq support',
  });

  // Recently viewed -----------------------------------------------------
  (Array.isArray(recent) ? recent : []).slice(0, 5).forEach((vehicle) => {
    push('recent', {
      label: vehicle.name,
      detail: content.palette_recent_detail,
      to: `/vehicles/${vehicle.id}`,
      icon: vehicle.type ? 'compass' : 'car',
      keywords: `${vehicle.type || ''} ${vehicle.location || ''} recently viewed`,
    });
  });

  // Hubs ----------------------------------------------------------------
  locations.forEach((location) => {
    push('hubs', {
      label: location.name,
      detail: `${location.city || content.palette_hub_detail} · ${content.palette_hub_detail}`,
      to: `/browse?location=${encodeURIComponent(location.name)}`,
      icon: 'map',
      keywords: `hub city pickup ${location.city || ''}`,
    });
  });

  return items;
}

/** Filter a built palette list by a typed query (shared by UI and tests). */
export function filterPaletteItems(items, query = '') {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return items.slice(0, 14);
  return items
    .filter((item) => `${item.label} ${item.detail} ${item.keywords || ''}`.toLowerCase().includes(normalized))
    .slice(0, 14);
}