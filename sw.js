const CACHE_VERSION = 'devdad-shell-v7';
const APP_SHELL = '/devdad-app.html';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/devdad-landing.html',
  '/app',
  APP_SHELL,
  '/quiz.html',
  '/privacy.html',
  '/terms.html',
  '/manifest.json',
  '/icons/site.webmanifest',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-96x96.png',
  '/icons/web-app-manifest-192x192.png',
  '/icons/web-app-manifest-512x512.png',
  '/site-images/pushup.JPG',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;
  if (url.pathname.startsWith('/cdn-cgi/')) return;

  if (request.mode === 'navigate') {
    const shouldCacheNavigation = !url.search;
    const cacheKey = shouldCacheNavigation ? request : url.pathname;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok || response.type === 'opaque') {
            return response;
          }

          if (shouldCacheNavigation) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(cacheKey, clone)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(cacheKey);
          if (cached) return cached;
          return (await caches.match(APP_SHELL)) || caches.match('/app');
        })
    );
    return;
  }

  const isStaticAsset = ['style', 'script', 'image', 'font'].includes(request.destination) ||
    url.pathname.startsWith('/icons/');

  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then(async (cached) => {
      const networkPromise = fetch(request)
        .then((response) => {
          if (!response.ok || response.type === 'opaque') {
            return response;
          }

          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone)).catch(() => {});
          return response;
        })
        .catch(() => cached);

      return cached || networkPromise;
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      body: event.data ? event.data.text() : ''
    };
  }

  const hasStructuredPayload = Boolean(payload && typeof payload === 'object' && Object.keys(payload).length);
  const fallbackTag = `devdad-reminder-${Date.now()}`;

  const title = payload.title || 'DevDad reminder';
  const options = {
    body: payload.body || 'Open DevDad to keep your plan moving today.',
    icon: payload.icon || '/icons/web-app-manifest-192x192.png',
    badge: payload.badge || '/icons/favicon-96x96.png',
    tag: payload.tag || fallbackTag,
    renotify: hasStructuredPayload ? Boolean(payload.renotify) : true,
    data: {
      url: payload.url || '/app'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification?.data?.url || '/app', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (!client.url.startsWith(self.location.origin)) continue;

        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl);
        }

        if ('focus' in client) {
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});
