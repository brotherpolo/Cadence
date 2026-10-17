/* Cadence — Firebase Authentication + Cloud Firestore sync (optional, build-free).
   Active only when firebase-config.js has an apiKey and projectId.
   Data layout (matches firestore.rules):
     users/{uid}/items/settings   → task types + importance levels
     users/{uid}/items/map        → the mind map (nodes + edges), private
     users/{uid}/items/board      → charts saved to the Board page, private
     tasks/{taskId}               → one document per task                    */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  // Accept the config as window.CADENCE_FIREBASE_CONFIG, or as the
  // `const firebaseConfig = {...}` snippet pasted straight from the Firebase console.
  let cfg = window.CADENCE_FIREBASE_CONFIG || {};
  if (!cfg.apiKey) {
    try { if (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.apiKey) cfg = firebaseConfig; } catch (e) { /* not defined */ }
  }
  // Email + password is the default sign-in. Set window.CADENCE_AUTH_PROVIDERS = { google: true, emailPassword: true }
  // in firebase-config.js to also show "Continue with Google".
  const providers = window.CADENCE_AUTH_PROVIDERS || { google: false, emailPassword: true };
  const inArtifact = !!(window.claude && typeof window.claude.use === 'function');
  const enabled = !!(cfg.apiKey && cfg.projectId) && !inArtifact;
  const V = '10.12.2';
  const SDK = 'https://www.gstatic.com/firebasejs/' + V + '/';

  const FB = {
    enabled, user: null, signOut: null, projectId: cfg.projectId || null,
    // why sync is off, for the Settings card
    reason: enabled ? null : inArtifact ? 'artifact' : (window.CADENCE_FIREBASE_CONFIG === undefined && !cfg.apiKey) ? 'no-file' : 'no-config'
  };
  C.firebaseSync = FB;
  if (!enabled) return;

  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('Could not load Firebase. Check your connection and reload.'));
    document.head.appendChild(s);
  });

  let once = null;
  FB.collection = function () {
    if (!once) once = connectOnce().catch((e) => { once = null; throw e; });
    return once;
  };
  async function connectOnce() {
    await load(SDK + 'firebase-app-compat.js');
    await Promise.all([load(SDK + 'firebase-auth-compat.js'), load(SDK + 'firebase-firestore-compat.js')]);
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    // App Check (optional): proves requests come from this site, not a script reusing the
    // project's public settings. Turned on by CADENCE_APPCHECK_KEY in firebase-config.js.
    const appCheckKey = String(window.CADENCE_APPCHECK_KEY || '').trim();
    if (appCheckKey && !FB.appCheckOn) {
      try {
        if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        await load(SDK + 'firebase-app-check-compat.js');
        app.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(appCheckKey), true);
        FB.appCheckOn = true;
      } catch (e) { console.warn('[cadence] App Check not started', e); }
    }
    const auth = app.auth();
    const db = app.firestore();
    // Some networks, proxies, VPNs and privacy tools break Firestore's streaming
    // connection, so listeners never hear back. Long polling works around that.
    try {
      db.settings(window.CADENCE_FORCE_LONG_POLLING ? { experimentalForceLongPolling: true, merge: true } : { experimentalAutoDetectLongPolling: true, merge: true });
    } catch (e) { /* settings already applied */ }

    // Email/password accounts must verify their address before the app opens.
    // A verified email is what lets other people find you and assign you tasks
    // (firestore.rules only lets a verified address claim its directory entry).
    const user = await new Promise((resolve) => {
      let done = false;
      const finish = (u) => { if (done) return; done = true; stopVerifyWatch(); hideGate(); resolve(u); };
      onVerified = finish;
      auth.onAuthStateChanged((u) => {
        if (done) return;
        if (!u) { stopVerifyWatch(); mode = mode === 'verify' ? 'signin' : mode; showGate(auth); return; }
        if (needsVerify(u)) { mode = 'verify'; showGate(auth); startVerifyWatch(auth); return; }
        finish(u);
      });
    });
    await approval(db, auth, user);
    const uid = user.uid;
    FB.app = app; FB.db = app.firestore(); FB.load = load; FB.SDK = SDK; FB.config = cfg; // push.js builds on these
    const me = { uid, name: user.displayName || '', email: (user.email || '').toLowerCase(), verified: !!user.emailVerified };
    FB.user = { uid, email: user.email, name: user.displayName, method: ((user.providerData || [])[0] || {}).providerId || 'unknown', verified: me.verified };
    FB.me = me;
    FB.signOut = async () => {
      await auth.signOut();
      try { localStorage.removeItem('cadence.v1'); } catch (e) { /* blocked */ }
      location.reload();
    };
    // after sign-in, a later sign-out (e.g. from another tab) returns to the gate
    auth.onAuthStateChanged((u) => { if (!u && FB.user) location.reload(); });

    const tasksCol = db.collection('tasks');
    const settingsRef = db.collection('users').doc(uid).collection('items').doc('settings');
    const mapRef = db.collection('users').doc(uid).collection('items').doc('map');
    const boardRef = db.collection('users').doc(uid).collection('items').doc('board');

    // List this person in the directory so others can assign them tasks by email.
    // Only verified emails can claim an entry.
    FB.listed = false;
    if (me.email && me.verified) {
      db.collection('people').doc(me.email).set({ uid, name: me.name })
        .then(() => { FB.listed = true; })
        .catch((e) => console.warn('Could not publish directory entry:', e));
    }
    // Be on that list too (profiles/{uid}.email), so people who only use Cadence can be picked.
    // An existing name chosen in Formwright is left alone.
    if (me.email && me.verified) {
      const pref = db.collection('profiles').doc(uid);
      pref.get().then((x) => {
        if (!x.exists) return pref.set({ displayName: String(me.name || me.email.split('@')[0]).slice(0, 120), email: user.email });
        if (!x.get('email')) return pref.set({ email: user.email }, { merge: true });
        return null;
      }).catch((e) => console.warn('Could not add you to the people list:', e && e.code));
    }
    // Everyone with an account (Formwright's people list): for the "Assigned to" pills.
    FB.listPeople = async () => {
      const snap = await db.collection('profiles').get();
      return snap.docs.map((d) => { const x = d.data() || {}; return { uid: d.id, name: String(x.displayName || '').trim(), email: String(x.email || '').trim().toLowerCase(), removed: !!x.removed }; })
        .filter((p) => p.email && !p.removed)
        .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    };
    FB.findPerson = async (email) => {
      email = String(email || '').trim().toLowerCase();
      if (!email) return null;
      const snap = await db.collection('people').doc(email).get();
      if (!snap.exists) return null;
      const d = snap.data() || {};
      return { uid: d.uid, name: d.name || '', email };
    };

    await migrate(db, uid, me);

    return {
      uid, me, label: 'firebase',
      // settings stay private; every task lives in the shared /tasks collection
      col: { doc: (id) => (id === 'settings' ? settingsRef : id === 'map' ? mapRef : id === 'board' ? boardRef : tasksCol.doc(id)) },
      // fill in ownership on tasks created before sign-in or by older versions
      prepare(body) {
        if (!body.ownerId) { body.ownerId = uid; body.ownerName = me.name || null; body.ownerEmail = me.email || null; }
        if (!('assigneeId' in body)) body.assigneeId = null;
        if (!Array.isArray(body.members)) body.members = body.assigneeId ? [body.ownerId, body.assigneeId] : [body.ownerId];
        return body;
      },
      // one combined stream: the private settings doc + every task this person is a member of
      listen(next, err) {
        let s = null, m = null, bd = null, t = null, dead = false, u1 = null, u2 = null, u3 = null, u4 = null, u5 = null;
        // tasks given to a role this person holds (Formwright → Roles): one listener per role
        const roleSubs = new Map(), roleDocs = new Map();
        const stopRoles = () => { roleSubs.forEach((u) => u()); roleSubs.clear(); roleDocs.clear(); };
        const stop = () => { [u1, u2, u3, u4, u5].forEach((u) => { if (u) u(); }); stopRoles(); };
        const fire = () => {
          if (dead || !s || !m || !bd || !t) return;
          const docs = [];
          if (s.exists) docs.push({ id: 'settings', data: () => s.data() });
          if (m.exists) docs.push({ id: 'map', data: () => m.data() });
          if (bd.exists) docs.push({ id: 'board', data: () => bd.data() });
          const seen = new Set();
          t.docs.forEach((d) => { seen.add(d.id); docs.push(d); });
          roleDocs.forEach((list) => list.forEach((d) => { if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); } }));
          next({ docs, empty: !docs.length, metadata: { fromCache: s.metadata.fromCache || m.metadata.fromCache || bd.metadata.fromCache || t.metadata.fromCache } });
        };
        const fail = (e) => { if (dead) return; dead = true; stop(); err(e); };
        u1 = settingsRef.onSnapshot({ includeMetadataChanges: true }, (x) => { s = x; fire(); }, fail);
        u4 = boardRef.onSnapshot({ includeMetadataChanges: true }, (x) => { bd = x; fire(); }, fail);
        u3 = mapRef.onSnapshot({ includeMetadataChanges: true }, (x) => { m = x; fire(); }, fail);
        u2 = tasksCol.where('members', 'array-contains', uid).onSnapshot({ includeMetadataChanges: true }, (x) => { t = x; fire(); }, fail);
        u5 = db.collection('users').doc(uid).onSnapshot((x) => {
          const want = new Set(((x.exists && x.get('roles')) || []).filter((r) => typeof r === 'string').slice(0, 20));
          roleSubs.forEach((u, r) => { if (!want.has(r)) { u(); roleSubs.delete(r); roleDocs.delete(r); } });
          want.forEach((r) => {
            if (roleSubs.has(r)) return;
            roleSubs.set(r, tasksCol.where('assigneeRole', '==', r).onSnapshot((q) => { roleDocs.set(r, q.docs); fire(); },
              (e) => { console.warn('Tasks for a role could not be read:', e && e.code); roleDocs.delete(r); fire(); }));
          });
          fire();
        }, () => {});
        return () => { dead = true; stop(); };
      }
    };
  }

  /* Version 7 and earlier kept tasks in users/{uid}/items/{taskId}.
     Move them to /tasks with ownership fields, then remove the old copies. */
  async function migrate(db, uid, me) {
    const legacy = db.collection('users').doc(uid).collection('items');
    let snap;
    try { snap = await legacy.get(); } catch (e) { console.warn('Could not check for tasks to move:', e); return; }
    const docs = snap.docs.filter((d) => !['settings', 'map', 'board'].includes(d.id)); // private docs stay put
    for (let i = 0; i < docs.length; i += 200) {
      const b = db.batch();
      docs.slice(i, i + 200).forEach((d) => {
        const body = Object.assign({}, d.data(), {
          id: d.id, ownerId: uid, ownerName: me.name || null, ownerEmail: me.email || null,
          assigneeId: null, members: [uid]
        });
        b.set(db.collection('tasks').doc(d.id), body);
        b.delete(d.ref);
      });
      try { await b.commit(); }
      catch (e) {
        throw new Error('Couldn’t move your tasks to the new shared storage (' + (e.code || e.message) + '). Deploy the updated firestore.rules (firebase deploy --only firestore:rules), then press Retry. Your tasks are safe on this device and in the old location.');
      }
    }
  }

  /* ---------- email verification ---------- */
  let onVerified = null, verifyTimer = null, verifyFocus = null;
  const isPassword = (u) => (u.providerData || []).some((p) => p && p.providerId === 'password');
  const needsVerify = (u) => !!(u && u.email && !u.emailVerified && isPassword(u));

  // Re-read the account from Firebase; once the link has been clicked, refresh the
  // ID token so Firestore sees email_verified = true, then open the app.
  async function checkVerified(auth, manual) {
    const u = auth.currentUser;
    if (!u) return;
    try {
      await u.reload();
      if (auth.currentUser && auth.currentUser.emailVerified) {
        await auth.currentUser.getIdToken(true);
        if (onVerified) onVerified(auth.currentUser);
      } else if (manual) {
        renderGate('Not verified yet. Open the link in the email we sent to ' + u.email + ', then press this button again.');
      }
    } catch (err) { if (manual) renderGate(msg(err)); }
  }
  function startVerifyWatch(auth) {
    stopVerifyWatch();
    // notice automatically when the person clicks the link in another tab
    verifyTimer = setInterval(() => checkVerified(auth, false), 5000);
    verifyFocus = () => checkVerified(auth, false);
    window.addEventListener('focus', verifyFocus);
  }
  function stopVerifyWatch() {
    if (verifyTimer) clearInterval(verifyTimer);
    if (verifyFocus) window.removeEventListener('focus', verifyFocus);
    verifyTimer = verifyFocus = null;
  }

  /* ---------- sign-in gate ---------- */
  let gate = null, mode = 'signin', currentAuth = null;
  const ERR = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account uses that email. Create one instead.',
    'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
    'auth/unauthorized-domain': 'This domain isn’t authorized. Add it in Firebase console → Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method is turned off in the Firebase console.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/user-token-expired': 'Your sign-in expired. Sign in again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };
  const msg = (e) => ERR[e && e.code] || (e && e.message) || 'Something went wrong. Try again.';

  /* Cadence is by approval: a new account sees only a "no access" screen until a Formwright admin turns on
     "Cadence" for it on the Users screen (users/{uid}.cadence; admins always can).
     firestore.rules enforce the same thing, so this screen is only the friendly part. */
  const approved = (d) => !!d && (d.role === 'admin' || d.cadence === true);
  async function approval(db, auth, user) {
    const ref = db.collection('users').doc(user.uid);
    let snap;
    try { snap = await ref.get(); } catch (e) { console.warn('Could not check approval:', e); return; }
    if (!snap.exists) {
      // the same starting record Formwright makes: a member with no access, so an admin can find and approve it
      try { await ref.set({ email: user.email || '', displayName: user.displayName || '', role: 'member', groups: [], access: {}, createdAt: Date.now() }); }
      catch (e) { console.warn('Could not create the account record:', e); }
      try { snap = await ref.get(); } catch (e) { return; }
    }
    if (!approved(snap.exists ? snap.data() : null)) {
      mode = 'approve'; showGate(auth);
      await new Promise((resolve) => {
        const stop = ref.onSnapshot((x) => { if (approved(x.exists ? x.data() : null)) { stop(); hideGate(); mode = 'signin'; resolve(); } }, (e) => console.warn('Approval check stopped:', e));
      });
    }
    // if an admin takes access away later, close Cadence straight away and show the no-access screen
    ref.onSnapshot((x) => { if (!approved(x.exists ? x.data() : null)) { try { localStorage.removeItem('cadence.v1'); } catch (e) { /* blocked */ } location.reload(); } }, () => {});
  }
  function renderApprove() {
    const u = currentAuth && currentAuth.currentUser;
    gate.innerHTML = '<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
      '<div class="brand"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="9" class="logo-bg"/><rect x="8.5" y="16" width="3.6" height="8" rx="1.8" class="logo-bar"/><rect x="14.2" y="11" width="3.6" height="13" rx="1.8" class="logo-bar"/><rect x="19.9" y="7.5" width="3.6" height="16.5" rx="1.8" class="logo-bar hi"/></svg><span class="brand-name">Cadence</span></div>' +
      '<h1 id="gate-title" class="gate-title">You don’t have access yet</h1>' +
      '<p class="muted gate-sub">Please contact an administrator.</p>' +
      '<p class="gate-note">Signed in as <b>' + esc((u && u.email) || 'this account') + '</b></p>' +
      '<div class="gate-links"><button type="button" class="gate-link" data-aout>Sign out</button></div>' +
      '</div>';
  }
  function showGate(auth) {
    currentAuth = auth;
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'gate';
      document.body.appendChild(gate);
      // nothing behind the screen can be reached with the keyboard or a screen reader
      [...document.body.children].forEach((el) => { if (el !== gate) el.inert = true; });
      gate.addEventListener('submit', (e) => onSubmit(e, auth));
      gate.addEventListener('click', (e) => onClick(e, auth));
    }
    renderGate();
  }
  function hideGate() { if (gate) { gate.remove(); gate = null; [...document.body.children].forEach((el) => { el.inert = false; }); } }

  function renderGate(error, note) {
    if (mode === 'verify') return renderVerify(error, note);
    if (mode === 'approve') return renderApprove();
    const up = mode === 'signup';
    gate.innerHTML = '<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
      '<div class="brand"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="9" class="logo-bg"/><rect x="8.5" y="16" width="3.6" height="8" rx="1.8" class="logo-bar"/><rect x="14.2" y="11" width="3.6" height="13" rx="1.8" class="logo-bar"/><rect x="19.9" y="7.5" width="3.6" height="16.5" rx="1.8" class="logo-bar hi"/></svg><span class="brand-name">Cadence</span></div>' +
      '<h1 id="gate-title" class="gate-title">' + (up ? 'Create your account' : 'Sign in to your tasks') + '</h1>' +
      '<p class="muted gate-sub">' + (up ? 'We’ll email you a link to confirm your address. ' : '') + 'Your tasks sync across your devices. Only you and the people you share a task with can see it.</p>' +
      (providers.google ? '<button type="button" class="btn block gate-google" data-g>' + icon('sparkle') + '<span>Continue with Google</span></button>' : '') +
      (providers.google && providers.emailPassword ? '<div class="gate-or"><span>or</span></div>' : '') +
      (providers.emailPassword ? '<form class="gate-form" novalidate>' +
        '<label class="field-label" for="gate-email">Email</label><label class="input-wrap"><input id="gate-email" type="email" autocomplete="email" required></label>' +
        '<label class="field-label" for="gate-pass">Password</label><label class="input-wrap"><input id="gate-pass" type="password" autocomplete="' + (up ? 'new-password' : 'current-password') + '" minlength="6" required></label>' +
        (error ? '<p class="gate-err" role="alert">' + esc(error) + '</p>' : '') + (note ? '<p class="gate-note" role="status">' + esc(note) + '</p>' : '') +
        '<button type="submit" class="btn primary block gate-submit">' + (up ? 'Create account' : 'Sign in') + '</button>' +
        '<div class="gate-links">' +
        '<button type="button" class="gate-link" data-mode>' + (up ? 'Have an account? Sign in' : 'New here? Create an account') + '</button>' +
        (!up ? '<button type="button" class="gate-link" data-reset>Forgot password?</button>' : '') + '</div>' +
        '</form>' : (error ? '<p class="gate-err" role="alert">' + esc(error) + '</p>' : '')) +
      '</div>';
  }
  function renderVerify(error, note) {
    const u = currentAuth && currentAuth.currentUser;
    const email = (u && u.email) || 'your email';
    gate.innerHTML = '<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
      '<div class="brand"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="9" class="logo-bg"/><rect x="8.5" y="16" width="3.6" height="8" rx="1.8" class="logo-bar"/><rect x="14.2" y="11" width="3.6" height="13" rx="1.8" class="logo-bar"/><rect x="19.9" y="7.5" width="3.6" height="16.5" rx="1.8" class="logo-bar hi"/></svg><span class="brand-name">Cadence</span></div>' +
      '<h1 id="gate-title" class="gate-title">Verify your email</h1>' +
      '<p class="muted gate-sub">We sent a link to <b>' + esc(email) + '</b>. Open it to confirm the address is yours. That lets other people assign you tasks. Check your spam folder if it doesn’t arrive.</p>' +
      (error ? '<p class="gate-err" role="alert">' + esc(error) + '</p>' : '') + (note ? '<p class="gate-note" role="status">' + esc(note) + '</p>' : '') +
      '<button type="button" class="btn primary block gate-submit" data-vcheck>I’ve verified my email</button>' +
      '<div class="gate-links">' +
      '<button type="button" class="gate-link" data-vsend>Send the link again</button>' +
      '<button type="button" class="gate-link" data-vout>Use a different account</button></div>' +
      '</div>';
  }

  async function onSubmit(e, auth) {
    e.preventDefault();
    const email = gate.querySelector('#gate-email').value.trim();
    const pass = gate.querySelector('#gate-pass').value;
    const btn = gate.querySelector('.gate-submit');
    btn.disabled = true; btn.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    try {
      if (mode === 'signup') {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        try { await cred.user.sendEmailVerification(); } catch (err) { console.warn('Could not send verification email:', err); }
      } else await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) { renderGate(msg(err)); const em = gate.querySelector('#gate-email'); if (em) em.value = email; }
  }
  async function onClick(e, auth) {
    if (e.target.closest('[data-vcheck]')) {
      const b = e.target.closest('[data-vcheck]'); b.disabled = true; b.textContent = 'Checking…';
      return checkVerified(auth, true);
    }
    if (e.target.closest('[data-vsend]')) {
      try { await auth.currentUser.sendEmailVerification(); renderGate(null, 'Sent. Check ' + auth.currentUser.email + '.'); }
      catch (err) { renderGate(msg(err)); }
      return;
    }
    if (e.target.closest('[data-aout]')) { await auth.signOut(); try { localStorage.removeItem('cadence.v1'); } catch (err) { /* blocked */ } return location.reload(); }
    if (e.target.closest('[data-vout]')) { mode = 'signin'; stopVerifyWatch(); return auth.signOut(); }
    if (e.target.closest('[data-g]')) {
      try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
      catch (err) {
        if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
          try { return await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); } catch (e2) { return renderGate(msg(e2)); }
        }
        renderGate(msg(err));
      }
    } else if (e.target.closest('[data-mode]')) {
      mode = mode === 'signup' ? 'signin' : 'signup'; renderGate();
    } else if (e.target.closest('[data-reset]')) {
      const email = gate.querySelector('#gate-email').value.trim();
      if (!email) return renderGate('Enter your email above, then choose “Forgot password?” again.');
      try { await auth.sendPasswordResetEmail(email); renderGate(null, 'Check ' + email + ' for a link to reset your password.'); }
      catch (err) { renderGate(msg(err)); }
      const em = gate && gate.querySelector('#gate-email'); if (em) em.value = email;
    }
  }
})();
