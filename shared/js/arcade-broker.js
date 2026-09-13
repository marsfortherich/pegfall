/* ============================================================================
   arcade-broker.js — one session across four subdomains.

   Firebase keeps its session in storage scoped to the *origin*, so signing in
   on pegfall.marsindustries.dev would normally mean nothing on
   nolimit.marsindustries.dev. This routes every account and score call through
   a hidden iframe served from the hub's origin, which therefore always holds
   the one session the whole arcade shares.

   It works because the four sites share the registrable domain
   marsindustries.dev: storage partitioning is keyed on that, so a same-site
   iframe keeps the hub's real storage rather than a partitioned copy.

   If the broker cannot load — blocked iframes, a browser that partitions more
   aggressively than expected, the hub being down — the arcade falls back to a
   session local to this origin. You would then sign in once per game, exactly
   as before, rather than not at all.
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};
  var TAG = '__arcade_broker';

  var frame = null;
  var frameOrigin = null;
  var ready = false;
  var failed = false;
  var seq = 0;
  var pending = {};
  var startPromise = null;

  function brokerUrl() {
    var cfg = Arcade.sso || {};
    if (Arcade.isLocal()) return Arcade.options.rootPath + 'shared/broker.html';
    return cfg.url || '';
  }

  /** Broker mode is for deployments where the games sit on separate origins. */
  function shouldUse() {
    var cfg = Arcade.sso || {};
    if (!cfg.enabled || !Arcade.isConfigured()) return false;
    if (Arcade.isLocal()) return cfg.testLocally === true;
    if (!cfg.url) return false;
    // The hub is the broker's own origin: its session already is the shared
    // one, so going through an iframe to reach itself would just add a hop and
    // a way to fail.
    try {
      if (new URL(cfg.url, global.location.href).origin === global.location.origin) return false;
    } catch (e) { return false; }
    return true;
  }

  function active() { return ready && !failed; }

  /* ------------------------------------------------------------------ rpc */

  function call(method, args) {
    if (!active()) return Promise.reject(new Error('BROKER_DOWN'));
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      var timer = global.setTimeout(function () {
        delete pending[id];
        reject(new Error('BROKER_TIMEOUT'));
      }, (Arcade.sso && Arcade.sso.timeoutMs) || 12000);

      pending[id] = function (msg) {
        global.clearTimeout(timer);
        if (msg.ok) resolve(msg.result);
        else {
          var err = new Error(msg.error || 'Broker call failed');
          err.code = msg.code;
          err.broker = true;
          reject(err);
        }
      };
      frame.contentWindow.postMessage(
        (function () { var m = { id: id, method: method, args: args || {} }; m[TAG] = 1; return m; })(),
        frameOrigin);
    });
  }

  function onMessage(e) {
    if (!e.data || e.data[TAG] !== 1) return;
    if (frameOrigin && e.origin !== frameOrigin) return;

    if (e.data.event === 'ready' || e.data.event === 'auth') {
      if (e.data.state) Arcade.auth._adopt(e.data.state);
      return;
    }
    var fn = pending[e.data.id];
    if (fn) { delete pending[e.data.id]; fn(e.data); }
  }

  /* ---------------------------------------------------------------- start */

  function start() {
    if (startPromise) return startPromise;

    var url = brokerUrl();
    if (!url) { return fallback('no broker url configured'); }

    try { frameOrigin = new URL(url, global.location.href).origin; }
    catch (e) { return fallback('bad broker url'); }

    startPromise = new Promise(function (resolve) {
      var settled = false;
      function done(ok, why) {
        if (settled) return;
        settled = true;
        if (ok) { ready = true; resolve(true); }
        else { fallback(why); resolve(false); }
      }

      global.addEventListener('message', function (e) {
        if (!e.data || e.data[TAG] !== 1) return;
        if (e.data.event === 'ready') done(true);
      });
      global.addEventListener('message', onMessage);

      frame = global.document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Arcade account');
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-9999px';
      frame.src = url;
      frame.addEventListener('error', function () { done(false, 'iframe failed to load'); });
      global.document.body.appendChild(frame);

      // A broker that never announces itself is indistinguishable from one
      // that is blocked, so the fallback is on a timer either way.
      global.setTimeout(function () { done(false, 'broker did not respond'); },
        (Arcade.sso && Arcade.sso.timeoutMs) || 12000);
    });

    return startPromise;
  }

  /**
   * Give up on shared sign-in and run a session local to this origin. The game
   * keeps working; the player just signs in here as well.
   */
  function fallback(why) {
    if (failed) return Promise.resolve(false);
    failed = true;
    ready = false;
    if (global.console && global.console.warn) {
      global.console.warn('[arcade] shared sign-in unavailable (' + why + '); using a sign-in local to this site.');
    }
    Arcade.auth.init();
    return Promise.resolve(false);
  }

  /* --------------------------------------------------- method replacements */

  /**
   * Point the auth and score APIs at the broker. Everything above them — the
   * bar, the dialogs, the games — keeps calling exactly what it called before.
   */
  function install() {
    Arcade.auth._override({
      init: function () { return start(); },
      signIn: function (email, password) {
        return call('signIn', { email: email, password: password })
          .then(adopt);
      },
      register: function (email, password, displayName) {
        return call('register', { email: email, password: password, displayName: displayName })
          .then(adopt);
      },
      signOut: function () { return call('signOut').then(adopt); },
      sendReset: function (email) { return call('sendReset', { email: email }); },
      setDisplayName: function (name) {
        return call('setDisplayName', { name: name }).then(function (r) {
          adopt(r.state);
          return r.name;
        });
      }
    });

    var localBoard = Arcade.scores.board;
    Arcade.scores.submit = function (gameId, score, meta) {
      return call('submit', { gameId: gameId, score: score, meta: meta })
        .catch(function (err) { return { ok: false, error: describeBroker(err) }; });
    };
    Arcade.scores.board = function (gameId, topN) {
      return call('board', { gameId: gameId, topN: topN })
        .catch(function (err) {
          // A board is public, so a broken broker should not hide it: read it
          // straight from this origin instead.
          if (Arcade.fb && Arcade.fb.db) return localBoard(gameId, topN);
          return { rows: [], you: null, error: describeBroker(err) };
        });
    };
    Arcade.scores.rankOf = function (gameId, score) {
      return call('rankOf', { gameId: gameId, score: score }).catch(function () { return null; });
    };
    Arcade.scores.myStandings = function () {
      return call('myStandings').then(function (rows) {
        return rows.map(function (r) {
          return { game: Arcade.gameById(r.gameId), entry: r.entry };
        });
      }).catch(function () { return []; });
    };
    // The broker renames the rows itself inside setDisplayName.
    Arcade.scores.renameEntries = function () { return Promise.resolve(); };
  }

  function adopt(state) {
    if (state) Arcade.auth._adopt(state);
    return state;
  }

  function describeBroker(err) {
    if (!err) return 'Something went wrong.';
    if (err.message === 'BROKER_TIMEOUT') return 'The arcade account service did not respond. Try again.';
    if (err.message === 'BROKER_DOWN') return 'Shared sign-in is unavailable on this site right now.';
    return err.message || 'Something went wrong.';
  }

  Arcade.broker = {
    shouldUse: shouldUse,
    active: active,
    start: function () { install(); return start(); },
    call: call
  };
})(typeof window !== 'undefined' ? window : this);
