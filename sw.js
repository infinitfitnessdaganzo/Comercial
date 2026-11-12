const CACHE_NAME = 'infinit-visitas-pwa-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=pwa-1',
  './app.js?v=pwa-1',
  './supabase-config.js',
  './manifest.webmanifest',
  './favicon.svg?v=4',
  './icon-192.png',
  './icon-512.png'
];
const SUPABASE_LIBRARY = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    try {
      await cache.add(new Request(SUPABASE_LIBRARY, { mode: 'cors' }));
    } catch {
      // La aplicación sigue pudiendo instalarse; sin esta librería hará falta internet.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('infinit-visitas-pwa-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (request.url.startsWith(SUPABASE_LIBRARY)) {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return (await cache.match(request)) || Response.error();
        }
      })());
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put('./index.html', response.clone());
        return response;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  })());
});

