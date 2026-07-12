// cockpit-sw.js — minimaler PWA-Service-Worker für das GS-Cockpit.
// Zweck: macht die App auf Android installierbar (fetch-Handler ist Pflicht für
// den Install-Prompt) und cacht die Shell für schnellen, app-artigen Start.
// WICHTIG: /api/* wird NIE gecacht → Jarvis/Cockpit zeigen immer Live-Daten.
const CACHE = 'gs-cockpit-v11';
const SHELL = [
  '/gs-intern-7k2x',
  '/cockpit-manifest.json',
  '/cockpit-icon-192.png',
  '/cockpit-icon-512.png',
  '/cockpit-icon-180.png',
  '/cockpit-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // POST (Jarvis/Voice/Auth) durchlassen
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== location.origin) return;       // fremde Hosts (ElevenLabs/Claude) nie anfassen
  if (url.pathname.startsWith('/api/')) return;      // API immer live, nie aus Cache

  // Cockpit-HTML (Route ODER Datei) IMMER frisch vom Server: network-first, Cache
  // nur als Offline-Fallback. Verhindert, dass der Browser an einer alten
  // gs-intern.html haengt (Ursache des verschwundenen Übersicht-Features).
  const isCockpitHtml = url.pathname === '/gs-intern-7k2x' || url.pathname === '/gs-intern.html';

  // Navigation ODER Cockpit-HTML → network-first, Fallback Shell (App startet auch offline).
  if (req.mode === 'navigate' || isCockpitHtml) {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match('/gs-intern-7k2x')))
    );
    return;
  }

  // Statische Assets (Icons/Manifest) → cache-first, sonst Netz (und nachcachen).
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((r) => {
      if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    }))
  );
});
