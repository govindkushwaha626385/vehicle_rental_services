import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck, Bell, CalendarDays, ChevronDown, Heart, LayoutDashboard, LogOut, Menu, Phone,
  Search, ShieldCheck, Sparkles, User, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import SiteCommandPalette from './SiteCommandPalette.jsx';
import { Avatar, DemoBadge, Kbd, Logo } from './ui.jsx';
import { cn } from '../lib/format.js';
import { getSiteContent } from '../lib/site.js';

export default function Navbar() {
  const { user, isStaff, isDemo, signOut } = useAuth();
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const { push } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!user || typeof api.unreadNotificationCount !== 'function') {
      setUnread(0);
      return undefined;
    }
    let alive = true;
    api.unreadNotificationCount()
      .then((count) => { if (alive) setUnread(Number(count) || 0); })
      .catch(() => { if (alive) setUnread(0); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, location.pathname]);

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    const onPointer = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      push('Signed out. See you on the next trip.', 'success');
      navigate('/');
    } catch (error) {
      push(error.message, 'error');
    }
  };

  const sectionActive = (to) => {
    if (to === '/browse') return location.pathname === '/browse';
    if (!to.startsWith('/#')) return location.pathname === to;
    return location.pathname === '/' && location.hash === to.slice(1);
  };

  return (
    <>
    <a href="#main-content" className="skip-to-content">Skip to main content</a>
    <header className="sticky top-0 z-50">
      <div className="relative overflow-hidden border-b border-white/10 bg-ink text-cream">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(217,247,95,0.08),transparent_35%,rgba(132,223,242,0.08))]" />
        <div className="container-x relative flex h-9 items-center justify-between gap-6 text-[0.6rem] font-semibold">
          <div className="flex min-w-0 items-center gap-5">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-cream/75">
              <Sparkles className="h-3 w-3 text-lime" /> {content.announcement_primary}
            </span>
            <span className="hidden items-center gap-1.5 whitespace-nowrap text-cream/75 sm:inline-flex">
              <ShieldCheck className="h-3 w-3 text-aqua" /> {content.policy.fullRefundCopy}
            </span>
            {content.announcement_tertiary && (
              <span className="hidden items-center gap-1.5 whitespace-nowrap text-cream/75 lg:inline-flex">
                <BadgeCheck className="h-3 w-3 text-sun" /> {content.announcement_tertiary}
              </span>
            )}
          </div>
          <a
            href={`tel:${String(content.support_phone).replace(/[^\d+]/g, '')}`}
            className="hidden shrink-0 items-center gap-1.5 text-cream/65 transition hover:text-lime sm:inline-flex"
          >
            <Phone className="h-3 w-3" /> {content.support_phone}
          </a>
        </div>
      </div>

      <div className="border-b border-ink/[0.07] bg-cream/82 shadow-[0_10px_40px_-32px_rgba(10,15,11,0.55)] backdrop-blur-2xl supports-[backdrop-filter]:bg-cream/72">
        <div className="container-x flex h-[4.5rem] items-center gap-6">
        <div className="flex items-center gap-2">
          <Logo />
          {isDemo && <DemoBadge />}
        </div>

        <nav className="ml-4 hidden items-center gap-7 lg:flex" aria-label="Primary">
          {content.nav_links.map((link) => (
            <NavLink
              key={link.label}
              to={link.to}
              className={({ isActive }) => cn('nav-link', (isActive && link.to === '/browse') || sectionActive(link.to) ? 'active' : '')}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-1.5 rounded-full border border-line bg-white/60 px-2.5 py-2 text-[0.66rem] font-bold text-ink/65 transition hover:bg-white hover:text-ink md:inline-flex"
            aria-label={content.palette_button}
            aria-keyshortcuts="Meta+K Control+K"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{content.palette_button}</span>
            <Kbd className="hidden lg:inline">⌘K</Kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-full p-2 text-ink/70 transition hover:bg-white hover:text-ink md:hidden"
            aria-label={content.palette_button}
            aria-keyshortcuts="Meta+K Control+K"
          >
            <Search className="h-[1.15rem] w-[1.15rem]" />
          </button>

          {user && (
            <Link
              to="/account?tab=saved"
              className="hidden rounded-full p-2.5 text-ink/65 transition hover:bg-white hover:text-ink sm:inline-flex"
              aria-label="Saved vehicles"
            >
              <Heart className="h-[1.15rem] w-[1.15rem]" />
            </Link>
          )}

          {user && (
            <Link
              to="/account?tab=notifications"
              className="relative hidden rounded-full p-2.5 text-ink/65 transition hover:bg-white hover:text-ink sm:inline-flex"
              aria-label="Notifications"
            >
              <Bell className="h-[1.15rem] w-[1.15rem]" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-lime text-[0.56rem] font-extrabold text-ink ring-2 ring-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          )}

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="flex items-center gap-2 rounded-full border border-transparent p-1 pr-2 transition hover:border-line hover:bg-white"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <Avatar name={user.name} size="sm" />
                <span className="hidden max-w-[7rem] truncate text-xs font-bold sm:block">{user.name.split(' ')[0]}</span>
                <ChevronDown className={cn('hidden h-3.5 w-3.5 text-muted transition sm:block', menuOpen && 'rotate-180')} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+0.65rem)] w-64 overflow-hidden rounded-2xl border border-line bg-paper p-2 shadow-2xl animate-rise" role="menu">
                  <div className="rounded-xl bg-white px-3 py-2.5">
                    <p className="truncate text-sm font-bold">{user.name}</p>
                    <p className="truncate text-[0.7rem] text-muted">{user.email}</p>
                    <span className="mt-1.5 inline-flex rounded-full bg-sand px-2 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-ink/70">
                      {user.role === 'admin' ? 'Super admin' : user.role === 'manager' ? 'Fleet manager' : 'Customer'}
                    </span>
                  </div>
                  <Link to="/account" className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-white" role="menuitem">
                    <CalendarDays className="h-4 w-4 text-muted" /> My trips
                  </Link>
                  <Link to="/account?tab=notifications" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-white" role="menuitem">
                    <Bell className="h-4 w-4 text-muted" /> Notifications
                    {unread > 0 && <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-lime text-[0.56rem] font-extrabold text-ink">{unread > 9 ? '9+' : unread}</span>}
                  </Link>
                  <Link to="/account?tab=saved" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-white" role="menuitem">
                    <Heart className="h-4 w-4 text-muted" /> Saved vehicles
                  </Link>
                  <Link to="/account?tab=profile" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-white" role="menuitem">
                    <User className="h-4 w-4 text-muted" /> Profile
                  </Link>
                  {isStaff && (
                    <Link to="/admin" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-forest transition hover:bg-lime/30" role="menuitem">
                      <LayoutDashboard className="h-4 w-4" /> Admin console
                    </Link>
                  )}
                  <div className="my-1 h-px bg-line" />
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                    role="menuitem"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="hidden text-xs font-bold text-ink/70 transition hover:text-ink sm:block">
              Sign in
            </Link>
          )}

          <Link to="/browse" className="btn btn-dark btn-sm">
            {content.nav_cta_label}
          </Link>

          <button
            type="button"
            className="rounded-full p-2 text-ink transition hover:bg-white lg:hidden"
            onClick={() => setMobileOpen((current) => !current)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="absolute inset-x-0 top-full overflow-hidden border-b border-line bg-paper/98 shadow-2xl backdrop-blur-2xl lg:hidden">
          <div className="h-1 bg-gradient-to-r from-lime via-aqua to-coral" />
          <div className="px-5 pb-6 pt-4">
            <button
              type="button"
              onClick={() => { setMobileOpen(false); setPaletteOpen(true); }}
              className="mb-3 flex w-full items-center gap-2 rounded-2xl border border-line bg-white px-3.5 py-3 text-left text-sm font-bold text-ink transition hover:border-ink"
            >
              <Search className="h-4 w-4 text-muted" />
              {content.palette_button}
              <Kbd className="ml-auto">⌘K</Kbd>
            </button>
            <nav className="flex flex-col" aria-label="Mobile">
              {content.nav_links.map((link) => (
                <Link
                  key={link.label}
                  to={link.to}
                  className={cn(
                    'group flex items-center justify-between border-b border-line/70 py-3.5 text-sm font-bold',
                    sectionActive(link.to) ? 'text-forest' : 'text-ink'
                  )}
                >
                  {link.label}
                  <ChevronDown className="h-4 w-4 -rotate-90 text-muted transition group-hover:translate-x-1 group-hover:text-ink" />
                </Link>
              ))}
              {isStaff && (
                <Link to="/admin" className="flex items-center justify-between border-b border-line/70 py-3.5 text-sm font-bold text-forest">
                  <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Admin console</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </Link>
              )}
            </nav>
            <div className="mt-5 flex items-center gap-3">
              {user ? (
                <>
                  <Link to="/account" className="btn btn-white flex-1">My account</Link>
                  <button type="button" onClick={handleSignOut} className="btn btn-outline">Sign out</button>
                </>
              ) : (
                <>
                  <Link to="/login" className="btn btn-white flex-1">Sign in</Link>
                  <Link to="/register" className="btn btn-lime flex-1">Create account</Link>
                </>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-cream">
              <p className="text-[0.68rem] leading-4 text-cream/60">Questions? A real person can help.</p>
              <a href={`tel:${String(content.support_phone).replace(/[^\d+]/g, '')}`} className="inline-flex shrink-0 items-center gap-1.5 text-[0.7rem] font-bold text-lime">
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
            </div>
            {isDemo && (
              <p className="mt-4 text-[0.68rem] leading-5 text-muted">
                Demo mode is active. <Link to="/login" className="font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">Open sign in</Link> to try a customer, manager or admin account.
              </p>
            )}
          </div>
        </div>
      )}
    </header>
    <SiteCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
