export const SITE_NAME = 'Rove';
export const DEFAULT_TITLE = 'Rove — Premium self-drive rentals in India';
export const DEFAULT_DESCRIPTION =
  'Rent beautifully kept cars and bikes across India. Transparent all-in pricing, instant confirmation and flexible cancellation.';
export const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80';

const ensureMeta = (attribute, key, content) => {
  if (typeof document === 'undefined') return null;
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!content) {
    element?.remove();
    return null;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
  return element;
};

const absoluteImage = (image, fallback = DEFAULT_IMAGE) => {
  const raw = String(image || '').trim();
  if (!raw || raw.startsWith('data:')) return fallback;
  try {
    return new URL(raw, window.location.origin).href;
  } catch {
    return fallback;
  }
};

const ensureCanonical = () => {
  if (typeof document === 'undefined') return null;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  return link;
};

/**
 * Keep document metadata in sync with the active route. Private routes are
 * marked noindex, and canonical URLs never include query strings so filtered
 * fleet views do not fragment search equity.
 */
export function setPageMeta({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path,
  image,
  robots = 'index,follow',
  siteName = SITE_NAME,
  defaultImage = DEFAULT_IMAGE,
} = {}) {
  if (typeof document === 'undefined') return;

  document.title = title;
  ensureMeta('name', 'description', description);
  ensureMeta('property', 'og:title', title);
  ensureMeta('property', 'og:description', description);
  ensureMeta('property', 'og:type', 'website');
  ensureMeta('property', 'og:site_name', siteName);
  ensureMeta('name', 'twitter:card', 'summary_large_image');
  ensureMeta('name', 'twitter:title', title);
  ensureMeta('name', 'twitter:description', description);
  const socialImage = absoluteImage(image, defaultImage);
  ensureMeta('property', 'og:image', socialImage);
  ensureMeta('name', 'twitter:image', socialImage);
  ensureMeta('name', 'robots', robots);

  const canonical = ensureCanonical();
  if (!canonical) return;
  if (path && !robots.includes('noindex')) {
    const url = `${window.location.origin}${path}`;
    canonical.setAttribute('href', url);
    canonical.removeAttribute('data-disabled');
    ensureMeta('property', 'og:url', url);
  } else {
    canonical.removeAttribute('href');
    canonical.setAttribute('data-disabled', 'true');
    ensureMeta('property', 'og:url', null);
  }
}

export function setStructuredData(id, data) {
  if (typeof document === 'undefined') return;
  let script = document.getElementById(id);
  if (!data) {
    script?.remove();
    return;
  }
  if (!script) {
    script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}
