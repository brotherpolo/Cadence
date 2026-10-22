/* Cadence lives at its Firebase Hosting address. The old GitHub Pages address forwards
   there, keeping links to a task (?task=), a record (?record=, ?addTaskFor=) and the page.
   (A file, not inline, so the site can refuse inline scripts.) */
(function () {
  var home = 'https://cadence-tasks.web.app/';
  if (/\.github\.io$/.test(location.hostname)) location.replace(home + location.search + location.hash);
})();

/* Your Light or Dark choice, applied before the page is drawn, so it never flashes the other one.
   Kept on its own (cadence.theme) so this doesn't read the whole task cache; the first time, it
   looks in the cache. "System" sets nothing and the page follows the device. */
(function () {
  try {
    var t = localStorage.getItem('cadence.theme');
    if (t === null) { var c = JSON.parse(localStorage.getItem('cadence.v1') || 'null'); t = c && c.prefs && c.prefs.theme; }
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.setAttribute('data-theme-early', '');
    }
  } catch (e) { /* storage blocked: the device's setting */ }
})();

/* Opening with no signal (version 33): the service worker keeps Cadence's files on this device
   after each visit with a signal (and shows push notifications, when they're on). */
(function () {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href) || /\.github\.io$/.test(location.hostname)) return;
  window.addEventListener('load', function () { navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' }).catch(function () { /* not supported here */ }); });
})();
