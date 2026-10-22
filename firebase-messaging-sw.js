/* Cadence — service worker for push notifications.
   Firebase Cloud Messaging hands each push to this file, even when no Cadence
   tab is open. It shows the notification and, when it's tapped, opens the app
   (or brings an open one to the front) on the task it's about.
   It also lets Cadence open with no signal (version 33): the app's files and the Firebase code
   are kept on the device after each visit with a signal. Page loads try the network first,
   so an update is never held back; the device copy opens only when there's no signal.
   Firestore keeps the tasks themselves (firebase-sync.js turns its offline copy on). */
self.window = self; // firebase-config.js sets window.CADENCE_FIREBASE_CONFIG
importScripts('firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const cfg = self.CADENCE_FIREBASE_CONFIG || (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);
const here = self.registration.scope; // the folder the app lives in

if (cfg && cfg.apiKey) {
  firebase.initializeApp(cfg);
  firebase.messaging().onBackgroundMessage((m) => {
    const d = (m && m.data) || {};
    if (!d.title) return;
    return self.registration.showNotification(d.title, {
      body: d.body || '',
      icon: here + 'icon-192.png',
      badge: here + 'badge-96.png',
      tag: d.tag || undefined,          // a newer reminder for the same task replaces the older one
      renotify: !!d.tag,
      data: { task: d.task || '', url: d.url || here }
    });
  });
}

const SHELL = 'cad-shell-v1';
const SDK_FILES = ['app', 'auth', 'firestore', 'messaging', 'app-check'].map((n) => 'https://www.gstatic.com/firebasejs/10.12.2/firebase-' + n + '-compat.js');
const EXTRA = ['manifest.webmanifest', 'favicon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'badge-96.png', 'firebase-config.js'];
let syncing = null;
/** Keep this version's files: what index.html loads (with their ?v=), a few extras, the Firebase code. */
function syncShell() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const page = await fetch(here, { cache: 'no-cache' });
      if (!page.ok) return;
      const html = await page.clone().text();
      const urls = new Set([here]);
      html.replace(/(?:src|href)="([^"#:]+)"/g, (m, u) => { urls.add(new URL(u, here).href); return m; });
      EXTRA.forEach((f) => urls.add(new URL(f, here).href));
      const cache = await caches.open(SHELL);
      await cache.put(here, page);
      for (const u of urls) {
        if (u === here) continue;
        if (/[?&]v=/.test(u) && (await cache.match(u))) continue; // a version's file doesn't change
        try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await cache.put(u, r); } catch (e) { /* next time */ }
      }
      for (const u of SDK_FILES) if (!(await cache.match(u))) { try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r); } catch (e) { /* next time */ } }
      // older versions' files go
      for (const q of await cache.keys()) if (q.url.startsWith(here) && !urls.has(q.url)) await cache.delete(q);
    } catch (e) { /* offline: next visit */ } finally { syncing = null; }
  })();
  return syncing;
}
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(syncShell()); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (req.mode === 'navigate' && url.startsWith(here)) {
    e.respondWith((async () => {
      try { const res = await Promise.race([fetch(req), timeout(6000)]); if (res.ok) e.waitUntil(syncShell()); return res; }
      catch (err) { const c = await caches.open(SHELL); return (await c.match(here)) || (await c.match(here + 'index.html')) || Response.error(); }
    })());
    return;
  }
  const sdk = SDK_FILES.includes(url);
  if (!sdk && !url.startsWith(here)) return; // Firestore, Google sign-in and the rest: the network
  if (url.endsWith('firebase-messaging-sw.js')) return;
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(url);
    if (hit && (sdk || /[?&]v=/.test(url))) return hit; // versioned: the device copy is the same file
    try { const res = await fetch(req); if (res.ok && (sdk || /[?&]v=/.test(url))) c.put(url, res.clone()); return res; }
    catch (err) { if (hit) return hit; throw err; }
  })());
});

self.addEventListener('notificationclick', (e) => {
  const d = (e.notification && e.notification.data) || {};
  if (!('url' in d)) return; // not one of ours
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(here));
    if (open) {
      await open.focus();
      if (d.task) open.postMessage({ type: 'cadence-open', task: d.task });
      return;
    }
    const url = new URL(d.url || here);
    if (d.task) url.searchParams.set('task', d.task);
    return self.clients.openWindow(url.href);
  })());
});
