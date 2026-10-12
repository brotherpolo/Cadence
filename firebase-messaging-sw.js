/* Cadence — service worker for push notifications.
   Firebase Cloud Messaging hands each push to this file, even when no Cadence
   tab is open. It shows the notification and, when it's tapped, opens the app
   (or brings an open one to the front) on the task it's about.
   It caches nothing, so app updates are never held back by it. */
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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
