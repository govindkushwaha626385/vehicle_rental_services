import { lazy, Suspense, useEffect } from 'react';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { RequireAdmin, RequireAuth, RequireStaff } from './components/guards.jsx';
import { PageLoader } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import HelpPanel from './components/HelpPanel.jsx';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, setPageMeta, setStructuredData } from './lib/meta.js';
import { useMeta } from './context/MetaContext.jsx';
import { getSiteContent } from './lib/site.js';
import { applyTheme, readThemePreference } from './lib/theme.js';

// Route-level code splitting keeps the landing page lean. Admin, checkout and
// account bundles only load when a visitor actually needs them.
const Browse = lazy(() => import('./pages/Browse.jsx'));
const Compare = lazy(() => import('./pages/Compare.jsx'));
const TripRoutes = lazy(() => import('./pages/Routes.jsx'));
const Hubs = lazy(() => import('./pages/Hubs.jsx'));
const Vehicle = lazy(() => import('./pages/Vehicle.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const Confirmation = lazy(() => import('./pages/Confirmation.jsx'));
const ManageBooking = lazy(() => import('./pages/ManageBooking.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const Legal = lazy(() => import('./pages/Legal.jsx'));
const About = lazy(() => import('./pages/About.jsx'));
const Contact = lazy(() => import('./pages/Contact.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const Calendar = lazy(() => import('./pages/admin/Calendar.jsx'));
const Audit = lazy(() => import('./pages/admin/Audit.jsx'));
const Desk = lazy(() => import('./pages/admin/Desk.jsx'));
const Comms = lazy(() => import('./pages/admin/Comms.jsx'));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage.jsx'));
const Customers = lazy(() => import('./pages/admin/Customers.jsx'));
const Fleet = lazy(() => import('./pages/admin/Fleet.jsx'));
const Maintenance = lazy(() => import('./pages/admin/Maintenance.jsx'));
const Bookings = lazy(() => import('./pages/admin/Bookings.jsx'));
const Finance = lazy(() => import('./pages/admin/Finance.jsx'));
const Pricing = lazy(() => import('./pages/admin/Pricing.jsx'));
const Content = lazy(() => import('./pages/admin/Content.jsx'));
const Inbox = lazy(() => import('./pages/admin/Inbox.jsx'));
const Reviews = lazy(() => import('./pages/admin/Reviews.jsx'));
const Locations = lazy(() => import('./pages/admin/Locations.jsx'));
const Users = lazy(() => import('./pages/admin/Users.jsx'));
const Settings = lazy(() => import('./pages/admin/Settings.jsx'));

function Lazy({ component: Component, ...props }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component {...props} />
    </Suspense>
  );
}

// Route metadata uses a {site} token so the operator's chosen site name flows
// into every title and description. Values are filled in RouteMeta below.
const META = {
  '/': { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
  '/browse': {
    title: 'Browse cars & bikes — {site} rentals',
    description: 'Find available cars and bikes across India. Filter by price, type, seats, fuel and more.',
  },
  '/compare': {
    title: 'Compare vehicles — {site} rentals',
    description: 'Compare your shortlist of cars and bikes side by side — price, space, specs and the fine print.',
  },
  '/routes': {
    title: 'Trip ideas — {site} rentals',
    description: 'Popular loops and one-way drives between our hubs, ready to book with live availability.',
  },
  '/hubs': {
    title: 'Our hubs — {site} rentals',
    description: 'Every {site} pick-up hub with addresses, hours and live availability. One-way trips between hubs are simple.',
  },
  '/checkout': {
    title: 'Secure checkout — {site}',
    description: 'Review your trip, add protection and pay securely with Razorpay.',
    private: true,
  },
  '/manage': {
    title: 'Manage your booking — {site}',
    description: 'View your voucher, invoice and pick-up details, or cancel your {site} rental.',
    private: true,
  },
  '/account': {
    title: 'Your account — {site}',
    description: 'Trips, invoices, saved vehicles and payment methods in one place.',
    private: true,
  },
  '/login': {
    title: 'Sign in — {site}',
    description: 'Sign in to manage your {site} rentals, invoices and saved vehicles.',
    private: true,
  },
  '/register': {
    title: 'Create an account — {site}',
    description: 'Create a {site} account for faster checkouts and every invoice in one place.',
    private: true,
  },
  '/forgot-password': {
    title: 'Reset your password — {site}',
    description: 'Recover access to your {site} account.',
    private: true,
  },
  '/reset-password': {
    title: 'Choose a new password — {site}',
    description: 'Set a new password for your {site} account.',
    private: true,
  },
  '/terms': {
    title: 'Rental terms — {site}',
    description: 'Eligibility, payments, deposits, cancellation and damage liability for {site} self-drive rentals.',
  },
  '/privacy': {
    title: 'Privacy policy — {site}',
    description: 'How {site} collects, uses and protects your personal data, including payments via Razorpay.',
  },
  '/about': {
    title: 'About {site} — our story, values and the team who answer the phone',
    description: '{site} was built to make self-drive rentals in India feel effortless. Meet the mission, the fleet and the people behind it.',
  },
  '/contact': {
    title: 'Contact {site} — talk to a human, any day',
    description: 'Questions about a booking or a trip? Email, call or WhatsApp the {site} support team — a real person replies.',
  },
};

const ADMIN_META = {
  '/admin': 'Dashboard — {site} admin',
  '/admin/analytics': 'Analytics — {site} admin',
  '/admin/calendar': 'Availability calendar — {site} admin',
  '/admin/desk': 'Handover desk — {site} admin',
  '/admin/comms': 'Email & notification templates — {site} admin',
  '/admin/audit': 'Audit log — {site} admin',
  '/admin/bookings': 'Bookings — {site} admin',
  '/admin/finance': 'Finance & GST — {site} admin',
  '/admin/fleet': 'Fleet — {site} admin',
  '/admin/maintenance': 'Maintenance & service — {site} admin',
  '/admin/pricing': 'Pricing & promos — {site} admin',
  '/admin/content': 'Content & policies — {site} admin',
  '/admin/inbox': 'Inbox — {site} admin',
  '/admin/reviews': 'Reviews — {site} admin',
  '/admin/locations': 'Locations — {site} admin',
  '/admin/customers': 'Customers — {site} admin',
  '/admin/users': 'Users — {site} admin',
  '/admin/settings': 'Settings — {site} admin',
};

const DYNAMIC_META = [
  {
    test: /^\/vehicles\/[^/]+\/?$/,
    meta: {
      title: 'Vehicle details — {site} rentals',
      description: 'View specs, features, insurance options and live availability for this {site} rental.',
    },
  },
  {
    test: /^\/confirmation\/[^/]+\/?$/,
    meta: {
      title: 'Your booking — {site}',
      description: 'Your {site} booking voucher, invoice and pick-up details.',
      private: true,
    },
  },
];

const brand = (value, site) => String(value ?? '').replace(/\{site\}/g, site);

const clipMeta = (value, max = 170) => {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

function routeMeta(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (META[path]) return { ...META[path], path };
  if (ADMIN_META[path]) {
    return {
      title: ADMIN_META[path],
      description: '{site} operations console for fleet, bookings, pricing and customers.',
      path,
      private: true,
    };
  }
  if (path.startsWith('/admin/')) {
    return {
      title: 'Admin — {site}',
      description: '{site} operations console.',
      path,
      private: true,
    };
  }
  const dynamic = DYNAMIC_META.find((route) => route.test.test(path));
  if (dynamic) return { ...dynamic.meta, path };
  return {
    title: 'Page not found — {site}',
    description: 'The page you were looking for has moved or no longer exists.',
    path,
    private: true,
  };
}

function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      let attempts = 0;
      let timer;
      const reveal = () => {
        const element = document.getElementById(hash.slice(1));
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        // Lazy routes may still be mounting (for example /terms#licence).
        attempts += 1;
        if (attempts < 20) timer = window.setTimeout(reveal, 60);
      };
      reveal();
      return () => window.clearTimeout(timer);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    return undefined;
  }, [pathname, hash]);

  return null;
}

function ThemeController() {
  const { meta } = useMeta();
  const { pathname } = useLocation();
  useEffect(() => {
    // A customer's per-device preference (Account → Appearance) overrides the
    // admin default, but never leaks into the admin console preview.
    const prefs = { ...(meta.settings || {}) };
    if (!pathname.startsWith('/admin')) {
      const preference = readThemePreference();
      if (preference) prefs.theme_mode = preference;
    }
    applyTheme(prefs);
  }, [meta.settings, pathname]);
  return null;
}

function RouteMeta() {
  const { pathname } = useLocation();
  const { meta: catalogue } = useMeta();

  useEffect(() => {
    const meta = routeMeta(pathname);
    const content = getSiteContent(catalogue.settings);
    const siteName = String(content.site_name || '').trim() || 'Rove';
    const hubCount = catalogue.locations.length;
    const hubPhrase = hubCount
      ? ` across ${hubCount} hub${hubCount === 1 ? '' : 's'}`
      : ' across India';
    let title = brand(meta.title, siteName);
    let description = brand(meta.description, siteName);

    if (meta.path === '/') {
      title = brand(content.default_meta_title, siteName) || brand(DEFAULT_TITLE, siteName);
      description = brand(content.default_meta_description, siteName) || content.hero_subtitle;
    } else if (meta.path === '/browse') {
      title = `Browse ${content.bikes_enabled ? 'cars & bikes' : 'cars'} — ${siteName} rentals`;
      description = `Find available ${content.bikes_enabled ? 'cars and bikes' : 'cars'}${hubPhrase}. Filter by price, type, seats, fuel and more.`;
    } else if (meta.path === '/about') {
      description = `${siteName} was built to make self-drive rentals in India feel effortless. Meet the mission, the fleet and the people behind ${hubCount ? `${hubCount} hub${hubCount === 1 ? '' : 's'}` : 'the service'}.`;
    }

    setPageMeta({
      title,
      description: clipMeta(description),
      path: meta.path,
      image: content.hero_image_url,
      robots: meta.private ? 'noindex,nofollow' : 'index,follow',
      siteName,
      defaultImage: content.default_meta_image,
    });

    if (meta.private) {
      setStructuredData('site-schema', null);
    } else {
      const schemaImage = (() => {
        const raw = String(content.hero_image_url || '').trim();
        if (!raw || raw.startsWith('data:')) return undefined;
        try {
          return new URL(raw, window.location.origin).href;
        } catch {
          return undefined;
        }
      })();
      setStructuredData('site-schema', {
        '@context': 'https://schema.org',
        '@type': 'AutoRental',
        name: content.company_legal_name || siteName,
        description: content.hero_subtitle,
        url: window.location.origin,
        telephone: content.support_phone,
        email: content.support_email,
        image: schemaImage,
        priceRange: '₹₹₹',
        areaServed: hubCount ? [...new Set(catalogue.locations.map((location) => location.city || location.name))] : 'India',
      });
    }
  }, [pathname, catalogue.settings, catalogue.locations]);

  return null;
}

function SiteLayout() {
  const { pathname } = useLocation();
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <div className="scroll-progress pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] bg-gradient-to-r from-lime via-aqua to-coral" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-44 -top-48 h-[38rem] w-[38rem] rounded-full bg-lime/20 blur-[130px]" />
        <div className="absolute -right-48 top-[18%] h-[34rem] w-[34rem] rounded-full bg-aqua/15 blur-[140px]" />
        <div className="absolute bottom-[-16rem] left-[32%] h-[32rem] w-[32rem] rounded-full bg-coral/10 blur-[150px]" />
      </div>
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-full bg-ink px-4 py-2 text-sm font-bold text-cream focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <div className="no-print"><Navbar /></div>
      <main id="main-content" tabIndex={-1} className="flex-1">
        <div key={pathname} className="page-enter"><Outlet /></div>
      </main>
      <div className="no-print"><Footer /></div>
      <HelpPanel />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  return (
    <>
      <ScrollManager />
      <ThemeController />
      <RouteMeta />
      <ErrorBoundary key={location.pathname}>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="browse" element={<Lazy component={Browse} />} />
            <Route path="compare" element={<Lazy component={Compare} />} />
            <Route path="routes" element={<Lazy component={TripRoutes} />} />
            <Route path="hubs" element={<Lazy component={Hubs} />} />
            <Route path="vehicles/:id" element={<Lazy component={Vehicle} />} />
            <Route path="checkout" element={<Lazy component={Checkout} />} />
            <Route path="confirmation/:code" element={<Lazy component={Confirmation} />} />
            <Route path="manage" element={<Lazy component={ManageBooking} />} />
            <Route path="account" element={<RequireAuth><Lazy component={Account} /></RequireAuth>} />
            <Route path="terms" element={<Lazy component={Legal} kind="terms" />} />
            <Route path="privacy" element={<Lazy component={Legal} kind="privacy" />} />
            <Route path="about" element={<Lazy component={About} />} />
            <Route path="contact" element={<Lazy component={Contact} />} />
            <Route path="*" element={<Lazy component={NotFound} />} />
          </Route>

          <Route path="/login" element={<Lazy component={Login} />} />
          <Route path="/register" element={<Lazy component={Register} />} />
          <Route path="/forgot-password" element={<Lazy component={ForgotPassword} />} />
          <Route path="/reset-password" element={<Lazy component={ResetPassword} />} />

          <Route path="/admin" element={<RequireStaff><Lazy component={AdminLayout} /></RequireStaff>}>
            <Route index element={<Lazy component={Dashboard} />} />
            <Route path="analytics" element={<Lazy component={AnalyticsPage} />} />
            <Route path="calendar" element={<Lazy component={Calendar} />} />
            <Route path="desk" element={<Lazy component={Desk} />} />
            <Route path="comms" element={<RequireAdmin><Lazy component={Comms} /></RequireAdmin>} />
            <Route path="audit" element={<RequireAdmin><Lazy component={Audit} /></RequireAdmin>} />
            <Route path="bookings" element={<Lazy component={Bookings} />} />
            <Route path="finance" element={<RequireAdmin><Lazy component={Finance} /></RequireAdmin>} />
            <Route path="fleet" element={<Lazy component={Fleet} />} />
            <Route path="maintenance" element={<Lazy component={Maintenance} />} />
            <Route path="pricing" element={<Lazy component={Pricing} />} />
            <Route path="content" element={<RequireAdmin><Lazy component={Content} /></RequireAdmin>} />
            <Route path="inbox" element={<Lazy component={Inbox} />} />
            <Route path="reviews" element={<Lazy component={Reviews} />} />
            <Route path="locations" element={<Lazy component={Locations} />} />
            <Route path="customers" element={<Lazy component={Customers} />} />
            <Route path="users" element={<RequireAdmin><Lazy component={Users} /></RequireAdmin>} />
            <Route path="settings" element={<RequireAdmin><Lazy component={Settings} /></RequireAdmin>} />
            <Route path="*" element={<div className="rounded-2xl border border-line bg-white p-8 text-center"><p className="text-sm font-extrabold">Console page not found.</p><Link to="/admin" className="btn btn-dark btn-sm mt-3">Back to dashboard</Link></div>} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </>
  );
}
