// Appearance tokens controlled from Admin → Settings → Appearance.
// Tailwind v4 emits utilities as `var(--color-lime)` / `var(--radius-3xl)`,
// so overriding those custom properties on <html> repaints the whole app.

export const THEME_ACCENTS = Object.freeze({
  lime: { label: 'Lime', accent: '#d9f75f', deep: '#b8dc2e' },
  ember: { label: 'Ember', accent: '#ff9447', deep: '#f2740f' },
  glacier: { label: 'Glacier', accent: '#83e7ff', deep: '#2fc3e8' },
  signal: { label: 'Signal', accent: '#ff7c6b', deep: '#ee4a37' },
  gold: { label: 'Gold', accent: '#ffd76b', deep: '#eab308' },
  violet: { label: 'Violet', accent: '#b8a8ff', deep: '#8f7bff' },
});

export const THEME_RADII = Object.freeze({
  sharp: { label: 'Sharp', inner: '0.65rem', card: '0.9rem', panel: '1.15rem' },
  soft: { label: 'Soft', inner: '1rem', card: '1.5rem', panel: '2rem' },
  round: { label: 'Round', inner: '1.25rem', card: '2rem', panel: '2.75rem' },
});

export const THEME_MOTION = Object.freeze({
  full: { label: 'Full', detail: 'Tilt, rise and glide' },
  calm: { label: 'Calm', detail: 'No decorative motion' },
});

export const THEME_MODES = Object.freeze({
  light: { label: 'Light', detail: 'Light background — standard appearance' },
  dark: { label: 'Dark', detail: 'Dark background — reduced eye strain, modern look' },
});

export const THEME_DEFAULTS = Object.freeze({
  theme_accent: 'lime',
  theme_radius: 'soft',
  theme_motion: 'full',
  theme_mode: 'light',
});

export const ACCENT_OPTIONS = Object.entries(THEME_ACCENTS).map(([id, value]) => ({ id, ...value }));
export const RADIUS_OPTIONS = Object.entries(THEME_RADII).map(([id, value]) => ({ id, ...value }));
export const MOTION_OPTIONS = Object.entries(THEME_MOTION).map(([id, value]) => ({ id, ...value }));
export const MODE_OPTIONS = Object.entries(THEME_MODES).map(([id, value]) => ({ id, ...value }));

export function normalizeThemeSettings(settings) {
  const value = settings || {};
  return {
    theme_accent: THEME_ACCENTS[value.theme_accent] ? value.theme_accent : THEME_DEFAULTS.theme_accent,
    theme_radius: THEME_RADII[value.theme_radius] ? value.theme_radius : THEME_DEFAULTS.theme_radius,
    theme_motion: THEME_MOTION[value.theme_motion] ? value.theme_motion : THEME_DEFAULTS.theme_motion,
    theme_mode: THEME_MODES[value.theme_mode] ? value.theme_mode : THEME_DEFAULTS.theme_mode,
  };
}

export function resolveTheme(settings) {
  const normalized = normalizeThemeSettings(settings);
  return {
    accentId: normalized.theme_accent,
    accent: THEME_ACCENTS[normalized.theme_accent],
    radiusId: normalized.theme_radius,
    radius: THEME_RADII[normalized.theme_radius],
    motionId: normalized.theme_motion,
    motion: THEME_MOTION[normalized.theme_motion],
    modeId: normalized.theme_mode,
    mode: THEME_MODES[normalized.theme_mode],
  };
}

function rgba(hex, alpha) {
  const value = String(hex).replace('#', '');
  if (value.length !== 6) return `rgba(184, 220, 46, ${alpha})`;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyTheme(settings, root = typeof document === 'undefined' ? null : document.documentElement) {
  if (!root?.style) return resolveTheme(settings);
  const theme = resolveTheme(settings);

  root.style.setProperty('--color-lime', theme.accent.accent);
  root.style.setProperty('--color-lime-deep', theme.accent.deep);
  root.style.setProperty('--shadow-glow', `0 22px 70px -30px ${rgba(theme.accent.deep, 0.6)}`);
  root.style.setProperty('--radius-2xl', theme.radius.inner);
  root.style.setProperty('--radius-3xl', theme.radius.card);
  root.style.setProperty('--radius-4xl', theme.radius.panel);

  root.dataset.themeAccent = theme.accentId;
  root.dataset.themeRadius = theme.radiusId;
  root.dataset.motion = theme.motionId;

  // Apply dark mode by toggling a class on <html>. The CSS cascade flips
  // background/text colours across the entire app — no per-page overrides needed.
  if (theme.modeId === 'dark') {
    root.classList.add('theme-dark');
  } else {
    root.classList.remove('theme-dark');
  }

  return theme;
}

/**
 * Per-device appearance preference, set by the customer in Account → Appearance
 * and stored in localStorage. The admin default (theme_mode) applies when no
 * preference is stored. Uses the same key as the Account toggle.
 */
const THEME_PREF_KEY = 'rove_theme_mode';

export const readThemePreference = () => {
  try {
    const value = localStorage.getItem(THEME_PREF_KEY);
    return value === 'dark' || value === 'light' ? value : '';
  } catch {
    return '';
  }
};

export const writeThemePreference = (mode) => {
  if (mode !== 'dark' && mode !== 'light') return;
  try {
    localStorage.setItem(THEME_PREF_KEY, mode);
  } catch {
    /* storage can be unavailable in private mode */
  }
};
