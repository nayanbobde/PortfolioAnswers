/**
 * Service Worker — Interview Prep PWA
 * ------------------------------------------------------------------
 * Works on GitHub Pages whether the site is served from the domain
 * root (https://username.github.io) or a project sub-path
 * (https://username.github.io/repo-name/) because every path below
 * is resolved *relative to this file's own location* using
 * `self.registration.scope`, never a hard-coded absolute path.
 *
 * BUMP THIS VERSION STRING ON EVERY DEPLOY.
 * Changing it produces a new cache name, which is what makes the
 * "new version available" update flow (see registration code) fire.
 */
const VERSION = 'v1.0.0';

const STATIC_CACHE = `interview-prep-static-${VERSION}`;
const RUNTIME_CACHE = `interview-prep-runtime-${VERSION}`;

// Resolve every precache URL relative to the SW's own scope so it
// works at "/" or "/repo-name/" without any code changes.
const SCOPE = self.registration.scope;
const asset = (path) => new URL(path, SCOPE).toString();

const PRECACHE_URLS = [
  asset('./'),               // resolves to the start_url (index.html) via server default doc
  asset('./index.html'),
  asset('./manifest.json'),
  asset('./icons/icon-192.png'),
  asset('./icons/icon-512.png'),
  asset('./icons/icon-192-maskable.png'),
  asset('./icons/icon-512-maskable.png'),
  asset('./icons/apple-touch-icon.png'),
  asset('./icons/favicon-32.png'),
  asset('./icons/favicon-16.png'),
];

// ---------------------------------------------------------------
// INSTALL — precache the app shell
// ---------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // addAll fails atomically if any single request fails, so add
      // resiliently one-by-one instead — a missing icon shouldn't
      // block the whole app from being installable offline.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            console.warn('[SW] Precache failed for', url, err);
          }
        })
      );
    })()
  );
  // Do NOT auto skipWaiting here — we want the "update available"
  // prompt (driven by registration.js) to control activation.
});

// ---------------------------------------------------------------
// ACTIVATE — clean up old caches, take control of open clients
// ---------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------
// MESSAGE — allow the page to trigger activation of a waiting SW
// ---------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---------------------------------------------------------------
// FETCH — routing strategy
// ---------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let everything else
  // (cross-origin, POST, etc.) pass through untouched.
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Navigations (loading/reloading the app shell): network-first so
  // users on a live connection always get the latest deployed build,
  // falling back to the cached shell the instant they go offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets (icons, manifest, css/js if ever split out):
  // cache-first for speed, refreshed quietly in the background.
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(request);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last-resort offline fallback: the app shell itself.
    const shell = await cache.match(asset('./index.html'));
    if (shell) return shell;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached); // offline: fall back to cache if the fetch fails

  return cached || networkFetch;
}
