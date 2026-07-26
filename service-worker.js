// Service worker disabled for stability (v68).
// Mobile Chrome was open→reload→crash looping when SW controlled navigations.
// Keep this file so old registrations can update to a no-op and then be unregistered by the page.
const CACHE_NAME = 'wowcsg-fitness-v68-disabled';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Do not intercept any fetches.
self.addEventListener('fetch', () => {});
