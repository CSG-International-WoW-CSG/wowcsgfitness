// Service Worker for WOW-CSG 7 Days Fitness Challenge
const CACHE_NAME = 'stepathon-v4';
const urlsToCache = [
  './',
  './index.html',
  './admin.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './firebase-config.js',
  './favicon.svg',
  './CSG_Logo_K_outline.jpg'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Cache installation failed:', error);
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request).then((response) => {
          // Don't cache external resources or API calls
          if (!event.request.url.startsWith('http') || 
              event.request.url.includes('cdn.jsdelivr.net') ||
              event.request.url.includes('fonts.googleapis.com') ||
              event.request.url.includes('api.')) {
            return response;
          }
          
          // Clone the response
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
        .catch(() => {
        // If both cache and network fail, return offline page if available
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      })
  );
});

// Background sync for offline step entries (if needed)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-steps') {
    event.waitUntil(syncSteps());
  }
});

function syncSteps() {
  // Implement offline step synchronization
  return Promise.resolve();
}

