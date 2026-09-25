/* Revisa Residência — service worker (app shell offline) */
const VERSION = 'revisa-v4.0.0';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './assuntos-iniciais.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('cdn.jsdelivr.net');
  if (isFont) {
    // fontes: cache first, rede como complemento
    e.respondWith(
      caches.open(VERSION + '-fonts').then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
        catch (err) { return new Response('', { status: 503 }); }
      })
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // app shell: rede primeiro (para pegar atualizações), cache como fallback
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
