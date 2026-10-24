/* Cadence — problems: when something goes wrong in this browser (an error, a failed save), a
   short report goes to problems/{id} for Wayholm’s administrators (Settings → Problems).
   The same rules as Wayholm’s problemlogic.js: browser noise, extensions and a lost
   connection aren't reported; at most 15 per page load; the same one not again for 5 minutes.
   C.problems.from / C.problems.Throttle are the pure parts (tested in the browser tests). */
(function () {
  const C = window.Cadence;
  const NOISE = [
    /ResizeObserver loop/i, /^Script error\.?$/i, /AbortError|aborted a request|The operation was aborted/i,
    /Failed to fetch dynamically imported module|Importing a module script failed|Load failed$/i,
    /NetworkError when attempting to fetch|Failed to fetch$|net::ERR_/i, /Could not load Firebase/i,
    /Non-Error promise rejection captured/i, /cancelled by the user|The user denied|NotAllowedError/i,
  ];
  const OFFLINE = ['unavailable', 'deadline-exceeded', 'cancelled', 'auth/network-request-failed'];
  const cut = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  function from(input, ctx) {
    if (!ctx || !ctx.uid) return null;
    const err = input && input.error;
    const message = String((err && (err.message || (typeof err === 'string' ? err : ''))) || (input && input.message) || (err && err.code) || '').trim();
    if (!message || NOISE.some((r) => r.test(message))) return null;
    const code = err && typeof err.code === 'string' ? err.code : '';
    if (OFFLINE.includes(code) || ctx.online === false) return null;
    const src = String((input && input.source) || '');
    if (src && ctx.origin && src.indexOf(ctx.origin) !== 0 && src.indexOf('https://www.gstatic.com/') !== 0) return null;
    if (/(chrome|moz|safari)-extension:\/\//.test(String((err && err.stack) || '') + src)) return null;
    const stack = err && err.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : '';
    return {
      at: ctx.now || Date.now(), app: 'cadence', uid: ctx.uid, name: cut(ctx.name || 'Someone', 100),
      where: cut(ctx.where || '', 200), message: cut(message, 500), code: cut(code, 100),
      detail: cut([input.kind ? '(' + input.kind + ')' : '', input.note || '', stack].filter(Boolean).join('\n'), 4000),
      url: cut(String(ctx.url || '').replace(/\?.*$/, ''), 300), agent: cut(ctx.agent || '', 300), version: cut(ctx.version || '', 40),
    };
  }
  const key = (p) => { const b = (s) => String(s || '').replace(/[0-9a-f]{8,}|\d+/gi, '#'); return [p.app, b(p.where), b(p.message)].join('|'); };
  function Throttle(max, quietMs) { this.max = max || 15; this.quietMs = quietMs || 5 * 60e3; this.n = 0; this.last = new Map(); }
  Throttle.prototype.ok = function (p, now) {
    now = now || Date.now();
    if (!p || this.n >= this.max) return false;
    const k = key(p), t = this.last.get(k);
    if (t != null && now - t < this.quietMs) return false;
    this.last.set(k, now); this.n++; return true;
  };

  let lastAct = '', sending = false;
  const throttle = new Throttle();
  function report(input) {
    if (sending) return;
    try {
      const FB = C.firebaseSync;
      if (!FB || !FB.db || !FB.user) return; // working on this device only, or not signed in yet
      const p = from(input, {
        uid: FB.user.uid, name: FB.user.name || FB.user.email || '', where: [String(document.title || '').replace(/ · Wayholm Plan$/, ''), lastAct].filter(Boolean).join(' · '),
        url: location.pathname + location.hash, agent: navigator.userAgent, version: C.VERSION || '', origin: location.origin, online: navigator.onLine,
      });
      if (!p || !throttle.ok(p)) return;
      sending = true;
      FB.db.collection('problems').add(p).catch(() => {}).then(() => { sending = false; });
    } catch (e) { sending = false; }
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act],[data-action],[data-new],[data-sync-pill],button[id]');
    if (el) lastAct = el.dataset.act || el.dataset.action || (el.hasAttribute('data-new') ? 'new task' : '') || (el.hasAttribute('data-sync-pill') ? 'sync' : '') || el.id || '';
  }, true);
  window.addEventListener('error', (e) => report({ error: e.error, message: e.message, source: e.filename, kind: 'error' }));
  window.addEventListener('unhandledrejection', (e) => report({ error: e.reason, kind: 'rejection' }));
  const original = console.error.bind(console);
  console.error = function () {
    const args = Array.prototype.slice.call(arguments);
    original.apply(null, args);
    const err = args.find((a) => a instanceof Error || (a && typeof a === 'object' && typeof a.message === 'string' && (a.code || a.name)));
    if (err) report({ error: err, kind: 'console', note: args.filter((a) => typeof a === 'string').join(' ').slice(0, 300) });
  };
  C.problems = { from, Throttle, report };
})();
