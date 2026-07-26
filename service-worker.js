// Service Worker for WOW-CSG 7 Days Fitness Challenge
// Bump CACHE_NAME whenever HTML/JS content changes so clients drop stale pages.
const CACHE_NAME = 'wowcsg-fitness-v58';
const urlsToCache = [
  './styles.css',
  './ui-refresh.css',
  './manifest.json',
  './favicon.svg',
  './brand-mark.svg',
  './security-config.js',
  './CSG_Logo_K_outline.jpg'
];

let trackingHeartbeatId = null;

function stopTrackingHeartbeat() {
  if (trackingHeartbeatId) {
    clearInterval(trackingHeartbeatId);
    trackingHeartbeatId = null;
  }
}

function startTrackingHeartbeat() {
  stopTrackingHeartbeat();
  // Slower ping: less wake-ups = less battery; still enough for treadmill time credit
  trackingHeartbeatId = setInterval(() => {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'TRACKING_TICK', t: Date.now() });
      });
    });
  }, 5000);
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'TRACKING_START') {
    startTrackingHeartbeat();
  } else if (data.type === 'TRACKING_STOP') {
    stopTrackingHeartbeat();
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .catch((error) => console.error('Cache installation failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Network-first for HTML/JS so challenge updates are never stuck behind old cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isHtmlOrJs =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('/');

  if (!isSameOrigin) {
    return;
  }

  if (isHtmlOrJs) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
      );
    })
  );
});
