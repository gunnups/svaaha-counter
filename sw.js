// Keeps the app working with no internet (e.g. weak signal in the hall).
// Bump VERSION whenever any app file changes so phones pick up the update.
const VERSION = 'svaha-v10';
const FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/audio.js',
  './js/capture-worklet.js',
  './js/detector.js',
  './js/engine.js',
  './js/features.js',
  './js/recorder.js',
  './js/store.js',
  './js/templates.js',
  './js/wave.js',
  './js/wave-view.js',
  './img/gayatri.jpg',
  './img/apple-touch-icon.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive), falling back to the saved copy when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
