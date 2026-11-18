/**
 * Per-device saved searches for Browse. Each entry holds the query-string
 * params plus a human summary; applying one rehydrates the Browse state.
 */

const KEY = 'rove_saved_searches_v1';
export const SAVED_SEARCH_MAX = 8;

const newId = () => `sv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export function listSavedSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && item.id && typeof item.label === 'string' && item.label.trim() && typeof item.params === 'string')
      .map((item) => ({ ...item, filters: typeof item.filters === 'string' ? item.filters : '' }))
      .slice(0, SAVED_SEARCH_MAX);
  } catch {
    return [];
  }
}

export function saveSearch({ label = '', params = '', summary = '', filters = '' }) {
  label = label.trim();
  const current = listSavedSearches();
  if (!label || !params) return { ok: false, limit: false, items: current };
  // Two searches are duplicates only when BOTH the URL params and the full
  // filter set match — e.g. the same dates with a different price cap are two
  // genuinely different saved views.
  const same = (item) => item.params === params && (item.filters ?? '') === filters;
  if (current.some(same)) {
    return { ok: false, limit: false, duplicate: true, items: current };
  }
  if (current.length >= SAVED_SEARCH_MAX) {
    return { ok: false, limit: true, items: current };
  }
  const items = [...current, { id: newId(), label, params, summary: summary.trim(), filters, at: Date.now() }];
  writeSearches(items);
  return { ok: true, limit: false, items };
}

export function deleteSavedSearch(id) {
  const items = listSavedSearches().filter((item) => item.id !== id);
  writeSearches(items);
  return items;
}

export function clearSavedSearches() {
  writeSearches([]);
}

function writeSearches(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, SAVED_SEARCH_MAX)));
  } catch {
    /* storage unavailable — saved searches simply do not persist */
  }
}