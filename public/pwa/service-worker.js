const CACHE_VERSION = 'campus-pwa-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/pwa/pwa.css',
  '/pwa/pwa-register.js',
  '/pwa/icon.svg',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/apple-touch-icon.png',
  '/app-assets/session.js',
  '/js/notifications.js'
];

const PUBLIC_NAVIGATION_PATHS = new Set(['/', '/index.html', '/login.html']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/pwa/') ||
    pathname.startsWith('/app-assets/') ||
    pathname.startsWith('/js/') ||
    /\.(?:css|js|png|svg|jpg|jpeg|webp|gif|woff2?)$/i.test(pathname) ||
    pathname === '/manifest.webmanifest'
  );
}

async function handleStaticAsset(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    void fetch(request)
      .then((response) => {
        if (response && response.ok) {
          return cache.put(request, response.clone());
        }
        return null;
      })
      .catch(() => null);
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function handleNavigation(request) {
  const url = new URL(request.url);

  if (!PUBLIC_NAVIGATION_PATHS.has(url.pathname)) {
    try {
      return await fetch(request);
    } catch (error) {
      return caches.match(OFFLINE_URL);
    }
  }

  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return cache.match(request) || caches.match(url.pathname) || caches.match(OFFLINE_URL);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(handleStaticAsset(request));
  }
});
