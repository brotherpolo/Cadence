/* Cadence — web push notifications (Firebase Cloud Messaging).
   The browser side: ask permission, register the service worker, get this
   device's push token and keep it in notify/{uid}/devices/{deviceId}.
   The Cloud Functions in functions/ read those tokens and send the pushes.
   Settings → Notifications is the UI. */
(function () {
  const C = window.Cadence;
  const DEVICE_KEY = 'cadence.push.device';
  const DEFAULTS = { kind: 'notify', due: true, assigned: true, finished: true, digest: true, morning: '08:00', lead: 0 };
  const P = C.push = { ready: false, prefs: null, device: null, busy: false, error: null };

  const fb = () => C.firebaseSync;
  const vapid = () => window.CADENCE_VAPID_KEY || '';
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const deviceId = () => {
    let id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* blocked */ }
    if (!id) { id = C.uid('dev'); try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* blocked */ } }
    return id;
  };
  const label = () => {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isIOS() && !/iPhone/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return (standalone() ? 'Cadence app' : br) + ' on ' + os;
  };
  // the folder the app is served from, so links in notifications open this app
  const origin = () => location.origin + location.pathname.replace(/[^/]*$/, '');

  /** what Settings should say about this device */
  P.status = function () {
    const f = fb();
    if (!f || !f.enabled) return 'no-sync';
    if (!f.user) return 'signed-out';
    if (isIOS() && !standalone()) return 'ios-install';
    if (!supported()) return 'unsupported';
    if (!vapid()) return 'no-vapid';
    if (Notification.permission === 'denied') return 'blocked';
    if (P.device && Notification.permission === 'granted') return 'on';
    return 'off';
  };

  let refs = null, messaging = null, swReg = null, unsub = null;
  function paths() {
    const f = fb();
    const base = f.db.collection('notify').doc(f.user.uid);
    return { prefs: base, device: base.collection('devices').doc(deviceId()) };
  }
  const changed = () => { const v = C.views && C.views.settings; if (C.currentRoute === 'settings' && v && v.update) v.update(); };

  async function loadMessaging() {
    const f = fb();
    if (!window.firebase || !firebase.messaging) await f.load(f.SDK + 'firebase-messaging-compat.js');
    if (!messaging) messaging = f.app.messaging();
    if (!swReg) swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    return messaging;
  }
  async function token() {
    const m = await loadMessaging();
    return m.getToken({ vapidKey: vapid(), serviceWorkerRegistration: swReg });
  }
  // keep the time zone and app address current, so reminders come at the right local time
  function stamp() { return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', origin: origin(), updatedAt: Date.now() }; }

  /** after sign-in: load choices and this device's registration; refresh the token if it changed */
  P.start = async function () {
    const f = fb();
    if (!f || !f.enabled || !f.db || !f.user || P.ready) return;
    refs = paths();
    unsub = refs.prefs.onSnapshot((snap) => { P.prefs = Object.assign({}, DEFAULTS, snap.exists ? snap.data() : {}); P.ready = true; changed(); }, (e) => { P.error = e.message; changed(); });
    try { const d = await refs.device.get(); P.device = d.exists ? d.data() : null; } catch (e) { P.device = null; }
    changed();
    if (P.device && supported() && vapid() && Notification.permission === 'granted') {
      try {
        const t = await token();
        if (t && t !== P.device.token) { P.device = Object.assign({}, P.device, { token: t, updatedAt: Date.now() }); await refs.device.set(P.device); }
        if (P.prefs && (P.prefs.tz !== stamp().tz || P.prefs.origin !== origin())) await refs.prefs.set(Object.assign({ kind: 'notify' }, stamp()), { merge: true });
        listenForeground();
      } catch (e) { console.warn('Push token refresh failed:', e); }
    }
  };

  /** in a click handler: ask permission, register, save the token */
  P.enable = async function () {
    if (P.busy) return;
    P.busy = true; P.error = null; changed();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.' : 'Notifications weren’t allowed.');
      const t = await token();
      if (!t) throw new Error('This browser didn’t give a push token. Try again, or use another browser.');
      refs = refs || paths();
      P.device = { token: t, label: label(), createdAt: (P.device && P.device.createdAt) || Date.now(), updatedAt: Date.now() };
      await refs.device.set(P.device);
      await refs.prefs.set(Object.assign({}, P.prefs ? {} : DEFAULTS, { kind: 'notify' }, stamp()), { merge: true });
      listenForeground();
      C.toast('Notifications are on for this device');
    } catch (e) {
      P.error = friendly(e);
    } finally { P.busy = false; changed(); }
  };
  P.disable = async function () {
    if (P.busy) return;
    P.busy = true; changed();
    try {
      refs = refs || paths();
      await refs.device.delete();
      try { const m = await loadMessaging(); await m.deleteToken(); } catch (e) { /* already gone */ }
      P.device = null;
      C.toast('Notifications are off for this device');
    } catch (e) { P.error = friendly(e); } finally { P.busy = false; changed(); }
  };
  P.save = async function (patch) {
    refs = refs || paths();
    P.prefs = Object.assign({}, DEFAULTS, P.prefs, patch);
    changed();
    try { await refs.prefs.set(Object.assign({ kind: 'notify' }, patch, stamp()), { merge: true }); } catch (e) { P.error = friendly(e); changed(); }
  };
  /** the Cloud Function sends a test push when testAt changes */
  P.test = async function () {
    refs = refs || paths();
    try { await refs.prefs.set(Object.assign({ kind: 'notify', testAt: Date.now() }, stamp()), { merge: true }); C.toast('Test sent. It should arrive in a few seconds.'); }
    catch (e) { P.error = friendly(e); changed(); }
  };

  // while the app is open and in front, pushes arrive here instead of as a system notification
  let fgOn = false;
  function listenForeground() {
    if (fgOn || !messaging) return;
    fgOn = true;
    messaging.onMessage((m) => {
      const d = (m && m.data) || {};
      if (!d.title) return;
      C.toast(d.title + (d.body ? ' · ' + d.body.split('\n')[0] : ''), d.task ? { action: 'Open', onAction: () => C.openEditor(d.task) } : undefined);
    });
  }
  function friendly(e) {
    const m = (e && (e.code || e.message)) || String(e);
    if (/permission-denied|insufficient permissions/i.test(m)) return 'Firestore refused to save this device. Deploy the latest firestore.rules, then try again.';
    if (/messaging\/token-subscribe-failed|authentication credential/i.test(m)) return 'Firebase didn’t accept the push key. Check that CADENCE_VAPID_KEY in firebase-config.js matches Project settings → Cloud Messaging → Web Push certificates.';
    if (/unsupported-browser|not supported/i.test(m)) return 'This browser doesn’t support web push.';
    return e && e.message ? e.message : m;
  }

  /* a notification tapped while the app was closed opens it with ?task=ID */
  function openFromLink() {
    const q = new URLSearchParams(location.search), id = q.get('task');
    if (!id) return;
    q.delete('task');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    let tries = 0;
    const tick = () => { if (C.store && C.store.get(id)) return C.openEditor(id); if (++tries < 40) setTimeout(tick, 250); };
    tick();
  }
  // …and one tapped while the app is open sends a message from the service worker
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'cadence-open' && d.task) C.openEditor(d.task); });

  window.addEventListener('load', () => {
    openFromLink();
    const f = fb();
    if (!f || !f.enabled) return;
    // start once the account has connected (the store calls collection() itself; this waits for the same promise)
    f.collection().then(() => P.start()).catch(() => { /* sync shows the error */ });
  });
})();
