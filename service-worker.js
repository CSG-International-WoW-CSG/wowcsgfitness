// Service Worker for WOW-CSG 7 Days Fitness Challenge
// v67: do NOT intercept navigations / HTML / JS (prevents mobile Chrome crash loops).
const CACHE_NAME = 'wowcsg-fitness-v67';
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
            return caches.delete(cacheName);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Critical: never touch navigations or script/document responses.
  // Intercepting these caused "Can't open this page" / Safari crash loops on phones.
  if (
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    event.request.destination === 'script' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/wowcsgfitness')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }).catch(() => cached)
      );
    })
  );
});
