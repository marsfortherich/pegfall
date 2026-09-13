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
      // Resolving the auth state at startup is part of boot, not something the
      // first leaderboard click triggers.
      Arcade.auth.init();
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
      if (opts.quiet) return res;

      if (res.skipped === 'signed-out') {
        Arcade.ui.toast('Sign in to put ' + Arcade.ui.fmt(score) + ' on the ' +
          game.name + ' board.', 'gold', 5000);
      } else if (res.ok) {
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
  Arcade.showLeaderboard = function (gameId) { Arcade.ui.showLeaderboard(gameId); };
  Arcade.showAccount = function () { Arcade.ui.showAccount(); };
})(typeof window !== 'undefined' ? window : this);
