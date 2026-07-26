// Service worker intentionally disabled (v69).
// Old registrations caused open → reload → crash on some phones.
// Page JS unregisters any SW; this file is a no-op if still hit.
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
self.addEventListener('fetch', () => {});
