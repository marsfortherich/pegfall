/* ============================================================================
   arcade-auth.js — one Firebase app, one account, shared by every game.

   Responsibilities
     * lazily pull the Firebase compat SDK from the CDN (only when configured)
     * initialise the app exactly once per page
     * sign in / register / sign out, with persistent sessions
     * resolve the auth state on boot before anything asks "who is playing?"
     * translate Firebase error codes into sentences a player can act on

   Because every game points at the same Firebase project, signing in to one
   game signs you in to all of them.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};

  var state = {
    status: 'idle',      // idle | offline | connecting | ready | error
    user: null,          // { uid, email, displayName }
    profile: null,       // the users/{uid} document
    error: null
  };
  var listeners = [];
  var readyResolve;
  var readyPromise = new Promise(function (res) { readyResolve = res; });
  var initPromise = null;

  var fb = { app: null, auth: null, db: null };

  /* ------------------------------------------------------------------ CDN */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-arcade-sdk="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('sdk')); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;                 // keep compat load order deterministic
      s.dataset.arcadeSdk = src;
      s.addEventListener('load', function () { s.dataset.loaded = '1'; resolve(); });
      s.addEventListener('error', function () { reject(new Error('Could not load ' + src)); });
      document.head.appendChild(s);
    });
  }

  function loadSdk() {
    var v = Arcade.sdkVersion;
    var base = 'https://www.gstatic.com/firebasejs/' + v + '/';
    return loadScript(base + 'firebase-app-compat.js')
      .then(function () { return loadScript(base + 'firebase-auth-compat.js'); })
      .then(function () { return loadScript(base + 'firebase-firestore-compat.js'); });
  }

  /* ----------------------------------------------------------------- init */

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(state); } catch (e) { /* a bad listener must not stop the rest */ }
    });
  }

  function setState(patch) {
    Object.assign(state, patch);
    emit();
  }

  /**
   * Boot the platform. Safe to call from every game on every page load;
   * subsequent calls return the same promise.
   */
  function init() {
    if (initPromise) return initPromise;

    if (!Arcade.isConfigured()) {
      setState({ status: 'offline' });
      readyResolve(state);
      initPromise = Promise.resolve(state);
      return initPromise;
    }

    setState({ status: 'connecting' });

    initPromise = loadSdk().then(function () {
      var firebase = global.firebase;
      fb.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(Arcade.firebaseConfig);
      fb.auth = firebase.auth();
      fb.db = firebase.firestore();
      Arcade.fb = fb;
      connectEmulators();

      // Sessions survive reloads and tab closes. This is the default, but
      // stating it means a future SDK default change cannot silently log
      // every player out.
      return fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .catch(function () { /* private mode: fall back to whatever works */ });
    }).then(function () {
      // The first callback is the "auth state checked at startup" moment.
      var settled = false;
      return new Promise(function (resolve) {
        fb.auth.onAuthStateChanged(function (u) {
          if (u) {
            state.user = { uid: u.uid, email: u.email, displayName: u.displayName || '' };
            ensureProfile(u).then(function (p) {
              state.profile = p;
              setState({ status: 'ready', error: null });
              if (!settled) { settled = true; readyResolve(state); resolve(state); }
            });
          } else {
            state.user = null;
            state.profile = null;
            setState({ status: 'ready', error: null });
            if (!settled) { settled = true; readyResolve(state); resolve(state); }
          }
        }, function (err) {
          setState({ status: 'error', error: describe(err) });
          if (!settled) { settled = true; readyResolve(state); resolve(state); }
        });
      });
    }).catch(function (err) {
      // A blocked CDN, an offline machine, a mistyped project id. The games
      // must keep working, so degrade to offline rather than throwing.
      setState({ status: 'offline', error: describe(err) });
      readyResolve(state);
      return state;
    });

    return initPromise;
  }

  /** Local development against `firebase emulators:start`. Ignored unless the
      page is on localhost, so it cannot misdirect a deployed build. */
  function connectEmulators() {
    var e = Arcade.emulator;
    if (!e) return;
    var host = global.location && global.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') return;
    try {
      if (e.auth) fb.auth.useEmulator('http://' + host + ':' + e.auth, { disableWarnings: true });
      if (e.firestore) fb.db.useEmulator(host, e.firestore);
      state.emulated = true;
    } catch (err) { /* already connected on a soft reload */ }
  }

  /* -------------------------------------------------------------- profile */

  /* Registration and the auth-state listener both race to create the profile
     document: createUserWithEmailAndPassword fires onAuthStateChanged before
     updateProfile has run, so whichever lands first decides the name. This
     holds the chosen name across that gap so both writers agree on it. */
  var pendingName = null;

  /** The users/{uid} document: the display name every leaderboard row copies. */
  function ensureProfile(u) {
    var ref = fb.db.collection('users').doc(u.uid);
    var wanted = pendingName || u.displayName || defaultName(u);
    return ref.get().then(function (snap) {
      if (snap.exists) return Object.assign({ uid: u.uid }, snap.data());
      return writeProfile(u.uid, wanted, false).then(function () {
        return { uid: u.uid, displayName: wanted };
      });
    }).catch(function () {
      // Rules or connectivity: fall back to a local-only view of the user so
      // the UI can still show who is signed in.
      return { uid: u.uid, displayName: wanted };
    });
  }

  /**
   * Write the profile, as a create or an update depending on what is already
   * there.
   *
   * The distinction matters: the rules only let an update touch the name and
   * updatedAt, so a blind set() over an existing document re-sends uid and
   * createdAt and is refused. `exists` is passed when the caller already knows.
   */
  function writeProfile(uid, name, exists) {
    var ref = fb.db.collection('users').doc(uid);
    var stampNow = global.firebase.firestore.FieldValue.serverTimestamp();

    function update() {
      return ref.update({
        displayName: name,
        displayNameLower: name.toLowerCase(),
        updatedAt: stampNow
      });
    }
    function create() {
      return ref.set({
        uid: uid,
        displayName: name,
        displayNameLower: name.toLowerCase(),
        createdAt: stampNow,
        updatedAt: stampNow
      });
    }

    if (exists === true) return update();
    if (exists === false) {
      // Lost the race: the other writer created it, so fall back to an update.
      return create().catch(function () { return update(); });
    }
    return ref.get().then(function (snap) { return snap.exists ? update() : create(); });
  }

  function defaultName(u) {
    return (u.email || 'player').split('@')[0].slice(0, Arcade.options.maxNameLength);
  }

  /* ----------------------------------------------------------- operations */

  function requireReady() {
    if (state.status === 'offline') {
      return Promise.reject(new Error('OFFLINE'));
    }
    return init();
  }

  function signIn(email, password) {
    return requireReady().then(function () {
      return fb.auth.signInWithEmailAndPassword(String(email).trim(), password);
    }).then(function (cred) { return cred.user; });
  }

  function register(email, password, displayName) {
    var name = String(displayName || '').trim();
    var opts = Arcade.options;
    if (name.length < opts.minNameLength || name.length > opts.maxNameLength) {
      return Promise.reject(new Error('NAME_LENGTH'));
    }
    if (!/^[\w .'-]+$/.test(name)) return Promise.reject(new Error('NAME_CHARS'));

    return requireReady().then(function () {
      // Claimed before the account exists, so the auth-state listener that
      // fires inside createUser already knows which name to write.
      pendingName = name;
      return fb.auth.createUserWithEmailAndPassword(String(email).trim(), password);
    }).then(function (cred) {
      return cred.user.updateProfile({ displayName: name }).then(function () {
        return writeProfile(cred.user.uid, name);
      }).then(function () {
        pendingName = null;
        state.user = { uid: cred.user.uid, email: cred.user.email, displayName: name };
        state.profile = { uid: cred.user.uid, displayName: name };
        emit();
        return cred.user;
      });
    }).catch(function (err) {
      pendingName = null;
      throw err;
    });
  }

  function signOut() {
    if (state.status === 'offline' || !fb.auth) return Promise.resolve();
    return fb.auth.signOut();
  }

  function sendReset(email) {
    return requireReady().then(function () {
      return fb.auth.sendPasswordResetEmail(String(email).trim());
    });
  }

  /** Rename: the users doc is the source of truth; leaderboard rows follow. */
  function setDisplayName(name) {
    name = String(name || '').trim();
    var opts = Arcade.options;
    if (name.length < opts.minNameLength || name.length > opts.maxNameLength) {
      return Promise.reject(new Error('NAME_LENGTH'));
    }
    if (!state.user) return Promise.reject(new Error('SIGNED_OUT'));

    return fb.auth.currentUser.updateProfile({ displayName: name }).then(function () {
      return writeProfile(state.user.uid, name);
    }).then(function () {
      state.user.displayName = name;
      if (state.profile) state.profile.displayName = name;
      emit();
      if (Arcade.scores && Arcade.scores.renameEntries) Arcade.scores.renameEntries(name);
      return name;
    });
  }

  /* --------------------------------------------------------------- errors */

  var MESSAGES = {
    'auth/invalid-email': 'That does not look like an email address.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account with that email. Register instead?',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/email-already-in-use': 'That email is already registered. Sign in instead?',
    'auth/weak-password': 'Pick a password of at least 6 characters.',
    'auth/missing-password': 'Enter your password.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/network-request-failed': 'No connection to the arcade. Check your network.',
    'auth/operation-not-allowed': 'Email sign-in is switched off for this project.',
    /* Thrown when Authentication has never been initialised in the Firebase
       project — the sign-in method list does not exist yet. Distinct from
       operation-not-allowed, which means it exists but email is off. */
    'auth/configuration-not-found': 'Accounts are not switched on for this arcade yet.',
    'auth/admin-restricted-operation': 'New accounts are closed on this arcade right now.',
    'auth/internal-error': 'The sign-in service had a problem. Try again in a moment.',
    'auth/unauthorized-domain': 'This domain is not authorised in the Firebase project.',
    'permission-denied': 'The arcade refused that. You can only change your own data.',
    'unavailable': 'The arcade is unreachable right now. Your run is saved locally.',
    OFFLINE: 'The arcade is not configured yet — playing offline.',
    NAME_LENGTH: 'Your name needs 3 to 20 characters.',
    NAME_CHARS: 'Letters, numbers, spaces, . - and ’ only, please.',
    SIGNED_OUT: 'You are signed out.'
  };

  function describe(err) {
    if (!err) return 'Something went wrong.';
    var code = err.code || err.message || '';
    return MESSAGES[code] || err.message || 'Something went wrong.';
  }

  /* ------------------------------------------------------------------ api */

  Arcade.auth = {
    init: init,
    /* Resolves once *a* backend has settled the auth state — the direct
       Firebase path here, or the cross-subdomain broker driving it from the
       hub's origin. It must not force the direct path, or asking "who is
       playing?" would start a second, origin-local session. */
    ready: function () {
      if (!Arcade.broker || !Arcade.broker.active()) init();
      return readyPromise;
    },
    get state() { return state; },
    get user() { return state.user; },
    get status() { return state.status; },
    isSignedIn: function () { return !!state.user; },
    displayName: function () {
      return (state.profile && state.profile.displayName) ||
        (state.user && (state.user.displayName || state.user.email)) || 'Guest';
    },
    onChange: function (fn) {
      listeners.push(fn);
      if (state.status !== 'idle') { try { fn(state); } catch (e) {} }
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    signIn: signIn,
    register: register,
    signOut: signOut,
    sendReset: sendReset,
    setDisplayName: setDisplayName,
    describe: describe,

    /* Used only by arcade-broker.js, which owns the session on the hub's
       origin and mirrors it in here. Everything above reads this state, so
       the UI never needs to know which backend it is talking to. */
    _adopt: function (next) {
      state.user = next.user || null;
      state.profile = next.profile || null;
      setState({ status: next.status || 'ready', error: next.error || null });
      readyResolve(state);
    },
    _override: function (impl) {
      Object.keys(impl).forEach(function (k) { Arcade.auth[k] = impl[k]; });
    }
  };
})(typeof window !== 'undefined' ? window : this);
