/* ============================================================================
   arcade.js — the façade every game talks to.

   A game needs exactly two calls:

       Arcade.init({ gameId: 'pegfall' });                  // once, at boot
       Arcade.submitScore('pegfall', score, { floor: 12 }); // when a run ends

   plus, optionally, `Arcade.ui.inlineActions()` to drop a matching pair of
   arcade buttons into its own menus.

   Load order in the page:
       arcade-config.js, arcade-auth.js, arcade-scores.js, arcade-ui.js, arcade.js
   ========================================================================= */
(function (global) {
  'use strict';

  var Arcade = global.Arcade = global.Arcade || {};
  var booted = false;

  /* ------------------------------------------------- runs held for sign-in

     A run finished signed out used to be gone: the toast said "sign in to
     put this on the board", and signing in posted nothing. Now the best one
     per game is kept in this browser and posted once the player signs in --
     here, or on another site whose sign-in the broker passes along. */
  var HELD_KEY = 'arcade.held.v1';

  function readHeld() {
    try { return JSON.parse(global.localStorage.getItem(HELD_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeHeld(held) {
    try {
      if (Object.keys(held).length) global.localStorage.setItem(HELD_KEY, JSON.stringify(held));
      else global.localStorage.removeItem(HELD_KEY);
    } catch (e) { /* private mode: nothing is kept */ }
  }
  function scoreOf(payload) {
    var n = Number(payload && typeof payload === 'object' ? payload.score : payload);
    return isFinite(n) ? n : 0;
  }
  /** Keep a signed-out run, unless a better one is already waiting. */
  function holdRun(gameId, payload, meta) {
    var held = readHeld();
    if (held[gameId] && scoreOf(held[gameId].payload) >= scoreOf(payload)) return;
    held[gameId] = { payload: payload, meta: meta === undefined ? null : meta, at: Date.now() };
    writeHeld(held);
  }

  var posting = false;
  /** Post every held run, now that someone is signed in. */
  function postHeld() {
    if (posting || !Arcade.auth || !Arcade.auth.isSignedIn()) return Promise.resolve([]);
    var held = readHeld();
    var ids = Object.keys(held);
    if (!ids.length) return Promise.resolve([]);
    posting = true;
    var posted = [];
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var h = held[id];
        return Arcade.scores.submit(id, h.payload, h.meta === null ? undefined : h.meta)
          .then(function (res) {
            if (!res || !res.ok) return;
            var now = readHeld();
            delete now[id];
            writeHeld(now);
            posted.push(id);
            Arcade.ui.toast('Posted the run you finished signed out · ' +
              Arcade.ui.fmt(scoreOf(h.payload)), 'good', 4200);
          });
      });
    });
    return chain.catch(function () { /* stays held; next sign-in tries again */ })
      .then(function () { posting = false; return posted; });
  }

  /**
   * @param opts.gameId    id from the registry in arcade-config.js
   * @param opts.rootPath  where the arcade root sits relative to this page
   * @param opts.bar       set false to skip the floating arcade bar
   */
  function init(opts) {
    opts = opts || {};
    if (booted) return Arcade.auth.ready();
    booted = true;

    var game = Arcade.gameById(opts.gameId);
    if (opts.rootPath !== undefined) Arcade.options.rootPath = opts.rootPath;
    Arcade.gameId = game.id;
    Arcade.ui.setGame(game.id);

    // Themes the shared chrome to match the host game.
    if (game.theme) document.documentElement.setAttribute('data-arcade-game', game.theme);

    var start = function () {
      if (opts.bar !== false) Arcade.ui.mountBar();
      // Whenever someone is signed in, post any run they finished signed out.
      Arcade.auth.onChange(function (st) { if (st && st.user) postHeld(); });
      // Resolving the auth state at startup is part of boot, not something the
      // first leaderboard click triggers. On a subdomain deploy that state
      // lives in the hub's broker, so the session is shared rather than
      // rebuilt per site.
      if (Arcade.broker && Arcade.broker.shouldUse()) Arcade.broker.start();
      else Arcade.auth.init();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }

    return Arcade.auth.ready();
  }

  /**
   * Post a finished run. Never throws and never blocks the game: the caller
   * can ignore the promise entirely.
   *
   * Shows a toast for the interesting outcomes (new personal best, a rank, or
   * "sign in to post this") and stays quiet otherwise.
   */
  function submitScore(gameId, score, meta, opts) {
    opts = opts || {};
    var id = gameId || Arcade.gameId;
    var game = Arcade.gameById(id);

    return Arcade.auth.ready().then(function () {
      return Arcade.scores.submit(id, score, meta);
    }).then(function (res) {
      if (res.skipped === 'signed-out') {
        holdRun(id, score, meta);
        if (!opts.quiet) {
          Arcade.ui.toast('Sign in to put ' + Arcade.ui.fmt(scoreOf(score)) + ' on the ' +
            game.name + ' board \u2014 it is kept until you do.', 'gold', 5000);
        }
        return res;
      }
      if (opts.quiet) return res;
      if (res.ok) {
        var rank = Arcade.ui.rankText(res.rank);
        Arcade.ui.toast(res.isRecord
          ? 'New personal best — ' + Arcade.ui.fmt(res.best) + ' · ' + rank + ' overall'
          : 'Run posted · your best is ' + Arcade.ui.fmt(res.best) + ' · ' + rank,
          res.isRecord ? 'gold' : 'good', 4200);
      } else if (res.error) {
        Arcade.ui.toast(res.error, 'bad', 4200);
      }
      return res;
    }).catch(function () {
      return { ok: false };
    });
  }

  Arcade.init = init;
  Arcade.submitScore = submitScore;
  Arcade.postHeldRuns = postHeld;
  Arcade.showLeaderboard = function (gameId) { Arcade.ui.showLeaderboard(gameId); };
  Arcade.showAccount = function () { Arcade.ui.showAccount(); };
})(typeof window !== 'undefined' ? window : this);
