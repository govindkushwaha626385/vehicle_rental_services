import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarCheck, CalendarRange, Car, ChartLine, ChevronRight, ChevronUp, ClipboardCheck, Contact, CreditCard, ExternalLink, FileText, Inbox, IndianRupee, LayoutDashboard, LogOut,
  Mail, MapPin, Menu, Plus, Search, Settings, ShieldCheck, Star, Users, Wrench, X,
} from 'lucide-react';
import { Avatar, Kbd, Logo, ScrollToTop } from '../../components/ui.jsx';
import CommandPalette from '../../components/CommandPalette.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { roleLabel, shortDate } from '../../lib/format.js';

// Quick actions surfaced in the ⌘K palette, available to every staff role.
const PALETTE_ACTIONS = [
  { label: 'Review bookings', detail: 'Approve, reschedule or refund', to: '/admin/bookings', icon: CalendarCheck },
  { label: 'Open availability', detail: 'Blocks and maintenance calendar', to: '/admin/calendar', icon: CalendarRange },
  { label: 'Log fleet service', detail: 'Odometer, workshop history and due dates', to: '/admin/maintenance', icon: Wrench },
  { label: 'Add a vehicle', detail: 'Fleet catalogue', to: '/admin/fleet', icon: Car },
  { label: 'Create a promo code', detail: 'Offers in Pricing & promos', to: '/admin/pricing', icon: Plus },
];

const PALETTE_GROUPS = {
  booking: 'Bookings',
  vehicle: 'Fleet',
  customer: 'Customers',
  page: 'Pages',
  action: 'Actions',
};

/**
 * Turn a staff search result into palette entries. Every field the adapter can
 * match on is repeated in `keywords` so the palette's local filter never hides
 * a row the server already matched (e.g. a plate match shown as the vehicle name).
 */
const buildRecordItems = ({ bookings = [], vehicles = [], customers = [] } = {}) => [
  ...bookings.map((booking) => ({
    label: booking.code,
    detail: [booking.customerName, booking.vehicleName, booking.startDate ? shortDate(booking.startDate) : '']
      .filter(Boolean).join(' · '),
    keywords: `${booking.code} ${booking.customerName} ${booking.vehicleName}`,
    to: `/admin/bookings?code=${encodeURIComponent(booking.code)}`,
    icon: CalendarCheck,
    group: 'booking',
  })),
  ...vehicles.map((vehicle) => ({
    label: vehicle.name,
    detail: [vehicle.registrationNumber, vehicle.location].filter(Boolean).join(' · ')
      || (vehicle.status === 'maintenance' ? 'In maintenance' : 'Fleet vehicle'),
    keywords: `${vehicle.name} ${vehicle.registrationNumber} ${vehicle.location}`,
    to: `/admin/fleet?vehicle=${encodeURIComponent(vehicle.id)}`,
    icon: Car,
    group: 'vehicle',
  })),
  ...customers.map((person) => ({
    label: person.name,
    detail: person.email || 'Customer',
    keywords: `${person.name} ${person.email}`,
    to: `/admin/customers?q=${encodeURIComponent(person.email || person.name)}`,
    icon: Users,
    group: 'customer',
  })),
];

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartLine },
  { to: '/admin/calendar', label: 'Availability', icon: CalendarRange },
  { to: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
  { to: '/admin/desk', label: 'Desk', icon: ClipboardCheck },
  { to: '/admin/comms', label: 'Comms', icon: Mail, adminOnly: true },
  { to: '/admin/finance', label: 'Finance & GST', icon: IndianRupee, adminOnly: true },
  { to: '/admin/fleet', label: 'Fleet', icon: Car },
  { to: '/admin/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/admin/pricing', label: 'Pricing & promos', icon: CreditCard },
  { to: '/admin/content', label: 'Content', icon: FileText, adminOnly: true },
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox },
  { to: '/admin/reviews', label: 'Reviews', icon: Star },
  { to: '/admin/locations', label: 'Locations', icon: MapPin },
  { to: '/admin/customers', label: 'Customers', icon: Contact },
  { to: '/admin/users', label: 'Users', icon: Users, adminOnly: true },
  { to: '/admin/audit', label: 'Audit log', icon: ShieldCheck, adminOnly: true },
  { to: '/admin/settings', label: 'Settings', icon: Settings, adminOnly: true },
];

export default function AdminLayout() {
  const { user, isAdmin, isDemo, signOut } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newMessages, setNewMessages] = useState(0);
  const [records, setRecords] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);
  const searchSeq = useRef(0);

  // Debounced staff search behind the palette. The sequence guard drops a slow
  // response that lands after the operator has typed something else.
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);
  const onPaletteQuery = (value) => {
    const term = String(value || '').trim();
    window.clearTimeout(searchTimer.current);
    searchSeq.current += 1;
    const seq = searchSeq.current;
    if (term.length < 2) {
      setRecords([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      try {
        const found = await api.adminSearch({ query: term, limit: 5 });
        if (seq !== searchSeq.current) return;
        setRecords(buildRecordItems(found));
      } catch {
        // A type-ahead must never interrupt the operator; pages still match.
        if (seq === searchSeq.current) setRecords([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 180);
  };

  // Unread inbox badge. Loaded once per console session and refreshed whenever
  // the Inbox page mutates a message, so the sidebar never nags about a note
  // the operator has already triaged.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const rows = await api.adminContactMessages();
        if (alive) setNewMessages(rows.filter((row) => row.status === 'new').length);
      } catch {
        // A background badge must never interrupt the operator.
      }
    };
    refresh();
    const onChanged = () => refresh();
    window.addEventListener('rove:inbox-changed', onChanged);
    return () => {
      alive = false;
      window.removeEventListener('rove:inbox-changed', onChanged);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
    setPaletteOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const links = NAV.filter((item) => !item.adminOnly || isAdmin);
  const currentLabel = NAV.find((item) => item.to === location.pathname)?.label || 'Console';
  const paletteItems = [
    ...records,
    ...links.map((item) => ({ label: item.label, detail: 'Console page', to: item.to, icon: item.icon, group: 'page' })),
    ...PALETTE_ACTIONS.map((item) => ({ ...item, group: 'action' })),
  ];

  const handleSignOut = async () => {
    await signOut();
    push('Signed out of the console.', 'success');
    navigate('/');
  };

  return (
    <div className="admin-shell min-h-screen">
      {/* Sidebar ------------------------------------------------------------- */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-hidden bg-gradient-to-b from-ink via-ink to-forest shadow-[24px_0_70px_-50px_rgba(10,15,11,0.8)] transition-transform duration-300 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-1 shrink-0 bg-gradient-to-r from-lime via-aqua to-coral" />
        <div className="pointer-events-none absolute -left-16 top-24 h-48 w-48 rounded-full bg-lime/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-16 h-52 w-52 rounded-full bg-aqua/10 blur-3xl" />
        <div className="relative flex items-center justify-between px-5 py-5">
          <Logo dark />
          <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-cream/60 hover:bg-white/10 lg:hidden" aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
        {isDemo && (
          <div className="relative mx-4 mb-4 rounded-xl border border-lime/25 bg-lime/10 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-lime">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" /> Demo console
            </p>
            <p className="mt-0.5 text-[0.6rem] leading-4 text-cream/50">Data lives in this browser.</p>
          </div>
        )}

        <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <p className="px-2.5 pb-2 pt-1 text-[0.55rem] font-extrabold uppercase tracking-[0.18em] text-cream/30">Workspace</p>
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `admin-nav ${isActive ? 'active' : ''}`}>
              <item.icon className="h-4 w-4" /> {item.label}
              {item.to === '/admin/inbox' && newMessages > 0 && (
                <span
                  className="ml-auto inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-lime px-1.5 py-0.5 text-[0.55rem] font-extrabold text-ink"
                  title={`${newMessages} new message${newMessages === 1 ? '' : 's'}`}
                >
                  {newMessages > 99 ? '99+' : newMessages}
                  <span className="sr-only"> new message{newMessages === 1 ? '' : 's'}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <Link to="/" className="admin-nav mb-2">
            <ExternalLink className="h-4 w-4" /> View customer site
          </Link>
          <div className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3">
            <Avatar name={user?.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.72rem] font-extrabold text-cream">{user?.name}</p>
              <p className="truncate text-[0.58rem] text-cream/55">{roleLabel[user?.role]}</p>
            </div>
            <button type="button" onClick={handleSignOut} className="rounded-full p-1.5 text-cream/50 transition hover:bg-white/10 hover:text-cream" aria-label="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {open && <button type="button" className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu overlay" />}

      {/* Main ---------------------------------------------------------------- */}
      <div className="lg:pl-64">
        <a href="#admin-content" className="skip-to-content">Skip to main content</a>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line/80 bg-paper/85 px-4 shadow-[0_12px_36px_-34px_rgba(10,15,11,0.45)] backdrop-blur-xl sm:px-6">
          <button type="button" onClick={() => setOpen(true)} className="rounded-full p-2 text-ink hover:bg-white lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-1.5 text-xs lg:hidden">
            <Logo compact />
          </div>
          <div className="hidden min-w-0 items-center gap-2 text-[0.68rem] lg:flex">
            <span className="font-bold uppercase tracking-[0.14em] text-muted">Console</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted/60" />
            <span className="truncate font-extrabold text-ink">{currentLabel}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[0.62rem] font-bold text-muted transition hover:border-ink hover:text-ink sm:inline-flex"
              aria-label="Search the console"
              title="Search the console (⌘K)"
            >
              <Search className="h-3 w-3" />
              <span className="hidden md:inline">Search</span>
              <Kbd className="hidden lg:inline">⌘K</Kbd>            </button>
            {isDemo && (
              <span className="hidden items-center gap-1.5 rounded-full border border-lime-deep/25 bg-lime/15 px-2.5 py-1 text-[0.56rem] font-extrabold uppercase tracking-wider text-forest sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-deep" /> Demo data
              </span>
            )}
            <Link to="/" className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[0.62rem] font-bold text-muted transition hover:border-ink hover:text-ink lg:inline-flex">
              <ExternalLink className="h-3 w-3" /> Customer site
            </Link>
            {isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[0.56rem] font-extrabold uppercase tracking-wider text-lime">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
          </div>
        </header>

        <main id="admin-content" tabIndex={-1} className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div key={location.pathname} className="page-enter"><Outlet /></div>
          <ScrollToTop />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        title="Search the console"
        placeholder="Search bookings, cars, people or pages…"
        emptyText="No bookings, cars, people or pages match “{query}”."
        groupLabels={PALETTE_GROUPS}
        onQueryChange={onPaletteQuery}
        loading={searching}
        searchingLabel="Searching records…"
      />
    </div>
  );
}
