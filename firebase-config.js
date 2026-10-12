/* Cadence — Firebase configuration (optional).
   Leave apiKey empty to run without accounts (tasks stay in this browser).
   To turn on sign-in + cloud sync, paste your web app config from
   Firebase console → Project settings → Your apps → SDK setup → Config.
   These values are public identifiers, not secrets; access is enforced by
   firestore.rules. See README.md for the full setup. */
window.CADENCE_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCttjLdM3YVxQVZIhmrYZMdJhFAML1EOYo',
  authDomain: 'tasks-2ae9d.firebaseapp.com',
  projectId: 'tasks-2ae9d',
  storageBucket: 'tasks-2ae9d.firebasestorage.app',
  messagingSenderId: '85761171492',
  appId: '1:85761171492:web:6e5df7c848ca961b2cb8b1'
};

/* Sign-in methods shown on the sign-in screen. Enable the same ones in
   Firebase console → Authentication → Sign-in method. */
window.CADENCE_AUTH_PROVIDERS = { google: true, emailPassword: true };

/* Set to true if sync stays on "Connecting…" or times out on some networks
   (corporate proxies, VPNs, some antivirus or privacy tools). */
window.CADENCE_FORCE_LONG_POLLING = false;
